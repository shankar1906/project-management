import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardStatsDto, ChartData } from './dto/stats.dto';
import { ProjectStatus, ProjectAccess, OrgRole, TaskStatus } from '@prisma/client';

@Injectable()
export class StatsService {
    private readonly logger = new Logger(StatsService.name);

    constructor(private readonly prisma: PrismaService) { }

    async getUserStats(userId: string): Promise<DashboardStatsDto> {
        this.logger.log(`Fetching stats for user: ${userId}`);

        // 1. Fetch Organization Stats
        const orgMemberships = await this.prisma.orgMember.findMany({
            where: { userId },
            select: { role: true },
        });

        const totalOrganizations = orgMemberships.length;

        // Group by Role
        const roleCounts = orgMemberships.reduce((acc, curr) => {
            acc[curr.role] = (acc[curr.role] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const organizationsByRole: ChartData[] = Object.entries(roleCounts).map(([role, count]) => ({
            label: role,
            value: count,
        }));

        // 2. Fetch Project Stats (Member or Owner)
        // We look for projects where user is a member or owner.
        // Note: ProjectMember usually covers ownership if the owner is added as a member, 
        // but schemas vary. In this schema, 'owner' is a relation on Project.
        // However, usually owners are also added as members. 
        // To be safe, we'll query projects where user is member OR owner.
        const projects = await this.prisma.project.findMany({
            where: {
                OR: [
                    { members: { some: { userId } } }, // User is a member
                    { ownerId: userId },             // User is the owner
                ],
                isDeleted: false,
            },
            select: {
                status: true,
                access: true,
            },
        });

        const totalProjects = projects.length;

        // Group by Status
        const projectStatusCounts = projects.reduce((acc, curr) => {
            acc[curr.status] = (acc[curr.status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const projectsByStatus: ChartData[] = Object.entries(projectStatusCounts).map(([status, count]) => ({
            label: status.replace('_', ' '), // "IN_PROGRESS" -> "IN PROGRESS"
            value: count,
        }));

        // Group by Access
        const projectAccessCounts = projects.reduce((acc, curr) => {
            acc[curr.access] = (acc[curr.access] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const projectsByAccess: ChartData[] = Object.entries(projectAccessCounts).map(([access, count]) => ({
            label: access,
            value: count,
        }));


        // 3. Fetch Task Stats (Assigned to User)
        // "Tasks and their status..." - assuming assigned tasks for a personal dashboard.
        const assignedTasks = await this.prisma.task.findMany({
            where: {
                assignees: { some: { userId } },
                isDeleted: false,
            },
            include: {
                status: true, // Join to get status name
            },
        });

        const totalTasks = assignedTasks.length;

        // Group by Status (using Status Name from relation)
        const taskStatusCounts = assignedTasks.reduce((acc, curr) => {
            const statusName = curr.status.name;
            acc[statusName] = (acc[statusName] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const tasksByStatus: ChartData[] = Object.entries(taskStatusCounts).map(([name, count]) => ({
            label: name,
            value: count,
        }));

        // Simple Pending vs Completed calculation
        // This depends on what constitutes "Completed". 
        // Usually status names like "Done", "Completed". 
        // Since status is dynamic, we might have to just rely on the status distribution for the chart.
        // But for the "Overview" counts, let's try to guess or just count "Total".
        // Alternatively, we can check if the stage of the status is the last one? 
        // For now, I'll calculate completed if the status name contains 'Complete' or 'Done'.
        const completedTasks = assignedTasks.filter(t =>
            t.status.name.toLowerCase().includes('done') ||
            t.status.name.toLowerCase().includes('complete')
        ).length;

        const pendingTasks = totalTasks - completedTasks;


        // Group by Priority
        // Priority is Int. 0 = Low? High? 
        // Let's assume just grouping by the integer value or mapping it if we knew the mapping.
        // Displaying raw integer or mapped strings.
        const priorityMap: Record<number, string> = {
            0: 'Low',
            1: 'Medium',
            2: 'High',
            3: 'Urgent',
        };

        const taskPriorityCounts = assignedTasks.reduce((acc, curr) => {
            const p = curr.priority;
            const label = priorityMap[p] || `Priority ${p}`;
            acc[label] = (acc[label] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const tasksByPriority: ChartData[] = Object.entries(taskPriorityCounts).map(([label, count]) => ({
            label,
            value: count,
        }));


        return {
            overview: {
                totalOrganizations,
                totalProjects,
                totalTasks,
                pendingTasks,
                completedTasks,
            },
            organizations: {
                byRole: organizationsByRole,
            },
            projects: {
                byStatus: projectsByStatus,
                byAccess: projectsByAccess,
            },
            tasks: {
                byStatus: tasksByStatus,
                byPriority: tasksByPriority,
            },
        };
    }
}
