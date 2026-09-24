import { Module } from "@nestjs/common";
import { FilesController } from "./files.controller.js";
import { FileIngestionService } from "./file-ingestion.service.js";
import { FileValidationService } from "./file-validation.service.js";
import { StorageService } from "./storage.service.js";

@Module({
  controllers: [FilesController],
  providers: [FileIngestionService, FileValidationService, StorageService]
})
export class FilesModule {}
