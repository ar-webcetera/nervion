import { IsInt, IsNumber, Max, Min } from 'class-validator';

export class UpsertMonthlyTargetDto {
  @IsInt()
  @Min(2000)
  year: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @IsNumber()
  @Min(0)
  amount: number;
}
