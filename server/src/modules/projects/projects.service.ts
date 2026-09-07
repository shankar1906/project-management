import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProjectDto, UpdateProjectDto, ProjectAccess } from './dto/project.dto';
import { ProjectRole, OrgRole } from '@prisma/client';
import { FilterProjectDto } from './dto/filter-project.dto';

/**
 * Projects Service
 * - Manages projects within organizations
 * - Enforces tenant isolation
 * - Creates default workflow when creating project
 */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(private prisma: PrismaService) { }

  /**
   * Create project
   * - Project belongs to organization (tenant-scoped)
   * - Creator becomes project ADMIN
   * - Creates default workflow (stages + statuses)
   * - RBAC: Re-validate org role OWNER/ADMIN (defensive, do not rely on controller only)
   */
  async create(orgId: string, userId: string, dto: CreateProjectDto) {
    try {
      // 1. Re-validate org role: only OWNER or ADMIN can create projects
      const orgMember = await this.prisma.orgMember.findUnique({
        where: { userId_orgId: { userId, orgId } },
        select: { role: true, isActive: true },
      });
      if (!orgMember || !orgMember.isActive) {
        throw new ForbiddenException('You do not have access to this organization');
      }
      if (orgMember.role !== OrgRole.OWNER && orgMember.role !== OrgRole.ADMIN) {
        throw new ForbiddenException('Only organization owners or admins can create projects');
      }

      // 2. Process tags: Find existing or Create new
      let finalTagIds: string[] = [];

      if (dto.tags && dto.tags.length > 0) {
        for (const tagDto of dto.tags) {
          // 1. Try to find existing tag by ID (if provided) or Name
          let tag = await this.prisma.tag.findFirst({
            where: {
              orgId,
              OR: [
                { id: tagDto.id },
                { name: { equals: tagDto.name, mode: 'insensitive' } }
              ]
            }
          });

          // 2. If not found, create it
          if (!tag) {
            tag = await this.prisma.tag.create({
              data: {
                orgId,
                name: tagDto.name,
                color: tagDto.color || '#808080', // Default usually gray if not specified
              }
            });
          }

          finalTagIds.push(tag.id);
        }
      }

      const project = await this.prisma.$transaction(async (tx) => {
        const projectCount = await tx.project.count({
          where: { orgId }
        });
        const projectId = `TCP-${projectCount + 1}`;

        // Create project
        const newProject = await tx.project.create({
          data: {
            orgId,
            projectId,
            name: dto.name,
            description: dto.description,
            color: dto.color,
            startDate: dto.startDate ? new Date(dto.startDate) : undefined,
            endDate: dto.endDate ? new Date(dto.endDate) : undefined,
            access: dto.access as any,
            status: dto.status as any,
            ownerId: userId,
            tags: finalTagIds.length > 0
              ? {
                create: finalTagIds.map((tagId) => ({ tagId })),
              }
              : undefined,
          },
        });

        // Add creator as project ADMIN
        await tx.projectMember.create({
          data: {
            projectId: newProject.id,
            userId,
            role: ProjectRole.ADMIN,
          },
        });

        // Create default workflow
        await this.createDefaultWorkflow(tx, newProject.id);

        return newProject;
      });

      this.logger.log(`Created project ${project.id} in org ${orgId}`);
      this.logger.log(`Created default workflow for project ${project.id}`);

      // Fetch tag details to return
      const createdTags = finalTagIds.length > 0 ? await this.prisma.tag.findMany({
        where: { id: { in: finalTagIds } }
      }) : [];

      return {
        id: project.id,
        name: project.name,
        description: project.description,
        color: project.color,
        projectId: project.projectId,
        startDate: project.startDate,
        endDate: project.endDate,
        access: project.access,
        status: project.status,
        ownerId: project.ownerId,
        role: ProjectRole.ADMIN,
        tags: createdTags,
      };
    }
    catch (error) {
      this.logger.error(`Failed to create project in org ${orgId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * List projects user has access to in organization
   */
  async listUserProjects(orgId: string, userId: string) {
    const memberships = await this.prisma.projectMember.findMany({
      where: {
        userId,
        isActive: true,
        project: {
          orgId,
          isDeleted: false,
          isArchived: false,
        },
      },
      select: {
        role: true,
        joinedAt: true,
        project: {
          select: {
            id: true,
            name: true,
            description: true,
            color: true,
            projectId: true,
            startDate: true,
            endDate: true,
            access: true,
            status: true,
            ownerId: true,
            createdAt: true,
            tags: {
              include: {
                tag: true,
              },
            },
          },
        },
      },
      orderBy: {
        joinedAt: 'desc',
      },
    });

    return memberships.map((m) => ({
      id: m.project.id,
      name: m.project.name,
      description: m.project.description,
      color: m.project.color,
      projectId: m.project.projectId,
      startDate: m.project.startDate,
      endDate: m.project.endDate,
      access: m.project.access,
      status: m.project.status,
      ownerId: m.project.ownerId,
      role: m.role,
      tags: m.project.tags.map((pt) => pt.tag),
      joinedAt: m.joinedAt,
      createdAt: m.project.createdAt,
    }));
  }

  /**
   * Get all projects in the organization
   * - Used for organization-wide views
   */
  /**
   * Get all projects across all organizations the user is a member of
   */
  async getAllGlobalProjects(userId: string) {
    this.logger.log(`Fetching global projects for user: ${userId}`);
    // 1. Get all active org memberships
    const memberships = await this.prisma.orgMember.findMany({
      where: { userId, isActive: true },
      select: { orgId: true }
    });

    const orgIds = memberships.map(m => m.orgId);
    this.logger.log(`Found active memberships in orgs: ${JSON.stringify(orgIds)}`);

    const projects = await this.prisma.project.findMany({
      where: {
        orgId: { in: orgIds },
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
        projectId: true,
        startDate: true,
        endDate: true,
        access: true,
        status: true,
        ownerId: true,
        createdAt: true,
        org: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        },
        tags: {
          include: {
            tag: true,
          },
        },
        members: {
          take: 5,
          select: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true
              }
            }
          }
        },
        _count: {
          select: {
            members: true,
            tasks: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      color: p.color,
      projectId: p.projectId,
      startDate: p.startDate,
      endDate: p.endDate,
      access: p.access,
      status: p.status,
      ownerId: p.ownerId,
      organization: p.org,
      tags: p.tags.map((pt) => pt.tag),
      members: p.members.map(m => m.user),
      counts: {
        members: p._count.members,
        tasks: p._count.tasks
      },
      createdAt: p.createdAt,
    }));
  }

  /**
   * Search projects with filters and pagination
   * Defaults to global scope if no orgId filter
   */
  // async searchProjects(requesterId: string, currentOrgId: string, query: FilterProjectDto) {
  //   const page = query.page ? parseInt(query.page) : 1;
  //   const limit = query.limit ? parseInt(query.limit) : 10;
  //   const skip = (page - 1) * limit;

  //   // 1. Determine Scope (Orgs I can see & Projects I am member of)
  //   // Always fetch memberships for requester to ensure security
  //   const [orgMemberships, projectMemberships] = await Promise.all([
  //     this.prisma.orgMember.findMany({
  //       where: { userId: requesterId, isActive: true },
  //       select: { orgId: true, role: true },
  //     }),
  //     this.prisma.projectMember.findMany({
  //       where: { userId: requesterId, isActive: true },
  //       select: { projectId: true },
  //     }),
  //   ]);

  //   // Orgs where I am OWNER or ADMIN (Full Access)
  //   const adminOrgIds = orgMemberships
  //     .filter((m) => m.role === OrgRole.OWNER || m.role === OrgRole.ADMIN)
  //     .map((m) => m.orgId);

  //   const myProjectIds = projectMemberships.map((m) => m.projectId);

  //   // 2. Resolve Target User (filter by userId)
  //   let targetUserId = query.userId;
  //   if (query.email) {
  //     const user = await this.prisma.user.findUnique({ where: { email: query.email } });
  //     if (user) {
  //       targetUserId = user.id;
  //     } else {
  //       return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
  //     }
  //   }

  //   // 3. Build Where Clause
  //   const where: any = {
  //     isDeleted: false,
  //   };

  //   // Apply Scope & Org Filter
  //   if (query.orgId) {
  //     where.orgId = query.orgId;

  //     // Access Check:
  //     // If I am ADMIN/OWNER of this Org, I see everything (no extra ID filter).
  //     // If I am NOT ADMIN/OWNER (e.g. MEMBER/GUEST) or NOT IN ORG, I only see projects I'm explicitly part of.
  //     if (!adminOrgIds.includes(query.orgId)) {
  //       where.id = { in: myProjectIds };
  //     }
  //   } else {
  //     // Global Search:
  //     // 1. Projects in Orgs where I am ADMIN/OWNER (See All)
  //     // 2. Projects I am explicitly a member of (See Assigned)
  //     where.OR = [
  //       { orgId: { in: adminOrgIds } },
  //       { id: { in: myProjectIds } },
  //     ];
  //   }

  //   if (targetUserId) {
  //     // Filter projects where 'targetUserId' is a member
  //     where.members = {
  //       some: { userId: targetUserId },
  //     };
  //   }

  //   // 5. Execute Query
  //   const [projects, total] = await Promise.all([
  //     this.prisma.project.findMany({
  //       where,
  //       skip,
  //       take: limit,
  //       orderBy: { createdAt: 'desc' },
  //       include: {
  //         org: { select: { id: true, name: true, slug: true } },
  //         tags: { include: { tag: true } },
  //         members: {
  //           take: 5,
  //           select: {
  //             user: { select: { id: true, name: true, email: true, avatarUrl: true } }
  //           }
  //         },
  //         _count: { select: { members: true, tasks: true } }
  //       }
  //     }),
  //     this.prisma.project.count({ where })
  //   ]);

  //   // Fetch my roles for these projects
  //   const projectIds = projects.map(p => p.id);

  //   // DEBUG: Log checks
  //   this.logger.debug(`Fetching roles for user ${requesterId} in projects: ${projectIds.length}`);

  //   const myMemberships = await this.prisma.projectMember.findMany({
  //     where: {
  //       userId: requesterId,
  //       projectId: { in: projectIds },
  //       isActive: true, // Only consider active memberships
  //     },
  //     select: { projectId: true, role: true }
  //   });

  //   // DEBUG: Log results
  //   this.logger.debug(`Found ${myMemberships.length} memberships`);

  //   const roleMap = new Map<string, string>();
  //   myMemberships.forEach(m => roleMap.set(m.projectId, m.role));

  //   // 6. Map Response
  //   const data = projects.map((p) => ({
  //     id: p.id,
  //     name: p.name,
  //     description: p.description,
  //     color: p.color,
  //     projectId: p.projectId,
  //     startDate: p.startDate,
  //     endDate: p.endDate,
  //     access: p.access,
  //     status: p.status,
  //     ownerId: p.ownerId,
  //     organization: p.org,
  //     role: roleMap.get(p.id) || null,
  //     tags: p.tags.map((pt) => pt.tag),
  //     members: p.members.map(m => m.user),
  //     counts: {
  //       members: p._count.members,
  //       tasks: p._count.tasks
  //     },
  //     createdAt: p.createdAt,
  //   }));

  //   return {
  //     data,
  //     meta: {
  //       total,
  //       page,
  //       limit,
  //       totalPages: Math.ceil(total / limit)
  //     }
  //   };
  // }

  async searchProjects(
    requesterId: string,
    orgId: string,
    query: FilterProjectDto
  ) {
    if (!orgId) {
      throw new ForbiddenException('Organization context required');
    }

    const page = query.page ? parseInt(query.page) : 1;
    const limit = query.limit ? parseInt(query.limit) : 10;
    const skip = (page - 1) * limit;

    // Verify membership (OrgGuard already does this, but safe)
    const orgMembership = await this.prisma.orgMember.findUnique({
      where: {
        userId_orgId: {
          userId: requesterId,
          orgId
        }
      }
    });

    if (!orgMembership || !orgMembership.isActive) {
      throw new ForbiddenException();
    }

    // Scope strictly to header org
    const where: any = {
      orgId,
      isDeleted: false
    };

    const [projects, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          tags: {
            include: {
              tag: true
            }
          }
        }
      }),
      this.prisma.project.count({ where })
    ]);

    // Fetch user's roles for these projects
    const projectIds = projects.map(p => p.id);
    const myMemberships = await this.prisma.projectMember.findMany({
      where: {
        userId: requesterId,
        projectId: { in: projectIds },
        isActive: true,
      },
      select: { projectId: true, role: true }
    });

    const roleMap = new Map<string, string>();
    myMemberships.forEach(m => roleMap.set(m.projectId, m.role));

    const mappedProjects = projects.map((p) => ({
      id: p.id,
      orgId: p.orgId,
      name: p.name,
      description: p.description,
      color: p.color,
      startDate: p.startDate,
      endDate: p.endDate,
      access: p.access,
      status: p.status,
      projectId: p.projectId,
      ownerId: p.ownerId,
      isArchived: p.isArchived,
      isDeleted: p.isDeleted,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      role: roleMap.get(p.id) || null,
      tags: p.tags.map((pt) => pt.tag),
    }));

    return {
      data: mappedProjects,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }
  /**
   * Get project details
   * - Strict isolation: project must belong to orgId (from x-org-id)
   */
  async getProject(projectId: string, orgId: string, userId: string) {
    // 1. Find project in current org only (strict tenant isolation)
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        orgId,
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
        projectId: true,
        startDate: true,
        endDate: true,
        access: true,
        status: true,
        ownerId: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true,
        orgId: true, // Need this to verify org access
        tags: {
          include: {
            tag: true,
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // 2. Verify user belongs to this organization
    const orgMembership = await this.prisma.orgMember.findUnique({
      where: {
        userId_orgId: {
          userId,
          orgId,
        },
      },
      select: { role: true, isActive: true },
    });

    if (!orgMembership || !orgMembership.isActive) {
      throw new ForbiddenException('You do not have access to this organization');
    }

    // 3. Get user's role in project
    const membership = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });

    // 4. Access Logic: Allow if Project Member OR Org Admin/Owner
    const isOrgAdmin =
      orgMembership.role === OrgRole.ADMIN ||
      orgMembership.role === OrgRole.OWNER;

    if ((!membership || !membership.isActive) && !isOrgAdmin) {
      throw new ForbiddenException('You do not have access to this project');
    }

    // Remove orgId from response to keep it clean if not needed, or keep it.
    // The DTO earlier didn't seem to explicitly require it, but it's safe to return.
    const { orgId: _, ...projectData } = project;

    return {
      ...projectData,
      tags: project.tags.map((pt) => pt.tag),
      // If no direct membership but is Admin/Owner, assume ADMIN role for the project view
      role: membership?.role || (isOrgAdmin ? ProjectRole.ADMIN : null),
    };
  }

  /**
   * Get project members
   * - Returns all members associated with the project
   * - Strict isolation: project must belong to orgId
   */
  async getProjectMembers(projectId: string, orgId: string, userId: string) {
    // 1. Find project in current org only
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, orgId, isDeleted: false },
      select: { id: true },
    });

    if (!project) throw new NotFoundException('Project not found');

    // 2. Verify requesting user's access (org member check)
    const orgMembership = await this.prisma.orgMember.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });

    if (!orgMembership || !orgMembership.isActive) {
      throw new ForbiddenException('You do not have access to this organization');
    }

    // 3. Project Access Check
    // Allow if:
    // - User is Org ADMIN/OWNER
    // - User is a Member of the Project
    const isOrgAdmin = orgMembership.role === OrgRole.ADMIN || orgMembership.role === OrgRole.OWNER;

    if (!isOrgAdmin) {
      const projectMembership = await this.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } }
      });

      if (!projectMembership || !projectMembership.isActive) {
        throw new ForbiddenException('You do not have access to this project');
      }
    }

    // 4. Fetch Members
    const members = await this.prisma.projectMember.findMany({
      where: {
        projectId,
        isActive: true
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          }
        }
      },
      orderBy: {
        joinedAt: 'desc'
      }
    });

    return members.map(m => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
      user: m.user
    }));
  }



  /**
   * Update project
   * - Only Project Owner or Org Admin/Owner or Project Admin can update
   * - Strict isolation: project must belong to orgId
   */
  async update(projectId: string, orgId: string, userId: string, dto: UpdateProjectDto) {
    // 1. Find project in current org only
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, orgId, isDeleted: false },
    });

    if (!project) throw new NotFoundException('Project not found');

    // 2. Check Organization Membership
    const orgMember = await this.prisma.orgMember.findUnique({
      where: { userId_orgId: { userId, orgId: project.orgId } }
    });

    if (!orgMember || !orgMember.isActive) {
      throw new ForbiddenException('You do not have access to this organization');
    }

    // 3. Check Permissions (Project Owner OR Org Admin/Owner OR Project Admin)
    const isProjectOwner = project.ownerId === userId;
    const isOrgAdmin = orgMember.role === OrgRole.OWNER || orgMember.role === OrgRole.ADMIN;

    // Check if user is an Admin of this specific project
    const projectMember = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });
    const isProjectAdmin = projectMember?.role === ProjectRole.ADMIN;

    if (!isProjectOwner && !isOrgAdmin && !isProjectAdmin) {
      throw new ForbiddenException('Insufficient permissions: Only Project Owner, Project Admins, or Organization Admins can update this project');
    }

    // 4. Process Tags (if provided)
    let finalTagIds: string[] | undefined = undefined;

    if (dto.tags) {
      finalTagIds = [];
      for (const tagDto of dto.tags) {
        // Find or create tag in the project's organization
        let tag = await this.prisma.tag.findFirst({
          where: {
            orgId: project.orgId,
            OR: [
              { id: tagDto.id },
              { name: { equals: tagDto.name, mode: 'insensitive' } }
            ]
          }
        });

        if (!tag) {
          tag = await this.prisma.tag.create({
            data: {
              orgId: project.orgId,
              name: tagDto.name,
              color: tagDto.color || '#808080',
            }
          });
        }
        finalTagIds.push(tag.id);
      }
    }

    // 5. Update Project
    return this.prisma.$transaction(async (tx) => {
      // If tags are being updated, remove old associations first
      if (finalTagIds) {
        await tx.projectTag.deleteMany({
          where: { projectId }
        });
      }

      const updatedProject = await tx.project.update({
        where: { id: projectId },
        data: {
          name: dto.name,
          description: dto.description,
          color: dto.color,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
          access: dto.access as any,
          status: dto.status as any,
          tags: finalTagIds ? {
            create: finalTagIds.map((tagId) => ({ tagId })),
          } : undefined,
        },
        include: {
          tags: {
            include: { tag: true }
          },
          members: {
            take: 5,
            select: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatarUrl: true
                }
              }
            }
          },
          _count: {
            select: {
              members: true,
              tasks: true
            }
          }
        }
      });

      this.logger.log(`Project ${projectId} updated by user ${userId}`);

      return {
        ...updatedProject,
        tags: (updatedProject as any).tags.map((pt: any) => pt.tag),
        members: updatedProject.members.map(m => m.user),
        counts: {
          members: updatedProject._count.members,
          tasks: updatedProject._count.tasks
        }
      };
    });
  }

  /**
   * Delete project (Soft Delete)
   * - Only Project Owner can delete
   * - Strict isolation: project must belong to orgId
   */
  async delete(projectId: string, orgId: string, userId: string) {
    // 1. Find project in current org only
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, orgId, isDeleted: false },
    });

    if (!project) throw new NotFoundException('Project not found');

    // 2. Check Organization Membership
    const orgMember = await this.prisma.orgMember.findUnique({
      where: { userId_orgId: { userId, orgId: project.orgId } }
    });

    if (!orgMember || !orgMember.isActive) {
      throw new ForbiddenException('You do not have access to this organization');
    }

    // 3. Check Permissions (ONLY Project Owner)
    const isProjectOwner = project.ownerId === userId;

    if (!isProjectOwner) {
      throw new ForbiddenException('Only the project owner can delete this project');
    }

    // 4. Soft Delete
    await this.prisma.project.update({
      where: { id: projectId },
      data: { isDeleted: true },
    });

    this.logger.log(`Project ${projectId} soft deleted by owner ${userId}`);

    return { message: 'Project deleted successfully', projectId };
  }

  /**
   * Create default workflow for new project
   * Stages: To Do → In Progress → Done
   * Statuses: Not Started, Working, Stuck, Completed
   */
  private async createDefaultWorkflow(tx: any, projectId: string) {
    // Stage 1: To Do
    const toDo = await tx.taskStage.create({
      data: {
        projectId,
        name: 'To Do',
        order: 1,
        color: '#E85D75',
      },
    });

    await tx.taskStatus.create({
      data: {
        projectId,
        stageId: toDo.id,
        name: 'Not Started',
        order: 1,
        color: '#C4C4C4',
        isDefault: true, // This is the default status for new tasks
      },
    });

    // Stage 2: In Progress
    const inProgress = await tx.taskStage.create({
      data: {
        projectId,
        name: 'In Progress',
        order: 2,
        color: '#FDAB3D',
      },
    });

    await tx.taskStatus.create({
      data: {
        projectId,
        stageId: inProgress.id,
        name: 'Working On It',
        order: 1,
        color: '#FDAB3D',
      },
    });

    await tx.taskStatus.create({
      data: {
        projectId,
        stageId: inProgress.id,
        name: 'Stuck',
        order: 2,
        color: '#E85D75',
      },
    });

    // Stage 3: Done
    const done = await tx.taskStage.create({
      data: {
        projectId,
        name: 'Done',
        order: 3,
        color: '#00C875',
      },
    });

    await tx.taskStatus.create({
      data: {
        projectId,
        stageId: done.id,
        name: 'Completed',
        order: 1,
        color: '#00C875',
      },
    });

    this.logger.log(`Created default workflow for project ${projectId}`);
  }
}
