import { timingSafeEqual } from "node:crypto";

export const WORKER_KEY_HEADER = "x-ecomkit-worker-key";

export function isValidInternalWorkerKey(provided: string | undefined): boolean {
  const configured = process.env.WORKER_INTERNAL_API_KEY;
  if (!configured || !provided) return false;
  const expectedBuffer = Buffer.from(configured, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}
