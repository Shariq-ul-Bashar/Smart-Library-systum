// QIVORA — Library Automation Runner Edge Function (Supabase Deno Runtime)
// Runs scheduled overdue status transitions and expired reservation cleanup.
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
        JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const nowIso = new Date().toISOString();

    // 1. Mark past-due active loans as overdue
    const { data: overdueLoans, error: overdueErr } = await supabase
      .from('loans')
      .update({ status: 'overdue', updated_at: nowIso })
      .eq('status', 'issued')
      .lt('due_at', nowIso)
      .select('id, organization_id, student_id');

    if (overdueErr) throw overdueErr;

    // 2. Expire ready-for-pickup reservations whose pickup window elapsed
    const { data: expiredRes, error: resErr } = await supabase
      .from('reservations')
      .update({ status: 'expired', updated_at: nowIso })
      .eq('status', 'ready_for_pickup')
      .lt('expires_at', nowIso)
      .select('id');

    if (resErr) throw resErr;

    return new Response(
      JSON.stringify({
        ok: true,
        ranAt: nowIso,
        markedOverdueCount: overdueLoans?.length ?? 0,
        expiredReservationsCount: expiredRes?.length ?? 0,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Automation run failed.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
