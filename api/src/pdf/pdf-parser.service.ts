import { Inject, Injectable } from "@nestjs/common";
import type { Platform } from "@ecomkit/database";
import { PlatformDetectorService } from "./platform-detector.service.js";
import { ShopeePdfParser } from "./providers/shopee-pdf-parser.js";
import { PdfDocumentService } from "./pdf-document.service.js";
import type { PdfIssue, PdfJsonValue } from "./types/pdf.types.js";

@Injectable()
export class PdfParserService {
  private readonly shopee = new ShopeePdfParser();

  constructor(
    @Inject(PdfDocumentService) private readonly documentReader: PdfDocumentService,
    @Inject(PlatformDetectorService) private readonly platformDetector: PlatformDetectorService
  ) {}

  async parse(filePath: string) {
    const document = await this.documentReader.read(filePath);
    if (document.readError) {
      return this.result("UNKNOWN", [], [{
        errorCode: "PDF_READ_ERROR", message: "PDF document could not be read.", severity: "ERROR",
        impact: "No PDF content is available for later matching.", suggestedAction: "Re-upload a valid PDF file.",
        rawContext: { reason: document.readError }
      }], document);
    }

    const detection = this.platformDetector.detect(document);
    const issues: PdfIssue[] = document.pages.filter((page) => page.error).map((page) => ({
      errorCode: "PDF_PAGE_ERROR", message: page.error!.message, pageNumber: page.pageNumber, severity: "WARNING",
      impact: "Text from this page is unavailable; other pages were retained.", suggestedAction: "Review or replace the affected PDF page.",
      rawContext: { pageNumber: page.pageNumber }
    }));
    const readableText = document.pages.map((page) => page.text).filter(Boolean);
    if (readableText.length === 0) {
      issues.push({
        errorCode: "PDF_PARSE_ERROR", message: "PDF không chứa lớp văn bản có thể đọc. OCR chưa được hỗ trợ trong phiên bản hiện tại.", severity: "ERROR",
        impact: "No text can be parsed from this PDF.", suggestedAction: "Provide a text-based PDF; OCR is not available.", rawContext: { pageCount: document.pageCount }
      });
    } else if (detection.platform === "UNKNOWN") {
      issues.push({
        errorCode: "UNKNOWN_PLATFORM", message: "PDF platform could not be determined from validated text evidence.", severity: "WARNING",
        impact: "Provider-specific parsing was not applied.", suggestedAction: "Provide a validated platform PDF sample or supported text evidence.", rawContext: { evidence: detection.evidence }
      });
    }

    const providerResult = detection.platform === "SHOPEE" ? this.shopee.parse(document) : { orders: [], issues: [] };
    issues.push(...providerResult.issues);
    return this.result(detection.platform, detection.evidence, issues, document, providerResult.orders);
  }

  private result(platform: Platform, evidence: string[], issues: PdfIssue[], document: Awaited<ReturnType<PdfDocumentService["read"]>>, orders: Array<{ rawOrderCode: string; normalizedOrderCode: string; sourcePage: number; rawContext: string }> = []) {
    const hasError = issues.some((issue) => issue.severity === "ERROR");
    const hasWarning = issues.some((issue) => issue.severity === "WARNING");
    return {
      platform,
      processingStatus: hasError ? "ERROR" as const : hasWarning ? "WARNING" as const : "SUCCESS" as const,
      issues,
      rawText: document.pages.filter((page) => !page.error).map((page) => page.text).filter(Boolean).join("\n\n") || null,
      rawStructure: {
        parserVersion: "stage5-v1",
        pageCount: document.pageCount,
        pages: document.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text, items: page.items, status: page.error ? "ERROR" : "SUCCESS", error: page.error?.message ?? null }))
      } satisfies { [key: string]: PdfJsonValue },
      rawData: { parserVersion: "stage5-v1", platform, detectionEvidence: evidence, orders } satisfies { [key: string]: PdfJsonValue }
    };
  }
}
