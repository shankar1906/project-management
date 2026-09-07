import { Controller, Post, Get, Body, Logger, Ip, Headers, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  LoginDto,
  EmailSignupDto,
  UsernameSignupDto,
  PhoneSignupRequestDto,
  PhoneSignupVerifyDto,
  PasswordLoginDto,
  SendEmailVerificationDto,
  VerifyEmailDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
  SwitchOrgDto,
  RefreshTokenDto,
  LogoutDto,
} from './dto/auth.dto';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserId } from '../../common/decorators/org.decorator';

/**
 * Auth Controller - Multi-Method Authentication
 * 
 * Supported Signup Methods:
 * 1. Auth0 (Social Login: Google, Facebook, etc.)
 * 2. Email + Password
 * 3. Username + Password
 * 4. Phone + OTP + Password
 * 
 * Supported Login Methods:
 * 1. Auth0 Token
 * 2. Email/Username/Phone + Password
 */
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private authService: AuthService) { }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTH0 LOGIN (Social/Email via Auth0)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /auth/login
   * Login via Auth0 (supports social logins like Google, Facebook, etc.)
   */
  @Post('login')
  async loginAuth0(@Body() loginDto: LoginDto) {
    this.logger.log(`Auth0 login attempt, ${loginDto.auth0Token}`);
    console.log("Hiiiii", loginDto)
    return this.authService.validateAuth0Token(loginDto.auth0Token);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EMAIL/PASSWORD SIGNUP & LOGIN
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /auth/signup/email
   * Signup with email and password
   */
  @Post('signup/email')
  async signupEmail(@Body() dto: EmailSignupDto) {
    this.logger.log(`Email signup attempt: ${dto.email}`);
    return this.authService.signupWithEmail(
      dto.email,
      dto.password,
      dto.name,
      dto.orgName,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // USERNAME/PASSWORD SIGNUP & LOGIN
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /auth/signup/username
   * Signup with username and password
   */
  @Post('signup/username')
  async signupUsername(@Body() dto: UsernameSignupDto) {
    this.logger.log(`Username signup attempt: ${dto.username}`);
    return this.authService.signupWithUsername(
      dto.username,
      dto.password,
      dto.email,
      dto.name,
      dto.orgName,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHONE NUMBER SIGNUP (2-Step Process)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /auth/signup/phone/request
   * Step 1: Request phone signup - sends OTP
   */
  @Post('signup/phone/request')
  async signupPhoneRequest(@Body() dto: PhoneSignupRequestDto) {
    this.logger.log(`Phone signup request: ${dto.phone}`);
    return this.authService.requestPhoneSignup(
      dto.phone,
      dto.name,
      dto.orgName,
    );
  }

  /**
   * POST /auth/signup/phone/verify
   * Step 2: Verify OTP and set password
   */
  @Post('signup/phone/verify')
  async signupPhoneVerify(@Body() dto: PhoneSignupVerifyDto) {
    this.logger.log(`Phone signup verification: ${dto.phone}`);
    return this.authService.verifyPhoneSignup(
      dto.phone,
      dto.otp,
      dto.password,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PASSWORD LOGIN (Email/Username/Phone + Password)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /auth/login/password
   * Login with email/username/phone and password
   */
  @Post('login/password')
  async loginPassword(@Body() dto: PasswordLoginDto) {
    this.logger.log(`Password login attempt: ${dto.identifier}`);
    return this.authService.loginWithPassword(dto.identifier, dto.password);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EMAIL VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /auth/email/send-verification
   * Send email verification OTP
   */
  @Post('email/send-verification')
  async sendEmailVerification(@Body() dto: SendEmailVerificationDto) {
    this.logger.log(`Email verification request: ${dto.email}`);
    return this.authService.sendEmailVerification(dto.email);
  }

  /**
   * POST /auth/email/verify
   * Verify email with OTP
   */
  @Post('email/verify')
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    this.logger.log(`Email verification: ${dto.email}`);
    return this.authService.verifyEmail(dto.email, dto.otp);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PASSWORD RESET
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /auth/password/reset-request
   * Request password reset - sends OTP
   */
  @Post('password/reset-request')
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    this.logger.log(`Password reset request: ${dto.identifier}`);
    return this.authService.requestPasswordReset(dto.identifier);
  }

  /**
   * POST /auth/password/reset
   * Reset password with OTP
   */
  @Post('password/reset')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    this.logger.log(`Password reset: ${dto.identifier}`);
    return this.authService.resetPassword(
      dto.identifier,
      dto.otp,
      dto.newPassword,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ORGANIZATION SWITCHING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /auth/switch-org
   * Switch to different organization
   */
  @UseGuards(JwtAuthGuard)
  @Post('switch-org')
  async switchOrg(
    @UserId() userId: string,
    @Body() switchOrgDto: SwitchOrgDto,
  ) {
    this.logger.log(`User ${userId} switching to org ${switchOrgDto.orgId}`);
    return this.authService.switchOrganization(userId, switchOrgDto.orgId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /auth/refresh
   * Refresh access token using refresh token
   */
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.authService.refreshAccessToken(dto.refreshToken, ip, userAgent);
  }

  /**
   * POST /auth/logout
   * Logout user and revoke refresh token
   */
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @Body() dto: LogoutDto,
    @UserId() userId: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.authService.logout(dto.refreshToken, userId, ip, userAgent);
  }

  /**
   * GET /auth/me
   * Get current user profile & context (Essential for "Stay Logged In" on refresh)
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@UserId() userId: string) {
    // We delegate to a service method to get rich profile
    return this.authService.getUserProfile(userId);
  }
}
