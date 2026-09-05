import { WebsocketGateway } from '../websocket/websocket.gateway';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProjectsService } from './projects.service';
import { Projects, ProjectMembers } from './entities/project.entity';
import { Timelogs } from '../timelogs/entities/timelog.entity';
import { QuickLink } from '../quick-links/entities/quick-link.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';

describe('Project deletion', () => {
  it('removes blocking quick links and the project within the same transaction', async () => {
    const project = Object.assign(new Projects(), { id: 12, name: 'Проект' });
    const manager = { delete: jest.fn().mockResolvedValue({ affected: 1 }), remove: jest.fn().mockResolvedValue(project) };
    const transaction = jest.fn(async (run: (tx: typeof manager) => Promise<void>) => run(manager));
    const module = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: WebsocketGateway, useValue: { sendProjectsChanged: jest.fn() } },
        {
          provide: getRepositoryToken(Projects),
          useValue: { findOneBy: jest.fn().mockResolvedValue(project), manager: { transaction } },
        },
        { provide: getRepositoryToken(ProjectMembers), useValue: {} },
        { provide: getRepositoryToken(Timelogs), useValue: {} },
        { provide: AuditLogsService, useValue: { record: jest.fn() } },
      ],
    }).compile();
    await module.get(ProjectsService).deleteProject(12, { id: 1 } as AuthenticatedUser);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(manager.delete).toHaveBeenCalledWith(QuickLink, { project_id: 12 });
    expect(manager.remove).toHaveBeenCalledWith(project);
    expect(manager.delete.mock.invocationCallOrder[0]).toBeLessThan(manager.remove.mock.invocationCallOrder[0]);
  });
});
