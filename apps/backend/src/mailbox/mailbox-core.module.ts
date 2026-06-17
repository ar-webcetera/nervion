import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageModule } from '../storage/storage.module';
import { MailAccounts } from './entities/mail-account.entity';
import { MailAttachments } from './entities/mail-attachment.entity';
import { MailMessages } from './entities/mail-message.entity';
import { MailThreads } from './entities/mail-thread.entity';
import { MailboxService } from './mailbox.service';
import { PostboxService } from './postbox.service';
import { SmtpServerService } from './smtp/smtp-server.service';

// Без контроллеров — используется и HTTP-бэкендом, и SMTP-воркером
@Module({
  imports: [StorageModule, TypeOrmModule.forFeature([MailAccounts, MailThreads, MailMessages, MailAttachments])],
  providers: [MailboxService, PostboxService, SmtpServerService],
  exports: [MailboxService, PostboxService, SmtpServerService],
})
export class MailboxCoreModule {}
