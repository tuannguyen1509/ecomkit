import { IsNotEmpty, IsString, Matches } from "class-validator";

export class BatchIdParamDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^c[\da-z]{24,}$/i, { message: "batchId must be a valid CUID." })
  batchId!: string;
}
