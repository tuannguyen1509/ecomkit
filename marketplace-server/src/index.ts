/** Server-only marketplace domain workspace. It is intentionally not exported to Web. */
export const MARKETPLACE_SERVER_WORKSPACE = "@ecomkit/marketplace-server" as const;
export * from "./lifecycle-contracts.js";
export * from "./shopee-credential-lifecycle.js";
export * from "./shopee-order-client-core.js";
export * from "./shopee-normalizer.js";
