import type { MarketplaceShopCredential } from "./marketplace-credential-crypto";

export type MarketplaceSupportedPlatform = "SHOPEE" | "LAZADA" | "TIKTOK";
export type NormalizedMarketplaceOrderItem = { externalItemId?: string; sellerSku?: string; platformSku?: string; productName?: string; variationName?: string; quantity?: number; unitPrice?: string };
export type NormalizedMarketplaceOrder = { marketplaceOrderId: string; rawProviderStatus?: string; providerCreatedAt?: string; providerUpdatedAt?: string; currency?: string; items?: NormalizedMarketplaceOrderItem[]; providerMetadata?: Record<string, unknown> };
export type MarketplaceAdapterAuthorizationInput = { redirectUri: string; state: string };
export type MarketplaceAdapterAuthorizationResult = { authorizationUrl: string };
export type MarketplaceAdapterAuthorizationCodeInput = { authorizationCode: string; redirectUri: string };
export type MarketplaceAdapterConnectionIdentity = { externalShopId: string; shopName?: string };
export type MarketplaceAdapterOrderListInput = { cursor?: string | null; windowStart?: Date; windowEnd?: Date };
export type MarketplaceAdapterOrderPage = { orders: ReadonlyArray<NormalizedMarketplaceOrder>; nextCursor?: string | null };

export interface MarketplaceAdapter {
  readonly platform: MarketplaceSupportedPlatform;
  readonly requiresCredential: boolean;
  getAuthorizationUrl(input: MarketplaceAdapterAuthorizationInput): Promise<MarketplaceAdapterAuthorizationResult>;
  exchangeAuthorizationCode(input: MarketplaceAdapterAuthorizationCodeInput): Promise<{ credential: MarketplaceShopCredential; connection: MarketplaceAdapterConnectionIdentity }>;
  refreshAccessToken(credential: MarketplaceShopCredential): Promise<MarketplaceShopCredential>;
  validateConnection(credential: MarketplaceShopCredential): Promise<MarketplaceAdapterConnectionIdentity>;
  listOrders(credential: MarketplaceShopCredential | undefined, input: MarketplaceAdapterOrderListInput): Promise<MarketplaceAdapterOrderPage>;
  getOrderDetail(credential: MarketplaceShopCredential | undefined, marketplaceOrderId: string): Promise<Record<string, unknown>>;
}
