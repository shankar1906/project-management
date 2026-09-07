import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    Logger,
} from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';
import { FilterMeetingDto } from './dto/filter-meeting.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgGuard } from '../../common/guards/org.guard';
import { OrgId, UserId } from '../../common/decorators/org.decorator';

/**
 * MeetingsController
 * - All routes are org-scoped: /organizations/:orgId/meetings/...
 * - Guards: JwtAuthGuard → OrgGuard (per RULES.md)
 * - No business logic here — delegated to MeetingsService
 */
@Controller('organizations/:orgId')
@UseGuards(JwtAuthGuard, OrgGuard)
export class MeetingsController {
    private readonly logger = new Logger(MeetingsController.name);

    constructor(private readonly meetingsService: MeetingsService) { }

    // ─── CREATE ──────────────────────────────────────────
    @Post('meetings')
    async create(
        @OrgId() orgId: string,
        @UserId() userId: string,
        @Body() dto: CreateMeetingDto,
    ) {
        this.logger.log(`POST /organizations/${orgId}/meetings by user ${userId}`);
        return this.meetingsService.create(orgId, userId, dto);
    }

    // ─── LIST (PAGINATED) ────────────────────────────────
    @Get('meetings')
    async findAll(
        @OrgId() orgId: string,
        @Query() filters: FilterMeetingDto,
    ) {
        this.logger.log(`GET /organizations/${orgId}/meetings`);
        return this.meetingsService.findAll(orgId, filters);
    }

    // ─── SUGGEST USERS (@ autocomplete) ─────────────────
    // IMPORTANT: Must be registered BEFORE 'meetings/:id'
    @Get('meetings/suggest/users')
    async suggestUsers(
        @OrgId() orgId: string,
        @Query('q') query: string,
    ) {
        return this.meetingsService.suggestUsers(orgId, query || '');
    }

    // ─── SUGGEST PROJECTS (# autocomplete) ──────────────
    @Get('meetings/suggest/projects')
    async suggestProjects(
        @OrgId() orgId: string,
        @Query('q') query: string,
    ) {
        return this.meetingsService.suggestProjects(orgId, query || '');
    }

    // ─── GET SINGLE ─────────────────────────────────────
    @Get('meetings/:id')
    async findOne(
        @OrgId() orgId: string,
        @Param('id') id: string,
    ) {
        this.logger.log(`GET /organizations/${orgId}/meetings/${id}`);
        return this.meetingsService.findOne(orgId, id);
    }

    // ─── UPDATE ─────────────────────────────────────────
    @Patch('meetings/:id')
    async update(
        @OrgId() orgId: string,
        @Param('id') id: string,
        @UserId() userId: string,
        @Body() dto: UpdateMeetingDto,
    ) {
        this.logger.log(`PATCH /organizations/${orgId}/meetings/${id}`);
        return this.meetingsService.update(orgId, id, userId, dto);
    }

    // ─── PUBLISH (DRAFT → PUBLISHED) ───────────────────


    // ─── SOFT DELETE ────────────────────────────────────
    @Delete('meetings/:id')
    async remove(
        @OrgId() orgId: string,
        @Param('id') id: string,
        @UserId() userId: string,
    ) {
        this.logger.log(`DELETE /organizations/${orgId}/meetings/${id}`);
        return this.meetingsService.remove(orgId, id, userId);
    }

    // ─── FIND BY PROJECT (Project Screen MOM Tab) ──────
    @Get('projects/:projectId/meetings')
    async findByProject(
        @OrgId() orgId: string,
        @Param('projectId') projectId: string,
        @Query('page') page?: number,
        @Query('limit') limit?: number,
    ) {
        this.logger.log(`GET /organizations/${orgId}/projects/${projectId}/meetings`);
        return this.meetingsService.findByProject(orgId, projectId, {
            page: page ? +page : 1,
            limit: limit ? +limit : 10,
        });
    }
}
