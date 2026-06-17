import { Module } from '@nestjs/common';
import { WikiPagesService } from './wiki-pages.service';
import { WikiPagesController } from './wiki-pages.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WikiPages } from './entities/wiki-page.entity';
import { Projects } from '../projects/entities/project.entity';
import { Users } from '../users/entities/users.entity';

@Module({
  imports: [TypeOrmModule.forFeature([WikiPages, Projects, Users])],
  controllers: [WikiPagesController],
  providers: [WikiPagesService],
})
export class WikiPagesModule {}
