import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class Employee {
  @ApiProperty({ example: 1, description: 'ID пользователя в системе' })
  @IsInt()
  user_id: number;

  @ApiProperty({ example: 1200, description: 'Ставка сотрудника (в рублях)' })
  @IsNumber()
  cost: number;

  @ApiProperty({ example: 'Иван', description: 'Имя сотрудника', required: false })
  @IsString()
  first_name?: string;

  @ApiProperty({ example: 'Иванов', description: 'Фамилия сотрудника', required: false })
  @IsString()
  last_name?: string;

  @ApiProperty({ example: 'Иванович', description: 'Отчество сотрудника', required: false })
  @IsString()
  @IsOptional()
  patronymic?: string | null;
}

export class CreateReportingDto {
  @ApiProperty({
    example: '2025-05-01',
    description: 'Дата начала периода отчёта (YYYY-MM-DD)',
  })
  @IsString()
  from: string;

  @ApiProperty({
    example: '2025-05-31',
    description: 'Дата окончания периода отчёта (YYYY-MM-DD)',
  })
  @IsString()
  to: string;

  @ApiProperty({
    type: [Employee],
    description: 'Массив сотрудников и их ставок',
  })
  @ValidateNested({ each: true })
  @Type(() => Employee)
  employees: Employee[];

  @ApiProperty({ example: 1, description: 'ID проекта' })
  @IsInt()
  @IsOptional()
  project_id?: number | null;

  @ApiProperty({ example: 1, description: 'ID исполнителя' })
  @IsInt()
  @IsOptional()
  executor_id?: number | null;
}
