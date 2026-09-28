import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { Queue } from "bullmq";
import { MarketplaceConnectionStatus, MarketplaceSyncStatus, MarketplaceSyncTrigger, MarketplaceSyncType, Platform, prisma } from "@ecomkit/database";
import { getMarketplaceSyncJobId } from "@ecomkit/shared";

const redis = { host: process.env.REDIS_HOST ?? "redis", port: Number(process.env.REDIS_PORT ?? "6379") };
const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const queueName = `marketplace-sync-test-${suffix}`;
process.env.MARKETPLACE_ENABLE_MOCK_ADAPTER = "true";

const waitFor = async <T>(read: () => Promise<T | null>, timeoutMs = 15000): Promise<T> => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) { const value = await read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error("MARKETPLACE_TEST_TIMEOUT");
};

async function createRun(connectionId: string, cursor: string) {
  return prisma.marketplaceSyncRun.create({ data: { connectionId, syncType: MarketplaceSyncType.INCREMENTAL, triggerType: MarketplaceSyncTrigger.SYSTEM, status: MarketplaceSyncStatus.QUEUED, startCursor: cursor } });
}

async function cleanConnection(connectionId: string): Promise<void> {
  const runs = await prisma.marketplaceSyncRun.findMany({ where: { connectionId }, select: { id: true, batchId: true } });
  await prisma.marketplaceSyncError.deleteMany({ where: { syncRunId: { in: runs.map(run => run.id) } } });
  for (const run of runs) if (run.batchId) { await prisma.order.deleteMany({ where: { batchId: run.batchId } }); await prisma.batch.delete({ where: { id: run.batchId } }); }
  await prisma.marketplaceSyncRun.deleteMany({ where: { connectionId } });
  await prisma.marketplaceExternalOrder.deleteMany({ where: { connectionId } });
  await prisma.marketplaceConnection.delete({ where: { id: connectionId } });
}

async function run(): Promise<void> {
  const { startMarketplaceSyncWorker } = await import("./marketplace-sync.worker.js");
  let worker = startMarketplaceSyncWorker({ queueName, concurrency: 2 });
  const queue = new Queue<{ connectionId: string; syncRunId: string }>(queueName, { connection: redis });
  const connections: string[] = [];
  const connection = async (scenario: string) => {
    const created = await prisma.marketplaceConnection.create({ data: { platform: Platform.SHOPEE, externalShopId: `${scenario}-${suffix}`, status: MarketplaceConnectionStatus.ACTIVE, syncCursor: scenario } });
    connections.push(created.id); return created;
  };
  const enqueue = async (run: { id: string; connectionId: string }) => queue.add("sync-marketplace", { connectionId: run.connectionId, syncRunId: run.id }, { jobId: getMarketplaceSyncJobId(run.id), attempts: 2, backoff: { type: "exponential", delay: 10 } });
  const terminal = (id: string) => waitFor(async () => { const run = await prisma.marketplaceSyncRun.findUniqueOrThrow({ where: { id }, include: { errors: true } }); return run.status === MarketplaceSyncStatus.SUCCESS || run.status === MarketplaceSyncStatus.ERROR ? run : null; });
  try {
    const successful = await connection("mock-success");
    const successRun = await createRun(successful.id, "mock-success"); await enqueue(successRun); const completed = await terminal(successRun.id);
    assert.equal(completed.status, MarketplaceSyncStatus.SUCCESS); assert.equal(completed.ordersCreated, 2); assert.ok(completed.batchId);
    assert.equal(await prisma.marketplaceExternalOrder.count({ where: { connectionId: successful.id } }), 2);
    assert.equal(await prisma.order.count({ where: { batchId: completed.batchId! } }), 2);
    const stored = await prisma.marketplaceExternalOrder.findUniqueOrThrow({ where: { connectionId_marketplaceOrderId: { connectionId: successful.id, marketplaceOrderId: "TEST-MKT-001" } } });
    assert.deepEqual(stored.rawData, { mockProviderOrderId: "TEST-MKT-001", providerPayloadVersion: "v2", updatedAt: "2026-01-02T00:00:00.000Z" });
    assert.notDeepEqual(stored.rawData, stored.normalizedData); assert.equal((await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: successful.id } })).syncCursor, "complete:mock-success");

    const replay = await createRun(successful.id, "mock-replay"); await enqueue(replay); const replayDone = await terminal(replay.id);
    assert.equal(replayDone.ordersCreated, 0); assert.equal(replayDone.ordersUpdated, 0); assert.equal(replayDone.batchId, null); assert.equal(await prisma.marketplaceExternalOrder.count({ where: { connectionId: successful.id } }), 2);

    const updated = await connection("mock-update");
    await prisma.marketplaceExternalOrder.create({ data: { connectionId: updated.id, marketplaceOrderId: "TEST-MKT-UPDATE-001", rawProviderStatus: "OLD", providerUpdatedAt: new Date("2026-01-01T00:00:00.000Z"), rawData: {}, normalizedData: {} } });
    const updateRun = await createRun(updated.id, "mock-update"); await enqueue(updateRun); const updateDone = await terminal(updateRun.id);
    assert.equal(updateDone.ordersUpdated, 1); assert.equal((await prisma.marketplaceExternalOrder.findUniqueOrThrow({ where: { connectionId_marketplaceOrderId: { connectionId: updated.id, marketplaceOrderId: "TEST-MKT-UPDATE-001" } } })).rawProviderStatus, "UPDATED");
    const oldRun = await createRun(updated.id, "mock-old-update"); await enqueue(oldRun); const oldDone = await terminal(oldRun.id); assert.equal(oldDone.ordersUpdated, 0);

    const transient = await connection("mock-transient"); const transientRun = await createRun(transient.id, "mock-transient"); const transientJob = await enqueue(transientRun); const transientDone = await terminal(transientRun.id);
    assert.equal(transientDone.status, MarketplaceSyncStatus.SUCCESS); assert.equal((await queue.getJob(String(transientJob.id)))?.attemptsMade, 2);

    const malformed = await connection("mock-malformed"); const malformedRun = await createRun(malformed.id, "mock-malformed"); const malformedJob = await enqueue(malformedRun); const malformedDone = await terminal(malformedRun.id);
    assert.equal(malformedDone.status, MarketplaceSyncStatus.ERROR); assert.equal(malformedDone.batchId, null); assert.equal(malformedDone.errors.length, 1); assert.equal((await malformedJob.getState()), "failed");

    const partial = await connection("mock-partial"); const partialRun = await createRun(partial.id, "mock-partial"); await enqueue(partialRun); const partialDone = await terminal(partialRun.id);
    assert.equal(partialDone.status, MarketplaceSyncStatus.ERROR); assert.equal(partialDone.batchId, null); assert.equal(await prisma.marketplaceExternalOrder.count({ where: { connectionId: partial.id } }), 0); assert.equal((await prisma.marketplaceConnection.findUniqueOrThrow({ where: { id: partial.id } })).syncCursor, "mock-partial");

    const first = await connection("mock-success-2"); const second = await connection("mock-empty"); const firstRun = await createRun(first.id, "mock-success-2"); const secondRun = await createRun(second.id, "mock-empty"); await Promise.all([enqueue(firstRun), enqueue(secondRun)]); const [firstDone, secondDone] = await Promise.all([terminal(firstRun.id), terminal(secondRun.id)]);
    assert.equal(firstDone.status, MarketplaceSyncStatus.SUCCESS); assert.equal(secondDone.status, MarketplaceSyncStatus.SUCCESS); assert.equal(secondDone.batchId, null);

    await worker.close();
    const restart = await connection("mock-empty-restart"); const restartRun = await createRun(restart.id, "mock-empty-restart"); await enqueue(restartRun);
    worker = startMarketplaceSyncWorker({ queueName, concurrency: 2 });
    assert.equal((await terminal(restartRun.id)).status, MarketplaceSyncStatus.SUCCESS);
  } finally {
    await worker.close(); await queue.close();
    for (const id of connections) await cleanConnection(id).catch(() => undefined);
    await prisma.$disconnect();
  }
  console.log("marketplace sync worker tests passed");
}

void run().catch((error: unknown) => { console.error(error instanceof Error ? error.stack ?? error.message : "Marketplace sync test failed"); process.exitCode = 1; });
