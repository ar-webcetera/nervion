import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Min } from 'class-validator';

export class MailboxStatsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  account_id?: number;

  /** Начало периода (ISO или YYYY-MM-DD). По умолчанию 30 дней назад. */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Конец периода (ISO или YYYY-MM-DD, день включается). По умолчанию сейчас. */
  @IsOptional()
  @IsDateString()
  to?: string;
}
