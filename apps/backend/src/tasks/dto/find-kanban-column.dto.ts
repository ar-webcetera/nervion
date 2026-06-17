import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { TASK_STATUSES } from '../../common/enums/statuses.enum';
import { FindTasksByFilterDto } from './find-tasks-by-filter.dto';

export class FindKanbanColumnDto extends FindTasksByFilterDto {
  @ApiProperty({ description: 'Статус колонки канбана', enum: TASK_STATUSES })
  @IsEnum(TASK_STATUSES)
  status: TASK_STATUSES;

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
