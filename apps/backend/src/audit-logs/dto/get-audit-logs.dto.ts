import { ApiPropertyOptional } from '@nestjs/swagger';
import type { AuditLogsFilters } from '@tracker/contracts';
import { AuditActionType, AuditEntityType } from '@tracker/contracts';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

type TransformableValue = string | number | boolean | null | undefined | Array<string | number | boolean | null | undefined>;
type TransformSource = { value?: TransformableValue };

function toArray(value: TransformableValue): string[] | undefined {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return undefined;
}

function toNumber(value: TransformableValue): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export class GetAuditLogsDto implements AuditLogsFilters {
  @ApiPropertyOptional({ enum: AuditActionType, isArray: true })
  @IsOptional()
  @Transform(({ value }: TransformSource) => toArray(value))
  @IsEnum(AuditActionType, { each: true })
  action_types?: AuditActionType[];

  @ApiPropertyOptional({ enum: AuditEntityType, isArray: true })
  @IsOptional()
  @Transform(({ value }: TransformSource) => toArray(value))
  @IsEnum(AuditEntityType, { each: true })
  entity_types?: AuditEntityType[];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: TransformSource) => toNumber(value))
  @IsInt()
  actor_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: TransformSource) => toNumber(value))
  @IsInt()
  project_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: TransformSource) => toNumber(value))
  @IsInt()
  task_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(({ value }: TransformSource) => toNumber(value) ?? 1)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Transform(({ value }: TransformSource) => toNumber(value) ?? 25)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}
