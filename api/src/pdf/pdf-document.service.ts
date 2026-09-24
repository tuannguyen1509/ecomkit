import { Injectable } from "@nestjs/common";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFile } from "node:fs/promises";
import type { ParsedPdfDocument, ParsedPdfPage, PdfTextItem } from "./types/pdf.types.js";

@Injectable()
export class PdfDocumentService {
  async read(filePath: string, forcedPageFailures = new Set<number>()): Promise<ParsedPdfDocument> {
    try {
      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(await readFile(filePath)),
        standardFontDataUrl: new URL("../../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).toString(),
        useWorkerFetch: false
      });
      const document = await loadingTask.promise;
      const pages: ParsedPdfPage[] = [];

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        try {
          if (forcedPageFailures.has(pageNumber)) throw new Error("Controlled test page extraction failure");
          const page = await document.getPage(pageNumber);
          const content = await page.getTextContent();
          const items = content.items
            .filter((item): item is typeof item & { str: string; transform: number[]; width: number; height: number } => "str" in item)
            .map((item): PdfTextItem => ({ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width, height: item.height }));
          pages.push({ pageNumber, text: items.map((item) => item.text).join(" "), items });
          page.cleanup();
        } catch (error: unknown) {
          pages.push({
            pageNumber,
            text: "",
            items: [],
            error: { code: "PDF_PAGE_ERROR", message: error instanceof Error ? error.message : "UNKNOWN" }
          });
        }
      }
      return { pageCount: document.numPages, pages };
    } catch (error: unknown) {
      return { pageCount: 0, pages: [], readError: error instanceof Error ? error.message : "UNKNOWN" };
    }
  }
}
