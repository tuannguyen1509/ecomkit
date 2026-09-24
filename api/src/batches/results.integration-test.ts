import { prisma } from "@ecomkit/database";
import { BatchesService } from "./batches.service.js";

const service = new BatchesService();
let batchId: string | undefined;

function ok(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function main() {
  const batch = await prisma.batch.create({
    data: { fileCount: 2, successCount: 5, warningCount: 10, errorCount: 10, createdByUserId: "STAGE7_TEST_RESULTS" }
  });
  batchId = batch.id;
  const statuses = ["MATCHED", "PDF_NOT_FOUND", "EXCEL_NOT_FOUND", "DUPLICATE", "PARSE_ERROR"] as const;
  await prisma.order.createMany({
    data: Array.from({ length: 25 }, (_, index) => ({
      batchId: batch.id,
      rawOrderCode: `STAGE7_TEST_${String(index + 1).padStart(2, "0")}`,
      normalizedOrderCode: `STAGE7_TEST_${String(index + 1).padStart(2, "0")}`,
      matchingStatus: statuses[index % statuses.length],
      platform: index % 3 === 0 ? "SHOPEE" : "UNKNOWN",
      sourceRefs: { candidates: [{ fileId: `stage7-file-${index}`, source: index % 2 === 0 ? "EXCEL" : "PDF", row: index + 2, page: index + 1 }] }
    }))
  });

  const first = await service.findResults(batch.id, {});
  ok(first.summary.totalOrders === 25 && first.summary.totalFiles === 2, "full Batch summary is incorrect");
  ok(first.orders.length === 20 && first.pagination.totalPages === 2 && first.pagination.total === 25, "default pagination is incorrect");
  ok(first.matching.matched === 5 && first.matching.pdfNotFound === 5 && first.matching.excelNotFound === 5 && first.matching.duplicate === 5 && first.matching.parseError === 5, "matching summary is incorrect");
  const second = await service.findResults(batch.id, { page: 2, pageSize: 20 });
  ok(second.orders.length === 5 && second.pagination.page === 2, "second page is incorrect");
  const matched = await service.findResults(batch.id, { status: "MATCHED" });
  ok(matched.pagination.total === 5 && matched.orders.every(order => order.matchingStatus === "MATCHED"), "status filter is incorrect");
  const warning = await service.findResults(batch.id, { group: "warning" });
  ok(warning.pagination.total === 10 && warning.orders.every(order => order.matchingStatus === "PDF_NOT_FOUND" || order.matchingStatus === "EXCEL_NOT_FOUND"), "group filter is incorrect");
  console.log("Stage 7 results integration test passed");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (batchId) await prisma.batch.delete({ where: { id: batchId } }).catch(() => undefined);
  await prisma.$disconnect();
});
