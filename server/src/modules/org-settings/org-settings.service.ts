import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateOrgSettingsDto } from './dto/update-org-settings.dto';

/**
 * Org Settings Service
 * - Org context from request.orgId only (x-org-id header via OrgGuard).
 * - Never read orgId from body/query. Never override request.orgId.
 * - Only OWNER can update (enforced in controller).
 */
@Injectable()
export class OrgSettingsService {
  private readonly logger = new Logger(OrgSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get settings for org. If missing (legacy org), create default row and return.
   */
  async getSettings(orgId: string) {
    let settings = await this.prisma.orgSettings.findUnique({
      where: { orgId },
    });
    if (!settings) {
      this.logger.log(`Creating default OrgSettings for org ${orgId}`);
      settings = await this.prisma.orgSettings.create({
        data: { orgId },
      });
    }
    return settings;
  }

  /**
   * Update settings. Only OWNER can call (controller guard).
   * Uses orgId from param only, never from body.
   */
  async update(orgId: string, dto: UpdateOrgSettingsDto) {
    const data: Record<string, boolean> = {};
    if (dto.requireAttendance !== undefined) data.requireAttendance = dto.requireAttendance;
    if (dto.requireCheckInForTimer !== undefined) data.requireCheckInForTimer = dto.requireCheckInForTimer;
    if (dto.allowManualTimeEntry !== undefined) data.allowManualTimeEntry = dto.allowManualTimeEntry;
    if (dto.allowMultipleTimers !== undefined) data.allowMultipleTimers = dto.allowMultipleTimers;
    if (dto.requireTimesheetApproval !== undefined) data.requireTimesheetApproval = dto.requireTimesheetApproval;
    if (dto.enableUserPresence !== undefined) data.enableUserPresence = dto.enableUserPresence;
    if (dto.enforceProjectRoleStrict !== undefined) data.enforceProjectRoleStrict = dto.enforceProjectRoleStrict;
    if (dto.lockTimesheetAfterApproval !== undefined) data.lockTimesheetAfterApproval = dto.lockTimesheetAfterApproval;
    if (dto.autoSubmitTimesheet !== undefined) data.autoSubmitTimesheet = dto.autoSubmitTimesheet;

    const updated = await this.prisma.orgSettings.upsert({
      where: { orgId },
      create: { orgId, ...data },
      update: data,
    });
    this.logger.log(`Updated org settings for org ${orgId}`);
    return updated;
  }

  /**
   * Get settings for runtime enforcement (used by other modules).
   * Returns defaults if no row exists (caller can create via getSettings if needed).
   */
  async getSettingsForEnforcement(orgId: string) {
    const settings = await this.prisma.orgSettings.findUnique({
      where: { orgId },
    });
    if (settings) return settings;
    return {
      requireAttendance: false,
      requireCheckInForTimer: false,
      allowManualTimeEntry: true,
      allowMultipleTimers: false,
      requireTimesheetApproval: true,
      enableUserPresence: true,
      enforceProjectRoleStrict: true,
      lockTimesheetAfterApproval: true,
      autoSubmitTimesheet: false,
    } as const;
  }
}
