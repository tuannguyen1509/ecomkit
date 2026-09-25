import { IsIn, IsOptional, IsString } from "class-validator";

export class ExportQueryDto {
  @IsString() @IsIn(["xlsx", "csv"])
  format!: "xlsx" | "csv";

  @IsOptional() @IsString() @IsIn(["ALL", "MATCHED", "PDF_NOT_FOUND", "EXCEL_NOT_FOUND", "DUPLICATE", "PARSE_ERROR"])
  status?: "ALL" | "MATCHED" | "PDF_NOT_FOUND" | "EXCEL_NOT_FOUND" | "DUPLICATE" | "PARSE_ERROR";
}
