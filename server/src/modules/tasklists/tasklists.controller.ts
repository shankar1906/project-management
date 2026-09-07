import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Param,
    Body,
    UseGuards,
    Logger,
} from '@nestjs/common';
import { TaskListsService } from './tasklists.service';
import { CreateTaskListDto } from './dto/create-tasklist.dto';
import { UpdateTaskListDto, ReorderTaskListDto } from './dto/update-tasklist.dto';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgGuard } from '../../common/guards/org.guard';
import { OrgId } from '../../common/decorators/org.decorator';

/**
 * TaskLists Controller
 * - CRUD operations for task lists
 * - Reorder support for drag & drop
 *
 * Guard Pipeline: JwtAuthGuard → OrgGuard
 */
@Controller('tasklists')
@UseGuards(JwtAuthGuard, OrgGuard)
export class TaskListsController {
    private readonly logger = new Logger(TaskListsController.name);

    constructor(private readonly taskListsService: TaskListsService) { }

    /**
     * POST /tasklists
     * - Create a new task list
     */
    @Post()
    async create(
        @OrgId() orgId: string,
        @Body() dto: CreateTaskListDto,
    ) {
        this.logger.log(`Creating tasklist in project ${dto.projectId}`);
        return this.taskListsService.create(orgId, dto);
    }

    /**
     * GET /tasklists/by-project/:projectId
     * - List all task lists in a project
     */
    @Get('by-project/:projectId')
    async findByProject(
        @OrgId() orgId: string,
        @Param('projectId') projectId: string,
    ) {
        return this.taskListsService.findByProject(orgId, projectId);
    }

    /**
     * GET /tasklists/by-phase/:phaseId
     * - List all task lists in a phase
     */
    @Get('by-phase/:phaseId')
    async findByPhase(
        @OrgId() orgId: string,
        @Param('phaseId') phaseId: string,
    ) {
        return this.taskListsService.findByPhase(orgId, phaseId);
    }



    /**
     * PATCH /tasklists/reorder
     * - Reorder task lists via drag & drop
     */
    @Patch('reorder')
    async reorder(
        @OrgId() orgId: string,
        @Body() dto: ReorderTaskListDto,
    ) {
        this.logger.log(`Reordering tasklists`);
        return this.taskListsService.reorder(orgId, dto.orderedIds);
    }

    /**
     * PATCH /tasklists/:taskListId
     * - Update a task list
     */
    @Patch(':taskListId')
    async update(
        @OrgId() orgId: string,
        @Param('taskListId') taskListId: string,
        @Body() dto: UpdateTaskListDto,
    ) {
        this.logger.log(`Updating tasklist ${taskListId}`);
        return this.taskListsService.update(orgId, taskListId, dto);
    }

    /**
     * DELETE /tasklists/:taskListId
     * - Soft delete a task list
     */
    @Delete(':taskListId')
    async remove(
        @OrgId() orgId: string,
        @Param('taskListId') taskListId: string,
    ) {
        this.logger.log(`Deleting tasklist ${taskListId}`);
        return this.taskListsService.remove(orgId, taskListId);
    }

}
