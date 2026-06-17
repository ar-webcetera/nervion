import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString, Length } from 'class-validator';

export class UpdateChangelogDto {
  @IsString()
  @Length(1, 255)
  @IsOptional()
  @ApiProperty({ description: 'Заголовок обновления', example: 'Версия 2.6 — улучшения вики', required: false })
  title?: string;

  @IsObject()
  @IsOptional()
  @ApiProperty({
    description: 'Контент в формате TipTap JSON',
    required: false,
    example: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Что нового в этой версии' }] }] },
  })
  body?: Record<string, any>;

  @IsBoolean()
  @IsOptional()
  @ApiProperty({ description: 'Опубликован ли changelog', example: true, required: false })
  is_published?: boolean;
}
