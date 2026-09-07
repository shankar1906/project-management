import {
    IsNotEmpty,
    IsString,
    IsOptional,
    IsDateString,
    IsIn,
    IsInt,
    IsArray,
    Min,
    Max,
    ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePhaseDto {
    @IsNotEmpty()
    @IsString()
    projectId: string;

    @IsNotEmpty()
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    ownerId?: string;

    @IsOptional()
    @ValidateIf((o) => o.startDate !== '' && o.startDate !== null)
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @ValidateIf((o) => o.endDate !== '' && o.endDate !== null)
    @IsDateString()
    endDate?: string;

    @IsOptional()
    @IsIn(['PUBLIC', 'PRIVATE'])
    access?: 'PUBLIC' | 'PRIVATE';

    @IsOptional()
    @IsString()
    status?: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(100)
    @Type(() => Number)
    completionPercentage?: number;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tagIds?: string[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    assigneeIds?: string[];
}
