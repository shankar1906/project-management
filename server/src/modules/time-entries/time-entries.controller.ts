import { Controller, Post, Body, Patch, Param, Delete, Get, Query, UseGuards } from '@nestjs/common';
import { TimeEntriesService } from './time-entries.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgGuard } from '../../common/guards/org.guard';
import { OrgId, UserId } from '../../common/decorators/org.decorator';
import { CreateTimeEntryDto, UpdateTimeEntryDto } from './dto/time-entries.dto';

@Controller('time-entries')
@UseGuards(JwtAuthGuard, OrgGuard)
export class TimeEntriesController {
    constructor(private readonly timeEntriesService: TimeEntriesService) { }

    @Post()
    async create(
        @OrgId() orgId: string,
        @UserId() userId: string,
        @Body() dto: CreateTimeEntryDto,
    ) {
        return this.timeEntriesService.create(orgId, userId, dto);
    }

    @Patch(':id')
    async update(
        @OrgId() orgId: string,
        @UserId() userId: string,
        @Param('id') id: string,
        @Body() dto: UpdateTimeEntryDto,
    ) {
        return this.timeEntriesService.update(id, userId, orgId, dto);
    }

    @Delete(':id')
    async remove(
        @OrgId() orgId: string,
        @UserId() userId: string,
        @Param('id') id: string,
    ) {
        return this.timeEntriesService.remove(id, userId, orgId);
    }

    @Get()
    async findAll(
        @OrgId() orgId: string,
        @UserId() userId: string,
        @Query('date') date?: string,
        @Query('taskId') taskId?: string,
    ) {
        return this.timeEntriesService.findAll(orgId, userId, date, taskId);
    }
}

