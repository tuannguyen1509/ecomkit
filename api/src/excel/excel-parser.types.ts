export type ExcelJsonValue = string | number | boolean | null | ExcelJsonValue[] | { [key: string]: ExcelJsonValue };

export interface ExcelParseError {
  errorCode: string;
  message: string;
  sheetName?: string;
  rowNumber?: number;
  columnName?: string;
  fieldName?: string;
  rawValue?: string;
  impact: string;
  suggestedAction: string;
  rawContext: { [key: string]: ExcelJsonValue };
}

export interface ExcelParseResult {
  status: "SUCCESS" | "ERROR";
  totalRows: number;
  validRows: number;
  warningCount: number;
  errorCount: number;
  rawData?: { [key: string]: ExcelJsonValue };
  errors: ExcelParseError[];
}
