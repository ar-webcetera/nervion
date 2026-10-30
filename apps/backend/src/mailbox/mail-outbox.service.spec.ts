import { EntityManager, Repository } from 'typeorm';
import { TenantStatus, type TenantDescriptor } from '@tracker/contracts';
import { PlatformService } from '../platform/platform.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { StorageService } from '../storage/storage.service';
import { MailMessages, MAIL_MESSAGE_STATUSES } from './entities/mail-message.entity';
import { MailOutboxService } from './mail-outbox.service';
import { PostboxService, type PostboxSendResult } from './postbox.service';
import { TenantMailConfigService } from './tenant-mail-config.service';
import { ROLES } from '../common/enums/roles.enum';
import { Readable } from 'node:stream';

const tenant: TenantDescriptor = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'client',
  hostname: 'client.example.test',
  databaseShardId: 'data_1',
  storageNamespace: 'tenants/11111111-1111-4111-8111-111111111111/',
  readOnly: false,
  featureFlags: { mail: true },
  status: TenantStatus.ACTIVE,
};

describe('durable tenant mail outbox', () => {
  function fixture(failSend = false) {
    let pending = true;
    let commits = 0;
    const actor = { id: 9, role: ROLES.employee };
    const actorRepository = { findOneBy: jest.fn().mockResolvedValue(actor) };
    const query = jest.fn<Promise<Array<{ id: string; message_id: number }>>, [string]>((sql) => {
      if (sql.startsWith('SELECT id, message_id') && pending) {
        pending = false;
        return Promise.resolve([{ id: 'outbox-id', message_id: 17 }]);
      }
      return Promise.resolve([]);
    });
    const context = new TenantContextService();
    const database = {
      run: async <T>(space: TenantDescriptor, work: () => Promise<T>) => {
        const result = await context.run(
          {
            tenant: space,
            manager: { query, getRepository: () => actorRepository } as object as EntityManager,
            active: true,
            afterCommit: [],
            afterRollback: [],
            pending: new Set(),
          },
          work,
        );
        commits += 1;
        return result;
      },
    };
    const send = jest.fn<Promise<PostboxSendResult>, []>(() => {
      expect(commits).toBeGreaterThanOrEqual(1);
      if (failSend) return Promise.reject(new Error('Connection reset after provider accepted request'));
      return Promise.resolve({ messageId: 'message-id@example.test', providerMessageId: 'provider-id' });
    });
    const message = {
      id: 17,
      message_id: 'message-id@example.test',
      status: MAIL_MESSAGE_STATUSES.sending,
      sent_by_user_id: null as number | null,
      thread: { account: { is_active: true, address: 'sender@example.test', allowedUsers: [{ id: 9 }] } },
      attachments: [] as Array<{ s3_key: string; filename: string; content_type: string }>,
      to_addresses: [{ address: 'recipient@example.test' }],
      cc_addresses: [],
      from_address: 'sender@example.test',
    };
    const messages = { findOne: jest.fn().mockResolvedValue(message), update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const platform = {
      listRunnableTenants: jest.fn().mockResolvedValue([tenant]),
      getTenant: jest.fn().mockResolvedValue(tenant),
      assertMembership: jest.fn().mockResolvedValue({ role: ROLES.employee }),
    };
    const storage = { getObjectStream: jest.fn() };
    const service = new MailOutboxService(
      context,
      database as TenantDatabaseService,
      platform as Partial<PlatformService> as PlatformService,
      {
        assertSender: jest.fn(),
        current: () => ({ notificationAccount: 'sender@example.test' }),
      } as object as TenantMailConfigService,
      { send } as object as PostboxService,
      storage as Partial<StorageService> as StorageService,
      messages as object as Repository<MailMessages>,
    );
    return { service, send, query, messages, message, platform, storage, actorRepository, context };
  }

  it('commits a claim before sending and does not send the same job twice', async () => {
    const { service, send, query } = fixture();
    await service.tick();
    await service.tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith("UPDATE mail_outbox SET status = 'sent', last_error = NULL WHERE id = $1", ['outbox-id']);
  });

  it('quarantines ambiguous outcomes instead of retrying automatically', async () => {
    const { service, send, query } = fixture(true);
    await service.tick();
    await service.tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE mail_outbox SET status = $2'), [
      'outbox-id',
      MAIL_MESSAGE_STATUSES.uncertain,
      expect.any(String),
    ]);
  });

  it('rechecks read-only after loading attachments and leaves the claim untouched until resume', async () => {
    const { service, send, query, message, platform, storage } = fixture();
    message.attachments = [{ s3_key: 'tenants/a/file', filename: 'file.txt', content_type: 'text/plain' }];
    storage.getObjectStream.mockImplementation(() => {
      platform.getTenant.mockResolvedValue({ ...tenant, readOnly: true });
      return Promise.resolve({ body: Readable.from([Buffer.from('attachment')]) });
    });
    await service.tick();
    expect(send).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE mail_outbox SET status = $2'))).toBe(false);
  });

  it('does not dispatch after the feature is disabled while loading attachments', async () => {
    const { service, send, message, platform, storage } = fixture();
    message.attachments = [{ s3_key: 'tenants/a/file', filename: 'file.txt', content_type: 'text/plain' }];
    storage.getObjectStream.mockImplementation(() => {
      platform.getTenant.mockResolvedValue({ ...tenant, featureFlags: { mail: false } });
      return Promise.resolve({ body: Readable.from([Buffer.from('attachment')]) });
    });
    await service.tick();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not deliver mail queued by a user whose membership was revoked', async () => {
    const { service, send, message, platform } = fixture();
    message.sent_by_user_id = 9;
    platform.assertMembership.mockRejectedValue(new Error('Membership revoked'));
    await service.tick();
    expect(platform.assertMembership).toHaveBeenCalledWith(tenant.id, 9);
    expect(send).not.toHaveBeenCalled();
  });

  it('rechecks the current account ACL for a queued human sender', async () => {
    const { service, send, message } = fixture();
    message.sent_by_user_id = 9;
    message.thread.account.allowedUsers = [];
    await service.tick();
    expect(send).not.toHaveBeenCalled();
  });

  it('delivers when the human sender still has active membership and account access', async () => {
    const { service, send, message, actorRepository } = fixture();
    message.sent_by_user_id = 9;
    await service.tick();
    expect(actorRepository.findOneBy).toHaveBeenCalledWith({ id: 9 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not use a stale tenant snapshot to write terminal status after suspension', async () => {
    const { service, send, query, platform } = fixture();
    send.mockImplementation(() => {
      platform.getTenant.mockRejectedValue(new Error('Tenant suspended'));
      return Promise.reject(new Error('Ambiguous provider timeout'));
    });
    await service.tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE mail_outbox SET status = $2'))).toBe(false);
  });

  it('detaches an explicitly triggered sweep from the caller transaction', async () => {
    const { service, context, platform } = fixture();
    platform.listRunnableTenants.mockImplementation(() => {
      expect(context.current()).toBeUndefined();
      return Promise.resolve([tenant]);
    });
    await context.run(
      { tenant, manager: {} as EntityManager, active: true, afterCommit: [], afterRollback: [], pending: new Set() },
      () => service.tick(),
    );
    expect(platform.listRunnableTenants).toHaveBeenCalled();
  });
});
