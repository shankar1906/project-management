import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { PhasesModule } from './modules/phases/phases.module';
import { TaskListsModule } from './modules/tasklists/tasklists.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { InvitesModule } from './modules/invites/invites.module';
import { NotificationModule } from './modules/notifications/notification.module';
import { StatsModule } from './modules/stats/stats.module';
import { RemindersModule } from './reminders/reminders.module';
import { SchedulersModule } from './schedulers/schedulers.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { appConfig } from './config/app.config';
import { auth0Config } from './config/auth0.config';
import { databaseConfig } from './config/database.config';
import { PresenceModule } from './modules/presence/presence.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { TimersModule } from './modules/timers/timers.module';
import { TimeEntriesModule } from './modules/time-entries/time-entries.module';
import { TimesheetsModule } from './modules/timesheets/timesheets.module';
import { TeamsModule } from './modules/teams/teams.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, auth0Config, databaseConfig],
      envFilePath: '.env',
    }),

    // Structured logging with Pino
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL || 'info',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        customProps: () => ({
          context: 'HTTP',
        }),
        autoLogging: true,
        customLogLevel: (req, res, err) => {
          if (res.statusCode >= 500 || err) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
      },
    }),

    // Core modules
    PrismaModule,
    AuthModule,
    OrganizationsModule,
    ProjectsModule,
    TasksModule,
    PhasesModule,
    TaskListsModule,
    WorkflowModule,
    InvitesModule,
    NotificationModule,
    StatsModule,
    RemindersModule,
    SchedulersModule,
    MeetingsModule,
    AnalyticsModule,
    PresenceModule,
    AttendanceModule,
    TimersModule,
    TimeEntriesModule,
    TimesheetsModule,
    TeamsModule,
  ],
})
export class AppModule { }
