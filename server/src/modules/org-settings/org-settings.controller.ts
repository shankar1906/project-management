import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgGuard } from '../../common/guards/org.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrgId } from '../../common/decorators/org.decorator';
import { OrgRole } from '@prisma/client';
import { OrgSettingsService } from './org-settings.service';
import { UpdateOrgSettingsDto } from './dto/update-org-settings.dto';

/**
 * Org Settings Controller
 * - Org context from x-org-id only (OrgGuard). No orgId in DTO/body/query.
 * - GET: any org member. PATCH: OWNER only.
 */
@Controller('org')
@UseGuards(JwtAuthGuard, OrgGuard)
export class OrgSettingsController {
  constructor(private readonly orgSettingsService: OrgSettingsService) {}

  @Get('settings')
  getSettings(@OrgId() orgId: string) {
    return this.orgSettingsService.getSettings(orgId);
  }

  @Patch('settings')
  @UseGuards(RolesGuard)
  @Roles(OrgRole.OWNER)
  updateSettings(
    @OrgId() orgId: string,
    @Body() dto: UpdateOrgSettingsDto,
  ) {
    return this.orgSettingsService.update(orgId, dto);
  }
}
