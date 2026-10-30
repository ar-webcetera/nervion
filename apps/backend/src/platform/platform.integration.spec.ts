import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { join } from 'path';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { MembershipStatus, TenantStatus } from '@tracker/contracts';
import type { CreatePlatformTenantRequest, TenantDescriptor } from '@tracker/contracts';
import { PlatformService } from './platform.service';
import { PLATFORM_ENTITIES, PlatformIdentity, PlatformMembership, PlatformTenant } from './entities/platform.platform-entity';
import { CreatePlatform1793400000000 } from './migrations/1793400000000-CreatePlatform';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { registerTenantShard } from '../tenancy/tenant-data-source';
import { ROLES } from '../common/enums/roles.enum';
import { hashIdentityPassword, verifyIdentityPassword } from './password';
import { TenantJobsService } from '../tenancy/tenant-jobs.service';
import { PlatformMembershipSyncService } from './platform-membership-sync.service';

const migrationUrl = process.env.PLATFORM_TEST_DATABASE_URL;
const runtimeUrl = process.env.PLATFORM_TEST_RUNTIME_DATABASE_URL;
const integration = migrationUrl && runtimeUrl ? describe : describe.skip;

integration('platform provisioning and membership integration', () => {
  let platform: DataSource;
  let data: DataSource;
  let service: PlatformService;
  let tenantDatabase: TenantDatabaseService;
  const context = new TenantContextService();
  const previousEnabled = process.env.TENANCY_ENABLED;

  const input = (slug: string, seatLimit = 10): CreatePlatformTenantRequest => ({
    slug,
    name: slug,
    plan: 'test',
    seatLimit,
    paidUntil: null,
    featureFlags: {},
    admin: {
      email: `${slug}@example.test`,
      firstName: 'Test',
      lastName: 'Admin',
      password: 'test-admin-password-123',
      emailOwnershipVerified: true,
    },
  });

  beforeAll(async () => {
    const migrationConnection = new URL(migrationUrl!);
    const runtimeConnection = new URL(runtimeUrl!);
    if (!migrationConnection.pathname.includes('_test') || migrationConnection.pathname !== runtimeConnection.pathname)
      throw new Error('Platform tests require one dedicated _test database');
    const runtimeRole = decodeURIComponent(runtimeConnection.username);
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(runtimeRole)) throw new Error('Invalid test runtime role');
    platform = await new DataSource({
      type: 'postgres',
      url: migrationUrl,
      entities: PLATFORM_ENTITIES,
      synchronize: false,
    }).initialize();
    const tables = await platform.query<Array<{ name: string }>>(
      "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'",
    );
    if (tables.length) throw new Error('Platform test database must have an empty public schema');
    const runner = platform.createQueryRunner();
    try {
      await new CreatePlatform1793400000000().up(runner);
    } finally {
      await runner.release();
    }
    await platform.query(`
      CREATE TABLE users (
        tenant_id uuid NOT NULL DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid,
        id serial, email varchar, hashed_password varchar, first_name varchar NOT NULL DEFAULT 'Имя',
        last_name varchar NOT NULL DEFAULT 'Фамилия', patronymic varchar, telegram_user_id varchar,
        yandex_id varchar, photo_url varchar, role varchar NOT NULL DEFAULT 'employee',
        hidden_menu_items jsonb NOT NULL DEFAULT '[]', selected_mail_account_id integer,
        created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(), deleted_at timestamp,
        PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, email)
      );
      CREATE TABLE task_stages (tenant_id uuid NOT NULL, id varchar NOT NULL, title varchar NOT NULL, position integer NOT NULL, protected boolean NOT NULL, PRIMARY KEY (tenant_id, id));
      CREATE TABLE crm_stages (tenant_id uuid NOT NULL, id serial, name varchar NOT NULL, position integer NOT NULL, kind varchar NOT NULL, PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, position));
      CREATE TABLE tenant_jobs (
        id uuid NOT NULL, tenant_id uuid NOT NULL, database_shard_id varchar NOT NULL, actor_id integer,
        idempotency_key varchar NOT NULL, kind varchar NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
        status varchar NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
        available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz, last_error text, PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, idempotency_key)
      );
    `);
    for (const table of ['users', 'task_stages', 'crm_stages', 'tenant_jobs']) {
      await platform.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY isolation ON ${table} USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
        GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO "${runtimeRole}";`);
    }
    await platform.query(
      `GRANT USAGE ON SCHEMA public TO "${runtimeRole}"; GRANT USAGE, SELECT ON SEQUENCE users_id_seq, crm_stages_id_seq TO "${runtimeRole}";`,
    );
    data = await new DataSource({
      type: 'postgres',
      url: runtimeUrl,
      entities: [join(__dirname, '../**/*.entity{.ts,.js}')],
      synchronize: false,
    }).initialize();
    const [role] = await data.query<Array<{ privileged: boolean }>>(
      'SELECT (rolsuper OR rolbypassrls) AS privileged FROM pg_roles WHERE rolname = current_user',
    );
    if (role.privileged) throw new Error('Platform test data role must not bypass RLS');
    process.env.TENANCY_ENABLED = 'true';
    registerTenantShard('data_1', data);
    tenantDatabase = new TenantDatabaseService(context);
    const container = await Test.createTestingModule({
      providers: [
        { provide: TenantDatabaseService, useValue: tenantDatabase },
        { provide: TenantContextService, useValue: context },
      ],
    }).compile();
    const moduleRef = container.get(ModuleRef);
    service = new PlatformService(
      platform,
      new ConfigService({ TENANCY_ENABLED: 'true', TENANCY_ROOT_DOMAIN: 'example.test', JWT_SECRET: 'test-legacy-salt' }),
      moduleRef,
    );
  }, 30_000);

  afterAll(async () => {
    if (previousEnabled === undefined) delete process.env.TENANCY_ENABLED;
    else process.env.TENANCY_ENABLED = previousEnabled;
    if (data?.isInitialized) await data.destroy();
    if (platform?.isInitialized) {
      // Keep the disposable fixture available for inspection after the run.
      await platform.destroy();
    }
  });

  it('serializes concurrent seat reservations, including the first administrator', async () => {
    const tenant = await service.createTenant(input('seats', 2), 'operator');
    const results = await Promise.allSettled([
      service.reserveMembership(tenant.id, 'one@example.test', hashIdentityPassword('test-user-password'), ROLES.guest),
      service.reserveMembership(tenant.id, 'two@example.test', hashIdentityPassword('test-user-password'), ROLES.admin),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason instanceof ConflictException).toBe(true);
    expect(await platform.getRepository(PlatformMembership).countBy({ tenantId: tenant.id })).toBe(2);
    const rows = await service.listTenants();
    expect(rows.find((row) => row.id === tenant.id)?.activeSeats).toBe(2);
  });

  it('does not replace a global password when another tenant adds the same email', async () => {
    const first = await service.createTenant(input('identity-first'), 'operator');
    const secondInput = input('identity-second');
    secondInput.admin.email = 'identity-first@example.test';
    secondInput.admin.password = 'different-password-that-must-not-replace';
    const second = await service.createTenant(secondInput, 'operator');
    const identity = await platform
      .getRepository(PlatformIdentity)
      .findOneOrFail({ where: { email: secondInput.admin.email }, select: ['id', 'passwordHash'] });
    expect(verifyIdentityPassword('test-admin-password-123', identity.passwordHash)).toBe(true);
    expect(verifyIdentityPassword(secondInput.admin.password, identity.passwordHash)).toBe(false);
    const member = await service.authenticate(second.id, secondInput.admin.email, 'test-admin-password-123');
    expect(member.identityId).toBe(identity.id);
    await expect(service.assertSession(first.id, member.localUserId!, service.sessionClaims(member))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.assertSession(second.id, member.localUserId!, {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('blocks an unverified identity claimed by another tenant until operator verification and password rotation', async () => {
    const source = await service.createTenant(input('claim-source'), 'operator');
    const target = await service.createTenant(input('claim-target'), 'operator');
    const reservation = await service.reserveMembership(
      source.id,
      'claimed-victim@example.test',
      hashIdentityPassword('attacker-chosen-password'),
      ROLES.employee,
    );
    const userId = await tenantDatabase.run(source, async () => {
      const [row] = await context
        .require()
        .manager.query<
          Array<{ id: number }>
        >("INSERT INTO users (email, role) VALUES ('claimed-victim@example.test', 'employee') RETURNING id");
      return row.id;
    });
    await service.activateReservation(reservation.membership.id, userId);
    const unverifiedMember = await service.authenticate(source.id, 'claimed-victim@example.test', 'attacker-chosen-password');
    const stolenSession = service.sessionClaims(unverifiedMember);
    await expect(
      service.reserveMembership(target.id, 'claimed-victim@example.test', hashIdentityPassword('some-password'), ROLES.guest),
    ).rejects.toBeInstanceOf(ConflictException);
    await service.verifyIdentityOwnership('claimed-victim@example.test', 'owner-only-new-password', 'operator');
    await expect(service.assertSession(source.id, userId, stolenSession)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.authenticate(source.id, 'claimed-victim@example.test', 'attacker-chosen-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const verified = await service.reserveMembership(
      target.id,
      'claimed-victim@example.test',
      hashIdentityPassword('ignored-password'),
      ROLES.guest,
    );
    expect(verified.createdIdentity).toBe(false);
    expect(verified.membership.identityId).toBe(reservation.membership.identityId);
    const identity = await platform
      .getRepository(PlatformIdentity)
      .findOneOrFail({ where: { id: verified.membership.identityId }, select: ['id', 'passwordHash', 'emailVerifiedAt'] });
    expect(identity.emailVerifiedAt).not.toBeNull();
    expect(verifyIdentityPassword('owner-only-new-password', identity.passwordHash)).toBe(true);
  });

  it('retries provisioning after a committed data transaction without duplicating defaults or users', async () => {
    const actualRun = tenantDatabase.run.bind(tenantDatabase);
    const interrupted = jest
      .spyOn(tenantDatabase, 'run')
      .mockImplementationOnce(
        async <T>(tenant: TenantDescriptor, callback: () => Promise<T>, options?: { readOnly?: boolean; actorId?: number }) => {
          await actualRun(tenant, callback, options);
          throw new Error('Simulated interruption after data commit');
        },
      );
    await expect(service.createTenant(input('retry-provision'), 'operator')).rejects.toThrow('Simulated interruption');
    interrupted.mockRestore();
    const failed = await platform.getRepository(PlatformTenant).findOneByOrFail({ slug: 'retry-provision' });
    expect(failed.status).toBe(TenantStatus.FAILED);
    const ready = await service.provisionTenant(failed.id, 'operator');
    expect(ready.status).toBe(TenantStatus.ACTIVE);
    await service.provisionTenant(failed.id, 'operator');
    await tenantDatabase.run(ready, async () => {
      const manager = context.require().manager;
      const [users] = await manager.query<Array<{ count: string }>>('SELECT count(*)::text FROM users');
      const [stages] = await manager.query<Array<{ count: string }>>('SELECT count(*)::text FROM task_stages');
      const [crm] = await manager.query<Array<{ count: string }>>('SELECT count(*)::text FROM crm_stages');
      expect(Number(users.count)).toBe(1);
      expect(Number(stages.count)).toBe(8);
      expect(Number(crm.count)).toBe(8);
    });
  });

  it('applies expiry/read-only and refuses new seats after cancellation', async () => {
    const tenant = await service.createTenant(input('expired'), 'operator');
    const expired = await service.updateTenant(tenant.id, { paidUntil: '2020-01-01T00:00:00Z' }, 'operator');
    expect(expired.readOnly).toBe(true);
    const cancelled = await service.updateTenant(tenant.id, { status: TenantStatus.CANCELLED }, 'operator');
    expect(cancelled.readOnly).toBe(true);
    expect(new Date(cancelled.retentionUntil!).getTime()).toBeGreaterThan(Date.now() + 89 * 86_400_000);
    await expect(
      service.reserveMembership(tenant.id, 'blocked@example.test', hashIdentityPassword('password-to-deny'), ROLES.guest),
    ).rejects.toThrow('только для чтения');
  });

  it('reserves archived memberships again without changing identity credentials', async () => {
    const tenant = await service.createTenant(input('restore-seat', 1), 'operator');
    const member = await service.authenticate(tenant.id, 'restore-seat@example.test', 'test-admin-password-123');
    await service.archiveMembership(tenant.id, member.localUserId!);
    const reservation = await service.reserveMembership(
      tenant.id,
      'restore-seat@example.test',
      'ignored-hash',
      ROLES.admin,
      member.localUserId!,
    );
    expect(reservation.createdIdentity).toBe(false);
    expect(reservation.previousStatus).toBe(MembershipStatus.ARCHIVED);
    await expect(service.assertMembership(tenant.id, member.localUserId!)).rejects.toBeInstanceOf(UnauthorizedException);
    await service.activateReservation(reservation.membership.id, member.localUserId!);
    await expect(service.authenticate(tenant.id, 'restore-seat@example.test', 'test-admin-password-123')).resolves.toMatchObject({
      id: member.id,
    });
  });

  it('retries the committed membership outbox after a platform outage without releasing the reserved seat', async () => {
    const tenant = await service.createTenant(input('outbox-retry', 2), 'operator');
    const jobs = new TenantJobsService(context, tenantDatabase, service);
    new PlatformMembershipSyncService(jobs, context, service).onModuleInit();
    const reservation = await service.reserveMembership(
      tenant.id,
      'outbox-user@example.test',
      hashIdentityPassword('new-user-password'),
      ROLES.employee,
    );
    const userId = await tenantDatabase.run(tenant, async () => {
      const [user] = await context
        .require()
        .manager.query<
          Array<{ id: number }>
        >("INSERT INTO users (email, role) VALUES ('Outbox-User@example.test', 'employee') RETURNING id");
      await jobs.enqueue('membership-sync', `membership-create:${user.id}`, {
        userId: user.id,
        membershipId: reservation.membership.id,
      });
      return user.id;
    });
    const synchronize = jest
      .spyOn(service, 'synchronizeMembership')
      .mockRejectedValueOnce(new Error('Platform temporarily unavailable'));
    await jobs.tick();
    expect((await platform.getRepository(PlatformMembership).findOneByOrFail({ id: reservation.membership.id })).status).toBe(
      MembershipStatus.RESERVED,
    );
    await tenantDatabase.run(tenant, async () => {
      const [job] = await context
        .require()
        .manager.query<Array<{ status: string; attempts: number }>>('SELECT status, attempts FROM tenant_jobs');
      expect(job).toMatchObject({ status: 'pending', attempts: 1 });
      await context.require().manager.query("UPDATE tenant_jobs SET available_at = now() WHERE status = 'pending'");
    });
    await jobs.tick();
    synchronize.mockRestore();
    expect(await platform.getRepository(PlatformMembership).findOneByOrFail({ id: reservation.membership.id })).toMatchObject({
      status: MembershipStatus.ACTIVE,
      localUserId: userId,
    });
    await tenantDatabase.run(tenant, async () => {
      const [job] = await context
        .require()
        .manager.query<Array<{ status: string; attempts: number }>>('SELECT status, attempts FROM tenant_jobs');
      expect(job).toMatchObject({ status: 'completed', attempts: 2 });
    });
    // Reconciliation uses local user ID, not a case-sensitive email lookup.
    await platform
      .getRepository(PlatformMembership)
      .update(reservation.membership.id, { updatedAt: new Date(Date.now() - 16 * 60 * 1000) });
    await service.reconcileMemberships(tenant.id, 'operator');
    expect((await platform.getRepository(PlatformMembership).findOneByOrFail({ id: reservation.membership.id })).status).toBe(
      MembershipStatus.ACTIVE,
    );
  });
});
