import { PartialType } from '@nestjs/swagger';
import { CreateHealthCheckDto } from './create-healthcheck.dto';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateHealthCheckDto extends PartialType(CreateHealthCheckDto) {
  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
