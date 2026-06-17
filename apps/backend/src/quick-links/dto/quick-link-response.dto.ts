import { ApiProperty } from '@nestjs/swagger';

export class QuickLinkResponseDto {
  @ApiProperty({ description: 'Идентификатор быстрой ссылки', example: 1 })
  id: number;

  @ApiProperty({ description: 'Название ссылки', example: 'Документация проекта' })
  title: string;

  @ApiProperty({ description: 'URL ссылки', example: 'https://example.com/docs' })
  url: string;

  @ApiProperty({ description: 'Идентификатор владельца ссылки', example: 5 })
  user_id: number;

  @ApiProperty({ description: 'Позиция в списке', example: 0 })
  position: number;

  @ApiProperty({ description: 'Дата создания', example: '2026-06-15T10:00:00.000Z' })
  created_at: Date;

  @ApiProperty({ description: 'Дата последнего обновления', example: '2026-06-15T12:30:00.000Z' })
  updated_at: Date;
}
