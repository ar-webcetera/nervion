import { IsArray, IsBoolean, IsEnum, IsNumber, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { TASK_STATUSES } from '../../common/enums/statuses.enum';
import { TaskType } from '../entities/task.entity';

const normalizeToNumberArray = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value) && !Number.isFinite(value)) {
    return undefined;
  }
  if (!Array.isArray(value) && Number.isFinite(value)) {
    return [Number(value)];
  }
  if (Array.isArray(value)) {
    const result = value.map((item) => Number(item));
    return result.filter((item) => !Number.isNaN(item));
  }
  return undefined;
};

export class FindTasksByFilterDto {
  @ApiProperty({
    description: 'ID проектов (массив чисел) или null для задач без проекта',
    example: [2, 3],
    required: false,
    type: [Number],
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => normalizeToNumberArray(value))
  @IsNumber({}, { each: true, message: 'каждый элемент projects должен быть числом' })
  projects?: number[];

  @ApiProperty({
    description: 'ID ответственных (массив чисел)',
    example: [1, 2],
    required: false,
    type: [Number],
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => normalizeToNumberArray(value))
  @IsArray({ message: 'responsible_id должен быть массивом' })
  @IsNumber({}, { each: true, message: 'каждый responsible_id должен быть числом' })
  responsibles?: number[];

  @ApiProperty({
    description: 'Статусы задач (массив значений TASK_STATUSES), не передавать или projects=null для без фильтра',
    example: [TASK_STATUSES.open, TASK_STATUSES.in_progress],
    required: false,
    type: [String],
    enum: Object.values(TASK_STATUSES),
    nullable: true,
  })
  @IsOptional()
  @IsArray({ message: 'statuses должен быть массивом строк' })
  @IsEnum(TASK_STATUSES, {
    each: true,
    message: 'каждый элемент statuses должен быть одним из TASK_STATUSES',
  })
  statuses?: TASK_STATUSES[];

  @ApiProperty({
    description: 'Дата планирования задачи (массив строк для диапазона или одна строка)',
    example: ['2025-10-02T15:18:00.000Z', '2025-10-05T15:18:00.000Z'],
    required: false,
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? (value as string[]) : ([value].filter(Boolean) as string[]),
  )
  planned_date?: string[];

  @ApiProperty({
    description: 'Год',
    example: '2025',
    required: false,
    type: String,
  })
  @IsOptional()
  year?: string;

  @ApiProperty({
    description: 'Флаг отчечающий за наличие таймлогов',
    example: true,
    required: false,
    type: Boolean,
  })
  @IsOptional()
  existTimelog?: boolean;

  @ApiProperty({
    description: 'Тип задачи',
    example: 'task',
    required: false,
    type: [String],
    enum: Object.values(TaskType),
    nullable: true,
  })
  @IsOptional()
  @IsArray({ message: 'taskTypes должен быть массивом строк' })
  @IsEnum(TaskType, {
    each: true,
    message: 'каждый элемент taskTypes должен быть одним из TaskType',
  })
  taskTypes?: TaskType[];

  @ApiProperty({
    description: 'Название задачи',
    example: 'Название задачи',
    required: false,
    type: String,
  })
  @IsOptional()
  title?: string;

  @ApiProperty({
    description: 'Использовать сохраненные фильтры',
    example: true,
    required: false,
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  useSavedFilters?: boolean;

  @ApiProperty({
    description: 'Дата закрытия задачи (массив строк для диапазона или одна строка)',
    example: ['2025-10-02T15:18:00.000Z', '2025-10-05T15:18:00.000Z'],
    required: false,
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? (value as string[]) : ([value].filter(Boolean) as string[]),
  )
  closed_date?: string[];

  @ApiProperty({
    description: 'Часовой пояс пользователя (IANA timezone string)',
    example: 'Europe/Moscow',
    required: false,
    type: String,
  })
  @IsOptional()
  timezone?: string;
}
