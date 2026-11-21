-- ============================================================================
-- QIVORA — Smart Library Management System
-- Migration 0001: Multi-Tenant Row-Level Security (RLS) & Storage Policies
-- Designed & Developed by MOHAMMAD SHARIQ · BCA 1st Year | 2026–2027 Batch
-- ============================================================================

CREATE OR REPLACE FUNCTION public.qivora_current_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.profiles WHERE uid = auth.uid()::text LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.qivora_is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_super_admin FROM public.profiles WHERE uid = auth.uid()::text LIMIT 1),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.qivora_has_org_role(target_org_id uuid, allowed_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.qivora_is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      JOIN public.roles r ON r.id = om.role_id
      WHERE om.organization_id = target_org_id
        AND om.profile_id = public.qivora_current_profile_id()
        AND om.status = 'active'
        AND r.slug = ANY(allowed_roles)
    );
$$;

-- Enable Row-Level Security across all core tables
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_registration_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_copies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fine_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.id_card_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_digital_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.founder_identities ENABLE ROW LEVEL SECURITY;

-- Profiles: users read/update only their own profile; Super Admin reads all
DROP POLICY IF EXISTS qivora_profiles_self_select ON public.profiles;
CREATE POLICY qivora_profiles_self_select ON public.profiles
  FOR SELECT USING (uid = auth.uid()::text OR public.qivora_is_super_admin());

DROP POLICY IF EXISTS qivora_profiles_self_update ON public.profiles;
CREATE POLICY qivora_profiles_self_update ON public.profiles
  FOR UPDATE USING (uid = auth.uid()::text)
  WITH CHECK (uid = auth.uid()::text AND is_super_admin = false);

-- Organizations: visible to active members or Platform Super Admin
DROP POLICY IF EXISTS qivora_organizations_member_select ON public.organizations;
CREATE POLICY qivora_organizations_member_select ON public.organizations
  FOR SELECT USING (
    public.qivora_has_org_role(id, ARRAY['college_admin', 'librarian', 'student'])
  );

DROP POLICY IF EXISTS qivora_organizations_super_admin_all ON public.organizations;
CREATE POLICY qivora_organizations_super_admin_all ON public.organizations
  FOR ALL USING (public.qivora_is_super_admin())
  WITH CHECK (public.qivora_is_super_admin());

-- Students: strict tenant isolation; students read only their own record
DROP POLICY IF EXISTS qivora_students_staff_all ON public.students;
CREATE POLICY qivora_students_staff_all ON public.students
  FOR ALL USING (public.qivora_has_org_role(organization_id, ARRAY['college_admin', 'librarian']))
  WITH CHECK (public.qivora_has_org_role(organization_id, ARRAY['college_admin', 'librarian']));

DROP POLICY IF EXISTS qivora_students_self_select ON public.students;
CREATE POLICY qivora_students_self_select ON public.students
  FOR SELECT USING (profile_id = public.qivora_current_profile_id());

-- Books & Copies: staff manage within org; students read within own org
DROP POLICY IF EXISTS qivora_books_member_select ON public.books;
CREATE POLICY qivora_books_member_select ON public.books
  FOR SELECT USING (
    public.qivora_has_org_role(organization_id, ARRAY['college_admin', 'librarian', 'student'])
  );

DROP POLICY IF EXISTS qivora_books_staff_write ON public.books;
CREATE POLICY qivora_books_staff_write ON public.books
  FOR ALL USING (public.qivora_has_org_role(organization_id, ARRAY['college_admin', 'librarian']))
  WITH CHECK (public.qivora_has_org_role(organization_id, ARRAY['college_admin', 'librarian']));

DROP POLICY IF EXISTS qivora_copies_member_select ON public.book_copies;
CREATE POLICY qivora_copies_member_select ON public.book_copies
  FOR SELECT USING (
    public.qivora_has_org_role(organization_id, ARRAY['college_admin', 'librarian', 'student'])
  );

DROP POLICY IF EXISTS qivora_copies_staff_write ON public.book_copies;
CREATE POLICY qivora_copies_staff_write ON public.book_copies
  FOR ALL USING (public.qivora_has_org_role(organization_id, ARRAY['college_admin', 'librarian']))
  WITH CHECK (public.qivora_has_org_role(organization_id, ARRAY['college_admin', 'librarian']));

-- Loans, Reservations, Fines, Attendance: strict tenant + student ownership isolation
DROP POLICY IF EXISTS qivora_loans_staff_all ON public.loans;
CREATE POLICY qivora_loans_staff_all ON public.loans
  FOR ALL USING (public.qivora_has_org_role(organization_id, ARRAY['college_admin', 'librarian']))
  WITH CHECK (public.qivora_has_org_role(organization_id, ARRAY['college_admin', 'librarian']));

DROP POLICY IF EXISTS qivora_loans_student_select ON public.loans;
CREATE POLICY qivora_loans_student_select ON public.loans
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = loans.student_id AND s.profile_id = public.qivora_current_profile_id()
    )
  );

DROP POLICY IF EXISTS qivora_fines_staff_all ON public.fines;
CREATE POLICY qivora_fines_staff_all ON public.fines
  FOR ALL USING (public.qivora_has_org_role(organization_id, ARRAY['college_admin', 'librarian']))
  WITH CHECK (public.qivora_has_org_role(organization_id, ARRAY['college_admin', 'librarian']));

DROP POLICY IF EXISTS qivora_fines_student_select ON public.fines;
CREATE POLICY qivora_fines_student_select ON public.fines
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = fines.student_id AND s.profile_id = public.qivora_current_profile_id()
    )
  );

DROP POLICY IF EXISTS qivora_digital_ids_staff_all ON public.student_digital_ids;
CREATE POLICY qivora_digital_ids_staff_all ON public.student_digital_ids
  FOR ALL USING (public.qivora_has_org_role(organization_id, ARRAY['college_admin', 'librarian']))
  WITH CHECK (public.qivora_has_org_role(organization_id, ARRAY['college_admin', 'librarian']));

DROP POLICY IF EXISTS qivora_digital_ids_student_select ON public.student_digital_ids;
CREATE POLICY qivora_digital_ids_student_select ON public.student_digital_ids
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = student_digital_ids.student_id AND s.profile_id = public.qivora_current_profile_id()
    )
  );

-- Notifications: only recipient reads/marks read
DROP POLICY IF EXISTS qivora_notifications_self ON public.notifications;
CREATE POLICY qivora_notifications_self ON public.notifications
  FOR ALL USING (recipient_profile_id = public.qivora_current_profile_id())
  WITH CHECK (recipient_profile_id = public.qivora_current_profile_id());

-- Audit logs: append-only; readable only by Super Admin or College Admin of own org
DROP POLICY IF EXISTS qivora_audit_logs_read ON public.audit_logs;
CREATE POLICY qivora_audit_logs_read ON public.audit_logs
  FOR SELECT USING (
    public.qivora_is_super_admin()
    OR (organization_id IS NOT NULL AND public.qivora_has_org_role(organization_id, ARRAY['college_admin']))
  );

-- Supabase Storage Buckets (run in Supabase SQL Editor)
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('college-logos', 'college-logos', true),
  ('book-covers', 'book-covers', true),
  ('student-photos', 'student-photos', false),
  ('student-documents', 'student-documents', false),
  ('id-backgrounds', 'id-backgrounds', false)
ON CONFLICT (id) DO NOTHING;
