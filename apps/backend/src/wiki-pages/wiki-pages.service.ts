import { PROJECT_STATUSES } from '../common/enums/project-status.enum';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateWikiPageDto } from './dto/create-wiki-page.dto';
import { UpdateWikiPageDto } from './dto/update-wiki-page.dto';
import { DeepPartial, FindOptionsWhere, Repository, Not } from 'typeorm';
import { Projects } from '../projects/entities/project.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { WikiPages } from './entities/wiki-page.entity';
import { FindWikiPagesByFilterDto } from './dto/find-wiki-pages-by-filter.dto';
import { WikiTreeNode } from './dto/tree-item.dto';
import { ProjectMembers } from '../projects/entities/project.entity';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { ROLES } from '../common/enums/roles.enum';

@Injectable()
export class WikiPagesService {
  constructor(
    @InjectRepository(Projects)
    private readonly projectsRepository: Repository<Projects>,
    @InjectRepository(ProjectMembers)
    private readonly projectMembersRepository: Repository<ProjectMembers>,
    @InjectRepository(WikiPages)
    private readonly wikiPagesRepository: Repository<WikiPages>,
  ) {}
  async create(createWikiPageDto: CreateWikiPageDto, currentUser: AuthenticatedUser) {
    const project = await this.projectsRepository.findOne({
      where: { id: createWikiPageDto.project_id },
    });
    if (!project) {
      throw new HttpException(
        {
          message: [`Проект с id=${createWikiPageDto.project_id} не найден`],
        },
        HttpStatus.NOT_FOUND,
      );
    }
    await this.assertProjectAccess(project, currentUser);

    const data: DeepPartial<WikiPages> = {
      project,
    };

    if (createWikiPageDto.priority !== undefined) data.priority = createWikiPageDto.priority;
    if (createWikiPageDto.name) data.name = createWikiPageDto.name;
    if (createWikiPageDto.parent_page_id) {
      const wikiPage = await this.wikiPagesRepository.findOne({
        where: { id: createWikiPageDto.parent_page_id },
      });
      if (!wikiPage) {
        throw new HttpException(
          {
            message: [`Вики страницв с id=${createWikiPageDto.parent_page_id} не найдена`],
          },
          HttpStatus.NOT_FOUND,
        );
      }
      data.parent_page = wikiPage;
    }

    return this.wikiPagesRepository.save(data);
  }

  private buildTree(items: WikiPages[]): WikiTreeNode[] {
    const tree: WikiTreeNode[] = [];
    const map: Record<number, WikiTreeNode> = {};

    items.forEach((item) => {
      map[item.id] = {
        id: item.id,
        priority: item.priority,
        name: item.name,
        parent_page_id: item.parent_page_id,
        children: [],
      };
    });

    items.forEach((item) => {
      const node = map[item.id];
      if (item.parent_page_id === null) {
        tree.push(node);
      } else {
        const parent = map[item.parent_page_id];
        if (parent) {
          parent.children.push(node);
        }
      }
    });

    return tree;
  }

  async findByFilter(findWikiPagesByFilterDto: FindWikiPagesByFilterDto, currentUser: AuthenticatedUser) {
    if (findWikiPagesByFilterDto.project_id) {
      const project = await this.projectsRepository.findOne({ where: { id: findWikiPagesByFilterDto.project_id } });
      if (!project) return [];
      await this.assertProjectAccess(project, currentUser);
    }
    const where: FindOptionsWhere<WikiPages> = { project: { status: Not(PROJECT_STATUSES.ON_HOLD) } };
    if (findWikiPagesByFilterDto.project_id) {
      where.project = { id: findWikiPagesByFilterDto.project_id, status: Not(PROJECT_STATUSES.ON_HOLD) };
    }
    const pages = await this.wikiPagesRepository.find({
      where,
      order: { priority: 'ASC' },
    });
    return this.buildTree(pages);
  }

  async findOne(id: number, currentUser: AuthenticatedUser) {
    const page = await this.wikiPagesRepository.findOne({
      where: { id, project: { status: Not(PROJECT_STATUSES.ON_HOLD) } },
      relations: ['project'],
    });
    if (page?.project) await this.assertProjectAccess(page.project, currentUser);
    return page;
  }

  async update(id: number, updateWikiPageDto: UpdateWikiPageDto, currentUser: AuthenticatedUser) {
    const wikiPage = await this.wikiPagesRepository.findOne({
      where: { id },
      relations: ['parent_page', 'project'],
    });
    if (!wikiPage) {
      throw new HttpException(
        {
          message: [`Вики страница с id=${id} не найдена`],
        },
        HttpStatus.NOT_FOUND,
      );
    }
    if (!wikiPage.project) {
      throw new HttpException({ message: [`Проект вики-страницы с id=${id} не найден`] }, HttpStatus.NOT_FOUND);
    }
    await this.assertProjectAccess(wikiPage.project, currentUser);

    if (updateWikiPageDto.priority !== undefined) wikiPage.priority = updateWikiPageDto.priority;
    if (updateWikiPageDto.name) wikiPage.name = updateWikiPageDto.name;
    if (updateWikiPageDto.description) wikiPage.description = updateWikiPageDto.description;
    if (updateWikiPageDto.parent_page_id === null) {
      wikiPage.parent_page = null;
    }
    if (updateWikiPageDto.parent_page_id) {
      const parentPage = await this.wikiPagesRepository.findOne({
        where: { id: updateWikiPageDto.parent_page_id },
      });
      if (!parentPage) {
        throw new HttpException(
          {
            message: [`Вики страницв с id=${updateWikiPageDto.parent_page_id} не найдена`],
          },
          HttpStatus.NOT_FOUND,
        );
      }
      wikiPage.parent_page = parentPage;
    }

    return await this.wikiPagesRepository.save(wikiPage);
  }

  async remove(id: number, currentUser: AuthenticatedUser) {
    const page = await this.wikiPagesRepository.findOne({ where: { id }, relations: ['project'] });
    if (page?.project) await this.assertProjectAccess(page.project, currentUser);
    return this.wikiPagesRepository.delete({ id });
  }

  private async assertProjectAccess(project: Projects, currentUser: AuthenticatedUser): Promise<void> {
    if (project.isPrivate) {
      if (project.ownerId !== currentUser.id) {
        throw new HttpException({ message: ['Вики-страница не найдена'] }, HttpStatus.NOT_FOUND);
      }
      return;
    }
    if (currentUser.role === ROLES.admin) return;

    const hasAccess = await this.projectMembersRepository.exist({
      where: { project: { id: project.id }, user: { id: currentUser.id } },
    });
    if (!hasAccess) {
      throw new HttpException({ message: ['Доступ к проекту запрещён'] }, HttpStatus.FORBIDDEN);
    }
  }
}
