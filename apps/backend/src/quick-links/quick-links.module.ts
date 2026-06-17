import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { QuickLinksController } from './quick-links.controller';
import { QuickLinksService } from './quick-links.service';
import { QuickLink } from './entities/quick-link.entity';
import { Users } from '../users/entities/users.entity';

@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([QuickLink, Users])],
  controllers: [QuickLinksController],
  providers: [QuickLinksService],
  exports: [QuickLinksService],
})
export class QuickLinksModule {}
