import type { ReadNotificationContextRequest } from '@tracker/contracts';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';

export class ReadNotificationContextDto implements ReadNotificationContextRequest {
  @ApiProperty({ description: 'Идентификатор открытой задачи', minimum: 1 })
  @IsInt()
  @Min(1)
  task_id: number;

  @ApiProperty({ description: 'Идентификатор просмотренного комментария', minimum: 1, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  comment_id?: number;
}
