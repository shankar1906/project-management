import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationGateway } from '../modules/notifications/notification.gateway';
import { ConfigService } from '@nestjs/config';
import { ReminderType } from '@prisma/client';
import { REMINDER_CONFIG, REMINDER_MESSAGES } from './reminder.constants';

/**
 * Task Due Reminder Service
 * Handles reminder detection, creation, and notification delivery
 * 
 * ARCHITECTURE:
 * - Cron job calls detectAndEnqueueReminders()
 * - Detection logic creates TaskDueReminder records (idempotent)
 * - Worker calls processReminderNotification() to deliver
 * 
 * IDEMPOTENCY:
 * - Database unique constraint on [taskId, reminderType] prevents duplicates
 * - Safe to run multiple times, duplicate reminders won't be created
 */
@Injectable()
export class TaskDueReminderService {
    private readonly logger = new Logger(TaskDueReminderService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly notificationGateway: NotificationGateway,
        private readonly configService: ConfigService,
    ) { }

    /**
     * STEP 1: Detect and Enqueue Reminders (Called by Cron)
     * 
     * WHY: Separates detection from delivery for scalability
     * HOW: Detects tasks, creates reminder records, returns jobs to enqueue
     * 
     * @returns Array of reminder jobs to enqueue
     */
    async detectAndEnqueueReminders(): Promise<Array<{
        taskId: string;
        reminderType: ReminderType;
        assigneeUserId: string;
        projectId: string;
    }>> {
        const now = new Date();
        const jobs: Array<any> = [];

        // Detect all reminder types in parallel
        const [
            before3Days,
            before2Days,
            before24Hours,
            onDueDate,
            overdue,
        ] = await Promise.all([
            this.detectBefore3Days(now),
            this.detectBefore2Days(now),
            this.detectBefore24Hours(now),
            this.detectOnDueDate(now),
            this.detectOverdue(now),
        ]);

        jobs.push(...before3Days, ...before2Days, ...before24Hours, ...onDueDate, ...overdue);

        this.logger.log(`Detected ${jobs.length} reminder jobs to enqueue`);
        return jobs;
    }

    /**
     * REMINDER DETECTION: 3 Days Before
     * WHY: Uses calendar date logic (start/end of day) for consistency
     */
    private async detectBefore3Days(now: Date): Promise<any[]> {
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + REMINDER_CONFIG.REMINDER_DAYS.THREE_DAYS);

        const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
        const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

        return this.detectReminders(
            ReminderType.BEFORE_3_DAYS,
            startOfDay,
            endOfDay,
        );
    }

    /**
     * REMINDER DETECTION: 2 Days Before
     * WHY: Uses calendar date logic (start/end of day) for consistency
     */
    private async detectBefore2Days(now: Date): Promise<any[]> {
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + REMINDER_CONFIG.REMINDER_DAYS.TWO_DAYS);

        const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
        const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

        return this.detectReminders(
            ReminderType.BEFORE_2_DAYS,
            startOfDay,
            endOfDay,
        );
    }

    /**
     * REMINDER DETECTION: 24 Hours Before
     * WHY: Uses hour-based window with tolerance for precision
     */
    private async detectBefore24Hours(now: Date): Promise<any[]> {
        const minTime = new Date(now);
        minTime.setHours(minTime.getHours() + REMINDER_CONFIG.HOURS_BEFORE.MIN);

        const maxTime = new Date(now);
        maxTime.setHours(maxTime.getHours() + REMINDER_CONFIG.HOURS_BEFORE.MAX);

        return this.detectReminders(
            ReminderType.BEFORE_24_HOURS,
            minTime,
            maxTime,
        );
    }

    /**
     * REMINDER DETECTION: On Due Date
     * WHY: Checks if dueDate is today (same calendar day)
     */
    private async detectOnDueDate(now: Date): Promise<any[]> {
        const startOfToday = new Date(now.setHours(0, 0, 0, 0));
        const endOfToday = new Date(now.setHours(23, 59, 59, 999));

        return this.detectReminders(
            ReminderType.ON_DUE_DATE,
            startOfToday,
            endOfToday,
        );
    }

    /**
     * REMINDER DETECTION: Overdue
     * WHY: Sent only once when task is past due
     */
    private async detectOverdue(now: Date): Promise<any[]> {
        // Calculate start of today to ensure "Overdue" only picks up tasks
        // whose due date has completely passed (yesterday or earlier).
        // This prevents "Due Today" and "Overdue" from triggering on the same day.
        const startOfToday = new Date(now);
        startOfToday.setHours(0, 0, 0, 0);

        // Find tasks where dueDate < startOfToday and OVERDUE reminder not yet sent
        const tasks = await this.prisma.task.findMany({
            where: {
                dueDate: { lt: startOfToday },
                isDeleted: false,
                // Ensure OVERDUE reminder hasn't been created yet
                dueReminders: {
                    none: {
                        reminderType: ReminderType.OVERDUE,
                    },
                },
            },
            include: {
                assignees: {
                    include: { user: true },
                },
                project: {
                    select: { id: true, name: true },
                },
            },
        });

        return this.createReminderRecords(tasks, ReminderType.OVERDUE);
    }

    /**
     * CORE DETECTION LOGIC: Find tasks in date range without existing reminder
     * 
     * WHY: Shares logic across all reminder types
     * HOW: Queries tasks + creates reminder records in transaction
     * 
     * @param reminderType Type of reminder to detect
     * @param startDate Start of detection window
     * @param endDate End of detection window
     */
    private async detectReminders(
        reminderType: ReminderType,
        startDate: Date,
        endDate: Date,
    ): Promise<any[]> {
        const tasks = await this.prisma.task.findMany({
            where: {
                dueDate: {
                    gte: startDate,
                    lte: endDate,
                },
                isDeleted: false,
                // Check that this reminder type hasn't been sent yet
                dueReminders: {
                    none: {
                        reminderType,
                    },
                },
            },
            include: {
                assignees: {
                    include: { user: true },
                },
                project: {
                    select: { id: true, name: true },
                },
            },
        });

        return this.createReminderRecords(tasks, reminderType);
    }

    /**
     * Create TaskDueReminder records (Idempotent)
     * 
     * WHY: Database unique constraint prevents duplicates
     * HOW: Uses upsert for safe concurrent execution
     * 
     * @returns Array of jobs to enqueue
     */
    private async createReminderRecords(
        tasks: any[],
        reminderType: ReminderType,
    ): Promise<any[]> {
        const jobs: any[] = [];

        for (const task of tasks) {
            // Skip tasks with no assignees
            if (!task.assignees || task.assignees.length === 0) {
                this.logger.warn(`Task ${task.id} has no assignees, skipping reminder`);
                continue;
            }

            // Create reminder records for each assignee
            for (const assignee of task.assignees) {
                try {
                    // Use upsert to handle race conditions safely
                    await this.prisma.taskDueReminder.upsert({
                        where: {
                            taskId_reminderType: {
                                taskId: task.id,
                                reminderType,
                            },
                        },
                        create: {
                            taskId: task.id,
                            reminderType,
                            // sentAt is null (will be set when notification is delivered)
                        },
                        update: {
                            // If already exists, do nothing (idempotent)
                        },
                    });

                    // Enqueue job for this assignee
                    jobs.push({
                        taskId: task.id,
                        reminderType,
                        assigneeUserId: assignee.userId,
                        projectId: task.projectId,
                    });

                    this.logger.log(
                        `Created ${reminderType} reminder for task ${task.id}, assignee ${assignee.userId}`,
                    );
                } catch (error) {
                    // Unique constraint violation is expected (race condition)
                    // Log and continue - reminder already exists
                    if (error.code === 'P2002') {
                        this.logger.log(
                            `Reminder already exists for task ${task.id}, type ${reminderType}`,
                        );
                    } else {
                        this.logger.error(
                            `Failed to create reminder for task ${task.id}: ${error.message}`,
                        );
                    }
                }
            }
        }

        return jobs;
    }

    /**
     * STEP 2: Process Reminder Notification (Called by Queue Worker)
     * 
     * WHY: Separates notification delivery from detection
     * HOW: Sends email + WebSocket + updates sentAt timestamp
     * 
     * @param payload Job payload from queue
     */
    async processReminderNotification(payload: {
        taskId: string;
        reminderType: ReminderType;
        assigneeUserId: string;
        projectId: string;
    }): Promise<void> {
        const { taskId, reminderType, assigneeUserId, projectId } = payload;

        try {
            // Fetch full task details
            const task = await this.prisma.task.findUnique({
                where: { id: taskId },
                include: {
                    project: { select: { name: true } },
                    assignees: {
                        where: { userId: assigneeUserId },
                        include: { user: { select: { email: true, name: true } } },
                    },
                },
            });

            if (!task) {
                this.logger.error(`Task ${taskId} not found, skipping reminder`);
                return;
            }

            const assignee = task.assignees[0];
            if (!assignee) {
                this.logger.error(`Assignee ${assigneeUserId} not found for task ${taskId}`);
                return;
            }

            const message = REMINDER_MESSAGES[reminderType](task.title);

            // 1. Send Email Notification
            await this.sendReminderEmail(
                assignee.user.email as any,
                task.title,
                task.project.name,
                task.dueDate,
                reminderType,
                message,
                taskId,
                projectId,
            );

            // 2. Send WebSocket Notification
            this.notificationGateway.sendToUser(assigneeUserId, {
                id: `reminder-${taskId}-${reminderType}`,
                type: 'TASK_DUE_REMINDER',
                message,
                organizationId: null,
                createdAt: new Date(),
                metadata: {
                    taskId,
                    projectId,
                    reminderType,
                    dueDate: task.dueDate,
                },
            });

            // 3. TODO: Send Firebase Push Notification (Future)
            // await this.sendPushNotification(assigneeUserId, message, { taskId, projectId });

            // 4. Update sentAt timestamp
            await this.prisma.taskDueReminder.updateMany({
                where: {
                    taskId,
                    reminderType,
                },
                data: {
                    sentAt: new Date(),
                },
            });

            this.logger.log(
                `Delivered ${reminderType} reminder for task ${taskId} to user ${assigneeUserId}`,
            );
        } catch (error) {
            this.logger.error(
                `Failed to process reminder for task ${taskId}: ${error.message}`,
            );
            throw error; // Re-throw for queue retry
        }
    }

    /**
     * Send Reminder Email
     * 
     * WHY: Email delivery happens in worker, not cron
     * HOW: Uses existing email service infrastructure
     */
    private async sendReminderEmail(
        to: string,
        taskTitle: string,
        projectName: string,
        dueDate: Date | null,
        reminderType: ReminderType,
        message: string,
        taskId: string,
        projectId: string,
    ): Promise<void> {
        try {
            const transporter = this.getEmailTransporter();
            if (!transporter) {
                this.logger.warn('Email transporter not available, skipping email');
                return;
            }

            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            const taskUrl = `${frontendUrl}/projects/${projectId}/tasks/${taskId}`;

            const formattedDueDate = dueDate
                ? new Date(dueDate).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                })
                : 'No due date';

            await transporter.sendMail({
                from: REMINDER_CONFIG.EMAIL.FROM,
                to,
                subject: `${REMINDER_CONFIG.EMAIL.SUBJECT_PREFIX} ${taskTitle}`,
                html: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #111827;">${message}</h2>
            <p style="color: #4b5563;">
              <strong>Task:</strong> ${taskTitle}<br/>
              <strong>Project:</strong> ${projectName}<br/>
              <strong>Due Date:</strong> ${formattedDueDate}
            </p>
            <div style="margin: 30px 0;">
              <a href="${taskUrl}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">View Task</a>
            </div>
            <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">
              This is an automated reminder from your project management system.
            </p>
          </div>
        `,
            });

            this.logger.log(`Reminder email sent to ${to} for task ${taskId}`);
        } catch (error) {
            this.logger.error(`Failed to send reminder email: ${error.message}`);
            // Don't throw - email failure shouldn't block other notifications
        }
    }

    /**
     * Get Email Transporter (Reused from existing service pattern)
     */
    private getEmailTransporter() {
        const host = this.configService.get('SMTP_HOST');
        const user = this.configService.get('SMTP_USER');
        const pass = this.configService.get('SMTP_PASS');

        if (!host || !user || !pass) {
            if (process.env.NODE_ENV === 'production') {
                this.logger.warn('SMTP credentials missing! Emails will not be sent.');
            }
            return null;
        }

        const nodemailer = require('nodemailer');
        return nodemailer.createTransport({
            host,
            port: parseInt(this.configService.get('SMTP_PORT') || '587'),
            secure: false,
            auth: { user, pass },
            tls: {
                rejectUnauthorized: false,
            },
        });
    }

    /**
     * TODO: Firebase Push Notification (Future Implementation)
     * 
     * WHY: Placeholder for future mobile app support
     * HOW: Will use Firebase Cloud Messaging SDK
     */
    // private async sendPushNotification(
    //   userId: string,
    //   message: string,
    //   metadata: { taskId: string; projectId: string },
    // ): Promise<void> {
    //   // TODO: Implement Firebase push notification
    //   // const fcmToken = await this.getUserFcmToken(userId);
    //   // await firebaseAdmin.messaging().send({
    //   //   token: fcmToken,
    //   //   notification: { title: 'Task Reminder', body: message },
    //   //   data: metadata,
    //   // });
    //   this.logger.debug('Firebase push notification not yet implemented');
    // }
}
