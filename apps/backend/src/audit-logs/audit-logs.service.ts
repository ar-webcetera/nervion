import type { TaskActivityItem, TaskActivityChange, JsonValue } from '@tracker/contracts';
import { Users } from '../users/entities/users.entity';
import { Projects } from '../projects/entities/project.entity';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  AuditActionType,
  type AuditActorPreview,
  AuditEntityType,
  type AuditLogItem,
  type AuditLogsResponse,
  AuditSourceType,
  type JsonObject,
} from '@tracker/contracts';
import { Brackets, In, Repository } from 'typeorm';
import { AuditContextService } from './audit-context.service';
import { GetAuditLogsDto } from './dto/get-audit-logs.dto';
import { AuditLog } from './entities/audit-log.entity';

type AuditPayload = JsonObject | null | undefined;

interface AuditActorInput {
  id?: number | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ENTITY_LABEL_MAX_LENGTH = 255;
const SUMMARY_MAX_LENGTH = 500;
const ACTOR_NAME_MAX_LENGTH = 255;

export interface RecordAuditLogParams {
  actionType: AuditActionType;
  entityType: AuditEntityType;
  summary: string;
  entityId?: string | number | null;
  entityLabel?: string | null;
  actor?: AuditActorInput | null;
  projectId?: number | null;
  taskId?: number | null;
  sourceType?: AuditSourceType;
  beforePayload?: AuditPayload;
  afterPayload?: AuditPayload;
  diffPayload?: AuditPayload;
  metadataPayload?: AuditPayload;
}

@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    private readonly auditContextService: AuditContextService,
  ) {}

  async record(params: RecordAuditLogParams): Promise<void> {
    try {
      const context = this.auditContextService.getState();
      const actor = this.resolveActor(params.actor, context?.actor ?? null);
      const beforePayload = this.clonePayload(params.beforePayload);
      const afterPayload = this.clonePayload(params.afterPayload);
      const diffPayload =
        this.clonePayload(params.diffPayload) ?? this.buildDiff(beforePayload ?? undefined, afterPayload ?? undefined);

      const entity = this.auditLogRepository.create({
        action_type: params.actionType,
        entity_type: params.entityType,
        entity_id: params.entityId !== undefined && params.entityId !== null ? String(params.entityId) : null,
        entity_label: this.truncate(params.entityLabel, ENTITY_LABEL_MAX_LENGTH),
        summary: this.truncate(params.summary, SUMMARY_MAX_LENGTH) ?? params.summary,
        before_payload: beforePayload ?? null,
        after_payload: afterPayload ?? null,
        diff_payload: diffPayload ?? null,
        metadata_payload: this.clonePayload(params.metadataPayload) ?? null,
        source_type: params.sourceType ?? context?.sourceType ?? AuditSourceType.SYSTEM,
        actor_id: actor?.id ?? null,
        actor_name: this.truncate(actor?.name, ACTOR_NAME_MAX_LENGTH),
        project_id: params.projectId ?? null,
        task_id: params.taskId ?? null,
        request_id: context?.requestId ?? null,
        request_method: context?.requestMethod ?? null,
        request_path: context?.requestPath ?? null,
        ip_address: context?.ipAddress ?? null,
        user_agent: context?.userAgent ?? null,
      });

      await this.auditLogRepository.save(entity);
    } catch (error) {
      this.logger.error(`Не удалось сохранить audit log: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async findTaskActivity(taskId: number, includeBilling: boolean): Promise<TaskActivityItem[]> {
    const rows = await this.auditLogRepository.find({
      where: { task_id: taskId, entity_type: AuditEntityType.TASK },
      order: { created_at: 'ASC', id: 'ASC' },
    });
    const userIds = new Set<number>();
    const projectIds = new Set<number>();
    for (const row of rows) {
      for (const payload of [row.before_payload, row.after_payload]) {
        if (typeof payload?.responsible_id === 'number') userIds.add(payload.responsible_id);
        if (typeof payload?.project_id === 'number') projectIds.add(payload.project_id);
      }
    }
    const [users, projects] = await Promise.all([
      userIds.size
        ? this.auditLogRepository.manager.find(Users, {
            where: { id: In([...userIds]) },
            select: ['id', 'first_name', 'last_name'],
          })
        : Promise.resolve<Users[]>([]),
      projectIds.size
        ? this.auditLogRepository.manager.find(Projects, {
            where: { id: In([...projectIds]) },
            select: ['id', 'name'],
          })
        : Promise.resolve<Projects[]>([]),
    ]);
    const names = new Map<number, string>(
      users.map((user): [number, string] => [user.id, `${user.last_name} ${user.first_name}`.trim()]),
    );
    const projectNames = new Map<number, string>(projects.map((project): [number, string] => [project.id, project.name]));
    const fields: Record<string, string> = {
      title: 'Название',
      description: 'Описание',
      status: 'Статус',
      responsible_id: 'Ответственный',
      project_id: 'Проект',
      taskType: 'Тип задачи',
      planned_date: 'Дедлайн',
      story_points: 'Story Points',
      recurrence_days: 'Дни повторения',
      recurrence_since: 'Начало повторения',
      closed_date: 'Дата закрытия',
      ...(includeBilling ? { billing_type: 'Формат оплаты', fixed_price: 'Стоимость' } : {}),
    };
    const formatValue = (field: string, value: JsonValue | undefined): string | null => {
      if (value == null) return null;
      if (field === 'responsible_id' && typeof value === 'number') return names.get(value) ?? `Сотрудник #${value}`;
      if (field === 'project_id' && typeof value === 'number') return projectNames.get(value) ?? `Проект #${value}`;
      return typeof value === 'string' ? value : JSON.stringify(value);
    };
    return rows.map((row) => {
      const changes: TaskActivityChange[] = [];
      if (row.before_payload && row.after_payload) {
        for (const [field, label] of Object.entries(fields)) {
          const before = row.before_payload[field] ?? null;
          const after = row.after_payload[field] ?? null;
          if (JSON.stringify(before) === JSON.stringify(after)) continue;
          changes.push({
            field,
            label,
            before: field === 'description' ? null : formatValue(field, before),
            after: field === 'description' ? null : formatValue(field, after),
          });
        }
      }
      return {
        id: row.id,
        action_type: row.action_type,
        actor_name: row.actor_name || 'Система',
        created_at: row.created_at.toISOString(),
        changes,
      };
    });
  }

  async findAll(dto: GetAuditLogsDto): Promise<AuditLogsResponse> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 25;

    const qb = this.auditLogRepository.createQueryBuilder('audit').leftJoinAndSelect('audit.actor', 'actor');

    if (dto.action_types?.length) {
      qb.andWhere('audit.action_type IN (:...actionTypes)', { actionTypes: dto.action_types });
    }

    if (dto.entity_types?.length) {
      qb.andWhere('audit.entity_type IN (:...entityTypes)', { entityTypes: dto.entity_types });
    }

    if (dto.actor_id) {
      qb.andWhere('audit.actor_id = :actorId', { actorId: dto.actor_id });
    }

    if (dto.project_id) {
      qb.andWhere('audit.project_id = :projectId', { projectId: dto.project_id });
    }

    if (dto.task_id) {
      qb.andWhere('audit.task_id = :taskId', { taskId: dto.task_id });
    }

    if (dto.from) {
      qb.andWhere('audit.created_at >= :fromDate', { fromDate: new Date(dto.from) });
    }

    if (dto.to) {
      const toDate = new Date(dto.to);
      if (!Number.isNaN(toDate.getTime())) {
        if (DATE_ONLY_PATTERN.test(dto.to)) {
          const toDateExclusive = new Date(toDate);
          toDateExclusive.setUTCDate(toDateExclusive.getUTCDate() + 1);
          qb.andWhere('audit.created_at < :toDateExclusive', { toDateExclusive });
        } else {
          qb.andWhere('audit.created_at <= :toDate', { toDate });
        }
      }
    }

    if (dto.search?.trim()) {
      const search = `%${dto.search.trim()}%`;
      qb.andWhere(
        new Brackets((searchQb) => {
          searchQb
            .where('audit.summary ILIKE :search', { search })
            .orWhere('audit.entity_label ILIKE :search', { search })
            .orWhere('audit.actor_name ILIKE :search', { search })
            .orWhere('audit.entity_id ILIKE :search', { search });
        }),
      );
    }

    qb.orderBy('audit.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      items: items.map((item) => this.toAuditLogItem(item)),
      total,
      page,
      limit,
    };
  }

  async findOne(id: number): Promise<AuditLogItem | null> {
    const item = await this.auditLogRepository.findOne({
      where: { id },
      relations: ['actor'],
    });

    return item ? this.toAuditLogItem(item) : null;
  }

  buildDiff(beforePayload?: AuditPayload, afterPayload?: AuditPayload): JsonObject | null {
    if (!beforePayload && !afterPayload) return null;

    const beforeObject = beforePayload ?? {};
    const afterObject = afterPayload ?? {};
    const keys = new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)]);
    const diff: JsonObject = {};

    for (const key of keys) {
      const beforeValue = beforeObject[key];
      const afterValue = afterObject[key];
      if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;
      diff[key] = { before: beforeValue ?? null, after: afterValue ?? null };
    }

    return Object.keys(diff).length ? diff : null;
  }

  private clonePayload(payload: AuditPayload): JsonObject | null {
    if (!payload) return null;
    return JSON.parse(JSON.stringify(payload)) as JsonObject;
  }

  private toAuditLogItem(item: AuditLog): AuditLogItem {
    return {
      id: item.id,
      action_type: item.action_type,
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      entity_label: item.entity_label,
      summary: item.summary,
      before_payload: this.clonePayload(item.before_payload),
      after_payload: this.clonePayload(item.after_payload),
      diff_payload: this.clonePayload(item.diff_payload),
      metadata_payload: this.clonePayload(item.metadata_payload),
      source_type: item.source_type,
      actor_id: item.actor_id,
      actor_name: item.actor_name,
      actor: item.actor ? this.toAuditActorPreview(item.actor) : null,
      project_id: item.project_id,
      task_id: item.task_id,
      request_id: item.request_id,
      request_method: item.request_method,
      request_path: item.request_path,
      ip_address: item.ip_address,
      user_agent: item.user_agent,
      created_at: item.created_at.toISOString(),
    };
  }

  private toAuditActorPreview(actor: {
    id: number;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
  }): AuditActorPreview {
    return {
      id: actor.id,
      email: actor.email,
      first_name: actor.first_name,
      last_name: actor.last_name,
    };
  }

  private resolveActor(actor: AuditActorInput | null | undefined, contextActor: { id: number; name: string } | null) {
    if (actor && actor.id) {
      const fullName = `${actor.last_name || ''} ${actor.first_name || ''}`.trim();
      return {
        id: actor.id,
        name: fullName || actor.email || `User #${actor.id}`,
      };
    }

    return contextActor;
  }

  private truncate(value: string | null | undefined, maxLength: number): string | null {
    if (!value) return null;
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 1)}…`;
  }
}
