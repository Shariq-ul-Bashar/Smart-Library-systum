// QIVORA — Unified Public QR Verification Edge Function (Supabase Deno Runtime)
// Calls public.qivora_verify_qr_public(p_token) and exposes ONLY approved public fields.
// Designed & Developed by MOHAMMAD SHARIQ · BCA 1st Year | 2026–2027 Batch

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({
          verified: false,
          error: 'Supabase Edge Function secrets (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) are not configured.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(req.url);
    const token =
      url.searchParams.get('token') ||
      (req.method === 'POST' ? ((await req.json().catch(() => ({}))) as { token?: string }).token : null);

    if (!token || !token.trim()) {
      return new Response(
        JSON.stringify({ verified: false, reason: 'QR verification token is required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.rpc('qivora_verify_qr_public', {
      p_token: token.trim(),
    });

    if (error) {
      return new Response(
        JSON.stringify({ verified: false, reason: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        verified: false,
        reason: err instanceof Error ? err.message : 'Verification error.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
