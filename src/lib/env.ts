/**
 * QIVORA — Centralized Frontend Environment Configuration & Validation
 *
 * SECURITY RULES:
 * - Never place SUPABASE_SERVICE_ROLE_KEY or any secret in VITE_* variables.
 * - Supports both legacy VITE_SUPABASE_ANON_KEY and newer VITE_SUPABASE_PUBLISHABLE_KEY.
 * - Never invents credentials or silently falls back to mock data.
 */

export interface SupabaseClientEnv {
  url: string | null;
  publicKey: string | null;
  keyType: 'publishable' | 'anon' | null;
  isConfigured: boolean;
  missingVars: string[];
  validationError: string | null;
}

function readViteEnv(key: string): string | null {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const raw = env?.[key];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('YOUR_') || trimmed.startsWith('MY_')) {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

export function getSupabaseClientEnv(): SupabaseClientEnv {
  const url = readViteEnv('VITE_SUPABASE_URL');
  const publishableKey = readViteEnv('VITE_SUPABASE_PUBLISHABLE_KEY');
  const anonKey = readViteEnv('VITE_SUPABASE_ANON_KEY');
  const publicKey = publishableKey || anonKey;
  const keyType = publishableKey ? 'publishable' : anonKey ? 'anon' : null;

  const missingVars: string[] = [];
  if (!url) missingVars.push('VITE_SUPABASE_URL');
  if (!publicKey) missingVars.push('VITE_SUPABASE_ANON_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY)');

  let validationError: string | null = null;
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
        validationError = 'VITE_SUPABASE_URL must use HTTPS in production.';
      }
    } catch {
      validationError = 'VITE_SUPABASE_URL is not a valid URL.';
    }
  } else if (missingVars.length > 0) {
    validationError = `Supabase environment variables not configured: ${missingVars.join(', ')}.`;
  }

  return {
    url,
    publicKey,
    keyType,
    isConfigured: Boolean(url && publicKey && !validationError),
    missingVars,
    validationError,
  };
}

export const APP_IDENTITY = {
  name: 'QIVORA',
  subtitle: 'Smart Library Management System',
  tagline: 'Intelligence for Every Library.',
  creditLine1: 'Designed & Developed by MOHAMMAD SHARIQ',
  creditLine2: 'BCA 1st Year | 2026–2027 Batch',
} as const;
