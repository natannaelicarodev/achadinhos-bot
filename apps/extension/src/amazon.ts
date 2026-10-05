// Amazon: link curto da SiteStripe (mesmo pedido do botão "Obter link > Link curto"
// da barra de Associados), dados do produto e "Mais vendidos" (vitrine do catálogo).
// Tudo roda dentro de uma aba da amazon.com.br, com a sessão do próprio navegador.

/** Pedido INTERNO da SiteStripe (capturado em 10/2026): pode mudar sem aviso. */
export const SITESTRIPE_SHORT_URL = "https://www.amazon.com.br/associates/sitestripe/getShortUrl";
/** Código do marketplace Brasil na SiteStripe. */
export const AMAZON_BR_MARKETPLACE_ID = "526970";
const AMAZON_ORIGIN = "https://www.amazon.com.br";

export class AmazonError extends Error {
  override name = "AmazonError";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const NOT_LOGGED =
  "A Amazon não reconheceu sua conta de Associados. Entre na amazon.com.br com a conta de Associados neste Chrome (a barra SiteStripe precisa aparecer no topo dos produtos).";
const CAPTCHA = "A Amazon pediu uma verificação (captcha). Abra a amazon.com.br neste Chrome, resolva a verificação e tente de novo.";

/** ASIN (código do produto) de um endereço da Amazon. */
export function asinOf(productUrl: string): string | null {
  return productUrl.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?#]|$)/i)?.[1]?.toUpperCase() ?? null;
}

/** Endereço longo com a etiqueta do cliente (o que a SiteStripe encurta). */
export function amazonLongUrl(asin: string, tag: string): string {
  return `${AMAZON_ORIGIN}/dp/${asin}?linkCode=sl2&tag=${encodeURIComponent(tag)}`;
}

function isCaptcha(text: string, url = ""): boolean {
  return /validateCaptcha|\/errors\/validateCaptcha|api-services-support@amazon\.com/i.test(text) || /validateCaptcha/i.test(url);
}

/** Link curto (link.amazon / amzn.to) com a etiqueta do cliente. */
export async function createAmazonShortLink(http: typeof fetch, productUrl: string, tag: string): Promise<{ shortUrl: string }> {
  const asin = asinOf(productUrl);
  if (!asin) throw new AmazonError("Endereço de produto da Amazon inválido.");
  const query = new URLSearchParams({ longUrl: amazonLongUrl(asin, tag), marketplaceId: AMAZON_BR_MARKETPLACE_ID, storeId: tag });
  const response = await http(`${SITESTRIPE_SHORT_URL}?${query}`, { headers: { accept: "application/json, text/javascript, */*" } });
  if (response.status === 401 || response.status === 403) throw new AmazonError(NOT_LOGGED, response.status);
  const text = await response.text();
  if (isCaptcha(text, response.url)) throw new AmazonError(CAPTCHA, response.status);
  if (/\/ap\/signin/.test(response.url)) throw new AmazonError(NOT_LOGGED, response.status);
  return parseShortUrlResponse(text, response.status);
}

export function parseShortUrlResponse(text: string, status = 200): { shortUrl: string } {
  let body: { ok?: unknown; isOk?: unknown; shortUrl?: unknown } = {};
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    // Página HTML em vez de JSON: normalmente login de Associados ausente.
    throw new AmazonError(NOT_LOGGED, status);
  }
  const shortUrl = typeof body.shortUrl === "string" ? body.shortUrl : "";
  const ok = body.ok === true || body.isOk === true;
  if (!ok || !/^https:\/\/(link\.amazon|amzn\.to)\/[A-Za-z0-9]+$/.test(shortUrl)) {
    throw new AmazonError("A Amazon não gerou o link curto. Confira se a etiqueta em Credenciais é da sua conta de Associados.", status);
  }
  return { shortUrl };
}

// ---------- Página do produto ----------

const decodeEntities = (text: string) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

/** "R$ 1.305,93" / "R$305,93" -> centavos. */
export function parseBrl(text: string): number | null {
  const m = text.match(/R\$\s*([\d.]+),(\d{2})/);
  if (!m?.[1] || !m[2]) return null;
  const cents = Number(m[1].replace(/\./g, "")) * 100 + Number(m[2]);
  return cents > 0 ? cents : null;
}

/** Imagem sem o sufixo de tamanho (…/I/61MjgicR7qL._AC_SX342_.jpg -> …/I/61MjgicR7qL.jpg). */
export function fullSizeImage(url: string): string {
  return url.replace(/\._[^/]*_\.(jpg|jpeg|png|webp)$/i, ".$1");
}

export interface AmazonProductInfo {
  title: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
}

export function parseAmazonProductPage(html: string): AmazonProductInfo {
  const title = html.match(/id="productTitle"[^>]*>([^<]+)</)?.[1];
  const priceBlock = html.slice(Math.max(0, html.indexOf("corePriceDisplay_desktop_feature_div")));
  const toPay =
    priceBlock.match(/apex-pricetopay-accessibility-label"[^>]*>\s*([^<]+)</)?.[1] ??
    priceBlock.match(/class="a-price-whole">([\d.]+)<span class="a-price-decimal">,<\/span><\/span><span class="a-price-fraction">(\d{2})/)?.slice(1, 3).join(",");
  const priceCents = toPay ? parseBrl(toPay.startsWith("R$") ? toPay : `R$ ${toPay}`) : null;
  const basis = priceBlock.match(/apex-basisprice-offscreen-label">\s*De:\s*([^<]+)</)?.[1];
  const originalPriceCents = basis ? parseBrl(basis) : null;
  const image = html.match(/"hiRes":"(https:\/\/[^"]+)"/)?.[1] ?? html.match(/id="landingImage"[^>]*data-old-hires="(https:\/\/[^"]+)"/)?.[1];
  return {
    title: title ? decodeEntities(title).replace(/\s+/g, " ").trim() || null : null,
    imageUrl: image ? fullSizeImage(image) : null,
    priceCents,
    originalPriceCents: originalPriceCents && priceCents && originalPriceCents > priceCents ? originalPriceCents : null,
  };
}

export async function readAmazonProductInfo(http: typeof fetch, productUrl: string): Promise<AmazonProductInfo> {
  const asin = asinOf(productUrl);
  if (!asin) throw new AmazonError("Endereço de produto da Amazon inválido.");
  const response = await http(`${AMAZON_ORIGIN}/dp/${asin}`, { headers: { accept: "text/html" } });
  const html = await response.text();
  if (isCaptcha(html, response.url)) throw new AmazonError(CAPTCHA, response.status);
  if (!response.ok) throw new AmazonError(`A Amazon não abriu a página do produto (HTTP ${response.status}).`, response.status);
  return parseAmazonProductPage(html);
}

// ---------- Mais vendidos (vitrine do catálogo) ----------

export interface AmazonBestseller {
  asin: string;
  rank: number | null;
  productUrl: string;
  title: string;
  imageUrl: string | null;
  priceCents: number;
  rating: number | null;
  ratingsCount: number | null;
}

/** "Mais vendidos" de uma categoria (ex.: "grocery"), página 1 ou 2. */
export function bestsellersUrl(slug: string, page: number): string {
  return page > 1 ? `${AMAZON_ORIGIN}/gp/bestsellers/${slug}/?pg=${page}` : `${AMAZON_ORIGIN}/gp/bestsellers/${slug}/`;
}

/** Lê os produtos já renderizados da página de "Mais vendidos" (30 por página). */
export function parseBestsellers(html: string): AmazonBestseller[] {
  const items: AmazonBestseller[] = [];
  const seen = new Set<string>();
  const parts = html.split(/<div data-asin="/).slice(1);
  for (const part of parts) {
    const asin = part.match(/^([A-Z0-9]{10})"/)?.[1];
    if (!asin || seen.has(asin)) continue;
    const card = part.slice(0, 8000);
    const rank = Number(card.match(/class="zg-bdg-text">#(\d+)</)?.[1] ?? NaN);
    const rawTitle =
      card.match(/p13n-sc-css-line-clamp-\d+[^"]*">([^<]+)</)?.[1] ?? card.match(/<img alt="([^"]+)"/)?.[1] ?? "";
    const title = decodeEntities(rawTitle).replace(/\s+/g, " ").trim();
    const price = card.match(/p13n-sc-price[^"]*">([^<]+)</)?.[1];
    const priceCents = price ? parseBrl(decodeEntities(price)) : null;
    if (!title || !priceCents) continue;
    const image = card.match(/<img [^>]*src="(https:\/\/[^"]+)"/)?.[1];
    const ratingLabel = card.match(/aria-label="([\d,]+) de 5 estrelas, ([\d.]+) classifica/);
    seen.add(asin);
    items.push({
      asin,
      rank: Number.isFinite(rank) ? rank : null,
      productUrl: `${AMAZON_ORIGIN}/dp/${asin}`,
      title,
      imageUrl: image ? fullSizeImage(image) : null,
      priceCents,
      rating: ratingLabel?.[1] ? Number(ratingLabel[1].replace(",", ".")) : null,
      ratingsCount: ratingLabel?.[2] ? Number(ratingLabel[2].replace(/\./g, "")) : null,
    });
  }
  return items;
}

export async function readBestsellers(http: typeof fetch, slug: string, page: number): Promise<AmazonBestseller[]> {
  const response = await http(bestsellersUrl(slug, page), { headers: { accept: "text/html" } });
  const html = await response.text();
  if (isCaptcha(html, response.url)) throw new AmazonError(CAPTCHA, response.status);
  if (!response.ok) throw new AmazonError(`A Amazon não abriu os mais vendidos (HTTP ${response.status}).`, response.status);
  return parseBestsellers(html);
}
