import { IsIn, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Query params for task list endpoints (org and mine) */
export class TaskListQueryDto {
    /** Which bucket of tasks: overdue | due_soon | due_today | all */
    @IsOptional()
    @IsIn(['overdue', 'due_soon', 'due_today', 'all'])
    bucket?: 'overdue' | 'due_soon' | 'due_today' | 'all' = 'all';

    /** Max items to return (default 20, max 100) */
    @IsOptional()
    @Type(() => Number)
    @Min(1)
    @Max(100)
    limit?: number = 20;
}

/** Single task row for list-in-card display */
export interface TaskListItemDto {
    id: string;
    title: string;
    projectId: string;
    projectName: string;
    statusName: string;
    dueDate: string | null;
    priority: number;
    priorityLabel: string;
    assignees: { id: string; name: string | null }[];
    phaseName: string | null;
    taskListName: string | null;
    tags: { id: string; name: string; color: string | null }[];
}

/** Single project row for list-in-card display */
export interface ProjectListItemDto {
    id: string;
    name: string;
    status: string;
    access: string;
    taskCount: number;
    tasksOverdue: number;
    tasksDueSoon: number;
}

export interface TaskListResponseDto {
    items: TaskListItemDto[];
    total: number;
    projects: ProjectListItemDto[];
}
