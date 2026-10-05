export { createPrismaClient, getPrisma } from "./client";
export { forTenant, TenantScopeError, TENANT_SCOPED_MODELS, type TenantDb } from "./tenant";
export { encrypt, decrypt, parseEncryptionKey, type EncryptedPayload } from "./crypto";
export {
  saveStoreCredential,
  setStoreCredentialStatus,
  getStoreCredentialSecrets,
  listStoreCredentials,
  deleteStoreCredential,
  getStoreCredentialsKey,
  maskSecret,
  CURRENT_KEY_VERSION,
  type StoreSecrets,
} from "./store-credentials";
export { startTrial, getCurrentSubscription, markExpiredTrialsPastDue, TRIAL_DAYS } from "./subscription";
export { PLANS, TRIAL_PLAN_CODE, FIRST_SENDING_PLAN_NAME, planAllowsSending, type PlanSeed } from "./plans";
export {
  PlanLimitError,
  NO_SENDING_MESSAGE,
  getWhatsappUsage,
  assertCanAddWhatsappNumber,
  assertChannelWithinWhatsappLimit,
  assertCanEnableGroupPosting,
} from "./limits";
export {
  FEATURE_CODES,
  featureCodeSchema,
  requestFeature,
  getFeatureRequest,
  type FeatureCode,
} from "./feature-requests";
export {
  MIN_CATALOG_RATING,
  CATALOG_PAGE_SIZE,
  MERCADO_LIVRE_STALE_HOURS,
  normalizeSearchText,
  computeCatalogScore,
  stripAffiliateParams,
  saveMinedProducts,
  findStaleCatalogProducts,
  deactivateCatalogProducts,
  listCatalog,
  toggleFavorite,
  getLatestMiningRuns,
  type MinedProduct,
  type CatalogFilters,
} from "./catalog";
export { saveOfferForSending, type OfferForSending } from "./offers";
export { PrismaClient, Prisma } from "./generated/prisma/client";
export * from "./generated/prisma/enums";
export type {
  Plan,
  Tenant,
  User,
  Session,
  PasswordResetToken,
  Subscription,
  Channel,
  Group,
  Offer,
  Post,
  Click,
  Conversion,
  StoreCredential,
  WhatsAppSession,
  WhatsAppSessionKey,
  FeatureRequest,
  CatalogProduct,
  Favorite,
  CatalogMiningRun,
  MessageTemplate,
  AutopilotSettings,
  ExtensionToken,
  StoreReportSnapshot,
} from "./generated/prisma/client";
export * from "./autopilot";
