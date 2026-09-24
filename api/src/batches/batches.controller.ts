import { Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { BatchIdParamDto } from "./dto/batch-id-param.dto.js";
import { BatchesService } from "./batches.service.js";

@Controller("batches")
export class BatchesController {
  constructor(@Inject(BatchesService) private readonly batches: BatchesService) {}

  @Post()
  createBatch(): Promise<{ id: string; processingStatus: string; createdAt: Date }> {
    return this.batches.create();
  }

  @Get(":batchId")
  getBatch(@Param() params: BatchIdParamDto) {
    return this.batches.findOne(params.batchId);
  }
}
