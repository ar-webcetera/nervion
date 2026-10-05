import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GitController } from './git.controller';
import { GitService } from './git.service';
import { Repo } from './entities/repo.entity';
import { Projects } from '../projects/entities/project.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Repo, Projects])],
  controllers: [GitController],
  providers: [GitService],
  exports: [GitService],
})
export class GitModule {}
