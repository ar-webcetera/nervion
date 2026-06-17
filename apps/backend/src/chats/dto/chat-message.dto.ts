import { ApiProperty } from '@nestjs/swagger';
import { TiptapDoc } from 'src/common/types/tiptap';
import { Users } from 'src/users/entities/users.entity';

class MessageAuthorDto {
  @ApiProperty({ description: 'ID пользователя', example: 1 })
  id: number;

  @ApiProperty({ description: 'Имя', example: 'Иван' })
  firstName: string;

  @ApiProperty({ description: 'Фамилия', example: 'Иванов' })
  lastName: string;

  @ApiProperty({ description: 'URL фото', example: 'https://example.com/avatar.jpg', required: false })
  photoUrl?: string;
}

export class ChatMessageDto {
  @ApiProperty({ description: 'ID сообщения', example: 'a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6' })
  id: string;

  @ApiProperty({ description: 'Текст сообщения в формате TipTap JSON' })
  message: TiptapDoc | null;

  @ApiProperty({ description: 'Дата создания' })
  createdAt: Date;

  @ApiProperty({ type: MessageAuthorDto, description: 'Автор сообщения', nullable: true })
  author: Users | null;

  @ApiProperty({ description: 'Общее количество сообщений в чате', example: 150, required: false })
  total?: number;

  @ApiProperty({ description: 'Текущий offset', example: 0, required: false })
  offset?: number;

  @ApiProperty({ description: 'Размер страницы', example: 30, required: false })
  limit?: number;

  @ApiProperty({ description: 'Есть ли ещё сообщения', example: true, required: false })
  hasMore?: boolean;
}
