import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStageDto, CreateStatusDto } from './dto/workflow.dto';

/**
 * Workflow Service
 * - Manages data-driven workflow
 * - Stages (columns in Kanban)
 * - Statuses (cards within columns)
 */
@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get complete workflow for project
   * Returns stages with nested statuses
   */
  async getProjectWorkflow(projectId: string) {
    const stages = await this.prisma.taskStage.findMany({
      where: {
        projectId,
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        order: true,
        color: true,
        statuses: {
          where: {
            isDeleted: false,
          },
          select: {
            id: true,
            name: true,
            order: true,
            color: true,
            isDefault: true,
          },
          orderBy: {
            order: 'asc',
          },
        },
      },
      orderBy: {
        order: 'asc',
      },
    });

    return stages;
  }

  /**
   * Create new stage
   */
  async createStage(projectId: string, dto: CreateStageDto) {
    // Get next order number
    const maxOrder = await this.prisma.taskStage.findFirst({
      where: { projectId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    const order = (maxOrder?.order ?? 0) + 1;

    const stage = await this.prisma.taskStage.create({
      data: {
        projectId,
        name: dto.name,
        order,
        color: dto.color,
      },
    });

    this.logger.log(`Created stage ${stage.id} in project ${projectId}`);

    return {
      id: stage.id,
      name: stage.name,
      order: stage.order,
      color: stage.color,
    };
  }

  /**
   * Create new status
   */
  async createStatus(projectId: string, dto: CreateStatusDto) {
    // Verify stage exists in project
    const stage = await this.prisma.taskStage.findFirst({
      where: {
        id: dto.stageId,
        projectId,
        isDeleted: false,
      },
    });

    if (!stage) {
      throw new NotFoundException('Stage not found in this project');
    }

    // Get next order number within stage
    const maxOrder = await this.prisma.taskStatus.findFirst({
      where: {
        stageId: dto.stageId,
      },
      orderBy: {
        order: 'desc',
      },
      select: {
        order: true,
      },
    });

    const order = (maxOrder?.order ?? 0) + 1;

    // If this is default, unset other defaults
    if (dto.isDefault) {
      await this.prisma.taskStatus.updateMany({
        where: {
          projectId,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      });
    }

    const status = await this.prisma.taskStatus.create({
      data: {
        projectId,
        stageId: dto.stageId,
        name: dto.name,
        order,
        color: dto.color,
        isDefault: dto.isDefault || false,
      },
    });

    this.logger.log(`Created status ${status.id} in stage ${dto.stageId}`);

    return {
      id: status.id,
      name: status.name,
      order: status.order,
      color: status.color,
      isDefault: status.isDefault,
    };
  }
}
