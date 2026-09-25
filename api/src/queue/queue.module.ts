import { Module } from "@nestjs/common";
import { BatchQueueService } from "./batch-queue.service.js";
@Module({providers:[BatchQueueService],exports:[BatchQueueService]}) export class QueueModule {}
