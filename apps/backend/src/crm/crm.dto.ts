import { Type, Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CrmQuickFilter, type JsonObject } from '@tracker/contracts';
export class CompanyDto {
  @ApiProperty({ type: String, description: 'Название компании', example: 'Альфа' })
  @IsString()
  @Length(1, 200)
  name: string;
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  legal_name?: string;
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  inn?: string;
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  notes?: string;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'ID администратора, ответственного за компанию',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  responsible_id?: number | null;
}
export class UpdateCompanyDto extends PartialType(CompanyDto) {}
export class ContactDto {
  @ApiProperty({ type: String, description: 'Имя контактного лица', example: 'Иван Петров' })
  @IsString()
  @Length(1, 200)
  name: string;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'ID компании; null — без компании' })
  @IsOptional()
  @IsInt()
  @Min(1)
  company_id?: number | null;
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  position?: string;
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  phone?: string;
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  email?: string;
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  telegram?: string;
}
export class UpdateContactDto extends PartialType(ContactDto) {}
export class DealDto {
  @ApiProperty({ example: 'Разработка сайта', description: 'Название сделки, 1–200 символов' })
  @Transform(({ value }: { value: string }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 200)
  title: string;
  @ApiPropertyOptional({ type: Number, description: 'ID этапа из GET /api/crm/options; по умолчанию 1' })
  @IsOptional()
  @IsInt()
  @Min(1)
  stage_id?: number;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Сумма в рублях, до двух знаков после запятой; null — не указана',
    example: 150000.5,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  amount?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'ID компании; null — без компании' })
  @IsOptional()
  @IsInt()
  @Min(1)
  company_id?: number | null;
  @ApiPropertyOptional({ type: Number, isArray: true, description: 'ID контактов сделки' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  contact_ids?: number[];
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'ID основного контакта из contact_ids' })
  @IsOptional()
  @IsInt()
  @Min(1)
  primary_contact_id?: number | null;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'ID администратора; для новой сделки по умолчанию владелец токена',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  responsible_id?: number | null;
  @ApiPropertyOptional({ type: String, description: 'Источник заявки' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Ожидаемая дата закрытия YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  expected_close?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'ID связанного проекта' })
  @IsOptional()
  @IsInt()
  @Min(1)
  project_id?: number | null;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Документ редактора Tiptap JSON',
  })
  @IsOptional()
  @IsObject()
  description?: JsonObject | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Обязательная причина при переводе сделки в проигранный этап',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  loss_reason?: string | null;
}
export class UpdateDealDto extends PartialType(DealDto) {}
export class CrmQueryDto {
  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  contact_id?: number;
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
  @ApiPropertyOptional({ type: Number, description: 'ID компании; null — без компании' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  company_id?: number;
  @ApiPropertyOptional({ type: Number, description: 'ID администратора; для новой сделки по умолчанию владелец токена' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  responsible_id?: number;
  @ApiPropertyOptional({ type: String, description: 'Источник заявки' })
  @IsOptional()
  @IsString()
  source?: string;
  @ApiPropertyOptional({ enum: CrmQuickFilter })
  @IsOptional()
  @IsEnum(CrmQuickFilter)
  quick?: CrmQuickFilter;
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsDateString()
  today?: string;
  @ApiPropertyOptional({ type: Number, default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
  @ApiPropertyOptional({ type: Number, default: 30, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 30;
}
export class CrmCommentDto {
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Документ комментария Tiptap JSON' })
  @IsObject()
  message: JsonObject;
}
export class CrmTaskLinkDto {
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(1)
  task_id: number;
}
export class CrmTaskDto {
  @ApiProperty({ type: String })
  @IsString()
  @Length(3, 150)
  title: string;
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsDateString()
  planned_date?: string;
  @ApiPropertyOptional({ type: Number, description: 'ID администратора; для новой сделки по умолчанию владелец токена' })
  @IsOptional()
  @IsInt()
  @Min(1)
  responsible_id?: number;
}
