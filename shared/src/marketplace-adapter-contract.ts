export type MarketplaceSupportedPlatform = "SHOPEE" | "LAZADA" | "TIKTOK";
export type NormalizedMarketplaceOrderItem = { externalItemId?: string; sellerSku?: string; platformSku?: string; productName?: string; variationName?: string; quantity?: number; unitPrice?: string };
export type NormalizedMarketplaceOrder = { marketplaceOrderId: string; rawProviderStatus?: string; providerCreatedAt?: string; providerUpdatedAt?: string; currency?: string; items?: NormalizedMarketplaceOrderItem[]; providerMetadata?: Record<string, unknown> };
export type MarketplaceAdapterAuthorizationInput = { redirectUri: string; state: string };
export type MarketplaceAdapterAuthorizationResult = { authorizationUrl: string };
export type MarketplaceAdapterAuthorizationCodeInput = { authorizationCode: string; redirectUri: string };
export type MarketplaceAdapterConnectionIdentity = { externalShopId: string; shopName?: string };
/** Identity-only execution context. Provider adapters resolve credentials internally. */
export type MarketplaceAdapterContext = Readonly<{ connectionId: string; platform: MarketplaceSupportedPlatform; externalShopId: string; syncRunId: string }>;
/** Provider-neutral input; checkpoints are opaque to generic orchestration. */
export type MarketplaceAdapterSyncInput = Readonly<{ syncType: "INITIAL" | "INCREMENTAL"; windowStart?: Date | null; windowEnd?: Date | null; committedCheckpoint?: string | null }>;
export type MarketplaceAdapterOrder = Readonly<{ marketplaceOrderId: string; rawOrderCode: string; rawData: Record<string, unknown>; normalizedData: NormalizedMarketplaceOrder; providerUpdatedAt: string }>;
export type MarketplaceAdapterSyncResult = Readonly<{ orders: ReadonlyArray<MarketplaceAdapterOrder>; candidateCheckpoint?: string | null }>;

export interface MarketplaceAdapter {
  readonly platform: MarketplaceSupportedPlatform;
  getAuthorizationUrl(input: MarketplaceAdapterAuthorizationInput): Promise<MarketplaceAdapterAuthorizationResult>;
  exchangeAuthorizationCode(input: MarketplaceAdapterAuthorizationCodeInput): Promise<{ connection: MarketplaceAdapterConnectionIdentity }>;
  refreshAccessToken(context: MarketplaceAdapterContext): Promise<void>;
  validateConnection(context: MarketplaceAdapterContext): Promise<MarketplaceAdapterConnectionIdentity>;
  /** The provider owns list/detail/pagination; the Worker owns persistence and checkpoint commit. */
  syncOrders(context: MarketplaceAdapterContext, input: MarketplaceAdapterSyncInput): Promise<MarketplaceAdapterSyncResult>;
}
