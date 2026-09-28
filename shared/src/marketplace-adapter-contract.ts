export type MarketplaceSupportedPlatform = "SHOPEE" | "LAZADA" | "TIKTOK";
export type NormalizedMarketplaceOrderItem = { externalItemId?: string; sellerSku?: string; platformSku?: string; productName?: string; variationName?: string; quantity?: number; unitPrice?: string };
export type NormalizedMarketplaceOrder = { marketplaceOrderId: string; rawProviderStatus?: string; providerCreatedAt?: string; providerUpdatedAt?: string; currency?: string; items?: NormalizedMarketplaceOrderItem[]; providerMetadata?: Record<string, unknown> };
export type MarketplaceAdapterAuthorizationInput = { redirectUri: string; state: string };
export type MarketplaceAdapterAuthorizationResult = { authorizationUrl: string };
export type MarketplaceAdapterAuthorizationCodeInput = { authorizationCode: string; redirectUri: string };
export type MarketplaceAdapterConnectionIdentity = { externalShopId: string; shopName?: string };
/** Identity-only execution context. Provider adapters resolve credentials internally. */
export type MarketplaceAdapterContext = Readonly<{ connectionId: string; platform: MarketplaceSupportedPlatform; externalShopId: string; syncRunId: string }>;
export type MarketplaceAdapterOrderListInput = { cursor?: string | null; windowStart?: Date; windowEnd?: Date };
export type MarketplaceAdapterOrderPage = { orders: ReadonlyArray<NormalizedMarketplaceOrder>; nextCursor?: string | null };

export interface MarketplaceAdapter {
  readonly platform: MarketplaceSupportedPlatform;
  getAuthorizationUrl(input: MarketplaceAdapterAuthorizationInput): Promise<MarketplaceAdapterAuthorizationResult>;
  exchangeAuthorizationCode(input: MarketplaceAdapterAuthorizationCodeInput): Promise<{ connection: MarketplaceAdapterConnectionIdentity }>;
  refreshAccessToken(context: MarketplaceAdapterContext): Promise<void>;
  validateConnection(context: MarketplaceAdapterContext): Promise<MarketplaceAdapterConnectionIdentity>;
  listOrders(context: MarketplaceAdapterContext, input: MarketplaceAdapterOrderListInput): Promise<MarketplaceAdapterOrderPage>;
  getOrderDetail(context: MarketplaceAdapterContext, marketplaceOrderId: string): Promise<Record<string, unknown>>;
}
