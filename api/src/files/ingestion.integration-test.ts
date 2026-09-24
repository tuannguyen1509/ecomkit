import AdmZip from "adm-zip";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prisma } from "@ecomkit/database";

const apiUrl = "http://localhost:3001/api";
const storageRoot = resolve(process.env.UPLOAD_STORAGE_ROOT ?? "/app/storage");
const marker = `STAGE3_TEST_${Date.now()}`;
const testBatchIds: string[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function validPdf(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
}

function validXlsx(): Buffer {
  const archive = new AdmZip();
  archive.addFile("[Content_Types].xml", Buffer.from("<?xml version=\"1.0\"?><Types/>") );
  archive.addFile("_rels/.rels", Buffer.from("<?xml version=\"1.0\"?><Relationships/>") );
  archive.addFile("xl/workbook.xml", Buffer.from("<?xml version=\"1.0\"?><workbook/>") );
  return archive.toBuffer();
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${apiUrl}${path}`, init);
}

async function createBatch(): Promise<string> {
  const response = await request("/batches", { method: "POST" });
  assert(response.status === 201, `Create Batch failed with HTTP ${response.status}`);
  const body = await response.json() as { id: string; processingStatus: string };
  assert(body.processingStatus === "PENDING", "Batch is not PENDING");
  testBatchIds.push(body.id);
  return body.id;
}

async function upload(batchId: string, files: Array<{ name: string; data: Buffer; contentType?: string }>): Promise<Response> {
  const form = new FormData();
  for (const file of files) {
    const payload = Uint8Array.from(file.data);
    form.append("files", new Blob([payload], { type: file.contentType ?? "application/octet-stream" }), file.name);
  }
  return request(`/batches/${batchId}/files`, { method: "POST", body: form });
}

async function getBatch(batchId: string): Promise<Record<string, unknown>> {
  const response = await request(`/batches/${batchId}`);
  assert(response.status === 200, `Get Batch failed with HTTP ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

async function cleanup(): Promise<void> {
  for (const batchId of testBatchIds) {
    await prisma.batch.delete({ where: { id: batchId } }).catch(() => undefined);
    await rm(join(storageRoot, "uploads", batchId), { recursive: true, force: true });
  }
  const tempRoot = join(storageRoot, "tmp");
  await mkdir(tempRoot, { recursive: true });
  const tempEntries = await readdir(tempRoot);
  await Promise.all(tempEntries
    .filter((entry) => entry !== ".gitkeep")
    .map((entry) => rm(join(tempRoot, entry), { recursive: true, force: true })));
}

async function main(): Promise<void> {
  const batchId = await createBatch();
  const firstXlsx = await upload(batchId, [{ name: `${marker}.xlsx`, data: validXlsx() }]);
  assert(firstXlsx.status === 201, "Valid XLSX was rejected");

  const firstBatch = await getBatch(batchId);
  assert(firstBatch.fileCount === 1 && firstBatch.excelFileCount === 1 && firstBatch.pdfFileCount === 0, "XLSX counts are incorrect");

  const multiPdf = await upload(batchId, [
    { name: "same.pdf", data: validPdf() },
    { name: "same.pdf", data: validPdf() },
    { name: "third.pdf", data: validPdf() }
  ]);
  assert(multiPdf.status === 201, "Valid multi-PDF request was rejected");

  const morePdf = await upload(batchId, [
    { name: "later-one.pdf", data: validPdf() },
    { name: "later-two.PDF", data: validPdf() }
  ]);
  assert(morePdf.status === 201, "Later PDF request was rejected");

  const afterPdfBatch = await getBatch(batchId);
  assert(afterPdfBatch.fileCount === 6 && afterPdfBatch.excelFileCount === 1 && afterPdfBatch.pdfFileCount === 5, "PDF counts are incorrect");
  const files = afterPdfBatch.files as Array<{ platform: string; storagePath?: unknown }>;
  assert(files.filter((file) => file.platform === "UNKNOWN").length === 6, "Files must retain UNKNOWN platform in Stage 3");
  assert(files.every((file) => file.storagePath === undefined), "GET Batch exposed storagePath");

  const secondExcel = await upload(batchId, [{ name: "second.xlsx", data: validXlsx() }]);
  assert(secondExcel.status === 400, "Second Excel was not rejected");
  assert((await getBatch(batchId)).fileCount === 6, "Second Excel changed Batch counts");

  const invalidRequests: Array<{ name: string; data: Buffer; expected: string }> = [
    { name: "empty.pdf", data: Buffer.alloc(0), expected: "FILE_EMPTY" },
    { name: "malware.exe", data: validPdf(), expected: "FILE_INVALID" },
    { name: "fake.pdf", data: Buffer.from("not a pdf"), expected: "FILE_CORRUPTED" },
    { name: "fake.xlsx", data: Buffer.from("PK-not-an-xlsx"), expected: "FILE_CORRUPTED" }
  ];
  for (const invalid of invalidRequests) {
    const response = await upload(batchId, [{ name: invalid.name, data: invalid.data }]);
    assert(response.status === 400, `${invalid.name} was not rejected`);
    const body = await response.json() as { errorCode?: string };
    assert(body.errorCode === invalid.expected, `${invalid.name} did not return ${invalid.expected}`);
  }

  const atomicBatchId = await createBatch();
  const atomic = await upload(atomicBatchId, [
    { name: "valid.pdf", data: validPdf() },
    { name: "invalid.exe", data: Buffer.from("invalid") },
    { name: "valid-two.pdf", data: validPdf() }
  ]);
  assert(atomic.status === 400, "Atomic invalid request was not rejected");
  assert((await getBatch(atomicBatchId)).fileCount === 0, "Atomic invalid request partially persisted metadata");

  const traversal = await upload(batchId, [{ name: "../../outside.pdf", data: validPdf() }]);
  assert(traversal.status === 201, "Path traversal filename upload was rejected unexpectedly");

  const unknown = await upload("c000000000000000000000000", [{ name: "unknown.pdf", data: validPdf() }]);
  assert(unknown.status === 404, "Unknown Batch upload did not return 404");

  const persisted = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { uploadedFiles: true }
  });
  assert(persisted !== null, "Batch disappeared during ingestion test");
  const dbFileCount = persisted.uploadedFiles.length;
  const dbExcelCount = persisted.uploadedFiles.filter((file) => file.fileType === "EXCEL").length;
  const dbPdfCount = persisted.uploadedFiles.filter((file) => file.fileType === "PDF").length;
  assert(persisted.fileCount === dbFileCount && persisted.excelFileCount === dbExcelCount && persisted.pdfFileCount === dbPdfCount, "Database Batch counts are inconsistent");

  for (const file of persisted.uploadedFiles) {
    assert(file.storagePath !== null && !file.storagePath.includes("..") && !file.storagePath.includes("\\"), "Unsafe storage path persisted");
    const finalPath = resolve(storageRoot, file.storagePath);
    assert(finalPath.startsWith(`${resolve(storageRoot, "uploads")}/`), "File escaped uploads root");
    assert((await readFile(finalPath)).length > 0, "Persisted upload does not exist physically");
  }

  const countLimitBatchId = await createBatch();
  const manyFiles = Array.from({ length: 101 }, (_, index) => ({ name: `count-${index}.pdf`, data: validPdf() }));
  const countLimit = await upload(countLimitBatchId, manyFiles);
  assert(countLimit.status === 400, "File count limit was not enforced");
  assert((await getBatch(countLimitBatchId)).fileCount === 0, "File count limit request partially persisted metadata");

  const sizeLimitBatchId = await createBatch();
  const oversizedPdf = Buffer.concat([validPdf(), Buffer.alloc(26 * 1024 * 1024)]);
  const sizeLimit = await upload(sizeLimitBatchId, [{ name: "oversized.pdf", data: oversizedPdf }]);
  assert(sizeLimit.status === 400, "File size limit was not enforced");
  assert((await getBatch(sizeLimitBatchId)).fileCount === 0, "Oversized request partially persisted metadata");

  console.log("Stage 3 ingestion integration test passed");
}

main()
  .catch((error: unknown) => {
    console.error("Stage 3 ingestion integration test failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
