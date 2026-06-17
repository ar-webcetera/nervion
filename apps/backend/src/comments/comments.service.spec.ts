import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { Comments } from './entities/comment.entity';
import { Users } from '../users/entities/users.entity';
import { Tasks } from '../tasks/entities/task.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { TiptapNodeType } from '../common/enums/tiptap-node-type.enum';

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
    findOne: jest.fn<Promise<Tasks | null>, [object]>(),
    save: jest.fn<Promise<Tasks>, [Tasks]>(),
  };

  const mockNotifications = {
    create: jest.fn<Promise<void>, [object]>().mockResolvedValue(),
  };

  const mockMailService = {
    sendMail: jest.fn<Promise<void>, [string, string, string]>().mockResolvedValue(),
  };

  const mockConfig = {
    get: jest.fn<string | undefined, [string]>().mockReturnValue('webcetera.test'),
  };

  const mockWebsocketGateway = {
    sendCommentAdded: jest.fn(),
    sendCommentUpdated: jest.fn(),
    sendCommentDeleted: jest.fn(),
  };

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
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: MailService, useValue: mockMailService },
        { provide: ConfigService, useValue: mockConfig },
        { provide: WebsocketGateway, useValue: mockWebsocketGateway },
      ],
    }).compile();

    service = module.get<CommentsService>(CommentsService);
    jest.clearAllMocks();
    mockConfig.get.mockReturnValue('webcetera.test');
    mockNotifications.create.mockResolvedValue();
    mockMailService.sendMail.mockResolvedValue();
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

      const result = await service.create(dto);

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

      await expect(service.create(dto)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
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

      await expect(service.update(1, new UpdateCommentDto())).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });
  });
});
