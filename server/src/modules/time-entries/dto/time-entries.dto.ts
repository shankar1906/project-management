import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTimeEntryDto {
    @IsString()
    @IsNotEmpty()
    projectId: string;

    @IsString()
    @IsOptional()
    phaseId?: string;

    @IsString()
    @IsOptional()
    taskListId?: string;

    @IsString()
    @IsNotEmpty()
    taskId: string;

    @IsDateString()
    @IsOptional()
    date?: string; // ISO date string

    @IsInt()
    @IsOptional()
    durationMinutes?: number;

    @IsString()
    @IsOptional()
    description?: string;

    @IsBoolean()
    @IsOptional()
    billable?: boolean;

    @IsDateString()
    @IsOptional()
    startTime?: string;

    @IsDateString()
    @IsOptional()
    endTime?: string;
}

export class UpdateTimeEntryDto {
    @IsInt()
    @IsOptional()
    durationMinutes?: number;

    @IsString()
    @IsOptional()
    description?: string;

    @IsBoolean()
    @IsOptional()
    billable?: boolean;

    @IsDateString()
    @IsOptional()
    startTime?: string;

    @IsDateString()
    @IsOptional()
    endTime?: string;
}
