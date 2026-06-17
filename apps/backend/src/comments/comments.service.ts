import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Tasks } from '../tasks/entities/task.entity';
import { DeepPartial, In, IsNull, Repository } from 'typeorm';
import { Comments } from './entities/comment.entity';
import { Users } from '../users/entities/users.entity';
import { FindCommentsByFilterDto, SortOrder } from './dto/find-comments-by-filter.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { AnyTiptapNode, TiptapDoc } from '../common/types/tiptap';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { extractTextFromDoc } from 'src/common/utils/extractTextFromDoc';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comments)
    private readonly commentRepository: Repository<Comments>,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    @InjectRepository(Tasks)
    private readonly tasksRepository: Repository<Tasks>,
    private notifications: NotificationsService,
    private readonly mailService: MailService,
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
  async create(createCommentDto: CreateCommentDto) {
    const domain = this.config.get<string>('APP_DOMAIN');
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
      domain,
    }).catch((err) => console.error('Ошибка фоновой обработки комментария', err));

    this.websocketGateway.sendCommentAdded({ ...newComment, subComments: [] });
    return { ...newComment, subComments: [] };
  }

  private async sendCommentNotifications({
    author,
    task,
    newComment,
    parentComment,
    message: rawMessage,
    domain,
  }: {
    author: Users | null;
    task: Tasks;
    newComment: Comments;
    parentComment: Comments | null;
    message: TiptapDoc;
    domain: string | undefined;
  }) {
    if (author && !task.participants.some((p) => p.id === author.id)) {
      task.participants.push(author);
      await this.tasksRepository.save(task);
    }

    const authorName = `${author?.last_name || ''} ${author?.first_name || ''}`.trim();
    const message = extractTextFromDoc(rawMessage);
    const link = `?task-id=${task.id}&comment-id=${newComment.id}`;
    const absoluteLink = `https://tracker.${domain}${link}`;
    const mentionIds = this.findMentionIds(rawMessage);

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
          .create({ name: subject, message, recipient_id: mentionUser.id, link })
          .catch((err) => console.error('Ошибка создания уведомления', err));
        void this.mailService
          .sendMail(mentionUser.email, subject, `<p>${message}</p>${commentLink}`)
          .catch((err) => console.error('Ошибка отправки письма', err));
      }
    }

    await Promise.all(
      recipients.flatMap((recipient) => {
        const subject = `${authorName} комментирует задачу: ${task.title}`;
        return [
          this.notifications
            .create({ name: subject, message, recipient_id: recipient.id, link })
            .catch((err) => console.error('Ошибка создания уведомления', err)),
          this.mailService
            .sendMail(recipient.email, subject, `<p>${message}</p>${commentLink}`)
            .catch((err) => console.error('Ошибка отправки письма', err)),
        ];
      }),
    );
  }

  async findCommentsByFilter(dto: FindCommentsByFilterDto) {
    const { task_id, sort = SortOrder.ASC } = dto;

    const where: Record<string, any> = { parent: IsNull() };
    if (task_id) where.task = { id: task_id };

    const roots = await this.commentRepository.find({
      where,
      relations: ['author', 'subComments', 'subComments.author'],
      order: { created_at: sort },
    });

    return roots.map((c: Comments) => {
      const { subComments, ...rest } = c;
      const sortedChildren = (subComments ?? []).sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
      return { ...(rest as Omit<Comments, 'subComments'>), subComments: sortedChildren };
    });
  }

  findOne(id: number) {
    return this.commentRepository.findOne({ where: { id } });
  }

  async update(id: number, updateCommentDto: UpdateCommentDto) {
    const comment = await this.commentRepository.findOne({ where: { id } });
    if (!comment) {
      throw new HttpException(
        {
          message: [`Комментарий с id=${id} не найден`],
        },
        HttpStatus.NOT_FOUND,
      );
    }
    if (updateCommentDto.message) comment.message = updateCommentDto.message;
    if (updateCommentDto.resolved || updateCommentDto.resolved === false) {
      comment.resolved = updateCommentDto.resolved;
    }

    await this.commentRepository.save(comment);
    this.commentRepository
      .findOne({ where: { id } })
      .then((updatedComment) => {
        if (updatedComment) {
          this.websocketGateway.sendCommentUpdated(updatedComment);
        }
      })
      .catch((err) => {
        console.error('Ошибка при отправке обновления комментария:', err);
      });
  }

  async remove(id: number) {
    const resultDelete = await this.commentRepository.delete(id);
    this.websocketGateway.sendCommentDeleted(id);
    return resultDelete;
  }
}
