import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiUnauthorizedResponse, ApiForbiddenResponse } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../common/enums/roles.enum';
import { RequestWithCookies } from '../common/types/request';
import { CrmService } from './crm.service';
import {
  CompanyDto,
  ContactDto,
  CrmCollapsedStagesDto,
  CrmCommentDto,
  CrmQueryDto,
  CrmTaskDto,
  CrmTaskLinkDto,
  DealDto,
  UpdateCompanyDto,
  UpdateContactDto,
  UpdateDealDto,
} from './crm.dto';
@Controller('crm')
@ApiTags('CRM')
@ApiBearerAuth('api-token')
@ApiUnauthorizedResponse({ description: 'Отсутствующий, неверный, истёкший или отозванный API-токен' })
@ApiForbiddenResponse({ description: 'CRM доступна только администраторам' })
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.admin)
export class CrmController {
  constructor(private readonly crm: CrmService) {}
  @Get('options') options(@Req() req: RequestWithCookies) {
    return this.crm.options(req.user.id);
  }
  @Patch('preferences/collapsed-stages') collapsedStages(@Body() dto: CrmCollapsedStagesDto, @Req() req: RequestWithCookies) {
    return this.crm.saveCollapsedStages(req.user.id, dto.collapsed_stage_ids);
  }
  @ApiOperation({ summary: 'Создать компанию клиента' })
  @Post('companies')
  company(@Body() dto: CompanyDto) {
    return this.crm.saveCompany(dto);
  }
  @Patch('companies/:id') updateCompany(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCompanyDto) {
    return this.crm.saveCompany(dto, id);
  }
  @ApiOperation({ summary: 'Создать контакт клиента (без учётной записи трекера)' })
  @Post('contacts')
  contact(@Body() dto: ContactDto) {
    return this.crm.saveContact(dto);
  }
  @Patch('contacts/:id') updateContact(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateContactDto) {
    return this.crm.saveContact(dto, id);
  }
  @Get('board') board(@Query() q: CrmQueryDto, @Req() req: RequestWithCookies) {
    return this.crm.board(q, req.user);
  }
  @Get('columns/:id') column(@Param('id', ParseIntPipe) id: number, @Query() q: CrmQueryDto, @Req() req: RequestWithCookies) {
    return this.crm.column(id, q, req.user);
  }
  @Get('deals/:id') detail(@Param('id', ParseIntPipe) id: number) {
    return this.crm.detail(id);
  }
  @ApiOperation({
    summary: 'Создать сделку',
    description:
      'Обязательно только название. Ответственный по умолчанию — владелец API-токена. Идентификаторы компании и контактов берутся из ответов на их создание.',
  })
  @Post('deals')
  create(@Body() dto: DealDto, @Req() req: RequestWithCookies) {
    return this.crm.saveDeal(dto, req.user);
  }
  @Patch('deals/:id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDealDto, @Req() req: RequestWithCookies) {
    return this.crm.saveDeal(dto, req.user, id);
  }
  @Post('deals/:id/comments') comment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CrmCommentDto,
    @Req() req: RequestWithCookies,
  ) {
    return this.crm.comment(id, dto, req.user);
  }
  @Post('deals/:id/tasks') task(@Param('id', ParseIntPipe) id: number, @Body() dto: CrmTaskDto, @Req() req: RequestWithCookies) {
    return this.crm.createTask(id, dto, req.user);
  }
  @Post('deals/:id/task-links') link(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CrmTaskLinkDto,
    @Req() req: RequestWithCookies,
  ) {
    return this.crm.linkTask(id, dto.task_id, req.user);
  }
  @Post('deals/:id/project') project(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithCookies) {
    return this.crm.createProject(id, req.user);
  }
}
