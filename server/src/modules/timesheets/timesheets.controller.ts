import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { TimesheetsService } from './timesheets.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgGuard } from '../../common/guards/org.guard';
import { OrgId, UserId } from '../../common/decorators/org.decorator';
import { SubmitTimesheetDto, ApproveTimesheetDto } from './dto/timesheets.dto';

@Controller('organizations/:orgId/timesheets')
@UseGuards(JwtAuthGuard, OrgGuard)
export class TimesheetsController {
    constructor(private readonly timesheetsService: TimesheetsService) { }

    @Get()
    async getTimesheets(@OrgId() orgId: string, @UserId() userId: string) {
        return this.timesheetsService.getTimesheets(orgId, userId);
    }

    @Post('submit')
    async submitTimesheet(
        @OrgId() orgId: string,
        @UserId() userId: string,
        @Body() dto: SubmitTimesheetDto,
    ) {
        return this.timesheetsService.submitTimesheet(orgId, userId, dto);
    }

    @Post('approve/:userId')
    async approveTimesheet(
        @OrgId() orgId: string,
        @UserId() managerUserId: string,
        @Param('userId') userIdToApprove: string,
        @Body() dto: ApproveTimesheetDto,
    ) {
        return this.timesheetsService.approveTimesheet(orgId, managerUserId, userIdToApprove, dto);
    }
}

