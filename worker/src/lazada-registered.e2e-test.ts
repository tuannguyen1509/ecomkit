import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Queue } from "bullmq";
import { MarketplaceConnectionStatus, MarketplaceSyncStatus, MarketplaceSyncTrigger, MarketplaceSyncType, Platform, prisma } from "@ecomkit/database";
import { LazadaMarketplaceAdapter, type LazadaTransport, type LazadaTransportRequest } from "@ecomkit/marketplace-server";
import { encryptMarketplaceCredential } from "@ecomkit/shared";
import { createWorkerLazadaAdapter, WorkerLazadaConfigError, type WorkerLazadaConfigResolver } from "./lazada-marketplace.worker.js";
import { createWorkerMarketplaceAdapterRegistry } from "./marketplace-adapter.registry.js";
import { startMarketplaceSyncWorker } from "./marketplace-sync.worker.js";

type Scenario = "success" | "empty" | "missing" | "malformed" | "transient" | "split";
const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const queueName = `lazada-registered-e2e-${suffix}`;
const redis = { host: process.env.REDIS_HOST ?? "redis", port: Number(process.env.REDIS_PORT ?? "6379") };
const apiUrl = process.env.API_TEST_URL ?? process.env.API_INTERNAL_URL ?? "http://localhost:3001/api";
const encryptionKey = process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY;
if (!encryptionKey) throw new Error("MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY is required for synthetic E2E");
const windowStart = new Date("2026-09-01T00:00:00.000Z"), windowEnd = new Date("2026-09-02T00:00:00.000Z");
const ids = ["491253082180001", "900719925474099312345", "491253082180003"];
const secretMarkers = ["TEST_LAZADA_APP_SECRET", "TEST_LAZADA_ACCESS_TOKEN", "TEST_LAZADA_REFRESH_TOKEN"];
const scenarios = new Map<string, Scenario>();
let providerCalls = 0, refreshCalls = 0, transientFailures = 0, configCalls = 0;

const orders = [
  { order_id: ids[0], order_number: ids[0], created_at: "2026-09-01T01:00:00+07:00", updated_at: "2026-09-01T02:00:00+07:00", statuses: ["pending"], price: "100.00", shipping_fee: "10.00", voucher: "5.00", buyer_note: "Synthetic note", address_shipping: { phone: "09***123", city: "Hồ Chí Minh", unknown_address_field: "preserved" }, synthetic_unknown: "raw-preserved" },
  { order_id: ids[1], order_number: ids[1], created_at: "2026-09-01T03:00:00+07:00", updated_at: "2026-09-01T04:00:00+07:00", statuses: ["pending", "ready_to_ship"], address_shipping: { phone: "***" } },
  { order_id: ids[2], created_at: "2026-09-01T05:00:00Z", updated_at: "2026-09-01T06:00:00Z", statuses: ["shipped"] },
];
const itemFor = (orderId: string, itemId: string, status = "pending") => ({ order_id: orderId, order_item_id: itemId, status, sku: "SAME-SKU", shop_sku: "SAME-SHOP-SKU", name: "Synthetic item", paid_price: "9.00" });
const allGroups = [
  { order_id: ids[0], order_items: [itemFor(ids[0], "1001")] },
  { order_id: ids[1], order_items: [itemFor(ids[1], "2001", "pending"), itemFor(ids[1], "2002", "ready_to_ship")] },
  { order_id: ids[2], order_items: [itemFor(ids[2], "3001", "shipped")] },
];

function token(request: LazadaTransportRequest): string { return new URL(request.url).searchParams.get("access_token") ?? ""; }
const transport: LazadaTransport = {
  async send(request) {
    providerCalls++;
    const url = new URL(request.url), access = token(request), scenario = scenarios.get(access) ?? "success";
    if (url.pathname.endsWith("/auth/token/refresh")) {
      refreshCalls++;
      const nextAccess = `TEST_LAZADA_ACCESS_TOKEN_oauth-${suffix}`;
      scenarios.set(nextAccess, "success");
      return { status: 200, body: JSON.stringify({ code: "0", request_id: "REQ-REFRESH", access_token: nextAccess, refresh_token: `TEST_LAZADA_REFRESH_TOKEN_NEW_${suffix}`, expires_in: 3600, refresh_expires_in: 7200 }) };
    }
    if (scenario === "transient" && transientFailures++ === 0) throw new Error("synthetic network outage");
    if (url.pathname.endsWith("/orders/get")) {
      if (scenario === "empty") return { status: 200, body: JSON.stringify({ code: "0", request_id: "REQ-EMPTY", data: { count: "0", countTotal: "0", orders: [] } }) };
      if (scenario === "malformed") return { status: 200, body: JSON.stringify({ code: "0", request_id: "REQ-BAD", data: { count: "1", countTotal: "1", orders: [{ ...orders[0], order_id: null }] } }) };
      if (scenario === "split" && url.searchParams.get("created_after") === windowStart.toISOString() && url.searchParams.get("created_before") === windowEnd.toISOString()) {
        const offset = Number(url.searchParams.get("offset") ?? "0");
        const page = Array.from({ length: 100 }, (_, index) => ({ order_id: String(8_000_000 + offset + index), created_at: "2026-09-01T12:00:00Z", updated_at: "2026-09-01T12:00:01Z", statuses: ["pending"] }));
        return { status: 200, body: JSON.stringify({ code: "0", request_id: `REQ-SPLIT-${offset}`, data: { count: "100", countTotal: "5101", orders: page } }) };
      }
      return { status: 200, body: JSON.stringify({ code: "0", request_id: "REQ-LIST", data: { count: "3", countTotal: "3", orders } }) };
    }
    if (url.pathname.endsWith("/orders/items/get")) {
      const requested = url.searchParams.get("order_ids") ?? "";
      const selected = allGroups.filter((group) => requested.includes(group.order_id));
      return { status: 200, body: JSON.stringify({ code: "0", request_id: "REQ-ITEMS", data: scenario === "missing" ? selected.filter((group) => group.order_id !== ids[1]) : selected }) };
    }
    throw new Error("unexpected synthetic Lazada path");
  },
};
const config: WorkerLazadaConfigResolver = { async resolve() { configCalls++; return { appKey: "TEST_LAZADA_APP_KEY", appSecret: "TEST_LAZADA_APP_SECRET", timeoutMs: 5_000 }; } };

const waitFor = async <T>(read: () => Promise<T | null>, timeoutMs = 25_000): Promise<T> => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) { const value = await read(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error("LAZADA_REGISTERED_E2E_TIMEOUT");
};

async function run(): Promise<void> {
  delete process.env.MARKETPLACE_ENABLE_MOCK_ADAPTER;
  let factoryCalls = 0;
  const registry = createWorkerMarketplaceAdapterRegistry({ enableMockAdapter: false, lazadaFactory: () => { factoryCalls++; return createWorkerLazadaAdapter({ configResolver: config, transport }); } });
  assert.equal(configCalls, 0); assert.ok(registry.resolve(Platform.LAZADA) instanceof LazadaMarketplaceAdapter); assert.equal(factoryCalls, 1); assert.equal(configCalls, 0);
  const missingConfigAdapter = createWorkerLazadaAdapter({ configResolver: { async resolve() { throw new WorkerLazadaConfigError(); } }, transport, lifecycle: { async ensureValidAccessToken() { return { accessToken: "synthetic", externalShopId: "vn:synthetic", accessTokenExpiresAt: "2030-01-01T00:00:00.000Z" }; } } });
  const callsBeforeMissingConfig = providerCalls;
  await assert.rejects(() => missingConfigAdapter.syncOrders({ connectionId: "missing-config", platform: "LAZADA", externalShopId: "vn:synthetic", syncRunId: "missing-config-run" }, { syncType: "INITIAL", windowStart, windowEnd }), (error: unknown) => error instanceof WorkerLazadaConfigError);
  assert.equal(providerCalls, callsBeforeMissingConfig);
  const worker = startMarketplaceSyncWorker({ queueName, concurrency: 2, adapterRegistry: registry });
  const queue = new Queue<{ connectionId: string; syncRunId: string }>(queueName, { connection: redis });
  const connectionIds: string[] = [];
  const userToken = randomBytes(32).toString("base64url");
  const user = await prisma.user.create({ data: { username: `lazada-e2e-${suffix}`, displayName: "Synthetic Lazada E2E", passwordHash: "synthetic-not-used", role: "USER" } });
  await prisma.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(userToken).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
  const cookie = `ecomkit_session=${userToken}`;
  const createConnection = async (seller: string, scenario: Scenario, expiresAt = "2030-01-01T00:00:00.000Z") => {
    const accessToken = `TEST_LAZADA_ACCESS_TOKEN_${seller}_${suffix}`;
    scenarios.set(accessToken, scenario);
    const row = await prisma.marketplaceConnection.create({ data: { platform: Platform.LAZADA, externalShopId: `vn:${seller}-${suffix}`, status: MarketplaceConnectionStatus.ACTIVE, credentialEnvelope: encryptMarketplaceCredential({ accessToken, tokenExpiresAt: expiresAt, providerMetadata: { sellerId: `${seller}-${suffix}`, country: "vn", credentialSource: "EXTERNAL_IMPORT", refreshOwnership: "EXTERNAL" } }, encryptionKey) } });
    connectionIds.push(row.id); return row;
  };
  const createRun = (connectionId: string, syncType: MarketplaceSyncType = MarketplaceSyncType.INITIAL) => prisma.marketplaceSyncRun.create({ data: { connectionId, syncType, triggerType: MarketplaceSyncTrigger.SYSTEM, status: MarketplaceSyncStatus.QUEUED, windowStart: syncType === MarketplaceSyncType.INITIAL ? windowStart : null, windowEnd } });
  const enqueue = (run: { id: string; connectionId: string }, attempts = 2) => queue.add("sync-marketplace", { connectionId: run.connectionId, syncRunId: run.id }, { jobId: `marketplace-sync-${run.id}`, attempts, backoff: { type: "fixed", delay: 10 } });
  const terminal = (id: string) => waitFor(async () => { const row = await prisma.marketplaceSyncRun.findUniqueOrThrow({ where: { id }, include: { errors: true } }); return row.status === MarketplaceSyncStatus.SUCCESS || row.status === MarketplaceSyncStatus.ERROR ? row : null; });
  const request = (path: string) => fetch(`${apiUrl}${path}`, { headers: { Cookie: cookie, Origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" } });
  try {
    const main = await createConnection("100", "success");
    const initial = await createRun(main.id); const job = await enqueue(initial); const done = await terminal(initial.id);
    assert.deepEqual(job.data, { connectionId: main.id, syncRunId: initial.id });
    assert.equal(done.status, MarketplaceSyncStatus.SUCCESS); assert.equal(done.ordersFetched, 3); assert.equal(done.ordersCreated, 3); assert.equal(done.resultCursor, null); assert.ok(done.batchId); assert.equal(await job.getState(), "completed");
    const connection = await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: main.id } }); assert.equal(connection.syncCursor, null);
    const external = await prisma.marketplaceExternalOrder.findMany({ where: { connectionId: main.id }, orderBy: { marketplaceOrderId: "asc" } });
    assert.equal(external.length, 3); assert.ok(external.some((entry) => entry.marketplaceOrderId === ids[1]));
    const firstRaw = external.find((entry) => entry.marketplaceOrderId === ids[0])!.rawData as { order: Record<string, unknown>; items: unknown[] };
    assert.equal(firstRaw.order.synthetic_unknown, "raw-preserved"); assert.equal(firstRaw.items.length, 1);
    const mixed = external.find((entry) => entry.marketplaceOrderId === ids[1])!.normalizedData as { rawProviderStatus?: string; items: unknown[]; providerMetadata: { providerStatuses: string[] } };
    assert.equal(mixed.rawProviderStatus, undefined); assert.deepEqual(mixed.providerMetadata.providerStatuses, ["pending", "ready_to_ship"]); assert.equal(mixed.items.length, 2);
    assert.equal(await prisma.uploadedFile.count({ where: { batchId: done.batchId! } }), 0);
    const canonical = await prisma.order.findMany({ where: { batchId: done.batchId! }, include: { items: true }, orderBy: { rawOrderCode: "asc" } });
    assert.equal(canonical.length, 3); assert.ok(canonical.some((entry) => entry.rawOrderCode === ids[1] && entry.items.length === 2 && entry.items.every((item) => item.quantity === 1)));
    assert.ok(canonical.every((entry) => entry.platform === Platform.LAZADA)); assert.equal(canonical.find((entry) => entry.rawOrderCode === ids[1])?.orderStatus, null);
    const firstCanonical = canonical.find((entry) => entry.rawOrderCode === ids[0])!; assert.equal(firstCanonical.salesChannel, "LAZADA"); assert.equal(firstCanonical.orderStatus, "pending"); assert.equal(firstCanonical.phone, "09***123"); assert.equal(firstCanonical.provinceCity, "Hồ Chí Minh"); assert.equal(firstCanonical.note, "Synthetic note"); assert.equal(firstCanonical.customerName, null); assert.equal(firstCanonical.amountCollected, null);
    assert.equal(await prisma.marketplaceSyncError.count({ where: { syncRunId: initial.id } }), 0);

    const results = await request(`/batches/${done.batchId}/results?page=1&pageSize=20`); assert.equal(results.status, 200); assert.equal(((await results.json()) as { pagination: { total: number } }).pagination.total, 3);
    const errors = await request(`/batches/${done.batchId}/errors?page=1&pageSize=20`); assert.equal(errors.status, 200); assert.equal(((await errors.json()) as { pagination: { total: number } }).pagination.total, 0);
    const history = await request("/batches/history?page=1&pageSize=20"); assert.equal(history.status, 200); assert.ok(((await history.json()) as { items: Array<{ id: string }> }).items.some((entry) => entry.id === done.batchId));
    const xlsx = await request(`/batches/${done.batchId}/export?format=xlsx&status=ALL`); assert.equal(xlsx.status, 200); assert.ok((await xlsx.arrayBuffer()).byteLength > 1_000);
    const csv = await request(`/batches/${done.batchId}/export?format=csv&status=ALL`); assert.equal(csv.status, 200); const csvBytes = new Uint8Array(await csv.arrayBuffer()); assert.deepEqual([...csvBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]); const csvText = new TextDecoder().decode(csvBytes); assert.equal(csvText.trim().split(/\r?\n/).length, 4); assert.equal(csvText.replace(/^\uFEFF/, "").split(/\r?\n/)[0]?.split(",").length, 24); for (const id of ids) assert.ok(csvText.includes(id));

    const replay = await createRun(main.id); await enqueue(replay); const replayDone = await terminal(replay.id); assert.equal(replayDone.ordersCreated, 0); assert.equal(replayDone.ordersUpdated, 0); assert.equal(replayDone.batchId, null); assert.equal(await prisma.marketplaceExternalOrder.count({ where: { connectionId: main.id } }), 3);
    const secondStore = await createConnection("101", "success"); const secondRun = await createRun(secondStore.id); await enqueue(secondRun); assert.equal((await terminal(secondRun.id)).status, MarketplaceSyncStatus.SUCCESS); assert.equal(await prisma.marketplaceExternalOrder.count({ where: { connectionId: secondStore.id } }), 3);
    const shopeeIsolation = await prisma.marketplaceConnection.create({ data: { platform: Platform.SHOPEE, externalShopId: `same-id-${suffix}`, status: MarketplaceConnectionStatus.ACTIVE } }); connectionIds.push(shopeeIsolation.id);
    await prisma.marketplaceExternalOrder.create({ data: { connectionId: shopeeIsolation.id, marketplaceOrderId: ids[0], rawData: {}, normalizedData: { marketplaceOrderId: ids[0] } } });
    assert.equal(await prisma.marketplaceExternalOrder.count({ where: { marketplaceOrderId: ids[0], connectionId: { in: [main.id, secondStore.id, shopeeIsolation.id] } } }), 3);
    const emptyConnection = await createConnection("200", "empty"); const emptyRun = await createRun(emptyConnection.id); await enqueue(emptyRun); const empty = await terminal(emptyRun.id); assert.equal(empty.status, MarketplaceSyncStatus.SUCCESS); assert.equal(empty.batchId, null);
    const splitConnection = await createConnection("250", "split"); const splitRun = await createRun(splitConnection.id); await enqueue(splitRun); const split = await terminal(splitRun.id); assert.equal(split.status, MarketplaceSyncStatus.SUCCESS); assert.equal(split.ordersFetched, 3); assert.equal(await prisma.marketplaceExternalOrder.count({ where: { connectionId: splitConnection.id } }), 3);

    for (const [seller, scenario, code] of [["300", "missing", "LAZADA_ITEM_GROUP_MISSING"], ["400", "malformed", "LAZADA_ORDER_RESPONSE_INVALID"]] as const) {
      const failedConnection = await createConnection(seller, scenario); const failedRun = await createRun(failedConnection.id); const failedJob = await enqueue(failedRun); const failed = await terminal(failedRun.id);
      assert.equal(failed.status, MarketplaceSyncStatus.ERROR); assert.equal(failed.errors[0]?.internalCode, code); assert.equal(await prisma.marketplaceExternalOrder.count({ where: { connectionId: failedConnection.id } }), 0); assert.equal((await queue.getJob(String(failedJob.id)))?.attemptsMade, 1);
    }
    const transientConnection = await createConnection("500", "transient"); const transientRun = await createRun(transientConnection.id); const transientJob = await enqueue(transientRun); assert.equal((await terminal(transientRun.id)).status, MarketplaceSyncStatus.SUCCESS); assert.equal((await queue.getJob(String(transientJob.id)))?.attemptsMade, 2);
    const expiredConnection = await createConnection("600", "success", "2020-01-01T00:00:00.000Z"); const expiredRun = await createRun(expiredConnection.id); await enqueue(expiredRun); const expired = await terminal(expiredRun.id); assert.equal(expired.errors[0]?.internalCode, "EXTERNAL_ACCESS_TOKEN_EXPIRED");
    const oauthSeller = `700-${suffix}`;
    const oauth = await prisma.marketplaceConnection.create({ data: { platform: Platform.LAZADA, externalShopId: `vn:${oauthSeller}`, status: MarketplaceConnectionStatus.ACTIVE, credentialEnvelope: encryptMarketplaceCredential({ accessToken: `TEST_LAZADA_ACCESS_TOKEN_OLD_${suffix}`, refreshToken: `TEST_LAZADA_REFRESH_TOKEN_${suffix}`, tokenExpiresAt: "2020-01-01T00:00:00.000Z", refreshTokenExpiresAt: "2030-01-01T00:00:00.000Z", providerMetadata: { sellerId: oauthSeller, country: "vn", credentialSource: "OAUTH", refreshOwnership: "ECOMKIT" } }, encryptionKey) } });
    connectionIds.push(oauth.id); const oauthRun = await createRun(oauth.id); await enqueue(oauthRun); assert.equal((await terminal(oauthRun.id)).status, MarketplaceSyncStatus.SUCCESS); assert.equal(refreshCalls, 1);
    const callsBeforeIncremental = providerCalls; const incremental = await createRun(main.id, MarketplaceSyncType.INCREMENTAL); await enqueue(incremental); const incrementalDone = await terminal(incremental.id); assert.equal(incrementalDone.errors[0]?.internalCode, "LAZADA_INCREMENTAL_NOT_READY"); assert.equal(providerCalls, callsBeforeIncremental); assert.equal(await prisma.marketplaceExternalOrder.count({ where: { connectionId: main.id } }), 3);

    const serialized = JSON.stringify({ external, canonical, csvText, errors: [expired.errors, incrementalDone.errors] }); for (const marker of secretMarkers) assert.ok(!serialized.includes(marker));
    assert.equal(refreshCalls, 1); assert.ok(providerCalls > 0); assert.ok(configCalls > 0);
  } finally {
    await worker.close().catch(() => undefined); await queue.close();
    const runs = await prisma.marketplaceSyncRun.findMany({ where: { connectionId: { in: connectionIds } }, select: { id: true, batchId: true } });
    await prisma.marketplaceSyncError.deleteMany({ where: { syncRunId: { in: runs.map((run) => run.id) } } });
    await prisma.marketplaceSyncRun.deleteMany({ where: { connectionId: { in: connectionIds } } });
    for (const batchId of runs.flatMap((run) => run.batchId ? [run.batchId] : [])) await prisma.batch.delete({ where: { id: batchId } }).catch(() => undefined);
    await prisma.marketplaceExternalOrder.deleteMany({ where: { connectionId: { in: connectionIds } } });
    await prisma.marketplaceConnection.deleteMany({ where: { id: { in: connectionIds } } });
    await prisma.session.deleteMany({ where: { userId: user.id } }); await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined); await prisma.$disconnect();
  }
  console.log("registered Lazada synthetic INITIAL end-to-end marketplace sync passed");
}

void run().then(() => process.exit(0)).catch((error: unknown) => { console.error(error instanceof Error ? error.stack ?? error.message : "registered Lazada E2E failed"); process.exit(1); });
