import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Logger,
  Query,
  Patch,
  Delete,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
import { FilterProjectDto } from './dto/filter-project.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgGuard } from '../../common/guards/org.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrgId, UserId } from '../../common/decorators/org.decorator';
import { OrgRole } from '@prisma/client';

/**
 * Projects Controller
 * - Create projects (ADMIN/OWNER only)
 * - List projects (all members)
 * - Get project details
 *
 * Guard Pipeline: JwtAuthGuard → OrgGuard → RolesGuard
 */
@Controller('projects')
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name);

  constructor(private readonly projectsService: ProjectsService) { }

  /**
   * POST /projects
   * - Only ADMIN/OWNER can create projects
   * - Creator automatically becomes project ADMIN
   */
  @Post()
  
  @Roles(OrgRole.ADMIN, OrgRole.OWNER)
  async create(
    @OrgId() orgId: string,
    @UserId() userId: string,
    @Body() createProjectDto: CreateProjectDto,
  ) {
    this.logger.log(`Creating project in org ${orgId}`);
    console.log("createProjectDto", createProjectDto);
    return this.projectsService.create(orgId, userId, createProjectDto);
  }

  /**
   * GET /projects
   * - Lists all projects user has access to in current org
   */

  @Get()
  async list(
    @OrgId() orgId: string,
    @UserId() userId: string,
    @Query() query: FilterProjectDto,
  ) {
    return this.projectsService.searchProjects(userId, orgId, query);
  }

  // @Get('all')
  // async listAll(
  //   @UserId() userId: string,
  //   @Query() query: FilterProjectDto,
  // ) {
  //   return this.projectsService.searchProjects(userId, '', query);
  // }

  /**
   * GET /projects/:id
   * - Gets project details
   */
  @Get(':id')
  async get(
    @Param('id') projectId: string,
    @OrgId() orgId: string,
    @UserId() userId: string,
  ) {
    return this.projectsService.getProject(projectId, orgId, userId);
  }

  /**
   * GET /projects/:id/members
   * - Get all members of a project
   */
  @Get(':id/members')
  async getMembers(
    @Param('id') projectId: string,
    @OrgId() orgId: string,
    @UserId() userId: string,
  ) {
    return this.projectsService.getProjectMembers(projectId, orgId, userId);
  }

  /**
   * PATCH /projects/:id
   * - Update project details
   * - User must be Project Owner or Org Admin or Project Admin
   */
  @Patch(':id')
  async update(
    @Param('id') projectId: string,
    @OrgId() orgId: string,
    @UserId() userId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    this.logger.log(`User ${userId} updating project ${projectId}`);
    return this.projectsService.update(projectId, orgId, userId, dto);
  }

  /**
   * DELETE /projects/:id
   * - Soft delete project (Project Owner only)
   */
  @Delete(':id')
  async delete(
    @Param('id') projectId: string,
    @OrgId() orgId: string,
    @UserId() userId: string,
  ) {
    this.logger.log(`User ${userId} deleting project ${projectId}`);
    return this.projectsService.delete(projectId, orgId, userId);
  }
}
