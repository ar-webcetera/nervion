import { ApiProperty } from '@nestjs/swagger';
import { IsNumber } from 'class-validator';

export class CreateChatDto {
  @ApiProperty({ example: 2, description: 'ID пользователя, с которым создается чат' })
  @IsNumber()
  memberId: number;
}
