import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgSettingsService } from '../org-settings/org-settings.service';
import { ApproveTimesheetDto, SubmitTimesheetDto, TimesheetStatus } from './dto/timesheets.dto';

@Injectable()
export class TimesheetsService {
    private readonly logger = new Logger(TimesheetsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly orgSettings: OrgSettingsService,
    ) {}

    async getTimesheets(orgId: string, userId: string) {
        return this.prisma.weeklyTimesheet.findMany({
            where: { orgId, userId },
            orderBy: { weekStart: 'desc' },
        });
    }

    async submitTimesheet(orgId: string, userId: string, dto: SubmitTimesheetDto) {
        const timesheet = await this.prisma.weeklyTimesheet.findUnique({
            where: {
                orgId_userId_weekStart: {
                    orgId,
                    userId,
                    weekStart: new Date(dto.weekStart),
                },
            },
        });

        if (!timesheet) {
            throw new NotFoundException('Timesheet not found for this week.');
        }

        if (timesheet.status === TimesheetStatus.APPROVED) {
            throw new BadRequestException('Timesheet is already approved.');
        }

        return this.prisma.weeklyTimesheet.update({
            where: { id: timesheet.id },
            data: {
                status: TimesheetStatus.SUBMITTED,
                submittedAt: new Date(),
            },
        });
    }

    async approveTimesheet(orgId: string, managerUserId: string, userIdToApprove: string, dto: ApproveTimesheetDto) {
        const timesheet = await this.prisma.weeklyTimesheet.findUnique({
            where: {
                orgId_userId_weekStart: {
                    orgId,
                    userId: userIdToApprove,
                    weekStart: new Date(dto.weekStart),
                },
            },
        });

        if (!timesheet) {
            throw new NotFoundException('Timesheet not found for this week.');
        }

        if (timesheet.status === TimesheetStatus.APPROVED && dto.status === TimesheetStatus.APPROVED) {
            throw new BadRequestException('Timesheet is already approved.');
        }

        return this.prisma.weeklyTimesheet.update({
            where: { id: timesheet.id },
            data: {
                status: dto.status,
                approvedBy: dto.status === TimesheetStatus.APPROVED ? managerUserId : null,
                approvedAt: dto.status === TimesheetStatus.APPROVED ? new Date() : null,
                rejectionReason: dto.status === TimesheetStatus.REJECTED ? dto.rejectionReason : null,
            },
        });
    }
}

