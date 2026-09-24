import { Injectable } from "@nestjs/common";
import ExcelJS, { type Cell, type Worksheet } from "exceljs";
import type { ExcelJsonValue, ExcelParseError, ExcelParseResult } from "./excel-parser.types.js";
import { normalizeOrderCode } from "@ecomkit/shared";

const REQUIRED_HEADER = "Mã đơn sàn";
const HEADER_ROW = 1;
const PARSER_VERSION = "stage4-v1";

@Injectable()
export class ExcelParserService {
  async parse(filePath: string): Promise<ExcelParseResult> {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);

      if (workbook.worksheets.length !== 1) {
        return this.structuralError(
          "EXCEL_SHEET_NOT_FOUND",
          workbook.worksheets.length === 0
            ? "Workbook does not contain a usable worksheet."
            : "Workbook has multiple worksheets and no sheet-selection rule is configured.",
          { worksheetCount: workbook.worksheets.length }
        );
      }

      return this.parseWorksheet(workbook.worksheets[0]);
    } catch (error: unknown) {
      return this.structuralError("EXCEL_READ_ERROR", "Excel workbook could not be read.", {
        reason: error instanceof Error ? error.message : "UNKNOWN"
      });
    }
  }

  private parseWorksheet(worksheet: Worksheet): ExcelParseResult {
    const headerRow = worksheet.getRow(HEADER_ROW);
    const headers = this.headerValues(headerRow, worksheet.columnCount);
    const nonEmptyHeaders = headers.filter((header) => header !== "");

    if (nonEmptyHeaders.length === 0) {
      return this.structuralError("EXCEL_HEADER_MISSING", "Header row 1 is empty.", {
        sheet: worksheet.name,
        headerRow: HEADER_ROW
      }, worksheet.name);
    }

    const requiredColumnIndex = headers.findIndex((header) => header === REQUIRED_HEADER) + 1;
    if (requiredColumnIndex === 0) {
      return this.structuralError(
        "EXCEL_REQUIRED_COLUMN_MISSING",
        `Required column \"${REQUIRED_HEADER}\" is missing from the header row.`,
        { sheet: worksheet.name, headerRow: HEADER_ROW, headers },
        worksheet.name
      );
    }

    const errors: ExcelParseError[] = [];
    const rawRows: ExcelJsonValue[] = [];
    const firstSeen = new Map<string, number>();
    let totalRows = 0;
    let validRows = 0;

    for (let rowNumber = HEADER_ROW + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const rawCells = this.rowValues(row, Math.max(worksheet.columnCount, headers.length));
      if (Object.values(rawCells).every((value) => value === null || value === "")) {
        continue;
      }

      totalRows += 1;
      const orderCodeCell = row.getCell(requiredColumnIndex);
      const rawOrderCode = this.displayValue(orderCodeCell);
      const normalizedOrderCode = normalizeOrderCode(rawOrderCode);
      rawRows.push({
        rowNumber,
        rawCells,
        extracted: {
          raw_order_code: rawOrderCode,
          normalized_order_code: normalizedOrderCode || null,
          order_code_formula: this.formulaValue(orderCodeCell)
        }
      });

      if (this.isFormulaWithoutResult(orderCodeCell)) {
        errors.push(this.rowError("EXCEL_READ_ERROR", "Order code formula has no cached result.", worksheet.name, rowNumber, rawOrderCode, {
          rawFormula: this.formulaValue(orderCodeCell)
        }));
        continue;
      }

      if (!normalizedOrderCode) {
        errors.push(this.rowError("EXCEL_EMPTY_ORDER_CODE", `\"${REQUIRED_HEADER}\" is empty.`, worksheet.name, rowNumber, rawOrderCode));
        continue;
      }

      const existingRow = firstSeen.get(normalizedOrderCode);
      if (existingRow !== undefined) {
        errors.push(this.rowError("EXCEL_DUPLICATE_ORDER_CODE", "Duplicate order code found in this Excel file.", worksheet.name, rowNumber, rawOrderCode, {
          normalizedOrderCode,
          firstSeenRow: existingRow
        }));
        continue;
      }

      firstSeen.set(normalizedOrderCode, rowNumber);
      validRows += 1;
    }

    return {
      status: errors.length === 0 ? "SUCCESS" : "ERROR",
      totalRows,
      validRows,
      warningCount: 0,
      errorCount: errors.length,
      rawData: {
        parserVersion: PARSER_VERSION,
        sheet: worksheet.name,
        headerRow: HEADER_ROW,
        headers,
        rows: rawRows
      },
      errors
    };
  }

  private structuralError(errorCode: string, message: string, rawContext: { [key: string]: ExcelJsonValue }, sheetName?: string): ExcelParseResult {
    return {
      status: "ERROR",
      totalRows: 0,
      validRows: 0,
      warningCount: 0,
      errorCount: 1,
      errors: [{
        errorCode,
        message,
        sheetName,
        impact: "Excel data cannot be used for later matching.",
        suggestedAction: "Correct the workbook structure and parse the same file again.",
        rawContext
      }]
    };
  }

  private rowError(errorCode: string, message: string, sheetName: string, rowNumber: number, rawValue: string, extraContext: { [key: string]: ExcelJsonValue } = {}): ExcelParseError {
    return {
      errorCode,
      message,
      sheetName,
      rowNumber,
      columnName: REQUIRED_HEADER,
      fieldName: REQUIRED_HEADER,
      rawValue: rawValue || undefined,
      impact: "This row cannot be matched reliably.",
      suggestedAction: "Correct the order-code cell and parse the same file again.",
      rawContext: { ...extraContext, rowNumber, column: REQUIRED_HEADER }
    };
  }

  private headerValues(row: ExcelJS.Row, columnCount: number): string[] {
    return Array.from({ length: columnCount }, (_, index) => row.getCell(index + 1).text.trim());
  }

  private rowValues(row: ExcelJS.Row, columnCount: number): { [key: string]: ExcelJsonValue } {
    const values: { [key: string]: ExcelJsonValue } = {};
    for (let index = 1; index <= columnCount; index += 1) {
      values[String(index)] = this.jsonValue(row.getCell(index).value);
    }
    return values;
  }

  private displayValue(cell: Cell): string {
    const value = cell.value;
    if (value && typeof value === "object" && "formula" in value) {
      const formulaValue = value as ExcelJS.CellFormulaValue;
      return formulaValue.result === undefined || formulaValue.result === null ? "" : String(formulaValue.result);
    }
    return cell.text;
  }

  private formulaValue(cell: Cell): ExcelJsonValue {
    const value = cell.value;
    return value && typeof value === "object" && "formula" in value ? String((value as ExcelJS.CellFormulaValue).formula) : null;
  }

  private isFormulaWithoutResult(cell: Cell): boolean {
    const value = cell.value;
    return Boolean(value && typeof value === "object" && "formula" in value && (value as ExcelJS.CellFormulaValue).result == null);
  }

  private jsonValue(value: ExcelJS.CellValue): ExcelJsonValue {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (value instanceof Date) return value.toISOString();
    return JSON.parse(JSON.stringify(value)) as ExcelJsonValue;
  }
}
