import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service'; // Adjust path if needed, usually global or from a module
import { PresenceGateway } from './presence.gateway';
import { UpdatePresenceDto } from './dto/update-presence.dto';

@Injectable()
export class PresenceService {
    private readonly logger = new Logger(PresenceService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly presenceGateway: PresenceGateway,
    ) { }

    async updateStatus(orgId: string, userId: string, updatePresenceDto: UpdatePresenceDto) {
        const { status, message } = updatePresenceDto;

        const updatedPresence = await this.prisma.presenceStatus.upsert({
            where: { userId },
            update: {
                status,
                message,
            },
            create: {
                userId,
                status,
                message,
            },
        });

        this.presenceGateway.broadcastPresenceUpdate(orgId, userId, status, message);

        return updatedPresence;
    }

    async getStatus(userId: string) {
        return this.prisma.presenceStatus.findUnique({
            where: { userId },
        });
    }
}
