import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum MAIL_FOLDER_FILTER {
  inbox = 'inbox',
  sent = 'sent',
  drafts = 'drafts',
  spam = 'spam',
  trash = 'trash',
}

export class FindThreadsDto {
  @ApiPropertyOptional({
    description: 'Папка для фильтрации цепочек',
    enum: MAIL_FOLDER_FILTER,
    example: MAIL_FOLDER_FILTER.inbox,
  })
  @IsOptional()
  @IsEnum(MAIL_FOLDER_FILTER)
  folder?: MAIL_FOLDER_FILTER;

  @ApiProperty({ description: 'ID выбранного почтового ящика', example: 1 })
  @IsInt()
  @Type(() => Number)
  account_id: number;

  @ApiPropertyOptional({ description: 'ID пользовательской папки', example: 3 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  custom_folder_id?: number;

  @ApiPropertyOptional({ description: 'ID задачи для фильтрации привязанных цепочек', example: 42 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  task_id?: number;

  @ApiPropertyOptional({ description: 'Поисковая строка по теме и содержимому', example: 'договор' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Номер страницы пагинации', example: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ description: 'Количество цепочек на странице', example: 20, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}
