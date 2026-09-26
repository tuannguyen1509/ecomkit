import { randomUUID } from "node:crypto";
import { UnrecoverableError, Worker } from "bullmq";
import { MarketplaceConnectionStatus, MarketplaceSyncStatus, Platform, prisma } from "@ecomkit/database";
import type { Prisma } from "@ecomkit/database";
import { decryptMarketplaceCredential, getMarketplaceSyncJobId } from "@ecomkit/shared";
import type { MarketplaceAdapter, NormalizedMarketplaceOrder } from "@ecomkit/shared";
import { MarketplaceMockAdapter, MarketplaceMockError } from "./marketplace-mock.adapter.js";

export const MARKETPLACE_SYNC_QUEUE_NAME = process.env.MARKETPLACE_SYNC_QUEUE_NAME ?? "marketplace-sync";
const redisConnection = { host: process.env.REDIS_HOST ?? "redis", port: Number(process.env.REDIS_PORT ?? "6379") };
const concurrency = Number(process.env.MARKETPLACE_SYNC_CONCURRENCY ?? "2");
const lockTtlMs = Number(process.env.MARKETPLACE_SYNC_LOCK_TTL_MS ?? "300000");
export type MarketplaceSyncJobData = { connectionId: string; syncRunId: string };

class MarketplaceSyncExecutionError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean, public readonly operation: string, public readonly httpStatus?: number, public readonly suggestedAction?: string) {
    super(code);
    this.name = "MarketplaceSyncExecutionError";
  }
}

function registry(): Map<Platform, MarketplaceAdapter> {
  const adapters = new Map<Platform, MarketplaceAdapter>();
  if (process.env.MARKETPLACE_ENABLE_MOCK_ADAPTER === "true") adapters.set(Platform.SHOPEE, new MarketplaceMockAdapter());
  return adapters;
}

function safeOrderData(order: NormalizedMarketplaceOrder): Record<string, unknown> {
  return { marketplaceOrderId: order.marketplaceOrderId, rawProviderStatus: order.rawProviderStatus, providerCreatedAt: order.providerCreatedAt, providerUpdatedAt: order.providerUpdatedAt, currency: order.currency, items: order.items ?? [], providerMetadata: order.providerMetadata ?? {} };
}

async function recordTerminalError(syncRunId: string, error: MarketplaceSyncExecutionError): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.marketplaceSyncError.findFirst({ where: { syncRunId, operation: error.operation, internalCode: error.code }, select: { id: true } });
    if (!existing) await tx.marketplaceSyncError.create({ data: { syncRunId, operation: error.operation, internalCode: error.code, httpStatus: error.httpStatus, retryable: error.retryable, message: "Marketplace synchronization failed.", suggestedAction: error.suggestedAction, safeContext: { operation: error.operation } } });
    await tx.marketplaceSyncRun.update({ where: { id: syncRunId }, data: { status: MarketplaceSyncStatus.ERROR, completedAt: new Date(), errorCount: 1 } });
  });
}

async function upsertOrder(connectionId: string, order: NormalizedMarketplaceOrder): Promise<"created" | "updated" | "unchanged"> {
  if (!order.marketplaceOrderId?.trim()) throw new MarketplaceSyncExecutionError("MARKETPLACE_ORDER_ID_REQUIRED", false, "NORMALIZE_ORDER", 422, "Correct the source order identifier and retry.");
  const incomingUpdatedAt = order.providerUpdatedAt ? new Date(order.providerUpdatedAt) : null;
  if (incomingUpdatedAt && Number.isNaN(incomingUpdatedAt.valueOf())) throw new MarketplaceSyncExecutionError("MARKETPLACE_ORDER_TIMESTAMP_INVALID", false, "NORMALIZE_ORDER", 422);
  const existing = await prisma.marketplaceExternalOrder.findFirst({ where: { connectionId, marketplaceOrderId: order.marketplaceOrderId } });
  if (existing?.providerUpdatedAt && incomingUpdatedAt && existing.providerUpdatedAt >= incomingUpdatedAt) {
    await prisma.marketplaceExternalOrder.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } });
    return "unchanged";
  }
  const snapshot = safeOrderData(order) as Prisma.InputJsonValue;
  const data = { rawProviderStatus: order.rawProviderStatus, providerCreatedAt: order.providerCreatedAt ? new Date(order.providerCreatedAt) : null, providerUpdatedAt: incomingUpdatedAt, lastSeenAt: new Date(), rawData: snapshot, normalizedData: snapshot };
  if (!existing) { await prisma.marketplaceExternalOrder.create({ data: { connectionId, marketplaceOrderId: order.marketplaceOrderId, ...data } }); return "created"; }
  await prisma.marketplaceExternalOrder.update({ where: { id: existing.id }, data });
  return "updated";
}

async function materializeBatch(connectionId: string, syncRunId: string, platform: Platform, externalShopId: string, orders: NormalizedMarketplaceOrder[]): Promise<string | null> {
  if (!orders.length) return null;
  const codes = new Set<string>();
  for (const order of orders) { if (codes.has(order.marketplaceOrderId)) throw new MarketplaceSyncExecutionError("MARKETPLACE_ORDER_ID_DUPLICATE", false, "NORMALIZE_ORDER", 422); codes.add(order.marketplaceOrderId); }
  return prisma.$transaction(async (tx) => {
    const run = await tx.marketplaceSyncRun.findUniqueOrThrow({ where: { id: syncRunId }, select: { batchId: true } });
    if (run.batchId) return run.batchId;
    const batch = await tx.batch.create({ data: { processingStatus: "SUCCESS", startedAt: new Date(), finishedAt: new Date(), orderCount: orders.length, warningCount: orders.length } });
    await tx.order.createMany({ data: orders.map((order) => ({ batchId: batch.id, rawOrderCode: order.marketplaceOrderId, normalizedOrderCode: order.marketplaceOrderId.trim(), platform, matchingStatus: "PDF_NOT_FOUND", orderStatus: order.rawProviderStatus, sourceRefs: { sourceType: "MARKETPLACE_API", platform, connectionId, externalShopId, marketplaceOrderId: order.marketplaceOrderId, syncRunId } })) });
    await tx.marketplaceSyncRun.update({ where: { id: syncRunId }, data: { batchId: batch.id } });
    return batch.id;
  });
}

export function startMarketplaceSyncWorker(options?: { queueName?: string; concurrency?: number }): Worker<MarketplaceSyncJobData> {
  const adapters = registry();
  const worker = new Worker<MarketplaceSyncJobData>(options?.queueName ?? MARKETPLACE_SYNC_QUEUE_NAME, async (job) => {
    const lockKey = `marketplace-sync-lock-${job.data.connectionId}`;
    const ownership = randomUUID();
    const client = await worker.client;
    const acquired = await client.set(lockKey, ownership, "PX", lockTtlMs, "NX");
    if (acquired !== "OK") throw new MarketplaceSyncExecutionError("MARKETPLACE_CONNECTION_LOCKED", true, "SYNC_ORDERS", 409, "The connection is already being synchronized.");
    try {
      const run = await prisma.marketplaceSyncRun.findUnique({ where: { id: job.data.syncRunId }, include: { connection: true } });
      if (!run || run.connectionId !== job.data.connectionId) throw new MarketplaceSyncExecutionError("MARKETPLACE_SYNC_RUN_NOT_FOUND", false, "SYNC_ORDERS", 404);
      if (run.status === MarketplaceSyncStatus.SUCCESS) return { syncRunId: run.id, batchId: run.batchId };
      if (run.connection.status !== MarketplaceConnectionStatus.ACTIVE) throw new MarketplaceSyncExecutionError("MARKETPLACE_CONNECTION_NOT_ACTIVE", false, "SYNC_ORDERS", 409, "Activate or reconnect the marketplace connection before syncing.");
      const adapter = adapters.get(run.connection.platform);
      if (!adapter) throw new MarketplaceSyncExecutionError("MARKETPLACE_ADAPTER_NOT_REGISTERED", false, "LIST_ORDERS", 501);
      let credential;
      if (adapter.requiresCredential) {
        if (!run.connection.credentialEnvelope) throw new MarketplaceSyncExecutionError("MARKETPLACE_CONNECTION_CREDENTIAL_MISSING", false, "LIST_ORDERS", 409);
        credential = decryptMarketplaceCredential(run.connection.credentialEnvelope, process.env.MARKETPLACE_CREDENTIAL_ENCRYPTION_KEY);
      }
      await prisma.$transaction(async (tx) => {
        await tx.marketplaceSyncRun.update({ where: { id: run.id }, data: { status: MarketplaceSyncStatus.PROCESSING, startedAt: run.startedAt ?? new Date() } });
        await tx.marketplaceConnection.update({ where: { id: run.connectionId }, data: { lastAttemptedSyncAt: new Date() } });
      });
      let cursor: string | null | undefined = run.startCursor ?? run.connection.syncCursor;
      const startCursor = cursor ?? `mock-${run.connection.externalShopId.replace(/^mock-/, "")}`;
      const allOrders: NormalizedMarketplaceOrder[] = [];
      let created = 0, updated = 0, normalized = 0, fetched = 0;
      do {
        let page;
        try { page = await adapter.listOrders(credential, { cursor: cursor ?? startCursor, windowStart: run.windowStart ?? undefined, windowEnd: run.windowEnd ?? undefined }); }
        catch (error) { if (error instanceof MarketplaceMockError) throw new MarketplaceSyncExecutionError(error.code, error.retryable, "LIST_ORDERS", error.httpStatus, error.retryable ? "The system will retry automatically." : "Review the marketplace source scenario."); throw error; }
        fetched += page.orders.length;
        for (const order of page.orders) { const result = await upsertOrder(run.connectionId, order); if (result === "created") created++; if (result === "updated") updated++; normalized++; allOrders.push(order); }
        cursor = page.nextCursor;
      } while (cursor);
      const batchId = await materializeBatch(run.connectionId, run.id, run.connection.platform, run.connection.externalShopId, created + updated > 0 ? allOrders : []);
      await prisma.$transaction(async (tx) => {
        await tx.marketplaceSyncRun.update({ where: { id: run.id }, data: { status: MarketplaceSyncStatus.SUCCESS, completedAt: new Date(), resultCursor: cursor ?? `complete:${startCursor}`, ordersFetched: fetched, ordersNormalized: normalized, ordersCreated: created, ordersUpdated: updated } });
        await tx.marketplaceConnection.update({ where: { id: run.connectionId }, data: { syncCursor: cursor ?? `complete:${startCursor}`, lastSuccessfulSyncAt: new Date() } });
      });
      return { syncRunId: run.id, batchId };
    } catch (error) {
      const normalizedError = error instanceof MarketplaceSyncExecutionError ? error : new MarketplaceSyncExecutionError("MARKETPLACE_SYNC_UNEXPECTED_FAILURE", true, "SYNC_ORDERS");
      const attempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
      if (!normalizedError.retryable || job.attemptsMade + 1 >= attempts) await recordTerminalError(job.data.syncRunId, normalizedError).catch(() => undefined);
      if (normalizedError.retryable) throw normalizedError;
      throw new UnrecoverableError(normalizedError.code);
    } finally {
      await client.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0", 1, lockKey, ownership).catch(() => undefined);
    }
  }, { connection: redisConnection, concurrency: options?.concurrency ?? concurrency });
  worker.on("failed", (job, error) => console.error("Marketplace sync job failed", job?.id, error.message));
  return worker;
}

export { MarketplaceSyncExecutionError };
