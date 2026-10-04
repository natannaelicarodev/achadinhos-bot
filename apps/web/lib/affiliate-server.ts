// Servidor: prévia de divulgação (link do cliente + mensagem pronta).
// Credencial CENTRAL da Shopee: só ShopeeCatalogReader (ler título/preço/imagem).
// Link de afiliado: sempre generateAffiliateLink (credencial DO CLIENTE).
import { forTenant } from "@achadinhos/db";
import {
  AffiliateLinkError,
  DEFAULT_HEADLINE,
  DEFAULT_MESSAGE_TEMPLATE,
  fetchProductInfo,
  generateAffiliateLink,
  messageVariables,
  MissingCredentialError,
  renderMessage,
  ShopeeCatalogReader,
  type AffiliateStore,
  type PageProductInfo,
  type ProductRef,
} from "@achadinhos/stores";

let centralReader: ShopeeCatalogReader | null | undefined;

/** Leitor de produtos da Shopee com a credencial central (só leitura; null se não configurada). */
export function getCentralShopeeReader(): ShopeeCatalogReader | null {
  if (centralReader === undefined) {
    const appId = process.env.SHOPEE_CATALOG_APP_ID?.trim();
    const secret = process.env.SHOPEE_CATALOG_SECRET?.trim();
    centralReader = appId && secret ? new ShopeeCatalogReader({ appId, secret }) : null;
  }
  return centralReader;
}

export interface MessageSettings {
  body: string;
  headline: string;
  isDefault: boolean;
}

export async function getMessageSettings(tenantId: string): Promise<MessageSettings> {
  const row = await forTenant(tenantId).messageTemplate.findUnique({ where: { tenantId } });
  return row
    ? { body: row.body, headline: row.headline, isDefault: false }
    : { body: DEFAULT_MESSAGE_TEMPLATE, headline: DEFAULT_HEADLINE, isDefault: true };
}

export type LinkResult =
  | { ok: true; link: string }
  | { ok: false; error: string; missingCredential?: AffiliateStore };

/** Link do cliente, com erro amigável (e a loja, quando falta credencial). */
export async function affiliateLinkFor(tenantId: string, product: ProductRef): Promise<LinkResult> {
  try {
    return { ok: true, link: await generateAffiliateLink(tenantId, product) };
  } catch (error) {
    if (error instanceof MissingCredentialError) return { ok: false, error: error.message, missingCredential: error.store };
    if (error instanceof AffiliateLinkError) return { ok: false, error: error.message };
    console.error("[afiliado] falha ao gerar link", error);
    return { ok: false, error: "Não foi possível gerar o link agora. Tente de novo." };
  }
}

/** Título, preço e imagem: Shopee pela API (credencial central); demais lojas pela página. */
export async function readProductInfo(product: ProductRef): Promise<PageProductInfo | null> {
  if (product.store === "SHOPEE") {
    const reader = getCentralShopeeReader();
    if (!reader) return null;
    try {
      const found = await reader.getProduct(product.externalId);
      return found
        ? {
            title: found.title,
            imageUrl: found.imageUrl,
            priceCents: found.priceCents,
            originalPriceCents: found.originalPriceCents,
          }
        : null;
    } catch {
      return null;
    }
  }
  return fetchProductInfo(product.productUrl);
}

export interface ShareProduct {
  title: string;
  priceCents: number | null;
  originalPriceCents: number | null;
  discountPct: number | null;
}

export function composeMessage(settings: { body: string }, product: ShareProduct, link: string, headline: string): string {
  return renderMessage(settings.body, messageVariables(product, link, headline));
}
