import { BillingReviewStatus } from '@tracker/contracts';
import { IsDateString, IsEnum, IsNumber, IsOptional, Min } from 'class-validator';

export class ReviewBillingDto {
  @IsEnum(BillingReviewStatus)
  status: BillingReviewStatus;

  @IsNumber()
  @Min(0)
  @IsOptional()
  rate?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  amount?: number;

  @IsDateString()
  recognizedAt: string;
}
