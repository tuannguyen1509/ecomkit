import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Queue } from "bullmq";
import { MarketplaceConnectionStatus, MarketplaceSyncStatus, MarketplaceSyncTrigger, MarketplaceSyncType, Platform, prisma } from "@ecomkit/database";
import { decodeShopeeSyncCheckpoint, ShopeeOrderClientCore, ShopeeOrderClientError, type ShopeeAccessCredentialProvider, type ShopeeOrderDetail, type ShopeeOrderTransport } from "@ecomkit/marketplace-server";
import { getMarketplaceSyncJobId } from "@ecomkit/shared";
import { createWorkerMarketplaceAdapterRegistry } from "./marketplace-adapter.registry.js";
import { startMarketplaceSyncWorker } from "./marketplace-sync.worker.js";
import { ShopeeAdapter } from "./shopee-marketplace.adapter.js";
import { createWorkerShopeeAdapter } from "./shopee-marketplace.worker.js";

type Scenario = "initial" | "replay" | "incremental" | "empty" | "transient" | "deterministic" | "missing" | "invalid";
const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const queueName = `shopee-registered-e2e-${suffix}`;
const redis = { host: process.env.REDIS_HOST ?? "redis", port: Number(process.env.REDIS_PORT ?? "6379") };
const apiUrl = process.env.API_TEST_URL ?? "http://localhost:3001/api";
const initialStart = new Date("2026-01-01T00:00:00.000Z");
const initialEnd = new Date("2026-01-10T00:00:00.000Z");
const incrementalEnd = new Date("2026-01-10T01:00:00.000Z");
const emptyEnd = new Date("2026-01-10T02:00:00.000Z");
const secretMarkers = ["TEST_ACCESS_TOKEN_SECRET", "TEST_REFRESH_TOKEN_SECRET", "TEST_PARTNER_KEY_SECRET", "TEST_ENVELOPE_SECRET"];

const detail = (id: string, updateTime: number, status = "COMPLETED"): ShopeeOrderDetail => ({
  order_sn: id, order_status: status, create_time: Math.floor(initialStart.valueOf() / 1000) + 100, update_time: updateTime,
  currency: "VND", total_amount: id.endsWith("2") ? 543_210 : 123_456,
  recipient_address: id.endsWith("2") ? { name: "N*** A", phone: "09***123", full_address: "S*** synthetic address" } : { name: "Synthetic Buyer", phone: "0000000000" },
  item_list: id.endsWith("2")
    ? [{ order_item_id: 21, item_name: "Synthetic item B1", model_quantity_purchased: 2, model_discounted_price: 100 }, { order_item_id: 22, item_name: "Synthetic item B2", model_sku: "SYN-B2", model_quantity_purchased: 1, model_discounted_price: 200 }]
    : [{ order_item_id: 11, item_name: `Synthetic item ${id}`, model_sku: `SYN-${id}`, model_quantity_purchased: 1, model_discounted_price: 123 }],
  synthetic_provider_field: `raw-${id}-${updateTime}`,
});

const initialDetails = new Map<string, ShopeeOrderDetail>([
  ["TEST_SHOPEE_001", detail("TEST_SHOPEE_001", 1_768_000_100)],
  ["TEST_SHOPEE_002", detail("TEST_SHOPEE_002", 1_768_000_200, "SHIPPED")],
  ["TEST_SHOPEE_003", detail("TEST_SHOPEE_003", 1_768_000_300, "READY_TO_SHIP")],
]);

const scenarios = new Map<string, Scenario>();
const shops = new Map<string, string>();
const listRequests: Array<{ shopId: string; input: Parameters<ShopeeOrderTransport["list"]>[1] }> = [];
let providerCalls = 0;
let realNetworkCalls = 0;
let transientFailures = 0;

const credentials: ShopeeAccessCredentialProvider = {
  async ensureValidAccessToken(connectionId) {
    return { accessToken: "TEST_ACCESS_TOKEN_SECRET", shopId: shops.get(connectionId) ?? "missing-shop", accessTokenExpiresAt: "2030-01-01T00:00:00.000Z" };
  },
};

const transport: ShopeeOrderTransport = {
  async list(credential, input) {
    providerCalls++; listRequests.push({ shopId: credential.shopId, input });
    const scenario = scenarios.get(credential.shopId) ?? "deterministic";
    if (scenario === "transient" && transientFailures++ === 0) throw new ShopeeOrderClientError("SHOPEE_ORDER_PROVIDER_TRANSIENT", true, "REQ-SYNTHETIC");
    if (scenario === "deterministic") throw new ShopeeOrderClientError("SHOPEE_ORDER_PROVIDER_AUTH", false, "REQ-SYNTHETIC");
    if (scenario === "empty") return { orders: [], more: false };
    if (scenario === "incremental") return { orders: [{ order_sn: "TEST_SHOPEE_001" }, { order_sn: "TEST_SHOPEE_002" }], more: false };
    return { orders: [...initialDetails.keys()].map((order_sn) => ({ order_sn })), more: false };
  },
  async details(credential, ids) {
    providerCalls++;
    const scenario = scenarios.get(credential.shopId) ?? "deterministic";
    if (scenario === "missing") return { orders: ids.filter((id) => id !== "TEST_SHOPEE_002").map((id) => initialDetails.get(id)!) };
    if (scenario === "invalid") return { orders: ids.map((id) => id === "TEST_SHOPEE_002" ? { ...initialDetails.get(id)!, update_time: undefined } : initialDetails.get(id)!) };
    if (scenario === "incremental") return { orders: ids.map((id) => id === "TEST_SHOPEE_001" ? detail(id, 1_768_010_000, "COMPLETED_UPDATED") : initialDetails.get(id)!) };
    return { orders: ids.map((id) => initialDetails.get(id)!) };
  },
};

const waitFor = async <T>(read: () => Promise<T | null>, timeoutMs = 20_000): Promise<T> => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) { const value = await read(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error("SHOPEE_REGISTERED_E2E_TIMEOUT");
};

async function run(): Promise<void> {
  delete process.env.MARKETPLACE_ENABLE_MOCK_ADAPTER;
  const core = new ShopeeOrderClientCore(credentials, transport);
  let factoryCalls = 0;
  const registry = createWorkerMarketplaceAdapterRegistry({ enableMockAdapter: false, shopeeFactory: () => { factoryCalls++; return createWorkerShopeeAdapter({ orderClient: core }); } });
  const resolved = registry.resolve(Platform.SHOPEE);
  assert.ok(resolved instanceof ShopeeAdapter); assert.equal(factoryCalls, 1);
  const worker = startMarketplaceSyncWorker({ queueName, concurrency: 2, adapterRegistry: registry });
  let restartedWorker: ReturnType<typeof startMarketplaceSyncWorker> | undefined;
  const queue = new Queue<{ connectionId: string; syncRunId: string }>(queueName, { connection: redis });
  const connectionIds: string[] = [];
  const userToken = randomBytes(32).toString("base64url");
  const user = await prisma.user.create({ data: { username: `shopee-e2e-${suffix}`, displayName: "Synthetic Shopee E2E", passwordHash: "synthetic-not-used", role: "USER" } });
  await prisma.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(userToken).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
  const cookie = `ecomkit_session=${userToken}`;

  const createConnection = async (shopId: string, scenario: Scenario) => {
    const row = await prisma.marketplaceConnection.create({ data: { platform: Platform.SHOPEE, externalShopId: `${shopId}-${suffix}`, status: MarketplaceConnectionStatus.ACTIVE } });
    connectionIds.push(row.id); shops.set(row.id, row.externalShopId); scenarios.set(row.externalShopId, scenario); return row;
  };
  const createRun = (connectionId: string, syncType: MarketplaceSyncType, windowStart: Date | null, windowEnd: Date, startCursor?: string | null) => prisma.marketplaceSyncRun.create({ data: { connectionId, syncType, triggerType: MarketplaceSyncTrigger.SYSTEM, status: MarketplaceSyncStatus.QUEUED, windowStart, windowEnd, startCursor } });
  const enqueue = async (run: { id: string; connectionId: string }) => {
    const job = await queue.add("sync-marketplace", { connectionId: run.connectionId, syncRunId: run.id }, { jobId: getMarketplaceSyncJobId(run.id), attempts: 2, backoff: { type: "exponential", delay: 10 } });
    assert.deepEqual(job.data, { connectionId: run.connectionId, syncRunId: run.id }); return job;
  };
  const terminal = (id: string) => waitFor(async () => { const row = await prisma.marketplaceSyncRun.findUniqueOrThrow({ where: { id }, include: { errors: true } }); return row.status === MarketplaceSyncStatus.SUCCESS || row.status === MarketplaceSyncStatus.ERROR ? row : null; });
  const request = (path: string) => fetch(`${apiUrl}${path}`, { headers: { Cookie: cookie, Origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" } });

  try {
    const main = await createConnection("synthetic-main", "initial");
    const initial = await createRun(main.id, MarketplaceSyncType.INITIAL, initialStart, initialEnd); const initialJob = await enqueue(initial); const initialDone = await terminal(initial.id);
    assert.equal(initialDone.status, MarketplaceSyncStatus.SUCCESS); assert.equal(initialDone.ordersFetched, 3); assert.equal(initialDone.ordersCreated, 3); assert.ok(initialDone.batchId);
    assert.equal((await initialJob.getState()), "completed");
    const checkpoint = (await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: main.id } })).syncCursor!;
    assert.equal(decodeShopeeSyncCheckpoint(checkpoint).updatedThrough, Math.floor(initialEnd.valueOf() / 1000));
    const external = await prisma.marketplaceExternalOrder.findMany({ where: { connectionId: main.id }, orderBy: { marketplaceOrderId: "asc" } });
    assert.equal(external.length, 3); assert.deepEqual(external.map((order) => order.marketplaceOrderId), [...initialDetails.keys()]);
    for (const order of external) { assert.equal((order.rawData as Record<string, unknown>).order_sn, order.marketplaceOrderId); assert.equal((order.normalizedData as Record<string, unknown>).marketplaceOrderId, order.marketplaceOrderId); assert.notDeepEqual(order.rawData, order.normalizedData); }
    assert.equal(await prisma.uploadedFile.count({ where: { batchId: initialDone.batchId! } }), 0);
    const canonical = await prisma.order.findMany({ where: { batchId: initialDone.batchId! }, orderBy: { rawOrderCode: "asc" } });
    assert.equal(canonical.length, 3); assert.deepEqual(canonical.map((order) => order.rawOrderCode), [...initialDetails.keys()]); assert.ok(canonical.every((order) => order.platform === Platform.SHOPEE));
    assert.equal(await prisma.marketplaceSyncError.count({ where: { syncRunId: initial.id } }), 0); assert.equal(await prisma.processingError.count({ where: { batchId: initialDone.batchId! } }), 0);

    const results = await request(`/batches/${initialDone.batchId}/results?page=1&pageSize=20`); assert.equal(results.status, 200); const resultBody = await results.json() as { pagination: { total: number }; orders: Array<{ rawOrderCode: string }> }; assert.equal(resultBody.pagination.total, 3);
    const errors = await request(`/batches/${initialDone.batchId}/errors?page=1&pageSize=20`); assert.equal(errors.status, 200); assert.equal(((await errors.json()) as { pagination: { total: number } }).pagination.total, 0);
    const history = await request("/batches/history?page=1&pageSize=20"); assert.equal(history.status, 200); assert.ok(((await history.json()) as { items: Array<{ id: string }> }).items.some((item) => item.id === initialDone.batchId));
    const batchDetail = await request(`/batches/${initialDone.batchId}`); assert.equal(batchDetail.status, 200); assert.deepEqual(((await batchDetail.json()) as { files: unknown[] }).files, []);
    const xlsx = await request(`/batches/${initialDone.batchId}/export?format=xlsx&status=ALL`); assert.equal(xlsx.status, 200); assert.match(xlsx.headers.get("content-type") ?? "", /spreadsheetml/); assert.ok((await xlsx.arrayBuffer()).byteLength > 1000);
    const csv = await request(`/batches/${initialDone.batchId}/export?format=csv&status=ALL`); assert.equal(csv.status, 200); const csvText = await csv.text(); for (const id of initialDetails.keys()) assert.ok(csvText.includes(id)); assert.equal(csvText.trim().split(/\r?\n/).length, 4); assert.equal(csvText.split(/\r?\n/)[0]?.split(",").length, 24);

    scenarios.set(main.externalShopId, "replay"); const replay = await createRun(main.id, MarketplaceSyncType.INITIAL, initialStart, initialEnd, checkpoint); await enqueue(replay); const replayDone = await terminal(replay.id);
    assert.equal(replayDone.ordersCreated, 0); assert.equal(replayDone.ordersUpdated, 0); assert.equal(replayDone.batchId, null); assert.equal(await prisma.marketplaceExternalOrder.count({ where: { connectionId: main.id } }), 3);

    scenarios.set(main.externalShopId, "incremental"); const incremental = await createRun(main.id, MarketplaceSyncType.INCREMENTAL, null, incrementalEnd, checkpoint); await enqueue(incremental); const incrementalDone = await terminal(incremental.id);
    assert.equal(incrementalDone.status, MarketplaceSyncStatus.SUCCESS); assert.equal(incrementalDone.ordersUpdated, 1); assert.ok(incrementalDone.batchId); assert.equal(await prisma.order.count({ where: { batchId: incrementalDone.batchId! } }), 1);
    const updated = await prisma.marketplaceExternalOrder.findUniqueOrThrow({ where: { connectionId_marketplaceOrderId: { connectionId: main.id, marketplaceOrderId: "TEST_SHOPEE_001" } } });
    assert.equal(updated.rawProviderStatus, "COMPLETED_UPDATED"); assert.equal((updated.rawData as Record<string, unknown>).synthetic_provider_field, "raw-TEST_SHOPEE_001-1768010000");
    const incrementRequest = [...listRequests].reverse().find((entry) => entry.shopId === main.externalShopId && entry.input.timeRangeField === "update_time")!;
    assert.equal(incrementRequest.input.timeFrom, Math.floor(initialEnd.valueOf() / 1000) - 300); assert.equal(incrementRequest.input.timeTo, Math.floor(incrementalEnd.valueOf() / 1000));
    const incrementalCheckpoint = (await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: main.id } })).syncCursor!; assert.equal(decodeShopeeSyncCheckpoint(incrementalCheckpoint).updatedThrough, Math.floor(incrementalEnd.valueOf() / 1000));

    scenarios.set(main.externalShopId, "empty"); const empty = await createRun(main.id, MarketplaceSyncType.INCREMENTAL, null, emptyEnd, incrementalCheckpoint); await enqueue(empty); const emptyDone = await terminal(empty.id);
    assert.equal(emptyDone.status, MarketplaceSyncStatus.SUCCESS); assert.equal(emptyDone.ordersFetched, 0); assert.equal(emptyDone.batchId, null); assert.equal(decodeShopeeSyncCheckpoint((await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: main.id } })).syncCursor!).updatedThrough, Math.floor(emptyEnd.valueOf() / 1000));

    const transientConnection = await createConnection("synthetic-transient", "transient"); const transientRun = await createRun(transientConnection.id, MarketplaceSyncType.INITIAL, initialStart, initialEnd); const transientJob = await enqueue(transientRun); const transientDone = await terminal(transientRun.id);
    assert.equal(transientDone.status, MarketplaceSyncStatus.SUCCESS); assert.equal((await queue.getJob(String(transientJob.id)))?.attemptsMade, 2); assert.equal(await prisma.marketplaceExternalOrder.count({ where: { connectionId: transientConnection.id } }), 3);

    for (const [name, scenario, expectedCode] of [["deterministic", "deterministic", "SHOPEE_ORDER_PROVIDER_AUTH"], ["missing", "missing", "SHOPEE_ORDER_MISSING_DETAIL"], ["invalid", "invalid", "SHOPEE_NORMALIZATION_INVALID_TIMESTAMP"]] as const) {
      const failedConnection = await createConnection(`synthetic-${name}`, scenario); const before = failedConnection.syncCursor; const failedRun = await createRun(failedConnection.id, MarketplaceSyncType.INITIAL, initialStart, initialEnd); const failedJob = await enqueue(failedRun); const failed = await terminal(failedRun.id);
      assert.equal(failed.status, MarketplaceSyncStatus.ERROR); assert.equal(failed.batchId, null); assert.equal(failed.errors.length, 1); assert.equal(failed.errors[0]?.internalCode, expectedCode); assert.equal(await prisma.marketplaceExternalOrder.count({ where: { connectionId: failedConnection.id } }), 0); assert.equal((await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: failedConnection.id } })).syncCursor, before); assert.equal((await queue.getJob(String(failedJob.id)))?.attemptsMade, 1);
    }

    const crossA = await createConnection("synthetic-cross-a", "empty"), crossB = await createConnection("synthetic-cross-b", "empty");
    const crossRunA = await createRun(crossA.id, MarketplaceSyncType.INITIAL, initialStart, initialEnd), crossRunB = await createRun(crossB.id, MarketplaceSyncType.INITIAL, initialStart, initialEnd);
    await Promise.all([enqueue(crossRunA), enqueue(crossRunB)]); const [crossDoneA, crossDoneB] = await Promise.all([terminal(crossRunA.id), terminal(crossRunB.id)]);
    assert.equal(crossDoneA.status, MarketplaceSyncStatus.SUCCESS); assert.equal(crossDoneB.status, MarketplaceSyncStatus.SUCCESS); assert.ok(listRequests.some((entry) => entry.shopId === crossA.externalShopId)); assert.ok(listRequests.some((entry) => entry.shopId === crossB.externalShopId));

    await worker.pause(true);
    const restartConnection = await createConnection("synthetic-restart", "empty"); const restartRun = await createRun(restartConnection.id, MarketplaceSyncType.INITIAL, initialStart, initialEnd); await enqueue(restartRun); await worker.close();
    restartedWorker = startMarketplaceSyncWorker({ queueName, concurrency: 2, adapterRegistry: registry });
    assert.equal((await terminal(restartRun.id)).status, MarketplaceSyncStatus.SUCCESS); await restartedWorker.close(); restartedWorker = undefined;

    const persisted = await prisma.marketplaceExternalOrder.findMany({ where: { connectionId: { in: connectionIds } } });
    const runs = await prisma.marketplaceSyncRun.findMany({ where: { connectionId: { in: connectionIds } }, include: { errors: true, batch: { include: { orders: true, processingErrors: true } } } });
    const serialized = JSON.stringify({ persisted, runs, csvText }); for (const marker of secretMarkers) assert.ok(!serialized.includes(marker));
    assert.ok(providerCalls > 0); assert.equal(realNetworkCalls, 0);
  } finally {
    await restartedWorker?.close().catch(() => undefined); await worker.close().catch(() => undefined); await queue.obliterate({ force: true }).catch(() => undefined); await queue.close().catch(() => undefined);
    const runs = await prisma.marketplaceSyncRun.findMany({ where: { connectionId: { in: connectionIds } }, select: { id: true, batchId: true } });
    const runIds = runs.map((run) => run.id), batchIds = runs.flatMap((run) => run.batchId ? [run.batchId] : []);
    await prisma.$transaction(async (tx) => {
      await tx.batch.deleteMany({ where: { id: { in: batchIds } } });
      await tx.marketplaceSyncError.deleteMany({ where: { syncRunId: { in: runIds } } });
      await tx.marketplaceSyncRun.deleteMany({ where: { id: { in: runIds } } });
      await tx.marketplaceExternalOrder.deleteMany({ where: { connectionId: { in: connectionIds } } });
      await tx.marketplaceConnection.deleteMany({ where: { id: { in: connectionIds } } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.user.delete({ where: { id: user.id } });
    });
    assert.equal(await prisma.marketplaceConnection.count({ where: { id: { in: connectionIds } } }), 0, "test-owned Shopee connections must be cleaned by exact ID");
    await prisma.$disconnect();
  }
  console.log("registered Shopee synthetic end-to-end marketplace sync passed");
}

void run().catch((error: unknown) => { console.error(error instanceof Error ? error.stack ?? error.message : "registered Shopee E2E failed"); process.exitCode = 1; });
