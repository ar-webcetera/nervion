import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { MembershipStatus, TenantStatus } from '@tracker/contracts';
import platformSource from './platform-data-source';
import { PlatformAudit, PlatformIdentity, PlatformMembership, PlatformTenant } from './entities/platform.platform-entity';

dotenv.config();

interface LegacyUser {
  id: number;
  email: string | null;
  hashed_password: string | null;
  role: string;
  deleted_at: Date | null;
}

/** Explicit deployment step. Import never runs inside backend startup. */
export async function bootstrapExistingTenant(): Promise<void> {
  const tenantId = process.env.TENANCY_BOOTSTRAP_TENANT_ID || '';
  const slug = process.env.TENANCY_BOOTSTRAP_SLUG || 'webcetera';
  const hostname = process.env.TENANCY_BOOTSTRAP_HOSTNAME || 'webcetera.nervion.ru';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId))
    throw new Error('TENANCY_BOOTSTRAP_TENANT_ID must match the UUID used by tenant data migrations');
  if (!/^[a-z][a-z0-9-]{1,48}[a-z0-9]$/.test(slug) || !/^[a-z0-9.-]+$/.test(hostname))
    throw new Error('Invalid bootstrap slug or hostname');
  for (const key of [
    'MIGRATION_POSTGRES_USER',
    'MIGRATION_POSTGRES_PASSWORD',
    'PLATFORM_MIGRATION_POSTGRES_USER',
    'PLATFORM_MIGRATION_POSTGRES_PASSWORD',
  ]) {
    if (!process.env[key]) throw new Error(`${key} is required for bootstrap`);
  }
  const data = new DataSource({
    type: 'postgres',
    host: process.env.MIGRATION_POSTGRES_HOST || process.env.POSTGRES_HOST,
    port: Number(process.env.MIGRATION_POSTGRES_PORT || 5432),
    username: process.env.MIGRATION_POSTGRES_USER,
    password: process.env.MIGRATION_POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB || 'nervion_data_1',
    synchronize: false,
    migrationsRun: false,
  });
  try {
    await data.initialize();
    await platformSource.initialize();
    const users = await data.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
      return manager.query<LegacyUser[]>(
        'SELECT id, email, hashed_password, role, deleted_at FROM users WHERE tenant_id = $1 ORDER BY id',
        [tenantId],
      );
    });
    if (!users.length)
      throw new Error('No users found for bootstrap tenant. Run tenant migration first and verify TENANCY_BOOTSTRAP_TENANT_ID.');
    const missing = users.filter((user) => !user.email || (!user.deleted_at && !user.hashed_password));
    if (missing.length)
      throw new Error(
        `Users need an email and active users need a password before bootstrap: ${missing.map((user) => user.id).join(', ')}`,
      );
    if (users.some((user) => /^[a-f0-9]{40}$/i.test(user.hashed_password || '')) && !process.env.JWT_SECRET) {
      throw new Error('The original legacy JWT_SECRET is required to preserve existing SHA1 password authentication.');
    }
    const emails = users.map((user) => user.email!.trim().toLowerCase());
    if (new Set(emails).size !== users.length)
      throw new Error('Case-insensitive duplicate emails must be merged before bootstrap');
    const occupied = users.filter((user) => !user.deleted_at).length;
    const seatLimit = Number(process.env.TENANCY_BOOTSTRAP_SEAT_LIMIT || Math.max(100, occupied));
    if (!Number.isSafeInteger(seatLimit) || seatLimit < occupied || seatLimit < 1)
      throw new Error('Bootstrap seat limit must cover all active users');

    await platformSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`bootstrap:${tenantId}`]);
      const tenants = manager.getRepository(PlatformTenant);
      const previous = await tenants.findOneBy({ id: tenantId });
      if (previous && (previous.slug !== slug || previous.hostname !== hostname || previous.databaseShardId !== 'data_1'))
        throw new Error('Existing bootstrap tenant does not match configuration');
      if (!previous) {
        await tenants.insert({
          id: tenantId,
          slug,
          hostname,
          name: 'Webcetera',
          status: TenantStatus.ACTIVE,
          plan: 'internal',
          seatLimit,
          paidUntil: null,
          graceUntil: null,
          retentionUntil: null,
          databaseShardId: 'data_1',
          storageNamespace: `tenants/${tenantId}/`,
          featureFlags: {
            tasks: true,
            projects: true,
            files: true,
            chat: true,
            wiki: true,
            crm: true,
            reports: true,
            mail: false,
            git: false,
            voice: false,
          },
          provisioningAdmin: null,
          provisioningError: null,
        });
      }
      for (const user of users) {
        const email = user.email!.trim().toLowerCase();
        const identities = manager.getRepository(PlatformIdentity);
        let identity = await identities.findOne({ where: { email }, select: ['id', 'email', 'passwordHash'] });
        const memberships = manager.getRepository(PlatformMembership);
        if (!identity)
          identity = await identities.save({
            id: randomUUID(),
            email,
            passwordHash: user.hashed_password,
            credentialOriginTenantId: tenantId,
            emailVerifiedAt: new Date(),
            sessionVersion: 1,
            mfaSettings: {},
          });
        const membership = await memberships.findOneBy({ tenantId, identityId: identity.id });
        if (membership && membership.localUserId !== user.id) throw new Error(`Membership mismatch for local user ${user.id}`);
        if (!membership && identity.passwordHash !== user.hashed_password)
          throw new Error(`Existing global identity has different credentials for local user ${user.id}; reconcile manually`);
        if (!membership) {
          await memberships.insert({
            id: randomUUID(),
            tenantId,
            identityId: identity.id,
            localUserId: user.id,
            role: user.role,
            status: user.deleted_at ? MembershipStatus.ARCHIVED : MembershipStatus.ACTIVE,
          });
        }
      }
      await manager.getRepository(PlatformAudit).insert({
        actor: 'deployment-bootstrap',
        action: 'tenant.bootstrap',
        tenantId,
        details: { users: users.length, activeUsers: occupied },
      });
    });
    console.log(`Bootstrap complete: tenant ${tenantId}, ${users.length} users. Existing global passwords were preserved.`);
  } finally {
    if (platformSource.isInitialized) await platformSource.destroy();
    if (data.isInitialized) await data.destroy();
  }
}

if (require.main === module) {
  void bootstrapExistingTenant().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
