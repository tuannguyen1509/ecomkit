import ExcelJS from "exceljs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prisma } from "@ecomkit/database";

const apiUrl = "http://localhost:3001/api";
const storageRoot = resolve(process.env.UPLOAD_STORAGE_ROOT ?? "/app/storage");
const testBatchIds: string[] = [];

type SheetData = { name?: string; rows?: Array<Array<string | number | null>> };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function workbookBuffer(sheets: SheetData[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name ?? "Technical data");
    for (const row of sheet.rows ?? []) worksheet.addRow(row);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function createBatch(): Promise<string> {
  const response = await fetch(`${apiUrl}/batches`, { method: "POST" });
  assert(response.status === 201, `Create Batch failed: HTTP ${response.status}`);
  const body = await response.json() as { id: string };
  testBatchIds.push(body.id);
  return body.id;
}

async function uploadXlsx(batchId: string, content: Buffer, name = "fixture.xlsx"): Promise<void> {
  const form = new FormData();
  form.append("files", new Blob([Uint8Array.from(content)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name);
  const response = await fetch(`${apiUrl}/batches/${batchId}/files`, { method: "POST", body: form });
  assert(response.status === 201, `Upload XLSX failed: HTTP ${response.status}`);
}

async function parse(batchId: string): Promise<{ status: string; totalRows: number; validRows: number; errorCount: number }> {
  const response = await fetch(`${apiUrl}/batches/${batchId}/excel/parse`, { method: "POST" });
  if (response.status !== 200) {
    throw new Error(`Parse failed: HTTP ${response.status}; ${await response.text()}`);
  }
  return response.json() as Promise<{ status: string; totalRows: number; validRows: number; errorCount: number }>;
}

async function setup(sheets: SheetData[]): Promise<{ batchId: string; fileId: string }> {
  const batchId = await createBatch();
  await uploadXlsx(batchId, await workbookBuffer(sheets));
  const file = await prisma.uploadedFile.findFirstOrThrow({ where: { batchId, fileType: "EXCEL" } });
  return { batchId, fileId: file.id };
}

async function errorsFor(fileId: string): Promise<Array<{ errorCode: string; rowNumber: number | null; fieldName: string | null }>> {
  return prisma.processingError.findMany({
    where: { uploadedFileId: fileId, errorCode: { startsWith: "EXCEL_" } },
    select: { errorCode: true, rowNumber: true, fieldName: true }
  });
}

async function main(): Promise<void> {
  const valid = await setup([{ rows: [["Mã đơn sàn", "Ghi chú"], ["ORDER001", "a"], [], ["ORDER002", "b"], ["ORDER003", "c"]] }]);
  const validResult = await parse(valid.batchId);
  assert(validResult.status === "SUCCESS" && validResult.totalRows === 3 && validResult.validRows === 3 && validResult.errorCount === 0, "Valid workbook result is incorrect");
  const validFile = await prisma.uploadedFile.findUniqueOrThrow({ where: { id: valid.fileId } });
  assert(validFile.rawData !== null && validFile.processingStatus === "SUCCESS", "Valid workbook raw data/status was not persisted");
  assert((await prisma.order.count({ where: { batchId: valid.batchId } })) === 0, "Excel parse created Order records");
  await parse(valid.batchId);
  assert((await errorsFor(valid.fileId)).length === 0, "Reparse added unexpected errors");

  const emptyCode = await setup([{ rows: [["Mã đơn sàn", "Ghi chú"], ["ORDER001", "a"], [null, "has data"], ["ORDER003", "c"]] }]);
  await parse(emptyCode.batchId);
  const emptyCodeErrors = await errorsFor(emptyCode.fileId);
  assert(emptyCodeErrors.some((error) => error.errorCode === "EXCEL_EMPTY_ORDER_CODE" && error.rowNumber === 3 && error.fieldName === "Mã đơn sàn"), "Empty order-code error is incorrect");

  const duplicate = await setup([{ rows: [["Mã đơn sàn"], ["ORDER001"], ["ORDER002"], ["ORDER001"]] }]);
  await parse(duplicate.batchId);
  assert((await errorsFor(duplicate.fileId)).some((error) => error.errorCode === "EXCEL_DUPLICATE_ORDER_CODE" && error.rowNumber === 4), "Duplicate was not reported");

  const whitespaceDuplicate = await setup([{ rows: [["Mã đơn sàn"], ["ORDER001"], [" ORDER001 "]] }]);
  await parse(whitespaceDuplicate.batchId);
  assert((await errorsFor(whitespaceDuplicate.fileId)).some((error) => error.errorCode === "EXCEL_DUPLICATE_ORDER_CODE"), "Whitespace duplicate was not reported");

  const caseDifference = await setup([{ rows: [["Mã đơn sàn"], ["order001"], ["ORDER001"]] }]);
  const caseResult = await parse(caseDifference.batchId);
  assert(caseResult.status === "SUCCESS" && caseResult.validRows === 2, "Case difference was incorrectly treated as duplicate");

  const missingRequired = await setup([{ rows: [["Mã đơn", "Ghi chú"], ["ORDER001", "a"]] }]);
  await parse(missingRequired.batchId);
  assert((await errorsFor(missingRequired.fileId)).some((error) => error.errorCode === "EXCEL_REQUIRED_COLUMN_MISSING"), "Missing required column was not reported");

  const missingHeader = await setup([{ rows: [] }]);
  await parse(missingHeader.batchId);
  assert((await errorsFor(missingHeader.fileId)).some((error) => error.errorCode === "EXCEL_HEADER_MISSING"), "Missing header was not reported");

  const ambiguousSheet = await setup([{ name: "First", rows: [["Mã đơn sàn"], ["ORDER001"]] }, { name: "Second", rows: [["Mã đơn sàn"], ["ORDER002"]] }]);
  await parse(ambiguousSheet.batchId);
  assert((await errorsFor(ambiguousSheet.fileId)).some((error) => error.errorCode === "EXCEL_SHEET_NOT_FOUND"), "Ambiguous worksheet was not reported");

  const corrupt = await setup([{ rows: [["Mã đơn sàn"], ["ORDER001"]] }]);
  const corruptFile = await prisma.uploadedFile.findUniqueOrThrow({ where: { id: corrupt.fileId } });
  assert(corruptFile.storagePath, "Corrupt fixture has no storage path");
  const storedPath = resolve(storageRoot, corruptFile.storagePath);
  assert(storedPath.startsWith(`${resolve(storageRoot, "uploads")}/`), "Test file escaped upload storage");
  await writeFile(storedPath, "corrupt after upload");
  await parse(corrupt.batchId);
  assert((await errorsFor(corrupt.fileId)).some((error) => error.errorCode === "EXCEL_READ_ERROR"), "Corrupt XLSX was not reported");

  const reparse = await setup([{ rows: [["Mã đơn sàn"], ["ORDER001"], ["ORDER001"]] }]);
  await parse(reparse.batchId);
  await parse(reparse.batchId);
  const reparseErrors = await errorsFor(reparse.fileId);
  assert(reparseErrors.filter((error) => error.errorCode === "EXCEL_DUPLICATE_ORDER_CODE").length === 1, "Reparse duplicated parser errors");
  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: reparse.batchId } });
  assert(batch.fileCount === 1 && batch.excelFileCount === 1 && batch.pdfFileCount === 0, "Parse changed Batch file counts");

  console.log("Stage 4 Excel integration test passed");
}

async function cleanup(): Promise<void> {
  for (const batchId of testBatchIds) {
    await prisma.batch.delete({ where: { id: batchId } }).catch(() => undefined);
    await rm(join(storageRoot, "uploads", batchId), { recursive: true, force: true });
  }
}

main()
  .catch((error: unknown) => {
    console.error("Stage 4 Excel integration test failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
