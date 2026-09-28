import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { MarketplaceConnectionStatus, Platform, prisma } from "@ecomkit/database";

const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
process.env.MARKETPLACE_SYNC_QUEUE_NAME = `marketplace-sync-outage-${suffix}`;
process.env.QUEUE_OPERATION_TIMEOUT_MS = "3500";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "response" in error
    ? (error as { response?: { errorCode?: string } }).response?.errorCode
    : undefined;
}

async function run(): Promise<void> {
  const { MarketplaceSyncQueueService } = await import("./marketplace-sync-queue.service.js");
  const service = new MarketplaceSyncQueueService();
  const marketplaceConnection = await prisma.marketplaceConnection.create({
    data: {
      platform: Platform.SHOPEE,
      externalShopId: `mock-outage-${suffix}`,
      status: MarketplaceConnectionStatus.ACTIVE
    }
  });

  try {
    await assert.rejects(
      () => service.requestSync({ connectionId: marketplaceConnection.id }),
      (error: unknown) => errorCode(error) === "MARKETPLACE_QUEUE_UNAVAILABLE"
    );
    const run = await prisma.marketplaceSyncRun.findFirstOrThrow({
      where: { connectionId: marketplaceConnection.id },
      include: { errors: true }
    });
    assert.equal(run.status, "ERROR");
    assert.ok(run.completedAt);
    assert.equal(run.batchId, null);
    assert.equal(run.errors.length, 1);
    assert.equal(run.errors[0]?.internalCode, "MARKETPLACE_QUEUE_UNAVAILABLE");
    assert.equal(await prisma.marketplaceExternalOrder.count({ where: { connectionId: marketplaceConnection.id } }), 0);
    console.log("marketplace Redis outage regression test passed");
  } finally {
    await prisma.marketplaceSyncError.deleteMany({ where: { syncRun: { connectionId: marketplaceConnection.id } } });
    await prisma.marketplaceSyncRun.deleteMany({ where: { connectionId: marketplaceConnection.id } });
    await prisma.marketplaceConnection.delete({ where: { id: marketplaceConnection.id } });
    await service.onModuleDestroy();
    await prisma.$disconnect();
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "marketplace Redis outage regression test failed");
  process.exitCode = 1;
});
