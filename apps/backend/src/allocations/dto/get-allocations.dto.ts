import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class GetAllocationsDto {
  @ApiProperty({ description: 'Фильтр по идентификатору сотрудника', example: 5, required: false })
  @IsOptional()
  @Transform(({ value }) => (value ? parseInt(value, 10) : undefined))
  @IsInt()
  user_id?: number;

  @ApiProperty({ description: 'Фильтр по идентификатору проекта', example: 12, required: false })
  @IsOptional()
  @Transform(({ value }) => (value ? parseInt(value, 10) : undefined))
  @IsInt()
  project_id?: number;

  @ApiProperty({ description: 'Начало периода фильтрации (YYYY-MM-DD)', example: '2026-06-01', required: false })
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @ApiProperty({ description: 'Конец периода фильтрации (YYYY-MM-DD)', example: '2026-06-30', required: false })
  @IsOptional()
  @IsDateString()
  end_date?: string;
}
