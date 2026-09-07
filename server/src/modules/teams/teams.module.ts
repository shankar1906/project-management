import { Module } from '@nestjs/common';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { OrgSettingsModule } from '../org-settings/org-settings.module';

@Module({
  imports: [PrismaModule, OrgSettingsModule],
  controllers: [TeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
