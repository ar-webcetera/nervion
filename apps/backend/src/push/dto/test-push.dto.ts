import { IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { PushTestRequest } from '@tracker/contracts';

export class TestPushDto implements PushTestRequest {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @ApiProperty({ description: 'Endpoint текущего устройства, ранее сохранённый для этого пользователя' })
  endpoint: string;
}
