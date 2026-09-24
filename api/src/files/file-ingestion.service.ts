import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@ecomkit/database";
import { getUploadConfig } from "./upload.config.js";
import { FileValidationService, type ValidatedUpload } from "./file-validation.service.js";
import { uploadError, uploadErrors, type UploadErrorDetail } from "./upload-error.js";
import { StorageService } from "./storage.service.js";

interface PreparedUpload extends ValidatedUpload {
  storagePath: string;
  absolutePath: string;
}

@Injectable()
export class FileIngestionService {
  private readonly config = getUploadConfig();

  constructor(
    @Inject(FileValidationService) private readonly validation: FileValidationService,
    @Inject(StorageService) private readonly storage: StorageService
  ) {}

  async ingest(batchId: string, files: Express.Multer.File[]): Promise<void> {
    if (files.length === 0) {
      throw uploadError({
        errorCode: "FILE_INVALID",
        message: "At least one file is required.",
        details: { field: "files" }
      });
    }

    const batch = await prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) {
      throw new NotFoundException({ errorCode: "BATCH_NOT_FOUND", message: "Batch was not found." });
    }

    const validationResults = await Promise.all(files.map((file) => this.validation.validate(file)));
    const errors = validationResults.filter((result): result is UploadErrorDetail => "errorCode" in result);
    if (errors.length > 0) {
      throw errors.length === 1 ? uploadError(errors[0]) : uploadErrors(errors);
    }
    const validFiles = validationResults as ValidatedUpload[];

    const existingFileCount = await prisma.uploadedFile.count({ where: { batchId } });
    if (existingFileCount + validFiles.length > this.config.maxFilesPerBatch) {
      throw new BadRequestException({
        errorCode: "FILE_INVALID",
        message: `Batch would exceed the configured limit of ${this.config.maxFilesPerBatch} files.`,
        details: { field: "files" }
      });
    }

    const existingExcelCount = await prisma.uploadedFile.count({ where: { batchId, fileType: "EXCEL" } });
    const submittedExcelCount = validFiles.filter((file) => file.fileType === "EXCEL").length;
    if (existingExcelCount + submittedExcelCount > 1) {
      throw uploadError({
        errorCode: "FILE_INVALID",
        message: "Batch chỉ cho phép 1 file Excel.",
        details: { field: "files" }
      });
    }

    const movedPaths: string[] = [];
    try {
      const prepared: PreparedUpload[] = [];
      for (const file of validFiles) {
        const stored = await this.storage.moveTempFile(batchId, file.file.path, file.sanitizedFilename);
        movedPaths.push(stored.absolutePath);
        prepared.push({ ...file, storagePath: stored.relativePath, absolutePath: stored.absolutePath });
      }

      await prisma.$transaction(async (transaction) => {
        const batchInTransaction = await transaction.batch.findUnique({ where: { id: batchId } });
        if (!batchInTransaction) {
          throw new NotFoundException({ errorCode: "BATCH_NOT_FOUND", message: "Batch was not found." });
        }

        const excelCount = await transaction.uploadedFile.count({ where: { batchId, fileType: "EXCEL" } });
        if (excelCount + submittedExcelCount > 1) {
          throw uploadError({
            errorCode: "FILE_INVALID",
            message: "Batch chỉ cho phép 1 file Excel.",
            details: { field: "files" }
          });
        }

        await transaction.uploadedFile.createMany({
          data: prepared.map((file) => ({
            batchId,
            originalFilename: file.file.originalname,
            sanitizedFilename: file.sanitizedFilename,
            fileType: file.fileType,
            platform: "UNKNOWN",
            mimeType: file.mimeType,
            sizeBytes: BigInt(file.file.size),
            storagePath: file.storagePath,
            processingStatus: "PENDING"
          }))
        });

        const persistedFiles = await transaction.uploadedFile.findMany({
          where: { batchId },
          select: { fileType: true }
        });
        const excelFileCount = persistedFiles.filter((file) => file.fileType === "EXCEL").length;
        const pdfFileCount = persistedFiles.filter((file) => file.fileType === "PDF").length;

        await transaction.batch.update({
          where: { id: batchId },
          data: { fileCount: persistedFiles.length, excelFileCount, pdfFileCount }
        });
      }, { isolationLevel: "Serializable" });
    } catch (error: unknown) {
      await this.storage.cleanup(movedPaths, true);
      throw error;
    } finally {
      await this.storage.cleanup(files.map((file) => file.path));
    }
  }
}
