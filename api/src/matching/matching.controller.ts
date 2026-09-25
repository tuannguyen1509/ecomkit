import { Controller, Inject, Param, Post } from "@nestjs/common";
import { AllowInternalWorker } from "../auth/auth.decorators.js";
import { BatchIdParamDto } from "../batches/dto/batch-id-param.dto.js";
import { MatchingService } from "./matching.service.js";
@Controller("batches") export class MatchingController { constructor(@Inject(MatchingService) private readonly matching: MatchingService) {} @Post(":batchId/match") @AllowInternalWorker() match(@Param() params: BatchIdParamDto) { return this.matching.match(params.batchId); } }
