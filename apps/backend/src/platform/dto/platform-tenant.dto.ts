import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CreatePlatformTenantRequest, TenantStatus, UpdatePlatformTenantRequest } from '@tracker/contracts';

export class PlatformLoginDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(1) @MaxLength(256) password: string;
}

class FirstAdminDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(1) @MaxLength(50) firstName: string;
  @IsString() @MinLength(1) @MaxLength(50) lastName: string;
  @IsString() @MinLength(12) @MaxLength(256) password: string;
  @IsOptional()
  @Transform(({ obj }: { obj: FirstAdminDto }) => obj.emailOwnershipVerified)
  @IsBoolean()
  emailOwnershipVerified?: boolean;
}

export class VerifyPlatformIdentityDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(12) @MaxLength(256) newPassword: string;
  @Transform(({ obj }: { obj: VerifyPlatformIdentityDto }) => obj.verifiedOwnership) @Equals(true) verifiedOwnership: boolean;
}

export class CreatePlatformTenantDto implements CreatePlatformTenantRequest {
  @Matches(/^[a-z][a-z0-9-]{1,48}[a-z0-9]$/) slug: string;
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsString() @MinLength(1) @MaxLength(80) plan: string;
  @IsInt() @Min(1) seatLimit: number;
  @IsOptional() @IsISO8601() paidUntil: string | null;
  @IsObject() featureFlags: Record<string, boolean>;
  @ValidateNested() @Type(() => FirstAdminDto) admin: FirstAdminDto;
}

export class UpdatePlatformTenantDto implements UpdatePlatformTenantRequest {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) plan?: string;
  @IsOptional() @IsInt() @Min(1) seatLimit?: number;
  @IsOptional() @IsISO8601() paidUntil?: string | null;
  @IsOptional()
  @IsIn([TenantStatus.ACTIVE, TenantStatus.READ_ONLY, TenantStatus.SUSPENDED, TenantStatus.CANCELLED])
  status?: TenantStatus;
  @IsOptional() @IsObject() featureFlags?: Record<string, boolean>;
}
