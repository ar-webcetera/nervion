import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';
import { FindTasksByFilterDto } from './find-tasks-by-filter.dto';

export class GetWeeklyTasksDto extends FindTasksByFilterDto {
  @IsDateString({}, { message: 'week_start должна быть датой в формате YYYY-MM-DD' })
  @IsOptional()
  @ApiProperty({
    description: 'Начало недели (пн). Если не передан — текущая неделя',
    example: '2026-04-07',
    required: false,
  })
  week_start?: string;
}
