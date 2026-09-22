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

  @ApiProperty({
    description: 'Последний выбранный пользователем почтовый ящик',
    type: Number,
    nullable: true,
    example: 1,
  })
  selected_mail_account_id: number | null;
}
