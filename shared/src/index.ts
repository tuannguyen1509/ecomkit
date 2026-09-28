export const PROJECT_NAME = "Ecomkit - Vui Khỏe" as const;
export const TECHNICAL_SLUG = "ecomkit-vuikhoe" as const;
export { normalizeOrderCode } from "./order-code";
export {
  decryptMarketplaceCredential,
  encryptMarketplaceCredential,
  redactMarketplaceCredential,
  MarketplaceCredentialCryptoError,
  MARKETPLACE_CREDENTIAL_ENVELOPE_VERSION
} from "./marketplace-credential-crypto";
export type {
  MarketplaceCredentialEnvelope,
  MarketplaceCredentialErrorCode,
  MarketplaceShopCredential,
  RedactedMarketplaceShopCredential
} from "./marketplace-credential-crypto";
export type {
  MarketplaceAdapter,
  MarketplaceAdapterContext,
  MarketplaceAdapterAuthorizationCodeInput,
  MarketplaceAdapterAuthorizationInput,
  MarketplaceAdapterAuthorizationResult,
  MarketplaceAdapterConnectionIdentity,
  MarketplaceAdapterOrder,
  MarketplaceAdapterSyncInput,
  MarketplaceAdapterSyncResult,
  MarketplaceSupportedPlatform,
  NormalizedMarketplaceOrder,
  NormalizedMarketplaceOrderItem
} from "./marketplace-adapter-contract";
export {
  getShopeeBaseUrl,
  hmacSha256Hex,
  loadShopeeRuntimeConfig,
  ShopeeConfigError,
  ShopeeHttpClient,
  ShopeeHttpError,
  ShopeeSigner
} from "./shopee-http-client";
export type { ShopeeClock, ShopeeEnvironment, ShopeeFetch, ShopeePublicRequest, ShopeeResponse, ShopeeRuntimeConfig, ShopeeShopRequest } from "./shopee-http-client";
export const getBatchProcessingJobId = (batchId: string): string => `batch-${batchId}`;
export const getMarketplaceSyncJobId = (syncRunId: string): string => `marketplace-sync-${syncRunId}`;
