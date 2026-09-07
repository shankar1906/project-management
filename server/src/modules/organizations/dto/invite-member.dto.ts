import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';
import { OrgRole } from '@prisma/client';

export class InviteMemberDto {
    @IsNotEmpty()
    @IsEmail()
    email: string;

    @IsNotEmpty()
    @IsEnum(OrgRole)
    role: OrgRole;
}
