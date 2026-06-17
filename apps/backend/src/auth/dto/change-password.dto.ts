import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsInt, Min } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    description: 'ID пользователя',
    type: Number,
    example: 1,
  })
  @IsDefined({ message: 'userId обязателен' })
  @IsInt({ message: 'userId должен быть целым числом' })
  @Min(1, { message: 'userId должен быть положительным числом' })
  userId: number;
}
