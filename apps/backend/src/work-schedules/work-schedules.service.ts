import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkSchedules } from './entities/work-schedule.entity';
import { CreateWorkScheduleDto } from './dto/create-work-schedule.dto';
import { UpdateWorkScheduleDto } from './dto/update-work-schedule.dto';
import { GetWorkSchedulesDto } from './dto/get-work-schedules.dto';
import { Users } from '../users/entities/users.entity';
import { ProjectMembers } from '../projects/entities/project.entity';
import { ROLES } from '../common/enums/roles.enum';
import { AuthenticatedUser } from '../auth/types/authenticated-user';

@Injectable()
export class WorkSchedulesService {
  constructor(
    @InjectRepository(WorkSchedules)
    private readonly repo: Repository<WorkSchedules>,
    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,
    @InjectRepository(ProjectMembers)
    private readonly projectMembersRepo: Repository<ProjectMembers>,
  ) {}

  async create(dto: CreateWorkScheduleDto, currentUser: AuthenticatedUser): Promise<WorkSchedules> {
    const targetUserId = currentUser.role === ROLES.admin ? dto.user_id : currentUser.id;
    const schedule = this.repo.create({ ...dto, user_id: targetUserId });
    const saved = await this.repo.save(schedule);
    return this.findOne(saved.id);
  }

  async findAll(filters: GetWorkSchedulesDto, currentUser: AuthenticatedUser): Promise<WorkSchedules[]> {
    const query = this.repo.createQueryBuilder('ws').leftJoinAndSelect('ws.user', 'user');

    if (currentUser.role !== ROLES.admin) {
      const userIds = await this.getAccessibleUserIds(currentUser);
      query.andWhere('ws.user_id IN (:...userIds)', { userIds });
    } else if (filters.user_id) {
      query.andWhere('ws.user_id = :uid', { uid: filters.user_id });
    }

    if (filters.start_date && filters.end_date) {
      query.andWhere('ws.work_date BETWEEN :start AND :end', {
        start: filters.start_date,
        end: filters.end_date,
      });
    } else if (filters.start_date) {
      query.andWhere('ws.work_date >= :start', { start: filters.start_date });
    } else if (filters.end_date) {
      query.andWhere('ws.work_date <= :end', { end: filters.end_date });
    }

    query.orderBy('ws.work_date', 'ASC').addOrderBy('ws.start_time', 'ASC');

    return query.getMany();
  }

  async findVisibleUsers(currentUser: AuthenticatedUser): Promise<Users[]> {
    const query = this.usersRepo
      .createQueryBuilder('user')
      .where('user.deleted_at IS NULL')
      .orderBy('user.first_name', 'ASC')
      .addOrderBy('user.last_name', 'ASC');

    if (currentUser.role !== ROLES.admin) {
      const userIds = await this.getAccessibleUserIds(currentUser);
      query.andWhere('user.id IN (:...userIds)', { userIds });
    }

    return query.getMany();
  }

  async findOne(id: number): Promise<WorkSchedules> {
    const schedule = await this.repo.findOne({ where: { id }, relations: ['user'] });
    if (!schedule) throw new NotFoundException(`WorkSchedule #${id} not found`);
    return schedule;
  }

  async update(id: number, dto: UpdateWorkScheduleDto, currentUser: AuthenticatedUser): Promise<WorkSchedules> {
    const schedule = await this.findOne(id);
    this.assertCanModify(schedule, currentUser);
    Object.assign(schedule, dto);
    return this.repo.save(schedule);
  }

  async remove(id: number, currentUser: AuthenticatedUser): Promise<void> {
    const schedule = await this.findOne(id);
    this.assertCanModify(schedule, currentUser);
    await this.repo.remove(schedule);
  }

  private assertCanModify(schedule: WorkSchedules, currentUser: AuthenticatedUser): void {
    if (currentUser.role !== ROLES.admin && schedule.user_id !== currentUser.id) {
      throw new ForbiddenException('Нельзя редактировать расписание другого сотрудника');
    }
  }

  private async getAccessibleUserIds(currentUser: AuthenticatedUser): Promise<number[]> {
    const myMemberships = await this.projectMembersRepo.find({
      where: { user: { id: currentUser.id } },
      relations: ['project'],
    });
    const projectIds = myMemberships.map((membership) => membership.project.id);

    if (!projectIds.length) {
      return [currentUser.id];
    }

    const colleagueIds = await this.projectMembersRepo
      .createQueryBuilder('pm')
      .select('DISTINCT pm.user_id', 'user_id')
      .where('pm.project_id IN (:...projectIds)', { projectIds })
      .getRawMany<{ user_id: number }>();

    return colleagueIds.map((row) => row.user_id);
  }
}
