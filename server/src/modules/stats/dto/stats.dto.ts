import { IsNumber, IsString } from 'class-validator';

export class ChartData {
    @IsString()
    label: string;

    @IsNumber()
    value: number;

    @IsString()
    color?: string;
}

export class DashboardStatsDto {
    overview: {
        totalOrganizations: number;
        totalProjects: number;
        totalTasks: number; // Assigned tasks
        pendingTasks: number;
        completedTasks: number;
    };

    organizations: {
        byRole: ChartData[];
    };

    projects: {
        byStatus: ChartData[];
        byAccess: ChartData[]; // Public vs Private
    };

    tasks: {
        byStatus: ChartData[];
        byPriority: ChartData[];
    };
}
