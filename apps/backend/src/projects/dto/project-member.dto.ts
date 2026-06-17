import { ApiProperty } from '@nestjs/swagger';

export class ProjectMemberDto {
  @ApiProperty({
    description: 'ID пользователя',
    example: 1,
  })
  id: number;

  @ApiProperty({
    description: 'Имя пользователя',
    example: 'Иван',
  })
  first_name: string;

  @ApiProperty({
    description: 'Фамилия пользователя',
    example: 'Иванов',
  })
  last_name: string;

  @ApiProperty({
    description: 'URL аватарки',
    example: 'https://example.com/avatar.jpg',
    required: false,
  })
  photo_url?: string;

  @ApiProperty({
    description: 'Email пользователя',
    example: 'email@example.com',
    required: false,
  })
  email?: string;

  @ApiProperty({
    description: 'Роль пользователя в проекте',
    example: 'developer',
    required: false,
  })
  role?: string;
}
