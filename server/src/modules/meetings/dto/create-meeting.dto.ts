import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsInt,
    Min,
    IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMeetingDto {
    @IsString()
    @IsNotEmpty()
    title: string;

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

    @IsNotEmpty()
    content: any; // TipTap JSON document

    @IsDateString()
    meetingDate: string;

    @IsOptional()
    @IsString()
    projectId?: string;
}
