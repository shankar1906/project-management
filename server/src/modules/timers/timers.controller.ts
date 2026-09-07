import { Controller, Post, Body, UseGuards, Get } from '@nestjs/common';
import { TimersService } from './timers.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgGuard } from '../../common/guards/org.guard';
import { OrgId, UserId } from '../../common/decorators/org.decorator';
import { StartTimerDto, StopTimerDto } from './dto/timers.dto';

@Controller('timers')
@UseGuards(JwtAuthGuard, OrgGuard)
export class TimersController {
    constructor(private readonly timersService: TimersService) { }

    @Post('start')
    async startTimer(
        @OrgId() orgId: string,
        @UserId() userId: string,
        @Body() dto: StartTimerDto,
    ) {
        return this.timersService.startTimer(orgId, userId, dto);
    }

    @Post('stop')
    async stopTimer(
        @OrgId() orgId: string,
        @UserId() userId: string,
        @Body() dto: StopTimerDto,
    ) {
        return this.timersService.stopTimer(orgId, userId, dto);
    }

    @Get('active')
    async getActiveTimer(
        @OrgId() orgId: string,
        @UserId() userId: string,
    ) {
        return this.timersService.getActiveTimer(orgId, userId);
    }
}

