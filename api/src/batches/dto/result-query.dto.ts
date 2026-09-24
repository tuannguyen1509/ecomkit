import { IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";
import { Type } from "class-transformer";

const matchingStatuses = ["MATCHED", "PDF_NOT_FOUND", "EXCEL_NOT_FOUND", "DUPLICATE", "PARSE_ERROR"] as const;

export class ResultQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([20, 50, 100])
  pageSize?: number;

  @IsOptional()
  @IsString()
  @IsIn(matchingStatuses)
  status?: (typeof matchingStatuses)[number];

  @IsOptional()
  @IsString()
  @IsIn(["success", "warning", "error"])
  group?: "success" | "warning" | "error";
}
