import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class GetTimelogSummaryDto {
  @ApiProperty({
    description: 'Дата начала периода (YYYY-MM-DD)',
    example: '2024-01-01',
    required: false,
  })
  @IsOptional()
  @IsString()
  start_date?: string;

  @ApiProperty({
    description: 'Дата окончания периода (YYYY-MM-DD)',
    example: '2024-01-07',
    required: false,
  })
  @IsOptional()
  @IsString()
  end_date?: string;
}
