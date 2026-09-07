import { Controller, Patch, Body, UseGuards, Request, Get } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgGuard } from '../../common/guards/org.guard';
import { UpdatePresenceDto } from './dto/update-presence.dto';

@Controller('presence')
@UseGuards(JwtAuthGuard, OrgGuard)
export class PresenceController {
    constructor(private readonly presenceService: PresenceService) { }

    @Patch('status')
    async updateStatus(
        @Request() req,
        @Body() updatePresenceDto: UpdatePresenceDto,
    ) {
        const userId = req.user.userId;
        const orgId = req.orgId;
        return this.presenceService.updateStatus(orgId, userId, updatePresenceDto);
    }

    @Get('status')
    async getStatus(@Request() req) {
        const userId = req.user.userId;
        return this.presenceService.getStatus(userId);
    }
}

