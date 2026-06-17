import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditActionType, AuditEntityType } from '@tracker/contracts';
import { QueryFailedError, Repository, SelectQueryBuilder } from 'typeorm';
import { ProjectMembers, Projects } from './entities/project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { Timelogs } from '../timelogs/entities/timelog.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PROJECT_STATUSES } from '../common/enums/project-status.enum';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Projects)
    private readonly projectRepository: Repository<Projects>,
    @InjectRepository(ProjectMembers)
    private readonly projectMemberRepository: Repository<ProjectMembers>,
    @InjectRepository(Timelogs)
    private readonly timelogRepository: Repository<Timelogs>,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private applyActiveProjectScope(qb: SelectQueryBuilder<Projects>, includeArchived: boolean): SelectQueryBuilder<Projects> {
    if (includeArchived) {
      return qb;
    }

    return qb.andWhere('project.status != :archivedProjectStatus', { archivedProjectStatus: PROJECT_STATUSES.ON_HOLD });
  }

  async findProjectsByFilter(includeArchived = false) {
    const qb = this.projectRepository
      .createQueryBuilder('project')
      .leftJoinAndSelect('project.members', 'members')
      .leftJoinAndSelect('members.user', 'user')
      .orderBy('project.createdAt', 'DESC');

    const projects = await this.applyActiveProjectScope(qb, includeArchived).getMany();

    const now = new Date();
    const projectsWithBudget = await Promise.all(
      projects.map(async (project) => {
        const spentBudget = await this.getSpentBudgetForMonth(project.id, now.getFullYear(), now.getMonth() + 1);
        const members = project.members
          .filter((pm) => pm.user)
          .map((pm) => ({
            id: pm.user.id,
            first_name: pm.user.first_name,
            last_name: pm.user.last_name,
            photo_url: pm.user.photo_url,
            email: pm.user.email,
            role: pm.role,
          }));
        return { ...project, spentBudget, members };
      }),
    );

    return projectsWithBudget;
  }

  async getMyProjects(user_id: number, includeArchived = false) {
    const qb = this.projectRepository
      .createQueryBuilder('project')
      .innerJoin('project.members', 'pm')
      .leftJoinAndSelect('project.members', 'members')
      .leftJoinAndSelect('members.user', 'user')
      .where('pm.user = :user_id', { user_id })
      .orderBy('project.createdAt', 'DESC');

    const projects = await this.applyActiveProjectScope(qb, includeArchived).getMany();

    const now = new Date();
    const projectsWithBudget = await Promise.all(
      projects.map(async (project) => {
        const spentBudget = await this.getSpentBudgetForMonth(project.id, now.getFullYear(), now.getMonth() + 1);
        const members = project.members
          .filter((pm) => pm.user)
          .map((pm) => ({
            id: pm.user.id,
            first_name: pm.user.first_name,
            last_name: pm.user.last_name,
            photo_url: pm.user.photo_url,
            email: pm.user.email,
            role: pm.role,
          }));
        return { ...project, spentBudget, members };
      }),
    );

    return projectsWithBudget;
  }

  async checkAccess(user_id: number, project_id: number) {
    const membership = await this.projectMemberRepository.findOne({
      where: {
        user: { id: user_id },
        project: { id: project_id },
      },
    });
    if (!membership) {
      throw new HttpException({ message: ['Доступ к проекту запрещён'] }, HttpStatus.FORBIDDEN);
    }
  }

  async createProject(createProjectDto: CreateProjectDto, currentUser: AuthenticatedUser) {
    try {
      const project = this.projectRepository.create(createProjectDto);
      const createdProject = await this.projectRepository.save(project);
      void this.auditLogsService.record({
        actionType: AuditActionType.PROJECT_CREATED,
        entityType: AuditEntityType.PROJECT,
        entityId: createdProject.id,
        entityLabel: createdProject.name,
        actor: currentUser,
        projectId: createdProject.id,
        summary: `Создан проект "${createdProject.name}"`,
        afterPayload: this.serializeProjectForAudit(createdProject),
      });
      return createdProject;
    } catch (error) {
      if (error instanceof QueryFailedError && (error as QueryFailedError & { code?: string }).code === '23505') {
        throw new HttpException(
          {
            message: ['Проект с таким именем уже существует.'],
          },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async updateProject(id: number, updateProjectDto: UpdateProjectDto, currentUser: AuthenticatedUser) {
    const project = await this.projectRepository.findOneBy({ id });
    if (!project) {
      throw new NotFoundException(`Проект с ID ${id} не найден`);
    }

    const beforePayload = this.serializeProjectForAudit(project);
    Object.assign(project, updateProjectDto);
    const updatedProject = await this.projectRepository.save(project);
    void this.auditLogsService.record({
      actionType: AuditActionType.PROJECT_UPDATED,
      entityType: AuditEntityType.PROJECT,
      entityId: updatedProject.id,
      entityLabel: updatedProject.name,
      actor: currentUser,
      projectId: updatedProject.id,
      summary: `Обновлен проект "${updatedProject.name}"`,
      beforePayload,
      afterPayload: this.serializeProjectForAudit(updatedProject),
    });
    return updatedProject;
  }

  async getSpentBudgetForMonth(projectId: number, year: number, month: number) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const result = await this.timelogRepository
      .createQueryBuilder('timelog')
      .select('SUM(timelog.time_spent)', 'totalMinutes')
      .innerJoin('timelog.task', 'task')
      .where('task.project_id = :projectId', { projectId })
      .andWhere('timelog.created_at >= :startDate', { startDate })
      .andWhere('timelog.created_at <= :endDate', { endDate })
      .getRawOne<{ totalMinutes: string | null }>();

    const project = await this.projectRepository.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException(`Проект с ID ${projectId} не найден`);
    }

    const totalSeconds = parseFloat(result?.totalMinutes ?? '0');
    const totalHours = isNaN(totalSeconds) ? 0 : totalSeconds / 3600;
    const spentBudget = totalHours * project.hourlyRate;

    return spentBudget;
  }

  async deleteProject(id: number, currentUser: AuthenticatedUser) {
    const project = await this.projectRepository.findOneBy({ id });
    if (!project) {
      throw new NotFoundException(`Проект с ID ${id} не найден`);
    }

    await this.projectRepository.remove(project);
    void this.auditLogsService.record({
      actionType: AuditActionType.PROJECT_DELETED,
      entityType: AuditEntityType.PROJECT,
      entityId: id,
      entityLabel: project.name,
      actor: currentUser,
      projectId: id,
      summary: `Удален проект "${project.name}"`,
      beforePayload: this.serializeProjectForAudit(project),
    });
  }

  async updateProjectMembers(projectId: number, members: Array<{ id: number; role: string }>, currentUser: AuthenticatedUser) {
    const project = await this.projectRepository.findOne({
      where: { id: projectId },
      relations: ['members', 'members.user'],
    });

    if (!project) {
      throw new NotFoundException(`Проект с ID ${projectId} не найден`);
    }

    const beforeMembers = project.members.map((member) => ({
      id: member.user?.id ?? null,
      name: member.user ? `${member.user.last_name || ''} ${member.user.first_name || ''}`.trim() : null,
      role: member.role,
      grade: member.grade,
      cost: member.cost,
    }));

    await this.projectMemberRepository.remove(project.members);

    const newMembers = members.map((member) => {
      const projectMember = new ProjectMembers();
      projectMember.user = { id: member.id } as any;
      projectMember.project = project;
      projectMember.role = member.role as any;
      return projectMember;
    });

    await this.projectMemberRepository.save(newMembers);

    const updatedProject = await this.projectRepository.findOne({
      where: { id: projectId },
      relations: ['members', 'members.user'],
    });

    const updatedMembers =
      updatedProject?.members
        .filter((pm) => pm.user)
        .map((pm) => ({
          id: pm.user.id,
          first_name: pm.user.first_name,
          last_name: pm.user.last_name,
          photo_url: pm.user.photo_url,
          email: pm.user.email,
          role: pm.role,
          cost: pm.cost,
        })) || [];

    void this.auditLogsService.record({
      actionType: AuditActionType.PROJECT_MEMBERS_UPDATED,
      entityType: AuditEntityType.PROJECT,
      entityId: projectId,
      entityLabel: project.name,
      actor: currentUser,
      projectId,
      summary: `Обновление участников проекта "${project.name}"`,
      beforePayload: { members: beforeMembers },
      afterPayload: { members: updatedMembers },
    });

    return { message: 'Участники проекта успешно обновлены', members: updatedMembers };
  }

  private serializeProjectForAudit(project: Partial<Projects>) {
    return {
      name: project.name ?? null,
      status: project.status ?? null,
      budget: project.budget ?? 0,
      hourlyRate: project.hourlyRate ?? 0,
    };
  }
}
