import assert from "node:assert/strict";
import { test } from "node:test";
import { Platform } from "@ecomkit/database";
import type { MarketplaceAdapter } from "@ecomkit/shared";
import { ShopeeOrderClientError } from "@ecomkit/marketplace-server";
import { createWorkerMarketplaceAdapterRegistry, WorkerMarketplaceAdapterRegistry, WorkerMarketplaceAdapterRegistryError } from "./marketplace-adapter.registry.js";
import { ShopeeAdapter } from "./shopee-marketplace.adapter.js";
import { WorkerShopeeOrderTransport } from "./shopee-order.worker.js";

function fakeAdapter(platform: "SHOPEE" | "LAZADA" = "SHOPEE"): MarketplaceAdapter {
  return {
    platform,
    async getAuthorizationUrl() { return { authorizationUrl: "https://example.invalid" }; },
    async exchangeAuthorizationCode() { return { connection: { externalShopId: "test-shop" } }; },
    async refreshAccessToken() {},
    async validateConnection() { return { externalShopId: "test-shop" }; },
    async syncOrders() { return { orders: [] }; },
  };
}

test("production registry registers SHOPEE lazily and caches its V2 adapter", () => {
  let constructions = 0;
  const adapter = fakeAdapter();
  const registry = createWorkerMarketplaceAdapterRegistry({ enableMockAdapter: false, shopeeFactory: () => { constructions++; return adapter; } });
  assert.equal(constructions, 0);
  assert.equal(registry.resolve(Platform.SHOPEE), adapter);
  assert.equal(registry.resolve(Platform.SHOPEE), adapter);
  assert.equal(constructions, 1);
});

test("production registry registers LAZADA lazily without resolving provider config", () => {
  let constructions = 0;
  const adapter = fakeAdapter("LAZADA");
  const registry = createWorkerMarketplaceAdapterRegistry({ enableMockAdapter: false, lazadaFactory: () => { constructions++; return adapter; } });
  assert.equal(constructions, 0);
  assert.equal(registry.resolve(Platform.LAZADA), adapter);
  assert.equal(registry.resolve(Platform.LAZADA), adapter);
  assert.equal(constructions, 1);
});

test("real production Shopee adapter resolves without config, provider I/O, or refresh", () => {
  const previousId = process.env.SHOPEE_PARTNER_ID;
  const previousKey = process.env.SHOPEE_PARTNER_KEY;
  delete process.env.SHOPEE_PARTNER_ID;
  delete process.env.SHOPEE_PARTNER_KEY;
  try {
    const registry = createWorkerMarketplaceAdapterRegistry({ enableMockAdapter: false });
    const adapter = registry.resolve(Platform.SHOPEE);
    assert.ok(adapter instanceof ShopeeAdapter);
  } finally {
    if (previousId === undefined) delete process.env.SHOPEE_PARTNER_ID; else process.env.SHOPEE_PARTNER_ID = previousId;
    if (previousKey === undefined) delete process.env.SHOPEE_PARTNER_KEY; else process.env.SHOPEE_PARTNER_KEY = previousKey;
  }
});

test("missing Shopee app config fails safely before HTTP", async () => {
  const previousId = process.env.SHOPEE_PARTNER_ID;
  const previousKey = process.env.SHOPEE_PARTNER_KEY;
  delete process.env.SHOPEE_PARTNER_ID;
  delete process.env.SHOPEE_PARTNER_KEY;
  try {
    const transport = new WorkerShopeeOrderTransport();
    await assert.rejects(
      transport.list({ accessToken: "TEST_ACCESS_TOKEN_SECRET", shopId: "1", accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString() }, { timeRangeField: "create_time", timeFrom: 1, timeTo: 2, pageSize: 1 }),
      (error: unknown) => error instanceof ShopeeOrderClientError && error.code === "SHOPEE_CONFIG_MISSING" && error.retryable === false && !JSON.stringify(error).includes("TEST_ACCESS_TOKEN_SECRET"),
    );
  } finally {
    if (previousId === undefined) delete process.env.SHOPEE_PARTNER_ID; else process.env.SHOPEE_PARTNER_ID = previousId;
    if (previousKey === undefined) delete process.env.SHOPEE_PARTNER_KEY; else process.env.SHOPEE_PARTNER_KEY = previousKey;
  }
});

test("unsupported platforms remain deterministic and mock wiring remains explicit", () => {
  const empty = new WorkerMarketplaceAdapterRegistry();
  assert.throws(() => empty.resolve(Platform.UNKNOWN), (error: unknown) => error instanceof WorkerMarketplaceAdapterRegistryError && error.code === "MARKETPLACE_ADAPTER_NOT_REGISTERED");
  let mockConstructions = 0;
  const mock = fakeAdapter();
  const registry = createWorkerMarketplaceAdapterRegistry({ enableMockAdapter: true, mockFactory: () => { mockConstructions++; return mock; } });
  assert.equal(mockConstructions, 0);
  assert.equal(registry.resolve(Platform.SHOPEE), mock);
  assert.equal(mockConstructions, 1);
});
