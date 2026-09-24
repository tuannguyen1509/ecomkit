import { Controller, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { BatchIdParamDto } from "../batches/dto/batch-id-param.dto.js";
import { PdfProcessingService } from "./pdf-processing.service.js";

@Controller("batches")
export class PdfController {
  constructor(@Inject(PdfProcessingService) private readonly processing: PdfProcessingService) {}
  @Post(":batchId/pdfs/parse")
  @HttpCode(200)
  parse(@Param() params: BatchIdParamDto) { return this.processing.parseBatch(params.batchId); }
}
