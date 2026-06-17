import { IsIn } from 'class-validator';
import { TaskViewType } from '../entities/user-task-filter.entity';

export class UpdateViewTypeDto {
  @IsIn(['kanban', 'list', 'weekly'])
  view_type: TaskViewType;
}
