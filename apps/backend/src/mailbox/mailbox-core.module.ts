import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushModule } from '../push/push.module';
import { StorageModule } from '../storage/storage.module';
import { MailAccounts } from './entities/mail-account.entity';
import { MailAttachments } from './entities/mail-attachment.entity';
import { MailMessages } from './entities/mail-message.entity';
import { MailThreads } from './entities/mail-thread.entity';
import { MailboxService } from './mailbox.service';
import { PostboxService } from './postbox.service';
import { SmtpServerService } from './smtp/smtp-server.service';
import { Notifications } from '../notifications/entities/notification.entity';

@Module({
  imports: [
    PushModule,
    StorageModule,
    TypeOrmModule.forFeature([MailAccounts, MailThreads, MailMessages, MailAttachments, Notifications]),
  ],
  providers: [MailboxService, PostboxService, SmtpServerService],
  exports: [MailboxService, PostboxService, SmtpServerService],
})
export class MailboxCoreModule {}
