import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateWorkScheduleDto {
  @ApiProperty({ description: 'Идентификатор сотрудника', example: 5 })
  @IsInt()
  @IsNotEmpty()
  user_id: number;

  @ApiProperty({ description: 'Дата рабочего дня (YYYY-MM-DD)', example: '2026-06-15' })
  @IsDateString()
  @IsNotEmpty()
  work_date: string;

  @ApiProperty({ description: 'Время начала рабочего дня (HH:mm)', example: '10:00', required: false })
  @IsString()
  @IsOptional()
  start_time?: string;

  @ApiProperty({ description: 'Время окончания рабочего дня (HH:mm)', example: '19:00', required: false })
  @IsString()
  @IsOptional()
  end_time?: string;

  @ApiProperty({ description: 'Количество рабочих часов', example: 8, required: false })
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @IsOptional()
  hours?: number;

  @ApiProperty({ description: 'Признак выходного дня', example: false, required: false })
  @IsBoolean()
  @IsOptional()
  is_day_off?: boolean;

  @ApiProperty({ description: 'Заметка к рабочему дню', example: 'Удалённая работа', required: false })
  @IsString()
  @IsOptional()
  notes?: string;
}
