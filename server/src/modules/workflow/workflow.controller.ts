import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { CreateStageDto, CreateStatusDto } from './dto/workflow.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgGuard } from '../../common/guards/org.guard';
import { ProjectGuard } from '../../common/guards/project.guard';

/**
 * Workflow Controller
 * - Manage custom workflows
 * - Create stages (columns)
 * - Create statuses (cards within columns)
 *
 * Guard Pipeline: JwtAuthGuard → OrgGuard → ProjectGuard
 */
@Controller('projects/:projectId')
@UseGuards(JwtAuthGuard, OrgGuard, ProjectGuard)
export class WorkflowController {
  private readonly logger = new Logger(WorkflowController.name);

  constructor(private readonly workflowService: WorkflowService) {}

  /**
   * GET /projects/:projectId/workflow
   * - Gets complete workflow for project
   */
  @Get('workflow')
  async getWorkflow(@Param('projectId') projectId: string) {
    return this.workflowService.getProjectWorkflow(projectId);
  }

  /**
   * POST /projects/:projectId/stages
   * - Creates new stage (column)
   */
  @Post('stages')
  async createStage(
    @Param('projectId') projectId: string,
    @Body() dto: CreateStageDto,
  ) {
    this.logger.log(`Creating stage in project ${projectId}`);
    return this.workflowService.createStage(projectId, dto);
  }

  /**
   * POST /projects/:projectId/statuses
   * - Creates new status (card in stage)
   */
  @Post('statuses')
  async createStatus(
    @Param('projectId') projectId: string,
    @Body() dto: CreateStatusDto,
  ) {
    this.logger.log(`Creating status in project ${projectId}`);
    return this.workflowService.createStatus(projectId, dto);
  }
}
