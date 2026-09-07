import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationType } from '@prisma/client';
import { NotificationGateway } from './notification.gateway';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Notification Service
 * Handles database persistence + real-time WebSocket delivery
 * Security: Notifications delivered only to target userId
 */
@Injectable()
export class NotificationService {
    private readonly logger = new Logger(NotificationService.name);

    constructor(
        private prisma: PrismaService,
        private notificationGateway: NotificationGateway,
        private configService: ConfigService,
    ) { }

    /**
     * Send invite received notification
     * Triggered when: Admin sends invite
     * Target: Invited user (if registered)
     */
    async sendInviteNotification(email: string, organizationId: string, organizationName: string) {
        // Find user by email (may not exist if pre-signup invite)
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (!user) {
            this.logger.log(`Invite sent to ${email}, but user not registered yet. Skipping notification.`);
            return null;
        }

        // Create notification in DB
        const notification = await this.prisma.notification.create({
            data: {
                userId: user.id,
                type: NotificationType.INVITE_RECEIVED,
                message: `🎉 You have been invited to join the organization "${organizationName}". Head over to your invitations to accept or decline.`,
                organizationId,
            },
        });

        // Send real-time via WebSocket
        this.notificationGateway.sendToUser(user.id, {
            id: notification.id,
            type: notification.type,
            message: notification.message,
            organizationId: notification.organizationId,
            createdAt: notification.createdAt,
        });

        this.logger.log(`Notification sent: INVITE_RECEIVED → ${user.email}`);
        return notification;
    }

    /**
     * Send invite accepted notification
     * Triggered when: User accepts invite
     * Target: Organization admins
     */
    async sendInviteAcceptedNotification(organizationId: string, acceptedUserId: string) {
        const acceptedUser = await this.prisma.user.findUnique({
            where: { id: acceptedUserId },
        });

        const org = await this.prisma.organization.findUnique({
            where: { id: organizationId },
        });

        if (!acceptedUser || !org) return;

        // Find all admins/owners of the organization
        const admins = await this.prisma.orgMember.findMany({
            where: {
                orgId: organizationId,
                role: { in: ['OWNER', 'ADMIN'] },
                isActive: true,
            },
            select: { userId: true },
        });

        // Send notification to each admin
        for (const admin of admins) {
            if (!admin.userId) continue;

            const notification = await this.prisma.notification.create({
                data: {
                    userId: admin.userId,
                    type: NotificationType.INVITE_ACCEPTED,
                    message: `✅ ${acceptedUser.name || acceptedUser.email} has accepted your invitation and joined "${org.name}" as a new member.`,
                    organizationId,
                },
            });

            this.notificationGateway.sendToUser(admin.userId, {
                id: notification.id,
                type: notification.type,
                message: notification.message,
                organizationId: notification.organizationId,
                createdAt: notification.createdAt,
            });
        }

        this.logger.log(`Notification sent: INVITE_ACCEPTED → ${admins.length} admins`);
    }

    /**
     * Send invite rejected notification
     * Triggered when: User rejects invite
     * Target: Organization admins
     */
    async sendInviteRejectedNotification(inviteToken: string, rejectedUserId: string) {
        // Find the invitation to get org context
        const invitation = await this.prisma.orgMember.findUnique({
            where: { inviteToken },
            include: { org: true },
        });

        if (!invitation) return;

        const rejectedUser = await this.prisma.user.findUnique({
            where: { id: rejectedUserId },
        });

        if (!rejectedUser) return;

        // Find admins
        const admins = await this.prisma.orgMember.findMany({
            where: {
                orgId: invitation.orgId,
                role: { in: ['OWNER', 'ADMIN'] },
                isActive: true,
            },
            select: { userId: true },
        });

        // Notify admins
        for (const admin of admins) {
            if (!admin.userId) continue;

            const notification = await this.prisma.notification.create({
                data: {
                    userId: admin.userId,
                    type: NotificationType.INVITE_REJECTED,
                    message: `❌ ${rejectedUser.name || rejectedUser.email} has declined the invitation to join "${invitation.org.name}". You may resend or revoke the invite.`,
                    organizationId: invitation.orgId,
                },
            });

            this.notificationGateway.sendToUser(admin.userId, {
                id: notification.id,
                type: notification.type,
                message: notification.message,
                organizationId: notification.organizationId,
                createdAt: notification.createdAt,
            });
        }

        this.logger.log(`Notification sent: INVITE_REJECTED → ${admins.length} admins`);
    }

    /**
     * Mark notification as read
     */
    async markAsRead(notificationId: string, userId: string) {
        const notification = await this.prisma.notification.findFirst({
            where: { id: notificationId, userId },
        });

        if (!notification) return null;

        return this.prisma.notification.update({
            where: { id: notificationId },
            data: { readAt: new Date() },
        });
    }

    /**
     * Get all notifications with pagination and filtering
     */
    async getAllNotifications(userId: string, page = 1, limit = 20, status?: 'read' | 'unread' | 'all') {
        const where: any = { userId };

        if (status === 'unread') {
            where.readAt = null;
        } else if (status === 'read') {
            where.readAt = { not: null };
        }

        const [notifications, total] = await Promise.all([
            this.prisma.notification.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.notification.count({ where }),
        ]);

        return {
            data: notifications,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Send task assignment notification
     * Triggered when: User is assigned to a task
     */
    async sendTaskAssignmentNotification(
        userId: string,
        taskId: string,
        taskTitle: string,
        projectId: string,
        projectName: string,
        assignerName: string
    ) {
        try {
            // Fetch orgId from project to set context
            const project = await this.prisma.project.findUnique({
                where: { id: projectId },
                select: { orgId: true }
            });

            if (!project) return;

            const message = `📋 ${assignerName} assigned you to the task "${taskTitle}" in project "${projectName}". Open the task to view details and get started.`;

            // Create notification in DB
            const notification = await this.prisma.notification.create({
                data: {
                    userId,
                    type: NotificationType.TASK_ASSIGNED,
                    message,
                    organizationId: project.orgId,
                    metadata: {
                        taskId,
                        projectId,
                        projectName,
                        assignerName
                    }
                },
            });

            // Send real-time via WebSocket
            this.notificationGateway.sendToUser(userId, {
                id: notification.id,
                type: notification.type,
                message: notification.message,
                organizationId: notification.organizationId,
                createdAt: notification.createdAt,
                metadata: notification.metadata // Include metadata for frontend navigation
            });

            // TODO: Integrate Email Service here
            // await this.emailService.sendTaskAssignmentEmail(...)

            this.logger.log(`Notification sent: TASK_ASSIGNED → ${userId}`);
        } catch (error) {
            this.logger.error(`Failed to send task assignment notification: ${error.message}`);
        }
    }

    /**
     * Send task completion notification
     * Triggered when: Task status changes to completed
     */
    async sendTaskCompletedNotification(
        userId: string,
        taskId: string,
        taskTitle: string,
        projectId: string,
        projectName: string,
        completerName: string
    ) {
        try {
            const project = await this.prisma.project.findUnique({
                where: { id: projectId },
                select: { orgId: true }
            });

            if (!project) return;

            const message = `🎯 The task "${taskTitle}" in project "${projectName}" has been marked as completed by ${completerName}.`;

            // Create notification in DB
            const notification = await this.prisma.notification.create({
                data: {
                    userId,
                    type: NotificationType.TASK_COMPLETED,
                    message,
                    organizationId: project.orgId,
                    metadata: {
                        taskId,
                        projectId,
                        projectName,
                        completerName
                    }
                },
            });

            // Send real-time via WebSocket
            this.notificationGateway.sendToUser(userId, {
                id: notification.id,
                type: notification.type,
                message: notification.message,
                organizationId: notification.organizationId,
                createdAt: notification.createdAt,
                metadata: notification.metadata
            });

            this.logger.log(`Notification sent: TASK_COMPLETED → ${userId}`);

            // Send Email
            const recipient = await this.prisma.user.findUnique({
                where: { id: userId },
                select: { email: true }
            });

            if (recipient?.email) {
                await this.sendEmail(
                    recipient.email,
                    `Task Completed: ${taskTitle}`,
                    message,
                    projectId,
                    taskId
                );
            }

        } catch (error) {
            this.logger.error(`Failed to send task completion notification: ${error.message}`);
        }
    }

    /**
     * Send MOM mention notification
     * Triggered when: User is @mentioned in a meeting (MOM)
     * Target: The mentioned user
     */
    async sendMomMentionNotification(
        userId: string,
        meetingId: string,
        meetingTitle: string,
        mentionedById: string,
    ) {
        try {
            // Get the user who mentioned
            const mentioner = await this.prisma.user.findUnique({
                where: { id: mentionedById },
                select: { name: true, email: true },
            });

            if (!mentioner) return;

            // Get meeting to find orgId
            const meeting = await this.prisma.meeting.findUnique({
                where: { id: meetingId },
                select: { orgId: true },
            });

            if (!meeting) return;

            const mentionerName = mentioner.name || mentioner.email || 'Someone';
            const message = `💬 ${mentionerName} mentioned you in the meeting notes for "${meetingTitle}". Tap to view the full discussion.`;

            // Create notification in DB
            const notification = await this.prisma.notification.create({
                data: {
                    userId,
                    type: NotificationType.MOM_MENTIONED,
                    message,
                    organizationId: meeting.orgId,
                    metadata: {
                        meetingId,
                        meetingTitle,
                        mentionedById,
                    },
                },
            });

            // Send real-time via WebSocket
            this.notificationGateway.sendToUser(userId, {
                id: notification.id,
                type: notification.type,
                message: notification.message,
                organizationId: notification.organizationId,
                createdAt: notification.createdAt,
                metadata: notification.metadata,
            });

            this.logger.log(`Notification sent: MOM_MENTIONED → ${userId}`);
        } catch (error) {
            this.logger.error(`Failed to send MOM mention notification: ${error.message}`);
        }
    }

    /**
     * Helper to send email
     */
    private async sendEmail(to: string, subject: string, message: string, projectId: string, taskId: string) {
        try {
            const host = this.configService.get('SMTP_HOST');
            const user = this.configService.get('SMTP_USER');
            const pass = this.configService.get('SMTP_PASS');
            const from = this.configService.get('SMTP_FROM') || 'no-reply@teslead.com';

            if (!host || !user || !pass) {
                this.logger.warn('SMTP credentials missing! Email not sent.');
                return;
            }

            const transporter = nodemailer.createTransport({
                host,
                port: parseInt(this.configService.get('SMTP_PORT') || '587'),
                secure: false,
                auth: { user, pass },
                tls: { rejectUnauthorized: false },
            });

            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            const taskUrl = `${frontendUrl}/projects/${projectId}/tasks/${taskId}`;

            await transporter.sendMail({
                from,
                to,
                subject,
                html: `
                    <div style="font-family: sans-serif; padding: 20px;">
                        <h2>Task Completed</h2>
                        <p>${message}</p>
                        <a href="${taskUrl}" style="background-color: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Task</a>
                    </div>
                `
            });
            this.logger.log(`Email sent to ${to}`);
        } catch (e) {
            this.logger.error(`Failed to send email to ${to}: ${e.message}`);
        }
    }
}

