import { Module } from '@nestjs/common';
import { InvitesService } from './invites.service';
import { InvitesController } from './invites.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationModule } from '../notifications/notification.module';

/**
 * Invites Module
 * Handles organization member invitation lifecycle
 */
@Module({
    imports: [PrismaModule, NotificationModule],
    providers: [InvitesService],
    controllers: [InvitesController],
    exports: [InvitesService],
})
export class InvitesModule { }
