import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { TIMELOG_STATUSES } from '../../common/enums/statuses.enum';

export class CreateTimelogDto {
  @IsNumber({}, { message: 'ID задачи должен быть цифрой' })
  @IsOptional()
  @ApiProperty({
    description: 'ID задачи (опционально: можно запустить таймер без привязки к задаче)',
    example: 1,
    required: false,
  })
  task_id?: number;

  @IsString({ message: 'title должен быть строкой' })
  @IsOptional()
  @MaxLength(255)
  @ApiProperty({
    description: 'Черновое название таймера для неприкреплённых записей',
    example: 'Разбор почты',
    required: false,
  })
  title?: string;

  @IsNumber({}, { message: 'ID автора должен быть цифрой' })
  @ApiProperty({
    description: 'ID автора',
    example: 1,
  })
  author_id: number;

  @ApiProperty({
    description: 'ID задачи',
    enum: TIMELOG_STATUSES,
    example: TIMELOG_STATUSES.in_progress,
  })
  @IsOptional()
  status: TIMELOG_STATUSES;

  @IsNumber({}, { message: 'time_spent должен быть цифрой' })
  @ApiProperty({
    description: 'Затраченное время в минутах (будет сохранено в секундах)',
    example: 30,
  })
  @IsOptional()
  time_spent: number;

  @ApiProperty({
    description: 'Описание',
    example: 'Описание',
    required: true,
  })
  @IsOptional()
  summary: string;

  @ApiProperty({
    description: 'Дата экземпляра повторяющейся задачи, для которого запущен таймер',
    example: '2026-04-19',
    required: false,
  })
  @IsDateString({}, { message: 'tracking_date должен быть датой в формате YYYY-MM-DD' })
  @IsOptional()
  tracking_date?: string;
}
