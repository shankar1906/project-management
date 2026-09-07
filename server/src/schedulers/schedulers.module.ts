import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TaskDueReminderScheduler } from './task-due-reminder.scheduler';
import { RemindersModule } from '../reminders/reminders.module';

/**
 * Schedulers Module
 * Provides cron job schedulers
 */
@Module({
    imports: [
        ScheduleModule.forRoot(), // Enable cron jobs
        RemindersModule,
    ],
    providers: [TaskDueReminderScheduler],
    exports: [TaskDueReminderScheduler],
})
export class SchedulersModule { }
