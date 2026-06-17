import { ApiProperty } from '@nestjs/swagger';
import { ChatType } from '../entities/chat.entity';

export class ChatListItemDto {
  @ApiProperty({ description: 'ID чата', example: 'a1b2c3d4', required: false })
  chatId?: string | null;

  @ApiProperty({ description: 'Тип чата', enum: ChatType })
  type: ChatType;

  @ApiProperty({ description: 'ID собеседника (только для direct)', example: 7, required: false })
  memberId?: number;

  @ApiProperty({ description: 'Название чата (ФИО собеседника или название группы)', example: 'Иванов Иван' })
  chatName: string;

  @ApiProperty({ description: 'URL аватара (только для direct)', example: 'https://example.com/avatar.png', required: false })
  avatarUrl?: string;

  @ApiProperty({ description: 'Текст последнего сообщения', example: 'Привет, как дела?', required: false })
  lastMessage?: string | null;

  @ApiProperty({ description: 'Дата последнего сообщения', example: '2023-10-27T10:00:00.000Z', required: false })
  lastMessageDate?: Date | null;

  @ApiProperty({ description: 'Количество непрочитанных сообщений', example: 3 })
  unreadMessagesCount: number;
}
