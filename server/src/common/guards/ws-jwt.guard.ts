import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';

/**
 * WebSocket JWT Guard
 * Validates JWT token for WebSocket connections
 * Security: Rejects unauthenticated connections
 * 
 * Token can be passed via:
 * - socket.handshake.auth.token
 * - socket.handshake.headers.authorization
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
    private readonly logger = new Logger(WsJwtGuard.name);

    constructor(private jwtService: JwtService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        try {
            const client: Socket = context.switchToWs().getClient();

            // Extract token from auth or headers
            const token =
                client.handshake.auth.token ||
                client.handshake.headers.authorization?.replace('Bearer ', '');

            if (!token) {
                this.logger.warn('WebSocket connection rejected: No token provided');
                return false;
            }

            // Verify JWT
            const payload = this.jwtService.verify(token, {
                secret: process.env.JWT_SECRET,
            });

            // Attach userId to socket for later use
            client.data.userId = payload.userId;

            return true;
        } catch (error) {
            this.logger.error(`WebSocket auth failed: ${error.message}`);
            return false;
        }
    }
}
