import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnApplicationShutdown,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { MembershipStatus, TenantStatus } from '@tracker/contracts';
import type {
  CreatePlatformTenantRequest,
  PlatformTenantSummary,
  TenantDescriptor,
  TenantSessionClaims,
  UpdatePlatformTenantRequest,
} from '@tracker/contracts';
import {
  PlatformAudit,
  PlatformAuditDetails,
  PlatformIdentity,
  PlatformMembership,
  PlatformTenant,
} from './entities/platform.platform-entity';
import { hashIdentityPassword, verifyIdentityPassword } from './password';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { Users } from '../users/entities/users.entity';
import { ROLES } from '../common/enums/roles.enum';
import { seedTenantDefaults } from './seed-tenant-defaults';

const DAY_MS = 24 * 60 * 60 * 1000;
const RESERVED_SLUGS = new Set(['admin', 'auth', 'api', 'www', 'mail', 'smtp', 'status', 'static']);
const DUMMY_PASSWORD_HASH = `scrypt$16384$8$1$${'0'.repeat(32)}$${'0'.repeat(128)}`;

export interface MembershipReservation {
  membership: PlatformMembership;
  createdIdentity: boolean;
  previousStatus: MembershipStatus | null;
}

@Injectable()
export class PlatformService implements OnApplicationShutdown {
  constructor(
    @Inject(getDataSourceToken('platform')) private readonly connection: DataSource | null,
    private readonly config: ConfigService,
    private readonly moduleRef: ModuleRef,
  ) {}

  isEnabled(): boolean {
    return this.config.get<string>('TENANCY_ENABLED') === 'true';
  }

  database(): DataSource {
    if (!this.isEnabled() || !this.connection) throw new NotFoundException();
    return this.connection;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.connection?.isInitialized) await this.connection.destroy();
  }

  async resolveTenant(hostname: string): Promise<TenantDescriptor> {
    const normalized = hostname.toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(normalized) || normalized.includes('..')) throw new NotFoundException('Пространство не найдено');
    const tenant = await this.database().getRepository(PlatformTenant).findOneBy({ hostname: normalized });
    if (!tenant) throw new NotFoundException('Пространство не найдено');
    this.assertAccessible(tenant);
    return this.descriptor(tenant);
  }

  async getTenant(tenantId: string): Promise<TenantDescriptor> {
    const tenant = await this.database().getRepository(PlatformTenant).findOneBy({ id: tenantId });
    if (!tenant) throw new NotFoundException('Пространство не найдено');
    this.assertAccessible(tenant);
    return this.descriptor(tenant);
  }

  async listRunnableTenants(): Promise<TenantDescriptor[]> {
    const tenants = await this.database()
      .getRepository(PlatformTenant)
      .findBy({ status: In([TenantStatus.ACTIVE, TenantStatus.READ_ONLY]) });
    return tenants.map((tenant) => this.descriptor(tenant));
  }

  async getMembership(tenantId: string, userId: number): Promise<PlatformMembership | null> {
    const membership = await this.database()
      .getRepository(PlatformMembership)
      .findOneBy({ tenantId, localUserId: userId, status: MembershipStatus.ACTIVE });
    if (!membership) return null;
    const identity = await this.database().getRepository(PlatformIdentity).findOneBy({ id: membership.identityId });
    if (!identity || (!identity.emailVerifiedAt && identity.credentialOriginTenantId !== tenantId)) return null;
    membership.identityVersion = identity.sessionVersion;
    return membership;
  }

  async assertMembership(tenantId: string, userId: number): Promise<PlatformMembership> {
    await this.getTenant(tenantId);
    const membership = await this.getMembership(tenantId, userId);
    if (!membership) throw new UnauthorizedException('Нет доступа к пространству');
    return membership;
  }

  async assertSession(tenantId: string, userId: number, claims: Partial<TenantSessionClaims>): Promise<PlatformMembership> {
    if (claims.tenantId !== tenantId || !claims.identityId || !claims.membershipId)
      throw new UnauthorizedException('Сессия другого пространства');
    const membership = await this.assertMembership(tenantId, userId);
    if (
      membership.id !== claims.membershipId ||
      membership.identityId !== claims.identityId ||
      membership.identityVersion !== claims.identityVersion
    )
      throw new UnauthorizedException('Сессия отозвана');
    return membership;
  }

  sessionClaims(membership: PlatformMembership): TenantSessionClaims {
    if (!membership.identityVersion) throw new UnauthorizedException('Версия сессии не определена');
    return {
      tenantId: membership.tenantId,
      identityId: membership.identityId,
      membershipId: membership.id,
      identityVersion: membership.identityVersion,
    };
  }

  async authenticate(tenantId: string, email: string, password: string): Promise<PlatformMembership> {
    await this.getTenant(tenantId);
    const identity = await this.database()
      .getRepository(PlatformIdentity)
      .findOne({
        where: { email: email.trim().toLowerCase() },
        select: ['id', 'email', 'passwordHash', 'sessionVersion', 'emailVerifiedAt', 'credentialOriginTenantId'],
      });
    const valid = verifyIdentityPassword(
      password,
      identity?.passwordHash || DUMMY_PASSWORD_HASH,
      this.config.get<string>('JWT_SECRET'),
    );
    if (!identity || !valid) throw new UnauthorizedException('Неверный email или пароль');
    if (!identity.emailVerifiedAt && identity.credentialOriginTenantId !== tenantId)
      throw new UnauthorizedException('Email учетной записи требует подтверждения');
    const membership = await this.database()
      .getRepository(PlatformMembership)
      .findOneBy({ tenantId, identityId: identity.id, status: MembershipStatus.ACTIVE });
    if (!membership || !membership.localUserId) throw new UnauthorizedException('Нет доступа к пространству');
    membership.identityVersion = identity.sessionVersion;
    if (!identity.passwordHash?.startsWith('scrypt$')) {
      await this.database()
        .getRepository(PlatformIdentity)
        .update(identity.id, { passwordHash: hashIdentityPassword(password) });
    }
    return membership;
  }

  async changeOwnPassword(identityId: string, currentPassword: string, newPassword: string): Promise<void> {
    const identities = this.database().getRepository(PlatformIdentity);
    const identity = await identities.findOne({ where: { id: identityId }, select: ['id', 'passwordHash'] });
    if (!identity || !verifyIdentityPassword(currentPassword, identity.passwordHash, this.config.get<string>('JWT_SECRET')))
      throw new UnauthorizedException('Неверный текущий пароль');
    await identities
      .createQueryBuilder()
      .update()
      .set({ passwordHash: hashIdentityPassword(newPassword), sessionVersion: () => 'session_version + 1' })
      .where('id = :identityId', { identityId })
      .execute();
  }

  async verifyIdentityOwnership(
    email: string,
    newPassword: string,
    actor: string,
  ): Promise<{ identityId: string; email: string; verified: true }> {
    return this.database().transaction(async (manager) => {
      const identity = await manager
        .getRepository(PlatformIdentity)
        .findOne({ where: { email: email.trim().toLowerCase() }, lock: { mode: 'pessimistic_write' } });
      if (!identity) throw new NotFoundException('Учетная запись не найдена');
      identity.passwordHash = hashIdentityPassword(newPassword);
      identity.emailVerifiedAt = new Date();
      identity.sessionVersion += 1;
      await manager.getRepository(PlatformIdentity).save(identity);
      await manager.getRepository(PlatformAudit).insert({
        actor,
        action: 'identity.ownership_verified',
        tenantId: null,
        details: { identityId: identity.id, email: identity.email },
      });
      return { identityId: identity.id, email: identity.email, verified: true };
    });
  }

  async reserveMembership(
    tenantId: string,
    email: string,
    passwordHash: string,
    role: ROLES,
    localUserId?: number,
  ): Promise<MembershipReservation> {
    return this.database().transaction(async (manager) => {
      const tenant = await this.lockTenant(manager, tenantId);
      this.assertAccessible(tenant);
      if (this.descriptor(tenant).readOnly) throw new ForbiddenException('Пространство доступно только для чтения');
      const { identity, created } = await this.ensureIdentity(manager, email, passwordHash, tenantId);
      const repository = manager.getRepository(PlatformMembership);
      const existing = await repository.findOneBy({ tenantId, identityId: identity.id });
      if (existing && existing.status !== MembershipStatus.ARCHIVED)
        throw new ConflictException('Пользователь уже добавлен или его добавление ожидает завершения');
      const occupied = await this.countSeats(manager, tenantId);
      if (occupied >= tenant.seatLimit) throw new ConflictException('Достигнут лимит пользователей тарифа');
      const membership = await repository.save(
        repository.create({
          id: existing?.id || randomUUID(),
          tenantId,
          identityId: identity.id,
          localUserId: localUserId ?? existing?.localUserId ?? null,
          role,
          status: MembershipStatus.RESERVED,
        }),
      );
      return { membership, createdIdentity: created, previousStatus: existing?.status || null };
    });
  }

  async activateReservation(membershipId: string, localUserId: number): Promise<void> {
    await this.database()
      .getRepository(PlatformMembership)
      .update({ id: membershipId, status: MembershipStatus.RESERVED }, { status: MembershipStatus.ACTIVE, localUserId });
  }

  async releaseReservation(reservation: MembershipReservation): Promise<void> {
    const repository = this.database().getRepository(PlatformMembership);
    if (reservation.previousStatus) {
      await repository.update(
        { id: reservation.membership.id, status: MembershipStatus.RESERVED },
        { status: reservation.previousStatus },
      );
    } else {
      await repository.delete({ id: reservation.membership.id, status: MembershipStatus.RESERVED });
    }
  }

  async archiveMembership(tenantId: string, userId: number): Promise<void> {
    await this.database()
      .getRepository(PlatformMembership)
      .update({ tenantId, localUserId: userId }, { status: MembershipStatus.ARCHIVED });
  }

  async updateMembershipRole(tenantId: string, userId: number, role: ROLES): Promise<void> {
    await this.database().getRepository(PlatformMembership).update({ tenantId, localUserId: userId }, { role });
  }

  async synchronizeMembership(
    tenantId: string,
    userId: number,
    user: Pick<Users, 'id' | 'email' | 'role' | 'deletedAt'> | null,
    membershipId?: string,
  ): Promise<void> {
    await this.database().transaction(async (manager) => {
      const tenant = await this.lockTenant(manager, tenantId);
      const repository = manager.getRepository(PlatformMembership);
      const membership = await repository.findOneBy(
        membershipId ? { tenantId, id: membershipId } : { tenantId, localUserId: userId },
      );
      if (!membership) throw new ConflictException('Членство для синхронизации не найдено');
      if (membership.localUserId !== null && membership.localUserId !== userId)
        throw new ConflictException('Несовпадение локального пользователя');
      if (!user || user.deletedAt) {
        await repository.update(membership.id, { status: MembershipStatus.ARCHIVED, localUserId: userId });
        return;
      }
      const identity = await manager.getRepository(PlatformIdentity).findOneByOrFail({ id: membership.identityId });
      if (user.id !== userId || user.email.trim().toLowerCase() !== identity.email)
        throw new ConflictException('Несовпадение глобальной учетной записи');
      if (membership.status === MembershipStatus.ARCHIVED && (await this.countSeats(manager, tenantId)) >= tenant.seatLimit)
        throw new ConflictException('Нет свободного места для восстановления членства');
      await repository.update(membership.id, { status: MembershipStatus.ACTIVE, localUserId: userId, role: user.role });
    });
  }

  async listTenants(): Promise<PlatformTenantSummary[]> {
    const tenants = await this.database()
      .getRepository(PlatformTenant)
      .find({ order: { createdAt: 'DESC' } });
    return Promise.all(tenants.map((tenant) => this.summary(tenant)));
  }

  async createTenant(input: CreatePlatformTenantRequest, actor: string): Promise<PlatformTenantSummary> {
    if (RESERVED_SLUGS.has(input.slug)) throw new BadRequestException('Этот поддомен зарезервирован');
    this.validateFlags(input.featureFlags);
    const rootHost = this.config.get<string>('TENANCY_ROOT_DOMAIN') || 'nervion.ru';
    if (!/^[a-z0-9.-]+$/.test(rootHost) || rootHost.includes('..')) throw new BadRequestException('Неверный TENANCY_ROOT_DOMAIN');
    const existing = await this.database().getRepository(PlatformTenant).findOneBy({ slug: input.slug });
    if (existing) throw new ConflictException('Поддомен уже занят');
    const tenant = await this.database().transaction(async (manager) => {
      const id = randomUUID();
      const { identity } = await this.ensureIdentity(
        manager,
        input.admin.email,
        hashIdentityPassword(input.admin.password),
        id,
        input.admin.emailOwnershipVerified === true,
      );
      const paidUntil = input.paidUntil ? new Date(input.paidUntil) : null;
      const row = await manager.getRepository(PlatformTenant).save({
        id,
        slug: input.slug,
        hostname: `${input.slug}.${rootHost}`,
        name: input.name,
        status: TenantStatus.PROVISIONING,
        plan: input.plan,
        seatLimit: input.seatLimit,
        paidUntil,
        graceUntil: paidUntil ? new Date(paidUntil.getTime() + 7 * DAY_MS) : null,
        retentionUntil: null,
        databaseShardId: 'data_1',
        storageNamespace: `tenants/${id}/`,
        featureFlags: input.featureFlags,
        provisioningAdmin: { identityId: identity.id, firstName: input.admin.firstName, lastName: input.admin.lastName },
        provisioningError: null,
      });
      await this.audit(manager, actor, 'tenant.created', id, { slug: input.slug });
      return row;
    });
    return this.provisionTenant(tenant.id, actor);
  }

  async provisionTenant(tenantId: string, actor: string): Promise<PlatformTenantSummary> {
    try {
      await this.database().transaction(async (manager) => {
        const tenant = await this.lockTenant(manager, tenantId);
        if (![TenantStatus.PROVISIONING, TenantStatus.FAILED].includes(tenant.status)) return;
        if (!tenant.provisioningAdmin) throw new ConflictException('Отсутствуют параметры первого администратора');
        const identity = await manager
          .getRepository(PlatformIdentity)
          .findOneByOrFail({ id: tenant.provisioningAdmin.identityId });
        const admin = tenant.provisioningAdmin;
        // Data commits first. Retry finds the same user if a crash occurred before the platform commit.
        const userId = await this.tenantDatabase().run({ ...this.descriptor(tenant), readOnly: false }, async () => {
          await seedTenantDefaults(this.tenantContext().require().manager, tenant.id);
          const users = this.tenantContext().require().manager.getRepository(Users);
          const existing = await users.findOne({ where: { email: identity.email }, withDeleted: true });
          if (existing) {
            if (existing.deletedAt || existing.role !== ROLES.admin)
              throw new ConflictException('Пользователь provisioning имеет неверное состояние');
            return existing.id;
          }
          const user = await users.save(
            users.create({
              email: identity.email,
              first_name: admin.firstName,
              last_name: admin.lastName,
              role: ROLES.admin,
              hashed_password: '',
            }),
          );
          return user.id;
        });
        const members = manager.getRepository(PlatformMembership);
        const existing = await members.findOneBy({ tenantId, identityId: identity.id });
        await members.save({
          id: existing?.id || randomUUID(),
          tenantId,
          identityId: identity.id,
          localUserId: userId,
          role: ROLES.admin,
          status: MembershipStatus.ACTIVE,
        });
        await manager
          .getRepository(PlatformTenant)
          .update(tenantId, { status: TenantStatus.ACTIVE, provisioningError: null, provisioningAdmin: null });
        await this.audit(manager, actor, 'tenant.provisioned', tenantId, {});
      });
    } catch (error) {
      await this.database()
        .getRepository(PlatformTenant)
        .update(
          { id: tenantId, status: In([TenantStatus.PROVISIONING, TenantStatus.FAILED]) },
          {
            status: TenantStatus.FAILED,
            provisioningError: 'Создание пространства не завершено. Исправьте инфраструктуру и повторите provisioning.',
          },
        );
      throw error;
    }
    return this.summary(await this.database().getRepository(PlatformTenant).findOneByOrFail({ id: tenantId }));
  }

  async updateTenant(tenantId: string, input: UpdatePlatformTenantRequest, actor: string): Promise<PlatformTenantSummary> {
    if (input.featureFlags) this.validateFlags(input.featureFlags);
    const tenant = await this.database().transaction(async (manager) => {
      const row = await this.lockTenant(manager, tenantId);
      if (input.status && [TenantStatus.FAILED, TenantStatus.PROVISIONING].includes(row.status))
        throw new ConflictException('Сначала завершите provisioning');
      if (input.seatLimit !== undefined && input.seatLimit < (await this.countSeats(manager, tenantId)))
        throw new ConflictException('Лимит меньше числа занятых мест');
      if (input.name !== undefined) row.name = input.name;
      if (input.plan !== undefined) row.plan = input.plan;
      if (input.seatLimit !== undefined) row.seatLimit = input.seatLimit;
      if (input.featureFlags !== undefined) row.featureFlags = input.featureFlags;
      if (input.paidUntil !== undefined) {
        row.paidUntil = input.paidUntil ? new Date(input.paidUntil) : null;
        row.graceUntil = row.paidUntil ? new Date(row.paidUntil.getTime() + 7 * DAY_MS) : null;
      }
      if (input.status !== undefined) {
        if (input.status === TenantStatus.CANCELLED && row.status !== TenantStatus.CANCELLED)
          row.retentionUntil = new Date(Date.now() + 90 * DAY_MS);
        if (input.status !== TenantStatus.CANCELLED) row.retentionUntil = null;
        row.status = input.status;
      }
      await manager.getRepository(PlatformTenant).save(row);
      await this.audit(manager, actor, 'tenant.updated', tenantId, {
        status: row.status,
        plan: row.plan,
        seatLimit: row.seatLimit,
        paidUntil: row.paidUntil?.toISOString() ?? null,
        featureFlags: row.featureFlags,
      });
      return row;
    });
    return this.summary(tenant);
  }

  async reconcileMemberships(tenantId: string, actor: string): Promise<{ reconciled: number }> {
    const tenant = await this.getTenant(tenantId);
    const reservations = await this.database()
      .getRepository(PlatformMembership)
      .findBy({ tenantId, status: In([MembershipStatus.RESERVED, MembershipStatus.ACTIVE]) });
    let reconciled = 0;
    for (const reservation of reservations) {
      // Do not race a live HTTP transaction. No automatic deletion of users or identities.
      if (Date.now() - reservation.updatedAt.getTime() < 15 * 60 * 1000) continue;
      const identity = await this.database().getRepository(PlatformIdentity).findOneByOrFail({ id: reservation.identityId });
      const user = await this.tenantDatabase().run(
        { ...tenant, readOnly: true },
        () => {
          const query = this.tenantContext().require().manager.getRepository(Users).createQueryBuilder('user');
          return reservation.localUserId
            ? query.where('user.id = :id', { id: reservation.localUserId }).getOne()
            : query.where('lower(user.email) = :email', { email: identity.email }).getOne();
        },
        { readOnly: true },
      );
      if (user)
        await this.database()
          .getRepository(PlatformMembership)
          .update(
            { id: reservation.id, status: reservation.status },
            { status: MembershipStatus.ACTIVE, localUserId: user.id, role: user.role },
          );
      else
        await this.database()
          .getRepository(PlatformMembership)
          .update({ id: reservation.id, status: reservation.status }, { status: MembershipStatus.ARCHIVED });
      reconciled++;
    }
    await this.audit(this.database().manager, actor, 'memberships.reconciled', tenantId, { reconciled });
    return { reconciled };
  }

  private tenantDatabase(): TenantDatabaseService {
    return this.moduleRef.get(TenantDatabaseService, { strict: false });
  }
  private tenantContext(): TenantContextService {
    return this.moduleRef.get(TenantContextService, { strict: false });
  }

  private async lockTenant(manager: EntityManager, tenantId: string): Promise<PlatformTenant> {
    const tenant = await manager
      .getRepository(PlatformTenant)
      .findOne({ where: { id: tenantId }, lock: { mode: 'pessimistic_write' } });
    if (!tenant) throw new NotFoundException('Пространство не найдено');
    return tenant;
  }

  private async ensureIdentity(
    manager: EntityManager,
    email: string,
    passwordHash: string,
    tenantId: string,
    verifiedByOperator = false,
  ): Promise<{ identity: PlatformIdentity; created: boolean }> {
    const normalized = email.trim().toLowerCase();
    // Serializes same-email creation in different tenants without resetting existing credentials.
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`identity:${normalized}`]);
    const repository = manager.getRepository(PlatformIdentity);
    const existing = await repository.findOneBy({ email: normalized });
    if (existing) {
      if (!existing.emailVerifiedAt && existing.credentialOriginTenantId !== tenantId)
        throw new ConflictException(
          'Email создан в другом пространстве и не подтвержден. Администратор платформы должен проверить владение и заменить первоначальный пароль.',
        );
      return { identity: existing, created: false };
    }
    return {
      identity: await repository.save({
        id: randomUUID(),
        email: normalized,
        passwordHash,
        credentialOriginTenantId: tenantId,
        emailVerifiedAt: verifiedByOperator ? new Date() : null,
        sessionVersion: 1,
        mfaSettings: {},
      }),
      created: true,
    };
  }

  private countSeats(manager: EntityManager, tenantId: string): Promise<number> {
    return manager
      .getRepository(PlatformMembership)
      .countBy({ tenantId, status: In([MembershipStatus.ACTIVE, MembershipStatus.RESERVED]) });
  }

  private assertAccessible(tenant: PlatformTenant): void {
    if (![TenantStatus.ACTIVE, TenantStatus.READ_ONLY, TenantStatus.CANCELLED].includes(tenant.status))
      throw new ForbiddenException('Пространство недоступно');
  }

  private descriptor(tenant: PlatformTenant): TenantDescriptor {
    const expired = !!tenant.graceUntil && tenant.graceUntil.getTime() <= Date.now();
    return {
      id: tenant.id,
      slug: tenant.slug,
      hostname: tenant.hostname,
      status: tenant.status,
      databaseShardId: tenant.databaseShardId,
      storageNamespace: tenant.storageNamespace,
      featureFlags: tenant.featureFlags,
      readOnly: expired || tenant.status === TenantStatus.READ_ONLY || tenant.status === TenantStatus.CANCELLED,
    };
  }

  private async summary(tenant: PlatformTenant): Promise<PlatformTenantSummary> {
    return {
      ...this.descriptor(tenant),
      name: tenant.name,
      plan: tenant.plan,
      seatLimit: tenant.seatLimit,
      activeSeats: await this.countSeats(this.database().manager, tenant.id),
      paidUntil: tenant.paidUntil?.toISOString() ?? null,
      graceUntil: tenant.graceUntil?.toISOString() ?? null,
      retentionUntil: tenant.retentionUntil?.toISOString() ?? null,
      provisioningError: tenant.provisioningError,
      createdAt: tenant.createdAt.toISOString(),
    };
  }

  private validateFlags(flags: Record<string, boolean>): void {
    if (Object.entries(flags).some(([key, value]) => !/^[a-z][a-z0-9_]{0,63}$/.test(key) || typeof value !== 'boolean'))
      throw new BadRequestException('Некорректные настройки функций');
  }

  private async audit(
    manager: EntityManager,
    actor: string,
    action: string,
    tenantId: string,
    details: PlatformAuditDetails,
  ): Promise<void> {
    await manager.getRepository(PlatformAudit).insert({ actor, action, tenantId, details });
  }
}
