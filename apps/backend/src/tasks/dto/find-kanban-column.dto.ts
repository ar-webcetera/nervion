import type { TaskStatus } from '@tracker/contracts';
import { IsString, IsInt, IsOptional, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { FindTasksByFilterDto } from './find-tasks-by-filter.dto';

export class FindKanbanColumnDto extends FindTasksByFilterDto {
  @ApiProperty({ description: 'Статус колонки канбана', type: String })
  @IsString()
  status: TaskStatus;

  @ApiProperty({ description: 'Смещение (сколько карточек уже загружено)', required: false, type: Number })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiProperty({ description: 'Сколько карточек подгрузить', required: false, type: Number })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  limit?: number;
}
