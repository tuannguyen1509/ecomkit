import { ConflictException, Injectable, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { MarketplaceConnectionStatus, MarketplaceSyncStatus, MarketplaceSyncTrigger, MarketplaceSyncType, prisma } from "@ecomkit/database";
import { Queue } from "bullmq";
import { getMarketplaceSyncJobId } from "@ecomkit/shared";

export const MARKETPLACE_SYNC_QUEUE_NAME = process.env.MARKETPLACE_SYNC_QUEUE_NAME ?? "marketplace-sync";
const connection = { host: process.env.REDIS_HOST ?? "redis", port: Number(process.env.REDIS_PORT ?? "6379") };
const activeStatuses: MarketplaceSyncStatus[] = [MarketplaceSyncStatus.PENDING, MarketplaceSyncStatus.QUEUED, MarketplaceSyncStatus.PROCESSING];
const queueOperationTimeoutMs = Number(process.env.QUEUE_OPERATION_TIMEOUT_MS ?? "5000");

const withQueueTimeout = async <T>(operation: Promise<T>): Promise<T> => Promise.race([
  operation,
  new Promise<T>((_, reject) => setTimeout(() => reject(new Error("MARKETPLACE_QUEUE_OPERATION_TIMEOUT")), queueOperationTimeoutMs))
]);

export type MarketplaceSyncRequest = { connectionId: string; triggeredByUserId?: string; triggerType?: MarketplaceSyncTrigger; syncType?: MarketplaceSyncType };
export type MarketplaceSyncJobPayload = { connectionId: string; syncRunId: string };

@Injectable()
export class MarketplaceSyncQueueService implements OnModuleDestroy {
  private readonly queue = new Queue<MarketplaceSyncJobPayload>(MARKETPLACE_SYNC_QUEUE_NAME, { connection: { ...connection, maxRetriesPerRequest: 1, connectTimeout: 3000 } });

  async requestSync(input: MarketplaceSyncRequest): Promise<{ syncRunId: string; jobId: string; status: "QUEUED" }> {
    const run = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.connectionId}))`;
      const marketplaceConnection = await tx.marketplaceConnection.findUnique({ where: { id: input.connectionId }, select: { id: true, status: true, syncCursor: true } });
      if (!marketplaceConnection) throw new ConflictException({ errorCode: "MARKETPLACE_CONNECTION_NOT_FOUND", message: "Marketplace connection was not found." });
      if (marketplaceConnection.status !== MarketplaceConnectionStatus.ACTIVE) {
        throw new ConflictException({ errorCode: "MARKETPLACE_CONNECTION_NOT_ACTIVE", message: "Marketplace connection must be active before sync." });
      }
      const active = await tx.marketplaceSyncRun.findFirst({ where: { connectionId: input.connectionId, status: { in: activeStatuses } }, select: { id: true } });
      if (active) throw new ConflictException({ errorCode: "MARKETPLACE_SYNC_ALREADY_ACTIVE", message: "Marketplace connection already has an active sync." });
      return tx.marketplaceSyncRun.create({ data: {
        connectionId: input.connectionId,
        syncType: input.syncType ?? MarketplaceSyncType.INCREMENTAL,
        triggerType: input.triggerType ?? MarketplaceSyncTrigger.MANUAL,
        triggeredByUserId: input.triggeredByUserId,
        status: MarketplaceSyncStatus.PENDING,
        startCursor: marketplaceConnection.syncCursor
      }, select: { id: true } });
    });

    const jobId = getMarketplaceSyncJobId(run.id);
    try {
      await withQueueTimeout(this.queue.add("sync-marketplace", { connectionId: input.connectionId, syncRunId: run.id }, {
        jobId,
        attempts: 2,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 }
      }));
      await prisma.marketplaceSyncRun.update({ where: { id: run.id }, data: { status: MarketplaceSyncStatus.QUEUED } });
      return { syncRunId: run.id, jobId, status: "QUEUED" };
    } catch (error) {
      await prisma.$transaction(async (tx) => {
        await tx.marketplaceSyncRun.update({ where: { id: run.id }, data: { status: MarketplaceSyncStatus.ERROR, completedAt: new Date(), errorCount: 1 } });
        await tx.marketplaceSyncError.create({ data: { syncRunId: run.id, operation: "ENQUEUE", internalCode: "MARKETPLACE_QUEUE_UNAVAILABLE", retryable: false, message: "Marketplace sync could not be queued.", suggestedAction: "Check the queue service and retry the sync." } });
      }).catch(() => undefined);
      throw new ServiceUnavailableException({ errorCode: "MARKETPLACE_QUEUE_UNAVAILABLE", message: "Marketplace sync could not be queued." }, { cause: error as Error });
    }
  }

  async onModuleDestroy(): Promise<void> { await this.queue.close(); }
}
