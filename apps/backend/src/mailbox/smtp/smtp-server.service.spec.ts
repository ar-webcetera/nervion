import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { EntityManager } from 'typeorm';
import type { SMTPServerDataStream, SMTPServerSession } from 'smtp-server';
import { TenantStatus, type TenantDescriptor } from '@tracker/contracts';
import { TenantContextService } from '../../tenancy/tenant-context.service';
import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { StorageService } from '../../storage/storage.service';
import { TenantMailConfigService } from '../tenant-mail-config.service';
import { MailboxService } from '../mailbox.service';
import { SmtpServerService } from './smtp-server.service';

jest.mock('mailauth', () => ({ authenticate: jest.fn().mockResolvedValue({}) }));
jest.mock('mailparser', () => ({
  simpleParser: jest.fn().mockResolvedValue({
    headers: new Map([['x-nervion-notification-id', '5']]),
    messageId: '<original@example.test>',
    from: { value: [{ address: 'sender@example.test' }] },
    to: { value: [{ address: 'inbox@one.test' }, { address: 'inbox@two.test' }] },
    subject: 'Test inbound',
    text: 'Hello',
    attachments: [],
  }),
}));

const makeTenant = (id: string): TenantDescriptor => ({
  id,
  slug: id,
  hostname: `${id}.example.test`,
  status: TenantStatus.ACTIVE,
  databaseShardId: 'data_1',
  readOnly: false,
  featureFlags: { mail: true },
  storageNamespace: `tenants/${id}/`,
});

describe('tenant SMTP recipient routing', () => {
  it('routes equal local account IDs in different tenants separately and ignores forged notification headers', async () => {
    const first = makeTenant('11111111-1111-4111-8111-111111111111');
    const second = makeTenant('22222222-2222-4222-8222-222222222222');
    const context = new TenantContextService();
    const uploadedTenants: string[] = [];
    const ingestedTenants: string[] = [];
    const ingestInbound = jest.fn<Promise<void>, []>(() => {
      ingestedTenants.push(context.require().tenant.id);
      return Promise.resolve();
    });
    const mailbox = {
      findAccountByAddress: jest.fn<Promise<{ id: number; is_active: boolean }>, []>(() =>
        Promise.resolve({ id: 1, is_active: true }),
      ),
      ingestInbound,
    };
    const storage = {
      uploadObject: jest.fn<Promise<void>, []>(() => {
        uploadedTenants.push(context.require().tenant.id);
        return Promise.resolve();
      }),
    };
    const configuration = {
      isEnabled: () => true,
      resolveRecipient: (address: string): Promise<TenantDescriptor | null> =>
        Promise.resolve(address.endsWith('@one.test') ? first : address.endsWith('@two.test') ? second : null),
    };
    const database = {
      run: <T>(tenant: TenantDescriptor, callback: () => Promise<T>) =>
        context.run(
          {
            tenant,
            manager: {} as EntityManager,
            active: true,
            afterCommit: [],
            afterRollback: [],
            pending: new Set(),
          },
          callback,
        ),
    };
    const service = new SmtpServerService(
      new ConfigService(),
      mailbox as object as MailboxService,
      storage as object as StorageService,
      configuration as TenantMailConfigService,
      database as TenantDatabaseService,
    );
    const message = Readable.from([Buffer.from('test raw email')]) as SMTPServerDataStream;
    const session = {
      envelope: {
        mailFrom: { address: 'sender@example.test' },
        rcptTo: [{ address: 'inbox@one.test' }, { address: 'inbox@two.test' }],
      },
    } as SMTPServerSession;
    await (
      service as object as { handleMessage: (stream: SMTPServerDataStream, session: SMTPServerSession) => Promise<void> }
    ).handleMessage(message, session);
    expect(ingestedTenants).toEqual([first.id, second.id]);
    expect(uploadedTenants).toEqual([first.id, second.id]);
    expect(ingestInbound).toHaveBeenCalledTimes(2);
    expect(ingestInbound).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ notificationId: null }),
    );
    expect(mailbox.findAccountByAddress).toHaveBeenCalledWith('inbox@two.test');
  });
});
