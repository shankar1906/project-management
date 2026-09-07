import { Injectable, ConflictException, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrgDto } from './dto/organization.dto';
import { OrgRole, MemberStatus } from '@prisma/client';
import { formatDistanceToNow } from 'date-fns';

/**
 * Organizations Service
 * - Manages organization CRUD
 * - Handles membership
 */
@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private prisma: PrismaService) { }

  /**
   * Create organization
   * - Generates unique slug
   * - Makes creator OWNER
   */
  async create(userId: string, dto: CreateOrgDto) {
    // Generate slug from name
    const slug = this.generateSlug(dto.name);

    // Check if slug already exists
    const existing = await this.prisma.organization.findUnique({
      where: { slug },
    });

    if (existing) {
      throw new ConflictException('Organization with this name already exists');
    }

    // Create org with owner membership in transaction
    const org = await this.prisma.$transaction(async (tx) => {
      // 1. Create Organization
      const newOrg = await tx.organization.create({
        data: {
          name: dto.name,
          slug,
        },
      });

      // 1.1 Create default OrgSettings (never allow org without settings)
      await tx.orgSettings.create({
        data: { orgId: newOrg.id },
      });

      // 2. Add Creator as OWNER
      await tx.orgMember.create({
        data: {
          userId,
          orgId: newOrg.id,
          role: OrgRole.OWNER,
          status: MemberStatus.ACTIVE,
        },
      });

      // 3. Create DEMO Project (Onboarding)
      const demoProject = await tx.project.create({
        data: {
          orgId: newOrg.id,
          name: 'Welcome Project',
          description: 'This is a demo project to help you get started.',
          color: '#3B82F6', // Blue
          projectId: 'DEMO-1',
          ownerId: userId,
          status: 'ON_HOLD',
        },
      });

      // 3.1 Add Creator to Project
      await tx.projectMember.create({
        data: {
          projectId: demoProject.id,
          userId,
          role: 'ADMIN',
        },
      });

      // 3.2 Create Workflow Stages
      const todoStage = await tx.taskStage.create({
        data: { projectId: demoProject.id, name: 'To Do', order: 1, color: '#E2E8F0' },
      });
      const inProgressStage = await tx.taskStage.create({
        data: { projectId: demoProject.id, name: 'In Progress', order: 2, color: '#FDBA74' },
      });
      const doneStage = await tx.taskStage.create({
        data: { projectId: demoProject.id, name: 'Done', order: 3, color: '#86EFAC' },
      });

      // 3.3 Create Statuses
      const statusNotStarted = await tx.taskStatus.create({
        data: { projectId: demoProject.id, stageId: todoStage.id, name: 'Not Started', order: 1, isDefault: true },
      });
      await tx.taskStatus.create({
        data: { projectId: demoProject.id, stageId: inProgressStage.id, name: 'Working', order: 1 },
      });
      await tx.taskStatus.create({
        data: { projectId: demoProject.id, stageId: doneStage.id, name: 'Completed', order: 1 },
      });

      // 3.4 Create Sample Task
      await tx.task.create({
        data: {
          projectId: demoProject.id,
          statusId: statusNotStarted.id,
          title: 'Explore the platform',
          description: 'Check out the board, create a new task, and invite a team member!',
          order: 1,
        }
        // No assignee initially
      });

      return newOrg;
    });

    this.logger.log(`Created org: ${org.id} (${org.slug}) by user ${userId}`);

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      role: OrgRole.OWNER,
    };
  }

  /**
   * List all organizations user belongs to
   */
  async listUserOrganizations(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { lastLoginAt: true },
    });

    let lastLoginTime: string | null = null;
    if (user?.lastLoginAt) {
      lastLoginTime = formatDistanceToNow(new Date(user.lastLoginAt), { addSuffix: true });
    }

    const memberships = await this.prisma.orgMember.findMany({
      where: {
        userId,
        isActive: true,
        status: MemberStatus.ACTIVE,
        org: {
          isDeleted: false,
        },
      },
      select: {
        role: true,
        joinedAt: true,
        lastAccessedAt: true,
        org: {
          select: {
            id: true,
            name: true,
            slug: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        joinedAt: 'asc',
      },
    });

    return memberships.map((m) => {
      let orgLastLoginTime: string | null = null;

      // Use org-specific last access time if available, otherwise fallback to user's general last login
      const displayDate = m.lastAccessedAt || user?.lastLoginAt;

      if (displayDate) {
        orgLastLoginTime = formatDistanceToNow(new Date(displayDate), { addSuffix: true });
      }

      return {
        id: m.org.id,
        name: m.org.name,
        slug: m.org.slug,
        role: m.role,
        joinedAt: m.joinedAt,
        createdAt: m.org.createdAt,
        lastLoginTime: orgLastLoginTime,
      };
    });
  }

  /**
   * Check onboarding status for a user in an organization
   * - Checks if user has email/phone
   * - Checks if org has at least one ADMIN/OWNER
   */
  async getOnboardingStatus(userId: string, orgId: string) {
    // 1. Check User Profile & Membership
    const member = await this.prisma.orgMember.findUnique({
      where: {
        userId_orgId: {
          userId,
          orgId,
        },
      },
      include: {
        user: true, // Get user details (email, phone)
        org: {
          include: {
            members: {
              where: {
                role: { in: [OrgRole.OWNER, OrgRole.ADMIN] },
              },
              take: 1, // Minimize data, just need to know if ONE exists
            },
          },
        },
      },
    });

    if (!member) {
      throw new ConflictException('User is not a member of this organization');
    }

    const user = member.user;
    const org = member.org;

    // 2. Evaluate Status
    const hasEmail = !!user?.email;
    const hasPhone = !!user?.phone;
    const hasAdmin = org.members.length > 0;

    // Define what "Onboarding Complete" means
    // Customize this logic based on your strict requirements
    const isComplete = hasEmail && hasPhone && hasAdmin;

    return {
      user: {
        hasEmail,
        hasPhone,
        email: user?.email,
        phone: user?.phone,
      },
      organization: {
        id: org.id,
        name: org.name,
        hasAdmin, // At least one Owner or Admin exists
      },
      isOnboardingComplete: isComplete,
    };
  }

  /**
   * Invite a member to the organization
   * - Checks if requester has permission (ADMIN/OWNER)
   * - Finds user by email
   * - Adds user to Org
   */
  async inviteMember(requesterId: string, orgId: string, email: string, role: OrgRole) {
    // 1. Verify Requester Permissions
    const requester = await this.prisma.orgMember.findUnique({
      where: { userId_orgId: { userId: requesterId, orgId } },
    });

    if (!requester || (requester.role !== OrgRole.OWNER && requester.role !== OrgRole.ADMIN)) {
      throw new ConflictException('Only Admins or Owners can invite members');
    }

    // 2. Find User by Email
    const userToInvite = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!userToInvite) {
      throw new ConflictException('User with this email not found. They must sign up first.');
    }

    // 3. Add to Organization
    // Check if already member
    const existingMember = await this.prisma.orgMember.findUnique({
      where: { userId_orgId: { userId: userToInvite.id, orgId } },
    });

    if (existingMember) {
      throw new ConflictException('User already in our organization');
    }

    const newMember = await this.prisma.orgMember.create({
      data: {
        userId: userToInvite.id,
        orgId,
        role,
      },
      include: {
        user: { select: { name: true, email: true } }
      }
    });

    return {
      message: 'Member added successfully',
      member: {
        id: newMember.id,
        userId: newMember.userId,
        name: newMember.user?.name,
        email: newMember.user?.email,
        role: newMember.role,
        joinedAt: newMember.joinedAt,
      }
    };
  }

  /**
   * Update a member's role in the organization
   * - Requester must be OWNER
   */
  async updateMemberRole(requesterId: string, orgId: string, targetIdentifier: string, newRole: OrgRole) {
    // 1. Verify Requester Permissions (Must be OWNER)
    const requester = await this.prisma.orgMember.findUnique({
      where: { userId_orgId: { userId: requesterId, orgId } },
    });

    if (!requester || requester.role !== OrgRole.OWNER) {
      throw new ForbiddenException('Only Owners can update member roles');
    }

    // 2. Find target member (could be by userId, orgMemberId, or email)
    const targetMember = await this.prisma.orgMember.findFirst({
      where: {
        orgId,
        OR: [
          { userId: targetIdentifier },
          { id: targetIdentifier },
          { email: targetIdentifier }
        ]
      },
    });

    if (!targetMember) {
      throw new NotFoundException('User is not a member of this organization');
    }

    // 3. Update Role
    const updated = await this.prisma.orgMember.update({
      where: { id: targetMember.id },
      data: { role: newRole },
      include: {
        user: { select: { name: true, email: true } }
      }
    });

    this.logger.log(`Owner ${requesterId} updated role of ${targetIdentifier} to ${newRole} in org ${orgId}`);

    return {
      message: 'Member role updated successfully by Owner',
      member: {
        id: updated.id,
        userId: updated.userId,
        name: updated.user?.name,
        email: updated.user?.email,
        role: updated.role,
      }
    };
  }

  /**
   * Generate URL-friendly slug from name
   */
  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
