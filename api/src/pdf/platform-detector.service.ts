import { Injectable } from "@nestjs/common";
import type { Platform } from "@ecomkit/database";
import type { ParsedPdfDocument } from "./types/pdf.types.js";

export interface PlatformDetection {
  platform: Platform;
  evidence: string[];
}

@Injectable()
export class PlatformDetectorService {
  detect(document: ParsedPdfDocument): PlatformDetection {
    // Observed in the approved SPX source sample. Filename is intentionally not inspected.
    if (document.pages.some((page) => page.text.includes("SPX"))) {
      return { platform: "SHOPEE", evidence: ["literal:SPX"] };
    }
    return { platform: "UNKNOWN", evidence: [] };
  }
}
