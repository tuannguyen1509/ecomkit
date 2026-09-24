import { Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { BatchIdParamDto } from "./dto/batch-id-param.dto.js";
import { ResultQueryDto } from "./dto/result-query.dto.js";
import { ErrorQueryDto } from "./dto/error-query.dto.js";
import { BatchesService } from "./batches.service.js";

@Controller("batches")
export class BatchesController {
  constructor(@Inject(BatchesService) private readonly batches: BatchesService) {}

  @Post()
  createBatch(): Promise<{ id: string; processingStatus: string; createdAt: Date }> {
    return this.batches.create();
  }

  @Get(":batchId/results")
  getResults(@Param() params: BatchIdParamDto, @Query() query: ResultQueryDto) {
    return this.batches.findResults(params.batchId, query);
  }

  @Get(":batchId/errors/:errorId")
  getError(@Param() params: BatchIdParamDto & { errorId: string }) { return this.batches.findError(params.batchId, params.errorId); }

  @Get(":batchId/errors")
  getErrors(@Param() params: BatchIdParamDto, @Query() query: ErrorQueryDto) { return this.batches.findErrors(params.batchId, query); }

  @Get(":batchId")
  getBatch(@Param() params: BatchIdParamDto) {
    return this.batches.findOne(params.batchId);
  }
}
