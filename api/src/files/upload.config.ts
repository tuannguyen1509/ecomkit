import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_MAX_FILE_SIZE_MB = 25;
const DEFAULT_MAX_FILES_PER_BATCH = 100;

export interface UploadConfig {
  storageRoot: string;
  uploadsRoot: string;
  tempRoot: string;
  maxFileSizeBytes: number;
  maxFileSizeMb: number;
  maxFilesPerBatch: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getUploadConfig(): UploadConfig {
  const storageRoot = resolve(process.env.UPLOAD_STORAGE_ROOT ?? "/app/storage");
  const maxFileSizeMb = positiveInteger(process.env.UPLOAD_MAX_FILE_SIZE_MB, DEFAULT_MAX_FILE_SIZE_MB);
  const maxFilesPerBatch = positiveInteger(process.env.UPLOAD_MAX_FILES_PER_BATCH, DEFAULT_MAX_FILES_PER_BATCH);
  const uploadsRoot = resolve(storageRoot, "uploads");
  const tempRoot = resolve(storageRoot, "tmp");

  mkdirSync(uploadsRoot, { recursive: true });
  mkdirSync(tempRoot, { recursive: true });

  return {
    storageRoot,
    uploadsRoot,
    tempRoot,
    maxFileSizeBytes: maxFileSizeMb * 1024 * 1024,
    maxFileSizeMb,
    maxFilesPerBatch
  };
}
