import { randomUUID } from "node:crypto";
import { UnrecoverableError, Worker } from "bullmq";
import { MarketplaceConnectionStatus, MarketplaceSyncStatus, Platform, prisma } from "@ecomkit/database";
import type { Prisma } from "@ecomkit/database";
import { getMarketplaceSyncJobId } from "@ecomkit/shared";
import type { MarketplaceAdapter, MarketplaceAdapterContext, MarketplaceAdapterOrder } from "@ecomkit/shared";
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

async function recordTerminalError(syncRunId: string, error: MarketplaceSyncExecutionError): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.marketplaceSyncError.findFirst({ where: { syncRunId, operation: error.operation, internalCode: error.code }, select: { id: true } });
    if (!existing) await tx.marketplaceSyncError.create({ data: { syncRunId, operation: error.operation, internalCode: error.code, httpStatus: error.httpStatus, retryable: error.retryable, message: "Marketplace synchronization failed.", suggestedAction: error.suggestedAction, safeContext: { operation: error.operation } } });
    await tx.marketplaceSyncRun.update({ where: { id: syncRunId }, data: { status: MarketplaceSyncStatus.ERROR, completedAt: new Date(), errorCount: 1 } });
  });
}

function isJsonSafe(value: unknown): value is Record<string, unknown> {
  try { return typeof value === "object" && value !== null && JSON.parse(JSON.stringify(value)) !== undefined; } catch { return false; }
}
function containsCredentialField(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) {
    if (["accesstoken", "access_token", "refreshtoken", "refresh_token", "partnerkey", "partner_key", "credentialenvelope", "credential_envelope"].includes(key.toLowerCase()) || containsCredentialField(child)) return true;
  }
  return false;
}

function validateAdapterOrder(order: MarketplaceAdapterOrder): void {
  if (!order.marketplaceOrderId?.trim() || !order.rawOrderCode?.trim()) throw new MarketplaceSyncExecutionError("MARKETPLACE_ORDER_ID_REQUIRED", false, "NORMALIZE_ORDER", 422, "Correct the source order identifier and retry.");
  if (order.normalizedData.marketplaceOrderId !== order.marketplaceOrderId) throw new MarketplaceSyncExecutionError("MARKETPLACE_ORDER_ID_MISMATCH", false, "NORMALIZE_ORDER", 422);
  if (!isJsonSafe(order.rawData) || !isJsonSafe(order.normalizedData) || containsCredentialField(order.rawData) || containsCredentialField(order.normalizedData)) throw new MarketplaceSyncExecutionError("MARKETPLACE_ORDER_SNAPSHOT_INVALID", false, "NORMALIZE_ORDER", 422);
  if (!order.providerUpdatedAt || Number.isNaN(new Date(order.providerUpdatedAt).valueOf()) || (order.normalizedData.providerUpdatedAt && order.normalizedData.providerUpdatedAt !== order.providerUpdatedAt)) throw new MarketplaceSyncExecutionError("MARKETPLACE_ORDER_TIMESTAMP_INVALID", false, "NORMALIZE_ORDER", 422);
}

async function upsertOrder(connectionId: string, adapterOrder: MarketplaceAdapterOrder): Promise<"created" | "updated" | "unchanged"> {
  validateAdapterOrder(adapterOrder);
  const order = adapterOrder.normalizedData;
  if (!order.marketplaceOrderId?.trim()) throw new MarketplaceSyncExecutionError("MARKETPLACE_ORDER_ID_REQUIRED", false, "NORMALIZE_ORDER", 422, "Correct the source order identifier and retry.");
  const incomingUpdatedAt = adapterOrder.providerUpdatedAt ? new Date(adapterOrder.providerUpdatedAt) : order.providerUpdatedAt ? new Date(order.providerUpdatedAt) : null;
  if (incomingUpdatedAt && Number.isNaN(incomingUpdatedAt.valueOf())) throw new MarketplaceSyncExecutionError("MARKETPLACE_ORDER_TIMESTAMP_INVALID", false, "NORMALIZE_ORDER", 422);
  const existing = await prisma.marketplaceExternalOrder.findFirst({ where: { connectionId, marketplaceOrderId: order.marketplaceOrderId } });
  if (existing?.providerUpdatedAt && incomingUpdatedAt && existing.providerUpdatedAt >= incomingUpdatedAt) {
    await prisma.marketplaceExternalOrder.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } });
    return "unchanged";
  }
  const rawSnapshot = adapterOrder.rawData as Prisma.InputJsonValue;
  const normalizedSnapshot = adapterOrder.normalizedData as Prisma.InputJsonValue;
  const data = { rawProviderStatus: order.rawProviderStatus, providerCreatedAt: order.providerCreatedAt ? new Date(order.providerCreatedAt) : null, providerUpdatedAt: incomingUpdatedAt, lastSeenAt: new Date(), rawData: rawSnapshot, normalizedData: normalizedSnapshot };
  if (!existing) { await prisma.marketplaceExternalOrder.create({ data: { connectionId, marketplaceOrderId: order.marketplaceOrderId, ...data } }); return "created"; }
  await prisma.marketplaceExternalOrder.update({ where: { id: existing.id }, data });
  return "updated";
}

async function materializeBatch(connectionId: string, syncRunId: string, platform: Platform, externalShopId: string, orders: MarketplaceAdapterOrder[]): Promise<string | null> {
  if (!orders.length) return null;
  const codes = new Set<string>();
  for (const order of orders) { if (codes.has(order.marketplaceOrderId)) throw new MarketplaceSyncExecutionError("MARKETPLACE_ORDER_ID_DUPLICATE", false, "NORMALIZE_ORDER", 422); codes.add(order.marketplaceOrderId); }
  return prisma.$transaction(async (tx) => {
    const run = await tx.marketplaceSyncRun.findUniqueOrThrow({ where: { id: syncRunId }, select: { batchId: true } });
    if (run.batchId) return run.batchId;
    const batch = await tx.batch.create({ data: { processingStatus: "SUCCESS", startedAt: new Date(), finishedAt: new Date(), orderCount: orders.length, warningCount: orders.length } });
    await tx.order.createMany({ data: orders.map((order) => ({ batchId: batch.id, rawOrderCode: order.rawOrderCode, normalizedOrderCode: order.marketplaceOrderId.trim(), platform, matchingStatus: "PDF_NOT_FOUND", orderStatus: order.normalizedData.rawProviderStatus, sourceRefs: { sourceType: "MARKETPLACE_API", platform, connectionId, externalShopId, marketplaceOrderId: order.marketplaceOrderId, syncRunId } })) });
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
      const context: MarketplaceAdapterContext = { connectionId: run.connectionId, platform: run.connection.platform as MarketplaceAdapterContext["platform"], externalShopId: run.connection.externalShopId, syncRunId: run.id };
      await prisma.$transaction(async (tx) => {
        await tx.marketplaceSyncRun.update({ where: { id: run.id }, data: { status: MarketplaceSyncStatus.PROCESSING, startedAt: run.startedAt ?? new Date() } });
        await tx.marketplaceConnection.update({ where: { id: run.connectionId }, data: { lastAttemptedSyncAt: new Date() } });
      });
      const committedCheckpoint = run.startCursor ?? run.connection.syncCursor;
      const allOrders: MarketplaceAdapterOrder[] = [];
      let created = 0, updated = 0, normalized = 0, fetched = 0;
      let result;
      try { result = await adapter.syncOrders(context, { syncType: run.syncType, windowStart: run.windowStart, windowEnd: run.windowEnd, committedCheckpoint }); }
      catch (error) { if (error instanceof MarketplaceMockError) throw new MarketplaceSyncExecutionError(error.code, error.retryable, "SYNC_ORDERS", error.httpStatus, error.retryable ? "The system will retry automatically." : "Review the marketplace source scenario."); throw error; }
      fetched = result.orders.length;
      for (const order of result.orders) { const write = await upsertOrder(run.connectionId, order); if (write === "created") created++; if (write === "updated") updated++; normalized++; allOrders.push(order); }
      const batchId = await materializeBatch(run.connectionId, run.id, run.connection.platform, run.connection.externalShopId, created + updated > 0 ? allOrders : []);
      await prisma.$transaction(async (tx) => {
        await tx.marketplaceSyncRun.update({ where: { id: run.id }, data: { status: MarketplaceSyncStatus.SUCCESS, completedAt: new Date(), resultCursor: result.candidateCheckpoint ?? committedCheckpoint, ordersFetched: fetched, ordersNormalized: normalized, ordersCreated: created, ordersUpdated: updated } });
        await tx.marketplaceConnection.update({ where: { id: run.connectionId }, data: { ...(result.candidateCheckpoint !== undefined ? { syncCursor: result.candidateCheckpoint } : {}), lastSuccessfulSyncAt: new Date() } });
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
