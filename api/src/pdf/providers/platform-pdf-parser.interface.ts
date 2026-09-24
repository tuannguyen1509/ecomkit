import type { Platform } from "@ecomkit/database";
import type { ParsedPdfDocument, PdfIssue, PdfOrderCandidate } from "../types/pdf.types.js";

export interface PlatformPdfParser {
  readonly platform: Platform;
  parse(document: ParsedPdfDocument): { orders: PdfOrderCandidate[]; issues: PdfIssue[] };
}
