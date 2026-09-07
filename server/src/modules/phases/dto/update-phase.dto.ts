import {
    IsOptional,
    IsString,
    IsDateString,
    IsIn,
    IsInt,
    IsArray,
    Min,
    Max,
    ValidateNested,
    ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdatePhaseDto {
    @IsOptional()
    @IsString()
    name?: string;

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

export class ReorderPhaseDto {
    @IsArray()
    @IsString({ each: true })
    orderedIds: string[];
}
