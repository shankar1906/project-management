import { randomBytes } from 'crypto';

/**
 * Generate a secure, cryptographically random invite token
 * Uses crypto.randomBytes (not Math.random) for production security
 */
export function generateInviteToken(): string {
    return randomBytes(32).toString('hex'); // 64-char hex string
}

/**
 * Calculate invite expiry timestamp
 * Default: 48 hours from now
 */
export function calculateExpiryDate(hoursFromNow: number = 48): Date {
    const now = new Date();
    now.setHours(now.getHours() + hoursFromNow);
    return now;
}

/**
 * Check if invite token has expired
 */
export function isInviteExpired(expiresAt: Date | null): boolean {
    if (!expiresAt) return false;
    return new Date() > expiresAt;
}
