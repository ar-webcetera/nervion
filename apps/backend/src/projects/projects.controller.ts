import { Body, Controller, Get, Post, UseGuards, Req, Param, Patch, Delete } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetProjectsResponseDto } from './dto/get-projects-response.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ROLES } from '../common/enums/roles.enum';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CreateProjectResponseDto } from './dto/create-project-response.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateProjectMembersDto } from './dto/update-project-members.dto';
import { RequestWithCookies } from '../common/types/request';

@Controller('projects')
@ApiTags('Проекты')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin)
  @ApiOperation({ summary: 'Создание проекта' })
  @ApiResponse({
    status: 200,
    description: 'Проект успешно создан',
    type: [CreateProjectResponseDto],
  })
  @ApiResponse({
    status: 409,
    description: 'Проект с таким именем уже существует',
  })
  async createProject(@Body() createProjectDto: CreateProjectDto, @Req() req: RequestWithCookies) {
    return this.projectsService.createProject(createProjectDto, req.user);
  }

  @Patch(':id/members')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin)
  @ApiOperation({ summary: 'Обновление участников проекта' })
  @ApiResponse({ status: 200, description: 'Участники успешно обновлены' })
  @ApiResponse({ status: 404, description: 'Проект не найден' })
  async updateProjectMembers(
    @Param('id') id: number,
    @Body() updateProjectMembersDto: UpdateProjectMembersDto,
    @Req() req: RequestWithCookies,
  ) {
    return this.projectsService.updateProjectMembers(id, updateProjectMembersDto.members, req.user);
  }

  @Patch(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin)
  @ApiOperation({ summary: 'Обновление проекта' })
  @ApiResponse({ status: 200, description: 'Проект успешно обновлен' })
  @ApiResponse({ status: 404, description: 'Проект не найден' })
  async updateProject(@Param('id') id: number, @Body() updateProjectDto: UpdateProjectDto, @Req() req: RequestWithCookies) {
    return this.projectsService.updateProject(id, updateProjectDto, req.user);
  }

  @Delete(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin)
  @ApiOperation({ summary: 'Удаление проекта' })
  @ApiResponse({ status: 200, description: 'Проект успешно удален' })
  @ApiResponse({ status: 404, description: 'Проект не найден' })
  async deleteProject(@Param('id') id: number, @Req() req: RequestWithCookies) {
    return this.projectsService.deleteProject(id, req.user);
  }

  @Get('with-archived')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin, ROLES.employee, ROLES.guest)
  @ApiOperation({ summary: 'Получить проекты для страницы проектов, включая архивные' })
  @ApiResponse({
    status: 200,
    description: 'Проекты для страницы проектов успешно получены',
    type: [GetProjectsResponseDto],
  })
  getProjectsWithArchived(@Req() req: RequestWithCookies) {
    if (req.user.role === ROLES.admin) {
      return this.projectsService.findProjectsByFilter(true);
    }

    return this.projectsService.getMyProjects(req.user.id, true);
  }

  @Get(':projectId/access')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin, ROLES.employee) // админ и сотрудник могут проверять
  @ApiOperation({ summary: 'Проверить доступ текущего пользователя к проекту' })
  async checkAccess(@Param('projectId') projectId: number, @Req() req: RequestWithCookies) {
    return this.projectsService.checkAccess(req.user.id, projectId);
  }

  @Get('me')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin, ROLES.employee, ROLES.guest)
  @ApiOperation({ summary: 'Получить проекты текущего пользователя' })
  @ApiResponse({
    status: 200,
    description: 'Список проектов, к которым у пользователя есть доступ',
    type: [GetProjectsResponseDto],
  })
  getMyProjects(@Req() req: RequestWithCookies) {
    return this.projectsService.getMyProjects(req.user.id);
  }

  @Get()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ROLES.admin, ROLES.employee)
  @ApiOperation({ summary: 'Получение проектов' })
  @ApiResponse({
    status: 200,
    description: 'Проекты успешно получены',
    type: [GetProjectsResponseDto],
  })
  async findProjectsByFilter() {
    return await this.projectsService.findProjectsByFilter();
  }
}
