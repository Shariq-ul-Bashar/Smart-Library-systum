export interface PasswordPolicyConfig {
  enabled: boolean;
  minLength: number;
  prefix: string;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecial: boolean;
  forceChangeOnFirstLogin: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicyConfig = {
  enabled: true,
  minLength: 10,
  prefix: 'Qiv',
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
  forceChangeOnFirstLogin: true,
};

export function normalizePasswordPolicy(raw: unknown): PasswordPolicyConfig {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<PasswordPolicyConfig>;
  const minLength = Math.min(32, Math.max(8, Number(input.minLength) || DEFAULT_PASSWORD_POLICY.minLength));
  const rawPrefix = typeof input.prefix === 'string' ? input.prefix.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) : DEFAULT_PASSWORD_POLICY.prefix;
  return {
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : DEFAULT_PASSWORD_POLICY.enabled,
    minLength,
    prefix: rawPrefix,
    requireUppercase:
      input.requireUppercase !== undefined
        ? Boolean(input.requireUppercase)
        : DEFAULT_PASSWORD_POLICY.requireUppercase,
    requireLowercase:
      input.requireLowercase !== undefined
        ? Boolean(input.requireLowercase)
        : DEFAULT_PASSWORD_POLICY.requireLowercase,
    requireNumber:
      input.requireNumber !== undefined
        ? Boolean(input.requireNumber)
        : DEFAULT_PASSWORD_POLICY.requireNumber,
    requireSpecial:
      input.requireSpecial !== undefined
        ? Boolean(input.requireSpecial)
        : DEFAULT_PASSWORD_POLICY.requireSpecial,
    forceChangeOnFirstLogin:
      input.forceChangeOnFirstLogin !== undefined
        ? Boolean(input.forceChangeOnFirstLogin)
        : DEFAULT_PASSWORD_POLICY.forceChangeOnFirstLogin,
  };
}

export function validatePasswordAgainstPolicy(
  password: string,
  policy: PasswordPolicyConfig = DEFAULT_PASSWORD_POLICY
): { valid: boolean; error?: string } {
  const effectiveMin = policy.enabled ? Math.max(8, policy.minLength) : 8;
  if (!password || password.length < effectiveMin) {
    return { valid: false, error: `Password must be at least ${effectiveMin} characters long.` };
  }
  if (policy.enabled) {
    if (policy.requireUppercase && !/[A-Z]/.test(password)) {
      return { valid: false, error: 'Password must include at least one uppercase letter (A-Z).' };
    }
    if (policy.requireLowercase && !/[a-z]/.test(password)) {
      return { valid: false, error: 'Password must include at least one lowercase letter (a-z).' };
    }
    if (policy.requireNumber && !/[0-9]/.test(password)) {
      return { valid: false, error: 'Password must include at least one number (0-9).' };
    }
    if (policy.requireSpecial && !/[!@#$%^&*()_\-+=\[\]{};:,.<>?]/.test(password)) {
      return { valid: false, error: 'Password must include at least one special character (e.g. @, #, !, $).' };
    }
  }
  return { valid: true };
}

export interface PremiumStudentDesignPreset {
  key: 'obsidian_platinum' | 'royal_sapphire' | 'emerald_prestige' | 'crimson_scholar';
  name: string;
  tagline: string;
  badgeLabel: string;
  cardBg: string;
  cardBgGradient: string;
  borderColor: string;
  accentColor: string;
  secondaryAccent: string;
  textColor: string;
  mutedTextColor: string;
  qrDark: string;
  qrLight: string;
  swatchClass: string;
}

export const PREMIUM_STUDENT_DESIGNS: PremiumStudentDesignPreset[] = [
  {
    key: 'obsidian_platinum',
    name: 'Obsidian Platinum',
    tagline: 'Brushed platinum accents on deep obsidian slate',
    badgeLabel: 'PLATINUM SCHOLAR',
    cardBg: '#0E121B',
    cardBgGradient: 'linear-gradient(155deg, #161C2C 0%, #0A0D14 60%, #172033 100%)',
    borderColor: '#CBD5E1',
    accentColor: '#E2E8F0',
    secondaryAccent: '#94A3B8',
    textColor: '#F8FAFC',
    mutedTextColor: '#94A3B8',
    qrDark: '#0F172A',
    qrLight: '#F1F5F9',
    swatchClass: 'from-slate-700 via-slate-900 to-slate-600',
  },
  {
    key: 'royal_sapphire',
    name: 'Royal Sapphire',
    tagline: 'Deep sapphire blue with luminous cobalt-silver trim',
    badgeLabel: 'SAPPHIRE PRESTIGE',
    cardBg: '#0B1633',
    cardBgGradient: 'linear-gradient(155deg, #142857 0%, #09122B 58%, #1B3B82 100%)',
    borderColor: '#60A5FA',
    accentColor: '#93C5FD',
    secondaryAccent: '#3B82F6',
    textColor: '#EFF6FF',
    mutedTextColor: '#93C5FD',
    qrDark: '#0B1633',
    qrLight: '#DBEAFE',
    swatchClass: 'from-blue-600 via-indigo-900 to-sky-500',
  },
  {
    key: 'emerald_prestige',
    name: 'Emerald Prestige',
    tagline: 'Imperial emerald velvet with brushed champagne mint',
    badgeLabel: 'EMERALD HONORS',
    cardBg: '#071F1A',
    cardBgGradient: 'linear-gradient(155deg, #0D3B31 0%, #061A16 58%, #115E4D 100%)',
    borderColor: '#34D399',
    accentColor: '#6EE7B7',
    secondaryAccent: '#10B981',
    textColor: '#ECFDF5',
    mutedTextColor: '#6EE7B7',
    qrDark: '#064E3B',
    qrLight: '#D1FAE5',
    swatchClass: 'from-emerald-500 via-teal-900 to-emerald-400',
  },
  {
    key: 'crimson_scholar',
    name: 'Crimson Scholar',
    tagline: 'Burgundy executive finish with rose-silver framing',
    badgeLabel: 'CRIMSON FELLOW',
    cardBg: '#220A12',
    cardBgGradient: 'linear-gradient(155deg, #471224 0%, #1B070E 58%, #6B1D36 100%)',
    borderColor: '#FB7185',
    accentColor: '#FDA4AF',
    secondaryAccent: '#F43F5E',
    textColor: '#FFF1F2',
    mutedTextColor: '#FDA4AF',
    qrDark: '#4C0519',
    qrLight: '#FFE4E6',
    swatchClass: 'from-rose-600 via-rose-950 to-pink-500',
  },
];

export function getPremiumStudentDesign(key?: string | null): PremiumStudentDesignPreset {
  return (
    PREMIUM_STUDENT_DESIGNS.find((d) => d.key === key) || PREMIUM_STUDENT_DESIGNS[0]
  );
}
