import type { TaskStatus } from '@tracker/contracts';
import { IsString, IsArray } from 'class-validator';

export class UpdateKanbanColumnsDto {
  @IsArray()
  @IsString({ each: true })
  collapsed_columns: TaskStatus[];
}
