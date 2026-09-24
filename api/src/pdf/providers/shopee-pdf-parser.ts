import type { PlatformPdfParser } from "./platform-pdf-parser.interface.js";

export class ShopeePdfParser implements PlatformPdfParser {
  readonly platform = "SHOPEE" as const;

  parse(document: Parameters<PlatformPdfParser["parse"]>[0]) {
    const orders = document.pages.flatMap((page) => [...page.text.matchAll(/\d{7}[A-Z0-9]{7}/g)].map((match) => ({
      rawOrderCode: match[0],
      normalizedOrderCode: match[0].trim(),
      sourcePage: page.pageNumber,
      rawContext: "SPX text-layer candidate"
    })));
    return {
      orders,
      issues: orders.length > 0 ? [] : [{
        errorCode: "PDF_ORDER_CODE_NOT_FOUND",
        message: "No SPX order-code candidate was found in readable PDF text.",
        severity: "ERROR" as const,
        impact: "This PDF cannot be matched without an order code.",
        suggestedAction: "Verify the SPX document text layer and layout.",
        rawContext: { platform: "SHOPEE" }
      }]
    };
  }
}
