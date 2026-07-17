import { Type } from 'class-transformer';
import { IsArray, IsEmail, IsInt, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { MailAttachmentInputDto } from './mail-attachment-input.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaveDraftDto {
  @ApiProperty({ description: 'ID почтового ящика, из которого отправляется письмо', example: 1 })
  @IsInt()
  @Type(() => Number)
  account_id: number;

  @ApiPropertyOptional({ description: 'Получатели письма', type: [String], example: ['client@example.com'] })
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  to?: string[];

  @ApiPropertyOptional({ description: 'Получатели копии (CC)', type: [String], example: ['manager@example.com'] })
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  cc?: string[];

  @ApiPropertyOptional({ description: 'Тема письма', example: 'Коммерческое предложение' })
  @IsOptional()
  @IsString()
  @MaxLength(998)
  subject?: string;

  @ApiPropertyOptional({ description: 'Тело письма в формате HTML', example: '<p>Добрый день!</p>' })
  @IsOptional()
  @IsString()
  html?: string;

  @ApiPropertyOptional({ description: 'Тело письма в виде простого текста', example: 'Добрый день!' })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({ description: 'ID существующего черновика для обновления', example: 12 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  draft_id?: number;

  @ApiPropertyOptional({ description: 'Вложения письма', type: [MailAttachmentInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MailAttachmentInputDto)
  attachments?: MailAttachmentInputDto[];
}
