import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { OrgSettingsService } from '../org-settings/org-settings.service';
import { startOfDay, endOfDay, differenceInMinutes } from 'date-fns';
import { AttendanceSession, AttendanceBreak } from '@prisma/client';

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(
    private prisma: PrismaService,
    private orgSettingsService: OrgSettingsService,
  ) {}

  async getTeamMembers(orgId: string) {
    const settings = await this.orgSettingsService.getSettingsForEnforcement(orgId);

    const userSelect: Prisma.UserSelect = {
      id: true,
      name: true,
      email: true,
      phone: true,
      avatarUrl: true,
      accountStatus: true,
      lastLoginAt: true,
    };

    if (settings.enableUserPresence) {
      userSelect.presenceStatus = true;
    }

    // Fetch all active members in the org
    const members = await this.prisma.orgMember.findMany({
      where: {
        orgId,
        isActive: true,
        status: 'ACTIVE',
        userId: { not: null },
      },
      include: {
        user: {
          select: userSelect,
        },
      },
      orderBy: {
        joinedAt: 'asc'
      }
    });

    const now = new Date();
    const start = startOfDay(now);
    const end = endOfDay(now);

    let todaySessions: AttendanceSession[] = [];
    let todayBreaks: AttendanceBreak[] = [];

    if (settings.requireAttendance) {
      todaySessions = await this.prisma.attendanceSession.findMany({
        where: {
          orgId,
          checkIn: { gte: start, lte: end },
        },
      });

      if (todaySessions.length > 0) {
        const sessionIds = todaySessions.map(s => s.id);
        todayBreaks = await this.prisma.attendanceBreak.findMany({
          where: {
            sessionId: { in: sessionIds },
          },
        });
      }
    }

    // Fetch all active timers for the organization
    const activeTimers = await this.prisma.activeTimer.findMany({
      where: { orgId },
    });

    const activeTaskIds = activeTimers
      .map((t) => t.taskId)
      .filter((id): id is string => !!id);

    const tasks = await this.prisma.task.findMany({
      where: { id: { in: activeTaskIds } },
      select: {
        id: true,
        title: true,
        project: { select: { name: true } },
      },
    });

    // Fetch working/in-progress assigned task for each member in case no timer is running
    const memberUserIds = members.filter((m) => m.user).map((m) => m.user!.id);
    const assignedTasks = await this.prisma.taskAssignee.findMany({
      where: {
        userId: { in: memberUserIds },
        task: {
          isDeleted: false,
          status: {
            name: {
              notIn: ['Not Started', 'not started', 'NOT STARTED', 'Completed', 'Completed', 'Done', 'Closed'],
            },
          },
        },
      },
      orderBy: [
        { task: { updatedAt: 'desc' } },
        { assignedAt: 'desc' },
      ],
      select: {
        userId: true,
        task: {
          select: {
            id: true,
            title: true,
            project: { select: { name: true } },
            status: { select: { name: true, color: true } },
          },
        },
      },
    });

    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const timerMap = new Map(activeTimers.map((t) => [t.userId, t]));

    return members
      .filter((m) => m.user)
      .map(m => {
        let attendanceInfo: any = null;

        if (settings.requireAttendance) {
          // Find latest session for this user today
          const userSessions = todaySessions
            .filter(s => s.userId === m.user!.id)
            .sort((a, b) => b.checkIn.getTime() - a.checkIn.getTime());

          const session = userSessions.length > 0 ? userSessions[0] : null;

          if (session) {
            const sessionBreaks = todayBreaks.filter(b => b.sessionId === session.id);
            const activeBreak = sessionBreaks.find(b => !b.endTime);
            
            let totalBreakMinutes = 0;
            let lunchBreakDetails: any = null;
            let isLunchTaken = false;

            sessionBreaks.forEach(b => {
               const breakEnd = b.endTime || now;
               const mins = differenceInMinutes(breakEnd, b.startTime);
               totalBreakMinutes += mins;

               if (b.type === 'LUNCH') {
                  isLunchTaken = true;
                  lunchBreakDetails = b;
               }
            });

            const currentGrossMinutes = differenceInMinutes(session.checkOut || now, session.checkIn);
            const currentTotalMinutes = Math.max(0, currentGrossMinutes - totalBreakMinutes);

            attendanceInfo = {
               status: session.checkOut ? 'checked_out' : (activeBreak ? (activeBreak.type === 'LUNCH' ? 'lunch' : 'break') : 'checked_in'),
               session: {
                  id: session.id,
                  checkIn: session.checkIn,
                  checkOut: session.checkOut,
                  workMode: session.workMode,
                  totalMinutes: session.totalMinutes ?? currentTotalMinutes,
                  recordedTotalMinutes: session.totalMinutes,
               },
               activeBreak: activeBreak ? {
                  id: activeBreak.id,
                  type: activeBreak.type,
                  startTime: activeBreak.startTime
               } : null,
               breaks: sessionBreaks,
               lunchStatus: {
                  taken: isLunchTaken,
                  details: lunchBreakDetails
               }
            };
          } else {
               attendanceInfo = {
                   status: 'checked_out',
                   session: null,
                   activeBreak: null,
                   breaks: [],
                   lunchStatus: { taken: false, details: null }
               };
          }
        }

        const activeTimer = timerMap.get(m.user!.id);
        const activeTask = activeTimer?.taskId ? taskMap.get(activeTimer.taskId) : null;
        const userAssignedTasks = assignedTasks.filter((at) => at.userId === m.user!.id);
        const workingTask = userAssignedTasks.length > 0 ? userAssignedTasks[0].task : null;

        const timerInfo = activeTimer ? {
            id: activeTimer.id,
            startedAt: activeTimer.startedAt,
            taskTitle: activeTask?.title ?? null,
            projectName: activeTask?.project?.name ?? null,
        } : null;

        const currentTaskInfo = activeTimer && activeTask ? {
            taskTitle: activeTask.title,
            projectName: activeTask.project?.name || null,
            statusName: 'Working on it',
            statusColor: '#10b981',
            isTimerRunning: true,
        } : (workingTask ? {
            taskTitle: workingTask.title,
            projectName: workingTask.project?.name || null,
            statusName: workingTask.status?.name || 'Working on it',
            statusColor: workingTask.status?.color || '#10b981',
            isTimerRunning: false,
        } : null);

        return {
          memberId: m.id,
          role: m.role,
          joinedAt: m.joinedAt,
          user: {
            id: m.user!.id,
            name: m.user!.name,
            email: m.user!.email,
            phone: m.user!.phone,
            avatarUrl: m.user!.avatarUrl,
            accountStatus: m.user!.accountStatus,
            lastLoginAt: m.user!.lastLoginAt,
          },
          presence: settings.enableUserPresence ? (m.user as any).presenceStatus : null,
          attendance: attendanceInfo,
          activeTimer: timerInfo,
          currentTask: currentTaskInfo,
        };
      });
  }
}
