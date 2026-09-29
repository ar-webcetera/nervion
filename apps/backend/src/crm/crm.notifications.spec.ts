import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CrmActivityKind, type CrmDealDetail, type JsonObject } from '@tracker/contracts';
import { ROLES } from '../common/enums/roles.enum';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { NotificationsService } from '../notifications/notifications.service';
import { TasksService } from '../tasks/tasks.service';
import { Users } from '../users/entities/users.entity';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { CrmService } from './crm.service';
import { CrmActivityEntity, CrmContactEntity, CrmDealEntity, CrmStageEntity } from './entities/crm.entity';

interface TransactionManagerMock {
  getRepository: jest.Mock;
}

const user = (id: number, firstName: string): Users =>
  ({ id, first_name: firstName, last_name: 'Администратор', role: ROLES.admin }) as Users;

const authenticatedUser = (id: number, firstName: string): AuthenticatedUser => user(id, firstName) as AuthenticatedUser;

const dealDetail = (overrides: Partial<CrmDealDetail> = {}): CrmDealDetail => ({
  id: 41,
  title: 'Новый сайт',
  stage_id: 1,
  amount: null,
  company_id: null,
  contact_ids: [],
  primary_contact_id: null,
  responsible_id: 2,
  source: '',
  expected_close: null,
  project_id: null,
  description: null,
  loss_reason: null,
  created_at: '2026-09-29T00:00:00.000Z',
  updated_at: '2026-09-29T00:00:00.000Z',
  company_name: null,
  responsible_name: 'Борис Администратор',
  next_task: null,
  tasks: [],
  activities: [],
  ...overrides,
});

describe('CrmService notifications', () => {
  const notifications = { createWithEmail: jest.fn().mockResolvedValue({}) };
  const events = { sendCrmChanged: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('webcetera.test') };
  const usersRepository = { existsBy: jest.fn().mockResolvedValue(true), findBy: jest.fn() };
  const activityRepository = { save: jest.fn() };
  const db = { transaction: jest.fn(), getRepository: jest.fn() };
  let service: CrmService;

  beforeEach(async () => {
    jest.clearAllMocks();
    notifications.createWithEmail.mockResolvedValue({});
    config.get.mockReturnValue('webcetera.test');
    usersRepository.existsBy.mockResolvedValue(true);
    db.getRepository.mockImplementation((entity: object) => {
      if (entity === Users) return usersRepository;
      if (entity === CrmActivityEntity) return activityRepository;
      throw new Error('Unexpected repository');
    });

    const module = await Test.createTestingModule({
      providers: [
        CrmService,
        { provide: DataSource, useValue: db },
        { provide: TasksService, useValue: {} },
        { provide: WebsocketGateway, useValue: events },
        { provide: NotificationsService, useValue: notifications },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(CrmService);
  });

  it('notifies the responsible administrator when a deal is created', async () => {
    const dealRepository = {
      create: jest.fn((value: CrmDealEntity) => Object.assign(value, { id: 41 })),
      save: jest.fn().mockImplementation((value: CrmDealEntity) => Promise.resolve(value)),
    };
    const stageRepository = { findOneBy: jest.fn().mockResolvedValue({ id: 1, name: 'Неразобранное' }) };
    const contactRepository = { countBy: jest.fn().mockResolvedValue(0) };
    const manager = {
      getRepository: jest.fn((entity: object) => {
        if (entity === CrmDealEntity) return dealRepository;
        if (entity === CrmStageEntity) return stageRepository;
        if (entity === CrmContactEntity) return contactRepository;
        if (entity === CrmActivityEntity) return activityRepository;
        throw new Error('Unexpected transaction repository');
      }),
    };
    db.transaction.mockImplementation((callback: (transactionManager: TransactionManagerMock) => Promise<object>) =>
      callback(manager),
    );
    jest.spyOn(service, 'detail').mockResolvedValue(dealDetail());

    await service.saveDeal({ title: 'Новый сайт' }, authenticatedUser(2, 'Борис'));

    expect(notifications.createWithEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Новая сделка: Новый сайт',
        recipient_id: 2,
        link: '/crm/deals?deal=41',
      }),
      expect.stringContaining('https://tracker.webcetera.test/crm/deals?deal=41'),
    );
  });

  it('notifies the new responsible administrator after reassignment', async () => {
    const storedDeal = {
      id: 41,
      title: 'Новый сайт',
      stage_id: 1,
      amount: null,
      company_id: null,
      contact_ids: [],
      primary_contact_id: null,
      responsible_id: 1,
      source: '',
      expected_close: null,
      project_id: null,
      description: null,
      loss_reason: null,
      created_at: new Date('2026-09-29T00:00:00.000Z'),
      updated_at: new Date('2026-09-29T00:00:00.000Z'),
    } as CrmDealEntity;
    const dealRepository = {
      findOne: jest.fn().mockResolvedValue(storedDeal),
      save: jest.fn().mockImplementation((value: CrmDealEntity) => Promise.resolve(value)),
    };
    const stageRepository = { findOneBy: jest.fn().mockResolvedValue({ id: 1, name: 'Неразобранное' }) };
    const contactRepository = { countBy: jest.fn().mockResolvedValue(0) };
    const manager = {
      getRepository: jest.fn((entity: object) => {
        if (entity === CrmDealEntity) return dealRepository;
        if (entity === CrmStageEntity) return stageRepository;
        if (entity === CrmContactEntity) return contactRepository;
        if (entity === CrmActivityEntity) return activityRepository;
        throw new Error('Unexpected transaction repository');
      }),
    };
    db.transaction.mockImplementation((callback: (transactionManager: TransactionManagerMock) => Promise<object>) =>
      callback(manager),
    );
    jest.spyOn(service, 'detail').mockResolvedValue(dealDetail());

    await service.saveDeal({ responsible_id: 2 }, authenticatedUser(1, 'Анна'), 41);

    expect(notifications.createWithEmail).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Вам назначена сделка: Новый сайт', recipient_id: 2 }),
      expect.stringContaining('Перейти к сделке'),
    );
  });

  it('notifies the responsible and mentioned admins once, excluding the comment author', async () => {
    const document: JsonObject = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: '2', label: 'Борис' } },
            { type: 'text', text: ' посмотрите расчёт ' },
            { type: 'mention', attrs: { id: '3', label: 'Виктор' } },
            { type: 'mention', attrs: { id: '1', label: 'Анна' } },
          ],
        },
      ],
    };
    activityRepository.save.mockResolvedValue({ id: 7, kind: CrmActivityKind.COMMENT });
    usersRepository.findBy.mockResolvedValue([user(2, 'Борис'), user(3, 'Виктор')]);
    jest.spyOn(service, 'detail').mockResolvedValue(dealDetail());

    await service.comment(41, { message: document }, authenticatedUser(1, 'Анна'));
    await Promise.resolve();
    await Promise.resolve();

    expect(notifications.createWithEmail).toHaveBeenCalledTimes(2);
    expect(notifications.createWithEmail).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Анна Администратор отметил вас в сделке: Новый сайт', recipient_id: 2 }),
      expect.stringContaining('@Борис посмотрите расчёт @Виктор @Анна'),
    );
    expect(notifications.createWithEmail).toHaveBeenCalledWith(expect.objectContaining({ recipient_id: 3 }), expect.any(String));
    expect(notifications.createWithEmail).not.toHaveBeenCalledWith(
      expect.objectContaining({ recipient_id: 1 }),
      expect.any(String),
    );
  });

  it('always notifies the responsible admin about a comment without mentions', async () => {
    const document: JsonObject = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Добавил новые условия' }] }],
    };
    activityRepository.save.mockResolvedValue({ id: 8, kind: CrmActivityKind.COMMENT });
    usersRepository.findBy.mockResolvedValue([user(2, 'Борис')]);
    jest.spyOn(service, 'detail').mockResolvedValue(dealDetail());

    await service.comment(41, { message: document }, authenticatedUser(1, 'Анна'));
    await Promise.resolve();
    await Promise.resolve();

    expect(usersRepository.findBy).toHaveBeenCalledWith(expect.objectContaining({ role: ROLES.admin }));
    expect(notifications.createWithEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Анна Администратор комментирует сделку: Новый сайт',
        recipient_id: 2,
      }),
      expect.stringContaining('Добавил новые условия'),
    );
  });
});
