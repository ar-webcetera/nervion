import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateAllocationDto {
  @ApiProperty({ description: 'Идентификатор сотрудника', example: 5 })
  @IsInt()
  @IsNotEmpty()
  user_id: number;

  @ApiProperty({ description: 'Идентификатор проекта', example: 12 })
  @IsInt()
  @IsNotEmpty()
  project_id: number;

  @ApiProperty({ description: 'Дата начала аллокации (YYYY-MM-DD)', example: '2026-06-01' })
  @IsDateString()
  @IsNotEmpty()
  start_date: string;

  @ApiProperty({ description: 'Дата окончания аллокации (YYYY-MM-DD)', example: '2026-06-30' })
  @IsDateString()
  @IsNotEmpty()
  end_date: string;

  @ApiProperty({ description: 'Время начала рабочего интервала (HH:mm)', example: '10:00', required: false })
  @IsString()
  @IsOptional()
  start_time?: string;

  @ApiProperty({ description: 'Время окончания рабочего интервала (HH:mm)', example: '19:00', required: false })
  @IsString()
  @IsOptional()
  end_time?: string;

  @ApiProperty({ description: 'Плановое количество часов', example: 8, required: false })
  @IsInt()
  @Min(1)
  @IsOptional()
  hours?: number;

  @ApiProperty({ description: 'Заметка к аллокации', example: 'Разработка модуля отчётов', required: false })
  @IsString()
  @IsOptional()
  notes?: string;
}
