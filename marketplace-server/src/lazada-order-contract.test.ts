import assert from "node:assert/strict";
import test from "node:test";
import {
  LAZADA_GET_ORDERS_LIMIT_MAX, LAZADA_GET_ORDERS_OFFSET_MAX, LAZADA_MULTIPLE_ORDER_ITEMS_MAX,
  LAZADA_ORDER_ENDPOINTS, LazadaOrderContractError, parseLazadaGetOrderEnvelope,
  parseLazadaGetOrderItemsEnvelope, parseLazadaGetOrdersEnvelope, parseLazadaGetMultipleOrderItemsEnvelope,
} from "./lazada-order-contract.js";
import { LAZADA_GET_ORDER_FIXTURE, LAZADA_GET_ORDER_ITEMS_FIXTURE, LAZADA_GET_ORDERS_FIXTURE, LAZADA_GET_MULTIPLE_ORDER_ITEMS_FIXTURE } from "./lazada-order-fixtures.js";

test("verified endpoint and pagination contracts remain explicit", () => {
  assert.deepEqual(LAZADA_ORDER_ENDPOINTS, { getOrders: "/orders/get", getOrder: "/order/get", getOrderItems: "/order/items/get", getMultipleOrderItems: "/orders/items/get" });
  assert.equal(LAZADA_GET_ORDERS_LIMIT_MAX, 100); assert.equal(LAZADA_GET_ORDERS_OFFSET_MAX, 5000); assert.equal(LAZADA_MULTIPLE_ORDER_ITEMS_MAX, 50);
});

test("parses GetOrders count semantics, mixed statuses, masked and missing PII", () => {
  const parsed = parseLazadaGetOrdersEnvelope(LAZADA_GET_ORDERS_FIXTURE);
  assert.equal(parsed.count, 3); assert.equal(parsed.countTotal, 3); assert.equal(parsed.orders.length, 3);
  assert.deepEqual(parsed.orders[1]!.statuses, ["ready_to_ship", "shipped"]);
  assert.equal((parsed.orders[0]!.address_shipping as Record<string, unknown>).phone, "09****123");
  assert.equal(parsed.orders[2]!.address_shipping, undefined);
});

test("preserves provider IDs beyond Number.MAX_SAFE_INTEGER as strings", () => {
  const parsed = parseLazadaGetOrdersEnvelope(LAZADA_GET_ORDERS_FIXTURE);
  assert.equal(parsed.orders[1]!.order_id, "9007199254740993");
  const items = parseLazadaGetOrderItemsEnvelope(LAZADA_GET_ORDER_ITEMS_FIXTURE);
  assert.equal(items[0]!.order_item_id, "9007199254741001");
});

test("accepts documented safe numeric IDs but rejects precision-lost numeric IDs", () => {
  const parsed = parseLazadaGetOrderEnvelope({ ...LAZADA_GET_ORDER_FIXTURE, data: { ...LAZADA_GET_ORDER_FIXTURE.data, order_id: 16090, order_number: 16090 } });
  assert.equal(parsed.order_id, "16090");
  assert.throws(() => parseLazadaGetOrderEnvelope({ ...LAZADA_GET_ORDER_FIXTURE, data: { ...LAZADA_GET_ORDER_FIXTURE.data, order_id: 9007199254740992 } }), LazadaOrderContractError);
});

test("keeps identical purchased units as distinct item identities", () => {
  const items = parseLazadaGetOrderItemsEnvelope(LAZADA_GET_ORDER_ITEMS_FIXTURE);
  assert.equal(items.length, 2); assert.equal(items[0]!.sku, items[1]!.sku); assert.notEqual(items[0]!.order_item_id, items[1]!.order_item_id);
});

test("parses GetOrder and grouped GetMultipleOrderItems without dropping unknown fields", () => {
  const order = parseLazadaGetOrderEnvelope({ ...LAZADA_GET_ORDER_FIXTURE, data: { ...LAZADA_GET_ORDER_FIXTURE.data, future_provider_field: "preserved" } });
  assert.equal(order.future_provider_field, "preserved");
  const groups = parseLazadaGetMultipleOrderItemsEnvelope(LAZADA_GET_MULTIPLE_ORDER_ITEMS_FIXTURE);
  assert.equal(groups[0]!.order_id, "9007199254740993"); assert.equal(groups[0]!.order_items.length, 2);
});

test("rejects malformed mandatory IDs, timestamps, statuses and response shapes", () => {
  assert.throws(() => parseLazadaGetOrdersEnvelope({ code: "0", data: { count: 1, orders: [{ order_id: "bad", created_at: "x", updated_at: "y", statuses: [] }] } }), LazadaOrderContractError);
  assert.throws(() => parseLazadaGetOrdersEnvelope({ code: "0", data: { count: 1, orders: [{ order_id: "1", created_at: "", updated_at: "y", statuses: [] }] } }), LazadaOrderContractError);
  assert.throws(() => parseLazadaGetOrdersEnvelope({ code: "0", data: { count: 1, orders: [{ order_id: "1", created_at: "x", updated_at: "y", statuses: "pending" }] } }), LazadaOrderContractError);
  assert.throws(() => parseLazadaGetOrderItemsEnvelope({ code: "0", data: {} }), LazadaOrderContractError);
});

console.log("Lazada order API contract fixture tests passed");
