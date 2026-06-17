import { Module } from '@nestjs/common';
import { MailboxCoreModule } from './mailbox-core.module';
import { MailboxController } from './mailbox.controller';

@Module({
  imports: [MailboxCoreModule],
  controllers: [MailboxController],
  exports: [MailboxCoreModule],
})
export class MailboxModule {}
