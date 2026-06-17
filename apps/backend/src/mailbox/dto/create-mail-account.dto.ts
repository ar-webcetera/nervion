import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { MAIL_ACCOUNT_TYPES } from '../entities/mail-account.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMailAccountDto {
  @ApiProperty({ description: 'Почтовый адрес ящика', example: 'support@webcetera.ru' })
  @IsEmail()
  @MaxLength(255)
  address: string;

  @ApiPropertyOptional({ description: 'Отображаемое имя отправителя', example: 'Поддержка Webcetera' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  display_name?: string;

  @ApiPropertyOptional({ description: 'Тип ящика', enum: MAIL_ACCOUNT_TYPES })
  @IsOptional()
  @IsEnum(MAIL_ACCOUNT_TYPES)
  type?: MAIL_ACCOUNT_TYPES;

  @ApiPropertyOptional({ description: 'ID пользователя-владельца персонального ящика', example: 5 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  user_id?: number;

  @ApiPropertyOptional({ description: 'HTML-подпись, добавляемая к письмам', example: '<p>С уважением, команда Webcetera</p>' })
  @IsOptional()
  @IsString()
  signature_html?: string;

  @ApiPropertyOptional({ description: 'Активен ли ящик', example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ description: 'ID пользователей, которым открыт доступ к ящику', type: [Number], example: [3, 7] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Type(() => Number)
  allowedUserIds?: number[];
}
