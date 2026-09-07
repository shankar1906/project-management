import {
    Injectable,
    NotFoundException,
    Logger,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTaskListDto } from './dto/create-tasklist.dto';
import { UpdateTaskListDto } from './dto/update-tasklist.dto';

/**
 * TaskLists Service
 * - Manages task lists (buckets) within phases/projects
 * - Supports ordering for drag & drop
 */
@Injectable()
export class TaskListsService {
    private readonly logger = new Logger(TaskListsService.name);

    constructor(private prisma: PrismaService) { }

    /**
     * Create a new task list
     * - Can be associated with a phase or directly with a project
     * - Auto-calculates orderIndex
     */
    async create(orgId: string, dto: CreateTaskListDto) {
        // Verify project exists and belongs to org
        const project = await this.prisma.project.findFirst({
            where: {
                id: dto.projectId,
                orgId,
                isDeleted: false,
            },
        });

        if (!project) {
            throw new NotFoundException('Project not found');
        }

        // If phaseId provided, verify it exists and belongs to same project
        if (dto.phaseId) {
            const phase = await this.prisma.phase.findFirst({
                where: {
                    id: dto.phaseId,
                    projectId: dto.projectId,
                    orgId,
                    isDeleted: false,
                },
            });

            if (!phase) {
                throw new NotFoundException('Phase not found or does not belong to this project');
            }
        }

        // Get next orderIndex (scoped to phase if present, otherwise project-level)
        const maxOrder = await this.prisma.taskList.findFirst({
            where: {
                projectId: dto.projectId,
                phaseId: dto.phaseId || null,
                isDeleted: false,
            },
            orderBy: { orderIndex: 'desc' },
            select: { orderIndex: true },
        });

        const orderIndex = (maxOrder?.orderIndex ?? -1) + 1;

        const taskList = await this.prisma.$transaction(async (tx) => {
            const newTaskList = await tx.taskList.create({
                data: {
                    orgId,
                    projectId: dto.projectId,
                    phaseId: dto.phaseId || null,
                    name: dto.name,
                    access: dto.access || 'PRIVATE',
                    orderIndex,
                },
            });

            // Handle Tags
            if (dto.tagIds && dto.tagIds.length > 0) {
                await tx.taskListTag.createMany({
                    data: dto.tagIds.map((tagId) => ({
                        taskListId: newTaskList.id,
                        tagId,
                    })),
                });
            }

            return newTaskList;
        });

        this.logger.log(`TaskList "${taskList.name}" created in project ${dto.projectId}`);
        return taskList;
    }

    /**
     * Get all task lists under a project
     */
    async findByProject(orgId: string, projectId: string) {
        const project = await this.prisma.project.findFirst({
            where: {
                id: projectId,
                orgId,
                isDeleted: false,
            },
        });

        if (!project) {
            throw new NotFoundException('Project not found');
        }

        const taskLists = await this.prisma.taskList.findMany({
            where: {
                projectId,
                orgId,
                isDeleted: false,
            },
            orderBy: { orderIndex: 'asc' },
            include: {
                phase: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                tags: {
                    select: {
                        tag: true,
                    },
                },
                _count: {
                    select: {
                        tasks: {
                            where: { isDeleted: false },
                        },
                    },
                },
            },
        });

        return taskLists;
    }

    /**
     * Get all task lists under a specific phase
     */
    async findByPhase(orgId: string, phaseId: string) {
        const phase = await this.prisma.phase.findFirst({
            where: {
                id: phaseId,
                orgId,
                isDeleted: false,
            },
        });

        if (!phase) {
            throw new NotFoundException('Phase not found');
        }

        const taskLists = await this.prisma.taskList.findMany({
            where: {
                phaseId,
                orgId,
                isDeleted: false,
            },
            orderBy: { orderIndex: 'asc' },
            include: {
                tags: {
                    select: {
                        tag: true,
                    },
                },
                _count: {
                    select: {
                        tasks: {
                            where: { isDeleted: false },
                        },
                    },
                },
            },
        });

        return taskLists;
    }

    /**
     * Update a task list
     */
    async update(orgId: string, taskListId: string, dto: UpdateTaskListDto) {
        const taskList = await this.prisma.taskList.findFirst({
            where: {
                id: taskListId,
                orgId,
                isDeleted: false,
            },
        });

        if (!taskList) {
            throw new NotFoundException('TaskList not found');
        }

        // If changing phase, verify new phase belongs to same project
        if (dto.phaseId && dto.phaseId !== taskList.phaseId) {
            const phase = await this.prisma.phase.findFirst({
                where: {
                    id: dto.phaseId,
                    projectId: taskList.projectId,
                    orgId,
                    isDeleted: false,
                },
            });

            if (!phase) {
                throw new NotFoundException('Phase not found or does not belong to this project');
            }
        }

        const updateData: any = {};
        if (dto.name !== undefined) updateData.name = dto.name;
        if (dto.access !== undefined) updateData.access = dto.access;
        if (dto.phaseId !== undefined) updateData.phaseId = dto.phaseId;

        const updated = await this.prisma.$transaction(async (tx) => {
            const updatedTaskList = await tx.taskList.update({
                where: { id: taskListId },
                data: updateData,
            });

            // If phaseId changed, update denormalized phaseId on all tasks in this list
            if (dto.phaseId !== undefined && dto.phaseId !== taskList.phaseId) {
                await tx.task.updateMany({
                    where: {
                        taskListId,
                        isDeleted: false,
                    },
                    data: { phaseId: dto.phaseId },
                });
            }

            // Handle Tags
            if (dto.tagIds) {
                await tx.taskListTag.deleteMany({ where: { taskListId } });
                if (dto.tagIds.length > 0) {
                    await tx.taskListTag.createMany({
                        data: dto.tagIds.map((tagId) => ({
                            taskListId,
                            tagId,
                        })),
                    });
                }
            }

            return updatedTaskList;
        });

        this.logger.log(`TaskList ${taskListId} updated`);
        return updated;
    }

    /**
     * Soft delete a task list
     * - Tasks remain but lose their taskListId reference
     */
    async remove(orgId: string, taskListId: string) {
        const taskList = await this.prisma.taskList.findFirst({
            where: {
                id: taskListId,
                orgId,
                isDeleted: false,
            },
        });

        if (!taskList) {
            throw new NotFoundException('TaskList not found');
        }

        await this.prisma.$transaction(async (tx) => {
            // Soft delete the task list
            await tx.taskList.update({
                where: { id: taskListId },
                data: { isDeleted: true },
            });

            // Nullify taskListId on tasks (keep tasks, they become unassigned)
            await tx.task.updateMany({
                where: {
                    taskListId,
                    isDeleted: false,
                },
                data: { taskListId: null, phaseId: null },
            });
        });

        this.logger.log(`TaskList ${taskListId} soft deleted`);
        return { message: 'TaskList deleted successfully' };
    }

    /**
     * Reorder task lists
     * - Receives ordered array of taskList IDs
     * - Updates orderIndex accordingly
     */
    async reorder(orgId: string, orderedIds: string[]) {
        if (!orderedIds || orderedIds.length === 0) {
            throw new BadRequestException('orderedIds must not be empty');
        }

        // Verify all task lists belong to same org
        const taskLists = await this.prisma.taskList.findMany({
            where: {
                id: { in: orderedIds },
                orgId,
                isDeleted: false,
            },
            select: { id: true, projectId: true },
        });

        if (taskLists.length !== orderedIds.length) {
            throw new BadRequestException('Some taskList IDs are invalid');
        }

        await this.prisma.$transaction(
            orderedIds.map((id, index) =>
                this.prisma.taskList.update({
                    where: { id },
                    data: { orderIndex: index },
                }),
            ),
        );

        this.logger.log(`TaskLists reordered`);
        return { message: 'TaskLists reordered successfully' };
    }
}
