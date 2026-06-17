import { ApiProperty } from '@nestjs/swagger';

export class CreateProjectResponseDto {
  @ApiProperty({
    description: 'Название проекта',
    example: 'Amansultan',
  })
  name: string;

  @ApiProperty({
    description: 'Идентификатор проекта',
    example: 6,
  })
  id: number;
}
