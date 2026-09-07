import { Controller, Post, Get, Body, Param, UseGuards, Logger, Query } from '@nestjs/common';
import { InvitesService } from './invites.service';
import { SendInviteDto, AcceptInviteDto, RejectInviteDto, ResendInviteDto, SearchUserDto } from './dto/invite.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserId } from '../../common/decorators/org.decorator';
import { NotificationService } from '../notifications/notification.service';
import { ConfigService } from '@nestjs/config';
import * as SibApiV3Sdk from 'sib-api-v3-sdk';

/**
 * Invites Controller
 * Handles organization member invitation lifecycle
 * All routes require authentication (JwtAuthGuard)
 */
@Controller('invites')
@UseGuards(JwtAuthGuard)
export class InvitesController {
    private readonly logger = new Logger(InvitesController.name);

    constructor(
        private readonly invitesService: InvitesService,
        private readonly notificationService: NotificationService,
        private readonly configService: ConfigService,
    ) { }

    /**
     * POST /invites/send/:orgId
     * Send invitation to user (organization-level with optional project assignment)
     * Only ADMIN/OWNER can send (enforced in service)
     */
    @Post('send/:orgId')
    async sendInvite(
        @UserId() userId: string,
        @Param('orgId') orgId: string,
        @Body() dto: SendInviteDto,
    ) {
        this.logger.log(`User ${userId} sending invite to ${dto.email} for org ${orgId}`);

        const result = await this.invitesService.sendInvite(userId, orgId, dto);

        // Handle different invitation scenarios
        if (result.inviteToken) {
            if (result.status === 'EXISTING_MEMBER_PROJECT_INVITE') {
                // Existing org member being invited to a project - send project-only email
                await this.sendProjectInviteEmail(
                    dto.email,
                    result.organizationName,
                    result.inviteToken,
                    result.projectName!,
                );
                this.logger.log(`Sent project-only invite to existing member ${dto.email} for project ${result.projectName}`);
            } else {
                // New user or first-time org invite - send full org invite email
                await this.sendInviteEmail(dto.email, result.organizationName, result.inviteToken, result.projectName);

                // Send real-time notification (if user exists)
                await this.notificationService.sendInviteNotification(
                    dto.email,
                    orgId,
                    result.organizationName,
                );
            }
        } else if (result.status === 'EXISTING_MEMBER') {
            this.logger.log(`User ${dto.email} is already a member. No action needed.`);
        } else if (result.status === 'EXISTING_PROJECT_MEMBER') {
            this.logger.log(`User ${dto.email} is already a member of project ${result.id}.`);
        }

        // Determine appropriate message based on status
        let message = 'Invitation sent successfully';
        if (result.status === 'EXISTING_MEMBER') {
            message = 'User already in our organization';
        } else if (result.status === 'EXISTING_MEMBER_PROJECT_INVITE') {
            message = `Project invitation sent to existing member`;
        } else if (result.status === 'EXISTING_PROJECT_MEMBER') {
            message = `User is already a member of this project with role: ${result.projectRole}`;
        }

        return {
            message,
            email: dto.email,
            orgRole: result.orgRole,
            id: result.id,
            projectRole: result.projectRole,
            projectName: result.projectName,
            expiresAt: result.expiresAt,
        };
    }

    /**
     * POST /invites/accept
     * Accept invitation (user must be authenticated)
     */
    @Post('accept')
    async acceptInvite(@UserId() userId: string, @Body() dto: AcceptInviteDto) {
        this.logger.log(`User ${userId} accepting invite with token ${dto.inviteToken.substring(0, 8)}...`);

        const result = await this.invitesService.acceptInvite(dto.inviteToken, userId);

        // Notify admin
        await this.notificationService.sendInviteAcceptedNotification(
            result.organization.id,
            userId,
        );

        return result;
    }

    /**
     * POST /invites/reject
     * Reject invitation
     */
    @Post('reject')
    async rejectInvite(@UserId() userId: string, @Body() dto: RejectInviteDto) {
        this.logger.log(`User ${userId} rejecting invite`);

        const result = await this.invitesService.rejectInvite(dto.inviteToken, userId);

        // Notify admin
        await this.notificationService.sendInviteRejectedNotification(
            dto.inviteToken,
            userId,
        );

        return result;
    }

    /**
     * POST /invites/resend/:orgId
     * Resend invitation (admin only)
     */
    @Post('resend/:orgId')
    async resendInvite(
        @UserId() userId: string,
        @Param('orgId') orgId: string,
        @Body() dto: ResendInviteDto,
    ) {
        this.logger.log(`User ${userId} resending invite to ${dto.email}`);

        const result = await this.invitesService.resendInvite(userId, orgId, dto.email);

        // Send email with invite link
        await this.sendInviteEmail(dto.email, result.organizationName, result.inviteToken);

        return {
            message: 'Invitation resent successfully',
            email: dto.email,
            expiresAt: result.expiresAt,
        };
    }

    /**
     * GET /invites/pending
     * Get current user's pending invitations
     */
    @Get('pending')
    async getPendingInvites(@UserId() userId: string) {
        return this.invitesService.getPendingInvites(userId);
    }

    /**
     * GET /invites/users
     * Search users for auto-suggestion (Project scope or Global scope)
     */
    @Get('users')
    async searchUsers(@UserId() userId: string, @Query() query: SearchUserDto) {
        return this.invitesService.searchUsers(userId, query);
    }


    // ═══════════════════════════════════════════════════════════════════════════
    // 📧 EMAIL HELPER (Private)
    // ═══════════════════════════════════════════════════════════════════════════

    private getBrevoTransactEmailApi() {
        const apiKeyVal = this.configService.get('BREVO_API_KEY') || process.env.BREVO_API_KEY;

        if (!apiKeyVal) {
            if (process.env.NODE_ENV === 'production') {
                this.logger.warn('BREVO_API_KEY missing! Emails will not be sent.');
            }
            return null;
        }

        const client = SibApiV3Sdk.ApiClient.instance;
        const apiKey = client.authentications['api-key'];
        apiKey.apiKey = apiKeyVal;

        return new SibApiV3Sdk.TransactionalEmailsApi();
    }

    private async sendInviteEmail(to: string, orgName: string, inviteToken: string, projectName?: string) {
        try {
            const apiInstance = this.getBrevoTransactEmailApi();
            if (apiInstance) {
                const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
                const acceptUrl = `${frontendUrl}/invites/accept?token=${inviteToken}`;
                const senderEmail = this.configService.get('SMTP_FROM') || 'no-reply@teslead.com';

                await apiInstance.sendTransacEmail({
                    sender: {
                        email: senderEmail,
                        name: "Teslead"
                    },
                    to: [{ email: to }],
                    subject: `You've been invited to join ${orgName}`,
                    htmlContent: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #111827;">Join ${orgName}</h2>
              <p style="color: #4b5563;">You have been invited to join the organization <strong>${orgName}</strong> on our platform.</p>
              ${projectName ? `<p style="color: #4b5563;">You have also been invited to join the project <strong>${projectName}</strong>.</p>` : ''}
              <div style="margin: 30px 0;">
                <a href="${acceptUrl}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Accept Invitation</a>
              </div>
              <p style="color: #6b7280; font-size: 14px;">Or copy and paste this link into your browser:</p>
              <p style="color: #6b7280; font-size: 14px; word-break: break-all;">${acceptUrl}</p>
              <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">This invitation expires in 48 hours.</p>
            </div>
          `
                });
                this.logger.log(`Invite email sent to ${to}`);
            } else {
                this.logger.warn('Brevo API key not available. Email not sent.');
            }
        } catch (error: any) {
            this.logger.error(`Failed to send invite email to ${to}: ${error.response ? JSON.stringify(error.response.text) : error.message}`);
            throw error;
        }
    }

    private async sendProjectInviteEmail(to: string, orgName: string, inviteToken: string, projectName: string) {
        try {
            const apiInstance = this.getBrevoTransactEmailApi();
            if (apiInstance) {
                const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
                const acceptUrl = `${frontendUrl}/invites/accept?token=${inviteToken}`;
                const senderEmail = this.configService.get('SMTP_FROM') || 'no-reply@teslead.com';

                await apiInstance.sendTransacEmail({
                    sender: {
                        email: senderEmail,
                        name: "Teslead"
                    },
                    to: [{ email: to }],
                    subject: `You've been invited to join project ${projectName}`,
                    htmlContent: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #111827;">New Project Invitation</h2>
              <p style="color: #4b5563;">You have been invited to join the project <strong>${projectName}</strong> in <strong>${orgName}</strong>.</p>
              <p style="color: #6b7280; font-size: 14px;">You're already a member of ${orgName}, so you just need to accept this project invitation.</p>
              <div style="margin: 30px 0;">
                <a href="${acceptUrl}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Accept Project Invitation</a>
              </div>
              <p style="color: #6b7280; font-size: 14px;">Or copy and paste this link into your browser:</p>
              <p style="color: #6b7280; font-size: 14px; word-break: break-all;">${acceptUrl}</p>
              <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">This invitation expires in 48 hours.</p>
            </div>
          `
                });
                this.logger.log(`Project invite email sent to ${to} for project ${projectName}`);
            } else {
                this.logger.warn('Brevo API key not available. Email not sent.');
            }
        } catch (error: any) {
            this.logger.error(`Failed to send project invite email to ${to}: ${error.response ? JSON.stringify(error.response.text) : error.message}`);
            throw error;
        }
    }
}
