import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCalendarEventDto {
  @ApiProperty({ example: 'Созвон по запуску проекта' })
  @IsString()
  @Length(1, 200)
  title: string;

  @ApiProperty({ required: false, nullable: true, example: 'Обсудить сроки и ответственных' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  notes?: string | null;

  @ApiProperty({ required: false, nullable: true, example: 'https://meet.google.com/abc-defg-hij' })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(2000)
  meeting_url?: string | null;

  @ApiProperty({ example: '2026-10-19T07:00:00.000Z' })
  @IsDateString()
  start_at: string;

  @ApiProperty({ example: '2026-10-19T08:00:00.000Z' })
  @IsDateString()
  end_at: string;

  @ApiProperty({ example: 'Europe/Samara' })
  @IsString()
  @MaxLength(100)
  timezone: string;

  @ApiProperty({ description: 'За сколько минут до встречи напомнить', example: 15 })
  @IsInt()
  @Min(0)
  @Max(10080)
  reminder_minutes: number;

  @ApiProperty({ type: [Number], example: [2, 5] })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  participant_ids: number[];
}
