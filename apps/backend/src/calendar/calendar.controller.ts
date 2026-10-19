import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../common/enums/roles.enum';
import { CalendarService } from './calendar.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { GetCalendarEventsDto } from './dto/get-calendar-events.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

@ApiTags('Календарь')
@Controller('calendar')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ROLES.admin, ROLES.employee)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get('events')
  @ApiOperation({ summary: 'Получить встречи за период' })
  findAll(@Query() filters: GetCalendarEventsDto) {
    return this.calendarService.findAll(filters);
  }

  @Get('users')
  @ApiOperation({ summary: 'Получить доступных участников встреч' })
  findUsers() {
    return this.calendarService.findUsers();
  }

  @Get('events/:id')
  @ApiOperation({ summary: 'Получить встречу' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.calendarService.findOne(id);
  }

  @Post('events')
  @ApiOperation({ summary: 'Создать встречу' })
  create(@Body() dto: CreateCalendarEventDto, @Req() req: RequestWithUser) {
    return this.calendarService.create(dto, req.user);
  }

  @Patch('events/:id')
  @ApiOperation({ summary: 'Изменить встречу' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCalendarEventDto, @Req() req: RequestWithUser) {
    return this.calendarService.update(id, dto, req.user);
  }

  @Post('events/:id/accept')
  @ApiOperation({ summary: 'Подтвердить участие во встрече' })
  accept(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.calendarService.accept(id, req.user);
  }

  @Delete('events/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить встречу' })
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithUser) {
    return this.calendarService.remove(id, req.user);
  }
}
