import { Controller, Get, UseGuards, Logger, Query, Param } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgGuard } from '../../common/guards/org.guard';
import { OrgId, UserId } from '../../common/decorators/org.decorator';
import type { OrgDashboardAnalyticsDto, MineDashboardAnalyticsDto } from './dto/chart-data.dto';
import { TaskListQueryDto } from './dto/task-list-query.dto';
import type { TaskListResponseDto } from './dto/task-list-query.dto';
import type { OrgUsersResponseDto } from './dto/org-users.dto';
import { DashboardMetricsDto } from './dto/productivity.dto';

/**
 * Analytics Controller
 * - Dashboard data for org-level and user-level ("mine") views
 * - Returns chart-ready structures and task lists for cards
 *
 * Guard Pipeline: JwtAuthGuard → OrgGuard (sets orgId from x-org-id header only)
 */
@Controller('analytics')
@UseGuards(JwtAuthGuard, OrgGuard)
export class AnalyticsController {
    private readonly logger = new Logger(AnalyticsController.name);

    constructor(private readonly analyticsService: AnalyticsService) {}

    /**
     * GET /analytics/productivity/org
     * High-quality dashboard metrics (Completed, In-Progress, Efficiency, Capacity) with trends.
     */
    @Get('productivity/org')
    async getOrgProductivity(@OrgId() orgId: string): Promise<DashboardMetricsDto> {
        return this.analyticsService.getDashboardMetrics(orgId);
    }

    /**
     * GET /analytics/productivity/mine
     * Personal productivity metrics for the current user.
     */
    @Get('productivity/mine')
    async getMineProductivity(@OrgId() orgId: string, @UserId() userId: string): Promise<DashboardMetricsDto> {
        return this.analyticsService.getDashboardMetrics(orgId, userId);
    }

    /**
     * GET /analytics/productivity/user/:userId
     * Targeted tracking for a specific member (Owner/Admin only).
     */
    @Get('productivity/user/:userId')
    async getUserProductivity(
        @OrgId() orgId: string, 
        @Param('userId') targetUserId: string
    ): Promise<DashboardMetricsDto> {
        return this.analyticsService.getDashboardMetrics(orgId, targetUserId);
    }

    /**
     * GET /analytics/dashboard/mine/task-lists
     * Task list for "mine" cards: project name, task name, status, due date, assignees, etc.
     * Query: bucket=overdue|due_soon|due_today|all (default all), limit=1..100 (default 20).
     */
    @Get('dashboard/mine/task-lists')
    async getMineTaskLists(
        @OrgId() orgId: string,
        @UserId() userId: string,
        @Query() query: TaskListQueryDto,
    ): Promise<TaskListResponseDto> {
        const bucket = query.bucket ?? 'all';
        const limit = query.limit ?? 20;
        return this.analyticsService.getMineTaskList(orgId, userId, bucket, limit);
    }

    /**
     * GET /analytics/dashboard/task-lists
     * Org-level task list for dashboard cards (same fields as mine).
     * Query: bucket=overdue|due_soon|due_today|all, limit=1..100.
     */
    @Get('dashboard/task-lists')
    async getOrgTaskLists(
        @OrgId() orgId: string,
        @Query() query: TaskListQueryDto,
    ): Promise<TaskListResponseDto> {
        const bucket = query.bucket ?? 'all';
        const limit = query.limit ?? 20;
        return this.analyticsService.getOrgTaskList(orgId, bucket, limit);
    }

    /**
     * GET /analytics/dashboard/users
     * List users/members in the current org (name, email, role, status, tasksAssignedCount).
     */
    @Get('dashboard/users')
    async getOrgUsers(@OrgId() orgId: string): Promise<OrgUsersResponseDto> {
        return this.analyticsService.getOrgUsers(orgId);
    }

    /**
     * GET /analytics/dashboard
     * Org-level dashboard: projects, tasks, assignees, task dues, phase dues, etc.
     */
    @Get('dashboard')
    async getOrgDashboard(
        @OrgId() orgId: string,
    ): Promise<OrgDashboardAnalyticsDto> {
        return this.analyticsService.getOrgDashboard(orgId);
    }

    /**
     * GET /analytics/dashboard/mine
     * User-level "mine" dashboard: my projects, my assigned tasks, my dues.
     */
    @Get('dashboard/mine')
    async getMineDashboard(
        @OrgId() orgId: string,
        @UserId() userId: string,
    ): Promise<MineDashboardAnalyticsDto> {
        return this.analyticsService.getMineDashboard(orgId, userId);
    }
}
