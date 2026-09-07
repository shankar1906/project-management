import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

// Enum matches Prisma's TimesheetStatus
export enum TimesheetStatus {
    DRAFT = 'DRAFT',
    SUBMITTED = 'SUBMITTED',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED'
}

export class SubmitTimesheetDto {
    @IsDateString()
    @IsNotEmpty()
    weekStart: string; // Used to identify the timesheet
}

export class ApproveTimesheetDto {
    @IsDateString()
    @IsNotEmpty()
    weekStart: string;

    @IsEnum(TimesheetStatus)
    status: TimesheetStatus;

    @IsString()
    @IsOptional()
    rejectionReason?: string;
}
