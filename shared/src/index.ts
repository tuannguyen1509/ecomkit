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
export const getBatchProcessingJobId = (batchId: string): string => `batch-${batchId}`;
