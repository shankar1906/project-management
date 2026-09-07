import { IsEnum, IsOptional, IsString } from 'class-validator';
import { UserPresenceStatus } from '@prisma/client';

export class UpdatePresenceDto {
    @IsEnum(UserPresenceStatus)
    status: UserPresenceStatus;

    @IsString()
    @IsOptional()
    message?: string;
}
