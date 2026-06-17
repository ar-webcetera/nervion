import { CreateUserDto } from './create-user.dto';
import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ROLES } from '../../common/enums/roles.enum';

export class UpdateUserDto extends CreateUserDto {
  @IsOptional()
  declare email: string;

  @IsOptional()
  declare first_name: string;

  @IsOptional()
  declare last_name: string;

  @IsOptional()
  declare role: ROLES;

  @IsOptional()
  declare password: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Ссылка на фото пользователя',
    example: 'https://example.com/avatar.png',
    required: false,
  })
  photo_url?: string;
}
