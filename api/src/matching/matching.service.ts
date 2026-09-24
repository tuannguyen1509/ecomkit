import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma, Prisma } from "@ecomkit/database";
import { normalizeOrderCode } from "@ecomkit/shared";

type Candidate = { raw: string; normalized: string; fileId: string; source: "EXCEL" | "PDF"; row?: number; page?: number; platform: "SHOPEE" | "LAZADA" | "TIKTOK" | "UNKNOWN" };

@Injectable()
export class MatchingService {
  async match(batchId: string) {
    const batch = await prisma.batch.findUnique({ where: { id: batchId }, include: { uploadedFiles: true } });
    if (!batch) throw new NotFoundException({ errorCode: "BATCH_NOT_FOUND", message: "Batch was not found." });
    const excels = batch.uploadedFiles.filter(f => f.fileType === "EXCEL"); const pdfs = batch.uploadedFiles.filter(f => f.fileType === "PDF");
    if (excels.length !== 1 || excels[0].processingStatus === "PENDING" || !excels[0].rawData) throw new BadRequestException({ errorCode: "MATCH_EXCEL_NOT_READY", message: "Exactly one parsed Excel file is required." });
    if (pdfs.length === 0 || pdfs.some(f => f.processingStatus === "PENDING")) throw new BadRequestException({ errorCode: "MATCH_PDF_NOT_READY", message: "All PDF files must be parsed before matching." });
    const candidates: Candidate[] = [];
    const excelRows = ((excels[0].rawData as any).rows ?? []) as any[];
    for (const row of excelRows) { const raw = row?.extracted?.raw_order_code; if (typeof raw === "string" && normalizeOrderCode(raw)) candidates.push({ raw, normalized: normalizeOrderCode(raw), fileId: excels[0].id, source: "EXCEL", row: row.rowNumber, platform: "UNKNOWN" }); }
    for (const pdf of pdfs) for (const order of (((pdf.rawData as any)?.orders ?? []) as any[])) { const raw = order?.rawOrderCode; if (typeof raw === "string" && normalizeOrderCode(raw)) candidates.push({ raw, normalized: normalizeOrderCode(raw), fileId: pdf.id, source: "PDF", page: order.sourcePage, platform: pdf.platform }); }
    const indexed = new Map<string, Candidate[]>(); for (const candidate of candidates) indexed.set(candidate.normalized, [...(indexed.get(candidate.normalized) ?? []), candidate]);
    const results = [...indexed.entries()].map(([normalized, all]) => {
      const excel = all.filter(c => c.source === "EXCEL"); const pdf = all.filter(c => c.source === "PDF");
      const duplicate = excel.length > 1 || pdf.length > 1;
      const status = duplicate ? "DUPLICATE" : excel.length && pdf.length ? "MATCHED" : excel.length ? "PDF_NOT_FOUND" : "EXCEL_NOT_FOUND";
      const primary = excel[0] ?? pdf[0]; const platforms = [...new Set(pdf.map(c => c.platform))];
      return { normalized, all, status, primary, platform: platforms.length === 1 ? platforms[0] : "UNKNOWN" };
    });
    await prisma.$transaction(async tx => {
      await tx.processingError.deleteMany({ where: { batchId, errorCode: "DUPLICATE_ORDER" } });
      await tx.order.deleteMany({ where: { batchId } });
      if (process.env.STAGE6_TEST_FAIL_AFTER_DELETE === "1") throw new Error("STAGE6_TEST_CONTROLLED_TRANSACTION_FAILURE");
      await tx.order.createMany({ data: results.map(r => ({ batchId, rawOrderCode: r.primary.raw, normalizedOrderCode: r.normalized, platform: r.platform, matchingStatus: r.status as any, sourceRefs: { candidates: r.all.map(c => ({ fileId: c.fileId, source: c.source, row: c.row ?? null, page: c.page ?? null, rawOrderCode: c.raw })) } as Prisma.InputJsonValue })) });
      const duplicates = results.filter(r => r.status === "DUPLICATE");
      if (duplicates.length) await tx.processingError.createMany({ data: duplicates.map(r => ({ batchId, errorCode: "DUPLICATE_ORDER", message: "Duplicate order code affects matching.", severity: "ERROR", impact: "A unique master order cannot be determined.", suggestedAction: "Resolve duplicate source rows before matching.", rawContext: { normalizedOrderCode: r.normalized, occurrences: r.all.length } as Prisma.InputJsonValue })) });
      await tx.batch.update({ where: { id: batchId }, data: { orderCount: results.length, successCount: results.filter(r => r.status === "MATCHED").length, warningCount: results.filter(r => r.status === "PDF_NOT_FOUND" || r.status === "EXCEL_NOT_FOUND").length, errorCount: results.filter(r => r.status === "DUPLICATE" || r.status === "PARSE_ERROR").length } });
    }, { isolationLevel: "Serializable" });
    return { batchId, totalOrders: results.length, matched: results.filter(r => r.status === "MATCHED").length, pdfNotFound: results.filter(r => r.status === "PDF_NOT_FOUND").length, excelNotFound: results.filter(r => r.status === "EXCEL_NOT_FOUND").length, duplicate: results.filter(r => r.status === "DUPLICATE").length, parseError: 0 };
  }
}
