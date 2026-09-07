import { IsString, IsNotEmpty, IsOptional, IsInt, Min, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateMeetingDto } from './create-meeting.dto';

export class UpdateMeetingDto {
    @IsOptional()
    @IsString()
    title?: string;

    @IsOptional()
    @IsString()
    location?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Type(() => Number)
    numberOfPeople?: number;

    @IsOptional()
    @IsString()
    time?: string;

    @IsOptional()
    @IsString()
    purpose?: string;

    @IsOptional()
    @IsString()
    attendedBy?: string;

    @IsOptional()
    @IsString()
    absentees?: string;

    @IsOptional()
    content?: any; // TipTap JSON document

    @IsOptional()
    @IsDateString()
    meetingDate?: string;

    @IsOptional()
    @IsString()
    projectId?: string;
}
