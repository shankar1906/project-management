/**
 * Task Due Reminder Constants
 * Centralized configuration for reminder system
 */

export const REMINDER_CONFIG = {
    // Cron expression: Every 1 minute (Testing)
    CRON_EXPRESSION: '0 6,18 * * *',

    // Reminder windows in days
    REMINDER_DAYS: {
        THREE_DAYS: 3,
        TWO_DAYS: 2,
    },

    // Reminder window for 24-hour reminder (tolerance window)
    HOURS_BEFORE: {
        MIN: 23, // Start checking at 23 hours before
        MAX: 25, // Stop checking at 25 hours before (1-hour tolerance)
    },

    // Queue configuration
    QUEUE: {
        NAME: 'task-reminders',
        JOB_PREFIX: 'task-reminder',
        ATTEMPTS: 3, // Retry failed jobs up to 3 times
        BACKOFF: {
            TYPE: 'exponential' as const,
            DELAY: 5000, // Start with 5 seconds
        },
    },

    // Email configuration
    EMAIL: {
        FROM: process.env.SMTP_FROM || 'no-reply@teslead.com',
        SUBJECT_PREFIX: 'Task Reminder:',
    },
} as const;

/**
 * Reminder Type to Human-Readable Message Mapping
 */
export const REMINDER_MESSAGES = {
    BEFORE_3_DAYS: (taskTitle: string) => `Task "${taskTitle}" is due in 3 days`,
    BEFORE_2_DAYS: (taskTitle: string) => `Task "${taskTitle}" is due in 2 days`,
    BEFORE_24_HOURS: (taskTitle: string) => `Task "${taskTitle}" is due in 24 hours`,
    ON_DUE_DATE: (taskTitle: string) => `Task "${taskTitle}" is due today`,
    OVERDUE: (taskTitle: string) => `Task "${taskTitle}" is overdue`,
} as const;
