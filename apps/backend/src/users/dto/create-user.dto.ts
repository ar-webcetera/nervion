import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ROLES } from '../../common/enums/roles.enum';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @IsString({ message: 'email должен быть строкой' })
  @IsEmail()
  @ApiProperty({
    description: 'Емайл юзара',
    example: 'user@example.com',
  })
  email: string;

  @IsString({ message: 'Имя должно быть строкой' })
  @ApiProperty({
    description: 'Имя юзара',
    example: 'Андрей',
  })
  first_name: string;

  @IsString({ message: 'Фамилия должна быть строкой' })
  @ApiProperty({
    description: 'Фамилия юзара',
    example: "Иванов",
  })
  last_name: string;

  @IsString({ message: 'Отчество должно быть строкой' })
  @ApiProperty({
    description: 'Отчество юзара',
    example: 'Андреевич',
  })
  @IsOptional()
  patronymic: string;

  @IsEnum(ROLES)
  @ApiProperty({
    description: 'Глобальная роль пользователя',
    example: ROLES.employee,
  })
  @IsOptional()
  role: ROLES;

  @ApiProperty({
    description: 'Пароль пользователя. Если не указан, генерируется автоматически',
    example: '123456',
    required: false,
    minLength: 6,
  })
  @IsString({ message: 'Пароль должен быть строкой' })
  @MinLength(6, { message: 'Пароль должен содержать минимум 6 символов' })
  @IsOptional()
  password?: string;
}
