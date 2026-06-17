import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Changelog } from './entities/changelog.entity';
import { ChangelogView } from './entities/changelog-view.entity';
import { CreateChangelogDto } from './dto/create-changelog.dto';
import { UpdateChangelogDto } from './dto/update-changelog.dto';
import { AuthenticatedUser } from '../auth/types/authenticated-user';

@Injectable()
export class ChangelogsService {
  constructor(
    @InjectRepository(Changelog)
    private readonly changelogRepository: Repository<Changelog>,
    @InjectRepository(ChangelogView)
    private readonly changelogViewRepository: Repository<ChangelogView>,
  ) {}

  async findAll() {
    const changelogs = await this.changelogRepository.find({
      order: { created_at: 'DESC' },
      relations: ['author'],
    });

    const viewCounts = await this.changelogViewRepository
      .createQueryBuilder('cv')
      .select('cv.changelog_id', 'changelog_id')
      .addSelect('COUNT(*)', 'count')
      .groupBy('cv.changelog_id')
      .getRawMany<{ changelog_id: number; count: string }>();

    const countMap = new Map<number, number>(viewCounts.map((r) => [Number(r.changelog_id), Number(r.count)]));

    return changelogs.map((cl) => ({ ...cl, views_count: countMap.get(cl.id) ?? 0 }));
  }

  async findUnseen(currentUser: AuthenticatedUser) {
    const viewed = await this.changelogViewRepository.find({
      where: { user_id: currentUser.id },
      select: ['changelog_id'],
    });
    const viewedIds = viewed.map((v) => v.changelog_id);

    const qb = this.changelogRepository
      .createQueryBuilder('changelog')
      .where('changelog.is_published = true')
      .orderBy('changelog.created_at', 'DESC');

    if (viewedIds.length > 0) {
      qb.andWhere('changelog.id NOT IN (:...viewedIds)', { viewedIds });
    }

    return qb.getMany();
  }

  async markViewed(changelogId: number, currentUser: AuthenticatedUser) {
    const changelog = await this.changelogRepository.findOne({ where: { id: changelogId } });
    if (!changelog) {
      throw new HttpException({ message: ['Changelog не найден'] }, HttpStatus.NOT_FOUND);
    }

    const existing = await this.changelogViewRepository.findOne({
      where: { user_id: currentUser.id, changelog_id: changelogId },
    });
    if (existing) return { ok: true };

    await this.changelogViewRepository.save({
      user_id: currentUser.id,
      changelog_id: changelogId,
    });
    return { ok: true };
  }

  async create(dto: CreateChangelogDto, currentUser: AuthenticatedUser) {
    const changelog = this.changelogRepository.create({
      title: dto.title,
      body: dto.body ?? null,
      is_published: dto.is_published ?? false,
      author_id: currentUser.id,
    });
    return this.changelogRepository.save(changelog);
  }

  async update(id: number, dto: UpdateChangelogDto) {
    const changelog = await this.changelogRepository.findOne({ where: { id } });
    if (!changelog) {
      throw new HttpException({ message: ['Changelog не найден'] }, HttpStatus.NOT_FOUND);
    }
    Object.assign(changelog, dto);
    return this.changelogRepository.save(changelog);
  }

  async remove(id: number) {
    const changelog = await this.changelogRepository.findOne({ where: { id } });
    if (!changelog) {
      throw new HttpException({ message: ['Changelog не найден'] }, HttpStatus.NOT_FOUND);
    }
    await this.changelogRepository.remove(changelog);
    return { ok: true };
  }
}
