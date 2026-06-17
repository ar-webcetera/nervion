import { Type } from 'class-transformer';
import { IsInt, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Дескриптор уже загруженного в S3 вложения (возвращается POST /mailbox/attachments)
export class MailAttachmentInputDto {
  @ApiProperty({ description: 'Ключ объекта вложения в S3', example: 'mail/outbound/2026/abc123.pdf' })
  @IsString()
  @MaxLength(1024)
  s3_key: string;

  @ApiProperty({ description: 'Имя файла вложения', example: 'Договор.pdf' })
  @IsString()
  @MaxLength(512)
  filename: string;

  @ApiProperty({ description: 'MIME-тип вложения', example: 'application/pdf' })
  @IsString()
  @MaxLength(255)
  content_type: string;

  @ApiProperty({ description: 'Размер файла в байтах', example: 102400 })
  @IsInt()
  @Type(() => Number)
  size: number;
}
