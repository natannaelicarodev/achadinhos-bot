// Link de afiliado DO CLIENTE. Toda conversão usa só a credencial salva pelo
// tenant (StoreCredential). A credencial central do sistema nunca chega aqui.
import { getStoreCredentialSecrets, type Store } from "@achadinhos/db";
import {
  amazonSecretsSchema,
  mercadoLivreSecretsSchema,
  SHEIN_CAMPAIGN_ID,
  sheinSecretsSchema,
  shopeeSecretsSchema,
  STORE_NAMES,
  type AffiliateStore,
} from "./credentials";
import { ShopeeLinkGenerator, shopeeErrorMessage } from "./shopee/links";
import type { ProductRef } from "./urls";

export class MissingCredentialError extends Error {
  override name = "MissingCredentialError";
  constructor(readonly store: AffiliateStore) {
    super(`Configure sua credencial da ${STORE_NAMES[store]} para gerar links desta loja.`);
  }
}

export class AffiliateLinkError extends Error {
  override name = "AffiliateLinkError";
}

const TRACKING_PARAMS = /^(tag|ascsubtag|linkcode|ref_?|matt_|url_from|campaign_id|aff|utm_|smtt|sp_atk|xptdk)/i;

function withParams(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  url.hash = "";
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export const amazonAffiliateUrl = (asin: string, tag: string) =>
  withParams(`https://www.amazon.com.br/dp/${asin}`, { tag });

export const mercadoLivreAffiliateUrl = (productUrl: string, mattWord: string, mattTool: string) =>
  withParams(productUrl, { matt_word: mattWord, matt_tool: mattTool });

export const sheinAffiliateUrl = (productUrl: string, affiliateId: string) =>
  withParams(productUrl, { url_from: `affiliate_koc_${affiliateId}`, campaign_id: SHEIN_CAMPAIGN_ID });

export interface AffiliateDeps {
  /** Segredos DO TENANT para a loja (padrão: StoreCredential cifrado). */
  getSecrets?: (store: AffiliateStore) => Promise<Record<string, string> | null>;
  fetch?: typeof fetch;
}

function isAffiliateStore(store: Store): store is AffiliateStore {
  return store === "SHOPEE" || store === "AMAZON" || store === "MERCADO_LIVRE" || store === "SHEIN";
}

/**
 * Gera o link de afiliado do tenant para um produto (do catálogo ou colado).
 * `groupId` (fase 5) vira subId da Shopee junto com o tenant.
 */
export async function generateAffiliateLink(
  tenantId: string,
  product: ProductRef,
  options: AffiliateDeps & { groupId?: string } = {},
): Promise<string> {
  if (!isAffiliateStore(product.store)) {
    throw new AffiliateLinkError("Esta loja ainda não é suportada para links de afiliado.");
  }
  const store = product.store;
  const getSecrets = options.getSecrets ?? ((s: AffiliateStore) => getStoreCredentialSecrets(tenantId, s));
  const secrets = await getSecrets(store);
  if (!secrets) throw new MissingCredentialError(store);

  switch (store) {
    case "SHOPEE": {
      const creds = shopeeSecretsSchema.safeParse(secrets);
      if (!creds.success) throw new MissingCredentialError(store);
      const generator = new ShopeeLinkGenerator({
        appId: creds.data.appId,
        secret: creds.data.apiSecret,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
      try {
        return await generator.generateShortLink(product.productUrl, [tenantId, ...(options.groupId ? [options.groupId] : [])]);
      } catch (error) {
        throw new AffiliateLinkError(shopeeErrorMessage(error));
      }
    }
    case "AMAZON": {
      const creds = amazonSecretsSchema.safeParse(secrets);
      if (!creds.success) throw new MissingCredentialError(store);
      return amazonAffiliateUrl(product.externalId, creds.data.tag);
    }
    case "MERCADO_LIVRE": {
      const creds = mercadoLivreSecretsSchema.safeParse(secrets);
      if (!creds.success) throw new MissingCredentialError(store);
      return mercadoLivreAffiliateUrl(product.productUrl, creds.data.mattWord, creds.data.mattTool);
    }
    case "SHEIN": {
      const creds = sheinSecretsSchema.safeParse(secrets);
      if (!creds.success) throw new MissingCredentialError(store);
      return sheinAffiliateUrl(product.productUrl, creds.data.affiliateId);
    }
  }
}
