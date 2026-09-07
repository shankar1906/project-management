import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class StartTimerDto {
  /** Required when starting timer for a specific task; omit to start without task (assign task on stop) */
  @IsString()
  @IsOptional()
  projectId?: string;

  @IsString()
  @IsOptional()
  phaseId?: string;

  @IsString()
  @IsOptional()
  taskListId?: string;

  /** Required when starting timer for a specific task; omit to start without task (assign task on stop) */
  @IsString()
  @IsOptional()
  taskId?: string;
}

export class StopTimerDto {
  @IsString()
  @IsOptional()
  description?: string;

  /** Required when stopping a timer that was started without a task */
  @IsString()
  @IsOptional()
  projectId?: string;

  @IsString()
  @IsOptional()
  taskId?: string;

  @IsString()
  @IsOptional()
  phaseId?: string;

  @IsString()
  @IsOptional()
  taskListId?: string;
}
