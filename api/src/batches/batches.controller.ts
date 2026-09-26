import { Controller, Get, HttpCode, Inject, Param, Post, Query, Res, StreamableFile } from "@nestjs/common";
import type { Response } from "express";
import { BatchIdParamDto } from "./dto/batch-id-param.dto.js";
import { ResultQueryDto } from "./dto/result-query.dto.js";
import { ErrorQueryDto } from "./dto/error-query.dto.js";
import { HistoryQueryDto } from "./dto/history-query.dto.js";
import { ExportQueryDto } from "./dto/export-query.dto.js";
import { BatchesService } from "./batches.service.js";
import { BatchQueueService } from "../queue/batch-queue.service.js";
import { RateLimit } from "../auth/auth.decorators.js";

@Controller("batches")
export class BatchesController {
  constructor(@Inject(BatchesService) private readonly batches: BatchesService, @Inject(BatchQueueService) private readonly queue: BatchQueueService) {}

  @Post(":batchId/process") @HttpCode(202)
  @RateLimit({ scope: "batch-process", limit: 20, windowMs: 60_000 })
  process(@Param() params: BatchIdParamDto) { return this.queue.enqueue(params.batchId); }
  @Get(":batchId/processing-status")
  processingStatus(@Param() params: BatchIdParamDto) { return this.queue.status(params.batchId); }

  @Post()
  createBatch(): Promise<{ id: string; processingStatus: string; createdAt: Date }> {
    return this.batches.create();
  }

  @Get("history")
  getHistory(@Query() query: HistoryQueryDto) {
    return this.batches.findHistory(query);
  }

  @Get(":batchId/export")
  async export(@Param() params: BatchIdParamDto, @Query() query: ExportQueryDto, @Res({ passthrough: true }) response: Response) {
    const file = await this.batches.exportOrders(params.batchId, query);
    response.setHeader("Content-Type", file.contentType);
    response.setHeader("Content-Disposition", `attachment; filename=\"${file.filename}\"`);
    return new StreamableFile(file.content);
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
