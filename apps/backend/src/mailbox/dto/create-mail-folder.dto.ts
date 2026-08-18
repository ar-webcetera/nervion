import { Type } from 'class-transformer';
import { IsInt, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateMailFolderDto {
  @ApiProperty({ description: 'ID почтового ящика', example: 1 })
  @IsInt()
  @Type(() => Number)
  account_id: number;

  @ApiProperty({ description: 'Название папки', example: 'Клиенты' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;
}
