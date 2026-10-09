import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { Comments } from './entities/comment.entity';
import { Users } from '../users/entities/users.entity';
import { Tasks } from '../tasks/entities/task.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Notifications } from '../notifications/entities/notification.entity';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { TiptapNodeType } from '../common/enums/tiptap-node-type.enum';
import { ProjectMembers } from '../projects/entities/project.entity';
import { AuthenticatedUser } from '../auth/types/authenticated-user';

describe('CommentsService', () => {
  let service: CommentsService;

  const mockCommentRepository = {
    save: jest.fn<Promise<Comments>, [Partial<Comments>]>(),
    findOne: jest.fn<Promise<Comments | null>, [object]>(),
    find: jest.fn<Promise<Comments[]>, [object]>(),
    delete: jest.fn<Promise<{ affected: number }>, [number]>(),
  };

  const mockUsersRepository = {
    findOne: jest.fn<Promise<Users | null>, [object]>(),
    findBy: jest.fn<Promise<Users[]>, [object]>(),
  };

  const mockTasksRepository = {
    existsBy: jest.fn<Promise<boolean>, [object]>().mockResolvedValue(false),
    findOne: jest.fn<Promise<Tasks | null>, [object]>(),
    save: jest.fn<Promise<Tasks>, [Tasks]>(),
  };

  const mockNotifications = {
    createWithEmail: jest.fn<Promise<Notifications>, [object, string]>().mockResolvedValue({} as Notifications),
  };

  const mockConfig = {
    get: jest.fn<string | undefined, [string]>(),
  };

  const mockWebsocketGateway = {
    sendCommentAdded: jest.fn(),
    sendCommentUpdated: jest.fn(),
    sendCommentDeleted: jest.fn(),
  };
  const currentUser = { id: 7 } as AuthenticatedUser;

  const message = {
    type: TiptapNodeType.Doc,
    content: [
      {
        type: TiptapNodeType.Paragraph,
        attrs: { textAlign: null },
        content: [{ type: TiptapNodeType.Text, text: 'Комментарий' }],
      },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: getRepositoryToken(Comments), useValue: mockCommentRepository },
        { provide: getRepositoryToken(Users), useValue: mockUsersRepository },
        { provide: getRepositoryToken(Tasks), useValue: mockTasksRepository },
        { provide: getRepositoryToken(ProjectMembers), useValue: {} },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: ConfigService, useValue: mockConfig },
        { provide: WebsocketGateway, useValue: mockWebsocketGateway },
      ],
    }).compile();

    service = module.get<CommentsService>(CommentsService);
    jest.clearAllMocks();
    mockConfig.get.mockImplementation((key) => (key === 'APP_PUBLIC_ORIGIN' ? 'https://app.webcetera.test' : undefined));
    mockNotifications.createWithEmail.mockResolvedValue({} as Notifications);
  });

  describe('create', () => {
    it('должен создавать комментарий и добавлять автора в participants, если его там не было', async () => {
      const author = { id: 7, first_name: 'Иван', last_name: 'Иванов', email: 'ivan@test.com' } as Users;
      const task = {
        id: 12,
        title: 'Задача',
        participants: [],
        project: null,
        responsible: null,
      } as unknown as Tasks;
      const savedComment = {
        id: 5,
        task,
        author,
        message,
      } as unknown as Comments;
      const dto = Object.assign(new CreateCommentDto(), {
        author_id: 7,
        task_id: 12,
        message,
      });

      mockUsersRepository.findOne.mockResolvedValue(author);
      mockTasksRepository.findOne.mockResolvedValue(task);
      mockCommentRepository.save.mockResolvedValue(savedComment);

      const result = await service.create(dto, currentUser);

      expect(mockCommentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          author,
          task,
          message,
        }),
      );
      expect(mockTasksRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          participants: [author],
        }),
      );
      expect(mockWebsocketGateway.sendCommentAdded).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 5,
          subComments: [],
        }),
      );
      expect(result).toMatchObject({
        id: 5,
        subComments: [],
      });
    });

    it('должен выбрасывать 400, если родительский комментарий принадлежит другой задаче', async () => {
      const author = { id: 7 } as Users;
      const task = { id: 12, participants: [], project: null, responsible: null } as unknown as Tasks;
      const parentComment = {
        id: 3,
        task: { id: 99 },
        author,
      } as unknown as Comments;
      const dto = Object.assign(new CreateCommentDto(), {
        author_id: 7,
        task_id: 12,
        comment_id: 3,
        message,
      });

      mockUsersRepository.findOne.mockResolvedValue(author);
      mockTasksRepository.findOne.mockResolvedValue(task);
      mockCommentRepository.findOne.mockResolvedValue(parentComment);

      await expect(service.create(dto, currentUser)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('должен отправлять актуальную ссылку на комментарий', async () => {
      const author = { id: 7, first_name: 'Иван', last_name: 'Иванов' } as Users;
      const responsible = { id: 8, email: 'responsible@test.com' } as Users;
      const task = {
        id: 12,
        title: 'Задача',
        participants: [author],
        project: null,
        responsible,
      } as unknown as Tasks;
      const savedComment = { id: 5, task, author, message } as unknown as Comments;
      const dto = Object.assign(new CreateCommentDto(), {
        author_id: 7,
        task_id: 12,
        message,
      });

      mockUsersRepository.findOne.mockResolvedValue(author);
      mockTasksRepository.findOne.mockResolvedValue(task);
      mockCommentRepository.save.mockResolvedValue(savedComment);

      await service.create(dto, currentUser);

      expect(mockNotifications.createWithEmail).toHaveBeenCalledWith(
        expect.objectContaining({ recipient_id: 8, link: '?task-id=12&comment-id=5' }),
        expect.stringContaining('href="https://app.webcetera.test?task-id=12&comment-id=5"'),
      );
    });
  });

  describe('update', () => {
    it('должен сохранять resolved=false и отправлять websocket update', async () => {
      const comment = { id: 1, resolved: true, message } as unknown as Comments;
      const updatedComment = { ...comment, resolved: false } as Comments;

      mockCommentRepository.findOne.mockResolvedValueOnce(comment).mockResolvedValueOnce(updatedComment);
      mockCommentRepository.save.mockResolvedValue(updatedComment);

      await service.update(
        1,
        Object.assign(new UpdateCommentDto(), {
          resolved: false,
        }),
        currentUser,
      );

      expect(mockCommentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          resolved: false,
        }),
      );
      await Promise.resolve();
      expect(mockWebsocketGateway.sendCommentUpdated).toHaveBeenCalledWith(updatedComment);
    });

    it('должен выбрасывать 404, если комментарий не найден', async () => {
      mockCommentRepository.findOne.mockResolvedValue(null);

      await expect(service.update(1, new UpdateCommentDto(), currentUser)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });
  });
});
