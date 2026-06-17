import { IsObject, IsString, IsUrl, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class PushKeysDto {
  @IsString()
  @ApiProperty({
    description: 'Публичный ключ клиента для шифрования push-сообщений',
    example: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
  })
  p256dh: string;

  @IsString()
  @ApiProperty({
    description: 'Секрет аутентификации push-подписки',
    example: 'tBHItJI5svbpez7KI4CCXg',
  })
  auth: string;
}

export class SaveSubscriptionDto {
  @IsUrl()
  @ApiProperty({
    description: 'URL push-сервиса браузера (endpoint подписки)',
    example: 'https://fcm.googleapis.com/fcm/send/abcd1234',
  })
  endpoint: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PushKeysDto)
  @ApiProperty({
    description: 'Ключи шифрования push-подписки',
    type: () => PushKeysDto,
  })
  keys: PushKeysDto;
}
