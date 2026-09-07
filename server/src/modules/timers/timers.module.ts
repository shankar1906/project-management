import { Module } from '@nestjs/common';
import { TimersController } from './timers.controller';
import { TimersService } from './timers.service';
import { OrgSettingsModule } from '../org-settings/org-settings.module';

@Module({
  imports: [OrgSettingsModule],
  controllers: [TimersController],
  providers: [TimersService],
  exports: [TimersService],
})
export class TimersModule {}
