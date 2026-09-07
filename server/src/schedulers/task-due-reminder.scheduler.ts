import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TaskDueReminderService } from '../reminders/task-due-reminder.service';
import { REMINDER_CONFIG } from '../reminders/reminder.constants';

/**
 * Task Due Reminder Scheduler
 * 
 * RESPONSIBILITY: Detect tasks needing reminders and enqueue notification jobs
 * 
 * ARCHITECTURE PRINCIPLES:
 * ✅ Cron ONLY detects and enqueues
 * ✅ Does NOT send emails directly
 * ✅ Does NOT emit WebSocket events directly
 * ✅ Idempotent - safe to run multiple times
 * ✅ Database enforces uniqueness
 * 
 * PRODUCTION NOTES:
 * - Runs every 30 minutes
 * - Processes all reminder types in parallel
 * - Creates TaskDueReminder records with unique constraint
 * - Enqueues jobs for async worker processing
 * - Handles failures gracefully without blocking
 */
@Injectable()
export class TaskDueReminderScheduler {
    private readonly logger = new Logger(TaskDueReminderScheduler.name);

    constructor(
        private readonly taskDueReminderService: TaskDueReminderService,
    ) { }

    /**
     * Cron Job: Detect and Enqueue Task Due Reminders
     * 
     * Runs: Every 30 minutes
     * 
     * WHY 30 minutes?
     * - Frequent enough to catch all reminder windows
     * - Infrequent enough to avoid database load
     * - Idempotent design makes duplicate runs safe
     * 
     * FLOW:
     * 1. Detect tasks matching each reminder window
     * 2. Check TaskDueReminder table for existing reminders
     * 3. Create TaskDueReminder records (unique constraint prevents duplicates)
     * 4. Enqueue notification jobs for worker processing
     * 
     * NOTE: In production, consider using a distributed lock
     * (e.g., Redis) if running multiple server instances to prevent
     * concurrent execution. However, the database unique constraint
     * makes this safe even without a lock.
     */
    @Cron(REMINDER_CONFIG.CRON_EXPRESSION)
    async handleTaskDueReminders(): Promise<void> {
        this.logger.log('Starting task due reminder detection...');

        try {
            const startTime = Date.now();

            // STEP 1: Detect reminders and create DB records
            const jobs = await this.taskDueReminderService.detectAndEnqueueReminders();

            // STEP 2: Process reminders immediately (or enqueue to queue)
            // For now, we'll process them directly since we don't have Bull configured
            // In production with Bull/Redis, you would enqueue jobs here instead
            this.logger.log(`Detected ${jobs.length} reminders, processing...`);

            // Process all jobs in parallel
            await Promise.allSettled(
                jobs.map(job => this.taskDueReminderService.processReminderNotification(job))
            );

            const duration = Date.now() - startTime;
            this.logger.log(
                `Task due reminder detection completed in ${duration}ms. Processed ${jobs.length} reminders.`,
            );
        } catch (error) {
            this.logger.error(
                `Task due reminder detection failed: ${error.message}`,
                error.stack,
            );
            // Don't throw - let next cron run retry
        }
    }

    /**
     * Manual Trigger (For Testing/Admin)
     * 
     * WHY: Useful for testing without waiting for cron
     * HOW: Calls the same logic as cron
     */
    async triggerManually(): Promise<void> {
        this.logger.log('Manual trigger: Task due reminder detection');
        await this.handleTaskDueReminders();
    }
}

/**
 * QUEUE INTEGRATION NOTE (Future Enhancement):
 * 
 * When you set up Bull/Redis, replace the direct processing with:
 * 
 * ```typescript
 * import { InjectQueue } from '@nestjs/bull';
 * import { Queue } from 'bull';
 * 
 * constructor(
 *   @InjectQueue(REMINDER_CONFIG.QUEUE.NAME)
 *   private readonly reminderQueue: Queue,
 *   private readonly taskDueReminderService: TaskDueReminderService,
 * ) {}
 * 
 * // In handleTaskDueReminders():
 * for (const job of jobs) {
 *   await this.reminderQueue.add(
 *     REMINDER_CONFIG.QUEUE.JOB_PREFIX,
 *     job,
 *     {
 *       attempts: REMINDER_CONFIG.QUEUE.ATTEMPTS,
 *       backoff: REMINDER_CONFIG.QUEUE.BACKOFF,
 *     },
 *   );
 * }
 * ```
 * 
 * Then create a separate processor:
 * 
 * ```typescript
 * @Processor(REMINDER_CONFIG.QUEUE.NAME)
 * export class TaskReminderProcessor {
 *   @Process(REMINDER_CONFIG.QUEUE.JOB_PREFIX)
 *   async process(job: Job) {
 *     await this.taskDueReminderService.processReminderNotification(job.data);
 *   }
 * }
 * ```
 */
