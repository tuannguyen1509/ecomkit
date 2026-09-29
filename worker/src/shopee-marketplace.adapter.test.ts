import { strict as assert } from "node:assert";
import type { MarketplaceAdapter, MarketplaceAdapterContext } from "@ecomkit/shared";
import { decodeShopeeSyncCheckpoint, encodeShopeeSyncCheckpoint, ShopeeOrderClientCore, ShopeeOrderClientError, type ShopeeOrderDetail, type ShopeeOrderTransport } from "@ecomkit/marketplace-server";
import { ShopeeAdapter, ShopeeAdapterError } from "./shopee-marketplace.adapter.js";

const credential = { accessToken: "TEST_ACCESS_TOKEN_SECRET", shopId: "900003", accessTokenExpiresAt: "2030-01-01T00:00:00.000Z" };
const originalOverlap = process.env.SHOPEE_INCREMENTAL_OVERLAP_SECONDS;
delete process.env.SHOPEE_INCREMENTAL_OVERLAP_SECONDS;
const context: MarketplaceAdapterContext = { connectionId: "connection", platform: "SHOPEE", externalShopId: "900003", syncRunId: "run" };
const detail = (order_sn: string, update_time = 15_000): ShopeeOrderDetail => ({ order_sn, order_status: "COMPLETED", create_time: 9_000, update_time, currency: "VND", total_amount: 999_999, recipient_address: { name: "N*** A", phone: "09***123" }, item_list: [{ order_item_id: 1, item_name: "Synthetic", model_sku: "SKU", model_quantity_purchased: 2, model_discounted_price: 123 }] });
const core = (transport: ShopeeOrderTransport) => new ShopeeOrderClientCore({ ensureValidAccessToken: async () => credential }, transport);
const initialInput = { syncType: "INITIAL" as const, windowStart: new Date(10_000_000), windowEnd: new Date(20_000_000) };

const listRequests: Array<Parameters<ShopeeOrderTransport["list"]>[1]> = [];
let detailCalls = 0;
const successTransport: ShopeeOrderTransport = {
  list: async (_credential, input) => { listRequests.push(input); return { orders: [{ order_sn: "A" }, { order_sn: "B" }, { order_sn: "C" }], more: false }; },
  details: async (_credential, ids) => { detailCalls++; return { orders: [...ids].reverse().map((id) => detail(id)) }; },
};
const adapter = new ShopeeAdapter(core(successTransport));
const compatible: MarketplaceAdapter = adapter;
assert.equal(compatible.platform, "SHOPEE");
const basic = await adapter.syncOrders(context, initialInput);
assert.equal(basic.orders.length, 3); assert.equal(listRequests[0]?.timeRangeField, "create_time"); assert.equal(detailCalls, 1);
assert.deepEqual(decodeShopeeSyncCheckpoint(basic.candidateCheckpoint), { v: 1, updatedThrough: 20_000 });
assert.equal(basic.orders[0]?.marketplaceOrderId, "A"); assert.equal(basic.orders[0]?.rawOrderCode, "A"); assert.equal(basic.orders[0]?.providerUpdatedAt, "1970-01-01T04:10:00.000Z");
assert.equal(basic.orders[0]?.rawData.order_sn, "A"); assert.equal(basic.orders[0]?.normalizedData.rawProviderStatus, "COMPLETED"); assert.notDeepEqual(basic.orders[0]?.rawData, basic.orders[0]?.normalizedData);

let providerCalls = 0;
const neverTransport: ShopeeOrderTransport = { list: async () => { providerCalls++; return { orders: [], more: false }; }, details: async () => { providerCalls++; return { orders: [] }; } };
await assert.rejects(() => new ShopeeAdapter(core(neverTransport)).syncOrders(context, { syncType: "INITIAL" }));
await assert.rejects(() => new ShopeeAdapter(core(neverTransport)).syncOrders(context, { syncType: "INCREMENTAL", windowEnd: initialInput.windowEnd }));
await assert.rejects(() => new ShopeeAdapter(core(neverTransport)).syncOrders(context, { syncType: "INCREMENTAL", windowEnd: initialInput.windowEnd, committedCheckpoint: "not-json" }));
await assert.rejects(() => new ShopeeAdapter(core(neverTransport)).syncOrders({ ...context, platform: "LAZADA" }, initialInput), ShopeeAdapterError);
assert.equal(providerCalls, 0);

const incrementalRequests: Array<Parameters<ShopeeOrderTransport["list"]>[1]> = [];
const emptyTransport: ShopeeOrderTransport = { list: async (_credential, input) => { incrementalRequests.push(input); return { orders: [], more: false }; }, details: async () => { throw new Error("details must not run for empty list"); } };
const emptyInitial = await new ShopeeAdapter(core(emptyTransport)).syncOrders(context, initialInput);
assert.deepEqual(emptyInitial.orders, []); assert.equal(decodeShopeeSyncCheckpoint(emptyInitial.candidateCheckpoint).updatedThrough, 20_000);
incrementalRequests.length = 0;
const incremental = await new ShopeeAdapter(core(emptyTransport)).syncOrders(context, { syncType: "INCREMENTAL", windowEnd: new Date(20_000_000), committedCheckpoint: encodeShopeeSyncCheckpoint(10_000) });
assert.deepEqual(incrementalRequests[0], { timeRangeField: "update_time", timeFrom: 9_700, timeTo: 20_000, pageSize: 100, cursor: undefined });
assert.deepEqual(incremental.orders, []); assert.equal(decodeShopeeSyncCheckpoint(incremental.candidateCheckpoint).updatedThrough, 20_000);
incrementalRequests.length = 0;
await new ShopeeAdapter(core(emptyTransport), undefined, 120).syncOrders(context, { syncType: "INCREMENTAL", windowEnd: new Date(20_000_000), committedCheckpoint: encodeShopeeSyncCheckpoint(10_000) });
assert.equal(incrementalRequests[0]?.timeFrom, 9_880, "custom overlap must be delegated to the shared resolver");

let multiListCalls = 0;
const multiTransport: ShopeeOrderTransport = {
  list: async (_credential, input) => { multiListCalls++; return input.cursor ? { orders: [{ order_sn: "B" }], more: false } : { orders: [{ order_sn: "A" }, { order_sn: "A" }], more: true, nextCursor: "OPAQUE" }; },
  details: async (_credential, ids) => ({ orders: ids.map((id) => detail(id)) }),
};
const multi = await new ShopeeAdapter(core(multiTransport)).syncOrders(context, { syncType: "INITIAL", windowStart: new Date(0), windowEnd: new Date(16 * 86_400_000) });
assert.equal(multiListCalls, 4, "two pages across two shared-core windows"); assert.deepEqual(multi.orders.map((order) => order.marketplaceOrderId), ["A", "B"]);

for (const count of [1, 50, 51, 120]) {
  let batches = 0;
  const ids = Array.from({ length: count }, (_, index) => `O${index}`);
  const transport: ShopeeOrderTransport = { list: async () => ({ orders: ids.map((order_sn) => ({ order_sn })), more: false }), details: async (_credential, batch) => { batches++; return { orders: [...batch].reverse().map((id) => detail(id)) }; } };
  const result = await new ShopeeAdapter(core(transport)).syncOrders(context, initialInput);
  assert.equal(batches, Math.ceil(count / 50)); assert.deepEqual(result.orders.map((order) => order.marketplaceOrderId), ids);
}

const failure = async (transport: ShopeeOrderTransport) => assert.rejects(() => new ShopeeAdapter(core(transport)).syncOrders(context, initialInput));
await failure({ list: async () => ({ orders: [{ order_sn: "A" }, { order_sn: "B" }], more: false }), details: async () => ({ orders: [detail("A")] }) });
await failure({ list: async () => ({ orders: [{ order_sn: "A" }], more: false }), details: async () => ({ orders: [detail("A"), detail("A")] }) });
await failure({ list: async () => ({ orders: [{ order_sn: "A" }], more: false }), details: async () => ({ orders: [detail("A"), detail("B")] }) });
await failure({ list: async () => ({ orders: [{}], more: false }), details: async () => ({ orders: [] }) });
await failure({ list: async () => ({ orders: [{ order_sn: "A" }], more: false }), details: async () => ({ orders: [{ ...detail("A"), update_time: undefined }] }) });
await failure({ list: async () => ({ orders: [{ order_sn: "A" }], more: false }), details: async () => ({ orders: [{ ...detail("A"), accessToken: "TEST_ACCESS_TOKEN_SECRET" }] }) });

for (const providerError of [new ShopeeOrderClientError("SHOPEE_ORDER_PROVIDER_TRANSIENT", true, "REQ"), new ShopeeOrderClientError("SHOPEE_ORDER_PROVIDER_AUTH", false, "REQ")]) {
  const failing = new ShopeeAdapter(core({ list: async () => { throw providerError; }, details: async () => ({ orders: [] }) }));
  await assert.rejects(() => failing.syncOrders(context, initialInput), (error: unknown) => error === providerError && !JSON.stringify(error).includes("TEST_ACCESS_TOKEN_SECRET"));
}

const old = await new ShopeeAdapter(core({ list: async () => ({ orders: [{ order_sn: "OLD" }], more: false }), details: async () => ({ orders: [detail("OLD", 1)] }) })).syncOrders(context, initialInput);
assert.equal(old.orders[0]?.providerUpdatedAt, "1970-01-01T00:00:01.000Z", "adapter must not stale-filter provider records");
if (originalOverlap === undefined) delete process.env.SHOPEE_INCREMENTAL_OVERLAP_SECONDS; else process.env.SHOPEE_INCREMENTAL_OVERLAP_SECONDS = originalOverlap;
console.log("offline Shopee marketplace adapter tests passed");
