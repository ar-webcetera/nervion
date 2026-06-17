import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QuickLink } from './entities/quick-link.entity';
import { CreateQuickLinkDto } from './dto/create-quick-link.dto';
import { UpdateQuickLinkDto } from './dto/update-quick-link.dto';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class QuickLinksService {
  constructor(
    @InjectRepository(QuickLink)
    private quickLinksRepository: Repository<QuickLink>,
    private readonly httpService: HttpService,
  ) {}

  async findByUser(userId: number, projectId: number): Promise<QuickLink[]> {
    return this.quickLinksRepository.find({
      where: { user_id: userId, project_id: projectId },
      order: { position: 'ASC', created_at: 'ASC' },
    });
  }

  private async fetchTitleFromUrl(url: string): Promise<string> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          timeout: 5000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        }),
      );

      const html = response.data as string;
      const titleMatch = typeof html === 'string' ? html.match(/<title[^>]*>([^<]+)<\/title>/i) : null;

      if (titleMatch && titleMatch[1]) {
        return titleMatch[1].trim();
      }

      const urlObj = new URL(url);
      const rawHostname = urlObj.hostname.replace(/^www\./, '');
      const parts = rawHostname.split('.');
      const hostname = parts.length > 2 ? parts.slice(-2).join('.') : rawHostname;
      return hostname.charAt(0).toUpperCase() + hostname.slice(1);
    } catch {
      try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.replace(/^www\./, '');
        return hostname.charAt(0).toUpperCase() + hostname.slice(1);
      } catch {
        return 'Ссылка';
      }
    }
  }

  async create(userId: number, createQuickLinkDto: CreateQuickLinkDto): Promise<QuickLink> {
    let title = createQuickLinkDto.title;

    if (!title) {
      title = await this.fetchTitleFromUrl(createQuickLinkDto.url);
    }

    const quickLink = this.quickLinksRepository.create({
      ...createQuickLinkDto,
      title,
      user_id: userId,
    });
    return this.quickLinksRepository.save(quickLink);
  }

  async update(id: number, userId: number, updateQuickLinkDto: UpdateQuickLinkDto): Promise<QuickLink> {
    const quickLink = await this.quickLinksRepository.findOne({
      where: { id, user_id: userId },
    });

    if (!quickLink) {
      throw new NotFoundException('Quick link not found');
    }

    Object.assign(quickLink, updateQuickLinkDto);
    return this.quickLinksRepository.save(quickLink);
  }

  async delete(id: number, userId: number): Promise<void> {
    const result = await this.quickLinksRepository.delete({
      id,
      user_id: userId,
    });

    if (result.affected === 0) {
      throw new NotFoundException('Quick link not found');
    }
  }
}
