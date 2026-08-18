import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MailboxAccountQueryDto {
  @ApiProperty({ description: 'ID выбранного почтового ящика', example: 1 })
  @IsInt()
  @Type(() => Number)
  account_id: number;
}

export class MailboxOptionalAccountQueryDto {
  @ApiPropertyOptional({ description: 'ID почтового ящика', example: 1 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  account_id?: number;
}
