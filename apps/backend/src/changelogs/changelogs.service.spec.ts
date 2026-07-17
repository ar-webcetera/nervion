import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChangelogsService } from './changelogs.service';
import { Changelog } from './entities/changelog.entity';
import { ChangelogView } from './entities/changelog-view.entity';
import { Users } from '../users/entities/users.entity';
import { ROLES } from '../common/enums/roles.enum';

type QueryBuilderMock = {
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  getMany: jest.Mock;
};

const createQueryBuilderMock = (result: Changelog[] = []): QueryBuilderMock => {
  const qb = {} as QueryBuilderMock;
  qb.where = jest.fn(() => qb);
  qb.andWhere = jest.fn(() => qb);
  qb.orderBy = jest.fn(() => qb);
  qb.getMany = jest.fn().mockResolvedValue(result);
  return qb;
};

const makeUser = (id = 1): Users => ({ id, role: ROLES.admin, first_name: 'Иван', last_name: 'Иванов' }) as Users;

const makeChangelog = (overrides: Partial<Changelog> = {}): Changelog =>
  ({
    id: 1,
    title: 'v1.0',
    body: null,
    is_published: true,
    author_id: 1,
    author: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  }) as Changelog;

describe('ChangelogsService', () => {
  let service: ChangelogsService;

  const mockChangelogRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((dto) => dto),
    save: jest.fn(),
    remove: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const createViewQueryBuilderMock = (result: { changelog_id: number; count: string }[] = []) => {
    const qb = {
      select: jest.fn(),
      addSelect: jest.fn(),
      groupBy: jest.fn(),
      getRawMany: jest.fn().mockResolvedValue(result),
    };
    qb.select.mockReturnValue(qb);
    qb.addSelect.mockReturnValue(qb);
    qb.groupBy.mockReturnValue(qb);
    return qb;
  };

  const mockChangelogViewRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChangelogsService,
        { provide: getRepositoryToken(Changelog), useValue: mockChangelogRepository },
        { provide: getRepositoryToken(ChangelogView), useValue: mockChangelogViewRepository },
      ],
    }).compile();

    service = module.get<ChangelogsService>(ChangelogsService);
    jest.clearAllMocks();
  });

  it('должен быть определён', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('должен возвращать все changelog-и с views_count', async () => {
      const list = [makeChangelog({ id: 2 }), makeChangelog({ id: 1 })];
      mockChangelogRepository.find.mockResolvedValue(list);
      mockChangelogViewRepository.createQueryBuilder.mockReturnValue(
        createViewQueryBuilderMock([{ changelog_id: 2, count: '3' }]),
      );

      const result = await service.findAll();

      expect(mockChangelogRepository.find).toHaveBeenCalledWith({
        order: { created_at: 'DESC' },
        relations: ['author'],
      });
      expect(result[0]).toMatchObject({ id: 2, views_count: 3 });
      expect(result[1]).toMatchObject({ id: 1, views_count: 0 });
    });
  });

  describe('findUnseen', () => {
    it('должен возвращать опубликованные changelog-и без фильтра по id, если пользователь ничего не просматривал', async () => {
      const user = makeUser(1);
      const qb = createQueryBuilderMock([makeChangelog()]);
      mockChangelogViewRepository.find.mockResolvedValue([]);
      mockChangelogRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findUnseen(user);

      expect(qb.where).toHaveBeenCalledWith('changelog.is_published = true');
      expect(qb.andWhere).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });

    it('должен исключать уже просмотренные changelog-и', async () => {
      const user = makeUser(1);
      const qb = createQueryBuilderMock([]);
      mockChangelogViewRepository.find.mockResolvedValue([{ changelog_id: 1 }, { changelog_id: 2 }]);
      mockChangelogRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findUnseen(user);

      expect(qb.andWhere).toHaveBeenCalledWith('changelog.id NOT IN (:...viewedIds)', { viewedIds: [1, 2] });
    });
  });

  describe('markViewed', () => {
    it('должен сохранять просмотр если его ещё нет', async () => {
      const user = makeUser(1);
      mockChangelogRepository.findOne.mockResolvedValue(makeChangelog({ id: 5 }));
      mockChangelogViewRepository.findOne.mockResolvedValue(null);
      mockChangelogViewRepository.save.mockResolvedValue({});

      const result = await service.markViewed(5, user);

      expect(mockChangelogViewRepository.save).toHaveBeenCalledWith({ user_id: 1, changelog_id: 5 });
      expect(result).toEqual({ ok: true });
    });

    it('не должен дублировать просмотр если он уже существует', async () => {
      const user = makeUser(1);
      mockChangelogRepository.findOne.mockResolvedValue(makeChangelog({ id: 5 }));
      mockChangelogViewRepository.findOne.mockResolvedValue({ id: 10, user_id: 1, changelog_id: 5 });

      const result = await service.markViewed(5, user);

      expect(mockChangelogViewRepository.save).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true });
    });

    it('должен выбрасывать 404 если changelog не найден', async () => {
      mockChangelogRepository.findOne.mockResolvedValue(null);

      await expect(service.markViewed(999, makeUser())).rejects.toThrow(
        new HttpException({ message: ['Changelog не найден'] }, HttpStatus.NOT_FOUND),
      );
    });
  });

  describe('create', () => {
    it('должен создавать changelog с author_id текущего пользователя', async () => {
      const user = makeUser(3);
      const dto = { title: 'v2.0', is_published: false };
      const saved = makeChangelog({ id: 10, title: 'v2.0', author_id: 3 });
      mockChangelogRepository.save.mockResolvedValue(saved);

      const result = await service.create(dto, user);

      expect(mockChangelogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'v2.0', author_id: 3, is_published: false }),
      );
      expect(result).toBe(saved);
    });

    it('должен устанавливать body в null если не передан', async () => {
      const user = makeUser(1);
      const dto = { title: 'v3.0', is_published: true };
      mockChangelogRepository.save.mockResolvedValue(makeChangelog());

      await service.create(dto as any, user);

      expect(mockChangelogRepository.create).toHaveBeenCalledWith(expect.objectContaining({ body: null }));
    });
  });

  describe('update', () => {
    it('должен обновлять поля changelog-а', async () => {
      const existing = makeChangelog({ id: 1, is_published: false });
      mockChangelogRepository.findOne.mockResolvedValue(existing);
      mockChangelogRepository.save.mockResolvedValue({ ...existing, is_published: true });

      const result = await service.update(1, { is_published: true });

      expect(mockChangelogRepository.save).toHaveBeenCalledWith(expect.objectContaining({ is_published: true }));
      expect(result).toMatchObject({ is_published: true });
    });

    it('должен выбрасывать 404 если changelog не найден', async () => {
      mockChangelogRepository.findOne.mockResolvedValue(null);

      await expect(service.update(999, { title: 'X' })).rejects.toThrow(
        new HttpException({ message: ['Changelog не найден'] }, HttpStatus.NOT_FOUND),
      );
    });
  });

  describe('remove', () => {
    it('должен удалять changelog и возвращать { ok: true }', async () => {
      const cl = makeChangelog({ id: 1 });
      mockChangelogRepository.findOne.mockResolvedValue(cl);
      mockChangelogRepository.remove.mockResolvedValue(cl);

      const result = await service.remove(1);

      expect(mockChangelogRepository.remove).toHaveBeenCalledWith(cl);
      expect(result).toEqual({ ok: true });
    });

    it('должен выбрасывать 404 если changelog не найден', async () => {
      mockChangelogRepository.findOne.mockResolvedValue(null);

      await expect(service.remove(999)).rejects.toThrow(
        new HttpException({ message: ['Changelog не найден'] }, HttpStatus.NOT_FOUND),
      );
    });
  });
});
