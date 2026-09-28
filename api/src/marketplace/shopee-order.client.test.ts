import { ShopeeOrderClient, batchShopeeOrderSn, splitShopeeWindows, validateShopeeWindow } from "./shopee-order.client.js";

const credential = { accessToken: "TEST_SHOPEE_ACCESS", shopId: "900003", accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString() };
async function run(): Promise<void> {
  const windows = splitShopeeWindows(0, 45 * 86400); if (windows.length !== 3 || windows[0].timeFrom !== 0 || windows[2].timeTo !== 45 * 86400 || windows.some((w) => w.timeTo - w.timeFrom > 15 * 86400)) throw new Error("window splitter regression");
  validateShopeeWindow("update_time", 0, 15 * 86400); for (const invalid of [[0, 0], [0, 15 * 86400 + 1]] as const) try { validateShopeeWindow("create_time", invalid[0], invalid[1]); throw new Error("invalid window accepted"); } catch { /* expected */ }
  if (batchShopeeOrderSn(Array.from({ length: 120 }, (_, i) => `TEST-${i}`)).map((b) => b.length).join(",") !== "50,50,20") throw new Error("detail batching regression");
  const requests: Array<Record<string, unknown>> = []; let page = 0;
  const client = new ShopeeOrderClient({ ensureValidAccessToken: async () => credential } as never, (() => ({ requestShop: async (request: { apiPath: string; query: Record<string, unknown> }) => { requests.push(request.query); if (request.apiPath.includes("get_order_list")) { page++; return page === 1 ? { response: { more: true, next_cursor: "A", order_list: [{ order_sn: "TEST-SHOPEE-ORDER-001" }] } } : { response: { more: false, order_list: [{ order_sn: "TEST-SHOPEE-ORDER-002" }] } }; } const requested = String(request.query.order_sn_list).split(","); return { response: { order_list: requested.reverse().map((order_sn) => ({ order_sn, recipient_address: { phone: "****" }, item_list: [] })) } }; } })) as never);
  const orders = await client.listAllInWindow("connection", { timeRangeField: "update_time", timeFrom: 0, timeTo: 10, pageSize: 100 }); if (orders.length !== 2 || requests.length !== 2 || requests[1].cursor !== "A") throw new Error("pagination regression");
  const details = await client.getOrderDetails("connection", ["A", "B", "C"]); if (details.orders.map((o) => o.order_sn).join(",") !== "C,B,A" || details.missingOrderSns.length) throw new Error("shuffled detail regression");
  try { await client.listOrders("connection", { timeRangeField: "update_time", timeFrom: 0, timeTo: 1, pageSize: 101 }); throw new Error("invalid page size accepted"); } catch { /* expected */ }
  console.log("Shopee order client offline contract tests passed");
}
void run().catch((error) => { console.error(error instanceof Error ? error.message : "Shopee order client test failed"); process.exitCode = 1; });
