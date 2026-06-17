import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { CreateTaskDto } from './create-task.dto';
import { MAX_TASK_NAME_LENGTH } from '../../tasks/entities/task.entity';

export class UpdateTaskDto extends CreateTaskDto {
  @IsNumber({}, { message: 'Приоритет должен быть числом' })
  @IsOptional()
  @ApiProperty({
    description: 'ID проекта',
    example: 1,
    required: false,
  })
  priority?: number;

  @IsNumber({}, { message: 'ID проекта должен быть цифрой' })
  @IsOptional()
  @ApiProperty({
    description: 'ID проекта',
    example: 22,
    required: false,
  })
  declare project_id: number;

  @IsString({ message: 'Название задачи должно быть строкой' })
  @Length(0, MAX_TASK_NAME_LENGTH, { message: 'Название должно быть меньше ' + MAX_TASK_NAME_LENGTH + ' символов' })
  @ApiProperty({
    description: 'Название задачи',
    example: 'Название задачи',
    required: true,
  })
  @IsOptional()
  declare title: string;

  @IsString({ message: 'Дата планирования должна быть строкой' })
  @IsOptional()
  planned_date?: string;

  @IsNumber({}, { message: 'Story points должны быть числом' })
  @IsOptional()
  @ApiProperty({
    description: 'Story points оценка задачи',
    example: 3,
    required: false,
  })
  story_points?: number | null;

  @IsArray({ message: 'recurrence_days должен быть массивом' })
  @IsInt({ each: true, message: 'Каждый элемент recurrence_days должен быть целым числом' })
  @Min(0, { each: true, message: 'День недели не может быть меньше 0' })
  @Max(6, { each: true, message: 'День недели не может быть больше 6' })
  @IsOptional()
  @ApiProperty({
    description: 'Дни недели повторения: 0=вс, 1=пн, 2=вт, 3=ср, 4=чт, 5=пт, 6=сб',
    example: [1, 3, 5],
    required: false,
    isArray: true,
    type: Number,
  })
  recurrence_days?: number[] | null;
}
