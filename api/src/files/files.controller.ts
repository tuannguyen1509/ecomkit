import { Controller, HttpCode, Inject, Param, Post, UploadedFiles, UseFilters, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { randomUUID } from "node:crypto";
import { getUploadConfig } from "./upload.config.js";
import { FileIngestionService } from "./file-ingestion.service.js";
import { MulterExceptionFilter } from "./multer-exception.filter.js";
import { BatchIdParamDto } from "../batches/dto/batch-id-param.dto.js";

const uploadConfig = getUploadConfig();

@Controller("batches")
export class FilesController {
  constructor(@Inject(FileIngestionService) private readonly ingestion: FileIngestionService) {}

  @Post(":batchId/files")
  @HttpCode(201)
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FilesInterceptor("files", uploadConfig.maxFilesPerBatch, {
    storage: diskStorage({
      destination: uploadConfig.tempRoot,
      filename: (_request, _file, callback) => callback(null, randomUUID())
    }),
    limits: {
      fileSize: uploadConfig.maxFileSizeBytes,
      files: uploadConfig.maxFilesPerBatch
    }
  }))
  async uploadFiles(
    @Param() params: BatchIdParamDto,
    @UploadedFiles() files: Express.Multer.File[] = []
  ): Promise<{ id: string; uploaded: number }> {
    await this.ingestion.ingest(params.batchId, files);
    return { id: params.batchId, uploaded: files.length };
  }
}
