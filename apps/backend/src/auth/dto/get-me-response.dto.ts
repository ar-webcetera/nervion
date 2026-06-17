import { ROLES } from '../../common/enums/roles.enum';

import { ApiProperty } from '@nestjs/swagger';

export class GetMeResponseDto {
  @ApiProperty({
    description: 'ID пользователя',
    type: Number,
    example: 1,
  })
  id: number;

  @ApiProperty({
    description: 'Роль пользователя',
    type: ROLES,
    enum: ROLES,
    example: ROLES.admin,
  })
  role: ROLES;
}
