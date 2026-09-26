import { UserRole } from "@ecomkit/database";
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateAdminUserDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  username!: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  displayName!: string;

  @IsString() @MinLength(10) @MaxLength(1024)
  password!: string;

  @IsEnum(UserRole)
  role!: UserRole;
}

export class UpdateAdminUserDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200)
  displayName?: string;

  @IsOptional() @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class ResetAdminUserPasswordDto {
  @IsString() @MinLength(10) @MaxLength(1024)
  newPassword!: string;
}

export class UserIdParamDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  userId!: string;
}
