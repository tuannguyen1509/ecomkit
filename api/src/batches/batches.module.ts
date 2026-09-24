import { Module } from "@nestjs/common";
import { BatchesController } from "./batches.controller.js";
import { BatchesService } from "./batches.service.js";

@Module({
  controllers: [BatchesController],
  providers: [BatchesService],
  exports: [BatchesService]
})
export class BatchesModule {}
