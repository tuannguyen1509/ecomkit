import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prisma } from "@ecomkit/database";
import { PdfDocumentService } from "./pdf-document.service.js";

const apiUrl = "http://localhost:3001/api";
const storageRoot = resolve(process.env.UPLOAD_STORAGE_ROOT ?? "/app/storage");
const batchIds: string[] = [];

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

function pdf(linesByPage: string[][]): Buffer {
  const objects: string[] = ["", "<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const pageRefs: string[] = [];
  for (let index = 0; index < linesByPage.length; index += 1) {
    const pageObject = 4 + index * 2;
    const contentObject = pageObject + 1;
    pageRefs.push(`${pageObject} 0 R`);
    const stream = linesByPage[index].length === 0 ? "q Q" : `BT /F1 12 Tf 72 720 Td ${linesByPage[index].map((line, lineIndex) => `${lineIndex === 0 ? "" : "0 -18 Td "}(${line.replace(/[\\()]/g, "\\$&")}) Tj`).join(" ")} ET`;
    objects[pageObject] = `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /MediaBox [0 0 612 792] /Contents ${contentObject} 0 R >>`;
    objects[contentObject] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  }
  objects[2] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`;
  let output = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let index = 1; index < objects.length; index += 1) { offsets[index] = Buffer.byteLength(output); output += `${index} 0 obj\n${objects[index]}\nendobj\n`; }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

async function createBatch(): Promise<string> {
  const response = await fetch(`${apiUrl}/batches`, { method: "POST" });
  assert(response.status === 201, "Batch creation failed");
  const body = await response.json() as { id: string }; batchIds.push(body.id); return body.id;
}

async function upload(batchId: string, files: Array<{ name: string; data: Buffer }>): Promise<void> {
  const form = new FormData();
  for (const file of files) form.append("files", new Blob([Uint8Array.from(file.data)], { type: "application/pdf" }), file.name);
  const response = await fetch(`${apiUrl}/batches/${batchId}/files`, { method: "POST", body: form });
  assert(response.status === 201, `PDF upload failed: ${response.status}`);
}

async function parse(batchId: string) {
  const response = await fetch(`${apiUrl}/batches/${batchId}/pdfs/parse`, { method: "POST" });
  if (response.status !== 200) throw new Error(`PDF parse failed: ${response.status}; ${await response.text()}`);
  return response.json() as Promise<{ totalPdfFiles: number; success: number; warning: number; error: number }>;
}

async function main(): Promise<void> {
  const validBatch = await createBatch();
  await upload(validBatch, [{ name: "valid-text.pdf", data: pdf([["Generic readable text"]]) }]);
  const validResult = await parse(validBatch);
  assert(validResult.warning === 1, "Readable unknown-platform PDF should be WARNING");
  const validFile = await prisma.uploadedFile.findFirstOrThrow({ where: { batchId: validBatch } });
  assert(validFile.rawText && validFile.rawStructure && validFile.rawData && validFile.platform === "UNKNOWN", "Raw PDF persistence failed");
  assert((await prisma.processingError.count({ where: { uploadedFileId: validFile.id, errorCode: "UNKNOWN_PLATFORM" } })) === 1, "Unknown platform error missing");
  await parse(validBatch);
  assert((await prisma.processingError.count({ where: { uploadedFileId: validFile.id, errorCode: "UNKNOWN_PLATFORM" } })) === 1, "Reparse duplicated PDF errors");

  const multiBatch = await createBatch();
  await upload(multiBatch, [{ name: "multi-page.pdf", data: pdf([["Page one"], ["Page two"], ["Page three"]]) }]);
  await parse(multiBatch);
  const multiFile = await prisma.uploadedFile.findFirstOrThrow({ where: { batchId: multiBatch } });
  const structure = multiFile.rawStructure as { pageCount: number; pages: Array<{ pageNumber: number }> };
  assert(structure.pageCount === 3 && structure.pages.map((page) => page.pageNumber).join(",") === "1,2,3", "Multi-page structure is incomplete");

  const partialPath = join(storageRoot, "tmp", "stage5-partial.pdf");
  await writeFile(partialPath, pdf([["one"], ["two"], ["three"]]));
  const partial = await new PdfDocumentService().read(partialPath, new Set([2]));
  await rm(partialPath, { force: true });
  assert(partial.pages[0].text && partial.pages[1].error?.code === "PDF_PAGE_ERROR" && partial.pages[2].text, "Partial page failure did not continue");

  const noTextBatch = await createBatch();
  await upload(noTextBatch, [{ name: "no-text.pdf", data: pdf([[]]) }]);
  await parse(noTextBatch);
  const noTextFile = await prisma.uploadedFile.findFirstOrThrow({ where: { batchId: noTextBatch } });
  assert(noTextFile.processingStatus === "ERROR" && (await prisma.processingError.count({ where: { uploadedFileId: noTextFile.id, errorCode: "PDF_PARSE_ERROR" } })) === 1, "No-text PDF did not return OCR-not-supported error");

  const corruptBatch = await createBatch();
  await upload(corruptBatch, [{ name: "corrupt.pdf", data: pdf([["before corruption"]]) }]);
  const corruptFile = await prisma.uploadedFile.findFirstOrThrow({ where: { batchId: corruptBatch } });
  await writeFile(resolve(storageRoot, corruptFile.storagePath!), "corrupt after upload");
  await parse(corruptBatch);
  assert((await prisma.processingError.count({ where: { uploadedFileId: corruptFile.id, errorCode: "PDF_READ_ERROR" } })) === 1, "Corrupt PDF did not return read error");

  const multipleBatch = await createBatch();
  await upload(multipleBatch, [
    { name: "valid1.pdf", data: pdf([["plain text"]]) },
    { name: "Shopee-order.pdf", data: pdf([["plain text only"]]) },
    { name: "synthetic-shopee-fixture.pdf", data: pdf([["SPX 2609178X85CBMY"]]) }
  ]);
  const multipleResult = await parse(multipleBatch);
  assert(multipleResult.totalPdfFiles === 3 && multipleResult.success === 1 && multipleResult.warning === 2, "Multiple PDF result is incorrect");
  const synthetic = await prisma.uploadedFile.findFirstOrThrow({ where: { batchId: multipleBatch, originalFilename: "synthetic-shopee-fixture.pdf" } });
  const namedShopee = await prisma.uploadedFile.findFirstOrThrow({ where: { batchId: multipleBatch, originalFilename: "Shopee-order.pdf" } });
  assert(synthetic.platform === "SHOPEE" && namedShopee.platform === "UNKNOWN", "Filename improperly determined platform");
  assert((await prisma.order.count({ where: { batchId: { in: batchIds } } })) === 0 && (await prisma.orderItem.count()) === 0, "PDF parsing created Order or OrderItem records");
  console.log("Stage 5 PDF integration test passed");
}

async function cleanup(): Promise<void> {
  for (const id of batchIds) { await prisma.batch.delete({ where: { id } }).catch(() => undefined); await rm(join(storageRoot, "uploads", id), { recursive: true, force: true }); }
}

main().catch((error: unknown) => { console.error("Stage 5 PDF integration test failed", error); process.exitCode = 1; }).finally(async () => { await cleanup(); await prisma.$disconnect(); });
