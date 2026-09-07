import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { UserPresenceStatus } from '@prisma/client';
import { WsJwtGuard } from '../../common/guards/ws-jwt.guard';
import { OrgSettingsService } from '../org-settings/org-settings.service';

@WebSocketGateway({
    cors: {
        origin: process.env.FRONTEND_URL || '*',
        credentials: true,
    },
    namespace: '/presence',
})
@UseGuards(WsJwtGuard)
export class PresenceGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(PresenceGateway.name);

    constructor(private readonly orgSettings: OrgSettingsService) {}

    // Track connected clients: userId -> Set<socketId>
    private userSocketMap = new Map<string, Set<string>>();

    async handleConnection(client: Socket) {
        try {
            const userId = client.handshake.auth?.userId || client.data?.userId;
            const rawOrgId = client.handshake.auth?.orgId ?? client.handshake.query?.orgId;
            const orgId = typeof rawOrgId === 'string' ? rawOrgId : Array.isArray(rawOrgId) ? rawOrgId[0] : undefined;

            if (!userId) {
                this.logger.warn(`Connection rejected: No userId in socket ${client.id}`);
                client.disconnect();
                return;
            }
            if (!orgId) {
                this.logger.warn(`Connection rejected: orgId required for presence (socket ${client.id})`);
                client.disconnect();
                return;
            }

            const settings = await this.orgSettings.getSettingsForEnforcement(orgId);
            if (!settings.enableUserPresence) {
                this.logger.log(`Presence disabled for org ${orgId}, disconnecting ${client.id}`);
                client.disconnect();
                return;
            }

            const room = `org:${orgId}`;
            await client.join(room);
            client.data.userId = userId;
            client.data.orgId = orgId;

            if (!this.userSocketMap.has(userId)) {
                this.userSocketMap.set(userId, new Set());
            }
            this.userSocketMap.get(userId)!.add(client.id);

            this.logger.log(`User ${userId} joined presence room ${room} (socket: ${client.id})`);
        } catch (error) {
            this.logger.error(`Connection error: ${error.message}`);
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        const userId = client.data?.userId;
        const orgId = client.data?.orgId;
        if (orgId) {
            client.leave(`org:${orgId}`);
        }
        if (userId && this.userSocketMap.has(userId)) {
            this.userSocketMap.get(userId)!.delete(client.id);
            if (this.userSocketMap.get(userId)!.size === 0) {
                this.userSocketMap.delete(userId);
            }
            this.logger.log(`User ${userId} disconnected from presence (socket: ${client.id})`);
        }
    }

    /**
     * Broadcast presence status update only to the given org room. Never cross-org.
     */
    broadcastPresenceUpdate(orgId: string, userId: string, status: UserPresenceStatus, message?: string | null) {
        this.server.to(`org:${orgId}`).emit('presence_updated', {
            userId,
            status,
            message,
            updatedAt: new Date().toISOString(),
        });
    }
}
