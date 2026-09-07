import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgSettingsService } from '../org-settings/org-settings.service';
import { StartTimerDto, StopTimerDto } from './dto/timers.dto';
import { differenceInMinutes } from 'date-fns';

@Injectable()
export class TimersService {
    private readonly logger = new Logger(TimersService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly orgSettings: OrgSettingsService,
    ) { }

    async startTimer(orgId: string, userId: string, dto: StartTimerDto) {
        const settings = await this.orgSettings.getSettingsForEnforcement(orgId);

        if (settings.requireCheckInForTimer) {
            const activeSession = await this.prisma.attendanceSession.findFirst({
                where: { userId, orgId, checkOut: null },
            });
            if (!activeSession) {
                throw new ForbiddenException('You must check in before starting a timer.');
            }
        }

        const existingTimer = await this.prisma.activeTimer.findUnique({
            where: { userId },
        });

        if (existingTimer && !settings.allowMultipleTimers) {
            throw new BadRequestException('You already have an active timer. Stop it before starting a new one.');
        }

        const hasTask = dto.taskId && dto.projectId;

        if (hasTask) {
            const task = await this.prisma.task.findFirst({
                where: {
                    id: dto.taskId,
                    project: {
                        id: dto.projectId,
                        orgId,
                    },
                },
            });
            if (!task) {
                throw new ForbiddenException('Task or project does not belong to this organization.');
            }
            const membership = await this.prisma.projectMember.findFirst({
                where: { projectId: dto.projectId, userId, isActive: true },
            });
            if (!membership) {
                throw new ForbiddenException('User is not a member of the specified project.');
            }
        }

        return this.prisma.activeTimer.create({
            data: {
                userId,
                orgId,
                projectId: dto.projectId ?? null,
                phaseId: dto.phaseId ?? null,
                taskListId: dto.taskListId ?? null,
                taskId: dto.taskId ?? null,
                startedAt: new Date(),
            },
        });
    }

    async stopTimer(orgId: string, userId: string, dto: StopTimerDto) {
        const activeTimer = await this.prisma.activeTimer.findUnique({
            where: { userId },
        });

        if (!activeTimer) {
            throw new NotFoundException('No active timer found for this user.');
        }

        if (activeTimer.orgId !== orgId) {
            throw new ForbiddenException('Active timer does not belong to this organization.');
        }

        let projectId: string | null = null;
        let taskId: string | null = null;
        let phaseId: string | null;
        let taskListId: string | null;

        if (activeTimer.taskId && activeTimer.projectId) {
            projectId = activeTimer.projectId;
            taskId = activeTimer.taskId;
            phaseId = activeTimer.phaseId;
            taskListId = activeTimer.taskListId;
        } else {
            if (!dto.projectId || !dto.taskId) {
                throw new BadRequestException(
                    'Timer was started without a task. Please provide projectId and taskId when stopping.',
                );
            }
            const task = await this.prisma.task.findFirst({
                where: {
                    id: dto.taskId,
                    project: {
                        id: dto.projectId,
                        orgId,
                    },
                },
            });
            if (!task) {
                throw new ForbiddenException('Task or project does not belong to this organization.');
            }
            const membership = await this.prisma.projectMember.findFirst({
                where: { projectId: dto.projectId, userId, isActive: true },
            });
            if (!membership) {
                throw new ForbiddenException('User is not a member of the specified project.');
            }
            projectId = dto.projectId;
            taskId = dto.taskId;
            phaseId = dto.phaseId ?? task.phaseId ?? null;
            taskListId = dto.taskListId ?? task.taskListId ?? null;
        }

        const endTime = new Date();
        const durationMinutes = differenceInMinutes(endTime, activeTimer.startedAt);

        const timeEntry = await this.prisma.timeEntry.create({
            data: {
                userId,
                orgId: activeTimer.orgId,
                projectId: projectId!,
                phaseId,
                taskListId,
                taskId: taskId!,
                date: activeTimer.startedAt,
                durationMinutes,
                description: dto.description,
                startTime: activeTimer.startedAt,
                endTime,
                status: 'DRAFT',
            },
        });

        await this.prisma.activeTimer.delete({
            where: { id: activeTimer.id },
        });

        await this.upsertWeeklyTimesheet(activeTimer.orgId, userId, activeTimer.startedAt, durationMinutes);

        return timeEntry;
    }

    async getActiveTimer(orgId: string, userId: string) {
        const timer = await this.prisma.activeTimer.findUnique({
            where: { userId },
        });

        if (!timer || timer.orgId !== orgId) return null;

        if (timer.taskId) {
            const task = await this.prisma.task.findUnique({
                where: { id: timer.taskId },
                include: { project: true },
            });
            return {
                ...timer,
                taskTitle: task?.title,
                projectName: task?.project?.name,
            };
        }

        return timer;
    }

    // --- Helper to manage WeeklyTimesheet ---
    private async upsertWeeklyTimesheet(orgId: string, userId: string, date: Date, minutesToAdd: number) {
        // Determine the start of the week (e.g., Monday)
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
        const weekStart = new Date(d.setDate(diff));
        weekStart.setHours(0, 0, 0, 0);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);

        // Find or create the timesheet
        const timesheet = await this.prisma.weeklyTimesheet.findUnique({
            where: {
                orgId_userId_weekStart: {
                    orgId,
                    userId,
                    weekStart,
                },
            },
        });

        if (timesheet) {
            return this.prisma.weeklyTimesheet.update({
                where: { id: timesheet.id },
                data: {
                    totalMinutes: timesheet.totalMinutes + minutesToAdd,
                },
            });
        } else {
            return this.prisma.weeklyTimesheet.create({
                data: {
                    orgId,
                    userId,
                    weekStart,
                    weekEnd,
                    totalMinutes: minutesToAdd,
                },
            });
        }
    }
}

