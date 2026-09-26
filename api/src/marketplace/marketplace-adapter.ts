import type { Platform } from "@ecomkit/database";
import type { MarketplaceShopCredential } from "@ecomkit/shared";

export type MarketplaceAdapterAuthorizationInput = {
  redirectUri: string;
  state: string;
};

export type MarketplaceAdapterAuthorizationResult = {
  authorizationUrl: string;
};

export type MarketplaceAdapterAuthorizationCodeInput = {
  authorizationCode: string;
  redirectUri: string;
};

export type MarketplaceAdapterConnectionIdentity = {
  externalShopId: string;
  shopName?: string;
};

export type MarketplaceAdapterOrderListInput = {
  cursor?: string | null;
  windowStart?: Date;
  windowEnd?: Date;
};

export type MarketplaceAdapterOrderPage = {
  orders: ReadonlyArray<Record<string, unknown>>;
  nextCursor?: string | null;
};

export interface MarketplaceAdapter {
  readonly platform: Exclude<Platform, "UNKNOWN">;
  getAuthorizationUrl(input: MarketplaceAdapterAuthorizationInput): Promise<MarketplaceAdapterAuthorizationResult>;
  exchangeAuthorizationCode(input: MarketplaceAdapterAuthorizationCodeInput): Promise<{
    credential: MarketplaceShopCredential;
    connection: MarketplaceAdapterConnectionIdentity;
  }>;
  refreshAccessToken(credential: MarketplaceShopCredential): Promise<MarketplaceShopCredential>;
  validateConnection(credential: MarketplaceShopCredential): Promise<MarketplaceAdapterConnectionIdentity>;
  listOrders(credential: MarketplaceShopCredential, input: MarketplaceAdapterOrderListInput): Promise<MarketplaceAdapterOrderPage>;
  getOrderDetail(credential: MarketplaceShopCredential, marketplaceOrderId: string): Promise<Record<string, unknown>>;
}
