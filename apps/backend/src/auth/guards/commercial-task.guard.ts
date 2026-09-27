import { CanActivate, ExecutionContext, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { TaskBusinessKind } from '@tracker/contracts';
import { ROLES } from '../../common/enums/roles.enum';
import { Tasks } from '../../tasks/entities/task.entity';
import { Comments } from '../../comments/entities/comment.entity';
import { AuthenticatedUser } from '../types/authenticated-user';

interface CommercialRequest {
  method: string;
  user: AuthenticatedUser;
  baseUrl: string;
  originalUrl: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body?: {
    task_id?: number;
    relatedTaskId?: number;
    ids?: number[];
    comment_id?: number;
    author_id?: number;
    business_kind?: TaskBusinessKind;
    deal_id?: number;
  };
}
/** Applied after authentication, including legacy mutation endpoints without per-method guards. */
@Injectable()
export class CommercialTaskGuard implements CanActivate {
  constructor(private readonly db: DataSource) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<CommercialRequest>();
    const admin = req.user.role === ROLES.admin;
    if (!admin && (req.body?.business_kind === TaskBusinessKind.SALES || (req.body && 'deal_id' in req.body)))
      throw new NotFoundException();
    const ids = [
      req.params.taskId,
      req.params.task_id,
      req.query.task_id,
      req.body?.task_id,
      req.body?.relatedTaskId,
      ...(req.body?.ids ?? []),
    ]
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0);
    if (req.originalUrl.includes('/comments')) {
      if (req.body?.author_id != null) req.body.author_id = req.user.id;
      const commentIds = [req.params.id, req.body?.comment_id].map(Number).filter((id) => Number.isInteger(id) && id > 0);
      if (commentIds.length) {
        const comments = await this.db.getRepository(Comments).findBy({ id: In(commentIds) });
        ids.push(...comments.flatMap((c) => (c.task_id ? [c.task_id] : [])));
      }
    }
    if (ids.length) {
      const sales = await this.db.getRepository(Tasks).findBy({ id: In(ids), business_kind: TaskBusinessKind.SALES });
      if (sales.length && !admin) throw new NotFoundException('Задача не найдена');
      if (sales.length && req.originalUrl.includes('/timelogs') && req.method !== 'GET')
        throw new BadRequestException('Учёт времени для коммерческих задач отключён');
    }
    return true;
  }
}
