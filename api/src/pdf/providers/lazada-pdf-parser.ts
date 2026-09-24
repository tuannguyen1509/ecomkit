import type { PlatformPdfParser } from "./platform-pdf-parser.interface.js";

export class LazadaPdfParser implements PlatformPdfParser {
  readonly platform = "LAZADA" as const;
  parse(): ReturnType<PlatformPdfParser["parse"]> { return { orders: [], issues: [] }; }
}
