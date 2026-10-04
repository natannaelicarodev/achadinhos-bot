// Mercado Livre, do lado da extensão: usa a SESSÃO DO NAVEGADOR (cookies do ML)
// para fazer o mesmo pedido que o portal de afiliados faz ao clicar em "Gerar".
// Nada daqui sai do navegador além do link, título, preço e imagem.
import { extractProductInfo, priceToCents } from "@achadinhos/stores/browser";
import { z } from "zod";

export const ML_ORIGIN = "https://www.mercadolivre.com.br";
/** Pedido interno do portal (visto no "Gerador de links"). Pode mudar sem aviso. */
export const CREATE_LINK_URL = `${ML_ORIGIN}/affiliate-program/api/v2/affiliates/createLink`;
/** Página inicial do portal de afiliados (onde buscamos o token de proteção). */
export const AFFILIATE_HUB_URL = `${ML_ORIGIN}/afiliados/hub`;

export class MlError extends Error {
  override name = "MlError";
  constructor(
    message: string,
    /** Código HTTP da resposta do ML (para o diagnóstico). */
    readonly status?: number,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

// Lugares comuns onde sites guardam o token de proteção (CSRF) no HTML.
// O nome de cada um vai no diagnóstico (o valor nunca).
export const CSRF_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "meta csrf-token", re: /<meta[^>]+name=["']csrf-token["'][^>]*content=["']([^"']{8,})["']/i },
  { name: "meta _csrf", re: /<meta[^>]+name=["']_csrf["'][^>]*content=["']([^"']{8,})["']/i },
  { name: "json csrfToken", re: /["']csrfToken["']\s*:\s*["']([^"']{8,})["']/i },
  { name: "json csrf", re: /["']csrf["']\s*:\s*["']([^"']{8,})["']/i },
  { name: "json _csrf", re: /["']_csrf["']\s*:\s*["']([^"']{8,})["']/i },
  { name: "json xCsrfToken", re: /["']x-?csrf-?token["']\s*:\s*["']([^"']{8,})["']/i },
];

export function findCsrfToken(html: string): { token: string; pattern: string } | null {
  for (const { name, re } of CSRF_PATTERNS) {
    const token = html.match(re)?.[1];
    if (token) return { token, pattern: name };
  }
  return null;
}

/** Abre o portal de afiliados com a sessão do navegador e pega o token de proteção. */
export async function fetchCsrfToken(http: Fetch): Promise<{ token: string; pattern: string }> {
  const response = await http(AFFILIATE_HUB_URL, { credentials: "include", redirect: "follow" });
  if (!response.ok) throw new MlError(`O portal de afiliados respondeu HTTP ${response.status}.`);
  if (/\/(login|jms\/.*\/lgz)/i.test(response.url)) {
    throw new MlError("Você não está logada no Mercado Livre neste navegador. Entre na sua conta e tente de novo.");
  }
  const found = findCsrfToken(await response.text());
  if (!found) throw new MlError("Não encontrei o token de proteção do portal de afiliados.");
  return found;
}

// Resposta do createLink (formato real visto no portal).
const createLinkResponseSchema = z.object({
  urls: z
    .array(
      z.object({
        short_url: z.string().url().optional(),
        long_url: z.string().url().optional(),
        tag: z.string().optional(),
      }),
    )
    .min(1),
  total_success: z.number().optional(),
  total_error: z.number().optional(),
});

export function parseCreateLinkResponse(body: unknown): { shortUrl: string; longUrl: string | null } {
  const parsed = createLinkResponseSchema.safeParse(body);
  const first = parsed.success ? parsed.data.urls[0] : undefined;
  if (!first?.short_url || !/^https:\/\/meli\.la\//.test(first.short_url)) {
    throw new MlError("O Mercado Livre não devolveu o link meli.la.");
  }
  return { shortUrl: first.short_url, longUrl: first.long_url ?? null };
}

/** Gera o meli.la do cliente (mesmo pedido do botão "Gerar" do portal). */
export async function createMeliLink(
  http: Fetch,
  productUrl: string,
  tag: string,
  csrfToken: string,
): Promise<{ shortUrl: string; longUrl: string | null }> {
  const response = await http(CREATE_LINK_URL, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({ urls: [productUrl], tag }),
  });
  if (response.status === 401 || response.status === 403) {
    throw new MlError(
      "O Mercado Livre recusou o pedido. Entre na sua conta do Mercado Livre neste navegador e tente de novo.",
      response.status,
    );
  }
  if (!response.ok) throw new MlError(`O Mercado Livre respondeu HTTP ${response.status} ao gerar o link.`, response.status);
  return parseCreateLinkResponse(await response.json());
}

/** Preço "de" (riscado) da página do ML: bloco andes-money-amount--previous. */
export function parsePreviousPrice(html: string): number | null {
  const start = html.search(/andes-money-amount--previous/i);
  if (start < 0) return null;
  // 1º: descrição de acessibilidade ("Antes: 499 reais com 90 centavos"), a mais confiável.
  const aria = html
    .slice(Math.max(0, start - 400), start + 1500)
    .match(/aria-label=["'][^"']*?([\d.]+)\s+reais(?:\s+com\s+(\d{1,2})\s+centavos?)?/i);
  if (aria?.[1]) return priceToCents(`${aria[1]},${(aria[2] ?? "00").padStart(2, "0")}`);
  // 2º: dentro do trecho do preço riscado, reais e centavos.
  const block = html.slice(start, start + 1500);
  const end = block.search(/<\/s>/i);
  const scope = end > 0 ? block.slice(0, end) : block;
  const reais = scope.match(/andes-money-amount__fraction[^>]*>([\d.]+)</i)?.[1];
  if (!reais) return null;
  const cents = scope.match(/andes-money-amount__cents[^>]*>(\d{1,2})</i)?.[1] ?? "00";
  return priceToCents(`${reais},${cents.padEnd(2, "0")}`);
}

/** O ML põe o preço no fim do título exposto (ex.: "Controle X - R$ 449"): tira esse final. */
export function cleanMlTitle(title: string | null): string | null {
  if (!title) return title;
  const clean = title.replace(/\s*[-|–]\s*R\$\s*[\d.,]+\s*$/i, "").replace(/\s*\|\s*Mercado Livre\s*$/i, "").trim();
  return clean || title;
}

/** Título, preço, preço original e imagem lidos da página do produto (sessão do navegador). */
export async function readMlProductInfo(http: Fetch, productUrl: string) {
  const response = await http(productUrl, { credentials: "include", redirect: "follow" });
  if (!response.ok) throw new MlError(`A página do produto respondeu HTTP ${response.status}.`);
  const html = await response.text();
  const info = extractProductInfo(html);
  const previous = parsePreviousPrice(html);
  return {
    ...info,
    title: cleanMlTitle(info.title),
    originalPriceCents: info.originalPriceCents ?? (previous && info.priceCents && previous > info.priceCents ? previous : null),
  };
}
