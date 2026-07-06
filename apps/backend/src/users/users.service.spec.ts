import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Users } from './entities/users.entity';
import { AuthService } from '../auth/auth.service';
import { ROLES } from '../common/enums/roles.enum';
import { HttpException, HttpStatus } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

type QueryBuilderMock = {
  select: jest.Mock<QueryBuilderMock>;
  from: jest.Mock<QueryBuilderMock>;
  where: jest.Mock<QueryBuilderMock>;
  innerJoin: jest.Mock<QueryBuilderMock>;
  distinct: jest.Mock<QueryBuilderMock>;
  getRawMany: jest.Mock<Promise<Array<{ project_id: number }>>, []>;
  getMany: jest.Mock<Promise<Users[]>>;
};

const createQueryBuilderMock = (): QueryBuilderMock => {
  const qb = {} as QueryBuilderMock;
  qb.select = jest.fn(() => qb);
  qb.from = jest.fn(() => qb);
  qb.where = jest.fn(() => qb);
  qb.innerJoin = jest.fn(() => qb);
  qb.distinct = jest.fn(() => qb);
  qb.getRawMany = jest.fn<Promise<Array<{ project_id: number }>>, []>().mockResolvedValue([]);
  qb.getMany = jest.fn<Promise<Users[]>, []>().mockResolvedValue([]);
  return qb;
};

const createUpdateUserDto = (overrides: Partial<UpdateUserDto>): UpdateUserDto => ({
  email: 'ivan@test.com',
  first_name: 'Иван',
  last_name: 'Иванов',
  patronymic: 'Иванович',
  role: ROLES.employee,
  password: '',
  photo_url: '',
  ...overrides,
});

describe('UsersService', () => {
  let service: UsersService;

  const mockUser: Users = {
    id: 1,
    first_name: 'Иван',
    last_name: 'Иванов',
    patronymic: 'Иванович',
    email: 'ivan@test.com',
    photo_url: '',
    telegram_user_id: '',
    yandex_id: null,
    role: ROLES.employee,
    hashed_password: 'hashed',
    project_members: [],
    tasks_assigned: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const qb = createQueryBuilderMock();

  const mockUserRepository = {
    create: jest.fn<Users, [Partial<Users>]>((data) => ({ ...mockUser, ...data })),
    save: jest.fn<Promise<Users>, [Users]>().mockResolvedValue({ ...mockUser, hashed_password: 'hashed' }),
    update: jest.fn<Promise<{ affected: number }>, [number, Partial<Users>]>().mockResolvedValue({ affected: 1 }),
    findOne: jest.fn<Promise<Users | null>, [object]>().mockResolvedValue(mockUser),
    find: jest.fn<Promise<Users[]>, [object]>().mockResolvedValue([mockUser]),
    softDelete: jest.fn<Promise<{ affected: number }>, [number]>().mockResolvedValue({ affected: 1 }),
    restore: jest.fn<Promise<{ affected: number }>, [number]>().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn<QueryBuilderMock, []>(() => qb),
    manager: {
      createQueryBuilder: jest.fn<QueryBuilderMock, []>(() => qb),
    },
  };

  const mockAuthService = {
    generateRandomPassword: jest.fn().mockReturnValue('random123'),
    hashPassword: jest.fn().mockReturnValue('hashed_password'),
  };
  const mockAuditLogsService = {
    record: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(Users), useValue: mockUserRepository },
        { provide: AuthService, useValue: mockAuthService },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
    mockUserRepository.save.mockResolvedValue({ ...mockUser, hashed_password: 'hashed' });
    mockUserRepository.findOne.mockResolvedValue(mockUser);
    mockUserRepository.find.mockResolvedValue([mockUser]);
    mockUserRepository.softDelete.mockResolvedValue({ affected: 1 });
    mockUserRepository.restore.mockResolvedValue({ affected: 1 });
    qb.getRawMany.mockResolvedValue([]);
    qb.getMany.mockResolvedValue([mockUser]);
  });

  describe('archiveUser', () => {
    it('должен вызывать softDelete с переданным id', async () => {
      await service.archiveUser(1);
      expect(mockUserRepository.softDelete).toHaveBeenCalledWith(1);
    });
  });

  describe('restoreUser', () => {
    it('должен вызывать restore и вернуть восстановленного пользователя', async () => {
      const result = await service.restoreUser(1);
      expect(mockUserRepository.restore).toHaveBeenCalledWith(1);
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual(mockUser);
    });
  });

  describe('getArchivedUsers', () => {
    it('должен возвращать только удалённых пользователей', async () => {
      const archivedUser = { ...mockUser, deletedAt: new Date() };
      mockUserRepository.find.mockResolvedValue([archivedUser]);

      const result = await service.getArchivedUsers();

      expect(mockUserRepository.find).toHaveBeenCalledWith(expect.objectContaining({ withDeleted: true }));
      expect(result).toEqual([archivedUser]);
    });
  });

  describe('getUsersByFilter', () => {
    it('должен возвращать всех пользователей для админа', async () => {
      const admin = { ...mockUser, role: ROLES.admin };
      const result = await service.getUsersByFilter(1, admin);
      expect(mockUserRepository.find).toHaveBeenCalledWith({});
      expect(result).toEqual([mockUser]);
    });

    it('должен возвращать только текущего пользователя если у него нет проектов', async () => {
      qb.getRawMany.mockResolvedValue([]);
      const result = await service.getUsersByFilter(1, mockUser);
      expect(result).toEqual([mockUser]);
    });

    it('должен возвращать участников общих проектов для не-админа', async () => {
      qb.getRawMany.mockResolvedValue([{ project_id: 5 }]);
      qb.getMany.mockResolvedValue([mockUser]);
      const result = await service.getUsersByFilter(1, mockUser);
      expect(result).toEqual([mockUser]);
    });
  });

  describe('createUser', () => {
    it('должен создать пользователя и вернуть его без пароля', async () => {
      const dto = {
        email: 'new@test.com',
        first_name: 'Пётр',
        last_name: 'Петров',
        patronymic: '',
        role: ROLES.employee,
      };
      mockUserRepository.create.mockReturnValue({ ...mockUser, email: dto.email });
      mockUserRepository.save.mockResolvedValue({ ...mockUser, email: dto.email, hashed_password: 'hashed' });

      const result = await service.createUser(dto);

      expect(mockUserRepository.create).toHaveBeenCalled();
      expect(result).not.toHaveProperty('hashed_password');
      expect(result).toHaveProperty('password');
    });

    it('должен выбросить HttpException при дублирующемся email', async () => {
      const pgError = Object.create(QueryFailedError.prototype) as QueryFailedError & { code: string };
      pgError.code = '23505';
      mockUserRepository.save.mockRejectedValue(pgError);

      await expect(
        service.createUser({ email: 'dup@test.com', first_name: 'A', last_name: 'B', patronymic: '', role: ROLES.employee }),
      ).rejects.toMatchObject(
        new HttpException({ message: ['Пользователь с таким email уже существует.'] }, HttpStatus.CONFLICT),
      );
    });
  });

  describe('updateUser', () => {
    it('должен обновлять поля пользователя и сохранять сущность', async () => {
      const updatedPhotoUrl = 'https://cdn.test/avatar.png';
      const dto = createUpdateUserDto({
        email: 'updated@test.com',
        first_name: 'Пётр',
        photo_url: updatedPhotoUrl,
      });

      mockUserRepository.findOne.mockResolvedValue({ ...mockUser });
      mockUserRepository.save.mockResolvedValue({
        ...mockUser,
        email: dto.email,
        first_name: dto.first_name,
        photo_url: updatedPhotoUrl,
      });

      const result = await service.updateUser(1, dto);

      expect(mockUserRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          email: dto.email,
          first_name: dto.first_name,
          photo_url: dto.photo_url,
        }),
      );
      expect(result).toMatchObject({
        email: dto.email,
        first_name: dto.first_name,
        photo_url: dto.photo_url,
      });
    });

    it('должен пересоздавать пароль при updateUser(password)', async () => {
      mockUserRepository.findOne.mockResolvedValue({ ...mockUser });

      await service.updateUser(1, createUpdateUserDto({ password: 'secret123' }));

      expect(mockAuthService.generateRandomPassword).toHaveBeenCalledWith(12);
      expect(mockAuthService.hashPassword).toHaveBeenCalledWith('random123');
      expect(mockUserRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          hashed_password: 'hashed_password',
        }),
      );
    });

    it('должен выбрасывать 404, если пользователь не найден', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.updateUser(999, createUpdateUserDto({ first_name: 'Нет' }))).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('должен выбрасывать HttpException при конфликте email в updateUser', async () => {
      const pgError = Object.create(QueryFailedError.prototype) as QueryFailedError & { code: string };
      pgError.code = '23505';

      mockUserRepository.findOne.mockResolvedValue({ ...mockUser });
      mockUserRepository.save.mockRejectedValue(pgError);

      await expect(service.updateUser(1, createUpdateUserDto({ email: 'dup@test.com' }))).rejects.toMatchObject(
        new HttpException({ message: ['Пользователь с таким email уже существует.'] }, HttpStatus.CONFLICT),
      );
    });
  });
});
