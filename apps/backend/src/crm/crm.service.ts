import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  CrmActivityKind,
  CrmQuickFilter,
  CrmStageKind,
  TaskBusinessKind,
  type CrmColumn,
  type CrmDeal,
  type CrmDealDetail,
  type CrmOptions,
  type CrmTask,
} from '@tracker/contracts';
import { CrmActivityEntity, CrmCompanyEntity, CrmContactEntity, CrmDealEntity, CrmStageEntity } from './entities/crm.entity';
import {
  CompanyDto,
  ContactDto,
  CrmCommentDto,
  CrmQueryDto,
  CrmTaskDto,
  DealDto,
  UpdateCompanyDto,
  UpdateContactDto,
  UpdateDealDto,
} from './crm.dto';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { Users } from '../users/entities/users.entity';
import { Projects } from '../projects/entities/project.entity';
import { Tasks } from '../tasks/entities/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { TASK_STATUSES } from '../common/enums/statuses.enum';
import { ROLES } from '../common/enums/roles.enum';
import { WebsocketGateway } from '../websocket/websocket.gateway';

@Injectable()
export class CrmService {
  constructor(
    private readonly db: DataSource,
    private readonly tasks: TasksService,
    private readonly events: WebsocketGateway,
  ) {}
  private author(user: AuthenticatedUser): string {
    return `${user.first_name} ${user.last_name}`.trim();
  }
  async options(): Promise<CrmOptions> {
    const [stages, companies, contacts, users, projects, sources, stats] = await Promise.all([
      this.db.getRepository(CrmStageEntity).find({ order: { position: 'ASC' } }),
      this.db.getRepository(CrmCompanyEntity).find({ order: { name: 'ASC' } }),
      this.db.getRepository(CrmContactEntity).find({ order: { name: 'ASC' } }),
      this.db.getRepository(Users).find({ where: { role: ROLES.admin } }),
      this.db.getRepository(Projects).find({ order: { name: 'ASC' } }),
      this.db
        .getRepository(CrmDealEntity)
        .createQueryBuilder('d')
        .select('DISTINCT d.source', 'source')
        .where("d.source <> ''")
        .getRawMany<{ source: string }>(),
      this.db
        .getRepository(CrmDealEntity)
        .createQueryBuilder('d')
        .innerJoin(CrmStageEntity, 's', 's.id = d.stage_id')
        .select('d.company_id', 'id')
        .addSelect('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(d.amount), 0)', 'amount')
        .where("s.kind = 'open' AND d.company_id IS NOT NULL")
        .groupBy('d.company_id')
        .getRawMany<{ id: number; count: string; amount: string }>(),
    ]);
    return {
      company_stats: Object.fromEntries(stats.map((s) => [s.id, { count: Number(s.count), amount: s.amount }])),
      stages,
      companies,
      contacts,
      users: users.map((u) => ({ id: u.id, name: `${u.first_name} ${u.last_name}`.trim() })),
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
      sources: sources.map((s) => s.source),
      loss_reasons: ['Дорого', 'Нет ответа', 'Выбрали конкурента', 'Не наш клиент', 'Отложили', 'Другое'],
    };
  }
  async saveCompany(dto: CompanyDto | UpdateCompanyDto, id?: number) {
    const repo = this.db.getRepository(CrmCompanyEntity);
    const existing = id ? await repo.findOneBy({ id }) : repo.create();
    if (!existing) throw new NotFoundException('Компания не найдена');
    if (dto.responsible_id) await this.admin(dto.responsible_id);
    Object.assign(existing, Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)));
    if (!existing.name?.trim()) throw new BadRequestException('Укажите название компании');
    const result = await repo.save(existing);
    void this.events.sendCrmChanged();
    return result;
  }
  async saveContact(dto: ContactDto | UpdateContactDto, id?: number) {
    const repo = this.db.getRepository(CrmContactEntity);
    const existing = id ? await repo.findOneBy({ id }) : repo.create();
    if (!existing) throw new NotFoundException('Контакт не найден');
    if (dto.company_id && !(await this.db.getRepository(CrmCompanyEntity).existsBy({ id: dto.company_id })))
      throw new BadRequestException('Компания не найдена');
    Object.assign(existing, Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)));
    if (!existing.name?.trim()) throw new BadRequestException('Укажите имя контакта');
    const result = await repo.save(existing);
    void this.events.sendCrmChanged();
    return result;
  }
  private async admin(id: number) {
    if (!(await this.db.getRepository(Users).existsBy({ id, role: ROLES.admin })))
      throw new BadRequestException('Ответственным может быть только администратор');
  }
  private query(q: CrmQueryDto, user: AuthenticatedUser) {
    const qb = this.db.getRepository(CrmDealEntity).createQueryBuilder('d');
    if (q.search) qb.andWhere('d.title ILIKE :search', { search: `%${q.search}%` });
    if (q.company_id) qb.andWhere('d.company_id = :company', { company: q.company_id });
    if (q.contact_id) qb.andWhere(':contact = ANY(d.contact_ids)', { contact: q.contact_id });
    if (q.responsible_id) qb.andWhere('d.responsible_id = :responsible', { responsible: q.responsible_id });
    if (q.source) qb.andWhere('d.source = :source', { source: q.source });
    if (q.quick === CrmQuickFilter.MINE) qb.andWhere('d.responsible_id = :me', { me: user.id });
    const next =
      "SELECT 1 FROM tasks t WHERE t.deal_id = d.id AND t.business_kind = 'sales' AND t.status NOT IN ('closed','archive') AND t.planned_date IS NOT NULL";
    if (q.quick === CrmQuickFilter.UNSCHEDULED) qb.andWhere(`NOT EXISTS (${next})`);
    if (q.quick === CrmQuickFilter.OVERDUE)
      qb.andWhere(`EXISTS (${next} AND t.planned_date < :today)`, { today: q.today ?? new Date().toISOString().slice(0, 10) });
    return qb;
  }
  async board(q: CrmQueryDto, user: AuthenticatedUser): Promise<CrmColumn[]> {
    const stages = await this.db.getRepository(CrmStageEntity).find({ order: { position: 'ASC' } });
    return Promise.all(stages.map((stage) => this.column(stage.id, q, user)));
  }
  async column(id: number, q: CrmQueryDto, user: AuthenticatedUser): Promise<CrmColumn> {
    const stage = await this.db.getRepository(CrmStageEntity).findOneBy({ id });
    if (!stage) throw new NotFoundException('Этап не найден');
    const qb = this.query(q, user).andWhere('d.stage_id = :stage', { stage: id });
    const totals = await qb
      .clone()
      .select('COUNT(*)', 'total')
      .addSelect('COALESCE(SUM(d.amount),0)', 'amount')
      .getRawOne<{ total: string; amount: string }>();
    const deals = await qb.orderBy('d.updated_at', 'DESC').addOrderBy('d.id', 'DESC').skip(q.offset).take(q.limit).getMany();
    return {
      stage,
      total: Number(totals?.total ?? 0),
      amount: totals?.amount ?? '0',
      cards: await this.cards(deals),
      has_more: q.offset + deals.length < Number(totals?.total ?? 0),
    };
  }
  private async cards(deals: CrmDealEntity[]): Promise<CrmDeal[]> {
    if (!deals.length) return [];
    const ids = deals.map((d) => d.id);
    const [tasks, companies, users] = await Promise.all([
      this.db
        .getRepository(Tasks)
        .createQueryBuilder('t')
        .addSelect('t.deal_id')
        .where('t.deal_id IN (:...ids)', { ids })
        .andWhere('t.business_kind = :kind', { kind: TaskBusinessKind.SALES })
        .orderBy('t.planned_date', 'ASC')
        .addOrderBy('t.id', 'ASC')
        .getMany(),
      this.db.getRepository(CrmCompanyEntity).findBy({ id: In(deals.flatMap((d) => (d.company_id ? [d.company_id] : []))) }),
      this.db.getRepository(Users).findBy({ id: In(deals.flatMap((d) => (d.responsible_id ? [d.responsible_id] : []))) }),
    ]);
    return deals.map((d) => {
      const u = users.find((u) => u.id === d.responsible_id);
      return {
        ...d,
        created_at: d.created_at.toISOString(),
        updated_at: d.updated_at.toISOString(),
        company_name: companies.find((c) => c.id === d.company_id)?.name ?? null,
        responsible_name: u ? `${u.first_name} ${u.last_name}`.trim() : null,
        next_task: this.task(
          tasks.find(
            (t) =>
              t.deal_id === d.id && t.planned_date && t.status !== TASK_STATUSES.closed && t.status !== TASK_STATUSES.archive,
          ),
        ),
      };
    });
  }
  private task(t?: Tasks): CrmTask | null {
    return t
      ? {
          id: t.id,
          title: t.title,
          status: t.status,
          business_kind: t.business_kind,
          planned_date: t.planned_date ? String(t.planned_date).slice(0, 10) : null,
        }
      : null;
  }
  async detail(id: number): Promise<CrmDealDetail> {
    const deal = await this.db.getRepository(CrmDealEntity).findOneBy({ id });
    if (!deal) throw new NotFoundException('Сделка не найдена');
    const [cards, tasks, activities] = await Promise.all([
      this.cards([deal]),
      this.db.getRepository(Tasks).find({ where: { deal_id: id }, order: { id: 'DESC' } }),
      this.db.getRepository(CrmActivityEntity).find({ where: { deal_id: id }, order: { created_at: 'ASC', id: 'ASC' } }),
    ]);
    return {
      ...cards[0],
      tasks: tasks.map((t) => this.task(t)!),
      activities: activities.map((a) => ({ ...a, created_at: a.created_at.toISOString() })),
    };
  }
  async saveDeal(dto: DealDto | UpdateDealDto, user: AuthenticatedUser, id?: number) {
    const result = await this.db.transaction(async (m) => {
      const repo = m.getRepository(CrmDealEntity);
      const deal = id
        ? await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } })
        : repo.create({ title: '', stage_id: 1, responsible_id: user.id, contact_ids: [], source: '' });
      if (!deal) throw new NotFoundException('Сделка не найдена');
      const before = { ...deal };
      const { amount, ...fields } = dto;
      Object.assign(deal, Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)));
      if (!deal.title?.trim() || !Array.isArray(deal.contact_ids))
        throw new BadRequestException('Укажите название и корректные контакты сделки');
      if (amount !== undefined) deal.amount = amount === null ? null : String(amount);
      const stage = await m.getRepository(CrmStageEntity).findOneBy({ id: deal.stage_id });
      if (!stage) throw new BadRequestException('Этап не найден');
      if (stage.kind === CrmStageKind.LOST && !deal.loss_reason?.trim())
        throw new BadRequestException('Укажите причину проигрыша');
      if (stage.kind !== CrmStageKind.LOST) deal.loss_reason = null;
      if (deal.responsible_id) await this.admin(deal.responsible_id);
      if (deal.company_id && !(await m.getRepository(CrmCompanyEntity).existsBy({ id: deal.company_id })))
        throw new BadRequestException('Компания не найдена');
      if (deal.project_id && !(await m.getRepository(Projects).existsBy({ id: deal.project_id })))
        throw new BadRequestException('Проект не найден');
      if (deal.contact_ids.length !== (await m.getRepository(CrmContactEntity).countBy({ id: In(deal.contact_ids) })))
        throw new BadRequestException('Контакт не найден');
      if (deal.primary_contact_id && !deal.contact_ids.includes(deal.primary_contact_id))
        throw new BadRequestException('Основной контакт должен быть среди контактов сделки');
      await repo.save(deal);
      const labels: Record<string, string> = {
        title: 'Название',
        stage_id: 'Этап',
        amount: 'Сумма',
        company_id: 'Компания',
        contact_ids: 'Контакты',
        primary_contact_id: 'Основной контакт',
        responsible_id: 'Ответственный',
        source: 'Источник',
        expected_close: 'Дата закрытия',
        project_id: 'Проект',
        description: 'Описание',
        loss_reason: 'Причина проигрыша',
      };
      const changed = (Object.keys(dto) as (keyof UpdateDealDto)[])
        .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(deal[k]))
        .map((k) => labels[k]);
      if (!id || changed.length)
        await this.activity(
          m,
          deal.id,
          user,
          id
            ? `Изменены: ${changed.join(', ')}${before.stage_id !== deal.stage_id ? `. Новый этап: ${stage.name}` : ''}`
            : 'Создана сделка',
        );
      return deal.id;
    });
    void this.events.sendCrmChanged();
    return this.detail(result);
  }
  private async activity(m: EntityManager, id: number, user: AuthenticatedUser, summary: string) {
    await m
      .getRepository(CrmActivityEntity)
      .save({ deal_id: id, kind: CrmActivityKind.CHANGE, summary, author_name: this.author(user) });
  }
  async comment(id: number, dto: CrmCommentDto, user: AuthenticatedUser) {
    await this.detail(id);
    const result = await this.db
      .getRepository(CrmActivityEntity)
      .save({ deal_id: id, kind: CrmActivityKind.COMMENT, message: dto.message, summary: '', author_name: this.author(user) });
    void this.events.sendCrmChanged();
    return result;
  }
  async createTask(id: number, dto: CrmTaskDto, user: AuthenticatedUser) {
    await this.detail(id);
    return this.tasks.createTask(
      {
        ...dto,
        responsible_id: dto.responsible_id ?? user.id,
        business_kind: TaskBusinessKind.SALES,
        deal_id: id,
        status: TASK_STATUSES.to_do,
      } as import('../tasks/dto/create-task.dto').CreateTaskDto,
      user,
    );
  }
  async linkTask(id: number, taskId: number, user: AuthenticatedUser) {
    await this.detail(id);
    return this.tasks.updateTask(String(taskId), { deal_id: id } as import('../tasks/dto/update-task.dto').UpdateTaskDto, user);
  }
  async createProject(id: number, user: AuthenticatedUser) {
    const result = await this.db.transaction(async (m) => {
      const deal = await m.getRepository(CrmDealEntity).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!deal) throw new NotFoundException('Сделка не найдена');
      const stage = await m.getRepository(CrmStageEntity).findOneBy({ id: deal.stage_id });
      if (stage?.kind !== CrmStageKind.WON) throw new BadRequestException('Сначала завершите сделку успешно');
      if (deal.project_id) return { id: deal.project_id };
      const nameExists = await m.getRepository(Projects).existsBy({ name: deal.title });
      const project = await m.getRepository(Projects).save(
        m.getRepository(Projects).create({
          name: nameExists ? `${deal.title} · CRM-${deal.id}` : deal.title,
          budget: Number(deal.amount ?? 0),
          description: deal.description ?? { type: 'doc', content: [] },
        }),
      );
      deal.project_id = project.id;
      await m.getRepository(CrmDealEntity).save(deal);
      await this.activity(m, id, user, `Создан проект «${project.name}»`);
      return { id: project.id };
    });
    void this.events.sendCrmChanged();
    return result;
  }
}
