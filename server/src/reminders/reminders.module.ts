import { Module } from '@nestjs/common';
import { TaskDueReminderService } from './task-due-reminder.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../modules/notifications/notification.module';
import { ConfigModule } from '@nestjs/config';

/**
 * Reminders Module
 * Provides task due reminder services
 */
@Module({
    imports: [
        PrismaModule,
        NotificationModule,
        ConfigModule,
    ],
    providers: [TaskDueReminderService],
    exports: [TaskDueReminderService],
})
export class RemindersModule { }
