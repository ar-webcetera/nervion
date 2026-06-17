import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateGroupChatDto {
  @ApiProperty({ description: 'Название группового чата', example: 'Команда бэкенда' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'ID участников группы', example: [2, 3, 4] })
  @IsArray()
  @IsNumber({}, { each: true })
  memberIds: number[];
}
