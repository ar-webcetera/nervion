import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { TIMELOG_STATUSES } from '../../common/enums/statuses.enum';

export class UpdateTimelogDto {
  @ValidateIf((_, value) => value !== null)
  @IsNumber({}, { message: 'ID задачи должен быть цифрой' })
  @ApiProperty({
    description: 'ID задачи. Пришлите null, чтобы отвязать таймер от задачи',
    example: 1,
    required: false,
    nullable: true,
  })
  @IsOptional()
  task_id?: number | null;

  @IsString({ message: 'title должен быть строкой' })
  @IsOptional()
  @MaxLength(255)
  @ApiProperty({
    description: 'Черновое название таймера (только для неприкреплённых)',
    example: 'Созвон с командой',
    required: false,
  })
  title?: string;

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
