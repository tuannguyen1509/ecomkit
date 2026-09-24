import type { PlatformPdfParser } from "./platform-pdf-parser.interface.js";

export class TikTokPdfParser implements PlatformPdfParser {
  readonly platform = "TIKTOK" as const;
  parse(): ReturnType<PlatformPdfParser["parse"]> { return { orders: [], issues: [] }; }
}
