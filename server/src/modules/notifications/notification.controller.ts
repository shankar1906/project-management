import { Controller, Get, Put, Param, UseGuards, Query } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserId } from '../../common/decorators/org.decorator';

/**
 * Notifications Controller
 * HTTP endpoints for notification management
 * Real-time delivery handled by NotificationGateway
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
    constructor(private readonly notificationService: NotificationService) { }

    /**
     * GET /notifications
     * Get user's notifications with pagination and filtering
     */
    @Get()
    async getNotifications(
        @UserId() userId: string,
        @Query('page') page: number = 1,
        @Query('limit') limit: number = 20,
        @Query('status') status?: 'read' | 'unread' | 'all',
    ) {
        return this.notificationService.getAllNotifications(userId, Number(page), Number(limit), status);
    }

    /**
     * PUT /notifications/:id/read
     * Mark notification as read
     */
    @Put(':id/read')
    async markAsRead(@UserId() userId: string, @Param('id') notificationId: string) {
        return this.notificationService.markAsRead(notificationId, userId);
    }
}
