import { Module } from "@nestjs/common";
import { BatchesController } from "./batches.controller.js";
import { BatchesService } from "./batches.service.js";
import { QueueModule } from "../queue/queue.module.js";

@Module({
  imports: [QueueModule], controllers: [BatchesController],
  providers: [BatchesService],
  exports: [BatchesService]
})
export class BatchesModule {}
