import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    Logger,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePhaseDto } from './dto/create-phase.dto';
import { UpdatePhaseDto } from './dto/update-phase.dto';

/**
 * Phases Service
 * - Manages phases within projects
 * - Phases are time-bounded milestone segments
 * - Supports ordering for drag & drop
 * - Project access: user must be project member OR org admin/owner of the project's org (cross-org allowed)
 */
@Injectable()
export class PhasesService {
    private readonly logger = new Logger(PhasesService.name);

    constructor(private prisma: PrismaService) { }

    /**
     * Assert user has access to project (member or org admin/owner of project's org)
     */
    private async assertProjectAccess(
        userId: string,
        project: { id: string; orgId: string },
    ): Promise<void> {
        const membership = await this.prisma.projectMember.findUnique({
            where: {
                projectId_userId: { projectId: project.id, userId },
            },
            select: { isActive: true },
        });
        if (membership?.isActive) return;

        const orgMember = await this.prisma.orgMember.findUnique({
            where: {
                userId_orgId: { userId, orgId: project.orgId },
            },
            select: { role: true, isActive: true },
        });
        if (
            orgMember?.isActive &&
            (orgMember.role === 'ADMIN' || orgMember.role === 'OWNER')
        ) {
            return;
        }
        throw new ForbiddenException('You do not have access to this project');
    }

    /**
     * Create a new phase inside a project
     * - Auto-calculates orderIndex
     * - Uses project's orgId (user may have access from another org)
     */
    async create(userId: string, dto: CreatePhaseDto) {
        const project = await this.prisma.project.findFirst({
            where: { id: dto.projectId, isDeleted: false },
            select: { id: true, orgId: true },
        });

        if (!project) {
            throw new NotFoundException('Project not found');
        }

        await this.assertProjectAccess(userId, project);

        // Get next orderIndex
        const maxOrder = await this.prisma.phase.findFirst({
            where: {
                projectId: dto.projectId,
                isDeleted: false,
            },
            orderBy: { orderIndex: 'desc' },
            select: { orderIndex: true },
        });

        const orderIndex = (maxOrder?.orderIndex ?? -1) + 1;

        const phase = await this.prisma.$transaction(async (tx) => {
            const newPhase = await tx.phase.create({
                data: {
                    orgId: project.orgId,
                    projectId: dto.projectId,
                    name: dto.name,
                    ownerId: dto.ownerId,
                    startDate: dto.startDate ? new Date(dto.startDate) : undefined,
                    endDate: dto.endDate ? new Date(dto.endDate) : undefined,
                    access: dto.access || 'PRIVATE',
                    orderIndex,
                    status: (dto.status as any) || 'NOT_STARTED',
                    completionPercentage: dto.completionPercentage || 0,
                },
            });

            // Handle Tags
            if (dto.tagIds && dto.tagIds.length > 0) {
                await tx.phaseTag.createMany({
                    data: dto.tagIds.map((tagId) => ({
                        phaseId: newPhase.id,
                        tagId,
                    })),
                });
            }

            // Handle Assignees
            if (dto.assigneeIds && dto.assigneeIds.length > 0) {
                await tx.phaseAssignee.createMany({
                    data: dto.assigneeIds.map((userId) => ({
                        phaseId: newPhase.id,
                        userId,
                    })),
                });
            }

            return tx.phase.findUniqueOrThrow({
                where: { id: newPhase.id },
                include: {
                    tags: { select: { tag: true } },
                    assignees: { select: { user: true } },
                },
            });
        });

        this.logger.log(`Phase "${phase.name}" created in project ${dto.projectId}`);
        return phase;
    }

    /**
     * Get all phases under a project
     * - Ordered by orderIndex
     * - Includes taskList count
     * - User may have access from another org (project member or org admin of project's org)
     */
    async findByProject(userId: string, projectId: string) {
        const project = await this.prisma.project.findFirst({
            where: { id: projectId, isDeleted: false },
            select: { id: true, orgId: true },
        });

        if (!project) {
            throw new NotFoundException('Project not found');
        }

        await this.assertProjectAccess(userId, project);

        const phases = await this.prisma.phase.findMany({
            where: {
                projectId,
                orgId: project.orgId,
                isDeleted: false,
            },
            orderBy: { orderIndex: 'asc' },
            include: {
                taskLists: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                    select: {
                        id: true,
                        name: true,
                        access: true,
                        orderIndex: true,
                        _count: {
                            select: {
                                tasks: {
                                    where: { isDeleted: false },
                                },
                            },
                        },
                    },
                },
                _count: {
                    select: {
                        taskLists: {
                            where: { isDeleted: false },
                        },
                        tasks: {
                            where: { isDeleted: false },
                        },
                    },
                },
            },
        });

        return phases;
    }

    /**
     * Update a phase
     * - Access: user must have access to the phase's project (any org)
     */
    async update(userId: string, phaseId: string, dto: UpdatePhaseDto) {
        const phase = await this.prisma.phase.findFirst({
            where: { id: phaseId, isDeleted: false },
            include: { project: { select: { id: true, orgId: true } } },
        });

        if (!phase) {
            throw new NotFoundException('Phase not found');
        }

        await this.assertProjectAccess(userId, phase.project);

        const updated = await this.prisma.$transaction(async (tx) => {
            const updatedPhase = await tx.phase.update({
                where: { id: phaseId },
                data: {
                    name: dto.name,
                    ownerId: dto.ownerId,
                    startDate: dto.startDate ? new Date(dto.startDate) : undefined,
                    endDate: dto.endDate ? new Date(dto.endDate) : undefined,
                    access: dto.access,
                    status: dto.status as any,
                    completionPercentage: dto.completionPercentage,
                },
            });

            // Handle Tags
            if (dto.tagIds) {
                await tx.phaseTag.deleteMany({ where: { phaseId } });
                if (dto.tagIds.length > 0) {
                    await tx.phaseTag.createMany({
                        data: dto.tagIds.map((tagId) => ({
                            phaseId,
                            tagId,
                        })),
                    });
                }
            }

            // Handle Assignees
            if (dto.assigneeIds) {
                await tx.phaseAssignee.deleteMany({ where: { phaseId } });
                if (dto.assigneeIds.length > 0) {
                    await tx.phaseAssignee.createMany({
                        data: dto.assigneeIds.map((userId) => ({
                            phaseId,
                            userId,
                        })),
                    });
                }
            }

            return tx.phase.findUniqueOrThrow({
                where: { id: phaseId },
                include: {
                    tags: { select: { tag: true } },
                    assignees: { select: { user: true } },
                },
            });
        });

        this.logger.log(`Phase ${phaseId} updated`);
        return updated;
    }

    /**
     * Soft delete a phase
     * - Also soft-deletes associated task lists and sets tasks' phaseId to null
     * - Access: user must have access to the phase's project (any org)
     */
    async remove(userId: string, phaseId: string) {
        const phase = await this.prisma.phase.findFirst({
            where: { id: phaseId, isDeleted: false },
            include: { project: { select: { id: true, orgId: true } } },
        });

        if (!phase) {
            throw new NotFoundException('Phase not found');
        }

        await this.assertProjectAccess(userId, phase.project);

        await this.prisma.$transaction(async (tx) => {
            // Soft delete the phase
            await tx.phase.update({
                where: { id: phaseId },
                data: { isDeleted: true },
            });

            // Soft delete associated task lists
            await tx.taskList.updateMany({
                where: {
                    phaseId,
                    isDeleted: false,
                },
                data: { isDeleted: true },
            });

            // Nullify phaseId on tasks (don't delete tasks, keep them orphaned in tasklist)
            await tx.task.updateMany({
                where: { phaseId },
                data: { phaseId: null },
            });
        });

        this.logger.log(`Phase ${phaseId} soft deleted`);
        return { message: 'Phase deleted successfully' };
    }

    /**
     * Reorder phases within a project
     * - Receives ordered array of phase IDs
     * - Updates orderIndex accordingly
     * - User must have access to the (single) project all phases belong to
     */
    async reorder(userId: string, orderedIds: string[]) {
        if (!orderedIds || orderedIds.length === 0) {
            throw new BadRequestException('orderedIds must not be empty');
        }

        const phases = await this.prisma.phase.findMany({
            where: { id: { in: orderedIds }, isDeleted: false },
            select: { id: true, projectId: true, project: { select: { id: true, orgId: true } } },
        });

        if (phases.length !== orderedIds.length) {
            throw new BadRequestException('Some phase IDs are invalid');
        }

        const projectIds = [...new Set(phases.map((p) => p.projectId))];
        if (projectIds.length > 1) {
            throw new BadRequestException('All phases must belong to the same project');
        }

        await this.assertProjectAccess(userId, phases[0].project);

        await this.prisma.$transaction(
            orderedIds.map((id, index) =>
                this.prisma.phase.update({
                    where: { id },
                    data: { orderIndex: index },
                }),
            ),
        );

        this.logger.log(`Phases reordered for project ${projectIds[0]}`);
        return { message: 'Phases reordered successfully' };
    }
}
