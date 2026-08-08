import { Module } from '@nestjs/common';
import { MailboxCoreModule } from './mailbox-core.module';
import { MailboxController } from './mailbox.controller';
import { MailboxPostboxEventsController } from './mailbox-postbox-events.controller';

@Module({
  imports: [MailboxCoreModule],
  controllers: [MailboxController, MailboxPostboxEventsController],
  exports: [MailboxCoreModule],
})
export class MailboxModule {}
