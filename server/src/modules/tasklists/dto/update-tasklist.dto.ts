import {
    IsOptional,
    IsString,
    IsIn,
    IsArray,
} from 'class-validator';

export class UpdateTaskListDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    phaseId?: string;

    @IsOptional()
    @IsIn(['PUBLIC', 'PRIVATE'])
    access?: 'PUBLIC' | 'PRIVATE';

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tagIds?: string[];
}

export class ReorderTaskListDto {
    @IsArray()
    @IsString({ each: true })
    orderedIds: string[];
}
