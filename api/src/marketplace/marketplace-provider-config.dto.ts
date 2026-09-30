import { IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from "class-validator";

export class UpdateShopeeProviderConfigDto {
  @IsIn(["sandbox", "production"])
  environment!: "sandbox" | "production";
  @IsString() @IsNotEmpty() @MaxLength(200)
  partnerId!: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(4096)
  partnerKey?: string;
  @IsUrl({ require_protocol: true, protocols: ["http", "https"], require_tld: false }) @MaxLength(2048)
  redirectUri!: string;
  @IsBoolean()
  enabled!: boolean;
}

export class ImportShopeeExternalTokenDto {
  @IsIn(["sandbox", "production"])
  environment!: "sandbox" | "production";
  @IsString() @IsNotEmpty() @MaxLength(200)
  partnerId!: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(4096)
  partnerKey?: string;
  @IsString() @IsNotEmpty() @MaxLength(100)
  shopId!: string;
  @IsString() @IsNotEmpty() @MaxLength(8192)
  accessToken!: string;
  @IsDateString()
  accessTokenExpiresAt!: string;
}

export class TestShopeeExternalConfigDto {
  @IsString() @IsNotEmpty()
  connectionId!: string;
}

export class TestShopeeLiveReadDto {
  @IsString() @IsNotEmpty()
  connectionId!: string;
  @IsIn(["create_time", "update_time"])
  timeRangeField!: "create_time" | "update_time";
  @IsInt() @Min(0)
  timeFrom!: number;
  @IsInt() @Min(1)
  timeTo!: number;
  @IsOptional() @IsInt() @Min(1) @Max(100)
  pageSize?: number;
  @IsOptional() @IsString() @MaxLength(100)
  orderStatus?: string;
}
