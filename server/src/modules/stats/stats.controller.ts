import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { StatsService } from './stats.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
// If JwtAuthGuard location is different, I might need to correct it. 
// I'll assume standard path or check later.
import { DashboardStatsDto } from './dto/stats.dto';

// I need to verify the guard path. 
// Based on typical structures, it's likely modules/auth/guards or just auth/guards.
// I'll check the auth module structure in a moment if this fails/guesses wrong.
// For now, I'll use a likely path.

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
    constructor(private readonly statsService: StatsService) { }

    @Get()
    async getStats(@Request() req): Promise<DashboardStatsDto> {
        return this.statsService.getUserStats(req.user.userId);
    }
}
