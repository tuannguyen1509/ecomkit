import { prisma } from "@ecomkit/database";
import { MatchingService } from "./matching.service.js";

const ids: string[] = [];
const match = new MatchingService();
function ok(v: unknown, m: string): asserts v { if (!v) throw new Error(m); }
async function batch(excel: string[], pdfs: Array<{ codes?: string[]; platform?: "SHOPEE" | "LAZADA" | "TIKTOK" | "UNKNOWN"; status?: "SUCCESS" | "ERROR" }>) {
  const b = await prisma.batch.create({ data: {} }); ids.push(b.id);
  await prisma.uploadedFile.create({ data: { batchId: b.id, originalFilename: "test.xlsx", sanitizedFilename: "test.xlsx", fileType: "EXCEL", processingStatus: "SUCCESS", rawData: { sheet: "Technical", rows: excel.map((raw, i) => ({ rowNumber: i + 2, extracted: { raw_order_code: raw } })) } } });
  for (const [i, p] of pdfs.entries()) await prisma.uploadedFile.create({ data: { batchId: b.id, originalFilename: `test-${i}.pdf`, sanitizedFilename: `test-${i}.pdf`, fileType: "PDF", platform: p.platform ?? "UNKNOWN", processingStatus: p.status ?? "SUCCESS", rawText: "source", rawStructure: { pages: [] }, rawData: { orders: (p.codes ?? []).map((raw, n) => ({ rawOrderCode: raw, sourcePage: n + 1 })) } } });
  return b.id;
}
async function statuses(id: string) { return prisma.order.findMany({ where: { batchId: id }, orderBy: { normalizedOrderCode: "asc" } }); }
async function main() {
  const basic = await batch(["A", "B", "C", "D"], [{ codes: ["A", "C", "E"] }]); await match.match(basic); const a = await statuses(basic); ok(a.length === 5 && a.map(x => x.matchingStatus).join(",") === "MATCHED,PDF_NOT_FOUND,MATCHED,PDF_NOT_FOUND,EXCEL_NOT_FOUND", "basic statuses");
  const dup = await batch(["A", "A", "B"], [{ codes: ["A", "B"] }]); await match.match(dup); const d = await statuses(dup); ok(d.length === 2 && d[0].matchingStatus === "DUPLICATE" && (await prisma.processingError.count({ where: { batchId: dup, errorCode: "DUPLICATE_ORDER" } })) === 1, "excel duplicate");
  const duppdf = await batch(["A", "B"], [{ codes: ["A", "A", "B"] }]); await match.match(duppdf); ok((await statuses(duppdf))[0].matchingStatus === "DUPLICATE", "pdf duplicate");
  const both = await batch(["A", "A"], [{ codes: ["A", "A"] }]); await match.match(both); ok((await statuses(both)).length === 1, "both duplicate one order");
  const normalize = await batch([" A ", "a", "AB C"], [{ codes: ["A", "A", "ABC"] }]); await match.match(normalize); const n = await statuses(normalize); ok(n.length === 4 && n.find(x => x.normalizedOrderCode === "A")?.matchingStatus === "DUPLICATE" && n.find(x => x.normalizedOrderCode === "a")?.matchingStatus === "PDF_NOT_FOUND" && n.find(x => x.normalizedOrderCode === "ABC")?.matchingStatus === "EXCEL_NOT_FOUND", "normalization");
  const platforms = await batch(["A", "B", "C"], [{ codes: ["A"], platform: "SHOPEE" }, { codes: ["B"], platform: "LAZADA" }, { codes: ["D"], platform: "TIKTOK" }, { status: "ERROR" }]); await match.match(platforms); const p = await statuses(platforms); ok(p.length === 4 && p.find(x => x.normalizedOrderCode === "A")?.platform === "SHOPEE" && p.find(x => x.normalizedOrderCode === "B")?.platform === "LAZADA", "platform aggregation");
  const before = await statuses(basic); await match.match(basic); const after = await statuses(basic); ok(before.length === after.length && after.every(x => x.amountCollected === null && x.differenceAmount === null && x.productPriceVat8 === null && x.totalCostPercent === null && x.totalAmountToCollect === null && x.affiliateFeeVuikhoe === null && x.discountVuikhoe === null && x.discountPercentVuikhoe === null && x.fixedPlatformFee === null && x.servicePlatformFee === null && x.transactionPlatformFee === null && x.platformCostPercent === null && (x as any).sourceRefs !== null), "idempotency/null/provenance");
  const raw = await prisma.uploadedFile.findFirstOrThrow({ where: { batchId: basic, fileType: "EXCEL" } }); ok(raw.rawData !== null, "raw source preserved"); const count = await prisma.batch.findUniqueOrThrow({ where: { id: basic } }); ok(count.orderCount === after.length, "batch count");
  process.env.STAGE6_TEST_FAIL_AFTER_DELETE = "1"; await match.match(basic).then(() => { throw new Error("rollback hook did not fail"); }).catch(error => ok(String(error).includes("STAGE6_TEST_CONTROLLED_TRANSACTION_FAILURE"), "unexpected rollback error")); delete process.env.STAGE6_TEST_FAIL_AFTER_DELETE;
  ok((await statuses(basic)).length === after.length && (await prisma.batch.findUniqueOrThrow({ where: { id: basic } })).orderCount === after.length, "transaction rollback preserved previous result");
  console.log(`Stage 6 matching integration test passed; restartBatchId=${basic}`);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { if (process.env.STAGE6_KEEP_RESTART_BATCH === "1") { for (const id of ids.slice(1)) await prisma.batch.delete({ where: { id } }).catch(() => undefined); } else { for (const id of ids) await prisma.batch.delete({ where: { id } }).catch(() => undefined); } await prisma.$disconnect(); });
