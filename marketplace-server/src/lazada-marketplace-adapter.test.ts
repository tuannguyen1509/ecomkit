import assert from "node:assert/strict";
import type { MarketplaceAdapterContext } from "@ecomkit/shared";
import { LazadaMarketplaceAdapter, LazadaMarketplaceAdapterError, type LazadaOrderOperations } from "./lazada-marketplace-adapter.js";
import { LazadaOrderClientError } from "./lazada-order-client.js";
import type { LazadaMultipleOrderItemsGroup, LazadaRawOrder, LazadaRawOrderItem } from "./lazada-order-contract.js";

const context: MarketplaceAdapterContext = { connectionId: "connection-lazada", platform: "LAZADA", externalShopId: "vn:1", syncRunId: "run-1" };
const start = new Date("2026-09-01T00:00:00.000Z"), end = new Date("2026-09-02T00:00:00.000Z");
const order = (id: string, patch: Partial<LazadaRawOrder> = {}): LazadaRawOrder => ({ order_id: id, created_at: "2026-09-01T01:00:00+00:00", updated_at: "2026-09-01T02:00:00+00:00", statuses: ["pending"], ...patch });
const item = (orderId: string, itemId = `${orderId}1`, patch: Partial<LazadaRawOrderItem> = {}): LazadaRawOrderItem => ({ order_id: orderId, order_item_id: itemId, status: "pending", sku: "SKU", name: "Product", paid_price: "10", ...patch });
const group = (orderId: string, items: readonly LazadaRawOrderItem[] = [item(orderId)]): LazadaMultipleOrderItemsGroup => ({ order_id: orderId, order_items: items });

class FakeOrders implements LazadaOrderOperations {
  listCalls: Array<{ from: string; to: string }> = [];
  itemCalls: string[][] = [];
  constructor(
    readonly list: (from: string, to: string) => Promise<readonly LazadaRawOrder[]>,
    readonly groups: (ids: readonly string[]) => Promise<readonly LazadaMultipleOrderItemsGroup[]> = async (ids) => ids.map((id) => group(id)),
  ) {}
  async listAllOrdersInWindow(input: Parameters<LazadaOrderOperations["listAllOrdersInWindow"]>[0]) {
    this.listCalls.push({ from: input.window.from, to: input.window.to });
    return { orders: await this.list(input.window.from, input.window.to), duplicateOrderIds: [], requestIds: [] };
  }
  async getMultipleOrderItems(connectionId: string, ids: readonly string[]) {
    assert.equal(connectionId, context.connectionId);
    this.itemCalls.push([...ids]);
    return { groups: await this.groups(ids), requestedOrderIds: [...ids] };
  }
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => error instanceof Error && "code" in error && error.code === code);
}

async function main(): Promise<void> {
  // Basic, exact envelope semantics, mixed statuses, repeated units, large IDs, and immutability.
  const largeId = "900719925474099312345";
  const rawOrder = order(largeId, { statuses: ["pending", "ready_to_ship"] });
  const rawItems = [item(largeId, "900719925474099312346"), item(largeId, "900719925474099312347")];
  const beforeOrder = JSON.stringify(rawOrder), beforeItems = JSON.stringify(rawItems);
  const basicOps = new FakeOrders(async () => [rawOrder], async () => [group(largeId, rawItems)]);
  const basic = await new LazadaMarketplaceAdapter(basicOps).syncOrders(context, { syncType: "INITIAL", windowStart: start, windowEnd: end });
  assert.equal(basic.orders.length, 1);
  assert.equal(basic.orders[0]?.marketplaceOrderId, largeId);
  assert.equal(basic.orders[0]?.rawOrderCode, largeId);
  assert.equal(basic.orders[0]?.normalizedData.rawProviderStatus, undefined);
  assert.deepEqual(basic.orders[0]?.normalizedData.providerMetadata?.providerStatuses, ["pending", "ready_to_ship"]);
  assert.equal(basic.orders[0]?.normalizedData.items?.length, 2);
  assert.equal("candidateCheckpoint" in basic, false);
  assert.equal(JSON.stringify(rawOrder), beforeOrder); assert.equal(JSON.stringify(rawItems), beforeItems);

  // Empty windows do not call item API.
  const emptyOps = new FakeOrders(async () => []);
  assert.deepEqual(await new LazadaMarketplaceAdapter(emptyOps).syncOrders(context, { syncType: "INITIAL", windowStart: start, windowEnd: end }), { orders: [] });
  assert.equal(emptyOps.itemCalls.length, 0);

  // 120 orders are item-batched 50/50/20, without N+1 detail calls.
  const many = Array.from({ length: 120 }, (_, index) => order(String(index + 1)));
  const batchingOps = new FakeOrders(async () => many);
  const batching = await new LazadaMarketplaceAdapter(batchingOps).syncOrders(context, { syncType: "INITIAL", windowStart: start, windowEnd: end });
  assert.equal(batching.orders.length, 120);
  assert.deepEqual(batchingOps.itemCalls.map((ids) => ids.length), [50, 50, 20]);

  // A large parent and one large child split earlier-first; inclusive midpoint duplicates deduplicate.
  const splitOps = new FakeOrders(async (from, to) => {
    const duration = Date.parse(to) - Date.parse(from);
    if (duration > 6_000) throw new LazadaOrderClientError("LAZADA_WINDOW_TOO_LARGE");
    const midpointOrder = order("77", { created_at: new Date(start.getTime() + 6_000).toISOString() });
    return Date.parse(from) === start.getTime() ? [order("1"), midpointOrder] : [midpointOrder, order("2")];
  });
  const splitEnd = new Date(start.getTime() + 12_000);
  const split = await new LazadaMarketplaceAdapter(splitOps).syncOrders(context, { syncType: "INITIAL", windowStart: start, windowEnd: splitEnd });
  assert.deepEqual(split.orders.map((entry) => entry.marketplaceOrderId), ["1", "77", "2"]);
  assert.equal(splitOps.listCalls.length, 3);
  assert.equal(splitOps.listCalls[1]?.from, start.toISOString());

  const multiLevelOps = new FakeOrders(async (from, to) => {
    if (Date.parse(to) - Date.parse(from) > 3_000) throw new LazadaOrderClientError("LAZADA_WINDOW_TOO_LARGE");
    return [];
  });
  await new LazadaMarketplaceAdapter(multiLevelOps).syncOrders(context, { syncType: "INITIAL", windowStart: start, windowEnd: splitEnd });
  assert.equal(multiLevelOps.listCalls.length, 7);

  // Smallest whole-second interval cannot split and never truncates.
  const tooLarge = new FakeOrders(async () => { throw new LazadaOrderClientError("LAZADA_WINDOW_TOO_LARGE"); });
  await expectCode(() => new LazadaMarketplaceAdapter(tooLarge).syncOrders(context, { syncType: "INITIAL", windowStart: start, windowEnd: new Date(start.getTime() + 1_000) }), "LAZADA_WINDOW_UNSPLITTABLE");

  // Completeness: missing, extra, duplicate groups all fail before normalization.
  const two = async () => [order("1"), order("2")];
  await expectCode(() => new LazadaMarketplaceAdapter(new FakeOrders(two, async () => [group("1")])).syncOrders(context, { syncType: "INITIAL", windowStart: start, windowEnd: end }), "LAZADA_ITEM_GROUP_MISSING");
  await expectCode(() => new LazadaMarketplaceAdapter(new FakeOrders(two, async () => [group("1"), group("2"), group("3")])).syncOrders(context, { syncType: "INITIAL", windowStart: start, windowEnd: end }), "LAZADA_ITEM_GROUP_UNEXPECTED");
  await expectCode(() => new LazadaMarketplaceAdapter(new FakeOrders(two, async () => [group("1"), group("1"), group("2")])).syncOrders(context, { syncType: "INITIAL", windowStart: start, windowEnd: end }), "LAZADA_ITEM_GROUP_DUPLICATE");

  // Normalizer failures are propagated; no partial success is returned.
  await expectCode(() => new LazadaMarketplaceAdapter(new FakeOrders(async () => [order("1")], async () => [group("1", [item("2")])])).syncOrders(context, { syncType: "INITIAL", windowStart: start, windowEnd: end }), "LAZADA_NORMALIZATION_ITEM_ORDER_MISMATCH");
  await expectCode(() => new LazadaMarketplaceAdapter(new FakeOrders(async () => [order("1")], async () => [group("1", [item("1", "11"), item("1", "11")])])).syncOrders(context, { syncType: "INITIAL", windowStart: start, windowEnd: end }), "LAZADA_NORMALIZATION_DUPLICATE_ITEM");
  await expectCode(() => new LazadaMarketplaceAdapter(new FakeOrders(async () => [order("1")], async () => [group("1", [item("1", "11", { paid_price: "bad" })])])).syncOrders(context, { syncType: "INITIAL", windowStart: start, windowEnd: end }), "LAZADA_NORMALIZATION_VALUE_INVALID");

  // Conflicting duplicate policy: newer provider snapshot wins; equal timestamp conflict fails.
  const older = order("8", { updated_at: "2026-09-01T01:00:00Z", statuses: ["pending"] });
  const newer = order("8", { updated_at: "2026-09-01T03:00:00Z", statuses: ["ready_to_ship"] });
  const newerResult = await new LazadaMarketplaceAdapter(new FakeOrders(async () => [older, newer])).syncOrders(context, { syncType: "INITIAL", windowStart: start, windowEnd: end });
  assert.equal(newerResult.orders[0]?.normalizedData.rawProviderStatus, "ready_to_ship");
  await expectCode(() => new LazadaMarketplaceAdapter(new FakeOrders(async () => [order("9", { statuses: ["a"] }), order("9", { statuses: ["b"] })])).syncOrders(context, { syncType: "INITIAL", windowStart: start, windowEnd: end }), "LAZADA_DUPLICATE_ORDER_CONFLICT");

  // Incremental and invalid windows reject before token/provider access.
  const never = new FakeOrders(async () => { throw new Error("must not call"); });
  await expectCode(() => new LazadaMarketplaceAdapter(never).syncOrders(context, { syncType: "INCREMENTAL" }), "LAZADA_INCREMENTAL_NOT_READY");
  assert.equal(never.listCalls.length, 0); assert.equal(never.itemCalls.length, 0);
  await expectCode(() => new LazadaMarketplaceAdapter(never).syncOrders(context, { syncType: "INITIAL" }), "LAZADA_INITIAL_WINDOW_REQUIRED");

  // Lifecycle errors (including EXTERNAL expiry) pass through unchanged; valid external/OAuth credentials remain OrderClient concerns.
  const externalExpired = Object.assign(new Error("EXTERNAL_ACCESS_TOKEN_EXPIRED"), { code: "EXTERNAL_ACCESS_TOKEN_EXPIRED", retryable: false });
  const lifecycleOps = new FakeOrders(async () => { throw externalExpired; });
  await assert.rejects(() => new LazadaMarketplaceAdapter(lifecycleOps).syncOrders(context, { syncType: "INITIAL", windowStart: start, windowEnd: end }), (error) => error === externalExpired);

  console.log("Lazada marketplace adapter tests passed");
}

void main();
