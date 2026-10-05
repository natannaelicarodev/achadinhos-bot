// @achadinhos/stores: código das lojas compartilhado entre painel e worker.
//
// REGRA: credencial CENTRAL (sistema) -> só ShopeeCatalogReader (leitura).
//        credencial DO CLIENTE        -> ShopeeLinkGenerator / generateAffiliateLink.
// O cliente GraphQL baixo nível não é exportado.
export { SHOPEE_GRAPHQL_URL, shopeeSignature, shopeeAuthorization, ShopeeApiError, type ShopeeCredentials } from "./shopee/client";
export {
  ShopeeCatalogReader,
  productOfferQuery,
  parseProductOffers,
  toMinedProduct,
  type ProductOfferArgs,
} from "./shopee/reader";
export { ShopeeLinkGenerator, sanitizeSubId, shopeeErrorMessage } from "./shopee/links";
export { ShopeeReportReader, conversionsFromNodes, parseSubIds, type ShopeeOrderConversion } from "./shopee/report";
export {
  storeOfHost,
  parseHttpsUrl,
  resolveStoreUrl,
  parseProductUrl,
  extractProductInfo,
  fetchProductInfo,
  fetchStorePage,
  isMercadoLivreShortLink,
  isMercadoLivreSocialPage,
  readMercadoLivreSocialPage,
  priceToCents,
  decodeEntities,
  StoreUrlError,
  type ProductRef,
  type PageProductInfo,
  type FetchOptions,
  type ResolveOptions,
} from "./urls";
export {
  SHEIN_CAMPAIGN_ID,
  AFFILIATE_STORES,
  STORE_NAMES,
  shopeeSecretsSchema,
  amazonSecretsSchema,
  mercadoLivreSecretsSchema,
  sheinSecretsSchema,
  readMercadoLivreAffiliateLink,
  mercadoLivreTagsOf,
  resolveMercadoLivreShortLink,
  isOwnMercadoLivreLink,
  isAmazonShortLink,
  canonicalAmazonShortLink,
  resolveAmazonShortLink,
  isOwnAmazonLink,
  readSheinAffiliateId,
  type AffiliateStore,
  type ShopeeSecrets,
  type AmazonSecrets,
  type MercadoLivreSecrets,
  type SheinSecrets,
} from "./credentials";
export {
  generateAffiliateLink,
  amazonAffiliateUrl,
  mercadoLivreAffiliateUrl,
  sheinAffiliateUrl,
  MissingCredentialError,
  AffiliateLinkError,
  type AffiliateDeps,
} from "./affiliate";
export {
  DEFAULT_HEADLINE,
  DEFAULT_MESSAGE_TEMPLATE,
  TEMPLATE_VARIABLES,
  formatBRL,
  messageVariables,
  renderMessage,
  validateTemplate,
  parseWhatsappFormatting,
  type TemplateVariable,
  type MessageProduct,
  type WhatsappSegment,
} from "./message";
export { getMessageSettings, composeMessage, type MessageSettings, type ShareProduct } from "./message-settings";
export * from "./headlines";
