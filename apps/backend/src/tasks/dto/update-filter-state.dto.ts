import type { TaskStatus } from '@tracker/contracts';
import { IsArray, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import { TaskType } from '../entities/task.entity';

export class UpdateFilterStateDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  statuses: TaskStatus[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  projects: number[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  responsibles: number[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  planned_date: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  closed_date: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  taskTypes: TaskType[];

  @IsOptional()
  @IsObject()
  negativeFilters: Record<string, boolean>;

  @IsOptional()
  @IsString()
  title: string;
}
