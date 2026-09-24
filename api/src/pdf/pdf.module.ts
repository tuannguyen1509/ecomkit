import { Module } from "@nestjs/common";
import { StorageService } from "../files/storage.service.js";
import { PdfController } from "./pdf.controller.js";
import { PdfDocumentService } from "./pdf-document.service.js";
import { PdfParserService } from "./pdf-parser.service.js";
import { PdfProcessingService } from "./pdf-processing.service.js";
import { PlatformDetectorService } from "./platform-detector.service.js";

@Module({ controllers: [PdfController], providers: [PdfDocumentService, PdfParserService, PdfProcessingService, PlatformDetectorService, StorageService] })
export class PdfModule {}
