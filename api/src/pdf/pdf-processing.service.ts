import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { prisma, Prisma } from "@ecomkit/database";
import { StorageService } from "../files/storage.service.js";
import { PdfParserService } from "./pdf-parser.service.js";

const PDF_ERROR_SCOPE = ["PDF_READ_ERROR", "PDF_PAGE_ERROR", "PDF_PARSE_ERROR", "PDF_ORDER_CODE_NOT_FOUND", "PDF_CUSTOMER_NOT_FOUND", "PDF_ADDRESS_NOT_FOUND", "PDF_PHONE_NOT_FOUND", "UNKNOWN_PLATFORM"];

@Injectable()
export class PdfProcessingService {
  constructor(
    @Inject(PdfParserService) private readonly parser: PdfParserService,
    @Inject(StorageService) private readonly storage: StorageService
  ) {}

  async parseBatch(batchId: string) {
    const batch = await prisma.batch.findUnique({ where: { id: batchId }, include: { uploadedFiles: { where: { fileType: "PDF" } } } });
    if (!batch) throw new NotFoundException({ errorCode: "BATCH_NOT_FOUND", message: "Batch was not found." });
    if (batch.uploadedFiles.length === 0) throw new BadRequestException({ errorCode: "BATCH_PDF_FILE_MISSING", message: "Batch has no PDF files to parse." });
    const files = [];
    for (const file of batch.uploadedFiles) files.push(await this.parseFile(batchId, file));
    return {
      batchId,
      totalPdfFiles: files.length,
      success: files.filter((file) => file.status === "SUCCESS").length,
      warning: files.filter((file) => file.status === "WARNING").length,
      error: files.filter((file) => file.status === "ERROR").length,
      files
    };
  }

  private async parseFile(batchId: string, file: { id: string; storagePath: string | null }) {
    const parsed = await this.parser.parse(this.storage.resolveStoredFile(file.storagePath));
    await prisma.$transaction(async (transaction) => {
      await transaction.processingError.deleteMany({ where: { uploadedFileId: file.id, errorCode: { in: PDF_ERROR_SCOPE } } });
      await transaction.uploadedFile.update({
        where: { id: file.id },
        data: {
          rawText: parsed.rawText,
          rawStructure: parsed.rawStructure as unknown as Prisma.InputJsonValue,
          rawData: parsed.rawData as unknown as Prisma.InputJsonValue,
          platform: parsed.platform,
          processingStatus: parsed.processingStatus
        }
      });
      if (parsed.issues.length > 0) await transaction.processingError.createMany({ data: parsed.issues.map((issue) => ({
        batchId, uploadedFileId: file.id, errorCode: issue.errorCode, message: issue.message, pageNumber: issue.pageNumber,
        fieldName: issue.fieldName, rawValue: issue.rawValue, severity: issue.severity, impact: issue.impact,
        suggestedAction: issue.suggestedAction, rawContext: issue.rawContext as Prisma.InputJsonValue
      })) });
    }, { isolationLevel: "Serializable" });
    return { fileId: file.id, status: parsed.processingStatus, platform: parsed.platform, pageCount: (parsed.rawStructure.pages as unknown[]).length };
  }
}
