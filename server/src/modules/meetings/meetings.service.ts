import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';
import { FilterMeetingDto } from './dto/filter-meeting.dto';
import { extractMentions, deduplicateMentions } from './utils/meeting-mention-parser';
import { extractPlainText } from './utils/meeting-plaintext-extractor';
import { MeetingMentionType, MeetingStatus, OrgRole } from '@prisma/client';

/**
 * Meetings Service
 * - Manages Minutes of Meeting (MOM) within organizations
 * - Extracts mentions server-side (frontend not trusted)
 * - Supports project backlinks via MeetingMention
 * - Enforces tenant isolation (orgId in all queries)
 */
@Injectable()
export class MeetingsService {
    private readonly logger = new Logger(MeetingsService.name);

    constructor(
        private prisma: PrismaService,
        private notificationService: NotificationService,
    ) { }

    // ═══════════════════════════════════════════════════════════════════════
    // CREATE MEETING
    // ═══════════════════════════════════════════════════════════════════════

    async create(orgId: string, userId: string, dto: CreateMeetingDto) {
        this.logger.log(`User ${userId} creating meeting in org ${orgId}`);

        // Extract plain text and mentions from TipTap content (server-side)
        const plainText = extractPlainText(dto.content);
        const rawMentions = extractMentions(dto.content);
        const mentions = deduplicateMentions(rawMentions);

        const meeting = await this.prisma.$transaction(async (tx) => {
            // 1. Create the meeting record
            const created = await tx.meeting.create({
                data: {
                    orgId,
                    createdById: userId,
                    title: dto.title,
                    location: dto.location,
                    numberOfPeople: dto.numberOfPeople,
                    time: dto.time,
                    purpose: dto.purpose,
                    attendedBy: dto.attendedBy,
                    absentees: dto.absentees,
                    content: dto.content,
                    plainText,
                    meetingDate: new Date(dto.meetingDate),
                    projectId: dto.projectId || null,
                    status: MeetingStatus.PUBLISHED,
                },
            });

            // 2. Insert extracted mentions
            if (mentions.length > 0) {
                await tx.meetingMention.createMany({
                    data: mentions.map((m) => ({
                        meetingId: created.id,
                        orgId,
                        type: m.type === 'USER' ? MeetingMentionType.USER : MeetingMentionType.PROJECT,
                        userId: m.userId || null,
                        projectId: m.projectId || null,
                        positionPath: m.positionPath,
                    })),
                    skipDuplicates: true,
                });
            }

            return created;
        });

        // 3. Notify mentioned users (outside transaction for performance)
        const userMentions = mentions.filter((m) => m.type === 'USER' && m.userId);
        for (const mention of userMentions) {
            try {
                await this.notificationService.sendMomMentionNotification(
                    mention.userId!,
                    meeting.id,
                    meeting.title,
                    userId,
                );
            } catch (err) {
                this.logger.warn(`Failed to notify user ${mention.userId}: ${err.message}`);
            }
        }

        // Return meeting with mentions populated
        return this.findOne(orgId, meeting.id);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // LIST MEETINGS (PAGINATED)
    // ═══════════════════════════════════════════════════════════════════════

    async findAll(orgId: string, filters: FilterMeetingDto) {
        const page = filters.page || 1;
        const limit = filters.limit || 10;
        const skip = (page - 1) * limit;

        const where: any = {
            orgId,
            isDeleted: false,
        };

        // Status filter
        if (filters.status) {
            where.status = filters.status;
        }

        // Search in plainText
        if (filters.search) {
            where.plainText = {
                contains: filters.search,
                mode: 'insensitive',
            };
        }

        // Date range filter
        if (filters.fromDate || filters.toDate) {
            where.meetingDate = {};
            if (filters.fromDate) {
                where.meetingDate.gte = new Date(filters.fromDate);
            }
            if (filters.toDate) {
                where.meetingDate.lte = new Date(filters.toDate);
            }
        }

        const [data, total] = await Promise.all([
            this.prisma.meeting.findMany({
                where,
                skip,
                take: limit,
                orderBy: { meetingDate: 'desc' },
                include: {
                    createdBy: {
                        select: { id: true, name: true, email: true, avatarUrl: true },
                    },
                    project: {
                        select: { id: true, name: true, color: true },
                    },
                    _count: {
                        select: { mentions: true },
                    },
                },
            }),
            this.prisma.meeting.count({ where }),
        ]);

        return {
            data,
            total,
            page,
            totalPages: Math.ceil(total / limit),
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // GET SINGLE MEETING
    // ═══════════════════════════════════════════════════════════════════════

    async findOne(orgId: string, meetingId: string) {
        const meeting = await this.prisma.meeting.findFirst({
            where: {
                id: meetingId,
                orgId,
                isDeleted: false,
            },
            include: {
                createdBy: {
                    select: { id: true, name: true, email: true, avatarUrl: true },
                },
                project: {
                    select: { id: true, name: true, color: true },
                },
                mentions: {
                    include: {
                        user: {
                            select: { id: true, name: true, email: true, avatarUrl: true },
                        },
                        project: {
                            select: { id: true, name: true, color: true },
                        },
                    },
                },
                attachments: true,
            },
        });

        if (!meeting) {
            throw new NotFoundException('Meeting not found');
        }

        return meeting;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // UPDATE MEETING
    // ═══════════════════════════════════════════════════════════════════════

    async update(orgId: string, meetingId: string, userId: string, dto: UpdateMeetingDto) {
        const meeting = await this.prisma.meeting.findFirst({
            where: { id: meetingId, orgId, isDeleted: false },
            include: { mentions: true },
        });

        if (!meeting) {
            throw new NotFoundException('Meeting not found');
        }

        // Check permission: creator, ADMIN, or OWNER
        await this.validateEditPermission(orgId, userId, meeting.createdById);

        const updateData: any = {};
        const fieldsToUpdate = [
            'title', 'location', 'numberOfPeople', 'time',
            'purpose', 'attendedBy', 'absentees', 'projectId',
        ];

        for (const field of fieldsToUpdate) {
            if (dto[field] !== undefined) {
                updateData[field] = dto[field];
            }
        }

        if (dto.meetingDate) {
            updateData.meetingDate = new Date(dto.meetingDate);
        }

        // If content changed, re-extract mentions and plainText
        let newMentions: any[] = [];
        if (dto.content !== undefined) {
            updateData.content = dto.content;
            updateData.plainText = extractPlainText(dto.content);

            const rawMentions = extractMentions(dto.content);
            newMentions = deduplicateMentions(rawMentions);
        }

        const updated = await this.prisma.$transaction(async (tx) => {
            // Update meeting record
            const result = await tx.meeting.update({
                where: { id: meetingId },
                data: updateData,
            });

            // If content changed, replace mentions
            if (dto.content !== undefined) {
                // Delete old mentions
                await tx.meetingMention.deleteMany({
                    where: { meetingId },
                });

                // Insert new mentions
                if (newMentions.length > 0) {
                    await tx.meetingMention.createMany({
                        data: newMentions.map((m) => ({
                            meetingId,
                            orgId,
                            type: m.type === 'USER' ? MeetingMentionType.USER : MeetingMentionType.PROJECT,
                            userId: m.userId || null,
                            projectId: m.projectId || null,
                            positionPath: m.positionPath,
                        })),
                        skipDuplicates: true,
                    });
                }
            }

            return result;
        });

        // Notify newly mentioned users
        if (dto.content !== undefined) {
            const oldUserIds = new Set(
                meeting.mentions
                    .filter((m) => m.type === MeetingMentionType.USER && m.userId)
                    .map((m) => m.userId!),
            );
            const newUserMentions = newMentions.filter(
                (m) => m.type === 'USER' && m.userId && !oldUserIds.has(m.userId),
            );

            for (const mention of newUserMentions) {
                try {
                    await this.notificationService.sendMomMentionNotification(
                        mention.userId!,
                        meetingId,
                        updated.title,
                        userId,
                    );
                } catch (err) {
                    this.logger.warn(`Failed to notify user ${mention.userId}: ${err.message}`);
                }
            }
        }

        return this.findOne(orgId, meetingId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLISH MEETING (DRAFT → PUBLISHED)
    // ═══════════════════════════════════════════════════════════════════════



    // ═══════════════════════════════════════════════════════════════════════
    // SOFT DELETE MEETING
    // ═══════════════════════════════════════════════════════════════════════

    async remove(orgId: string, meetingId: string, userId: string) {
        const meeting = await this.prisma.meeting.findFirst({
            where: { id: meetingId, orgId, isDeleted: false },
        });

        if (!meeting) {
            throw new NotFoundException('Meeting not found');
        }

        await this.validateEditPermission(orgId, userId, meeting.createdById);

        await this.prisma.meeting.update({
            where: { id: meetingId },
            data: {
                isDeleted: true,
                deletedAt: new Date(),
                deletedById: userId,
            },
        });

        return { message: 'Meeting deleted successfully' };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FIND MEETINGS BY PROJECT (Project Screen MOM Tab)
    // ═══════════════════════════════════════════════════════════════════════

    async findByProject(
        orgId: string,
        projectId: string,
        pagination: { page?: number; limit?: number },
    ) {
        const page = pagination.page || 1;
        const limit = pagination.limit || 10;
        const skip = (page - 1) * limit;

        const where = {
            // orgId,
            projectId,
            type: MeetingMentionType.PROJECT,
            meeting: {
                isDeleted: false,
                status: MeetingStatus.PUBLISHED,
            },
        };

        const [data, total] = await Promise.all([
            this.prisma.meetingMention.findMany({
                where,
                skip,
                take: limit,
                orderBy: { meeting: { meetingDate: 'desc' } },
                include: {
                    meeting: {
                        select: {
                            id: true,
                            title: true,
                            meetingDate: true,
                            plainText: true,
                            createdBy: {
                                select: { id: true, name: true, email: true, avatarUrl: true },
                            },
                        },
                    },
                },
            }),
            this.prisma.meetingMention.count({ where }),
        ]);

        // Transform to cleaner response
        const meetings = data.map((mention) => ({
            mentionIds: mention.id,
            meetingId: mention.meeting.id,
            title: mention.meeting.title,
            meetingDate: mention.meeting.meetingDate,
            createdBy: mention.meeting.createdBy,
            snippet: mention.meeting.plainText
                ? mention.meeting.plainText.substring(0, 200)
                : null,
            positionPath: mention.positionPath,
        }));

        return {
            data: meetings,
            total,
            page,
            totalPages: Math.ceil(total / limit),
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FIND MEETINGS BY USER (Future: User MOM Tab)
    // ═══════════════════════════════════════════════════════════════════════

    async findByUser(
        orgId: string,
        targetUserId: string,
        pagination: { page?: number; limit?: number },
    ) {
        const page = pagination.page || 1;
        const limit = pagination.limit || 10;
        const skip = (page - 1) * limit;

        const where = {
            orgId,
            userId: targetUserId,
            type: MeetingMentionType.USER,
            meeting: {
                isDeleted: false,
                status: MeetingStatus.PUBLISHED,
            },
        };

        const [data, total] = await Promise.all([
            this.prisma.meetingMention.findMany({
                where,
                skip,
                take: limit,
                orderBy: { meeting: { meetingDate: 'desc' } },
                include: {
                    meeting: {
                        select: {
                            id: true,
                            title: true,
                            meetingDate: true,
                            plainText: true,
                            createdBy: {
                                select: { id: true, name: true, email: true, avatarUrl: true },
                            },
                        },
                    },
                },
            }),
            this.prisma.meetingMention.count({ where }),
        ]);

        const meetings = data.map((mention) => ({
            meetingId: mention.meeting.id,
            title: mention.meeting.title,
            meetingDate: mention.meeting.meetingDate,
            createdBy: mention.meeting.createdBy,
            snippet: mention.meeting.plainText
                ? mention.meeting.plainText.substring(0, 200)
                : null,
            positionPath: mention.positionPath,
        }));

        return {
            data: meetings,
            total,
            page,
            totalPages: Math.ceil(total / limit),
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SUGGEST USERS (for @ autocomplete)
    // ═══════════════════════════════════════════════════════════════════════

    async suggestUsers(orgId: string, query: string) {
        const members = await this.prisma.orgMember.findMany({
            where: {
                orgId,
                status: 'ACTIVE',
                user: {
                    OR: [
                        { name: { contains: query, mode: 'insensitive' } },
                        { email: { contains: query, mode: 'insensitive' } },
                    ],
                },
            },
            take: 10,
            include: {
                user: {
                    select: { id: true, name: true, email: true, avatarUrl: true },
                },
            },
        });

        return members
            .filter((m) => m.user)
            .map((m) => ({
                id: m.user!.id,
                name: m.user!.name,
                email: m.user!.email,
                avatarUrl: m.user!.avatarUrl,
            }));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SUGGEST PROJECTS (for # autocomplete)
    // ═══════════════════════════════════════════════════════════════════════

    async suggestProjects(orgId: string, query: string) {
        const projects = await this.prisma.project.findMany({
            where: {
                orgId,
                isDeleted: false,
                name: { contains: query, mode: 'insensitive' },
            },
            take: 10,
            select: {
                id: true,
                name: true,
                color: true,
            },
        });

        return projects;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PERMISSION HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Validates that user can edit/delete a meeting.
     * Allowed: creator, org ADMIN, or org OWNER.
     */
    private async validateEditPermission(
        orgId: string,
        userId: string,
        creatorId: string,
    ) {
        if (userId === creatorId) return;

        const membership = await this.prisma.orgMember.findFirst({
            where: {
                orgId,
                userId,
                status: 'ACTIVE',
                role: { in: [OrgRole.ADMIN, OrgRole.OWNER] },
            },
        });

        if (!membership) {
            throw new ForbiddenException('You do not have permission to modify this meeting');
        }
    }
}
