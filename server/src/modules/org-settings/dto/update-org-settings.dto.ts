import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Update org settings DTO.
 * - No orgId in DTO; org context comes only from x-org-id (OrgGuard).
 * - Only OWNER can PATCH. Settings only restrict behavior, never weaken security.
 */
export class UpdateOrgSettingsDto {
  @IsOptional()
  @IsBoolean()
  requireAttendance?: boolean;

  @IsOptional()
  @IsBoolean()
  requireCheckInForTimer?: boolean;

  @IsOptional()
  @IsBoolean()
  allowManualTimeEntry?: boolean;

  @IsOptional()
  @IsBoolean()
  allowMultipleTimers?: boolean;

  @IsOptional()
  @IsBoolean()
  requireTimesheetApproval?: boolean;

  @IsOptional()
  @IsBoolean()
  enableUserPresence?: boolean;

  @IsOptional()
  @IsBoolean()
  enforceProjectRoleStrict?: boolean;

  @IsOptional()
  @IsBoolean()
  lockTimesheetAfterApproval?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSubmitTimesheet?: boolean;
}
