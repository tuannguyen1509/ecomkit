import { ShopeeOrderClientCore, ShopeeOrderClientError, batchShopeeOrderSns, splitShopeeOrderWindows, type ShopeeOrderTransport } from "./shopee-order-client-core.js";

const token = { accessToken: "TEST_ACCESS_TOKEN_SECRET", shopId: "1", accessTokenExpiresAt: "2030-01-01T00:00:00.000Z" };
let listCalls = 0;
let detailCalls = 0;
const cursors: Array<string | undefined> = [];
const transport: ShopeeOrderTransport = {
  list: async (_credential, input) => {
    listCalls++;
    cursors.push(input.cursor);
    if (input.cursor) return { orders: [{ order_sn: "B" }], more: false };
    return { orders: [{ order_sn: "A" }, { order_sn: "A" }], more: true, nextCursor: "OPAQUE_CURSOR" };
  },
  details: async (_credential, ids) => {
    detailCalls++;
    return { orders: [...ids].reverse().map((order_sn) => ({ order_sn, currency: "VND", recipient_address: { phone: "****" } })) };
  },
};
const core = new ShopeeOrderClientCore({ ensureValidAccessToken: async () => token }, transport);

const page = await core.listOrders("c", { timeRangeField: "create_time", timeFrom: 0, timeTo: 15 * 86400, pageSize: 1, cursor: "INPUT_CURSOR", orderStatus: "COMPLETED" });
if (page.orders.length !== 1 || page.more || cursors.at(-1) !== "INPUT_CURSOR" || listCalls !== 1) throw new Error("single-page parity");
const nextPage = await core.listOrders("c", { timeRangeField: "update_time", timeFrom: 0, timeTo: 1, pageSize: 100 });
if (!nextPage.more || nextPage.nextCursor !== "OPAQUE_CURSOR" || Number(listCalls) !== 2) throw new Error("cursor metadata parity");

listCalls = 0;
cursors.length = 0;
const listed = await core.listAllInWindow("c", { timeRangeField: "update_time", timeFrom: 0, timeTo: 10, pageSize: 100 });
if (listed.length !== 3 || listCalls !== 2 || cursors[1] !== "OPAQUE_CURSOR") throw new Error("pagination parity");
listCalls = 0;
const ids = await core.collectOrderSns("c", { timeRangeField: "update_time", timeFrom: 0, timeTo: 16 * 86400 });
if (ids.join(",") !== "A,B" || listCalls !== 4) throw new Error("collection parity");

const detailResult = await core.getOrderDetails("c", ["A", "B", "C"]);
if (detailResult.orders.map((detail) => detail.order_sn).join(",") !== "C,B,A" || detailResult.missingOrderSns.length) throw new Error("detail compatibility parity");
detailCalls = 0;
const complete = await core.getCompleteOrderDetails("c", Array.from({ length: 120 }, (_, index) => `O${index}`));
if (complete.length !== 120 || detailCalls !== 3 || complete[0]?.order_sn !== "O0") throw new Error("strict detail parity");

if (batchShopeeOrderSns(Array.from({ length: 51 }, (_, index) => String(index))).map((batch) => batch.length).join(",") !== "50,1") throw new Error("batch parity");
if (splitShopeeOrderWindows(0, 45 * 86400).length !== 3) throw new Error("window splitter parity");
for (const input of [{ timeRangeField: "update_time" as const, timeFrom: 2, timeTo: 1 }, { timeRangeField: "update_time" as const, timeFrom: 0, timeTo: 15 * 86400 + 1 }, { timeRangeField: "update_time" as const, timeFrom: 0, timeTo: 1, pageSize: 101 }]) {
  try { await core.listOrders("c", input); throw new Error("invalid list accepted"); } catch (error) { if (!(error instanceof ShopeeOrderClientError)) throw error; }
}
const invalidPagination = new ShopeeOrderClientCore({ ensureValidAccessToken: async () => token }, { ...transport, list: async () => ({ orders: [], more: true }) });
try { await invalidPagination.listOrders("c", { timeRangeField: "create_time", timeFrom: 0, timeTo: 1 }); throw new Error("missing cursor accepted"); } catch (error) { if (!(error instanceof ShopeeOrderClientError)) throw error; }
const repeatedCursor = new ShopeeOrderClientCore({ ensureValidAccessToken: async () => token }, { ...transport, list: async () => ({ orders: [{ order_sn: "A" }], more: true, nextCursor: "REPEATED" }) });
try { await repeatedCursor.collectOrderSns("c", { timeRangeField: "create_time", timeFrom: 0, timeTo: 1 }); throw new Error("repeated cursor accepted"); } catch (error) { if (!(error instanceof ShopeeOrderClientError)) throw error; }
const missingDetail = new ShopeeOrderClientCore({ ensureValidAccessToken: async () => token }, { ...transport, details: async () => ({ orders: [{ order_sn: "A" }] }) });
try { await missingDetail.getCompleteOrderDetails("c", ["A", "B"]); throw new Error("missing detail accepted"); } catch (error) { if (!(error instanceof ShopeeOrderClientError)) throw error; }
const duplicateDetail = new ShopeeOrderClientCore({ ensureValidAccessToken: async () => token }, { ...transport, details: async () => ({ orders: [{ order_sn: "A" }, { order_sn: "A" }] }) });
try { await duplicateDetail.getOrderDetails("c", ["A"]); throw new Error("duplicate detail accepted"); } catch (error) { if (!(error instanceof ShopeeOrderClientError)) throw error; }
try { await core.getOrderDetails("c", []); throw new Error("empty detail input accepted"); } catch (error) { if (!(error instanceof ShopeeOrderClientError)) throw error; }

console.log("Shopee order client core tests passed");
