// Credenciais de afiliado DO CLIENTE: formato salvo (cifrado) em StoreCredential
// e leitura de etiquetas a partir de um link de afiliado colado pelo cliente.
import type { Store } from "@achadinhos/db";
import { z } from "zod";
import { parseHttpsUrl, parseProductUrl, resolveStoreUrl, storeOfHost, StoreUrlError, type FetchOptions } from "./urls";

/**
 * campaign_id da Shein: 20. Veio de um link REAL gerado na conta de afiliada
 * da dona do produto (url_from=affiliate_koc_...&campaign_id=20). Um exemplo
 * público usa 10; vale o link real. Confirmar no teste de compra real.
 */
export const SHEIN_CAMPAIGN_ID = "20";

export const shopeeSecretsSchema = z.object({
  appId: z.string().trim().regex(/^\d{10,}$/, "O AppID tem só números (mínimo de 10 dígitos)."),
  apiSecret: z.string().trim().min(8, "Informe a Senha da API.").max(200),
});

export const amazonSecretsSchema = z.object({
  tag: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{0,60}-\d{2}$/, "A tag termina com hífen e dois números (ex.: nome-20)."),
  creatorsCredentialId: z.string().trim().max(200).optional(),
  creatorsCredentialSecret: z.string().trim().max(500).optional(),
});

export const mercadoLivreSecretsSchema = z.object({
  mattWord: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,80}$/, "Etiqueta inválida."),
  mattTool: z.string().trim().regex(/^\d{1,20}$/, "O ID da Ferramenta tem só números."),
});

export const sheinSecretsSchema = z.object({
  affiliateId: z.string().trim().regex(/^\d{4,20}$/, "O ID de afiliado da Shein tem só números."),
});

export type ShopeeSecrets = z.infer<typeof shopeeSecretsSchema>;
export type AmazonSecrets = z.infer<typeof amazonSecretsSchema>;
export type MercadoLivreSecrets = z.infer<typeof mercadoLivreSecretsSchema>;
export type SheinSecrets = z.infer<typeof sheinSecretsSchema>;

export const AFFILIATE_STORES = ["SHOPEE", "AMAZON", "MERCADO_LIVRE", "SHEIN"] as const satisfies readonly Store[];
export type AffiliateStore = (typeof AFFILIATE_STORES)[number];

export const STORE_NAMES: Record<AffiliateStore | "MAGALU", string> = {
  SHOPEE: "Shopee",
  AMAZON: "Amazon",
  MERCADO_LIVRE: "Mercado Livre",
  SHEIN: "Shein",
  MAGALU: "Magalu",
};

/** Lê matt_word e matt_tool de um link de afiliado do Mercado Livre (meli.la ou completo). */
export async function readMercadoLivreAffiliateLink(raw: string, options: FetchOptions = {}): Promise<MercadoLivreSecrets> {
  const first = parseHttpsUrl(raw);
  if (!first || storeOfHost(first.hostname) !== "MERCADO_LIVRE") {
    throw new StoreUrlError("Cole um link de afiliado do Mercado Livre (meli.la/... ou mercadolivre.com.br/...).");
  }
  // Link completo já tem os parâmetros; link curto: segue só até aparecerem.
  const hasTags = (url: URL) => url.searchParams.has("matt_word") && url.searchParams.has("matt_tool");
  const chain = hasTags(first) ? [first] : await resolveStoreUrl(raw, { ...options, stopWhen: hasTags });
  for (const url of [...chain].reverse()) {
    const mattWord = url.searchParams.get("matt_word");
    const mattTool = url.searchParams.get("matt_tool");
    if (mattWord && mattTool) return mercadoLivreSecretsSchema.parse({ mattWord, mattTool });
  }
  throw new StoreUrlError(
    "Não encontrei a Etiqueta (matt_word) e o ID da Ferramenta (matt_tool) nesse link. Gere o link no portal de afiliados do Mercado Livre e cole de novo.",
  );
}

/** Etiquetas do Mercado Livre presentes numa URL (ou null). */
export function mercadoLivreTagsOf(url: URL): MercadoLivreSecrets | null {
  const parsed = mercadoLivreSecretsSchema.safeParse({
    mattWord: url.searchParams.get("matt_word") ?? "",
    mattTool: url.searchParams.get("matt_tool") ?? "",
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Segue um meli.la até a página de destino (para ao achar as etiquetas).
 * `tags`: de quem é o link; `landing`: página social ou de produto.
 */
export async function resolveMercadoLivreShortLink(raw: string, options: FetchOptions = {}) {
  const chain = await resolveStoreUrl(raw, { ...options, stopWhen: (url) => mercadoLivreTagsOf(url) !== null });
  const landing = chain.at(-1)!;
  return { tags: mercadoLivreTagsOf(landing), landing };
}

/** true se o link é do próprio cliente (mesma Etiqueta e mesmo ID da Ferramenta). */
export function isOwnMercadoLivreLink(tags: MercadoLivreSecrets | null, secrets: MercadoLivreSecrets | null): boolean {
  return Boolean(tags && secrets && tags.mattTool === secrets.mattTool && tags.mattWord === secrets.mattWord);
}

/** Link curto da Amazon (SiteStripe: link.amazon; antigos: amzn.to, a.co). */
export function isAmazonShortLink(url: URL): boolean {
  return ["link.amazon", "amzn.to", "a.co", "amzlinks.in"].includes(url.hostname.toLowerCase()) && url.pathname.length > 1;
}

/** Link curto da Amazon sem parâmetros (o que vai na mensagem). */
export const canonicalAmazonShortLink = (url: URL) => `https://${url.hostname.toLowerCase()}${url.pathname}`;

/**
 * Segue o link curto da Amazon até a página do produto e devolve a etiqueta (tag)
 * e o produto. Usado para conferir que o link gerado pela extensão é do cliente.
 */
export async function resolveAmazonShortLink(raw: string, options: FetchOptions = {}) {
  const isProduct = (url: URL) => {
    const ref = parseProductUrl(url);
    return ref?.store === "AMAZON" ? ref : null;
  };
  const chain = await resolveStoreUrl(raw, { ...options, stopWhen: (url) => isProduct(url) !== null });
  const landing = chain.at(-1)!;
  return { tag: landing.searchParams.get("tag")?.toLowerCase() ?? null, product: isProduct(landing) };
}

/** true se o link curto da Amazon leva à etiqueta do cliente (e, se informado, ao mesmo produto). */
export function isOwnAmazonLink(
  resolved: { tag: string | null; product: { externalId: string } | null },
  secrets: AmazonSecrets | null,
  expectedAsin?: string,
): boolean {
  if (!resolved.tag || !secrets || resolved.tag !== secrets.tag || !resolved.product) return false;
  return !expectedAsin || resolved.product.externalId === expectedAsin;
}

const SHEIN_ID = /affiliate_koc_(\d{4,20})/;

/** ID de afiliado da Shein: digitado (só números) ou extraído de url_from=affiliate_koc_{ID}. */
export async function readSheinAffiliateId(raw: string, options: FetchOptions = {}): Promise<SheinSecrets> {
  const value = raw.trim();
  if (/^\d+$/.test(value)) return sheinSecretsSchema.parse({ affiliateId: value });
  const first = parseHttpsUrl(value);
  if (!first || storeOfHost(first.hostname) !== "SHEIN") {
    throw new StoreUrlError("Cole um link de afiliado da Shein (onelink.shein.com ou br.shein.com) ou digite o ID.");
  }
  const hasId = (url: URL) => SHEIN_ID.test(url.searchParams.get("url_from") ?? "");
  const chain = hasId(first) ? [first] : await resolveStoreUrl(value, { ...options, stopWhen: hasId });
  for (const url of [...chain].reverse()) {
    const id = url.searchParams.get("url_from")?.match(SHEIN_ID)?.[1] ?? url.toString().match(SHEIN_ID)?.[1];
    if (id) return sheinSecretsSchema.parse({ affiliateId: id });
  }
  throw new StoreUrlError("Não encontrei o ID de afiliado (url_from=affiliate_koc_...) nesse link. Digite o ID direto.");
}
