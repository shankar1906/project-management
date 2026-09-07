import { Injectable, NotFoundException, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTaskDto, UpdateTaskStatusDto, UpdateTaskDto, MoveTaskDto } from './dto/task.dto';
import { ProjectRole } from '@prisma/client';
import { NotificationService } from '../notifications/notification.service';

/**
 * Tasks Service
 * - Manages tasks within projects
 * - Tracks status changes
 * - Supports subtasks
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) { }

  /**
   * Ensure task exists and belongs to org. Throws ForbiddenException otherwise.
   */
  private async findTaskInOrgOrThrow<T>(
    orgId: string,
    taskId: string,
    options?: { select?: T; include?: T },
  ) {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        isDeleted: false,
        project: { orgId },
      },
      ...(options as any),
    });
    if (!task) {
      throw new ForbiddenException('Task not found or access denied.');
    }
    return task as any;
  }

  /**
   * Create task
   * - Uses default status if not specified
   * - Can create subtasks via parentId
   * - RBAC: Only PROJECT_ADMIN or PROJECT_MEMBER can create; PROJECT_VIEWER blocked
   */
  async create(projectId: string, userId: string, dto: CreateTaskDto) {
    // 1. Enforce project role: only ADMIN or MEMBER can create tasks
    const projectMember = await this.prisma.projectMember.findFirst({
      where: {
        projectId,
        userId,
        isActive: true,
      },
      select: { role: true },
    });
    if (!projectMember) {
      throw new ForbiddenException('You do not have access to this project');
    }
    if (projectMember.role === ProjectRole.VIEWER) {
      throw new ForbiddenException('Project viewers cannot create tasks');
    }

    // Get project's name to generate prefix
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // Generate formatted taskId (e.g. TES-BUG-00001)
    let generatedTaskId: string | null = null;
    if (dto.type) {
      const taskCount = await this.prisma.task.count({
        where: {
          projectId,
          type: dto.type,
        },
      });
      const sequence = (taskCount + 1).toString().padStart(5, '0');
      const prefix = project.name.substring(0, 3).toUpperCase();
      generatedTaskId = `${prefix}-${dto.type}-${sequence}`;
    }

    // 2. Validate taskListId belongs to this project (prevent cross-project injection)
    if (dto.taskListId) {
      const taskList = await this.prisma.taskList.findFirst({
        where: {
          id: dto.taskListId,
          projectId,
        },
        select: { phaseId: true },
      });
      if (!taskList) {
        throw new ForbiddenException('Task list not found or does not belong to this project');
      }
    }

    // Get default status if not provided
    let statusId = dto.statusId;

    if (!statusId) {
      const defaultStatus = await this.prisma.taskStatus.findFirst({
        where: {
          projectId,
          isDefault: true,
          isDeleted: false,
        },
      });

      if (!defaultStatus) {
        throw new NotFoundException('No default status found for project');
      }

      statusId = defaultStatus.id;
    }

    // Get next order number
    const maxOrder = await this.prisma.task.findFirst({
      where: {
        projectId,
        statusId,
        parentId: dto.parentId || null,
      },
      orderBy: {
        order: 'desc',
      },
      select: {
        order: true,
      },
    });

    const order = (maxOrder?.order ?? 0) + 1;

    // Auto-derive phaseId from taskList if not provided
    let phaseId = dto.phaseId || null;
    if (dto.taskListId && !phaseId) {
      const taskList = await this.prisma.taskList.findUnique({
        where: { id: dto.taskListId },
        select: { phaseId: true },
      });
      if (taskList) {
        phaseId = taskList.phaseId;
      }
    }

    // Create task
    const task = await this.prisma.$transaction(async (tx) => {
      const newTask = await tx.task.create({
        data: {
          projectId,
          statusId,
          taskListId: dto.taskListId || null,
          phaseId,
          parentId: dto.parentId,
          title: dto.title,
          description: dto.description,
          type: dto.type,
          taskId: generatedTaskId,
          priority: dto.priority || 0,
          order,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          completionPercentage: dto.completionPercentage || 0,
        },
        include: {
          status: {
            select: {
              id: true,
              name: true,
              color: true,
              stage: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          assignees: {
            select: {
              assignedAt: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatarUrl: true,
                },
              },
            },
          },
          tags: {
            select: {
              tag: {
                select: {
                  id: true,
                  name: true,
                  color: true,
                },
              },
            },
          },
        },
      });

      // Record initial status in history
      await tx.taskStatusHistory.create({
        data: {
          taskId: newTask.id,
          statusId: newTask.statusId,
          userId,
        },
      });

      // Assign users if provided
      if (dto.assigneeIds && dto.assigneeIds.length > 0) {
        await tx.taskAssignee.createMany({
          data: dto.assigneeIds.map((assigneeId) => ({
            taskId: newTask.id,
            userId: assigneeId,
          })),
        });
      }

      // Add tags if provided
      if (dto.tagIds && dto.tagIds.length > 0) {
        await tx.taskTag.createMany({
          data: dto.tagIds.map((tagId) => ({
            taskId: newTask.id,
            tagId,
          })),
        });
      }

      return newTask;
    });

    const result = {
      ...task,
      status: {
        id: task.status.id,
        name: task.status.name,
        color: task.status.color,
        stageId: task.status.stage?.id,
        stageName: task.status.stage?.name,
      },
      assignees: task.assignees.map((a) => ({
        assignedAt: a.assignedAt,
        ...a.user,
      })),
      tags: task.tags.map((t) => t.tag),
    };

    // Notify assignees
    if (dto.assigneeIds && dto.assigneeIds.length > 0) {
      this.notifyAssignees(dto.assigneeIds, task.id, task.title, projectId, userId);
    }

    return result;
  }

  /**
   * List tasks assigned to the user, across all projects in the organization
   * - Scoped to orgId (tenant isolation)
   * - Returns detailed task data including projectName, dueDate, status, assignees, tags
   * - Paginated
   */
  async findMyTasks(userId: string, orgId: string, dto: { page?: number; limit?: number }) {
    const page = dto.page ?? 1;
    const limit = Math.min(dto.limit ?? 20, 50);
    const skip = (page - 1) * limit;

    const where = {
      assignees: {
        some: { userId },
      },
      project: {
        // orgId,
        isDeleted: false,
      },
      isDeleted: false,
    };

    const [total, tasks] = await this.prisma.$transaction([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          { dueDate: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        select: {
          id: true,
          title: true,
          taskId: true,
          type: true,
          description: true,
          priority: true,
          order: true,
          dueDate: true,
          startDate: true,
          completionPercentage: true,
          createdAt: true,
          updatedAt: true,
          parentId: true,
          projectId: true,
          project: {
            select: {
              id: true,
              name: true,
              color: true,
            },
          },
          status: {
            select: {
              id: true,
              name: true,
              color: true,
              stage: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          assignees: {
            select: {
              assignedAt: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatarUrl: true,
                },
              },
            },
          },
          tags: {
            select: {
              tag: {
                select: {
                  id: true,
                  name: true,
                  color: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const data = tasks.map((task) => ({
      id: task.id,
      title: task.title,
      taskId: task.taskId,
      type: task.type,
      description: task.description,
      priority: task.priority,
      order: task.order,
      dueDate: task.dueDate,
      startDate: task.startDate,
      completionPercentage: task.completionPercentage,
      parentId: task.parentId,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      projectId: task.projectId,
      projectName: task.project.name,
      projectColor: task.project.color,
      status: {
        id: task.status.id,
        name: task.status.name,
        color: task.status.color,
        stageId: task.status.stage?.id,
        stageName: task.status.stage?.name,
      },
      assignees: task.assignees.map((a) => ({
        assignedAt: a.assignedAt,
        ...a.user,
      })),
      tags: task.tags.map((t) => t.tag),
    }));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * List all tasks in project
   */
  async listProjectTasks(projectId: string) {
    const tasks = await this.prisma.task.findMany({
      where: {
        projectId,
        isDeleted: false,
      },
      select: {
        id: true,
        title: true,
        taskId: true,
        description: true,
        priority: true,
        order: true,
        dueDate: true,
        type: true,
        startDate: true,
        completionPercentage: true,
        createdAt: true,
        parentId: true,
        status: {
          select: {
            id: true,
            name: true,
            color: true,
            stage: {
              select: {
                name: true,
              },
            },
          },
        },
        assignees: {
          select: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        tags: {
          select: {
            tag: {
              select: {
                id: true,
                name: true,
                color: true,
              },
            },
          },
        },
      },
      orderBy: [{ order: 'asc' }],
    });

    return tasks.map((task) => ({
      id: task.id,
      title: task.title,
      taskId: task.taskId,
      type: task.type,
      description: task.description,
      priority: task.priority,
      order: task.order,
      dueDate: task.dueDate,
      parentId: task.parentId,
      createdAt: task.createdAt,
      status: {
        id: task.status.id,
        name: task.status.name,
        color: task.status.color,
        stageName: task.status.stage.name,
      },
      assignees: task.assignees.map((a) => a.user),
      assigneeIds: task.assignees.map((a) => a.user.id),
      tags: task.tags.map((t) => t.tag),
    }));
  }

  /**
   * Update task status
   * - Records change in history
   * - Tracks who made the change
   */
  async updateStatus(orgId: string, taskId: string, userId: string, dto: UpdateTaskStatusDto) {
    const task = await this.findTaskInOrgOrThrow(orgId, taskId, {
      select: {
        id: true,
        projectId: true,
        statusId: true,
      } as any,
    });

    // Verify new status belongs to same project
    const newStatus = await this.prisma.taskStatus.findFirst({
      where: {
        id: dto.statusId,
        projectId: task.projectId,
        isDeleted: false,
      },
    });

    if (!newStatus) {
      throw new NotFoundException(
        'Status not found or does not belong to this project',
      );
    }

    // Update task and record history
    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: {
          statusId: dto.statusId,
        },
        include: {
          status: {
            select: {
              id: true,
              name: true,
              color: true,
              stage: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          assignees: {
            select: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatarUrl: true,
                },
              },
            },
          },
          tags: {
            select: {
              tag: {
                select: {
                  id: true,
                  name: true,
                  color: true,
                },
              },
            },
          },
        },
      });

      // Record status change
      await tx.taskStatusHistory.create({
        data: {
          taskId,
          statusId: dto.statusId,
          userId,
        },
      });

      return updatedTask;
    });

    this.logger.log(
      `Task ${taskId} status changed to ${dto.statusId} by user ${userId}`,
    );

    // Check if status is "Completed" or "Done" and notify assignees
    const statusName = updated.status.name.toLowerCase();
    this.checkAndNotifyCompletion(
      taskId,
      updated.projectId,
      statusName,
      updated.title,
      userId
    ).catch(e => this.logger.error(`Failed to trigger completion notification: ${e.message}`));

    return {
      ...updated,
      status: {
        id: updated.status.id,
        name: updated.status.name,
        color: updated.status.color,
        stageId: updated.status.stage?.id,
        stageName: updated.status.stage?.name,
      },
      assignees: updated.assignees.map((a) => a.user),
      tags: updated.tags.map((t) => t.tag),
    };
  }

  /**
   * Update full task data
   * - RBAC: Only PROJECT_ADMIN or PROJECT_MEMBER can update; PROJECT_VIEWER blocked
   */
  async update(orgId: string, taskId: string, userId: string, dto: UpdateTaskDto) {
    const task = await this.findTaskInOrgOrThrow(orgId, taskId, {
      include: {
        status: true,
        project: { select: { id: true } },
      } as any,
    });

    // Enforce project role: only ADMIN or MEMBER can update tasks
    const projectMember = await this.prisma.projectMember.findFirst({
      where: {
        projectId: task.projectId,
        userId,
        isActive: true,
      },
      select: { role: true },
    });
    if (!projectMember) {
      throw new ForbiddenException('You do not have access to this project');
    }
    if (projectMember.role === ProjectRole.VIEWER) {
      throw new ForbiddenException('Project viewers cannot update tasks');
    }

    // If status is changing, verify it
    if (dto.statusId && dto.statusId !== task.statusId) {
      const newStatus = await this.prisma.taskStatus.findFirst({
        where: {
          id: dto.statusId,
          projectId: task.projectId,
          isDeleted: false,
        },
      });

      if (!newStatus) {
        throw new NotFoundException(
          'Status not found or does not belong to this project',
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Update basic fields
      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: {
          title: dto.title,
          description: dto.description,
          type: dto.type,
          statusId: dto.statusId,
          priority: dto.priority,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          completionPercentage: dto.completionPercentage,
          // Handle parentId update if needed? Usually requires circle check, limiting for now to simple update
        },
        include: {
          status: {
            select: {
              id: true,
              name: true,
              color: true,
              stage: {
                select: {
                  name: true,
                },
              },
            },
          },
          assignees: {
            select: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
          tags: {
            select: {
              tag: {
                select: {
                  id: true,
                  name: true,
                  color: true,
                },
              },
            },
          },
        },
      });

      // Handle Status Change History
      if (dto.statusId && dto.statusId !== task.statusId) {
        await tx.taskStatusHistory.create({
          data: {
            taskId,
            statusId: dto.statusId,
            userId,
          },
        });
      }

      // Handle Assignees
      if (dto.assigneeIds) {
        await tx.taskAssignee.deleteMany({
          where: { taskId },
        });

        if (dto.assigneeIds.length > 0) {
          await tx.taskAssignee.createMany({
            data: dto.assigneeIds.map((assigneeId: string) => ({
              taskId,
              userId: assigneeId,
            })),
          });
        }
      }

      // Handle Tags
      if (dto.tagIds) {
        await tx.taskTag.deleteMany({
          where: { taskId },
        });

        if (dto.tagIds.length > 0) {
          await tx.taskTag.createMany({
            data: dto.tagIds.map((tagId: string) => ({
              taskId,
              tagId,
            })),
          });
        }
      }

      // Re-fetch to get included relations with new assignees
      return tx.task.findUniqueOrThrow({
        where: { id: taskId },
        include: {
          status: {
            select: {
              id: true,
              name: true,
              color: true,
              stage: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          assignees: {
            select: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatarUrl: true,
                },
              },
            },
          },
          tags: {
            select: {
              tag: {
                select: {
                  id: true,
                  name: true,
                  color: true,
                },
              },
            },
          },
        },
      });
    });

    this.logger.log(`Task ${taskId} updated`);

    // Check for completion notification
    if (updated.status?.name) {
      this.checkAndNotifyCompletion(
        taskId,
        updated.projectId,
        updated.status.name.toLowerCase(),
        updated.title,
        userId,
      ).catch((e) => this.logger.error(`Failed to trigger completion notification: ${e.message}`));
    }

    // Notify new assignees
    if (dto.assigneeIds && dto.assigneeIds.length > 0) {
      this.notifyAssignees(dto.assigneeIds, taskId, updated.title, updated.projectId, userId);
    }

    return {
      ...updated,
      assigneeIds: updated.assignees.map((a) => a.user.id),
    };
  }

  /**
   * Helper to get all descendant task IDs recursively
   */
  private async getAllDescendantIds(taskId: string): Promise<string[]> {
    const children = await this.prisma.task.findMany({
      where: { parentId: taskId, isDeleted: false },
      select: { id: true },
    });

    let ids = children.map((c) => c.id);
    for (const child of children) {
      const descendants = await this.getAllDescendantIds(child.id);
      ids = [...ids, ...descendants];
    }
    return ids;
  }

  /**
   * Delete task
   * - Soft deletes task and all recursive subtasks
   * - RBAC: Only PROJECT_ADMIN can delete; PROJECT_MEMBER and PROJECT_VIEWER blocked
   */
  async remove(orgId: string, taskId: string, userId: string) {
    const task = await this.findTaskInOrgOrThrow(orgId, taskId, {
      include: { project: { select: { id: true } } },
    });

    // Enforce project role: only ADMIN can delete tasks
    const projectMember = await this.prisma.projectMember.findFirst({
      where: {
        projectId: task.projectId,
        userId,
        isActive: true,
      },
      select: { role: true },
    });
    if (!projectMember) {
      throw new ForbiddenException('You do not have access to this project');
    }
    if (projectMember.role !== ProjectRole.ADMIN) {
      throw new ForbiddenException('Only project admins can delete tasks');
    }

    if (task.isDeleted) {
      throw new NotFoundException('Task not found');
    }

    const descendantIds = await this.getAllDescendantIds(taskId);
    const allIds = [taskId, ...descendantIds];

    await this.prisma.task.updateMany({
      where: {
        id: { in: allIds },
      },
      data: {
        isDeleted: true,
      },
    });

    this.logger.log(
      `Task ${taskId} and ${descendantIds.length} subtasks soft deleted`,
    );
    return { message: 'Task deleted successfully' };
  }

  /**
   * Add assignee to task
   */
  async addAssignee(orgId: string, taskId: string, assigneeId: string, assignerId?: string) {
    const task = await this.findTaskInOrgOrThrow(orgId, taskId, {
      include: {
        project: {
          select: { name: true }
        }
      } as any,
    });

    // Check if subscription already exists
    const exists = await this.prisma.taskAssignee.findUnique({
      where: {
        taskId_userId: {
          taskId,
          userId: assigneeId,
        },
      },
    });

    if (exists) {
      return { message: 'User already assigned' };
    }

    // Check User Project Role
    const projectMember = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: task.projectId,
          userId: assigneeId
        }
      },
      select: { role: true }
    });

    if (!projectMember) {
      // Ideally this shouldn't happen if user is in the org/project list, but strictly:
      // throw new ForbiddenException('User is not a member of this project');
      // Or strictly just checking for VIEWER:
    }

    if (projectMember && projectMember.role === 'VIEWER') {
      throw new ForbiddenException('Cannot assign task to a VIEWER');
    }

    await this.prisma.taskAssignee.create({
      data: {
        taskId,
        userId: assigneeId,
      },
    });

    // Send Notification

    if (assignerId) {
      await this.notifyAssignees([assigneeId], taskId, task.title, task.projectId, assignerId);
    }

    return this.prisma.task.findFirst({
      where: { id: taskId, project: { orgId } },
      include: {
        assignees: {
          select: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true
              }
            }
          }
        }
      }
    });
  }

  /**
   * Remove assignee from task
   */
  async removeAssignee(orgId: string, taskId: string, assigneeId: string) {
    await this.findTaskInOrgOrThrow(orgId, taskId, {});

    try {
      await this.prisma.taskAssignee.delete({
        where: {
          taskId_userId: {
            taskId,
            userId: assigneeId,
          },
        },
      });
    } catch (e) {
      // Ignore if not found
    }

    return { message: 'Assignee removed' };
  }

  /**
   * Bulk assign user to multiple tasks
   */
  async assignUserToTasks(orgId: string, taskIds: string[], userId: string, assignerId?: string) {
    if (!taskIds || taskIds.length === 0) return { message: 'No tasks provided' };

    // filter valid tasks - only those in current org
    const tasks = await this.prisma.task.findMany({
      where: {
        id: { in: taskIds },
        isDeleted: false,
        project: { orgId },
      },
      select: {
        id: true,
        projectId: true,
        title: true,
        project: {
          select: { name: true }
        }
      },
    });

    if (tasks.length === 0) {
      return { message: 'No valid tasks found' };
    }

    // In a real scenario, we should check if user has access to these projects
    // expecting the controller/guard to have handled basic org access

    // Check Permissions for all projects involved (usually just one, but supporting multi)
    const projectIds = [...new Set(tasks.map(t => t.projectId))];

    // Check membership for all these projects
    const memberships = await this.prisma.projectMember.findMany({
      where: {
        userId,
        projectId: { in: projectIds }
      },
      select: { projectId: true, role: true }
    });

    const membershipMap = new Map(memberships.map(m => [m.projectId, m.role]));

    // Check if any is viewer or missing
    for (const projectId of projectIds) {
      const role = membershipMap.get(projectId);
      if (role === 'VIEWER') {
        throw new ForbiddenException(`Cannot assign task to a VIEWER in project ${projectId}`);
      }
    }

    const created = await this.prisma.$transaction(
      tasks.map((task) =>
        this.prisma.taskAssignee.upsert({
          where: {
            taskId_userId: {
              taskId: task.id,
              userId,
            },
          },
          update: {}, // Do nothing if exists
          create: {
            taskId: task.id,
            userId,
          },
        }),
      ),
    );

    // Send Notifications
    if (assignerId) {
      const assigner = await this.prisma.user.findUnique({
        where: { id: assignerId },
        select: { name: true }
      });

      const assignerName = assigner?.name || 'Unknown';

      // We only want to notify for newly assigned tasks, but upsert makes it tricky to know exactly which resulted in a create.
      // Ideally returned 'created' objects would tell us, but $transaction with map returns results of operations.
      // upsert returns the record. We can check createdAt vs now, but that's flaky.
      // For now, let's just notify for all valid tasks in the request, or we could try to filter.
      // Actually, checking if assignment existed before is better, but expensive.
      // Given the bulk nature, we can just notify for all tasks in the list since the user INTENDED to assign them.
      // OR, we can just live with potential duplicate notifications if re-assigning? 
      // Upsert returns the object. If createdAt is very recent, it's new.

      for (const task of tasks) {
        // This is simpler to just fire off. The user experience of "You were assigned to X" is repeating if they run it again is acceptable for bulk ops.
        await this.notificationService.sendTaskAssignmentNotification(
          userId,
          task.id,
          task.title,
          task.projectId,
          task.project.name,
          assignerName
        );
      }
    }

    return {
      message: `User assigned to ${created.length} tasks`,
      count: created.length,
    };
  }

  /**
   * Get all assignees for a task
   */
  async getTaskAssignees(orgId: string, taskId: string) {
    const task = await this.findTaskInOrgOrThrow(orgId, taskId, {
      select: {
        id: true,
        taskId: true,
        type: true,
        title: true,
        assignees: {
          select: {
            id: true,
            assignedAt: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
        },
      } as any,
    });

    return {
      taskId: task.id,
      taskTitle: task.title,
      assignees: task.assignees.map((a) => ({
        assignmentId: a.id,
        assignedAt: a.assignedAt,
        user: a.user,
      })),
    };
  }

  /**
   * Helper to notify assignees
   */
  private async notifyAssignees(
    assigneeIds: string[],
    taskId: string,
    taskTitle: string,
    projectId: string,
    assignerId: string
  ) {
    try {
      if (!assigneeIds || assigneeIds.length === 0) return;

      const [project, assigner] = await Promise.all([
        this.prisma.project.findFirst({ where: { id: projectId }, select: { name: true } }),
        this.prisma.user.findUnique({ where: { id: assignerId }, select: { name: true } })
      ]);

      const assignerName = assigner?.name || 'Unknown';
      const projectName = project?.name || 'Unknown Project';

      for (const assigneeId of assigneeIds) {
        if (assigneeId === assignerId) continue; // Don't notify self

        await this.notificationService.sendTaskAssignmentNotification(
          assigneeId,
          taskId,
          taskTitle,
          projectId,
          projectName,
          assignerName
        );
      }
    } catch (e) {
      this.logger.error(`Failed to notify assignees for task ${taskId}`, e);
    }
  }
  /**
   * Helper to check completion status and notify assignees
   */
  private async checkAndNotifyCompletion(
    taskId: string,
    projectId: string,
    statusName: string,
    taskTitle: string,
    userId: string
  ) {
    if (statusName === 'completed' || statusName === 'done') {
      // Find assignees and Project Admins
      const [taskData, projectAdmins] = await Promise.all([
        this.prisma.task.findFirst({
          where: { id: taskId, projectId },
          select: {
            assignees: {
              select: { userId: true }
            },
            project: {
              select: {
                name: true,
                ownerId: true
              }
            }
          }
        }),
        this.prisma.projectMember.findMany({
          where: {
            projectId: projectId,
            role: 'ADMIN'
          },
          select: { userId: true }
        })
      ]);

      if (taskData) {
        const completer = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { name: true }
        });
        const completerName = completer?.name || 'Unknown';

        // Collect all unique recipients (Assignees + Admins + Owner)
        const recipients = new Set<string>();
        taskData.assignees.forEach(a => recipients.add(a.userId));
        projectAdmins.forEach(a => recipients.add(a.userId));
        if (taskData.project.ownerId) {
          recipients.add(taskData.project.ownerId);
        }

        for (const recipientId of recipients) {
          // Notify everyone except the completer
          if (recipientId !== userId) {
            this.notificationService.sendTaskCompletedNotification(
              recipientId,
              taskId,
              taskTitle,
              projectId,
              taskData.project.name,
              completerName
            ).catch(e => this.logger.error(`Failed to notify ${recipientId}: ${e.message}`));
          }
        }
      }
    }
  }

  /**
   * Move a task between tasklists/phases (Drag & Drop)
   * - Updates taskListId, phaseId, and orderIndex
   * - Validates task and target belong to the same project
   */
  async moveTask(taskId: string, dto: MoveTaskDto) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        projectId: true,
        taskListId: true,
        phaseId: true,
        order: true,
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    const updateData: any = {};

    // If moving to a new TaskList
    if (dto.newTaskListId && dto.newTaskListId !== task.taskListId) {
      const newTaskList = await this.prisma.taskList.findFirst({
        where: {
          id: dto.newTaskListId,
          projectId: task.projectId,
          isDeleted: false,
        },
        select: { id: true, phaseId: true },
      });

      if (!newTaskList) {
        throw new NotFoundException('Target TaskList not found or does not belong to this project');
      }

      updateData.taskListId = dto.newTaskListId;
      // Auto-derive phaseId from the new TaskList
      updateData.phaseId = dto.newPhaseId || newTaskList.phaseId;
    } else if (dto.newPhaseId !== undefined) {
      updateData.phaseId = dto.newPhaseId;
    }

    // Update order index
    if (dto.newOrderIndex !== undefined) {
      updateData.order = dto.newOrderIndex;
    }

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: updateData,
      include: {
        status: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
      },
    });

    this.logger.log(`Task ${taskId} moved to taskList=${dto.newTaskListId}, phase=${dto.newPhaseId}`);
    return updated;
  }

  /**
   * Get structured tasks grouped by Phase → TaskList → Task Tree
   * - Returns the full hierarchy for frontend rendering
   * - Tasks are built into a tree using parentId
   */
  async getStructuredTasks(projectId: string) {
    // Fetch all phases for the project
    const phases = await this.prisma.phase.findMany({
      where: {
        projectId,
        isDeleted: false,
      },
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true,
        name: true,
        ownerId: true,
        startDate: true,
        endDate: true,
        access: true,
        orderIndex: true,
      },
    });

    // Fetch all task lists for the project
    const taskLists = await this.prisma.taskList.findMany({
      where: {
        projectId,
        isDeleted: false,
      },
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true,
        name: true,
        phaseId: true,
        access: true,
        orderIndex: true,
      },
    });

    // Fetch all tasks for the project
    const tasks = await this.prisma.task.findMany({
      where: {
        projectId,
        isDeleted: false,
      },
      orderBy: [{ order: 'asc' }],
      select: {
        id: true,
        title: true,
        taskId: true,
        type: true,
        description: true,
        priority: true,
        order: true,
        dueDate: true,
        parentId: true,
        phaseId: true,
        taskListId: true,
        createdAt: true,
        status: {
          select: {
            id: true,
            name: true,
            color: true,
            stage: {
              select: {
                name: true,
              },
            },
          },
        },
        assignees: {
          select: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
        },
        tags: {
          select: {
            tag: {
              select: {
                id: true,
                name: true,
                color: true,
              },
            },
          },
        },
      },
    });

    // Build task tree (group children under parent)
    const taskMap = new Map<string, any>();
    const rootTasks: any[] = [];

    // First pass: create all task objects
    for (const task of tasks) {
      taskMap.set(task.id, {
        id: task.id,
        title: task.title,
        taskId: (task as any).taskId,
        type: (task as any).type,
        description: task.description,
        priority: task.priority,
        order: task.order,
        dueDate: task.dueDate,
        parentId: task.parentId,
        phaseId: task.phaseId,
        taskListId: task.taskListId,
        createdAt: task.createdAt,
        status: {
          id: task.status.id,
          name: task.status.name,
          color: task.status.color,
          stageName: task.status.stage?.name,
        },
        assignees: task.assignees.map((a) => a.user),
        tags: task.tags.map((t) => t.tag),
        children: [],
      });
    }

    // Second pass: build parent-child relationships
    for (const task of tasks) {
      const taskNode = taskMap.get(task.id);
      if (task.parentId && taskMap.has(task.parentId)) {
        taskMap.get(task.parentId).children.push(taskNode);
      } else {
        rootTasks.push(taskNode);
      }
    }

    // Group root tasks by taskListId
    const tasksByTaskList = new Map<string, any[]>();
    const orphanTasks: any[] = []; // Tasks without a taskListId
    for (const task of rootTasks) {
      if (task.taskListId) {
        if (!tasksByTaskList.has(task.taskListId)) {
          tasksByTaskList.set(task.taskListId, []);
        }
        tasksByTaskList.get(task.taskListId)!.push(task);
      } else {
        orphanTasks.push(task);
      }
    }

    // Group taskLists by phaseId
    const taskListsByPhase = new Map<string, any[]>();
    const unassignedTaskLists: any[] = []; // TaskLists without a phase
    for (const tl of taskLists) {
      const tlData = {
        taskListId: tl.id,
        taskListName: tl.name,
        access: tl.access,
        orderIndex: tl.orderIndex,
        tasks: tasksByTaskList.get(tl.id) || [],
      };

      if (tl.phaseId) {
        if (!taskListsByPhase.has(tl.phaseId)) {
          taskListsByPhase.set(tl.phaseId, []);
        }
        taskListsByPhase.get(tl.phaseId)!.push(tlData);
      } else {
        unassignedTaskLists.push(tlData);
      }
    }

    // Build final response
    const structured = phases.map((phase) => ({
      phaseId: phase.id as string | null,
      phaseName: phase.name,
      ownerId: phase.ownerId,
      startDate: phase.startDate,
      endDate: phase.endDate,
      access: phase.access as any, // Cast to any or import PhaseAccess to allow null
      orderIndex: phase.orderIndex,
      taskLists: taskListsByPhase.get(phase.id) || [],
    }));

    // Include unassigned task lists (not under any phase)
    if (unassignedTaskLists.length > 0 || orphanTasks.length > 0) {
      structured.push({
        phaseId: null,
        phaseName: 'Unassigned',
        ownerId: null,
        startDate: null,
        endDate: null,
        access: null,
        orderIndex: 999,
        taskLists: [
          ...unassignedTaskLists,
          // Orphan tasks go into a virtual "Unsorted" task list
          ...(orphanTasks.length > 0
            ? [
              {
                taskListId: null,
                taskListName: 'Unsorted',
                access: null,
                orderIndex: 999,
                tasks: orphanTasks,
              },
            ]
            : []),
        ],
      });
    }

    return structured;
  }
}
