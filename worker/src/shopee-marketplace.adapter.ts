import type { MarketplaceAdapter, MarketplaceAdapterContext, MarketplaceAdapterSyncInput, MarketplaceAdapterSyncResult } from "@ecomkit/shared";
import { resolveShopeeIncrementalOverlapSeconds, resolveShopeeSyncWindow, ShopeeNormalizer, type ShopeeOrderClientCore } from "@ecomkit/marketplace-server";

type ShopeeOrderOperations = Pick<ShopeeOrderClientCore, "collectOrderSns" | "getCompleteOrderDetails">;

export class ShopeeAdapterError extends Error {
  readonly retryable = false;
  constructor(public readonly code: "SHOPEE_ADAPTER_PLATFORM_INVALID" | "SHOPEE_ADAPTER_OPERATION_UNSUPPORTED" | "SHOPEE_ADAPTER_SECRET_DATA_INVALID" | "SHOPEE_ADAPTER_PROVIDER_UPDATED_AT_INVALID") {
    super(code);
    this.name = "ShopeeAdapterError";
  }
  toJSON() { return { name: this.name, code: this.code, retryable: false }; }
}

const secretKeys = new Set(["accesstoken", "access_token", "refreshtoken", "refresh_token", "partnerkey", "partner_key", "credentialenvelope", "credential_envelope", "sign", "signature"]);
function containsSecretField(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => secretKeys.has(key.toLowerCase()) || containsSecretField(child));
}
function isJsonSafe(value: unknown): boolean { try { JSON.stringify(value); return true; } catch { return false; } }

export class ShopeeAdapter implements MarketplaceAdapter {
  readonly platform = "SHOPEE" as const;

  constructor(
    private readonly orderClient: ShopeeOrderOperations,
    private readonly normalizer = new ShopeeNormalizer(),
    private readonly overlapSeconds = resolveShopeeIncrementalOverlapSeconds(process.env.SHOPEE_INCREMENTAL_OVERLAP_SECONDS),
  ) {}

  async getAuthorizationUrl(): Promise<never> { throw new ShopeeAdapterError("SHOPEE_ADAPTER_OPERATION_UNSUPPORTED"); }
  async exchangeAuthorizationCode(): Promise<never> { throw new ShopeeAdapterError("SHOPEE_ADAPTER_OPERATION_UNSUPPORTED"); }
  async refreshAccessToken(): Promise<void> { throw new ShopeeAdapterError("SHOPEE_ADAPTER_OPERATION_UNSUPPORTED"); }
  async validateConnection(context: MarketplaceAdapterContext) { this.assertPlatform(context); return { externalShopId: context.externalShopId }; }

  async syncOrders(context: MarketplaceAdapterContext, input: MarketplaceAdapterSyncInput): Promise<MarketplaceAdapterSyncResult> {
    this.assertPlatform(context);
    const window = resolveShopeeSyncWindow({ ...input, overlapSeconds: this.overlapSeconds });
    const orderSns = await this.orderClient.collectOrderSns(context.connectionId, { timeRangeField: window.timeRangeField, timeFrom: window.timeFrom, timeTo: window.timeTo });
    if (!orderSns.length) return { orders: [], candidateCheckpoint: window.candidateCheckpoint };
    const details = await this.orderClient.getCompleteOrderDetails(context.connectionId, orderSns);
    const orders = details.map((detail) => {
      if (!isJsonSafe(detail) || containsSecretField(detail)) throw new ShopeeAdapterError("SHOPEE_ADAPTER_SECRET_DATA_INVALID");
      const normalizedData = this.normalizer.normalize(detail);
      if (!normalizedData.providerUpdatedAt) throw new ShopeeAdapterError("SHOPEE_ADAPTER_PROVIDER_UPDATED_AT_INVALID");
      return {
        marketplaceOrderId: normalizedData.marketplaceOrderId,
        rawOrderCode: normalizedData.rawOrderCode,
        rawData: detail,
        normalizedData,
        providerUpdatedAt: normalizedData.providerUpdatedAt,
      };
    });
    return { orders, candidateCheckpoint: window.candidateCheckpoint };
  }

  private assertPlatform(context: MarketplaceAdapterContext): void {
    if (context.platform !== "SHOPEE") throw new ShopeeAdapterError("SHOPEE_ADAPTER_PLATFORM_INVALID");
  }
}
