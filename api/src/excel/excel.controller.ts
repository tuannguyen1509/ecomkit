import { Controller, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { BatchIdParamDto } from "../batches/dto/batch-id-param.dto.js";
import { ExcelProcessingService } from "./excel-processing.service.js";

@Controller("batches")
export class ExcelController {
  constructor(@Inject(ExcelProcessingService) private readonly processing: ExcelProcessingService) {}

  @Post(":batchId/excel/parse")
  @HttpCode(200)
  parse(@Param() params: BatchIdParamDto) {
    return this.processing.parseBatchExcel(params.batchId);
  }
}
