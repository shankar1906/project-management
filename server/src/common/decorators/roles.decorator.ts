import { SetMetadata } from '@nestjs/common';
import { OrgRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Decorator to specify required organization roles for an endpoint
 * @param roles - Array of allowed organization roles
 * @example @Roles(OrgRole.ADMIN, OrgRole.OWNER)
 */
export const Roles = (...roles: OrgRole[]) => SetMetadata(ROLES_KEY, roles);
