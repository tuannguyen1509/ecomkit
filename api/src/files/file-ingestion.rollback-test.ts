import { randomUUID } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { prisma } from "@ecomkit/database";
import { FileIngestionService } from "./file-ingestion.service.js";
import { FileValidationService } from "./file-validation.service.js";
import { StorageService } from "./storage.service.js";

const storageRoot = resolve(process.env.UPLOAD_STORAGE_ROOT ?? "/app/storage");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const batch = await prisma.batch.create({ data: { processingStatus: "PENDING" } });
  const tempRoot = join(storageRoot, "tmp");
  const tempPath = join(tempRoot, randomUUID());
  await mkdir(tempRoot, { recursive: true });
  await writeFile(tempPath, Buffer.from("%PDF-1.4\n%%EOF\n"));

  const file: Express.Multer.File = {
    fieldname: "files",
    originalname: "rollback.pdf",
    encoding: "7bit",
    mimetype: "application/pdf",
    destination: tempRoot,
    filename: tempPath.split("/").at(-1) ?? "rollback",
    path: tempPath,
    size: 15,
    stream: Readable.from([]),
    buffer: Buffer.alloc(0)
  };

  const originalTransaction = prisma.$transaction.bind(prisma);
  Object.defineProperty(prisma, "$transaction", {
    configurable: true,
    value: async (): Promise<never> => {
      throw new Error("STAGE3_TEST_DATABASE_FAILURE");
    }
  });

  try {
    const service = new FileIngestionService(new FileValidationService(), new StorageService());
    await service.ingest(batch.id, [file]).then(
      () => { throw new Error("Expected simulated database failure"); },
      () => undefined
    );

    const batchFiles = await readdir(join(storageRoot, "uploads", batch.id)).catch(() => []);
    assert(batchFiles.length === 0, "Database failure left an orphan final upload file");
    assert(await prisma.uploadedFile.count({ where: { batchId: batch.id } }) === 0, "Database failure created UploadedFile metadata");
    console.log("Stage 3 database failure cleanup test passed");
  } finally {
    Object.defineProperty(prisma, "$transaction", { configurable: true, value: originalTransaction });
    await prisma.batch.delete({ where: { id: batch.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("Stage 3 database failure cleanup test failed", error);
  process.exitCode = 1;
});
