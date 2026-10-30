import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUrl, IsInt, IsOptional, Min, Max, MaxLength, IsNotEmpty, IsUUID } from 'class-validator';
import { HEALTHCHECK_MAX_TIMEOUT_SECONDS } from '@tracker/contracts';

export class CreateHealthCheckDto {
  @ApiProperty({ example: 'Procarbon API' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: 'https://example.com/health' })
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(1000)
  url: string;

  @ApiProperty({ example: 60, description: 'Интервал проверки в секундах (мин. 30)' })
  @IsInt()
  @Min(30)
  @Max(86400)
  interval_seconds: number;

  @ApiPropertyOptional({
    example: 10,
    description: 'Таймаут запроса в секундах',
    minimum: 1,
    maximum: HEALTHCHECK_MAX_TIMEOUT_SECONDS,
  })
  @IsInt()
  @Min(1)
  @Max(HEALTHCHECK_MAX_TIMEOUT_SECONDS)
  @IsOptional()
  timeout_seconds?: number;

  @ApiPropertyOptional({ example: 200, description: 'Ожидаемый HTTP-статус' })
  @IsInt()
  @Min(100)
  @Max(599)
  @IsOptional()
  expected_status?: number;

  @ApiProperty({ example: 'uuid-of-chat', description: 'ID чата для отправки алертов' })
  @IsUUID()
  chat_id: string;

  @ApiProperty({ example: 1, description: 'ID пользователя-бота для отправки сообщений' })
  @IsInt()
  @Min(1)
  sender_user_id: number;
}
