import type { ReadNotificationContextRequest } from '@tracker/contracts';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, Min, ValidateIf } from 'class-validator';

export class ReadNotificationContextDto implements ReadNotificationContextRequest {
  @ApiProperty({ description: 'Идентификатор открытой задачи', minimum: 1, required: false })
  @ValidateIf((dto: ReadNotificationContextDto) => dto.event_id === undefined)
  @IsInt()
  @Min(1)
  task_id?: number;

  @ApiProperty({ description: 'Идентификатор просмотренного комментария', minimum: 1, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  comment_id?: number;

  @ApiProperty({ description: 'Идентификатор открытой встречи', minimum: 1, required: false })
  @ValidateIf((dto: ReadNotificationContextDto) => dto.task_id === undefined)
  @IsInt()
  @Min(1)
  event_id?: number;
}
