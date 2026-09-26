import { UnrecoverableError, Worker } from "bullmq";
import { prisma } from "@ecomkit/database";
import { requireWorkerInternalApiKey } from "./worker-config.js";
import { startMarketplaceSyncWorker, MARKETPLACE_SYNC_QUEUE_NAME } from "./marketplace-sync.worker.js";

const queueName = process.env.QUEUE_BATCH_PROCESSING_NAME ?? "batch-processing";
const connection = { host: process.env.REDIS_HOST ?? "redis", port: Number(process.env.REDIS_PORT ?? "6379") };
const apiBase = process.env.API_INTERNAL_URL ?? "http://api:3001/api";
const timeout = Number(process.env.INTERNAL_API_TIMEOUT_MS ?? "30000");
const workerInternalApiKey = requireWorkerInternalApiKey();

function nonRetryable(message: string): UnrecoverableError {
  return new UnrecoverableError(message);
}

async function log(batchId: string, level: "INFO" | "ERROR", message: string): Promise<void> {
  await prisma.processingLog.create({ data: { batchId, level, message } });
}

async function call(batchId: string, path: string): Promise<{ status?: string }> {
  try {
    const response = await fetch(`${apiBase}/batches/${batchId}${path}`, {
      method: "POST",
      headers: { "X-Ecomkit-Worker-Key": workerInternalApiKey },
      signal: AbortSignal.timeout(timeout)
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { errorCode?: string } | null;
      const message = `PIPELINE_${path}_${response.status}${body?.errorCode ? `:${body.errorCode}` : ""}`;
      if ([400, 404, 409, 422].includes(response.status)) throw nonRetryable(message);
      throw new Error(message);
    }
    return response.json() as Promise<{ status?: string }>;
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") throw new Error(`INTERNAL_API_TIMEOUT:${path}`);
    throw error;
  }
}

const worker = new Worker<{ batchId: string }>(queueName, async (job) => {
  const { batchId } = job.data;
  await prisma.batch.update({ where: { id: batchId }, data: { processingStatus: "PROCESSING", startedAt: new Date(), finishedAt: null } });
  try {
    await log(batchId, "INFO", "Batch processing started.");
    await job.updateProgress(10);
    await log(batchId, "INFO", "Excel parsing started.");
    if ((await call(batchId, "/excel/parse")).status === "ERROR") throw nonRetryable("EXCEL_PARSE_FAILED");
    await job.updateProgress(40);
    await log(batchId, "INFO", "PDF parsing started.");
    await call(batchId, "/pdfs/parse");
    await job.updateProgress(75);
    await log(batchId, "INFO", "Matching started.");
    await call(batchId, "/match");
    await job.updateProgress(100);
    await prisma.batch.update({ where: { id: batchId }, data: { processingStatus: "SUCCESS", finishedAt: new Date() } });
    await log(batchId, "INFO", "Batch processing completed.");
    return { batchId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    await prisma.batch.update({ where: { id: batchId }, data: { processingStatus: "ERROR", finishedAt: new Date() } }).catch(() => undefined);
    await log(batchId, "ERROR", `Batch processing failed: ${message}`).catch(() => undefined);
    throw error;
  }
}, { connection, concurrency: 1 });

const marketplaceWorker = startMarketplaceSyncWorker();

worker.on("failed", (job, error) => console.error("Batch job failed", job?.id, error.message));
console.log(`Ecomkit Worker started: ${queueName}`);
console.log(`Ecomkit Marketplace Worker started: ${MARKETPLACE_SYNC_QUEUE_NAME}`);

async function shutdown(signal: string): Promise<void> {
  console.log(`Ecomkit Worker stopping (${signal})`);
  await marketplaceWorker.close();
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
