import { IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";
import { Type } from "class-transformer";

const processingStatuses = ["PENDING", "PROCESSING", "SUCCESS", "WARNING", "ERROR"] as const;

export class HistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @IsIn([20, 50, 100])
  pageSize?: number;

  @IsOptional() @IsString() @IsIn(processingStatuses)
  status?: (typeof processingStatuses)[number];
}
