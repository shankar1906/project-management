/**
 * Chart-ready data structures for dashboard visualizations (pie, bar, line, etc.)
 */

/** Single data point for pie/bar/doughnut charts */
export class ChartDataPointDto {
    label: string;
    value: number;
    color?: string;
}

/** Time-series point for line/area charts (e.g. tasks due over time) */
export class TimeSeriesPointDto {
    /** Period label (e.g. "2024-01", "Week 3", "Jan") */
    period: string;
    value: number;
    /** Optional extra series (e.g. completed vs created) */
    extra?: Record<string, number>;
}

/** Overview counts for summary cards */
export class AnalyticsOverviewDto {
    totalProjects: number;
    totalTasks: number;
    totalPhases: number;
    totalTaskLists: number;
    /** Unique users assigned to at least one task in scope */
    assignedUsersCount: number;
    /** Tasks with dueDate in the past (overdue) */
    tasksOverdue: number;
    /** Tasks with dueDate in next 7 days */
    tasksDueSoon: number;
    /** Tasks with dueDate today */
    tasksDueToday: number;
    /** Phases with endDate in the past (ended) */
    phasesEnded: number;
    /** Phases with endDate in next 30 days */
    phasesEndingSoon: number;
    /** Completed-like tasks (status name contains done/complete) */
    tasksCompleted: number;
    /** Pending = total - completed */
    tasksPending: number;
}

/** Org-level dashboard response */
export class OrgDashboardAnalyticsDto {
    overview: AnalyticsOverviewDto;
    /** Projects by status (pie/bar) */
    projectsByStatus: ChartDataPointDto[];
    /** Projects by access (pie) */
    projectsByAccess: ChartDataPointDto[];
    /** Tasks by status name (pie/bar) */
    tasksByStatus: ChartDataPointDto[];
    /** Tasks by priority (bar) */
    tasksByPriority: ChartDataPointDto[];
    /** Top assignees (bar: user name -> task count) */
    tasksByAssignee: ChartDataPointDto[];
    /** Task due distribution: overdue, due_soon, due_later, no_due (pie/bar) */
    tasksByDueBucket: ChartDataPointDto[];
    /** Phases ending per month (line chart) - next 6 months */
    phaseEndingsByMonth: TimeSeriesPointDto[];
    /** Task due count by week (line) - next 8 weeks */
    taskDueCountByWeek: TimeSeriesPointDto[];
}

/** User-level "mine" dashboard within an org */
export class MineDashboardAnalyticsDto {
    overview: {
        myProjectsCount: number;
        myTasksAssigned: number;
        myTasksOverdue: number;
        myTasksDueSoon: number;
        myTasksDueToday: number;
        myTasksCompleted: number;
        myTasksPending: number;
    };
    myTasksByStatus: ChartDataPointDto[];
    myTasksByPriority: ChartDataPointDto[];
    myTasksByDueBucket: ChartDataPointDto[];
    myTasksByProject: ChartDataPointDto[];
}
