import { Injectable } from "@nestjs/common";
import { access, mkdir, readdir, rename, rm, rmdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { getUploadConfig } from "./upload.config.js";

export interface StoredFile {
  absolutePath: string;
  relativePath: string;
}

@Injectable()
export class StorageService {
  private readonly config = getUploadConfig();

  async moveTempFile(batchId: string, tempFilePath: string, sanitizedFilename: string): Promise<StoredFile> {
    const batchDirectory = this.batchDirectory(batchId);
    await mkdir(batchDirectory, { recursive: true });

    const storedFilename = `${randomUUID()}${extname(sanitizedFilename).toLowerCase()}`;
    const absolutePath = resolve(batchDirectory, storedFilename);
    this.assertWithin(this.config.uploadsRoot, absolutePath);

    await rename(tempFilePath, absolutePath);
    return {
      absolutePath,
      relativePath: relative(this.config.storageRoot, absolutePath).split(sep).join("/")
    };
  }

  async cleanup(paths: string[], removeEmptyBatchDirectories = false): Promise<void> {
    await Promise.all(paths.map(async (filePath) => rm(filePath, { force: true })));
    if (!removeEmptyBatchDirectories) {
      return;
    }

    const directories = [...new Set(paths.map((filePath) => dirname(filePath)))];
    for (const directory of directories) {
      this.assertWithin(this.config.uploadsRoot, directory);
      const remaining = await readdir(directory).catch(() => []);
      if (remaining.length === 0) {
        await rmdir(directory).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") {
            throw error;
          }
        });
      }
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private batchDirectory(batchId: string): string {
    const path = resolve(this.config.uploadsRoot, batchId);
    this.assertWithin(this.config.uploadsRoot, path);
    return path;
  }

  private assertWithin(root: string, candidate: string): void {
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      throw new Error("Upload path is outside the configured storage root");
    }
  }
}
