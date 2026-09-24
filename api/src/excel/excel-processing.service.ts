import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { prisma, Prisma } from "@ecomkit/database";
import { StorageService } from "../files/storage.service.js";
import { ExcelParserService } from "./excel-parser.service.js";
import type { ExcelParseResult } from "./excel-parser.types.js";

@Injectable()
export class ExcelProcessingService {
  constructor(
    @Inject(ExcelParserService) private readonly parser: ExcelParserService,
    @Inject(StorageService) private readonly storage: StorageService
  ) {}

  async parseBatchExcel(batchId: string): Promise<{ batchId: string; fileId: string; status: string; totalRows: number; validRows: number; warningCount: number; errorCount: number }> {
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: { uploadedFiles: { where: { fileType: "EXCEL" } } }
    });
    if (!batch) throw new NotFoundException({ errorCode: "BATCH_NOT_FOUND", message: "Batch was not found." });
    if (batch.uploadedFiles.length !== 1) {
      throw new BadRequestException({
        errorCode: "BATCH_EXCEL_FILE_INVALID",
        message: "Batch must contain exactly one Excel file before parsing."
      });
    }

    const file = batch.uploadedFiles[0];
    let result: ExcelParseResult;
    try {
      result = await this.parser.parse(this.storage.resolveStoredFile(file.storagePath));
    } catch (error: unknown) {
      result = {
        status: "ERROR", totalRows: 0, validRows: 0, warningCount: 0, errorCount: 1,
        errors: [{
          errorCode: "EXCEL_READ_ERROR",
          message: "Excel storage file could not be resolved safely.",
          impact: "Excel data cannot be used for later matching.",
          suggestedAction: "Re-upload a valid Excel file.",
          rawContext: { reason: error instanceof Error ? error.message : "UNKNOWN" }
        }]
      };
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.processingError.deleteMany({
        where: { uploadedFileId: file.id, errorCode: { startsWith: "EXCEL_" } }
      });
      await transaction.uploadedFile.update({
        where: { id: file.id },
        data: {
          rawData: result.rawData ? result.rawData as Prisma.InputJsonValue : Prisma.DbNull,
          processingStatus: result.status
        }
      });
      if (result.errors.length > 0) {
        await transaction.processingError.createMany({
          data: result.errors.map((error) => ({
            batchId,
            uploadedFileId: file.id,
            errorCode: error.errorCode,
            message: error.message,
            sheetName: error.sheetName,
            rowNumber: error.rowNumber,
            columnName: error.columnName,
            fieldName: error.fieldName,
            rawValue: error.rawValue,
            severity: "ERROR",
            impact: error.impact,
            suggestedAction: error.suggestedAction,
            rawContext: error.rawContext as Prisma.InputJsonValue
          }))
        });
      }
    }, { isolationLevel: "Serializable" });

    return { batchId, fileId: file.id, status: result.status, totalRows: result.totalRows, validRows: result.validRows, warningCount: result.warningCount, errorCount: result.errorCount };
  }
}
