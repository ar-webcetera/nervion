import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsObject, IsEnum, IsNumber, Min } from 'class-validator';
import type { JSONContent } from '@tiptap/core';
import { PROJECT_STATUSES } from '../../common/enums/project-status.enum';

export class CreateProjectDto {
  @ApiProperty({
    description: 'Название проекта',
    example: 'Amansultan',
  })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Описание проекта', required: false })
  @IsOptional()
  @IsObject()
  description?: JSONContent;

  @ApiProperty({ description: 'Статус проекта', required: false, enum: PROJECT_STATUSES, default: PROJECT_STATUSES.IN_PROGRESS })
  @IsOptional()
  @IsEnum(PROJECT_STATUSES)
  status?: PROJECT_STATUSES;

  @ApiProperty({ description: 'Часовая ставка', required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  hourlyRate?: number;

  @ApiProperty({ description: 'Бюджет на месяц', required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  budget?: number;
}
