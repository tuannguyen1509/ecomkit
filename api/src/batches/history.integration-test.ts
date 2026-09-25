import { prisma } from "@ecomkit/database";
import { BatchesService } from "./batches.service.js";

const service = new BatchesService();
const ids: string[] = [];
const ok = (value: unknown, message: string) => { if (!value) throw new Error(message); };

async function main() {
  for (let index = 0; index < 22; index += 1) {
    const batch = await prisma.batch.create({ data: { createdByUserId: "STAGE9_TEST", processingStatus: index === 0 ? "SUCCESS" : index === 1 ? "ERROR" : "PENDING", fileCount: index === 0 ? 2 : 0, excelFileCount: index === 0 ? 1 : 0, pdfFileCount: index === 0 ? 1 : 0, orderCount: index === 0 ? 5 : 0 } });
    ids.push(batch.id);
    if (index === 0) {
      await prisma.order.createMany({ data: Array.from({ length: 5 }, (_, item) => ({ batchId: batch.id, normalizedOrderCode: `STAGE9_${item}`, matchingStatus: item < 3 ? "MATCHED" : "PDF_NOT_FOUND" })) });
      await prisma.processingError.createMany({ data: [{ batchId: batch.id, errorCode: "PDF_READ_ERROR", message: "synthetic", severity: "ERROR" }, { batchId: batch.id, errorCode: "PDF_PHONE_NOT_FOUND", message: "synthetic", severity: "WARNING" }] });
    }
  }
  const first = await service.findHistory({ page: 1, pageSize: 20 });
  ok(first.pagination.total === 22 && first.items.length === 20, "pagination");
  const detailed = (await service.findHistory({ status: "SUCCESS" })).items.find((item) => item.id === ids[0]);
  ok(detailed?.fileCount === 2 && detailed.orderCount === 5 && detailed.matchedCount === 3 && detailed.warningCount === 1 && detailed.errorCount === 1, "counts/isolation");
  ok((await service.findHistory({ page: 2, pageSize: 20 })).items.length === 2, "page two");
  ok((await service.findHistory({ status: "SUCCESS" })).items.every((item) => item.processingStatus === "SUCCESS"), "status");
  await service.findHistory({ page: 0 }).then(() => { throw new Error("invalid page"); }).catch((error) => ok(error?.status === 400, "invalid page"));
  console.log("Stage 9 history integration passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { for (const id of ids) await prisma.batch.delete({ where: { id } }).catch(() => {}); await prisma.$disconnect(); });
