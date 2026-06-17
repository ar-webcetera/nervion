import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Chat } from './entities/chat.entity';
import { Users } from '../users/entities/users.entity';
import { ChatMember } from './entities/chat-member.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatMessageReadStatus } from './entities/chat-message-read-status.entity';
import { ChatsService } from './chats.service';
import { ChatsController } from './chats.controller';
import { AuthModule } from 'src/auth/auth.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { PushModule } from '../push/push.module';
import { FilesModule } from '../files/files.module';
import { DeepseekModule } from '../deepseek/deepseek.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Chat, Users, ChatMember, ChatMessage, ChatMessageReadStatus]),
    AuthModule,
    WebsocketModule,
    PushModule,
    FilesModule,
    DeepseekModule,
  ],
  controllers: [ChatsController],
  providers: [ChatsService],
  exports: [ChatsService],
})
export class ChatsModule {}
