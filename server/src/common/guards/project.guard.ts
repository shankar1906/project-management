import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Project Guard
 * - Verifies user has access to project
 * - Attaches projectId and project role to request
 * - Strict tenant isolation: project must belong to request.orgId (from x-org-id)
 * - Does NOT modify request.orgId
 */
@Injectable()
export class ProjectGuard implements CanActivate {
  private readonly logger = new Logger(ProjectGuard.name);

  constructor(private prisma: PrismaService) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const orgId = request.orgId;

    if (!orgId) {
      this.logger.warn('ProjectGuard: Org context required (OrgGuard must run first)');
      throw new ForbiddenException('Organization context required');
    }

    // Extract projectId from params or body
    const projectId =
      request.params.projectId || request.params.id || request.body.projectId;

    if (!projectId) {
      this.logger.warn('ProjectGuard: No projectId in request');
      throw new ForbiddenException('Project ID required');
    }

    // Strict isolation: project must be in current org (findFirst with id + orgId)
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        orgId,
        isDeleted: false,
      },
      select: {
        id: true,
        orgId: true,
      },
    });

    if (!project) {
      this.logger.warn(
        `ProjectGuard: Project ${projectId} not found in org or access denied`,
      );
      throw new ForbiddenException('Project not found or access denied');
    }

    // Verify user is member of this project
    const membership = await this.prisma.projectMember.findFirst({
      where: {
        projectId,
        userId: user.userId,
        isActive: true,
      },
      select: {
        role: true,
        isActive: true,
      },
    });

    // If not project member: allow if user is Org Admin/Owner of this org
    let isOrgAdmin = false;
    if (!membership || !membership.isActive) {
      const orgMember = await this.prisma.orgMember.findUnique({
        where: {
          userId_orgId: {
            userId: user.userId,
            orgId,
          },
        },
        select: { role: true, isActive: true },
      });
      isOrgAdmin =
        !!orgMember?.isActive &&
        (orgMember.role === 'ADMIN' || orgMember.role === 'OWNER');
    }

    if ((!membership || !membership.isActive) && !isOrgAdmin) {
      this.logger.warn(
        `ProjectGuard: User ${user.userId} not member of project ${projectId}`,
      );
      throw new ForbiddenException('You do not have access to this project');
    }

    // Attach to request (do NOT modify request.orgId)
    request.projectId = projectId;
    request.projectRole = membership?.role || (isOrgAdmin ? 'ADMIN' : null);

    return true;
  }
}
