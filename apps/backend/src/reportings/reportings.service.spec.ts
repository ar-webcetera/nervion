import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TIMELOG_STATUSES } from '../common/enums/statuses.enum';
import { Timelogs } from '../timelogs/entities/timelog.entity';
import { Tasks } from '../tasks/entities/task.entity';
import { ReportingsService } from './reportings.service';

describe('ReportingsService', () => {
  let service: ReportingsService;

  const timelogRepository = {
    find: jest.fn(),
  };
  const tasksRepository = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportingsService,
        { provide: getRepositoryToken(Timelogs), useValue: timelogRepository },
        { provide: getRepositoryToken(Tasks), useValue: tasksRepository },
      ],
    }).compile();

    service = module.get(ReportingsService);
    jest.clearAllMocks();
  });

  it('включает в отчёт таймлоги по дате завершения, а не по дате старта таймера', async () => {
    timelogRepository.find.mockResolvedValue([
      {
        id: 1,
        author_id: 6,
        time_spent: 3600,
        summary: 'Сделал отчёт',
        tracking_date: null,
        created_at: new Date('2026-06-20T10:00:00.000Z'),
        updated_at: new Date('2026-07-01T15:30:00.000Z'),
        author: { id: 6, first_name: 'Иван', last_name: 'Иванов' },
        task: { id: 10, title: 'Задача', project: { name: 'Проект' } },
      },
    ]);

    const rows = await service.preview({
      from: '2026-07-01',
      to: '2026-07-01',
      employees: [{ user_id: 6, cost: 1000 }],
      project_id: null,
      executor_id: null,
    });

    expect(timelogRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          updated_at: expect.anything(),
          status: TIMELOG_STATUSES.completed,
        }),
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.date).toMatch(/^01\.07\.2026 \d{2}:\d{2}$/);
    expect(rows[0]?.hours).toBe(1);
    expect(rows[0]?.amount).toBe(1000);
  });
});
