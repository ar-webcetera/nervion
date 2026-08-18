import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateMailFolderDto {
  @ApiProperty({ description: 'Новое название папки', example: 'Важные клиенты' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;
}
