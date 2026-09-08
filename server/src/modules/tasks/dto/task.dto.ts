import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsInt,
  IsDateString,
  IsArray,
  IsNumber,
  Min,
  Max,
  ValidateIf,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TaskType } from '@prisma/client';

export class CreateTaskDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(TaskType)
  type?: TaskType;

  @IsOptional()
  @IsString()
  statusId?: string;

  @IsOptional()
  @IsString()
  taskListId?: string;

  @IsOptional()
  @IsString()
  phaseId?: string;

  @IsOptional()
  parentId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  priority?: number;

  @IsOptional()
  @ValidateIf((o) => o.dueDate !== '' && o.dueDate !== null)
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assigneeIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  completionPercentage?: number;
}

export class MoveTaskDto {
  @IsOptional()
  @IsString()
  newTaskListId?: string;

  @IsOptional()
  @IsString()
  newPhaseId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  newOrderIndex?: number;
}

export class UpdateTaskStatusDto {
  @IsNotEmpty()
  @IsString()
  statusId: string;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(TaskType)
  type?: TaskType;

  @IsOptional()
  @IsString()
  statusId?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  priority?: number;

  @IsOptional()
  @ValidateIf((o) => o.dueDate !== '' && o.dueDate !== null)
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assigneeIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  completionPercentage?: number;
}

export class AddAssigneeDto {
  @IsNotEmpty()
  @IsString()
  userId: string;
}

export class BulkAssignDto {
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  taskIds: string[];

  @IsNotEmpty()
  @IsString()
  userId: string;
}

/**
 * Query DTO for "My Tasks" - tasks assigned to the current user
 * Supports pagination
 */
export class MyTasksQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  statusId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;
}
