export type MatchingStatus = "MATCHED" | "PDF_NOT_FOUND" | "EXCEL_NOT_FOUND" | "DUPLICATE" | "PARSE_ERROR";
export type Platform = "SHOPEE" | "LAZADA" | "TIKTOK" | "UNKNOWN";

export interface ResultOrder {
  id: string;
  rawOrderCode: string | null;
  normalizedOrderCode: string | null;
  platform: Platform;
  matchingStatus: MatchingStatus;
  sourceRefs: {
    candidates?: Array<{
      fileId?: string;
      source?: "EXCEL" | "PDF";
      row?: number | null;
      page?: number | null;
    }>;
  } | null;
}

export interface BatchResultsResponse {
  batch: {
    id: string;
    processingStatus: string;
    createdAt: string;
    updatedAt: string;
  };
  summary: {
    totalFiles: number;
    totalOrders: number;
    success: number;
    warning: number;
    error: number;
  };
  matching: Record<"matched" | "pdfNotFound" | "excelNotFound" | "duplicate" | "parseError", number>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  orders: ResultOrder[];
}
