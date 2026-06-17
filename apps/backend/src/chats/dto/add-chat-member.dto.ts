import { ApiProperty } from '@nestjs/swagger';
import { IsNumber } from 'class-validator';

export class AddChatMemberDto {
  @ApiProperty({ description: 'ID пользователя', example: 5 })
  @IsNumber()
  userId: number;
}
