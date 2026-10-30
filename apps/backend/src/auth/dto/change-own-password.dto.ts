import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangeOwnPasswordDto {
  @IsString() @MinLength(1) @MaxLength(256) currentPassword: string;
  @IsString() @MinLength(12) @MaxLength(256) newPassword: string;
}
