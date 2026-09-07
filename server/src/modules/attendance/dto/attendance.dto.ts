import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { WorkMode, BreakType } from '@prisma/client';

export class CheckInDto {
    @IsEnum(WorkMode)
    workMode: WorkMode;
}

export class CheckOutDto {}

export class StartBreakDto {
    @IsEnum(BreakType)
    type: BreakType;
}

export class EndBreakDto {}
