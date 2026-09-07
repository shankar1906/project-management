import { IsEmail, IsEnum, IsNotEmpty, IsOptional, ValidateIf, IsString, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { OrgRole, ProjectRole } from '@prisma/client';

/**
 * Organization-level invite (with optional project assignment)
 * - orgRole: Required - Organization-level role
 * - projectId: Optional - Auto-assign to this project
 * - projectRole: Required if projectId provided
 */
export class SendInviteDto {
    @IsNotEmpty()
    @IsEmail()
    email: string;

    @IsNotEmpty()
    @IsEnum(OrgRole)
    orgRole: OrgRole;

    @IsOptional()
    id?: string;

    @ValidateIf((o) => o.id !== undefined && o.id !== null)
    @IsNotEmpty()
    @IsEnum(ProjectRole)
    projectRole?: ProjectRole;
}

/**
 * Project-level invite
 * - Automatically adds to org as MEMBER if not already
 * - Adds to project with specified ProjectRole
 */
export class SendProjectInviteDto {
    @IsNotEmpty()
    @IsEmail()
    email: string;

    @IsNotEmpty()
    @IsEnum(ProjectRole)
    role: ProjectRole;
}

export class AcceptInviteDto {
    @IsNotEmpty()
    inviteToken: string;
}

export class RejectInviteDto {
    @IsNotEmpty()
    inviteToken: string;
}


export class ResendInviteDto {
    @IsNotEmpty()
    @IsEmail()
    email: string;
}

export class SearchUserDto {
    @IsOptional()
    @IsString()
    query?: string;

    @IsOptional()
    @IsString()
    projectId?: string;

    @IsOptional()
    @IsString()
    orgId?: string;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    page?: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    @Max(50)
    limit?: number = 5;
}

