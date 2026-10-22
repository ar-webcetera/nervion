import type { ApplyTaskStages } from '@tracker/contracts';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { randomUUID } from 'crypto';
import { format } from 'date-fns';
import {
  AuditActionType,
  AuditEntityType,
  BillingReviewStatus,
  TaskBillingType,
  TaskBusinessKind,
  TASK_STATUSES,
} from '@tracker/contracts';
import { TaskStageEntity } from './entities/task-stage.entity';
import { Tasks } from './entities/task.entity';
import { FixedRevenue } from '../reportings/entities/fixed-revenue.entity';
import { AuditLog } from '../audit-logs/entities/audit-log.entity';
import { AuthenticatedUser } from '../auth/types/authenticated-user';

@Injectable()
export class TaskStagesService {
  constructor(private readonly db: DataSource) {}

  list() {
    return this.db.getRepository(TaskStageEntity).find({ order: { position: 'ASC', id: 'ASC' } });
  }

  async assertExists(status: string) {
    if (!(await this.db.getRepository(TaskStageEntity).existsBy({ id: status })))
      throw new BadRequestException('Этап удалён. Обновите доску и выберите другой.');
  }

  private async locked<T>(action: (em: EntityManager, stages: TaskStageEntity[]) => Promise<T>, manager?: EntityManager) {
    if (manager)
      return action(manager, await manager.getRepository(TaskStageEntity).find({ order: { position: 'ASC', id: 'ASC' } }));
    return this.db.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock(1792627200)');
      const stages = await em.getRepository(TaskStageEntity).find({ order: { position: 'ASC', id: 'ASC' } });
      return action(em, stages);
    });
  }

  save(title: string, id?: string, afterStageId?: string) {
    return this.locked(async (em, stages) => {
      const existing = id ? stages.find((stage) => stage.id === id) : undefined;
      if (id && !existing) throw new NotFoundException('Этап не найден');
      if (existing?.protected) throw new BadRequestException('Обязательный этап нельзя переименовать');
      if (stages.some((stage) => stage.id !== id && stage.title.toLowerCase() === title.toLowerCase()))
        throw new BadRequestException('Этап с таким названием уже существует');
      if (!id && stages.length >= 100) throw new BadRequestException('Можно создать не более 100 этапов');
      let position = Math.max(-1, ...stages.map((stage) => stage.position)) + 1;
      if (!id && afterStageId !== undefined) {
        const anchor = stages.find((stage) => stage.id === afterStageId);
        if (!anchor) throw new BadRequestException('Этап для вставки удалён. Обновите доску.');
        position = anchor.position + 1;
        await em
          .createQueryBuilder()
          .update(TaskStageEntity)
          .set({ position: () => '"position" + 1' })
          .where('position >= :position', { position })
          .execute();
      }
      return em.save(TaskStageEntity, {
        ...(existing ?? {
          id: `custom_${randomUUID()}`,
          position,
          protected: false,
        }),
        title,
      });
    });
  }

  reorder(ids: string[]) {
    return this.locked(async (em, stages) => {
      if (ids.length !== stages.length || stages.some((stage) => !ids.includes(stage.id)))
        throw new BadRequestException('Состав этапов изменился. Обновите доску.');
      for (const [position, id] of ids.entries()) await em.update(TaskStageEntity, { id }, { position });
      return { success: true };
    });
  }

  applyDraft(draft: ApplyTaskStages, user: AuthenticatedUser) {
    return this.locked(async (em, current) => {
      const snapshot = current.map(({ id, title }) => ({ id, title }));
      if (JSON.stringify(snapshot) !== JSON.stringify(draft.originalStages.map(({ id, title }) => ({ id, title }))))
        throw new ConflictException('Этапы изменены другим пользователем. Отмените изменения и откройте настройку заново.');
      const finalIds = new Set(draft.stages.map((stage) => stage.id));
      if (new Set(draft.stages.map((stage) => stage.title.toLowerCase())).size !== draft.stages.length)
        throw new BadRequestException('Названия этапов не должны повторяться');
      for (const stage of current.filter((stage) => stage.protected)) {
        if (draft.stages.find((item) => item.id === stage.id)?.title !== stage.title)
          throw new BadRequestException('Обязательный этап нельзя удалить или переименовать');
      }
      const removedIds = current.filter((stage) => !finalIds.has(stage.id)).map((stage) => stage.id);
      if (removedIds.length !== draft.removedStages.length || draft.removedStages.some((stage) => !removedIds.includes(stage.id)))
        throw new BadRequestException('Для каждого удаляемого этапа нужно указать перенос задач');
      for (const removed of draft.removedStages) {
        if (removed.targetStatus && !finalIds.has(removed.targetStatus))
          throw new BadRequestException('Этап для переноса задач должен остаться на доске');
      }
      const ids = new Map(current.map((stage) => [stage.id, stage.id]));
      for (const stage of draft.stages) {
        if (ids.has(stage.id)) continue;
        if (!/^draft_[0-9a-f-]{36}$/.test(stage.id)) throw new BadRequestException('Некорректный ключ нового этапа');
        const id = `custom_${randomUUID()}`;
        ids.set(stage.id, id);
        await em.save(TaskStageEntity, { id, title: `draft_${randomUUID()}`, position: current.length, protected: false });
      }
      // All task transfers, billing entries, filters and stage changes share this transaction.
      for (const removed of draft.removedStages)
        await this.remove(removed.id, removed.targetStatus ? ids.get(removed.targetStatus) : undefined, user, em);
      // Temporary titles allow swapping names without violating the unique title index.
      for (const stage of draft.stages) {
        const original = current.find((item) => item.id === stage.id);
        if (original && original.title !== stage.title)
          await em.update(TaskStageEntity, { id: original.id }, { title: `draft_${randomUUID()}` });
      }
      for (const [position, stage] of draft.stages.entries())
        await em.update(TaskStageEntity, { id: ids.get(stage.id)! }, { title: stage.title, position });
      return em.getRepository(TaskStageEntity).find({ order: { position: 'ASC', id: 'ASC' } });
    });
  }

  async count(id: string) {
    await this.assertExists(id);
    return { total: await this.db.getRepository(Tasks).countBy({ status: id, business_kind: TaskBusinessKind.PRODUCTION }) };
  }

  remove(id: string, targetStatus: string | undefined, user: AuthenticatedUser, manager?: EntityManager) {
    return this.locked(async (em, stages) => {
      const source = await em.findOne(TaskStageEntity, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!source) throw new NotFoundException('Этап не найден');
      if (source.protected) throw new BadRequestException('Обязательный этап нельзя удалить');
      if (targetStatus && (targetStatus === id || !stages.some((stage) => stage.id === targetStatus)))
        throw new BadRequestException('Выберите другой существующий этап');
      const tasks = await em.find(Tasks, {
        where: { status: id, business_kind: TaskBusinessKind.PRODUCTION },
        lock: { mode: 'pessimistic_write' },
      });
      if (tasks.length && !targetStatus) throw new BadRequestException('В этапе есть задачи. Выберите, куда их переместить.');
      const now = new Date();
      for (const task of tasks) {
        const status = targetStatus!;
        await em.update(Tasks, task.id, { status, closed_date: status === String(TASK_STATUSES.closed) ? now : null });
        if (status === String(TASK_STATUSES.closed) && task.billing_type === TaskBillingType.FIXED) {
          const existing = await em.findOne(FixedRevenue, { where: { task_id: task.id, occurrence_date: IsNull() } });
          await em.save(FixedRevenue, {
            ...(existing ?? {}),
            task_id: task.id,
            project_id: task.project_id,
            occurrence_date: null,
            amount: Number(task.fixed_price ?? 0),
            closed_at: now,
            recognized_at: format(now, 'yyyy-MM-dd'),
            status: BillingReviewStatus.PENDING,
            reviewed_at: null,
            reviewed_by_id: null,
          });
        } else {
          await em.delete(FixedRevenue, { task_id: task.id, occurrence_date: IsNull() });
        }
        await em.save(AuditLog, {
          action_type: AuditActionType.TASK_UPDATED,
          entity_type: AuditEntityType.TASK,
          entity_id: String(task.id),
          entity_label: task.title,
          task_id: task.id,
          project_id: task.project_id,
          actor_id: user.id,
          actor_name: `${user.first_name} ${user.last_name}`.trim(),
          summary: `Задача перенесена при удалении этапа "${source.title}"`,
          before_payload: { status: id },
          after_payload: { status },
        });
      }
      await em.delete(TaskStageEntity, { id });
      // Remove stale personal filters so deleted stages cannot hide the whole board.
      await em.query(
        `UPDATE user_task_filters SET task_filters = jsonb_set(task_filters, '{statuses}', (CASE WHEN jsonb_typeof(task_filters->'statuses') = 'array' THEN task_filters->'statuses' ELSE '[]'::jsonb END) - $1::text), collapsed_columns = collapsed_columns - $1::text`,
        [id],
      );
      return { moved: tasks.length };
    }, manager);
  }
}
