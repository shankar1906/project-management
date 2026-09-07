import { Module } from '@nestjs/common';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';
import { PresenceGateway } from './presence.gateway';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtModule } from '@nestjs/jwt';
import { OrgSettingsModule } from '../org-settings/org-settings.module';

@Module({
  imports: [
    OrgSettingsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as any },
    }),
  ],
  controllers: [PresenceController],
  providers: [PresenceService, PresenceGateway, PrismaService],
  exports: [PresenceService],
})
export class PresenceModule { }
