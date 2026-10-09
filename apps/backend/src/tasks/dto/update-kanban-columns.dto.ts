import { IsArray, IsEnum } from 'class-validator';
import { TASK_STATUSES } from '../../common/enums/statuses.enum';

export class UpdateKanbanColumnsDto {
  @IsArray()
  @IsEnum(TASK_STATUSES, { each: true })
  collapsed_columns: TASK_STATUSES[];
}
