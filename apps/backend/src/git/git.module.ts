import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GitController } from './git.controller';
import { GitService } from './git.service';
import { Repo } from './entities/repo.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Repo])],
  controllers: [GitController],
  providers: [GitService],
  exports: [GitService],
})
export class GitModule {}
