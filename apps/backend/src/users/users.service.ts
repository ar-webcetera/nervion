import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
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

@Injectable()
export class UsersService {
  constructor(
    private readonly authService: AuthService,
    @InjectRepository(Users)
    private readonly userRepository: Repository<Users>,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async createUser(userInfo: CreateUserDto, currentUser?: AuthenticatedUser) {
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
    await this.userRepository.restore(id);
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
}
