import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class GetCalendarEventsDto {
  @ApiProperty({ example: '2026-10-19T00:00:00.000Z' })
  @IsDateString()
  from: string;

  @ApiProperty({ example: '2026-10-26T00:00:00.000Z' })
  @IsDateString()
  to: string;
}
