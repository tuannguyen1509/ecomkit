import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { Queue } from "bullmq";
import { MarketplaceConnectionStatus, Platform, prisma } from "@ecomkit/database";

const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const queueName = `marketplace-sync-api-test-${suffix}`;
process.env.MARKETPLACE_SYNC_QUEUE_NAME = queueName;
const redis = { host: process.env.REDIS_HOST ?? "redis", port: Number(process.env.REDIS_PORT ?? "6379") };

async function run(): Promise<void> {
  const { MarketplaceSyncQueueService } = await import("./marketplace-sync-queue.service.js");
  const service = new MarketplaceSyncQueueService();
  const queue = new Queue<{ connectionId: string; syncRunId: string }>(queueName, { connection: redis });
  const connection = await prisma.marketplaceConnection.create({ data: { platform: Platform.SHOPEE, externalShopId: `mock-api-race-${suffix}`, status: MarketplaceConnectionStatus.ACTIVE } });
  const disabled = await prisma.marketplaceConnection.create({ data: { platform: Platform.SHOPEE, externalShopId: `mock-api-disabled-${suffix}`, status: MarketplaceConnectionStatus.DISABLED } });
  const reauth = await prisma.marketplaceConnection.create({ data: { platform: Platform.SHOPEE, externalShopId: `mock-api-reauth-${suffix}`, status: MarketplaceConnectionStatus.REAUTH_REQUIRED } });
  try {
    const [first, second] = await Promise.allSettled([service.requestSync({ connectionId: connection.id }), service.requestSync({ connectionId: connection.id })]);
    const fulfilled = [first, second].filter((result): result is PromiseFulfilledResult<{ syncRunId: string; jobId: string; status: "QUEUED" }> => result.status === "fulfilled");
    const rejected = [first, second].filter(result => result.status === "rejected");
    assert.equal(fulfilled.length, 1); assert.equal(rejected.length, 1);
    const job = await queue.getJob(fulfilled[0].value.jobId);
    assert.deepEqual(job?.data, { connectionId: connection.id, syncRunId: fulfilled[0].value.syncRunId });
    const runs = await prisma.marketplaceSyncRun.findMany({ where: { connectionId: connection.id } });
    assert.equal(runs.length, 1); assert.equal(runs[0].status, "QUEUED");
    assert.ok(runs[0].windowEnd, "incremental run must persist its deterministic upper bound");
    await job?.remove();
    await assert.rejects(() => service.requestSync({ connectionId: disabled.id }));
    await assert.rejects(() => service.requestSync({ connectionId: reauth.id }));
    assert.equal(await prisma.marketplaceSyncRun.count({ where: { connectionId: { in: [disabled.id, reauth.id] } } }), 0);
  } finally {
    await prisma.marketplaceSyncError.deleteMany({ where: { syncRun: { connectionId: connection.id } } });
    await prisma.marketplaceSyncRun.deleteMany({ where: { connectionId: connection.id } });
    await prisma.marketplaceConnection.delete({ where: { id: connection.id } });
    await prisma.marketplaceConnection.delete({ where: { id: disabled.id } });
    await prisma.marketplaceConnection.delete({ where: { id: reauth.id } });
    await queue.close(); await service.onModuleDestroy(); await prisma.$disconnect();
  }
  console.log("marketplace sync queue tests passed");
}

void run().catch((error: unknown) => { console.error(error instanceof Error ? error.stack ?? error.message : "Marketplace sync queue test failed"); process.exitCode = 1; });
