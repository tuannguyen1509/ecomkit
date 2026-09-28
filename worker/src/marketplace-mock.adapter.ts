import { Platform } from "@ecomkit/database";
import type { MarketplaceAdapter, MarketplaceAdapterContext, MarketplaceAdapterOrder, MarketplaceAdapterSyncInput, MarketplaceAdapterSyncResult, NormalizedMarketplaceOrder } from "@ecomkit/shared";

export class MarketplaceMockError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean, public readonly httpStatus?: number) {
    super(code);
    this.name = "MarketplaceMockError";
  }
}

const seenTransientConnections = new Set<string>();
const order = (id: string, updatedAt: string, status = "READY"): MarketplaceAdapterOrder => {
  const normalizedData: NormalizedMarketplaceOrder = { marketplaceOrderId: id, rawProviderStatus: status, providerCreatedAt: "2026-01-01T00:00:00.000Z", providerUpdatedAt: updatedAt, currency: "VND", items: [{ externalItemId: `item-${id}`, sellerSku: `SKU-${id}`, productName: `Synthetic item ${id}`, quantity: 1, unitPrice: "0" }] };
  return { marketplaceOrderId: id, rawOrderCode: `RAW-${id}`, rawData: { mockProviderOrderId: id, providerPayloadVersion: "v2", updatedAt }, normalizedData, providerUpdatedAt: updatedAt };
};

export class MarketplaceMockAdapter implements MarketplaceAdapter {
  readonly platform = Platform.SHOPEE;

  async getAuthorizationUrl() { return { authorizationUrl: "https://example.invalid/mock-marketplace" }; }
  async exchangeAuthorizationCode() { return { connection: { externalShopId: "mock-shop" } }; }
  async refreshAccessToken(_context: MarketplaceAdapterContext) {}
  async validateConnection() { return { externalShopId: "mock-shop" }; }
  async syncOrders(_context: MarketplaceAdapterContext, input: MarketplaceAdapterSyncInput): Promise<MarketplaceAdapterSyncResult> {
    const scenario = String(input.committedCheckpoint ?? "mock-success");
    if (!scenario.startsWith("mock-")) throw new MarketplaceMockError("MOCK_CONNECTION_REQUIRED", false, 400);
    if (scenario.startsWith("mock-empty")) return { orders: [], candidateCheckpoint: `complete:${scenario}` };
    if (scenario === "mock-malformed") return { orders: [{ marketplaceOrderId: "", rawOrderCode: "RAW", rawData: {}, normalizedData: { marketplaceOrderId: "" }, providerUpdatedAt: "2026-01-01T00:00:00.000Z" }], candidateCheckpoint: `complete:${scenario}` };
    if (scenario === "mock-partial") throw new MarketplaceMockError("MOCK_PARTIAL_PROVIDER_FAILURE", false, 422);
    if (scenario === "mock-transient") {
      if (!seenTransientConnections.has(scenario)) { seenTransientConnections.add(scenario); throw new MarketplaceMockError("MOCK_TRANSIENT_FAILURE", true, 503); }
      return { orders: [order("TEST-MKT-TRANSIENT-001", "2026-01-03T00:00:00.000Z")], candidateCheckpoint: `complete:${scenario}` };
    }
    if (scenario === "mock-update") return { orders: [order("TEST-MKT-UPDATE-001", "2026-01-03T00:00:00.000Z", "UPDATED")], candidateCheckpoint: `complete:${scenario}` };
    if (scenario === "mock-old-update") return { orders: [order("TEST-MKT-UPDATE-001", "2026-01-01T00:00:00.000Z", "OLD")], candidateCheckpoint: `complete:${scenario}` };
    if (scenario.startsWith("mock-success")) return { orders: [order("TEST-MKT-001", "2026-01-02T00:00:00.000Z"), order("TEST-MKT-002", "2026-01-02T00:00:00.000Z")], candidateCheckpoint: `complete:${scenario}` };
    if (scenario === "mock-replay") return { orders: [order("TEST-MKT-001", "2026-01-02T00:00:00.000Z"), order("TEST-MKT-002", "2026-01-02T00:00:00.000Z")], candidateCheckpoint: `complete:${scenario}` };
    throw new MarketplaceMockError("MOCK_SCENARIO_UNKNOWN", false, 400);
  }
}
