import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * JWT Strategy
 * - Validates JWT tokens issued by our backend (NOT Auth0)
 * - JWT represents USER IDENTITY only (userId, email)
 * - Organization context comes ONLY from x-org-id header (OrgGuard)
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('database.jwtSecret') || 'default-secret',
    });
  }

  /**
   * Validates JWT payload.
   * Payload structure: { userId, email?, tokenVersion?, iat, exp }
   */
  async validate(payload: any) {
    if (!payload.userId) {
      this.logger.warn('Invalid JWT payload: missing userId');
      throw new UnauthorizedException('Invalid token payload');
    }

    // 🔒 SECURITY: Verify if session was invalidated (e.g., password changed)
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, sessionsInvalidatedAt: true },
    });

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    if (user.sessionsInvalidatedAt && payload.iat) {
      const issuedAtMs = payload.iat * 1000;
      if (issuedAtMs < user.sessionsInvalidatedAt.getTime()) {
        this.logger.warn(`Stale token for user ${user.id} - session invalidated`);
        throw new UnauthorizedException('Session expired due to password change. Please login again.');
      }
    }

    return {
      userId: user.id,
      email: user.email,
    };
  }
}
