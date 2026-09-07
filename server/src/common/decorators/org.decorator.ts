import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Decorator to extract organization ID from request
 * Populated by OrgGuard
 */
export const OrgId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.orgId;
  },
);

/**
 * Decorator to extract user ID from JWT
 * Populated by JwtAuthGuard
 */
export const UserId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.userId;
  },
);

/**
 * Decorator to extract full user object from JWT
 */
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
