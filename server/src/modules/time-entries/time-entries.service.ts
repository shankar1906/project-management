import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgSettingsService } from '../org-settings/org-settings.service';
import { CreateTimeEntryDto, UpdateTimeEntryDto } from './dto/time-entries.dto';

@Injectable()
export class TimeEntriesService {
    private readonly logger = new Logger(TimeEntriesService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly orgSettings: OrgSettingsService,
    ) {}

    async create(orgId: string, userId: string, dto: CreateTimeEntryDto) {
        const settings = await this.orgSettings.getSettingsForEnforcement(orgId);
        if (!settings.allowManualTimeEntry) {
            throw new ForbiddenException('Manual time entry is disabled for your organization. Please use the timer instead.');
        }

        // Validate task belongs to org (project.orgId === orgId)
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
            throw new ForbiddenException('The selected task or project could not be found in your organization.');
        }

        // Calculate defaults
        const entryDate = dto.date ? new Date(dto.date) : new Date();
        const billable = dto.billable !== undefined ? dto.billable : true;
        
        let durationMinutes = dto.durationMinutes || 0;

        // Calculate duration if startTime & endTime exist
        if (dto.startTime && dto.endTime) {
            const start = new Date(dto.startTime);
            const end = new Date(dto.endTime);
            durationMinutes = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
            
            // Overlap validation
            await this.validateOverlap(userId, orgId, start, end);
        }

        if (durationMinutes <= 0 && !dto.startTime) {
            throw new BadRequestException('Please provide a valid duration or specify a start and end time.');
        }

        const timeEntry = await this.prisma.timeEntry.create({
            data: {
                userId,
                orgId,
                projectId: dto.projectId,
                phaseId: dto.phaseId,
                taskListId: dto.taskListId,
                taskId: dto.taskId,
                date: entryDate,
                durationMinutes,
                description: dto.description,
                billable,
                startTime: dto.startTime ? new Date(dto.startTime) : undefined,
                endTime: dto.endTime ? new Date(dto.endTime) : undefined,
            },
        });

        await this.upsertWeeklyTimesheet(orgId, userId, entryDate, durationMinutes);

        return timeEntry;
    }

    async update(id: string, userId: string, orgId: string, dto: UpdateTimeEntryDto) {
        const existing = await this.prisma.timeEntry.findFirst({
            where: {
                id,
                userId,
                orgId,
            },
        });

        if (!existing) {
            throw new ForbiddenException("We couldn't find that time entry, or you don't have permission to modify it.");
        }

        await this.assertTimesheetNotLocked(orgId, userId, existing.date);

        // Calculate new duration if times are updated
        let newDurationMinutes = dto.durationMinutes !== undefined ? dto.durationMinutes : existing.durationMinutes;
        const newStartTime = dto.startTime ? new Date(dto.startTime) : existing.startTime;
        const newEndTime = dto.endTime ? new Date(dto.endTime) : existing.endTime;

        if (newStartTime && newEndTime) {
            await this.validateOverlap(userId, orgId, newStartTime, newEndTime, id);
            
            // If either time was explicitly provided in DTO, recalculate the duration
            if (dto.startTime || dto.endTime) {
                newDurationMinutes = Math.round((newEndTime.getTime() - newStartTime.getTime()) / (1000 * 60));
            }
        }

        const updated = await this.prisma.timeEntry.update({
            where: { id: existing.id },
            data: {
                durationMinutes: newDurationMinutes,
                description: dto.description,
                billable: dto.billable,
                startTime: dto.startTime ? new Date(dto.startTime) : undefined,
                endTime: dto.endTime ? new Date(dto.endTime) : undefined,
            },
        });

        // Update Timesheet diff if duration changed
        if (newDurationMinutes !== existing.durationMinutes) {
            const diff = newDurationMinutes - existing.durationMinutes;
            await this.upsertWeeklyTimesheet(existing.orgId, userId, existing.date, diff);
        }

        return updated;
    }

    async remove(id: string, userId: string, orgId: string) {
        const existing = await this.prisma.timeEntry.findFirst({
            where: {
                id,
                userId,
                orgId,
            },
        });

        if (!existing) {
            throw new ForbiddenException("We couldn't find that time entry, or you don't have permission to delete it.");
        }

        await this.assertTimesheetNotLocked(orgId, userId, existing.date);

        await this.prisma.timeEntry.delete({
            where: { id: existing.id },
        });

        // Subtract from weekly timesheet
        await this.upsertWeeklyTimesheet(existing.orgId, userId, existing.date, -existing.durationMinutes);

        return { message: 'Time entry deleted' };
    }

    async findAll(orgId: string, userId: string, date?: string, taskId?: string) {
        const whereClause: any = { orgId, userId };
        
        if (date) {
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);

            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);

            whereClause.startTime = {
                gte: startOfDay,
                lte: endOfDay,
            };
        }

        if (taskId) {
            whereClause.taskId = taskId;
        }

        return this.prisma.timeEntry.findMany({
            where: whereClause,
            orderBy: { startTime: 'desc' },
        });
    }

    /**
     * Overlap validation scoped to org for this user.
     */
    private async validateOverlap(userId: string, orgId: string, start: Date, end: Date, excludeId?: string) {
        if (start >= end) {
            throw new BadRequestException('The start time must be earlier than the end time.');
        }

        const whereClause: any = {
            userId,
            orgId,
            startTime: { not: null },
            endTime: { not: null },
            OR: [
                {
                    startTime: { lt: end },
                    endTime: { gt: start },
                },
            ],
        };

        if (excludeId) {
            whereClause.id = { not: excludeId };
        }

        const overlapping = await this.prisma.timeEntry.findFirst({
            where: whereClause,
        });

        if (overlapping) {
            throw new BadRequestException('This time slot is already taken by another entry. Please choose a different time range.');
        }
    }

    /** Throw if org has lockTimesheetAfterApproval and the week's timesheet is approved */
    private async assertTimesheetNotLocked(orgId: string, userId: string, date: Date) {
        const settings = await this.orgSettings.getSettingsForEnforcement(orgId);
        if (!settings.lockTimesheetAfterApproval) return;
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const weekStart = new Date(d.setDate(diff));
        weekStart.setHours(0, 0, 0, 0);
        const timesheet = await this.prisma.weeklyTimesheet.findUnique({
            where: {
                orgId_userId_weekStart: { orgId, userId, weekStart },
            },
            select: { status: true },
        });
        if (timesheet?.status === 'APPROVED') {
            throw new ForbiddenException('This timesheet has already been approved and is locked for any further changes.');
        }
    }

    private async upsertWeeklyTimesheet(orgId: string, userId: string, date: Date, minutesToAdd: number) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const weekStart = new Date(d.setDate(diff));
        weekStart.setHours(0, 0, 0, 0);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);

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

