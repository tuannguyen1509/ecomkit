import { Module } from "@nestjs/common";
import { FileValidationService } from "../files/file-validation.service.js";
import { StorageService } from "../files/storage.service.js";
import { ExcelController } from "./excel.controller.js";
import { ExcelParserService } from "./excel-parser.service.js";
import { ExcelProcessingService } from "./excel-processing.service.js";

@Module({
  controllers: [ExcelController],
  providers: [ExcelParserService, ExcelProcessingService, StorageService, FileValidationService]
})
export class ExcelModule {}
