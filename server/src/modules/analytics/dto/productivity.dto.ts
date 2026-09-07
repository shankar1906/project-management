import { ChartDataPointDto, TimeSeriesPointDto } from './chart-data.dto';

/** Single metric with a percentage trend compared to previous period */
export class MetricTrendDto {
    value: number;
    trend: number; // Percentage change e.g. +12 or -3
}

/** Project progress for the "Pulse" visualization */
export class ProjectPulseDto {
    id: string;
    name: string;
    taskCount: number;
    completedTasks: number;
    completionPercentage: number;
}

/** Full dashboard metrics for org/user productivity */
export class DashboardMetricsDto {
    completedTasks: MetricTrendDto;
    inProgressTasks: MetricTrendDto;
    efficiency: MetricTrendDto;
    capacity: MetricTrendDto;
    
    /** Weekly time logging activity for the wave chart */
    workloadActivity: TimeSeriesPointDto[];
    
    /** Task priority breakdown for doughnut charts */
    priorityDistribution: ChartDataPointDto[];
    
    /** Project completion pulses */
    projectPulse: ProjectPulseDto[];
}
