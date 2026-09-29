export type ShopeeSyncCheckpoint = Readonly<{ v: 1; updatedThrough: number }>;
export type ShopeeSyncWindow = Readonly<{ timeRangeField: "create_time" | "update_time"; timeFrom: number; timeTo: number; candidateCheckpoint: string }>;

export class ShopeeSyncCheckpointError extends Error {
  constructor(public readonly code: "SHOPEE_CHECKPOINT_INVALID" | "SHOPEE_INCREMENTAL_CHECKPOINT_REQUIRED" | "SHOPEE_INCREMENTAL_OVERLAP_INVALID" | "SHOPEE_SYNC_WINDOW_INVALID") {
    super(code);
    this.name = "ShopeeSyncCheckpointError";
  }
  readonly retryable = false;
  toJSON() { return { name: this.name, code: this.code, retryable: false }; }
}

export const SHOPEE_INCREMENTAL_OVERLAP_DEFAULT_SECONDS = 300;

function validUnixSeconds(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0; }
function dateToUnixSeconds(value: Date | null | undefined): number {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) throw new ShopeeSyncCheckpointError("SHOPEE_SYNC_WINDOW_INVALID");
  return Math.floor(value.valueOf() / 1000);
}

export function encodeShopeeSyncCheckpoint(updatedThrough: number): string {
  if (!validUnixSeconds(updatedThrough)) throw new ShopeeSyncCheckpointError("SHOPEE_CHECKPOINT_INVALID");
  return JSON.stringify({ v: 1, updatedThrough } satisfies ShopeeSyncCheckpoint);
}

export function decodeShopeeSyncCheckpoint(serialized: string | null | undefined): ShopeeSyncCheckpoint {
  if (!serialized) throw new ShopeeSyncCheckpointError("SHOPEE_INCREMENTAL_CHECKPOINT_REQUIRED");
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== "object" || (value as { v?: unknown }).v !== 1 || !validUnixSeconds((value as { updatedThrough?: unknown }).updatedThrough)) throw new ShopeeSyncCheckpointError("SHOPEE_CHECKPOINT_INVALID");
    return value as ShopeeSyncCheckpoint;
  } catch (error) { if (error instanceof ShopeeSyncCheckpointError) throw error; throw new ShopeeSyncCheckpointError("SHOPEE_CHECKPOINT_INVALID"); }
}

export function resolveShopeeIncrementalOverlapSeconds(configured: string | number | undefined = undefined): number {
  if (configured === undefined || configured === "") return SHOPEE_INCREMENTAL_OVERLAP_DEFAULT_SECONDS;
  const value = typeof configured === "number" ? configured : Number(configured);
  if (!Number.isInteger(value) || value < 0 || value > 3600) throw new ShopeeSyncCheckpointError("SHOPEE_INCREMENTAL_OVERLAP_INVALID");
  return value;
}

export function resolveShopeeSyncWindow(input: Readonly<{ syncType: "INITIAL" | "INCREMENTAL"; windowStart?: Date | null; windowEnd?: Date | null; committedCheckpoint?: string | null; overlapSeconds?: number }>): ShopeeSyncWindow {
  const timeTo = dateToUnixSeconds(input.windowEnd);
  if (input.syncType === "INITIAL") {
    const timeFrom = dateToUnixSeconds(input.windowStart);
    if (timeFrom >= timeTo) throw new ShopeeSyncCheckpointError("SHOPEE_SYNC_WINDOW_INVALID");
    return { timeRangeField: "create_time", timeFrom, timeTo, candidateCheckpoint: encodeShopeeSyncCheckpoint(timeTo) };
  }
  const checkpoint = decodeShopeeSyncCheckpoint(input.committedCheckpoint);
  const overlapSeconds = resolveShopeeIncrementalOverlapSeconds(input.overlapSeconds);
  const timeFrom = Math.max(0, checkpoint.updatedThrough - overlapSeconds);
  if (timeFrom >= timeTo) throw new ShopeeSyncCheckpointError("SHOPEE_SYNC_WINDOW_INVALID");
  return { timeRangeField: "update_time", timeFrom, timeTo, candidateCheckpoint: encodeShopeeSyncCheckpoint(timeTo) };
}
