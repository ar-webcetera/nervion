import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CompleteTaskDto {
  @IsDateString({}, { message: 'date должна быть строкой в формате YYYY-MM-DD' })
  @ApiProperty({ description: 'Дата выполнения', example: '2026-04-10' })
  date: string;
}
