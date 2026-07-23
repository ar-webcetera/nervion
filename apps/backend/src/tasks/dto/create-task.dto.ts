import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsObject, IsOptional, IsString, Length } from 'class-validator';
import { TASK_STATUSES } from '../../common/enums/statuses.enum';
import { MAX_TASK_NAME_LENGTH, TaskType } from '../../tasks/entities/task.entity';

export class CreateTaskDto {
  @IsString({ message: 'Название задачи должно быть строкой' })
  @Length(0, MAX_TASK_NAME_LENGTH, { message: 'Название должно быть меньше ' + MAX_TASK_NAME_LENGTH + ' символов' })
  @ApiProperty({
    description: 'Название задачи',
    example: 'Название задачи',
    required: true,
  })
  title: string;

  @IsEnum(TaskType)
  @IsOptional()
  @ApiProperty({
    description: 'Тип задачи',
    example: TaskType.TASK,
    required: false,
  })
  taskType: TaskType;

  @IsNumber({}, { message: 'ID проекта должен быть цифрой' })
  @ApiProperty({
    description: 'ID проекта',
    example: 22,
    required: false,
  })
  project_id: number;

  @IsOptional()
  @ApiProperty({
    isArray: true,
    description: 'ID ответственного',
    example: 1,
    required: false,
  })
  responsible_id: number | null;

  @IsEnum(TASK_STATUSES)
  @IsOptional()
  @ApiProperty({
    isArray: true,
    description: 'Статус задачи',
    example: TASK_STATUSES.in_progress,
    required: false,
  })
  status: TASK_STATUSES;

  @IsString({ message: 'Дата планирования должна быть строкой' })
  @IsOptional()
  @ApiProperty({
    description: 'Плановая дата (дедлайн) в формате YYYY-MM-DD',
    example: '2026-07-15',
    required: false,
  })
  planned_date?: string;

  @IsObject({ message: 'Описание задачи должно быть объектом с JSON-контентом TipTap' })
  @ApiProperty({
    description: 'Описание задачи в формате JSON для TipTap-редактора',
    type: 'object',
    example: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Тут ваше описание задачи...' }],
        },
      ],
    },
    required: false,
  })
  @IsOptional()
  description: Record<string, any>;
}
