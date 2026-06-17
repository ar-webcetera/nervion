import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsObject, IsOptional, IsUUID } from 'class-validator';

export class CreateMessageDto {
  @ApiProperty({
    description: 'Содержимое сообщения в формате TipTap JSON',
    example: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Привет!' }] }],
    },
  })
  @IsNotEmpty()
  @IsObject()
  message: object;

  @ApiProperty({ description: 'ID отправителя', example: 5, required: false })
  @IsOptional()
  @IsNumber()
  senderId?: number;

  @ApiProperty({
    description: 'ID сообщения, на которое отвечают (для цитирования)',
    example: 'a1b2c3d4-e5f6-47h8-89j0-k1l2m3n4o5p6',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  reply_to_id?: string;
}
