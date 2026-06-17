import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiToken } from './entities/api-token.entity';
import { ApiTokensService } from './api-tokens.service';
import { ApiTokensController } from './api-tokens.controller';
import { Users } from '../users/entities/users.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ApiToken, Users])],
  controllers: [ApiTokensController],
  providers: [ApiTokensService],
  exports: [ApiTokensService],
})
export class ApiTokensModule {}
