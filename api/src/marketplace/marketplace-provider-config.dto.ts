import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from "class-validator";

export class UpdateShopeeProviderConfigDto {
  @IsIn(["sandbox", "production"])
  environment!: "sandbox" | "production";
  @IsString() @IsNotEmpty() @MaxLength(200)
  partnerId!: string;
  @IsOptional() @IsString() @MaxLength(4096)
  partnerKey?: string;
  @IsUrl({ require_protocol: true, protocols: ["http", "https"], require_tld: false }) @MaxLength(2048)
  redirectUri!: string;
  @IsBoolean()
  enabled!: boolean;
}
