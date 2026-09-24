export type PdfJsonValue = string | number | boolean | null | PdfJsonValue[] | { [key: string]: PdfJsonValue };

export interface PdfTextItem {
  [key: string]: PdfJsonValue;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfPageIssue {
  code: "PDF_PAGE_ERROR";
  message: string;
}

export interface ParsedPdfPage {
  pageNumber: number;
  text: string;
  items: PdfTextItem[];
  error?: PdfPageIssue;
}

export interface ParsedPdfDocument {
  pageCount: number;
  pages: ParsedPdfPage[];
  readError?: string;
}

export interface PdfIssue {
  errorCode: string;
  message: string;
  pageNumber?: number;
  fieldName?: string;
  rawValue?: string;
  severity: "WARNING" | "ERROR";
  impact: string;
  suggestedAction: string;
  rawContext: { [key: string]: PdfJsonValue };
}

export interface PdfOrderCandidate {
  rawOrderCode: string;
  normalizedOrderCode: string;
  sourcePage: number;
  rawContext: string;
}
