import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as jwt from 'jsonwebtoken';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountStatus, AuditAction, OtpType, MemberStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { JwksClient } from 'jwks-rsa';
import { Twilio } from 'twilio';
import { formatDistanceToNow } from 'date-fns';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly auth0Domain: string;
  private readonly auth0Audience: string;
  private readonly jwksClient: JwksClient;

  // 🔒 SECURITY CONSTANTS
  private readonly ACCESS_TOKEN_EXPIRY = '15m';      // Short-lived
  private readonly REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly ACCOUNT_LOCK_DURATION = 15 * 60 * 1000; // 15 minutes
  private readonly OTP_VALIDITY = 15 * 60 * 1000;  // 15 minutes
  private readonly OTP_MAX_ATTEMPTS = 5;
  private readonly OTP_COOLDOWN = 60 * 1000;        // 1 minute between OTP requests
  private readonly MAX_OTP_PER_HOUR = 5;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    this.auth0Domain = this.configService.get<string>('auth0.domain') || '';
    this.auth0Audience = this.configService.get<string>('auth0.audience') || '';

    // 🔒 SECURITY: Initialize JWKS client for Auth0 token verification
    this.jwksClient = new JwksClient({
      jwksUri: `https://${this.auth0Domain}/.well-known/jwks.json`,
      cache: true,
      cacheMaxAge: 600000, // 10 minutes
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 👤 USER PROFILE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 👤 Get User Profile (Me) — identity only, no runtime state.
   * Must NOT include: attendanceStatus, presenceStatus, isCheckedIn, session, activeTimer, or any org-scoped operational state.
   * Runtime state (attendance, presence, timer) is org-scoped and must be fetched via dedicated endpoints with request.orgId.
   */
  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        orgMemberships: {
          include: { org: true },
          orderBy: { joinedAt: 'asc' }, // Sort by joined date to find the first one (Personal)
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Determine current/default org (first one for now)
    const currentOrg = user.orgMemberships[0]?.org;

    // Determine Personal Org: The first organization the user joined as OWNER
    // This is created during signup
    const personalMembership = user.orgMemberships.find(m => m.role === 'OWNER');
    const personalOrgId = personalMembership?.orgId;

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        avatarUrl: user.avatarUrl,
        accountStatus: user.accountStatus,
        lastLoginAt: user.lastLoginAt,
        currentOrgId: currentOrg?.id,
        memberships: user.orgMemberships?.map((m) => {
          let lastLoginTime: string | null = null;
          const displayDate = m.lastAccessedAt || user.lastLoginAt;
          if (displayDate) {
            lastLoginTime = formatDistanceToNow(new Date(displayDate), { addSuffix: true });
          }

          return {
            orgId: m.orgId,
            orgName: m.org.name,
            slug: m.org.slug,
            role: m.role,
            status: m.status,
            isPersonal: m.orgId === personalOrgId,
            lastLoginTime, // Humanized time like "1hr ago"
          };
        }) || [],
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔒 AUTH0 LOGIN - PROPERLY VALIDATED
  // ═══════════════════════════════════════════════════════════════════════════

  async validateAuth0Token(auth0Token: string, ipAddress?: string, userAgent?: string) {
    try {
      // 🔒 STEP 1: Decode header to get key ID
      const tokenParts = auth0Token.split('.');
      // console.log("dataaaaaaaaaaaaa", auth0Token, ipAddress, userAgent)
      if (tokenParts.length !== 3) {
        throw new UnauthorizedException('Invalid token format');
      }

      const header = JSON.parse(Buffer.from(tokenParts[0], 'base64').toString());
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());

      // 🔒 STEP 2: Get signing key from JWKS
      const key = await this.jwksClient.getSigningKey(header.kid);
      const signingKey = key.getPublicKey();

      // Debug log to check the key (remove in production)
      // this.logger.debug(`Signing Key retrieved: ${signingKey ? 'YES' : 'NO'}`);

      // 🔒 STEP 3: Verify JWT signature, issuer, audience, expiration
      // We use direct jwt.verify (from jsonwebtoken) to avoid conflicts with global JwtService config (which uses HS256)
      const verifiedPayload = jwt.verify(auth0Token, signingKey, {
        algorithms: ['RS256'],
        issuer: `https://${this.auth0Domain}/`,
        audience: this.auth0Audience,
      }) as any;
      // console.log("verifiedPayload", verifiedPayload);

      // 🔍 STEP 3.5: If email is missing (common in Access Tokens), fetch it from /userinfo
      let userProfile = verifiedPayload;
      if (!userProfile.email) {
        try {
          this.logger.log('Fetching full profile from Auth0 /userinfo...');
          const { data } = await axios.get(`https://${this.auth0Domain}/userinfo`, {
            headers: { Authorization: `Bearer ${auth0Token}` },
          });
          userProfile = { ...verifiedPayload, ...data }; // Merge token data with profile data
          this.logger.log(`Fetched profile for: ${userProfile.email}`);
        } catch (userInfoError) {
          this.logger.error(`Failed to fetch /userinfo: ${userInfoError.message}`);
          throw new UnauthorizedException('Could not retrieve user email from Auth0');
        }
      }

      console.log("userProfile", userProfile);

      // 🔒 STEP 4: Check if Auth0 email is verified (configurable policy)
      const requireEmailVerified = this.configService.get<boolean>('auth0.requireEmailVerified', false);
      // userinfo often uses 'email_verified' (boolean)
      if (requireEmailVerified && !userProfile.email_verified) {
        throw new UnauthorizedException('Email not verified in Auth0');
      }

      // 🔒 STEP 5: Find or create user
      const user = await this.findOrCreateAuth0User(userProfile);

      // 🔒 STEP 6: Check account status
      await this.enforceAccountStatus(user.id);

      // 🔒 STEP 7: Get organization
      const membership = await this.getUserDefaultOrg(user.id);

      // 🔒 STEP 8: Generate secure tokens
      const { accessToken, refreshToken } = await this.generateTokenPair(user.id, membership.orgId, ipAddress, userAgent);

      // 🔒 STEP 9: Audit log
      await this.createAuditLog(user.id, AuditAction.LOGIN, true, ipAddress, userAgent);

      // 🔒 STEP 10: Update last login
      // 🔒 STEP 10: Update last login & Org last access
      await Promise.all([
        this.prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        }),
        this.updateOrgLastAccessed(user.id, membership.orgId),
      ]);

      return {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          accountStatus: user.accountStatus,
        },
        organization: {
          orgId: membership.orgId,
          role: membership.role,
        },
      };
    } catch (error) {
      this.logger.error(`Auth0 token validation failed: ${error.message}`);
      console.log("Error from new log", error);
      // Log helpful details for specific errors
      if (error.message.includes('audience')) {
        this.logger.error(`⚠️ Audience Mismatch! Expected: ${this.auth0Audience} | Received Error: ${error.message}`);
      }

      await this.createAuditLog(null, AuditAction.LOGIN, false, ipAddress, userAgent, { error: error.message });
      throw new UnauthorizedException('Invalid Auth0 token');
    }
  }

  private async findOrCreateAuth0User(verifiedPayload: any) {
    const auth0Id = verifiedPayload.sub;
    const email = verifiedPayload.email;
    // Fallback: Name -> Nickname -> Email Prefix -> "User"
    const name = verifiedPayload.name || verifiedPayload.nickname || email.split('@')[0] || 'User';


    let user = await this.prisma.user.findUnique({
      where: { auth0Id },
    });

    // 🔍 ACCOUNT LINKING: If not found by Auth0 ID, check by Email
    if (!user) {
      user = await this.prisma.user.findUnique({
        where: { email },
      });

      if (user) {
        this.logger.log(`Linking existing user ${user.id} to Auth0 ID ${auth0Id}`);
        // Link accounts
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            auth0Id,
            emailVerified: true, // Social login implies verification
            avatarUrl: verifiedPayload.picture || user.avatarUrl,
          },
        });
      }
    }

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          auth0Id,
          email,
          name,
          emailVerified: verifiedPayload.email_verified || false,
          accountStatus: AccountStatus.ACTIVE,
          hasRecoveryMethod: true,
          // Create a default Personal Organization
          orgMemberships: {
            create: {
              role: 'OWNER',
              // isDefault field does not exist in schema, first created is default by joinedAt
              status: MemberStatus.ACTIVE,
              org: {
                create: {
                  name: `${name}'s Workspace`,
                  slug: this.generateSlug(name),
                },
              },
            },
          },
        },
      });

      this.logger.log(`Created new user via Auth0: ${user.id} (${email})`);
    } else {
      // Update user info
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          email,
          name,
          emailVerified: verifiedPayload.email_verified || false,
        },
        include: { orgMemberships: true }, // Include memberships to check
      });

      // 🔍 SELF-HEALING: If existing user has NO organization, create one now.
      const userWithOrgs = user as any;
      if (!userWithOrgs.orgMemberships || userWithOrgs.orgMemberships.length === 0) {
        this.logger.warn(`User ${user.id} existed but had no organization. Creating default now.`);

        await this.prisma.organization.create({
          data: {
            name: `${name}'s Workspace`,
            slug: this.generateSlug(name),
            members: {
              create: {
                userId: user.id,
                role: 'OWNER',
                status: MemberStatus.ACTIVE,
              },
            },
          },
        });
      }
    }

    return user;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔒 EMAIL/PASSWORD SIGNUP
  // ═══════════════════════════════════════════════════════════════════════════

  async signupWithEmail(email: string, password: string, name?: string, orgName?: string, ipAddress?: string, userAgent?: string) {
    // 🔒 Check for existing user
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      if (!existingUser.passwordHash) {
        throw new ConflictException('This email is registered via Social Login (Google/etc). Please login with that method.');
      }
      throw new ConflictException('Email already registered. Please login.');
    }

    // 🔒 Hash password with Argon2id (stronger than bcrypt)
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,  // 64 MB
      timeCost: 3,
      parallelism: 4,
    });

    // 🔒 Create user with UNVERIFIED status
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        emailVerified: false,
        accountStatus: AccountStatus.UNVERIFIED,  // 🔒 Requires verification
        hasRecoveryMethod: false,  // Will be true after email verification
        passwordChangedAt: new Date(),
      },
    });

    this.logger.log(`New user signed up with email: ${user.id} (${email})`);

    // Create organization
    const orgId = await this.createOrAssignOrganization(user.id, orgName || `${name || 'User'}'s Workspace`);

    // 🔒 Send verification OTP
    await this.sendEmailVerificationOtp(user.id, email);

    // 🔒 Generate LIMITED tokens (unverified user can only verify email)
    const { accessToken, refreshToken } = await this.generateTokenPair(user.id, orgId, ipAddress, userAgent);
    await this.updateOrgLastAccessed(user.id, orgId);

    await this.createAuditLog(user.id, AuditAction.SIGNUP, true, ipAddress, userAgent);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        accountStatus: user.accountStatus,
        emailVerified: false,
      },
      message: 'Signup successful. Please verify your email to access all features.',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔒 USERNAME/PASSWORD SIGNUP
  // ═══════════════════════════════════════════════════════════════════════════

  async signupWithUsername(
    username: string,
    password: string,
    email?: string,
    name?: string,
    orgName?: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    // 🔒 SECURITY: Prevent username that looks like email or phone
    if (this.looksLikeEmail(username) || this.looksLikePhone(username)) {
      throw new BadRequestException('Username cannot look like an email or phone number');
    }

    // Check if username exists
    const existingUser = await this.prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      throw new ConflictException('Username already taken');
    }

    // Check email if provided
    if (email) {
      const existingEmail = await this.prisma.user.findUnique({
        where: { email },
      });

      if (existingEmail) {
        throw new ConflictException('Email already registered');
      }
    }

    // Hash password
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    // Create user
    const user = await this.prisma.user.create({
      data: {
        username,
        passwordHash,
        email,
        name: name || username,
        emailVerified: false,
        accountStatus: email ? AccountStatus.UNVERIFIED : AccountStatus.ACTIVE,
        hasRecoveryMethod: !!email,
        passwordChangedAt: new Date(),
      },
    });

    this.logger.log(`New user signed up with username: ${user.id} (${username})`);

    const orgId = await this.createOrAssignOrganization(user.id, orgName || `${name || username}'s Workspace`);

    if (email) {
      await this.sendEmailVerificationOtp(user.id, email);
    }

    const { accessToken, refreshToken } = await this.generateTokenPair(user.id, orgId, ipAddress, userAgent);
    await this.updateOrgLastAccessed(user.id, orgId);

    await this.createAuditLog(user.id, AuditAction.SIGNUP, true, ipAddress, userAgent);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        accountStatus: user.accountStatus,
      },
      message: email ? 'Signup successful. Please verify your email.' : 'Signup successful.',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔒 PHONE NUMBER SIGNUP (2-Step)
  // ═══════════════════════════════════════════════════════════════════════════

  async requestPhoneSignup(phone: string, name?: string, orgName?: string, ipAddress?: string) {
    // Check existing
    const existingUser = await this.prisma.user.findUnique({
      where: { phone },
    });

    if (existingUser) {
      if (existingUser.phoneVerified) {
        throw new ConflictException('Phone number already registered');
      }
      // If user exists but NOT verified, we allow resending OTP
      // We continue to rate limit below
    }

    // 🔒 Rate limit OTP requests
    await this.enforceOtpRateLimit(phone, OtpType.PHONE_VERIFY);

    let user = existingUser;

    if (!user) {
      // Create unverified user
      user = await this.prisma.user.create({
        data: {
          phone,
          name,
          phoneVerified: false,
          accountStatus: AccountStatus.UNVERIFIED,
          hasRecoveryMethod: false,
        },
      });
    }

    this.logger.log(`Phone signup requested: ${user.id} (${phone})`);

    // Send OTP
    await this.sendPhoneVerificationOtp(user.id, phone);

    return {
      userId: user.id,
      message: 'OTP sent to your phone. Please verify to complete signup.',
    };
  }

  async verifyPhoneSignup(phone: string, otp: string, password: string, ipAddress?: string, userAgent?: string, orgName?: string) {
    const user = await this.prisma.user.findUnique({
      where: { phone },
    });

    if (!user) {
      throw new BadRequestException('Phone number not found');
    }

    // 🔒 Verify OTP with brute-force protection
    await this.verifyOtpSecure(user.id, phone, otp, OtpType.PHONE_VERIFY);

    // Hash password
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    // Update user
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        phoneVerified: true,
        accountStatus: AccountStatus.ACTIVE,
        hasRecoveryMethod: true,
        passwordChangedAt: new Date(),
      },
    });

    this.logger.log(`Phone verified and signup completed: ${user.id} (${phone})`);

    const orgId = await this.createOrAssignOrganization(user.id, orgName || `${user.name || 'User'}'s Workspace`);

    const { accessToken, refreshToken } = await this.generateTokenPair(user.id, orgId, ipAddress, userAgent);
    await this.updateOrgLastAccessed(user.id, orgId);

    await this.createAuditLog(user.id, AuditAction.PHONE_VERIFY, true, ipAddress, userAgent);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        accountStatus: user.accountStatus,
        phoneVerified: true,
      },
      message: 'Signup successful.',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔒 PASSWORD LOGIN - WITH BRUTE-FORCE PROTECTION
  // ═══════════════════════════════════════════════════════════════════════════

  async loginWithPassword(identifier: string, password: string, ipAddress?: string, userAgent?: string) {
    // 🔒 SECURITY: Disambiguate identifier type
    const identifierType = this.detectIdentifierType(identifier);

    // Find user
    const user = await this.prisma.user.findFirst({
      where: this.buildIdentifierQuery(identifier, identifierType),
    });

    if (!user || !user.passwordHash) {
      // 🔒 Log failed attempt
      await this.createAuditLog(null, AuditAction.LOGIN, false, ipAddress, userAgent, { identifier });
      throw new UnauthorizedException('Invalid credentials');
    }

    // 🔒 SECURITY: Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remainingMinutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new ForbiddenException(`Account locked. Try again in ${remainingMinutes} minutes.`);
    }

    // 🔒 SECURITY: Verify password
    const isPasswordValid = await argon2.verify(user.passwordHash, password);

    if (!isPasswordValid) {
      // 🔒 Increment failed attempts
      await this.handleFailedLogin(user.id, ipAddress, userAgent);
      throw new UnauthorizedException('Invalid credentials');
    }

    // 🔒 SECURITY: Reset failed attempts on successful login
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lastFailedLoginAt: null,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    // 🔒 SECURITY: Check account status
    await this.enforceAccountStatus(user.id);

    // Get organization
    const membership = await this.getUserDefaultOrg(user.id);

    // Generate tokens
    const { accessToken, refreshToken } = await this.generateTokenPair(user.id, membership.orgId, ipAddress, userAgent);
    await this.updateOrgLastAccessed(user.id, membership.orgId);

    await this.createAuditLog(user.id, AuditAction.LOGIN, true, ipAddress, userAgent);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        phone: user.phone,
        name: user.name,
        accountStatus: user.accountStatus,
      },
      organization: {
        orgId: membership.orgId,
        role: membership.role,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔒 EMAIL VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  async sendEmailVerification(email: string, ipAddress?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new BadRequestException('Email not found');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email already verified');
    }

    // 🔒 Rate limit
    await this.enforceOtpRateLimit(email, OtpType.EMAIL_VERIFY);

    await this.sendEmailVerificationOtp(user.id, email);

    return {
      message: 'Verification code sent to your email',
    };
  }

  async verifyEmail(email: string, otp: string, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new BadRequestException('Email not found');
    }

    // 🔒 Verify OTP securely
    await this.verifyOtpSecure(user.id, email, otp, OtpType.EMAIL_VERIFY);

    // 🔒 Update user: mark verified and activate account
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        accountStatus: AccountStatus.ACTIVE,
        hasRecoveryMethod: true,
      },
    });

    await this.createAuditLog(user.id, AuditAction.EMAIL_VERIFY, true, ipAddress, userAgent);

    this.logger.log(`Email verified: ${user.id} (${email})`);

    return {
      message: 'Email verified successfully',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔒 PASSWORD RESET
  // ═══════════════════════════════════════════════════════════════════════════

  async requestPasswordReset(identifier: string, ipAddress?: string) {
    const identifierType = this.detectIdentifierType(identifier);
    const user = await this.prisma.user.findFirst({
      where: this.buildIdentifierQuery(identifier, identifierType),
    });

    if (!user) {
      // Don't reveal user existence
      return {
        message: 'If the account exists, a reset code has been sent',
      };
    }

    // 🔒 Rate limit
    const targetIdentifier = user.email || user.phone || identifier;
    await this.enforceOtpRateLimit(targetIdentifier, OtpType.PASSWORD_RESET);

    // Send OTP
    if (user.email) {
      await this.sendPasswordResetOtp(user.id, user.email);
    } else if (user.phone) {
      await this.sendPasswordResetOtpPhone(user.id, user.phone);
    }

    return {
      message: 'If the account exists, a reset code has been sent',
    };
  }

  async resetPassword(identifier: string, otp: string, newPassword: string, ipAddress?: string, userAgent?: string) {
    const identifierType = this.detectIdentifierType(identifier);
    const user = await this.prisma.user.findFirst({
      where: this.buildIdentifierQuery(identifier, identifierType),
    });

    if (!user) {
      throw new UnauthorizedException('Invalid reset code');
    }

    // 🔒 Verify OTP
    const targetIdentifier = user.email || user.phone || identifier;
    await this.verifyOtpSecure(user.id, targetIdentifier, otp, OtpType.PASSWORD_RESET);

    // Hash new password
    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    // 🔒 CRITICAL: Invalidate all existing sessions on password change
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        sessionsInvalidatedAt: new Date(),  // 🔒 Revoke all tokens
        failedLoginAttempts: 0,  // Reset login attempts
        lockedUntil: null,
      },
    });

    // 🔒 Revoke all refresh tokens
    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });

    await this.createAuditLog(user.id, AuditAction.PASSWORD_CHANGE, true, ipAddress, userAgent);

    this.logger.log(`Password reset successful: ${user.id}`);

    return {
      message: 'Password reset successful. Please log in with your new password.',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔒 REFRESH TOKEN FLOW
  // ═══════════════════════════════════════════════════════════════════════════

  async refreshAccessToken(refreshToken: string, ipAddress?: string, userAgent?: string) {
    // Hash the provided token
    const tokenHash = this.hashToken(refreshToken);

    // Find refresh token
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: tokenHash },
      include: { user: true },
    });

    if (!storedToken || storedToken.isRevoked) {
      throw new UnauthorizedException('Invalid or revoked refresh token');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = storedToken.user;

    // 🔒 SECURITY: Check if sessions were invalidated after this token was issued
    if (user.sessionsInvalidatedAt && user.sessionsInvalidatedAt > storedToken.createdAt) {
      await this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { isRevoked: true, revokedAt: new Date() },
      });
      throw new UnauthorizedException('Session invalidated. Please log in again.');
    }

    // 🔒 Check account status
    await this.enforceAccountStatus(user.id);

    // Generate new access token (user identity only)
    const accessToken = this.generateAccessToken(user.id, user.email ?? null);

    // Update last used
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        accountStatus: user.accountStatus,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔒 ORGANIZATION SWITCHING - WITH AUDIT
  // ═══════════════════════════════════════════════════════════════════════════

  async switchOrganization(userId: string, targetOrgId: string, ipAddress?: string, userAgent?: string) {
    // 🔒 Verify membership
    const membership = await this.prisma.orgMember.findUnique({
      where: {
        userId_orgId: {
          userId,
          orgId: targetOrgId,
        },
      },
      select: {
        role: true,
        isActive: true,
        org: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!membership || !membership.isActive) {
      throw new ForbiddenException('You are not a member of this organization');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const accessToken = this.generateAccessToken(userId, user?.email ?? null);

    // 🔒 Audit log org switch & update last access
    await Promise.all([
      this.createAuditLog(userId, AuditAction.ORG_SWITCH, true, ipAddress, userAgent, {
        targetOrgId,
        orgName: membership.org.name,
      }),
      this.updateOrgLastAccessed(userId, targetOrgId),
    ]);

    this.logger.log(`User ${userId} switched to org ${targetOrgId}`);

    return {
      accessToken,
      organization: {
        orgId: membership.org.id,
        name: membership.org.name,
        role: membership.role,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔒 LOGOUT - REVOKE REFRESH TOKEN
  // ═══════════════════════════════════════════════════════════════════════════

  async logout(refreshToken: string, userId: string, ipAddress?: string, userAgent?: string) {
    const tokenHash = this.hashToken(refreshToken);

    await this.prisma.refreshToken.updateMany({
      where: {
        token: tokenHash,
        userId,
      },
      data: {
        isRevoked: true,
        revokedAt: new Date(),
      },
    });

    await this.createAuditLog(userId, AuditAction.LOGOUT, true, ipAddress, userAgent);

    return { message: 'Logged out successfully' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔒 SECURITY HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 🔒 Enforce account status - Verification Gate
   */
  private async enforceAccountStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    switch (user.accountStatus) {
      case AccountStatus.LOCKED:
        throw new ForbiddenException('Account is locked. Contact support.');
      case AccountStatus.SUSPENDED:
        throw new ForbiddenException('Account is suspended. Contact support.');
      case AccountStatus.DEACTIVATED:
        throw new ForbiddenException('Account is deactivated.');
      case AccountStatus.UNVERIFIED:
        // Allow access but with restrictions (enforced by middleware)
        break;
      case AccountStatus.ACTIVE:
        // Full access
        break;
    }
  }

  /**
   * 🔒 Handle failed login attempt
   */
  private async handleFailedLogin(userId: string, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { failedLoginAttempts: true },
    });

    const newAttempts = (user?.failedLoginAttempts || 0) + 1;
    const shouldLock = newAttempts >= this.MAX_LOGIN_ATTEMPTS;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: newAttempts,
        lastFailedLoginAt: new Date(),
        ...(shouldLock && {
          lockedUntil: new Date(Date.now() + this.ACCOUNT_LOCK_DURATION),
        }),
      },
    });

    if (shouldLock) {
      await this.createAuditLog(userId, AuditAction.ACCOUNT_LOCKED, true, ipAddress, userAgent, {
        reason: 'Too many failed login attempts',
      });
    }

    await this.createAuditLog(userId, AuditAction.LOGIN, false, ipAddress, userAgent);
  }

  /**
   * 🔒 OTP Rate Limiting - Prevent abuse
   */
  private async enforceOtpRateLimit(identifier: string, type: OtpType) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const oneMinuteAgo = new Date(Date.now() - this.OTP_COOLDOWN);

    // Check cooldown
    const recentOtp = await this.prisma.otpCode.findFirst({
      where: {
        identifier,
        type,
        createdAt: { gte: oneMinuteAgo },
      },
    });

    if (recentOtp) {
      throw new BadRequestException('Please wait before requesting another code');
    }

    // Check hourly limit
    const hourlyCount = await this.prisma.otpCode.count({
      where: {
        identifier,
        type,
        createdAt: { gte: oneHourAgo },
      },
    });

    if (hourlyCount >= this.MAX_OTP_PER_HOUR) {
      throw new BadRequestException('Too many OTP requests. Try again later.');
    }
  }

  /**
   * 🔒 Verify OTP with brute-force protection
   */
  private async verifyOtpSecure(userId: string, identifier: string, code: string, type: OtpType) {
    const otpRecord = await this.prisma.otpCode.findFirst({
      where: {
        userId,
        identifier,
        type,
        isUsed: false,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    // 🔒 Check if OTP is locked due to too many attempts
    if (otpRecord.isLocked) {
      throw new UnauthorizedException('OTP locked due to too many failed attempts');
    }

    // 🔒 Verify OTP code
    if (otpRecord.code !== code) {
      // Increment attempts
      const newAttempts = otpRecord.attempts + 1;
      const shouldLock = newAttempts >= otpRecord.maxAttempts;

      await this.prisma.otpCode.update({
        where: { id: otpRecord.id },
        data: {
          attempts: newAttempts,
          ...(shouldLock && { isLocked: true }),
        },
      });

      if (shouldLock) {
        await this.createAuditLog(userId, AuditAction.OTP_LOCKED, true, undefined, undefined, { type, identifier });
      }

      await this.createAuditLog(userId, AuditAction.OTP_FAILED, false, undefined, undefined, { type, identifier });

      throw new UnauthorizedException('Invalid OTP');
    }

    // 🔒 Mark OTP as used
    await this.prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { isUsed: true, usedAt: new Date() },
    });

    return true;
  }

  /**
   * 🔒 Generate token pair (access + refresh)
   * Org context is NOT in token; it comes from x-org-id header.
   */
  private async generateTokenPair(userId: string, _orgId: string, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const accessToken = this.generateAccessToken(userId, user?.email ?? null);

    // Generate long-lived refresh token
    const refreshTokenValue = crypto.randomBytes(32).toString('hex');
    const refreshTokenHash = this.hashToken(refreshTokenValue);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        token: refreshTokenHash,
        expiresAt: new Date(Date.now() + this.REFRESH_TOKEN_EXPIRY),
        ipAddress,
        userAgent,
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
    };
  }

  /**
   * 🔒 Generate short-lived access token (user identity only; no org in token)
   */
  private generateAccessToken(userId: string, email?: string | null): string {
    return this.jwtService.sign(
      {
        userId,
        email: email ?? null,
        tokenVersion: 1,
      },
      { expiresIn: this.ACCESS_TOKEN_EXPIRY },
    );
  }

  /**
   * 🔒 Hash token for storage
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * 🔒 Identifier type detection - Prevent ambiguity
   */
  private detectIdentifierType(identifier: string): 'email' | 'username' | 'phone' {
    if (this.looksLikeEmail(identifier)) {
      return 'email';
    } else if (this.looksLikePhone(identifier)) {
      return 'phone';
    } else {
      return 'username';
    }
  }

  private looksLikeEmail(str: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
  }

  private looksLikePhone(str: string): boolean {
    // Matches international format (+91...) OR simple 10-15 digit numbers
    return /^\+?[1-9]\d{9,14}$/.test(str);
  }

  private buildIdentifierQuery(identifier: string, type: 'email' | 'username' | 'phone') {
    switch (type) {
      case 'email':
        return { email: identifier };
      case 'phone':
        return { phone: identifier };
      case 'username':
        return { username: identifier };
    }
  }

  /**
   * Get user's default organization
   */
  private async getUserDefaultOrg(userId: string) {
    const membership = await this.prisma.orgMember.findFirst({
      where: {
        userId,
        isActive: true,
      },
      orderBy: {
        joinedAt: 'asc',
      },
      select: {
        orgId: true,
        role: true,
      },
    });

    if (!membership) {
      throw new ForbiddenException('User is not member of any organization');
    }

    return membership;
  }

  /**
   * Create or assign organization
   */
  private async createOrAssignOrganization(userId: string, orgName: string): Promise<string> {
    const org = await this.prisma.organization.create({
      data: {
        name: orgName,
        slug: this.generateSlug(orgName),
        members: {
          create: {
            userId,
            role: 'OWNER',
            status: MemberStatus.ACTIVE,
          },
        },
      },
    });

    return org.id;
  }



  /**
   * 🔒 Send OTP methods - PRODUCTION SAFE
   */
  private async sendEmailVerificationOtp(userId: string, email: string) {
    const otp = this.generateOtp();
    const expiresAt = new Date(Date.now() + this.OTP_VALIDITY);

    await this.prisma.otpCode.create({
      data: {
        userId,
        identifier: email,
        code: otp,
        type: OtpType.EMAIL_VERIFY,
        expiresAt,
        maxAttempts: this.OTP_MAX_ATTEMPTS,
      },
    });

    // 🔒 PRODUCTION GUARD: Only log in development
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`[DEV ONLY] Email verification OTP: ${otp} (${email})`);
    }

    // 📧 SEND EMAIL via Nodemailer
    try {
      const transporter = this.getEmailTransporter();
      if (transporter) {
        await transporter.sendMail({
          from: this.configService.get('SMTP_FROM') || 'no-reply@example.com',
          to: email,
          // tls: {
          //   rejectUnauthorized: false,
          // },
          // secure: true,
          subject: 'Your Verification Code',
          html: `
            <div style="font-family: sans-serif; padding: 20px;">
              <h2>Verify your email</h2>
              <p>Your verification code is:</p>
              <h1 style="color: #4F46E5; letter-spacing: 5px;">${otp}</h1>
              <p>This code expires in 15 minutes.</p>
            </div>
          `,
        });
        this.logger.log(`Email sent to ${email}`);
      }
    } catch (emailError) {
      this.logger.error(`Failed to send email to ${email}`, emailError);
      console.log("Error sending email", emailError);
      // Don't block signup if email fails, but log it criticaly
    }
  }

  // Helper to initialize Nodemailer (Lazy load)
  private getEmailTransporter() {
    // Only initialize if config exists
    const host = this.configService.get('SMTP_HOST');
    const user = this.configService.get('SMTP_USER');
    const pass = this.configService.get('SMTP_PASS');

    if (!host || !user || !pass) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.warn('SMTP credentials missing! Emails will not be sent.');
      }
      return null;
    }

    const nodemailer = require('nodemailer');
    return nodemailer.createTransport({
      host,
      port: parseInt(this.configService.get('SMTP_PORT') || '587'),
      secure: false, // true for 465, false for other ports
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false, // Fix for self-signed certificate errors (e.g. antivirus/corporate proxy)
      },
    });
  }

  private async sendPhoneVerificationOtp(userId: string, phone: string) {
    const otp = this.generateOtp();
    const expiresAt = new Date(Date.now() + this.OTP_VALIDITY);

    await this.prisma.otpCode.create({
      data: {
        userId,
        identifier: phone,
        code: otp,
        type: OtpType.PHONE_VERIFY,
        expiresAt,
        maxAttempts: this.OTP_MAX_ATTEMPTS,
      },
    });

    // 🔒 PRODUCTION GUARD
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`[DEV ONLY] Phone verification OTP: ${otp} (${phone})`);
    }

    // 📱 SEND SMS via Twilio
    try {
      const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
      const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
      const fromNumber = this.configService.get<string>('TWILIO_PHONE_NUMBER');

      if (accountSid && authToken && fromNumber) {
        const client = new Twilio(accountSid, authToken);

        await client.messages.create({
          body: `Your verification code is: ${otp}`,
          from: fromNumber,
          to: phone,
        });

        this.logger.log(`SMS sent to ${phone} via Twilio`);
      } else {
        this.logger.warn('Twilio credentials missing in .env (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER). SMS not sent.');
      }
    } catch (smsError) {
      this.logger.error(`Failed to send Twilio SMS: ${smsError.message}`);
      // Don't crash the flow, just log error
    }
  }

  private async sendPasswordResetOtp(userId: string, email: string) {
    const otp = this.generateOtp();
    const expiresAt = new Date(Date.now() + this.OTP_VALIDITY);

    await this.prisma.otpCode.create({
      data: {
        userId,
        identifier: email,
        code: otp,
        type: OtpType.PASSWORD_RESET,
        expiresAt,
        maxAttempts: this.OTP_MAX_ATTEMPTS,
      },
    });

    // 🔒 PRODUCTION GUARD
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`[DEV ONLY] Password reset OTP: ${otp} (${email})`);
    }

    // 📧 SEND EMAIL via Nodemailer
    try {
      const transporter = this.getEmailTransporter();
      if (transporter) {
        await transporter.sendMail({
          from: this.configService.get('SMTP_FROM') || 'no-reply@example.com',
          to: email,
          subject: 'Reset Your Password',
          html: `
            <div style="font-family: sans-serif; padding: 20px;">
              <h2>Reset Password</h2>
              <p>You requested a password reset for your account.</p>
              <p>Your code is:</p>
              <h1 style="color: #DC2626; letter-spacing: 5px;">${otp}</h1>
            </div>
          `,
        });
        this.logger.log(`Password reset email sent to ${email}`);
      }
    } catch (emailError) {
      this.logger.error(`Failed to send password reset email to ${email}`, emailError);
    }
  }

  private async sendPasswordResetOtpPhone(userId: string, phone: string) {
    const otp = this.generateOtp();
    const expiresAt = new Date(Date.now() + this.OTP_VALIDITY);

    await this.prisma.otpCode.create({
      data: {
        userId,
        identifier: phone,
        code: otp,
        type: OtpType.PASSWORD_RESET,
        expiresAt,
        maxAttempts: this.OTP_MAX_ATTEMPTS,
      },
    });

    // 🔒 PRODUCTION GUARD
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`[DEV ONLY] Password reset OTP: ${otp} (${phone})`);
    }

    // TODO: SMS service integration
  }

  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '') + '-' + Math.floor(Math.random() * 10000).toString();
  }

  /**
   * 🔒 Create audit log
   */
  private async createAuditLog(
    userId: string | null,
    action: AuditAction,
    success: boolean,
    ipAddress?: string,
    userAgent?: string,
    metadata?: any,
  ) {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          success,
          ipAddress,
          userAgent,
          metadata,
        },
      });
    } catch (error) {
      // Don't fail the request if audit logging fails
      this.logger.error('Failed to create audit log', error);
    }
  }

  /**
   * 🔒 Update organization last access timestamp
   */
  private async updateOrgLastAccessed(userId: string, orgId: string) {
    try {
      await this.prisma.orgMember.update({
        where: { userId_orgId: { userId, orgId } },
        data: { lastAccessedAt: new Date() },
      });
    } catch (e) {
      this.logger.error(`Failed to update lastAccessedAt for user ${userId} in org ${orgId}: ${e.message}`);
    }
  }
}
