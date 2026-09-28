import { strict as assert } from "node:assert";
import { ShopeeOrderClientCore, ShopeeOrderClientError } from "@ecomkit/marketplace-server";
import type { ShopeeResponse } from "@ecomkit/shared";
import { createWorkerShopeeOrderClient, WorkerShopeeOrderTransport, type WorkerShopeeOrderShopClient } from "./shopee-order.worker.js";

const credential = { accessToken: "TEST_ACCESS_TOKEN_SECRET", shopId: "900003", accessTokenExpiresAt: "2030-01-01T00:00:00.000Z" };
const requests: Array<{ apiPath: string; query: Record<string, unknown>; accessToken: string }> = [];
let listPage = 0;
let detailCalls = 0;
const clientFactory = (): WorkerShopeeOrderShopClient => ({
  requestShop: async <T>(request: Parameters<WorkerShopeeOrderShopClient["requestShop"]>[0]) => {
    requests.push({ apiPath: request.apiPath, query: request.query, accessToken: request.accessToken });
    if (request.apiPath.endsWith("get_order_list")) {
      listPage++;
      return (listPage % 2 === 1
        ? { response: { more: true, next_cursor: "OPAQUE_CURSOR", order_list: [{ order_sn: "A" }, { order_sn: "A" }] } }
        : { response: { more: false, order_list: [{ order_sn: "B" }] } }) as ShopeeResponse<T>;
    }
    detailCalls++;
    const ids = String(request.query.order_sn_list).split(",");
    return { response: { order_list: [...ids].reverse().map((order_sn) => ({ order_sn, item_list: [] })) } } as ShopeeResponse<T>;
  },
});

const worker = createWorkerShopeeOrderClient({ lifecycle: { ensureValidAccessToken: async () => credential } as never, clientFactory });
const single = await worker.client.listOrders("connection", { timeRangeField: "create_time", timeFrom: 0, timeTo: 15 * 86400, pageSize: 100, cursor: "INPUT_CURSOR" });
assert.equal(single.more, true); assert.equal(single.nextCursor, "OPAQUE_CURSOR"); assert.equal(requests.length, 1); assert.equal(requests[0]?.query.cursor, "INPUT_CURSOR");

listPage = 0;
const collected = await worker.client.collectOrderSns("connection", { timeRangeField: "update_time", timeFrom: 0, timeTo: 16 * 86400 });
assert.deepEqual(collected, ["A", "B"]);

detailCalls = 0;
const details = await worker.client.getOrderDetails("connection", ["A", "B", "C"]);
assert.deepEqual(details.orders.map((detail) => detail.order_sn), ["C", "B", "A"]); assert.deepEqual(details.missingOrderSns, []);
await worker.client.getCompleteOrderDetails("connection", Array.from({ length: 120 }, (_, index) => `O${index}`));
assert.equal(detailCalls, 4, "one compatibility batch plus 3 strict batches");

const apiStyle = new ShopeeOrderClientCore({ ensureValidAccessToken: async () => credential }, new WorkerShopeeOrderTransport(clientFactory));
listPage = 0;
const apiStyleResult = await apiStyle.listAllInWindow("connection", { timeRangeField: "update_time", timeFrom: 0, timeTo: 10 });
listPage = 0;
const workerStyleResult = await worker.client.listAllInWindow("connection", { timeRangeField: "update_time", timeFrom: 0, timeTo: 10 });
assert.deepEqual(workerStyleResult, apiStyleResult, "API-style and Worker-style shared-core output parity");

for (const response of [{ error: "error_network" }, { error: "common.error_auth" }]) {
  const failing = new WorkerShopeeOrderTransport(() => ({ requestShop: async () => response }));
  try { await failing.list(credential, { timeRangeField: "create_time", timeFrom: 0, timeTo: 1, pageSize: 100 }); throw new Error("provider error accepted"); }
  catch (error) { assert.ok(error instanceof ShopeeOrderClientError); assert.equal(error.retryable, response.error === "error_network"); }
}

assert.ok(requests.every((request) => request.accessToken === credential.accessToken));
console.log("worker Shopee order-client parity tests passed");
