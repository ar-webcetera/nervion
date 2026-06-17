import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUrl, IsOptional, IsInt } from 'class-validator';

export class CreateQuickLinkDto {
  @ApiProperty({ description: 'Название ссылки', example: 'Документация проекта', required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ description: 'URL ссылки', example: 'https://example.com/docs' })
  @IsUrl()
  url: string;

  @ApiProperty({ description: 'Позиция в списке', example: 0, required: false })
  @IsOptional()
  @IsInt()
  position?: number;

  @ApiProperty({ description: 'Идентификатор проекта', example: 12 })
  @IsInt()
  project_id: number;
}
