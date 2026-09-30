import { IsString, Length } from "class-validator";

export class UpdateBrandingDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsString()
  @Length(0, 120)
  subtitle!: string;
}
