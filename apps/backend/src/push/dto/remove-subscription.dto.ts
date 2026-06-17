import { IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RemoveSubscriptionDto {
  @IsUrl()
  @ApiProperty({
    description: 'URL push-сервиса браузера (endpoint удаляемой подписки)',
    example: 'https://fcm.googleapis.com/fcm/send/abcd1234',
  })
  endpoint: string;
}
