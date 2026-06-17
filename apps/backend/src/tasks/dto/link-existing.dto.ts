import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LinkExistingDto {
  @ApiProperty({ description: 'ID существующей задачи, которую нужно привязать', example: 'task_456' })
  @IsString()
  relatedTaskId: string;
}
