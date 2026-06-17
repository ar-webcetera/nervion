import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUrl, IsInt, IsOptional, Min, Max } from 'class-validator';

export class CreateHealthCheckDto {
  @ApiProperty({ example: 'Procarbon API' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'https://example.com/health' })
  @IsUrl({ require_tld: false })
  url: string;

  @ApiProperty({ example: 60, description: 'Интервал проверки в секундах (мин. 30)' })
  @IsInt()
  @Min(30)
  interval_seconds: number;

  @ApiPropertyOptional({ example: 10, description: 'Таймаут запроса в секундах' })
  @IsInt()
  @Min(1)
  @Max(60)
  @IsOptional()
  timeout_seconds?: number;

  @ApiPropertyOptional({ example: 200, description: 'Ожидаемый HTTP-статус' })
  @IsInt()
  @Min(100)
  @Max(599)
  @IsOptional()
  expected_status?: number;

  @ApiProperty({ example: 'uuid-of-chat', description: 'ID чата для отправки алертов' })
  @IsString()
  chat_id: string;

  @ApiProperty({ example: 1, description: 'ID пользователя-бота для отправки сообщений' })
  @IsInt()
  sender_user_id: number;
}
