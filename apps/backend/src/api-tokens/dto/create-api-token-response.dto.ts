import { ApiProperty } from '@nestjs/swagger';
import { ApiToken } from '../entities/api-token.entity';

export class CreateApiTokenResponseDto {
  @ApiProperty({ description: 'Сырой токен — показывается только один раз', example: 'wct_a1b2c3...' })
  token: string;

  @ApiProperty({ type: () => ApiToken })
  record: ApiToken;
}
