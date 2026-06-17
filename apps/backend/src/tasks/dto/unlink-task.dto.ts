import { ApiProperty } from '@nestjs/swagger';
import { IsNumber } from 'class-validator';

export class UnlinkTaskDto {
  @ApiProperty({
    description: 'ID связанной задачи',
    example: 'abc123',
    required: true,
    type: Number,
  })
  @IsNumber()
  relatedTaskId: number;
}
