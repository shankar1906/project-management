import {
  IsNotEmpty,
  IsString,
  IsEmail,
  IsOptional,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';

// ═══════════════════════════════════════════════════════════════════════════
// AUTH0 LOGIN (Existing social/email login via Auth0)
// ═══════════════════════════════════════════════════════════════════════════

export class LoginDto {
  @IsNotEmpty()
  @IsString()
  auth0Token: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// EMAIL/PASSWORD SIGNUP
// ═══════════════════════════════════════════════════════════════════════════

export class EmailSignupDto {
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  orgName?: string; // Optional: Create new org or join existing
}

// ═══════════════════════════════════════════════════════════════════════════
// USERNAME/PASSWORD SIGNUP
// ═══════════════════════════════════════════════════════════════════════════

export class UsernameSignupDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Username can only contain letters, numbers, hyphens, and underscores',
  })
  username: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password: string;

  @IsOptional()
  @IsEmail()
  email?: string; // Optional email for recovery

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  orgName?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHONE NUMBER SIGNUP (2-step process)
// ═══════════════════════════════════════════════════════════════════════════

export class PhoneSignupRequestDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message: 'Phone must be in E.164 format (e.g., +1234567890)',
  })
  phone: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  orgName?: string;
}

export class PhoneSignupVerifyDto {
  @IsNotEmpty()
  @IsString()
  phone: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  @Matches(/^\d{6}$/, {
    message: 'OTP must be a 6-digit number',
  })
  otp: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password: string; // Set password after OTP verification
}

// ═══════════════════════════════════════════════════════════════════════════
// TRADITIONAL LOGIN (Email/Username/Phone + Password)
// ═══════════════════════════════════════════════════════════════════════════

export class PasswordLoginDto {
  @IsNotEmpty()
  @IsString()
  identifier: string; // Can be email, username, or phone

  @IsNotEmpty()
  @IsString()
  password: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// EMAIL VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

export class SendEmailVerificationDto {
  @IsNotEmpty()
  @IsEmail()
  email: string;
}

export class VerifyEmailDto {
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  otp: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// PASSWORD RESET
// ═══════════════════════════════════════════════════════════════════════════

export class RequestPasswordResetDto {
  @IsNotEmpty()
  @IsString()
  identifier: string; // Email, username, or phone
}

export class ResetPasswordDto {
  @IsNotEmpty()
  @IsString()
  identifier: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  otp: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  newPassword: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// ORGANIZATION SWITCHING
// ═══════════════════════════════════════════════════════════════════════════

export class SwitchOrgDto {
  @IsNotEmpty()
  @IsString()
  orgId: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// REFRESH TOKEN & LOGOUT
// ═══════════════════════════════════════════════════════════════════════════

export class RefreshTokenDto {
  @IsNotEmpty()
  @IsString()
  refreshToken: string;
}

export class LogoutDto {
  @IsNotEmpty()
  @IsString()
  refreshToken: string;
}
