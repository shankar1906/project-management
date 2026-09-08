import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto, UpdateTaskStatusDto, UpdateTaskDto, AddAssigneeDto, BulkAssignDto, MyTasksQueryDto, MoveTaskDto } from './dto/task.dto';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgGuard } from '../../common/guards/org.guard';
import { ProjectGuard } from '../../common/guards/project.guard';
import { UserId, OrgId } from '../../common/decorators/org.decorator';

/**
 * Tasks Controller
 * - Create tasks
 * - Update task status
 * - List tasks in project
 *
 * Guard Pipeline: JwtAuthGuard → OrgGuard → ProjectGuard
 */
@Controller()
@UseGuards(JwtAuthGuard, OrgGuard)
export class TasksController {
  private readonly logger = new Logger(TasksController.name);

  constructor(private readonly tasksService: TasksService) { }

  /**
   * POST /projects/:projectId/tasks
   * - Creates task in project
   */
  @Post('projects/:projectId/tasks')
  @UseGuards(ProjectGuard)
  async create(
    @Param('projectId') projectId: string,
    @UserId() userId: string,
    @Body() createTaskDto: CreateTaskDto,
  ) {
    this.logger.log(`Creating task in project ${projectId}`);
    return this.tasksService.create(projectId, userId, createTaskDto);
  }

  /**
   * GET /projects/:projectId/tasks
   * - Lists all tasks in project
   */
  @Get('projects/:projectId/tasks')
  @UseGuards(ProjectGuard)
  async list(@Param('projectId') projectId: string) {
    return this.tasksService.listProjectTasks(projectId);
  }

  /**
   * GET /projects/:projectId/tasks-structured
   * - Returns tasks grouped by Phase → TaskList → Task Tree
   */
  @Get('projects/:projectId/tasks-structured')
  @UseGuards(ProjectGuard)
  async getStructured(@Param('projectId') projectId: string) {
    return this.tasksService.getStructuredTasks(projectId);
  }

  /**
   * GET /tasks/my-tasks
   * - Lists all tasks assigned to the current user across all projects in the org
   * - Returns detailed data (projectName, dueDate, status, assignees, tags)
   * - Paginated
   */
  @Get('tasks/my-tasks')
  async findMyTasks(
    @UserId() userId: string,
    @OrgId() orgId: string,
    @Query() query: MyTasksQueryDto,
  ) {
    this.logger.log(`Fetching my tasks for user ${userId}`);
    return this.tasksService.findMyTasks(userId, orgId, query);
  }

  /**
   * GET /tasks/user/:userId
   * - Lists all tasks assigned to a specific user across all projects in the org
   */
  @Get('tasks/user/:userId')
  async findUserTasks(
    @Param('userId') targetUserId: string,
    @OrgId() orgId: string,
    @Query() query: MyTasksQueryDto,
  ) {
    this.logger.log(`Fetching tasks for user ${targetUserId}`);
    return this.tasksService.findMyTasks(targetUserId, orgId, query);
  }

  /**
   * PATCH /tasks/:id/status
   * - Updates task status
   * - Records status change in history
   */
  @Patch('tasks/:id/status')
  async updateStatus(
    @OrgId() orgId: string,
    @Param('id') taskId: string,
    @UserId() userId: string,
    @Body() updateStatusDto: UpdateTaskStatusDto,
  ) {
    this.logger.log(`Updating task ${taskId} status`);
    return this.tasksService.updateStatus(orgId, taskId, userId, updateStatusDto);
  }

  /**
   * PATCH /tasks/:id
   * - Updates task details
   */
  @Patch('tasks/:id')
  async update(
    @OrgId() orgId: string,
    @Param('id') taskId: string,
    @UserId() userId: string,
    @Body() updateTaskDto: UpdateTaskDto,
  ) {
    this.logger.log(`Updating task ${taskId}`);
    return this.tasksService.update(orgId, taskId, userId, updateTaskDto);
  }

  /**
   * DELETE /tasks/:id
   * - Deletes task and its subtasks (PROJECT_ADMIN only)
   */
  @Delete('tasks/:id')
  async remove(
    @OrgId() orgId: string,
    @Param('id') taskId: string,
    @UserId() userId: string,
  ) {
    this.logger.log(`Deleting task ${taskId}`);
    return this.tasksService.remove(orgId, taskId, userId);
  }

  /**
   * PATCH /tasks/:id/move
   * - Move task between tasklists/phases (drag & drop)
   */
  @Patch('tasks/:id/move')
  async moveTask(
    @OrgId() orgId: string,
    @Param('id') taskId: string,
    @Body() moveTaskDto: MoveTaskDto,
  ) {
    this.logger.log(`Moving task ${taskId}`);
    return this.tasksService.moveTask(taskId, moveTaskDto);
  }

  /**
   * POST /tasks/:id/assignees
   * - Add assignee to task
   */
  @Post('tasks/:id/assignees')
  async addAssignee(
    @OrgId() orgId: string,
    @Param('id') taskId: string,
    @Body() dto: AddAssigneeDto,
    @UserId() assignerId: string,
  ) {
    return this.tasksService.addAssignee(orgId, taskId, dto.userId, assignerId);
  }

  /**
   * POST /tasks/bulk-assign
   * - Assign user to multiple tasks
   */
  @Post('tasks/bulk-assign')
  async bulkAssign(
    @OrgId() orgId: string,
    @Body() dto: BulkAssignDto,
    @UserId() assignerId: string,
  ) {
    return this.tasksService.assignUserToTasks(orgId, dto.taskIds, dto.userId, assignerId);
  }

  /**
   * GET /tasks/:id/assignees
   * - Get all assignees for a task
   */
  @Get('tasks/:id/assignees')
  async getAssignees(
    @OrgId() orgId: string,
    @Param('id') taskId: string,
  ) {
    return this.tasksService.getTaskAssignees(orgId, taskId);
  }

  /**
   * DELETE /tasks/:id/assignees/:userId
   * - Remove assignee from task
   */
  @Delete('tasks/:id/assignees/:userId')
  async removeAssignee(
    @OrgId() orgId: string,
    @Param('id') taskId: string,
    @Param('userId') userId: string,
  ) {
    return this.tasksService.removeAssignee(orgId, taskId, userId);
  }
}
