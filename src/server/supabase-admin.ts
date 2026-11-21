/**
 * QIVORA — Server-Only Supabase Admin & JWT Verification Module
 *
 * SECURITY BOUNDARY:
 * - Imported ONLY by server-side Express routes (`src/server/*`).
 * - Never imported by React client bundles.
 * - Reads SUPABASE_SERVICE_ROLE_KEY strictly from process.env on the server.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedAdminClient: SupabaseClient | null = null;
let cachedPublicServerClient: SupabaseClient | null = null;

function cleanEnv(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('YOUR_') || trimmed.startsWith('MY_')) return null;
  return trimmed;
}

export function getServerSupabaseStatus() {
  const url = cleanEnv('SUPABASE_URL') || cleanEnv('VITE_SUPABASE_URL');
  const publicKey =
    cleanEnv('VITE_SUPABASE_PUBLISHABLE_KEY') ||
    cleanEnv('VITE_SUPABASE_ANON_KEY') ||
    cleanEnv('SUPABASE_ANON_KEY');
  const hasServiceRoleKey = Boolean(cleanEnv('SUPABASE_SERVICE_ROLE_KEY'));

  const missingEnv: string[] = [];
  if (!url) missingEnv.push('VITE_SUPABASE_URL');
  if (!publicKey) missingEnv.push('VITE_SUPABASE_ANON_KEY');

  return {
    configured: Boolean(url && publicKey),
    hasUrl: Boolean(url),
    hasPublicKey: Boolean(publicKey),
    hasServiceRoleKey,
    missingEnv,
  };
}

export function getSupabaseAdminClient(): SupabaseClient | null {
  if (cachedAdminClient) return cachedAdminClient;
  const url = cleanEnv('SUPABASE_URL') || cleanEnv('VITE_SUPABASE_URL');
  const serviceKey = cleanEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return null;

  cachedAdminClient = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedAdminClient;
}

export function getSupabaseServerAuthClient(): SupabaseClient | null {
  if (cachedPublicServerClient) return cachedPublicServerClient;
  const url = cleanEnv('SUPABASE_URL') || cleanEnv('VITE_SUPABASE_URL');
  const key =
    cleanEnv('SUPABASE_SERVICE_ROLE_KEY') ||
    cleanEnv('VITE_SUPABASE_PUBLISHABLE_KEY') ||
    cleanEnv('VITE_SUPABASE_ANON_KEY') ||
    cleanEnv('SUPABASE_ANON_KEY');
  if (!url || !key) return null;

  cachedPublicServerClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedPublicServerClient;
}

export async function verifySupabaseAccessToken(accessToken: string): Promise<{
  uid: string;
  email: string;
  fullName?: string;
  avatarUrl?: string;
} | null> {
  const client = getSupabaseServerAuthClient();
  if (!client) return null;

  try {
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data.user || !data.user.email) {
      return null;
    }
    const meta = (data.user.user_metadata || {}) as Record<string, unknown>;
    return {
      uid: `sb_${data.user.id}`,
      email: data.user.email.toLowerCase().trim(),
      fullName:
        typeof meta.full_name === 'string'
          ? meta.full_name
          : typeof meta.name === 'string'
            ? meta.name
            : undefined,
      avatarUrl: typeof meta.avatar_url === 'string' ? meta.avatar_url : undefined,
    };
  } catch {
    return null;
  }
}
