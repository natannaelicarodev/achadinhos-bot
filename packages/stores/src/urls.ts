// Identificação da loja pela URL, redirecionamentos (só dentro das lojas) e
// leitura de página de produto. Lista fechada de domínios: o servidor nunca
// acessa endereço fora das lojas (evita uso para alcançar a rede interna).
import type { Store } from "@achadinhos/db";

const STORE_DOMAINS: { store: Store; domains: string[] }[] = [
  { store: "SHOPEE", domains: ["shopee.com.br", "shope.ee"] },
  { store: "MERCADO_LIVRE", domains: ["mercadolivre.com.br", "mercadolivre.com", "mercadolibre.com", "meli.la"] },
  // link.amazon -> amzlinks.in -> amazon.com.br: link curto atual da SiteStripe (10/2026).
  { store: "AMAZON", domains: ["amazon.com.br", "amzn.to", "a.co", "link.amazon", "amzlinks.in"] },
  { store: "SHEIN", domains: ["shein.com", "shein.com.br"] },
];

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Loja dona do domínio (inclui encurtadores), ou null. */
export function storeOfHost(host: string): Store | null {
  const h = host.toLowerCase();
  return STORE_DOMAINS.find((s) => s.domains.some((d) => hostMatches(h, d)))?.store ?? null;
}

export function parseHttpsUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export class StoreUrlError extends Error {
  override name = "StoreUrlError";
}

export interface FetchOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface ResolveOptions extends FetchOptions {
  /** Para assim que uma URL da cadeia já tiver o que se procura (sem abrir mais páginas). */
  stopWhen?: (url: URL) => boolean;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    chunks.push(chunk);
    if (total >= maxBytes) {
      await response.body.cancel().catch(() => undefined);
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Encurtadores/links de redirecionamento das lojas (os únicos onde seguimos meta refresh). */
function isShortener(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    host === "meli.la" ||
    (host === "mercadolivre.com" && url.pathname.startsWith("/sec/")) ||
    host === "amzn.to" ||
    host === "a.co" ||
    host === "link.amazon" ||
    host === "amzlinks.in" ||
    host === "onelink.shein.com" ||
    host === "shope.ee" ||
    host === "s.shopee.com.br"
  );
}

function metaRefreshTarget(html: string): string | null {
  const match = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>\s]+)/i);
  return match?.[1] ? decodeEntities(match[1]) : null;
}

/**
 * Segue redirecionamentos (HTTP 3xx e meta refresh) só entre domínios das
 * lojas. Devolve todas as URLs visitadas (a última é o destino). Para cedo
 * com `stopWhen`; se a loja mandar de volta para um endereço já visitado
 * (ex.: página que se recarrega), para ali em vez de andar em círculo.
 */
export async function resolveStoreUrl(raw: string, options: ResolveOptions = {}): Promise<URL[]> {
  const start = parseHttpsUrl(raw);
  if (!start) throw new StoreUrlError("Cole um endereço válido (começando com https://).");
  let url: URL = start;
  const chain: URL[] = [];
  const visited = new Set<string>();
  const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  const http = options.fetch ?? fetch;

  for (let hop = 0; hop <= 5; hop++) {
    if (!storeOfHost(url.hostname)) {
      throw new StoreUrlError("Este endereço não é de uma loja suportada (Shopee, Mercado Livre, Amazon ou Shein).");
    }
    chain.push(url);
    visited.add(url.toString());
    if (options.stopWhen?.(url)) return chain;
    let response: Response;
    try {
      response = await http(url, { redirect: "manual", signal, headers: { "user-agent": USER_AGENT, accept: "text/html" } });
    } catch {
      throw new StoreUrlError("Não foi possível abrir o endereço. Confira o link e tente de novo.");
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => undefined);
      const next = parseHttpsUrl(new URL(location, url).toString());
      if (!next) throw new StoreUrlError("O link redireciona para um endereço inválido.");
      if (visited.has(next.toString())) return chain; // círculo: fica com o que já tem
      url = next;
      continue;
    }
    // Meta refresh só é seguido a partir de encurtador: páginas normais das
    // lojas às vezes "se recarregam" sem parar (ex.: Mercado Livre /social/).
    const type = response.headers.get("content-type") ?? "";
    const refresh =
      isShortener(url) && type.includes("html") ? metaRefreshTarget(await readLimitedText(response, 200_000)) : null;
    await response.body?.cancel().catch(() => undefined);
    const next = refresh ? parseHttpsUrl(new URL(refresh, url).toString()) : null;
    if (!next || visited.has(next.toString())) return chain;
    url = next;
  }
  throw new StoreUrlError("O link redireciona vezes demais.");
}

// ---------- Produto: loja, id e URL limpa ----------

export interface ProductRef {
  store: Store;
  externalId: string;
  /** URL do produto sem parâmetros de afiliado/rastreio. */
  productUrl: string;
}

/** Identifica produto da Shopee, Amazon, Mercado Livre ou Shein numa URL já resolvida. */
export function parseProductUrl(url: URL): ProductRef | null {
  const store = storeOfHost(url.hostname);
  const path = decodeURIComponent(url.pathname);

  if (store === "SHOPEE") {
    const m = path.match(/\/product\/(\d+)\/(\d+)/) ?? path.match(/-i\.(\d+)\.(\d+)/);
    if (!m) return null;
    return { store, externalId: m[2]!, productUrl: `https://shopee.com.br/product/${m[1]}/${m[2]}` };
  }
  if (store === "AMAZON") {
    const m = path.match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin)\/([A-Z0-9]{10})(?:[/?]|$)/i);
    if (!m) return null;
    const asin = m[1]!.toUpperCase();
    return { store, externalId: asin, productUrl: `https://www.amazon.com.br/dp/${asin}` };
  }
  if (store === "MERCADO_LIVRE") {
    // MLB123 (anúncio/catálogo) ou MLBU123 (página "up" de produto do vendedor).
    const m = path.match(/(MLBU?)-?(\d{6,})/i);
    if (!m || !url.hostname.endsWith("mercadolivre.com.br")) return null;
    return { store, externalId: `${m[1]!.toUpperCase()}${m[2]}`, productUrl: `${url.origin}${url.pathname}` };
  }
  if (store === "SHEIN") {
    const m = path.match(/-p-(\d+)(?:-cat-\d+)?\.html/i);
    if (!m) return null;
    // m.shein.com/br/... e br.shein.com/... apontam para o mesmo produto.
    const cleanPath = url.hostname.startsWith("m.") ? url.pathname.replace(/^\/br(?=\/)/, "") : url.pathname;
    return { store, externalId: m[1]!, productUrl: `https://br.shein.com${cleanPath}` };
  }
  return null;
}

// ---------- Leitura da página do produto (título, preço, imagem) ----------

export interface PageProductInfo {
  title: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

function metaContent(html: string, key: string): string | null {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${k}["'][^>]*content=["']([^"']*)["']`, "i"));
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${k}["']`, "i"));
  const value = (a ?? b)?.[1];
  return value ? decodeEntities(value).trim() || null : null;
}

/** "1.299,90", "1299.90", 59.9 -> centavos. */
export function priceToCents(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
  if (typeof value !== "string") return null;
  let s = value.replace(/[^\d.,]/g, "");
  if (!s) return null;
  if (s.includes(",") && s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

function jsonLdProduct(html: string): { name?: unknown; image?: unknown; price?: unknown } | null {
  const blocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, content] of blocks) {
    try {
      const data: unknown = JSON.parse(content ?? "");
      const items = (Array.isArray(data) ? data : [data]).flatMap((d) =>
        d && typeof d === "object" && "@graph" in d ? ((d as { "@graph": unknown[] })["@graph"] ?? []) : [d],
      );
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const type = (item as { "@type"?: unknown })["@type"];
        if (type !== "Product" && !(Array.isArray(type) && type.includes("Product"))) continue;
        const p = item as { name?: unknown; image?: unknown; offers?: unknown };
        const offers = Array.isArray(p.offers) ? p.offers[0] : p.offers;
        const o = (offers ?? {}) as { price?: unknown; lowPrice?: unknown };
        return { name: p.name, image: Array.isArray(p.image) ? p.image[0] : p.image, price: o.price ?? o.lowPrice };
      }
    } catch {
      // JSON-LD inválido: ignora o bloco
    }
  }
  return null;
}

/** Extrai título, imagem e preço de metatags Open Graph / dados estruturados. */
export function extractProductInfo(html: string): PageProductInfo {
  const ld = jsonLdProduct(html);
  const title = (typeof ld?.name === "string" ? decodeEntities(ld.name) : null) ?? metaContent(html, "og:title");
  const image = (typeof ld?.image === "string" ? ld.image : null) ?? metaContent(html, "og:image");
  const price =
    priceToCents(ld?.price) ??
    priceToCents(metaContent(html, "product:price:amount")) ??
    priceToCents(metaContent(html, "og:price:amount")) ??
    priceToCents(metaContent(html, "price"));
  const original = priceToCents(metaContent(html, "product:original_price:amount"));
  return {
    title: title?.slice(0, 300) ?? null,
    imageUrl: image && parseHttpsUrl(image) ? image : null,
    priceCents: price,
    originalPriceCents: original && price && original > price ? original : null,
  };
}

/** HTML de uma página de loja (só domínios das lojas, até 2 MB). null se falhar. */
export async function fetchStorePage(pageUrl: string, options: FetchOptions = {}): Promise<string | null> {
  const url = parseHttpsUrl(pageUrl);
  if (!url || !storeOfHost(url.hostname)) return null;
  try {
    const response = await (options.fetch ?? fetch)(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      headers: { "user-agent": USER_AGENT, accept: "text/html", "accept-language": "pt-BR,pt;q=0.9" },
    });
    if (!response.ok) return null;
    return await readLimitedText(response, 2_000_000);
  } catch {
    return null;
  }
}

const hasInfo = (info: PageProductInfo) => Boolean(info.title || info.priceCents || info.imageUrl);

/** Baixa a página do produto e extrai título, preço e imagem. */
export async function fetchProductInfo(productUrl: string, options: FetchOptions = {}): Promise<PageProductInfo | null> {
  const html = await fetchStorePage(productUrl, options);
  if (!html) return null;
  const info = extractProductInfo(html);
  return hasInfo(info) ? info : null;
}

// ---------- Mercado Livre: link meli.la (página "social") ----------

/** meli.la e mercadolivre.com/sec: links curtos gerados no portal de afiliados. */
export function isMercadoLivreShortLink(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === "meli.la" || (host === "mercadolivre.com" && url.pathname.startsWith("/sec/"));
}

/** Página "social" do Mercado Livre: produto recomendado pelo afiliado (destino do meli.la). */
export function isMercadoLivreSocialPage(url: URL): boolean {
  return storeOfHost(url.hostname) === "MERCADO_LIVRE" && url.pathname.startsWith("/social/");
}

/**
 * Lê a página social do meli.la: título/preço/imagem do produto recomendado e
 * o endereço do produto (para converter quando o link for de outra pessoa).
 */
export async function readMercadoLivreSocialPage(
  socialUrl: URL,
  options: FetchOptions = {},
): Promise<{ info: PageProductInfo | null; product: ProductRef | null }> {
  const html = await fetchStorePage(socialUrl.toString(), options);
  if (!html) return { info: null, product: null };
  const info = extractProductInfo(html);
  let product: ProductRef | null = null;
  for (const [raw] of html.matchAll(/https:\/\/(?:www|produto)\.mercadolivre\.com\.br\/[^"'\s<>\\]*MLB-?\d{6,}[^"'\s<>\\]*/g)) {
    const url = parseHttpsUrl(decodeEntities(raw));
    product = url ? parseProductUrl(url) : null;
    if (product) break;
  }
  return { info: hasInfo(info) ? info : null, product };
}
