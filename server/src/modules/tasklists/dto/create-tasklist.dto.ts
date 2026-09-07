import {
    IsNotEmpty,
    IsString,
    IsOptional,
    IsIn,
    IsArray,
} from 'class-validator';

export class CreateTaskListDto {
    @IsNotEmpty()
    @IsString()
    projectId: string;

    @IsOptional()
    @IsString()
    phaseId?: string;

    @IsNotEmpty()
    @IsString()
    name: string;

    @IsOptional()
    @IsIn(['PUBLIC', 'PRIVATE'])
    access?: 'PUBLIC' | 'PRIVATE';

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tagIds?: string[];
}
