import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber } from 'class-validator';

export class UpdatePriorityTaskDto {
  @ApiProperty({
    description: 'Два ID задач, приоритеты которых нужно поменять местами',
    example: [1, 2],
    required: true,
    type: [Number],
  })
  @IsArray({ message: 'ids должен быть массивом' })
  @ArrayMinSize(2, { message: 'Нужно передать ровно два ID' })
  @ArrayMaxSize(2, { message: 'Нужно передать ровно два ID' })
  @IsNumber({}, { each: true, message: 'Каждый элемент ids должен быть числом' })
  ids: number[];
}
