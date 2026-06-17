import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChangelogsController } from './changelogs.controller';
import { ChangelogsService } from './changelogs.service';
import { Changelog } from './entities/changelog.entity';
import { ChangelogView } from './entities/changelog-view.entity';
import { Users } from '../users/entities/users.entity';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Changelog, ChangelogView, Users]), AuthModule],
  controllers: [ChangelogsController],
  providers: [ChangelogsService],
})
export class ChangelogsModule {}
