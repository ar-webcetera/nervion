import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushModule } from '../push/push.module';
import { StorageModule } from '../storage/storage.module';
import { MailAccounts } from './entities/mail-account.entity';
import { MailAttachments } from './entities/mail-attachment.entity';
import { MailDeliveryEvents } from './entities/mail-delivery-event.entity';
import { MailFolders } from './entities/mail-folder.entity';
import { MailSpamRules } from './entities/mail-spam-rule.entity';
import { MailMessages } from './entities/mail-message.entity';
import { MailThreads } from './entities/mail-thread.entity';
import { MailDeliveryService } from './mail-delivery.service';
import { MailboxService } from './mailbox.service';
import { MailSpamService } from './mail-spam.service';
import { PostboxService } from './postbox.service';
import { SmtpServerService } from './smtp/smtp-server.service';
import { Notifications } from '../notifications/entities/notification.entity';
import { Users } from '../users/entities/users.entity';

@Module({
  imports: [
    PushModule,
    StorageModule,
    TypeOrmModule.forFeature([
      MailAccounts,
      MailThreads,
      MailMessages,
      MailAttachments,
      MailDeliveryEvents,
      MailFolders,
      MailSpamRules,
      Notifications,
      Users,
    ]),
  ],
  providers: [MailboxService, MailDeliveryService, MailSpamService, PostboxService, SmtpServerService],
  exports: [MailboxService, MailDeliveryService, PostboxService, SmtpServerService],
})
export class MailboxCoreModule {}
