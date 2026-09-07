import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgGuard } from '../../common/guards/org.guard';
import { OrgId, UserId } from '../../common/decorators/org.decorator';
import { CheckInDto, CheckOutDto, StartBreakDto, EndBreakDto } from './dto/attendance.dto';

@Controller('attendance')
@UseGuards(JwtAuthGuard, OrgGuard)
export class AttendanceController {
    constructor(private readonly attendanceService: AttendanceService) { }

    /**
     * GET /attendance/today
     * Today's session for (userId + request.orgId). Returns null if none. Org-scoped only.
     */
    @Get('today')
    async getTodayAttendance(
        @OrgId() orgId: string,
        @UserId() userId: string,
    ) {
        return this.attendanceService.getTodaySession(orgId, userId);
    }

    /**
     * GET /attendance/me
     * Current user's attendance status in this org (for dashboard / "my status").
     */
    @Get('me')
    async getMyAttendance(
        @OrgId() orgId: string,
        @UserId() userId: string,
    ) {
        return this.attendanceService.getCurrentAttendance(orgId, userId);
    }

    /**
     * GET /attendance/users/:userId
     * Another user's attendance status in this org (same-org members only).
     */
    @Get('users/:userId')
    async getUserAttendance(
        @OrgId() orgId: string,
        @UserId() requesterUserId: string,
        @Param('userId') targetUserId: string,
    ) {
        return this.attendanceService.getUserAttendance(orgId, requesterUserId, targetUserId);
    }

    @Post('check-in')
    async checkIn(
        @OrgId() orgId: string,
        @UserId() userId: string,
        @Body() dto: CheckInDto,
    ) {
        return this.attendanceService.checkIn(orgId, userId, dto);
    }

    @Post('check-out')
    async checkOut(
        @OrgId() orgId: string,
        @UserId() userId: string,
        @Body() dto: CheckOutDto,
    ) {
        return this.attendanceService.checkOut(orgId, userId, dto);
    }

    @Post('start-break')
    async startBreak(
        @OrgId() orgId: string,
        @UserId() userId: string,
        @Body() dto: StartBreakDto,
    ) {
        return this.attendanceService.startBreak(orgId, userId, dto);
    }

    @Post('end-break')
    async endBreak(
        @OrgId() orgId: string,
        @UserId() userId: string,
        @Body() dto: EndBreakDto,
    ) {
        return this.attendanceService.endBreak(orgId, userId, dto);
    }
}

