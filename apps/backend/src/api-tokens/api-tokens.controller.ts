import { Controller, Get, Post, Delete, Body, Param, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiTokensService } from './api-tokens.service';
import { CreateApiTokenDto } from './dto/create-api-token.dto';
import { CreateApiTokenResponseDto } from './dto/create-api-token-response.dto';
import { ApiToken } from './entities/api-token.entity';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequestWithCookies } from '../common/types/request';

@Controller('api-tokens')
@ApiTags('API-токены')
@ApiBearerAuth('api-token')
@UseGuards(AuthGuard, RolesGuard)
export class ApiTokensController {
  constructor(private readonly apiTokensService: ApiTokensService) {}

  @Post()
  @ApiOperation({ summary: 'Создать API-токен (токен показывается только один раз)' })
  @ApiCreatedResponse({ type: CreateApiTokenResponseDto })
  create(@Req() req: RequestWithCookies, @Body() dto: CreateApiTokenDto) {
    return this.apiTokensService.create(req.user.id, dto, req.user);
  }

  @Get()
  @ApiOperation({ summary: 'Получить список своих API-токенов' })
  @ApiOkResponse({ type: [ApiToken] })
  findAll(@Req() req: RequestWithCookies) {
    return this.apiTokensService.findAllByUser(req.user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить API-токен' })
  @ApiNoContentResponse({ description: 'Токен удалён' })
  remove(@Req() req: RequestWithCookies, @Param('id') id: string) {
    return this.apiTokensService.remove(+id, req.user.id, req.user);
  }
}
