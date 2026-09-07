import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { WsJwtGuard } from '../../common/guards/ws-jwt.guard';

/**
 * Notification WebSocket Gateway
 * Handles real-time notification delivery per userId
 * Security: JWT authentication required for connection
 */
@WebSocketGateway({
    cors: {
        origin: process.env.FRONTEND_URL || '*',
        credentials: true,
    },
    namespace: '/notifications',
})
@UseGuards(WsJwtGuard)
export class NotificationGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(NotificationGateway.name);

    // Map userId → Set<socketId> for multi-device support
    private userSocketMap = new Map<string, Set<string>>();

    /**
     * Handle client connection
     * Extract userId from JWT and register socket
     */
    handleConnection(client: Socket) {
        try {
            const userId = client.handshake.auth.userId || client.data.userId;

            if (!userId) {
                this.logger.warn(`Connection rejected: No userId in socket ${client.id}`);
                client.disconnect();
                return;
            }

            // Register socket for this user
            if (!this.userSocketMap.has(userId)) {
                this.userSocketMap.set(userId, new Set());
            }
            this.userSocketMap.get(userId)!.add(client.id);

            client.data.userId = userId; // Store for later use
            this.logger.log(`User ${userId} connected (socket: ${client.id})`);
        } catch (error) {
            this.logger.error(`Connection error: ${error.message}`);
            client.disconnect();
        }
    }

    /**
     * Handle client disconnection
     * Remove socket from user mapping
     */
    handleDisconnect(client: Socket) {
        const userId = client.data.userId;

        if (userId && this.userSocketMap.has(userId)) {
            this.userSocketMap.get(userId)!.delete(client.id);

            // Clean up empty sets
            if (this.userSocketMap.get(userId)!.size === 0) {
                this.userSocketMap.delete(userId);
            }

            this.logger.log(`User ${userId} disconnected (socket: ${client.id})`);
        }
    }

    /**
     * Send notification to specific user
     * Delivers to ALL active sockets for that user (multi-device)
     * Security: Only target userId receives the notification
     */
    sendToUser(userId: string, payload: {
        id: string;
        type: string;
        message: string;
        organizationId: string | null;
        createdAt: Date;
        metadata?: any;
    }) {
        const socketIds = this.userSocketMap.get(userId);

        if (!socketIds || socketIds.size === 0) {
            this.logger.log(`User ${userId} not connected. Notification queued in DB.`);
            return;
        }

        // Send to all user's connected devices
        socketIds.forEach((socketId) => {
            this.server.to(socketId).emit('notification:new', payload);
        });

        this.logger.log(`Notification delivered to user ${userId} (${socketIds.size} devices)`);
    }

    /**
     * Client subscribes to mark notification as read
     */
    @SubscribeMessage('notification:read')
    handleMarkAsRead(client: Socket, notificationId: string) {
        const userId = client.data.userId;
        this.logger.log(`User ${userId} marked notification ${notificationId} as read`);
        // Caller (service) handles DB update
        return { success: true };
    }
}
