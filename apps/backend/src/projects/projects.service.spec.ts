import { Repository } from 'typeorm';
import { PROJECT_STATUSES } from '../common/enums/project-status.enum';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Timelogs } from '../timelogs/entities/timelog.entity';
import { ProjectMembers, Projects } from './entities/project.entity';
import { ProjectsService } from './projects.service';

type QueryParamValue = string | number;
type QueryParams = Record<string, QueryParamValue>;

type ProjectsQueryBuilderMock = {
  leftJoinAndSelect: jest.Mock<ProjectsQueryBuilderMock, [string, string]>;
  innerJoin: jest.Mock<ProjectsQueryBuilderMock, [string, string]>;
  where: jest.Mock<ProjectsQueryBuilderMock, [string, QueryParams]>;
  andWhere: jest.Mock<ProjectsQueryBuilderMock, [string, QueryParams]>;
  orderBy: jest.Mock<ProjectsQueryBuilderMock, [string, 'ASC' | 'DESC']>;
  getMany: jest.Mock<Promise<Projects[]>, []>;
};

const createProjectsQueryBuilderMock = (): ProjectsQueryBuilderMock => {
  const qb = {} as ProjectsQueryBuilderMock;
  qb.leftJoinAndSelect = jest.fn<ProjectsQueryBuilderMock, [string, string]>(() => qb);
  qb.innerJoin = jest.fn<ProjectsQueryBuilderMock, [string, string]>(() => qb);
  qb.where = jest.fn<ProjectsQueryBuilderMock, [string, QueryParams]>(() => qb);
  qb.andWhere = jest.fn<ProjectsQueryBuilderMock, [string, QueryParams]>(() => qb);
  qb.orderBy = jest.fn<ProjectsQueryBuilderMock, [string, 'ASC' | 'DESC']>(() => qb);
  qb.getMany = jest.fn<Promise<Projects[]>, []>().mockResolvedValue([]);

  return qb;
};

describe('ProjectsService', () => {
  let service: ProjectsService;
  let qb: ProjectsQueryBuilderMock;

  const projectRepository = {
    createQueryBuilder: jest.fn<ProjectsQueryBuilderMock, [string]>(),
  };

  beforeEach(() => {
    qb = createProjectsQueryBuilderMock();
    projectRepository.createQueryBuilder.mockReturnValue(qb);

    service = new ProjectsService(
      projectRepository as unknown as Repository<Projects>,
      {} as unknown as Repository<ProjectMembers>,
      {} as unknown as Repository<Timelogs>,
      { record: jest.fn() } as unknown as AuditLogsService,
    );
  });

  describe('findProjectsByFilter', () => {
    it('должен исключать архивные проекты из общего списка по умолчанию', async () => {
      await service.findProjectsByFilter();

      expect(qb.andWhere).toHaveBeenCalledWith('project.status != :archivedProjectStatus', {
        archivedProjectStatus: PROJECT_STATUSES.ON_HOLD,
      });
    });

    it('должен отдавать архивные проекты в полном списке для страницы проектов', async () => {
      await service.findProjectsByFilter(true);

      expect(qb.andWhere).not.toHaveBeenCalledWith('project.status != :archivedProjectStatus', {
        archivedProjectStatus: PROJECT_STATUSES.ON_HOLD,
      });
    });
  });

  describe('getMyProjects', () => {
    it('должен исключать архивные проекты из списка пользователя по умолчанию', async () => {
      await service.getMyProjects(7);

      expect(qb.where).toHaveBeenCalledWith('pm.user = :user_id', { user_id: 7 });
      expect(qb.andWhere).toHaveBeenCalledWith('project.status != :archivedProjectStatus', {
        archivedProjectStatus: PROJECT_STATUSES.ON_HOLD,
      });
    });

    it('должен отдавать архивные проекты в полном списке пользователя для страницы проектов', async () => {
      await service.getMyProjects(7, true);

      expect(qb.where).toHaveBeenCalledWith('pm.user = :user_id', { user_id: 7 });
      expect(qb.andWhere).not.toHaveBeenCalledWith('project.status != :archivedProjectStatus', {
        archivedProjectStatus: PROJECT_STATUSES.ON_HOLD,
      });
    });
  });
});
