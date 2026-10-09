import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { TaskBusinessKind } from '@tracker/contracts';
import { ROLES } from '../common/enums/roles.enum';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Tasks } from '../tasks/entities/task.entity';
import { DeepPartial, In, IsNull, Repository } from 'typeorm';
import { Comments } from './entities/comment.entity';
import { Users } from '../users/entities/users.entity';
import { FindCommentsByFilterDto, SortOrder } from './dto/find-comments-by-filter.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { ConfigService } from '@nestjs/config';
import { AnyTiptapNode, TiptapDoc } from '../common/types/tiptap';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { extractTextFromDoc } from 'src/common/utils/extractTextFromDoc';
import { ProjectMembers, Projects } from '../projects/entities/project.entity';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { buildPublicAppUrl } from '../common/utils/public-app-url';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comments)
    private readonly commentRepository: Repository<Comments>,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    @InjectRepository(Tasks)
    private readonly tasksRepository: Repository<Tasks>,
    @InjectRepository(ProjectMembers)
    private readonly projectMembersRepository: Repository<ProjectMembers>,
    private notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  findMentionIds(node: AnyTiptapNode, result: Set<number> = new Set()): Set<number> {
    if (node.type === 'mention') {
      const id = Number((node as { attrs?: { id?: unknown } }).attrs?.id);
      if (id) result.add(id);
      return result;
    }

    const maybeContent = (node as { content?: AnyTiptapNode[] }).content;
    if (Array.isArray(maybeContent)) {
      for (const child of maybeContent) {
        this.findMentionIds(child, result);
      }
    }

    return result;
  }
  async create(createCommentDto: CreateCommentDto, currentUser: AuthenticatedUser) {
    let author: Users | null = null;
    if (createCommentDto.author_id) {
      author = await this.usersRepository.findOne({
        where: { id: createCommentDto.author_id },
      });
      if (!author) {
        throw new HttpException(
          {
            message: [`Пользователь-комментатор с id=${createCommentDto.author_id} не найден`],
          },
          HttpStatus.NOT_FOUND,
        );
      }
    }

    const task = await this.tasksRepository.findOne({
      where: { id: createCommentDto.task_id },
      relations: ['participants', 'project', 'responsible'],
    });
    if (!task) {
      throw new HttpException(
        {
          message: [`Задача с id=${createCommentDto.task_id} не найдена`],
        },
        HttpStatus.NOT_FOUND,
      );
    }
    await this.assertTaskAccess(task, currentUser);

    const data: DeepPartial<Comments> = {
      message: createCommentDto.message,
      task,
      author,
    };
    let parentComment: Comments | null = null;
    if (createCommentDto.comment_id) {
      parentComment = await this.commentRepository.findOne({
        where: { id: createCommentDto.comment_id },
        relations: ['task', 'author'],
      });
      if (!parentComment) {
        throw new HttpException(
          { message: [`Родительский комментарий с id=${createCommentDto.comment_id} не найден`] },
          HttpStatus.NOT_FOUND,
        );
      }

      if (parentComment.task && parentComment.task.id !== task.id) {
        throw new HttpException({ message: ['Родительский комментарий принадлежит другой задаче'] }, HttpStatus.BAD_REQUEST);
      }

      data.comment_id = parentComment.id;
      data.parent = parentComment;
    }

    const newComment = await this.commentRepository.save(data);

    void this.sendCommentNotifications({
      author,
      task,
      newComment,
      parentComment,
      message: createCommentDto.message,
    }).catch((err) => console.error('Ошибка фоновой обработки комментария', err));

    void this.websocketGateway.sendCommentAdded({ ...newComment, subComments: [] });
    return { ...newComment, subComments: [] };
  }

  private async sendCommentNotifications({
    author,
    task,
    newComment,
    parentComment,
    message: rawMessage,
  }: {
    author: Users | null;
    task: Tasks;
    newComment: Comments;
    parentComment: Comments | null;
    message: TiptapDoc;
  }) {
    if (task.business_kind === TaskBusinessKind.SALES) return;
    if (author && !task.participants.some((p) => p.id === author.id)) {
      task.participants.push(author);
      await this.tasksRepository.save(task);
    }

    const authorName = `${author?.last_name || ''} ${author?.first_name || ''}`.trim();
    const message = extractTextFromDoc(rawMessage);
    const link = `?task-id=${task.id}&comment-id=${newComment.id}`;
    const absoluteLink = buildPublicAppUrl(this.config, link);
    const mentionIds = this.findMentionIds(rawMessage);
    if (task.project?.isPrivate) {
      for (const mentionId of mentionIds) {
        if (mentionId !== task.project.ownerId) mentionIds.delete(mentionId);
      }
    }

    const recipientIds = new Set<number>();
    const recipients: Users[] = [];

    mentionIds.forEach((id) => recipientIds.add(id));

    if (task.responsible && task.responsible.id !== author?.id && !recipientIds.has(task.responsible.id)) {
      recipientIds.add(task.responsible.id);
      recipients.push(task.responsible);
    }

    if (parentComment) {
      const threadComments = await this.commentRepository.find({
        where: [{ id: parentComment.id }, { comment_id: parentComment.id }],
        relations: ['author'],
      });
      for (const threadComment of threadComments) {
        if (threadComment.author && threadComment.author.id !== author?.id && !recipientIds.has(threadComment.author.id)) {
          recipientIds.add(threadComment.author.id);
          recipients.push(threadComment.author);
        }
      }
    }

    const commentLink = `<p><a href="${absoluteLink}" target="_blank" rel="noopener noreferrer">Перейти к комментарию</a></p>`;

    if (mentionIds.size > 0) {
      const mentionUsers = await this.usersRepository.findBy({ id: In([...mentionIds]) });
      for (const mentionUser of mentionUsers) {
        if (mentionUser.id === author?.id) continue;
        const subject = `${authorName} отметил вас в задаче: ${task.title}`;
        void this.notifications
          .createWithEmail({ name: subject, message, recipient_id: mentionUser.id, link }, `<p>${message}</p>${commentLink}`)
          .catch((err) => console.error('Ошибка создания уведомления', err));
      }
    }

    await Promise.all(
      recipients.map((recipient) => {
        const subject = `${authorName} комментирует задачу: ${task.title}`;
        return this.notifications
          .createWithEmail({ name: subject, message, recipient_id: recipient.id, link }, `<p>${message}</p>${commentLink}`)
          .catch((err) => console.error('Ошибка создания уведомления', err));
      }),
    );
  }

  async findCommentsByFilter(dto: FindCommentsByFilterDto, currentUser: AuthenticatedUser) {
    const { task_id, sort = SortOrder.ASC } = dto;

    if (task_id) {
      const task = await this.tasksRepository.findOne({ where: { id: task_id }, relations: ['project'] });
      if (!task) return [];
      await this.assertTaskAccess(task, currentUser);
    }

    const where: Record<string, any> = { parent: IsNull() };
    if (task_id) where.task = { id: task_id };
    if (currentUser.role !== ROLES.admin) where.task = { ...where.task, business_kind: TaskBusinessKind.PRODUCTION };

    const roots = await this.commentRepository.find({
      where,
      relations: ['author', 'task', 'task.project', 'subComments', 'subComments.author'],
      order: { created_at: sort },
    });

    const visibleRoots: Comments[] = [];
    for (const comment of roots) {
      try {
        if (comment.task) await this.assertTaskAccess(comment.task, currentUser);
        visibleRoots.push(comment);
      } catch {
        continue;
      }
    }

    return visibleRoots.map((c: Comments) => {
      const { subComments, task: loadedTask, ...rest } = c;
      void loadedTask;
      const sortedChildren = (subComments ?? []).sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
      return { ...(rest as Omit<Comments, 'subComments'>), subComments: sortedChildren };
    });
  }

  async findOne(id: number, currentUser: AuthenticatedUser) {
    const comment = await this.commentRepository.findOne({ where: { id }, relations: ['task', 'task.project'] });
    if (comment?.task) await this.assertTaskAccess(comment.task, currentUser);
    return comment;
  }

  async update(id: number, updateCommentDto: UpdateCommentDto, currentUser: AuthenticatedUser) {
    const comment = await this.commentRepository.findOne({ where: { id }, relations: ['task', 'task.project'] });
    if (!comment) {
      throw new HttpException(
        {
          message: [`Комментарий с id=${id} не найден`],
        },
        HttpStatus.NOT_FOUND,
      );
    }
    if (comment.task) await this.assertTaskAccess(comment.task, currentUser);
    if (updateCommentDto.message) comment.message = updateCommentDto.message;
    if (updateCommentDto.resolved || updateCommentDto.resolved === false) {
      comment.resolved = updateCommentDto.resolved;
    }

    await this.commentRepository.save(comment);
    this.commentRepository
      .findOne({ where: { id } })
      .then((updatedComment) => {
        if (updatedComment) {
          void this.websocketGateway.sendCommentUpdated(updatedComment);
        }
      })
      .catch((err) => {
        console.error('Ошибка при отправке обновления комментария:', err);
      });
  }

  async remove(id: number, currentUser: AuthenticatedUser) {
    const comment = await this.commentRepository.findOne({ where: { id }, relations: ['task', 'task.project'] });
    if (comment?.task) await this.assertTaskAccess(comment.task, currentUser);
    const commercial = comment?.task_id
      ? await this.tasksRepository.existsBy({ id: comment.task_id, business_kind: TaskBusinessKind.SALES })
      : false;
    const resultDelete = await this.commentRepository.delete(id);
    this.websocketGateway.sendCommentDeleted(
      id,
      commercial,
      comment?.task?.project?.isPrivate ? comment.task.project.ownerId : null,
    );
    return resultDelete;
  }

  private async assertTaskAccess(task: Tasks, currentUser: AuthenticatedUser): Promise<void> {
    const project = task.project;
    if (!project && !task.project_id) return;

    const resolvedProject =
      project ??
      (await this.projectMembersRepository.manager.findOne(Projects, {
        where: { id: task.project_id! },
      }));
    if (!resolvedProject) {
      throw new HttpException({ message: ['Задача не найдена'] }, HttpStatus.NOT_FOUND);
    }
    if (resolvedProject.isPrivate) {
      if (resolvedProject.ownerId !== currentUser.id) {
        throw new HttpException({ message: ['Задача не найдена'] }, HttpStatus.NOT_FOUND);
      }
      return;
    }
    if (currentUser.role === ROLES.admin) return;

    const hasAccess = await this.projectMembersRepository.exist({
      where: { project: { id: resolvedProject.id }, user: { id: currentUser.id } },
    });
    if (!hasAccess) {
      throw new HttpException({ message: ['Доступ к проекту запрещён'] }, HttpStatus.FORBIDDEN);
    }
  }
}
