import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional } from 'class-validator';
import { TIMELOG_STATUSES } from '../../common/enums/statuses.enum';

export class UpdateTimelogDto {
  @IsNumber({}, { message: 'ID задачи должен быть цифрой' })
  @ApiProperty({
    description: 'Статус таймлога',
    example: 1,
    required: false,
  })
  @IsOptional()
  task_id?: number;

  @IsNumber({}, { message: 'ID автора должен быть цифрой' })
  @ApiProperty({
    description: 'ID автора',
    example: 1,
    required: false,
  })
  @IsOptional()
  author_id?: number;

  @ApiProperty({
    description: 'ID задачи',
    enum: TIMELOG_STATUSES,
    example: TIMELOG_STATUSES.in_progress,
    required: false,
  })
  @IsEnum(TIMELOG_STATUSES)
  @IsOptional()
  status?: TIMELOG_STATUSES;

  @IsNumber({}, { message: 'time_spent должен быть цифрой' })
  @ApiProperty({
    description: 'Время трекера в секундах',
    example: 3600,
    required: false,
  })
  @IsOptional()
  time_spent?: number;

  @ApiProperty({
    description: 'Описание',
    example: 'Описание',
    required: false,
  })
  @IsOptional()
  summary?: string;
}
