import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditActionType, AuditEntityType } from '@tracker/contracts';
import { In } from 'typeorm';
import { AuditLogsService } from './audit-logs.service';
import { AuditContextService } from './audit-context.service';
import { AuditLog } from './entities/audit-log.entity';

describe('Task activity projection', () => {
  it('returns a safe chronological projection and hides billing fields for employees', async () => {
    const row = Object.assign(new AuditLog(), {
      id: 3,
      action_type: AuditActionType.TASK_UPDATED,
      entity_type: AuditEntityType.TASK,
      actor_name: 'Андрей',
      created_at: new Date('2026-09-05T10:00:00Z'),
      before_payload: { title: 'До', fixed_price: 100, description: '<p>До</p>', secret: 'private' },
      after_payload: { title: 'После', fixed_price: 200, description: '<p>После</p>', secret: 'changed' },
      ip_address: 'private',
      metadata_payload: { token: 'private' },
    });
    const find = jest.fn().mockResolvedValue([row]);
    const module = await Test.createTestingModule({
      providers: [
        AuditLogsService,
        AuditContextService,
        { provide: getRepositoryToken(AuditLog), useValue: { find, manager: { find: jest.fn() } } },
      ],
    }).compile();
    const service = module.get(AuditLogsService);
    const activity = await service.findTaskActivity(12, false);
    expect(find).toHaveBeenCalledWith({
      where: [
        { task_id: 12, entity_type: AuditEntityType.TASK },
        {
          task_id: 12,
          entity_type: AuditEntityType.TIMELOG,
          action_type: In([AuditActionType.TIMELOG_CREATED, AuditActionType.TIMELOG_UPDATED]),
        },
      ],
      order: { created_at: 'ASC', id: 'ASC' },
    });
    expect(activity).toEqual([
      {
        id: 3,
        action_type: AuditActionType.TASK_UPDATED,
        actor_name: 'Андрей',
        created_at: '2026-09-05T10:00:00.000Z',
        changes: [
          { field: 'title', label: 'Название', before: 'До', after: 'После' },
          { field: 'description', label: 'Описание', before: null, after: null },
        ],
        timelog: null,
      },
    ]);
    expect((await service.findTaskActivity(12, true))[0].changes).toContainEqual({
      field: 'fixed_price',
      label: 'Стоимость',
      before: '100',
      after: '200',
    });
  });

  it('adds a completed timelog with its duration and summary to task activity', async () => {
    const row = Object.assign(new AuditLog(), {
      id: 4,
      action_type: AuditActionType.TIMELOG_CREATED,
      entity_type: AuditEntityType.TIMELOG,
      actor_name: 'Андрей',
      created_at: new Date('2026-10-22T10:00:00Z'),
      before_payload: null,
      after_payload: {
        status: 'completed',
        time_spent: 2700,
        summary: 'Подготовил отчет',
        tracking_date: '2026-10-22',
      },
    });
    const module = await Test.createTestingModule({
      providers: [
        AuditLogsService,
        AuditContextService,
        {
          provide: getRepositoryToken(AuditLog),
          useValue: { find: jest.fn().mockResolvedValue([row]), manager: { find: jest.fn() } },
        },
      ],
    }).compile();

    await expect(module.get(AuditLogsService).findTaskActivity(12, false)).resolves.toEqual([
      {
        id: 4,
        action_type: AuditActionType.TIMELOG_CREATED,
        actor_name: 'Андрей',
        created_at: '2026-10-22T10:00:00.000Z',
        changes: [],
        timelog: {
          time_spent: 2700,
          summary: 'Подготовил отчет',
          tracking_date: '2026-10-22',
        },
      },
    ]);
  });
});
