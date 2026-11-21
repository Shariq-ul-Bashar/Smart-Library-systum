import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { platformSettings } from '../db/schema.ts';
import {
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicyConfig,
  normalizePasswordPolicy,
} from '../shared/security-and-tiers.ts';

export async function getPlatformPasswordPolicy(): Promise<PasswordPolicyConfig> {
  try {
    const [row] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'password_policy'))
      .limit(1);
    if (!row) return { ...DEFAULT_PASSWORD_POLICY };
    return normalizePasswordPolicy(row.value);
  } catch {
    return { ...DEFAULT_PASSWORD_POLICY };
  }
}

export function generatePolicyCompliantPassword(policy: PasswordPolicyConfig): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const special = '@#$!%*?';
  const all = upper + lower + digits + special;

  const prefix = (policy.prefix || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  const targetLen = Math.max(10, Math.min(32, policy.minLength || 10));

  const requiredChars: string[] = [];
  if (policy.requireUppercase) requiredChars.push(upper[crypto.randomInt(upper.length)]);
  if (policy.requireLowercase) requiredChars.push(lower[crypto.randomInt(lower.length)]);
  if (policy.requireNumber) requiredChars.push(digits[crypto.randomInt(digits.length)]);
  if (policy.requireSpecial) requiredChars.push(special[crypto.randomInt(special.length)]);

  // Always guarantee strong entropy in the random suffix even if prefix is used
  const suffixBaseLen = Math.max(6, targetLen - (prefix ? prefix.length + 1 : 0));
  while (requiredChars.length < suffixBaseLen) {
    requiredChars.push(all[crypto.randomInt(all.length)]);
  }

  // Fisher-Yates shuffle using crypto.randomInt
  for (let i = requiredChars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [requiredChars[i], requiredChars[j]] = [requiredChars[j], requiredChars[i]];
  }

  const randomSegment = requiredChars.join('');
  return prefix ? `${prefix}-${randomSegment}` : randomSegment;
}
