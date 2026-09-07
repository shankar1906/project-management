import { Controller, Get, UseGuards, Logger } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgGuard } from '../../common/guards/org.guard';
import { OrgId } from '../../common/decorators/org.decorator';

@Controller('teams')
@UseGuards(JwtAuthGuard, OrgGuard)
export class TeamsController {
  private readonly logger = new Logger(TeamsController.name);

  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  async getTeamMembers(@OrgId() orgId: string) {
    this.logger.log(`Fetching team members for org: ${orgId}`);
    return this.teamsService.getTeamMembers(orgId);
  }
}
