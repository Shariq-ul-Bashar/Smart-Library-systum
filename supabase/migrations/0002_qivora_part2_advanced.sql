-- ============================================================================
-- QIVORA — Smart Library Management System
-- Part 2 Migration: Smart Automation, Migration Center, Advanced Notifications,
-- Founder Nominations, and Modular Integrations Registry + Row Level Security
-- ============================================================================

-- 1. SMART AUTOMATION ENGINE
CREATE TABLE IF NOT EXISTS public.automation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  schedule_cron TEXT NOT NULL DEFAULT '0 8 * * *',
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_run_at TIMESTAMPTZ,
  last_status TEXT DEFAULT 'idle',
  last_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, job_key)
);

CREATE TABLE IF NOT EXISTS public.automation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.automation_jobs(id) ON DELETE SET NULL,
  job_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  trigger_source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'success',
  processed_count INTEGER NOT NULL DEFAULT 0,
  notifications_sent INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL,
  error_details TEXT,
  triggered_by_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. SMART MIGRATION CENTER AUDIT RUNS
CREATE TABLE IF NOT EXISTS public.migration_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  column_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_sample JSONB NOT NULL DEFAULT '[]'::jsonb,
  performed_by_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. FOUNDER NOMINATIONS (College Admin Nominates -> Platform Super Admin Approves)
CREATE TABLE IF NOT EXISTS public.founder_nominations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
  nominee_name TEXT NOT NULL,
  nominee_email TEXT,
  designation TEXT NOT NULL DEFAULT 'QIVORA Honorary Library Fellow',
  justification TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  nominated_by_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_by_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  review_notes TEXT,
  issued_founder_id UUID REFERENCES public.founder_identities(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

-- 4. USER NOTIFICATION PREFERENCES & DELIVERY AUDIT LOG
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  categories JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  notification_id UUID REFERENCES public.notifications(id) ON DELETE SET NULL,
  recipient_email TEXT,
  channel TEXT NOT NULL DEFAULT 'in_app',
  status TEXT NOT NULL DEFAULT 'delivered',
  provider_response TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. PLATFORM MODULAR INTEGRATIONS REGISTRY
CREATE TABLE IF NOT EXISTS public.integration_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  config_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES FOR SUPABASE PRODUCTION DEPLOYMENT
-- ============================================================================

ALTER TABLE public.automation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.founder_nominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_configs ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped policies (requires auth.uid() membership in organization_members)
CREATE POLICY "org_staff_automation_jobs" ON public.automation_jobs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = automation_jobs.organization_id
        AND om.profile_id = auth.uid()
        AND om.status = 'active'
    )
  );

CREATE POLICY "org_staff_automation_logs" ON public.automation_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = automation_logs.organization_id
        AND om.profile_id = auth.uid()
        AND om.status = 'active'
    )
  );

CREATE POLICY "org_staff_migration_runs" ON public.migration_runs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = migration_runs.organization_id
        AND om.profile_id = auth.uid()
        AND om.status = 'active'
    )
  );

CREATE POLICY "org_admin_founder_nominations" ON public.founder_nominations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = founder_nominations.organization_id
        AND om.profile_id = auth.uid()
        AND om.status = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE
    )
  );

CREATE POLICY "user_own_notification_preferences" ON public.notification_preferences
  FOR ALL USING (profile_id = auth.uid());

CREATE POLICY "org_staff_notification_deliveries" ON public.notification_deliveries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = notification_deliveries.organization_id
        AND om.profile_id = auth.uid()
        AND om.status = 'active'
    )
  );

CREATE POLICY "super_admin_integration_configs" ON public.integration_configs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_super_admin = TRUE
    )
  );

-- ============================================================================
-- OPTIONAL SUPABASE pg_cron SCHEDULE REFERENCE (Enable pg_cron extension first)
-- ============================================================================
-- SELECT cron.schedule('qivora-daily-overdue', '0 9 * * *', $$
--   SELECT net.http_post(
--     url := current_setting('app.settings.edge_base_url') || '/functions/v1/qivora-automation-runner',
--     headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_key'))
--   );
-- $$);
