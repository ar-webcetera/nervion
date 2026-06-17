import { IsArray, IsString } from 'class-validator';
import { TASK_STATUSES } from '../../common/enums/statuses.enum';

export class UpdateKanbanColumnsDto {
  @IsArray()
  @IsString({ each: true })
  collapsed_columns: TASK_STATUSES[];
}
