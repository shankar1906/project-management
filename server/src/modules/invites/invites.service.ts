import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
    ConflictException,
    Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgRole, MemberStatus, ProjectRole } from '@prisma/client';
import { generateInviteToken, calculateExpiryDate, isInviteExpired } from './invite.util';

/**
 * Invites Service
 * Handles organization member invitation lifecycle
 * Security: Validates permissions, tokens, expiry before every action
 */
@Injectable()
export class InvitesService {
    private readonly logger = new Logger(InvitesService.name);

    constructor(private prisma: PrismaService) { }

    /**
   * Send Invite (Organization-level with optional project assignment)
   * - Validates requester is ADMIN/OWNER
   * - Generates secure token + expiry (48hrs)
   * - Creates OrgMember with status=INVITED
   * - Optionally: Auto-assigns to project if id provided
   * 
   * Why userId nullable: User may not exist yet (pre-signup invite)
   */
    async sendInvite(requesterId: string, orgId: string, dto: { email: string; orgRole: OrgRole; id?: string; projectRole?: ProjectRole }) {
        const { email, orgRole, id, projectRole } = dto;

        this.logger.log(`Processing invite for ${email} to org ${orgId} if projectId is ${id}`);

        // 1. Permission Check: Only ADMIN/OWNER can invite
        const requester = await this.prisma.orgMember.findUnique({
            where: { userId_orgId: { userId: requesterId, orgId } },
            include: { org: true },
        });

        if (!requester || (requester.role !== OrgRole.OWNER && requester.role !== OrgRole.ADMIN)) {
            throw new ForbiddenException('Only Admins or Owners can send invitations');
        }

        let projectName: string | undefined;

        // 2. Fetch user early (needed for project member check and invite creation)
        const user = await this.prisma.user.findUnique({ where: { email } });

        // 3. If id provided, validate it exists and belongs to org
        if (id) {
            if (!projectRole) {
                throw new BadRequestException('projectRole is required when id is provided');
            }

            const project = await this.prisma.project.findFirst({
                where: { id: id },
            });

            if (!project) {
                throw new NotFoundException('Project not found or does not belong to this organization');
            }
            projectName = project.name;

            // 3.1 Check if user is already a member of this project
            if (user) {
                const existingProjectMember = await this.prisma.projectMember.findUnique({
                    where: {
                        projectId_userId: {
                            projectId: id,
                            userId: user.id,
                        }
                    },
                    include: {
                        user: {
                            select: { email: true, name: true }
                        }
                    }
                });

                // If user is already an active project member, return early
                if (existingProjectMember && existingProjectMember.isActive) {
                    this.logger.log(`User ${email} is already an active member of project ${id} with role ${existingProjectMember.role}`);

                    // Fetch user's organization role to include in response
                    const orgMember = await this.prisma.orgMember.findFirst({
                        where: {
                            userId: user.id,
                            orgId,
                            status: MemberStatus.ACTIVE,
                        }
                    });

                    return {
                        status: 'EXISTING_PROJECT_MEMBER',
                        email,
                        organizationId: orgId,
                        organizationName: requester.org.name,
                        orgRole: orgMember?.role || orgRole, // Use existing org role, fallback to requested role
                        id,
                        projectName,
                        projectRole: existingProjectMember.role,
                        message: `User is already a member of this project with role: ${existingProjectMember.role}`,
                        inviteToken: undefined,
                        expiresAt: undefined,
                    };
                }
            }
        }

        // 4. Check if email already invited or member in organization
        const existingMember = await this.prisma.orgMember.findFirst({
            where: {
                email,
                orgId,
            },
        });

        // A. Handle Existing ACTIVE Member
        if (existingMember && existingMember.status === MemberStatus.ACTIVE) {
            // Note: We no longer update the Org Role here to match user preference.
            // Existing members keep their current role.
            const currentOrgRole = existingMember.role;

            // Case A1: Inviting existing member to a PROJECT (send project-specific invite)
            if (id && projectRole && existingMember.userId) {
                // Generate invite token and expiry for project invitation
                const inviteToken = generateInviteToken();
                const expiresAt = calculateExpiryDate(48); // 48 hours

                // Update orgMember with project invite info (keep status ACTIVE)
                await this.prisma.orgMember.update({
                    where: { id: existingMember.id },
                    data: {
                        inviteProjectId: id,
                        inviteProjectRole: projectRole,
                        inviteToken,
                        expiresAt,
                    },
                });

                this.logger.log(`Sent project invite to existing member ${email} for project ${id}`);

                // Return with invite token so project-specific email can be sent
                return {
                    status: 'EXISTING_MEMBER_PROJECT_INVITE',
                    email,
                    organizationId: orgId,
                    organizationName: requester.org.name,
                    orgRole: currentOrgRole,
                    id,
                    projectRole,
                    projectName,
                    inviteToken,
                    expiresAt,
                };
            }

            // Case A2: No project specified (just checking/confirming membership)
            return {
                status: 'EXISTING_MEMBER',
                email,
                organizationId: orgId,
                organizationName: requester.org.name,
                orgRole: currentOrgRole,
                id,
                projectRole,
                projectName,
                inviteToken: undefined,
                expiresAt: undefined,
            };
        }

        // B. Handle Already INVITED Member
        if (existingMember && existingMember.status === MemberStatus.INVITED) {
            throw new ConflictException('Invitation already sent to this email');
        }

        // 5. Prepare for Invite (Generate tokens) - user already fetched earlier
        const inviteToken = generateInviteToken();
        const expiresAt = calculateExpiryDate(48); // 48 hours

        // 6. Execute Invite (Update if Rejected, Create if New)
        if (existingMember && existingMember.status === MemberStatus.REJECTED) {
            this.logger.log(`Re-inviting previously rejected user ${email}`);

            await this.prisma.orgMember.update({
                where: { id: existingMember.id },
                data: {
                    role: orgRole,
                    status: MemberStatus.INVITED,
                    inviteToken,
                    expiresAt,
                    inviteProjectId: id,
                    inviteProjectRole: projectRole,
                },
            });
        } else {
            await this.prisma.orgMember.create({
                data: {
                    userId: user?.id,
                    email,
                    orgId,
                    role: orgRole,
                    status: MemberStatus.INVITED,
                    inviteToken,
                    expiresAt,
                    isActive: false,
                    inviteProjectId: id,
                    inviteProjectRole: projectRole,
                },
            });
        }

        this.logger.log(`Invite sent: ${email} → ${requester.org.name} (OrgRole: ${orgRole}${id ? `, Project: ${id}, ProjectRole: ${projectRole}` : ''})`);

        return {
            status: 'INVITED',
            inviteToken,
            email,
            organizationId: orgId,
            organizationName: requester.org.name,
            orgRole,
            id,
            projectRole,
            projectName,
            expiresAt,
            // Note: Project assignment happens on acceptance (stored in token metadata)
        };
    }

    /**
     * Accept Invite
     * - Validates token exists, not expired
     * - For new members: Updates status → ACTIVE
     * - For existing members: Just adds to project
     * - Handles pre-signup scenario (userId linking)
     * 
     * Security: Single-use token (cleared after use)
     */
    async acceptInvite(inviteToken: string, userId: string) {
        // 1. Find invitation by token
        const invitation = await this.prisma.orgMember.findUnique({
            where: { inviteToken },
            include: { org: true },
        });

        if (!invitation) {
            throw new NotFoundException('Invalid invitation token');
        }

        // 2. Validate status (INVITED for new members, ACTIVE for existing members being invited to project)
        if (invitation.status !== MemberStatus.INVITED && invitation.status !== MemberStatus.ACTIVE) {
            throw new BadRequestException('This invitation has already been processed');
        }

        // 3. Special validation: If status is ACTIVE, must have project invite
        if (invitation.status === MemberStatus.ACTIVE && !invitation.inviteProjectId) {
            throw new BadRequestException('Invalid invitation: no project specified for existing member');
        }

        // 4. Validate expiry
        if (isInviteExpired(invitation.expiresAt)) {
            throw new BadRequestException('This invitation has expired');
        }

        // 5. Validate user email match (security: only invited email can accept)
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user || user.email !== invitation.email) {
            throw new ForbiddenException('This invitation is not for your email address');
        }

        // 6. Accept: Update status (if needed), link userId, clear token
        // Use transaction to ensure both Org and Project membership are updated atomically
        const isProjectOnlyInvite = invitation.status === MemberStatus.ACTIVE;

        const accepted = await this.prisma.$transaction(async (tx) => {
            // A. Update OrgMember (clear token, update status if new member)
            const updateData: any = {
                inviteToken: null, // Single-use: destroy token
                expiresAt: null,
                inviteProjectId: null, // Clear project invite fields
                inviteProjectRole: null,
            };

            // Only update status and userId for new members
            if (!isProjectOnlyInvite) {
                updateData.userId = userId; // Link user (for pre-signup invites)
                updateData.status = MemberStatus.ACTIVE;
                updateData.isActive = true;
            }

            const orgMember = await tx.orgMember.update({
                where: { id: invitation.id },
                data: updateData,
                include: { org: true },
            });

            // B. Add to Project (if this was a project invite)
            if (invitation.inviteProjectId && invitation.inviteProjectRole) {
                // Upsert to handle potential re-invites or existing memberships safely
                await tx.projectMember.upsert({
                    where: {
                        projectId_userId: {
                            projectId: invitation.inviteProjectId,
                            userId,
                        }
                    },
                    update: {
                        role: invitation.inviteProjectRole,
                        isActive: true,
                    },
                    create: {
                        projectId: invitation.inviteProjectId,
                        userId,
                        role: invitation.inviteProjectRole,
                        isActive: true,
                    },
                });

                this.logger.log(`Project access granted: ${user.email} → Project ${invitation.inviteProjectId} as ${invitation.inviteProjectRole}`);
            }

            return orgMember;
        });

        const message = isProjectOnlyInvite
            ? 'Project invitation accepted successfully'
            : 'Invitation accepted successfully';

        this.logger.log(`${message}: ${user.email} → ${accepted.org.name}`);

        return {
            message,
            organization: {
                id: accepted.org.id,
                name: accepted.org.name,
                role: accepted.role,
            },
        };
    }

    /**
     * Reject Invite
     * - For new members: Updates status → REJECTED
     * - For existing members (project invite): Just clears project invite
     * - Clears token (no reuse)
     */
    async rejectInvite(inviteToken: string, userId: string) {
        // 1. Find + validate
        const invitation = await this.prisma.orgMember.findUnique({
            where: { inviteToken },
            include: { org: true },
        });

        if (!invitation) {
            throw new NotFoundException('Invalid invitation token');
        }

        // 2. Validate status (INVITED for new members, ACTIVE for existing members with project invite)
        if (invitation.status !== MemberStatus.INVITED && invitation.status !== MemberStatus.ACTIVE) {
            throw new BadRequestException('This invitation has already been processed');
        }

        // 3. Validate user email match
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user || user.email !== invitation.email) {
            throw new ForbiddenException('This invitation is not for your email address');
        }

        // 4. Reject
        const isProjectOnlyInvite = invitation.status === MemberStatus.ACTIVE;

        const updateData: any = {
            inviteToken: null, // Clear token
            expiresAt: null,
            inviteProjectId: null,
            inviteProjectRole: null,
        };

        // Only update status to REJECTED for new member invites
        if (!isProjectOnlyInvite) {
            updateData.status = MemberStatus.REJECTED;
        }

        const rejected = await this.prisma.orgMember.update({
            where: { id: invitation.id },
            data: updateData,
            include: { org: true },
        });

        const message = isProjectOnlyInvite
            ? 'Project invitation declined'
            : 'Invitation rejected';

        this.logger.log(`${message}: ${user.email} → ${rejected.org.name}`);

        return {
            message,
            organizationName: rejected.org.name,
        };
    }

    /**
     * Resend Invite
     * - Admin can resend expired/rejected invites
     * - Generates NEW token + expiry
     */
    async resendInvite(requesterId: string, orgId: string, email: string) {
        // 1. Permission check
        const requester = await this.prisma.orgMember.findUnique({
            where: { userId_orgId: { userId: requesterId, orgId } },
            include: { org: true },
        });

        if (!requester || (requester.role !== OrgRole.OWNER && requester.role !== OrgRole.ADMIN)) {
            throw new ForbiddenException('Only Admins or Owners can resend invitations');
        }

        // 2. Find existing invitation
        const existing = await this.prisma.orgMember.findFirst({
            where: { email, orgId },
        });

        if (!existing) {
            throw new NotFoundException('No invitation found for this email');
        }

        if (existing.status === MemberStatus.ACTIVE) {
            throw new ConflictException('User is already an active member');
        }

        // 3. Generate new token + expiry
        const inviteToken = generateInviteToken();
        const expiresAt = calculateExpiryDate(48);

        // 4. Update invitation
        const resent = await this.prisma.orgMember.update({
            where: { id: existing.id },
            data: {
                inviteToken,
                expiresAt,
                status: MemberStatus.INVITED, // Reset to INVITED
            },
            include: { org: true },
        });

        this.logger.log(`Invite resent: ${email} → ${resent.org.name}`);

        return {
            inviteToken,
            email,
            organizationName: resent.org.name,
            role: resent.role,
            expiresAt,
        };
    }

    /**
     * Get user's pending invites
     * Used for displaying invitations dashboard
     */
    async getPendingInvites(userId: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        return this.prisma.orgMember.findMany({
            where: {
                email: user.email,
                status: MemberStatus.INVITED,
            },
            include: {
                org: { select: { id: true, name: true, slug: true } },
            },
            orderBy: { joinedAt: 'desc' },
        });
    }

    /**
     * Search Users for Auto-suggestion
     * CASE A: projectId provided -> Search members of that project (filtered by query)
     * CASE B: No projectId -> Search all users (filtered by query)
     */
    async searchUsers(requesterId: string, dto: { query?: string; projectId?: string; orgId?: string; page?: number; limit?: number }) {
        const { query, projectId, orgId, page = 1, limit = 5 } = dto;
        const skip = (page - 1) * limit;

        // CASE 1: Project & Org Scope (Invite to project from org members, excluding existing project members)
        if (projectId && orgId) {
            const projectMembers = await this.prisma.projectMember.findMany({
                where: {
                    projectId,
                    isActive: true,
                },
                select: { userId: true },
            });
            const existingProjectUserIds = projectMembers.map(m => m.userId).filter(Boolean);

            const whereClause: any = {
                orgId,
                isActive: true,
                status: MemberStatus.ACTIVE,
                userId: {
                    notIn: [requesterId, ...existingProjectUserIds],
                },
            };

            if (query) {
                whereClause.OR = [
                    { email: { contains: query, mode: 'insensitive' } },
                    { user: { name: { contains: query, mode: 'insensitive' } } },
                    { user: { email: { contains: query, mode: 'insensitive' } } }
                ];
            }

            const [total, memberships] = await this.prisma.$transaction([
                this.prisma.orgMember.count({ where: whereClause }),
                this.prisma.orgMember.findMany({
                    where: whereClause,
                    select: {
                        id: true,
                        userId: true,
                        role: true,
                        status: true,
                        email: true,
                        user: {
                            select: { id: true, email: true, name: true, avatarUrl: true }
                        }
                    },
                    skip,
                    take: limit,
                }),
            ]);

            return {
                data: memberships.map(m => ({
                    id: m.userId || m.id,
                    memberId: m.id,
                    email: m.user?.email || m.email,
                    name: m.user?.name || null,
                    avatarUrl: m.user?.avatarUrl || null,
                    role: m.role,
                    status: m.status
                })),
                meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
            };
        }

        // CASE 2: Project Scope only (e.g. for task assignment, search existing project members)
        if (projectId) {
            const whereClause: any = {
                projectId,
                isActive: true,
                userId: { not: requesterId }
            };

            if (query) {
                whereClause.user = {
                    OR: [
                        { email: { contains: query, mode: 'insensitive' } },
                        { name: { contains: query, mode: 'insensitive' } }
                    ]
                };
            }

            const [total, members] = await this.prisma.$transaction([
                this.prisma.projectMember.count({ where: whereClause }),
                this.prisma.projectMember.findMany({
                    where: whereClause,
                    select: {
                        role: true,
                        user: {
                            select: { id: true, email: true, name: true, avatarUrl: true }
                        }
                    },
                    skip,
                    take: limit,
                }),
            ]);

            return {
                data: members.map(m => m.user ? ({ ...m.user, role: m.role }) : null).filter(Boolean),
                meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
            };
        }

        // CASE 2: Organization Scope
        if (orgId) {
            const whereClause: any = {
                orgId,
                isActive: true,
                userId: { not: requesterId },
                status: { in: [MemberStatus.ACTIVE, MemberStatus.INVITED] }
            };

            if (query) {
                whereClause.OR = [
                    { email: { contains: query, mode: 'insensitive' } },
                    { user: { name: { contains: query, mode: 'insensitive' } } },
                    { user: { email: { contains: query, mode: 'insensitive' } } }
                ];
            }

            const [total, memberships] = await this.prisma.$transaction([
                this.prisma.orgMember.count({ where: whereClause }),
                this.prisma.orgMember.findMany({
                    where: whereClause,
                    select: {
                        id: true,
                        userId: true,
                        role: true,
                        status: true,
                        email: true,
                        user: {
                            select: { id: true, email: true, name: true, avatarUrl: true }
                        }
                    },
                    skip,
                    take: limit,
                }),
            ]);

            return {
                data: memberships.map(m => ({
                    id: m.userId || m.id, // Prefer userId, fallback to orgMemberId
                    memberId: m.id,
                    email: m.user?.email || m.email,
                    name: m.user?.name || null,
                    avatarUrl: m.user?.avatarUrl || null,
                    role: m.role,
                    status: m.status
                })),
                meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
            };
        }

        // CASE 3: Global Scope
        const whereClause: any = {
            id: { not: requesterId }
        };
        if (query) {
            whereClause.OR = [
                { email: { contains: query, mode: 'insensitive' } },
                { name: { contains: query, mode: 'insensitive' } }
            ];
        }

        const [total, users] = await this.prisma.$transaction([
            this.prisma.user.count({ where: whereClause }),
            this.prisma.user.findMany({
                where: whereClause,
                select: { id: true, email: true, name: true, avatarUrl: true },
                skip,
                take: limit,
            }),
        ]);

        return {
            data: users,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
        };
    }
}
