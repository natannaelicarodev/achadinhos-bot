export { createPrismaClient, getPrisma } from "./client";
export { forTenant, TenantScopeError, TENANT_SCOPED_MODELS, type TenantDb } from "./tenant";
export { encrypt, decrypt, parseEncryptionKey, type EncryptedPayload } from "./crypto";
export {
  saveStoreCredential,
  getStoreCredentialSecrets,
  listStoreCredentials,
  deleteStoreCredential,
  getStoreCredentialsKey,
  maskSecret,
  CURRENT_KEY_VERSION,
  type StoreSecrets,
} from "./store-credentials";
export { startTrial, getCurrentSubscription, markExpiredTrialsPastDue, TRIAL_DAYS } from "./subscription";
export { PLANS, TRIAL_PLAN_CODE, type PlanSeed } from "./plans";
export {
  PlanLimitError,
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
} from "./generated/prisma/client";
