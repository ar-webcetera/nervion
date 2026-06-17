import { ApiProperty } from '@nestjs/swagger';
import { TiptapDoc } from 'src/common/types/tiptap';
import { Users } from 'src/users/entities/users.entity';

class MessageMetaDto {
  @ApiProperty({ description: 'Общее количество сообщений в чате', example: 150 })
  total: number;

  @ApiProperty({ description: 'Текущий offset', example: 0 })
  offset: number;

  @ApiProperty({ description: 'Размер страницы', example: 30 })
  limit: number;

  @ApiProperty({ description: 'Есть ли ещё сообщения', example: true })
  hasMore: boolean;
}

class MessageReplyPreviewAuthorDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Иван' })
  first_name: string;

  @ApiProperty({ example: 'Иванов' })
  last_name: string;
}

export class MessageReplyPreviewDto {
  @ApiProperty({ description: 'ID цитируемого сообщения' })
  id: string;

  @ApiProperty({ type: MessageReplyPreviewAuthorDto, nullable: true })
  author: MessageReplyPreviewAuthorDto | null;

  @ApiProperty({ description: 'Короткий текст цитируемого сообщения', example: 'Привет, как дела?' })
  snippet: string;

  @ApiProperty({ description: 'Удалено ли цитируемое сообщение' })
  is_deleted: boolean;
}

class MessageItemDto {
  @ApiProperty({ description: 'ID сообщения', example: 'a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6' })
  id: string;

  @ApiProperty({ description: 'Текст сообщения' })
  message: TiptapDoc | null;

  @ApiProperty({ description: 'Дата создания' })
  createdAt: Date;

  @ApiProperty({ description: 'Автор сообщения', nullable: true })
  author: Users | null;

  @ApiProperty({ description: 'ID сообщения, на которое это ответ', nullable: true })
  reply_to_id: string | null;

  @ApiProperty({ type: MessageReplyPreviewDto, description: 'Превью цитируемого сообщения', nullable: true })
  reply_to: MessageReplyPreviewDto | null;
}

export class ChatMessagesResponseDto {
  @ApiProperty({ type: [MessageItemDto], description: 'Список сообщений' })
  messages: MessageItemDto[];

  @ApiProperty({ type: MessageMetaDto, description: 'Метаданные пагинации' })
  meta: MessageMetaDto;
}
