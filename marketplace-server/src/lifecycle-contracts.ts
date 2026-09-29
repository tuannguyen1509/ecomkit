export type MarketplaceLifecyclePlatform = "SHOPEE" | "LAZADA" | "TIKTOK" | "UNKNOWN";
export type MarketplaceLifecycleConnectionStatus = "PENDING_AUTH" | "ACTIVE" | "REAUTH_REQUIRED" | "DISABLED";
export type MarketplaceLifecycleConnection = Readonly<{ connectionId: string; platform: MarketplaceLifecyclePlatform; externalShopId: string; status: MarketplaceLifecycleConnectionStatus; credentialEnvelope: string | null }>;
export type ShopeeCredential = Readonly<{ accessToken?: string; refreshToken?: string; tokenExpiresAt?: string; refreshTokenExpiresAt?: string; providerMetadata?: Readonly<Record<string, unknown>> }>;
export type ShopeeAccessCredential = Readonly<{ accessToken: string; shopId: string; accessTokenExpiresAt: string }>;
export interface MarketplaceLifecycleConnectionRepository { getById(connectionId: string): Promise<MarketplaceLifecycleConnection | null>; replaceCredentialEnvelope(input: Readonly<{ connectionId: string; credentialEnvelope: string }>): Promise<void>; markReauthRequired(connectionId: string): Promise<void>; }
export interface MarketplaceCredentialCrypto { encrypt(credential: ShopeeCredential): string; decrypt(envelope: string): ShopeeCredential; }
export type DistributedLockAcquired = Readonly<{ kind: "acquired"; key: string; release(): Promise<void> }>;
export type DistributedLockResult = DistributedLockAcquired | Readonly<{ kind: "busy" }> | Readonly<{ kind: "unavailable" }>;
export interface DistributedLockProvider { acquire(key: string, ttlMs: number): Promise<DistributedLockResult>; }
export interface ShopeeTokenRefreshClient { refreshShopToken(input: Readonly<{ shopId: string; refreshToken: string }>): Promise<Readonly<{ accessToken?: string; refreshToken?: string; expireIn?: number; requestId?: string }>>; }
export interface Clock { now(): Date; }
export type MarketplaceLifecycleErrorCode = "SHOPEE_CONNECTION_NOT_FOUND" | "SHOPEE_CONNECTION_PLATFORM_INVALID" | "SHOPEE_CONNECTION_NOT_ACTIVE" | "SHOPEE_REAUTH_REQUIRED" | "SHOPEE_CREDENTIAL_MISSING" | "SHOPEE_CREDENTIAL_INVALID" | "SHOPEE_CREDENTIAL_SHOP_MISMATCH" | "SHOPEE_REFRESH_TOKEN_EXPIRED" | "SHOPEE_REFRESH_LOCK_UNAVAILABLE" | "SHOPEE_REFRESH_LOCK_BUSY" | "SHOPEE_REFRESH_FAILED" | "SHOPEE_REFRESH_RESPONSE_INVALID" | "SHOPEE_CREDENTIAL_PERSIST_FAILED" | "EXTERNAL_ACCESS_TOKEN_EXPIRED" | "EXTERNAL_TOKEN_REFRESH_FORBIDDEN";
export class MarketplaceLifecycleError extends Error { constructor(public readonly code: MarketplaceLifecycleErrorCode, public readonly retryable: boolean, public readonly requestId?: string) { super(code); this.name = "MarketplaceLifecycleError"; } toJSON(): object { return { name: this.name, code: this.code, retryable: this.retryable, ...(this.requestId ? { requestId: this.requestId } : {}) }; } }
