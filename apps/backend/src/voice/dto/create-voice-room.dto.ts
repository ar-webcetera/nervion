import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, IsString, Length } from 'class-validator';

export class CreateVoiceRoomDto {
  @ApiProperty({ example: 'Ежедневный созвон' })
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiProperty({ type: [Number], example: [2, 5] })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  member_ids: number[];
}
