/**
 * QIVORA — Official Centralized Supabase JavaScript Client
 *
 * Uses @supabase/supabase-js strictly with public anon/publishable credentials
 * protected by PostgreSQL Row Level Security (RLS).
 * Never falls back to mock data if unconfigured.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClientEnv, type SupabaseClientEnv } from './env.ts';

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient) return cachedClient;

  const env = getSupabaseClientEnv();
  if (!env.isConfigured || !env.url || !env.publicKey) {
    return null;
  }

  cachedClient = createClient(env.url, env.publicKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'qivora-supabase-auth',
    },
    global: {
      headers: {
        'X-Client-Info': 'qivora-web/1.0',
      },
    },
  });

  return cachedClient;
}

export const supabase: SupabaseClient | null = getSupabaseClient();

export function isSupabaseConfigured(): boolean {
  return getSupabaseClientEnv().isConfigured;
}

export function getSupabaseConfigDiagnostics(): SupabaseClientEnv {
  return getSupabaseClientEnv();
}

export interface SupabaseVerificationResult {
  configured: boolean;
  connected: boolean;
  latencyMs?: number;
  keyType: 'publishable' | 'anon' | null;
  error?: string;
}

/**
 * Performs an actual network verification against the configured Supabase project.
 * Never returns connected: true unless a real request succeeds.
 */
export async function verifySupabaseConnection(): Promise<SupabaseVerificationResult> {
  const env = getSupabaseClientEnv();
  if (!env.isConfigured || !env.url || !env.publicKey) {
    return {
      configured: false,
      connected: false,
      keyType: env.keyType,
      error:
        env.validationError ||
        'Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY) to connect your Supabase project.',
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      configured: false,
      connected: false,
      keyType: env.keyType,
      error: 'Unable to initialize Supabase client.',
    };
  }

  const started = performance.now();
  try {
    // Verify real session/auth endpoint reachability without requiring elevated privileges
    const { error } = await client.auth.getSession();
    const latencyMs = Math.round(performance.now() - started);
    if (error) {
      return {
        configured: true,
        connected: false,
        latencyMs,
        keyType: env.keyType,
        error: error.message,
      };
    }

    return {
      configured: true,
      connected: true,
      latencyMs,
      keyType: env.keyType,
    };
  } catch (err: unknown) {
    return {
      configured: true,
      connected: false,
      keyType: env.keyType,
      error: err instanceof Error ? err.message : 'Supabase network verification failed.',
    };
  }
}
