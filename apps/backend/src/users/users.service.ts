import { ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditActionType, AuditEntityType } from '@tracker/contracts';
import { Users } from './entities/users.entity';
import { IsNull, Not, QueryFailedError, Repository } from 'typeorm';

interface PostgresError extends QueryFailedError {
  code: string;
}
import { CreateUserDto } from './dto/create-user.dto';
import { AuthService } from '../auth/auth.service';
import { ROLES } from '../common/enums/roles.enum';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PlatformService } from '../platform/platform.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { TenantJobsService } from '../tenancy/tenant-jobs.service';
import { randomUUID } from 'crypto';

@Injectable()
export class UsersService {
  constructor(
    private readonly authService: AuthService,
    @InjectRepository(Users)
    private readonly userRepository: Repository<Users>,
    private readonly auditLogsService: AuditLogsService,
    private readonly platform: PlatformService,
    private readonly tenantContext: TenantContextService,
    private readonly tenantJobs: TenantJobsService,
  ) {}

  async createUser(userInfo: CreateUserDto, currentUser?: AuthenticatedUser) {
    if (this.tenantContext.isEnabled()) return this.createTenantUser(userInfo, currentUser);
    try {
      const plainPassword = userInfo.password || this.authService.generateRandomPassword(12);
      const hashedPassword = this.authService.hashPassword(plainPassword);

      const user = this.userRepository.create({
        email: userInfo.email,
        role: userInfo.role || ROLES.guest,
        first_name: userInfo.first_name,
        last_name: userInfo.last_name,
        patronymic: userInfo.patronymic,
        hashed_password: hashedPassword,
      });

      const savedUser = await this.userRepository.save(user);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { hashed_password, ...result } = savedUser;
      void this.auditLogsService.record({
        actionType: AuditActionType.USER_CREATED,
        entityType: AuditEntityType.USER,
        entityId: savedUser.id,
        entityLabel: savedUser.email,
        actor: currentUser,
        summary: `Создан пользователь "${savedUser.email}"`,
        afterPayload: this.serializeUserForAudit(savedUser),
      });
      return { ...result, password: plainPassword };
    } catch (error) {
      if (error instanceof QueryFailedError && (error as PostgresError).code === '23505') {
        throw new HttpException(
          {
            message: ['Пользователь с таким email уже существует.'],
          },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }
  async updateMenuSettings(userId: number, hiddenMenuItems: string[]) {
    const items = Array.isArray(hiddenMenuItems) ? hiddenMenuItems.filter((item) => typeof item === 'string') : [];
    await this.userRepository.update(userId, { hidden_menu_items: items });
    return { hidden_menu_items: items };
  }

  async updateUser(id: number, updateUserDto: UpdateUserDto, currentUser?: AuthenticatedUser) {
    if (this.tenantContext.isEnabled() && (updateUserDto.email || updateUserDto.password)) {
      const current = await this.userRepository.findOneBy({ id });
      if (
        updateUserDto.password ||
        (updateUserDto.email && current?.email.toLowerCase() !== updateUserDto.email.trim().toLowerCase())
      ) {
        throw new ForbiddenException('Глобальные email и пароль изменяются владельцем учетной записи');
      }
    }
    try {
      const user = await this.userRepository.findOne({ where: { id } });
      if (!user) {
        throw new HttpException(
          {
            message: ['Пользователь не найден.'],
          },
          HttpStatus.NOT_FOUND,
        );
      }

      const beforePayload = this.serializeUserForAudit(user);
      if (updateUserDto.email) user.email = updateUserDto.email;
      if (updateUserDto.role) user.role = updateUserDto.role;
      if (updateUserDto.first_name) user.first_name = updateUserDto.first_name;
      if (updateUserDto.last_name) user.last_name = updateUserDto.last_name;
      if (updateUserDto.patronymic !== undefined) user.patronymic = updateUserDto.patronymic;
      if (updateUserDto.photo_url !== undefined) user.photo_url = updateUserDto.photo_url;
      if (updateUserDto.password) {
        const plainPassword = this.authService.generateRandomPassword(12);
        const hashedPassword = this.authService.hashPassword(plainPassword);
        user.hashed_password = hashedPassword;
      }

      const updatedUser = await this.userRepository.save(user);
      if (this.tenantContext.isEnabled() && updateUserDto.role) {
        const execution = this.tenantContext.require();
        await this.scheduleMembershipSync(id);
        execution.afterCommit.push(() => this.platform.updateMembershipRole(execution.tenant.id, id, updatedUser.role));
      }
      void this.auditLogsService.record({
        actionType: AuditActionType.USER_UPDATED,
        entityType: AuditEntityType.USER,
        entityId: updatedUser.id,
        entityLabel: updatedUser.email,
        actor: currentUser,
        summary: `Обновлен пользователь "${updatedUser.email}"`,
        beforePayload,
        afterPayload: this.serializeUserForAudit(updatedUser),
      });
      return updatedUser;
    } catch (error) {
      if (error instanceof QueryFailedError && (error as PostgresError).code === '23505') {
        throw new HttpException(
          {
            message: ['Пользователь с таким email уже существует.'],
          },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async archiveUser(id: number, currentUser?: AuthenticatedUser) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new HttpException({ message: ['Пользователь не найден.'] }, HttpStatus.NOT_FOUND);
    }

    await this.userRepository.softDelete(id);
    if (this.tenantContext.isEnabled()) {
      const execution = this.tenantContext.require();
      await this.scheduleMembershipSync(id);
      execution.afterCommit.push(() => this.platform.archiveMembership(execution.tenant.id, id));
    }
    void this.auditLogsService.record({
      actionType: AuditActionType.USER_ARCHIVED,
      entityType: AuditEntityType.USER,
      entityId: user.id,
      entityLabel: user.email,
      actor: currentUser,
      summary: `Архивирован пользователь "${user.email}"`,
      beforePayload: this.serializeUserForAudit(user),
    });
  }

  async restoreUser(id: number, currentUser?: AuthenticatedUser) {
    let membershipId: string | undefined;
    if (this.tenantContext.isEnabled()) {
      const execution = this.tenantContext.require();
      const archived = await this.userRepository.findOne({ where: { id }, withDeleted: true });
      if (!archived) throw new HttpException('Пользователь не найден', HttpStatus.NOT_FOUND);
      if (!archived.deletedAt) return archived;
      const reservation = await this.platform.reserveMembership(execution.tenant.id, archived.email, '', archived.role, id);
      membershipId = reservation.membership.id;
      execution.afterRollback.push(() => this.platform.releaseReservation(reservation));
      execution.afterCommit.push(() => this.platform.activateReservation(reservation.membership.id, id));
    }
    await this.userRepository.restore(id);
    await this.scheduleMembershipSync(id, membershipId);
    const restoredUser = await this.userRepository.findOne({ where: { id } });
    if (restoredUser) {
      void this.auditLogsService.record({
        actionType: AuditActionType.USER_RESTORED,
        entityType: AuditEntityType.USER,
        entityId: restoredUser.id,
        entityLabel: restoredUser.email,
        actor: currentUser,
        summary: `Восстановлен пользователь "${restoredUser.email}"`,
        afterPayload: this.serializeUserForAudit(restoredUser),
      });
    }
    return restoredUser;
  }

  async getArchivedUsers() {
    return this.userRepository.find({ withDeleted: true, where: { deletedAt: Not(IsNull()) } });
  }

  async getUsersByFilter(currentUserId: number, currentUser: AuthenticatedUser) {
    if (currentUser.role === ROLES.admin) {
      return this.userRepository.find({});
    }

    const projectIds = await this.userRepository.manager
      .createQueryBuilder()
      .select('pm.project_id')
      .from('project_members', 'pm')
      .where('pm.user_id = :currentUserId', { currentUserId })
      .getRawMany();

    const projectIdList = projectIds.map((p: { project_id: number }) => p.project_id);

    if (projectIdList.length === 0) {
      return [currentUser];
    }

    const users = await this.userRepository
      .createQueryBuilder('user')
      .innerJoin('user.project_members', 'pm', 'pm.project_id IN (:...projectIdList)', { projectIdList })
      .distinct(true)
      .getMany();

    return users;
  }

  private serializeUserForAudit(user: Partial<Users>) {
    return {
      email: user.email ?? null,
      role: user.role ?? null,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
      patronymic: user.patronymic ?? null,
      photo_url: user.photo_url ?? null,
      deleted_at: user.deletedAt ? new Date(user.deletedAt).toISOString() : null,
    };
  }

  private async createTenantUser(input: CreateUserDto, actor?: AuthenticatedUser) {
    const execution = this.tenantContext.require();
    const email = input.email.trim().toLowerCase();
    const existing = await this.userRepository
      .createQueryBuilder('user')
      .withDeleted()
      .where('lower(user.email) = :email', { email })
      .getOne();
    if (existing)
      throw new HttpException('Пользователь уже существует. Архивного пользователя можно восстановить.', HttpStatus.CONFLICT);
    const plainPassword = input.password || this.authService.generateRandomPassword(16);
    const role = input.role || ROLES.guest;
    const reservation = await this.platform.reserveMembership(
      execution.tenant.id,
      email,
      this.authService.hashPassword(plainPassword),
      role,
    );
    execution.afterRollback.push(() => this.platform.releaseReservation(reservation));
    const user = await this.userRepository.save(
      this.userRepository.create({
        email,
        role,
        first_name: input.first_name,
        last_name: input.last_name,
        patronymic: input.patronymic,
        // Credentials belong to the global identity; a tenant administrator cannot replace them.
        hashed_password: '',
      }),
    );
    await this.scheduleMembershipSync(user.id, reservation.membership.id);
    execution.afterCommit.push(() => this.platform.activateReservation(reservation.membership.id, user.id));
    await this.auditLogsService.record({
      actionType: AuditActionType.USER_CREATED,
      entityType: AuditEntityType.USER,
      entityId: user.id,
      entityLabel: user.email,
      actor,
      summary: `Создан пользователь "${user.email}"`,
      afterPayload: this.serializeUserForAudit(user),
    });
    const { hashed_password: _passwordHash, ...publicUser } = user;
    return {
      ...publicUser,
      password: reservation.createdIdentity ? plainPassword : undefined,
      existingIdentity: !reservation.createdIdentity,
    };
  }

  private async scheduleMembershipSync(userId: number, membershipId?: string): Promise<void> {
    if (!this.tenantContext.isEnabled()) return;
    await this.tenantJobs.enqueue('membership-sync', `membership:${userId}:${randomUUID()}`, {
      userId,
      ...(membershipId ? { membershipId } : {}),
    });
  }
}
