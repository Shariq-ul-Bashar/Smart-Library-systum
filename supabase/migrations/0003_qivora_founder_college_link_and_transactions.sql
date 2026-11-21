-- ============================================================================
-- QIVORA — Smart Library Management System
-- Migration 0003: Linked Founder Identity + Atomic Library Transaction RPCs
-- Designed & Developed by MOHAMMAD SHARIQ · BCA 1st Year | 2026–2027 Batch
-- ============================================================================

-- 1. Linked Founder Identity Columns (reuses real College Student membership; zero duplication)
ALTER TABLE public.founder_identities
  ADD COLUMN IF NOT EXISTS linked_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS college_link_status text NOT NULL DEFAULT 'unlinked',
  ADD COLUMN IF NOT EXISTS college_approved_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS college_approved_at timestamptz;

CREATE INDEX IF NOT EXISTS founder_identities_linked_org_idx
  ON public.founder_identities (linked_organization_id);
CREATE INDEX IF NOT EXISTS founder_identities_linked_student_idx
  ON public.founder_identities (linked_student_id);

-- Enforce strict RLS on founder_identities:
-- * Only Platform Super Admin can create/revoke/link Founder identities.
-- * College Admins can read linked records belonging to their own college and approve/revoke college_link_status only via RPC/backend.
-- * Linked student owner can read their own Founder credential (read-only).
DROP POLICY IF EXISTS qivora_founder_super_admin_all ON public.founder_identities;
CREATE POLICY qivora_founder_super_admin_all ON public.founder_identities
  FOR ALL USING (public.qivora_is_super_admin())
  WITH CHECK (public.qivora_is_super_admin());

DROP POLICY IF EXISTS qivora_founder_owner_select ON public.founder_identities;
CREATE POLICY qivora_founder_owner_select ON public.founder_identities
  FOR SELECT USING (
    profile_id = public.qivora_current_profile_id()
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = founder_identities.linked_student_id
        AND s.profile_id = public.qivora_current_profile_id()
    )
    OR (
      linked_organization_id IS NOT NULL
      AND public.qivora_has_org_role(linked_organization_id, ARRAY['college_admin', 'librarian'])
    )
  );

-- 2. Unified Public QR Verification RPC (Security Definer — exposes ONLY approved public fields)
CREATE OR REPLACE FUNCTION public.qivora_verify_qr_public(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qr record;
  v_founder record;
  v_card record;
  v_student record;
  v_org record;
  v_linked_founder record;
BEGIN
  SELECT * INTO v_qr FROM public.qr_tokens WHERE token = trim(p_token) LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('verified', false, 'reason', 'Invalid or unrecognized QR verification token.');
  END IF;

  IF NOT v_qr.is_active THEN
    RETURN jsonb_build_object(
      'verified', false,
      'entityType', v_qr.entity_type,
      'status', 'revoked',
      'reason', COALESCE(v_qr.revoked_reason, 'This credential QR has been revoked or superseded.')
    );
  END IF;

  IF v_qr.expires_at IS NOT NULL AND v_qr.expires_at < now() THEN
    RETURN jsonb_build_object('verified', false, 'entityType', v_qr.entity_type, 'status', 'expired', 'reason', 'This credential has expired.');
  END IF;

  IF v_qr.entity_type = 'founder_id' THEN
    SELECT * INTO v_founder FROM public.founder_identities WHERE id = v_qr.entity_id LIMIT 1;
    IF NOT FOUND OR v_founder.status <> 'active' THEN
      RETURN jsonb_build_object('verified', false, 'entityType', 'founder_id', 'reason', 'Founder credential is not active.');
    END IF;

    IF v_founder.college_link_status = 'approved' AND v_founder.linked_student_id IS NOT NULL THEN
      SELECT s.*, o.name AS org_name, o.code AS org_code, c.name AS course_name, sem.name AS semester_name, sess.name AS session_name
      INTO v_student
      FROM public.students s
      JOIN public.organizations o ON o.id = s.organization_id
      LEFT JOIN public.courses c ON c.id = s.course_id
      LEFT JOIN public.semesters sem ON sem.id = s.semester_id
      LEFT JOIN public.academic_sessions sess ON sess.id = s.academic_session_id
      WHERE s.id = v_founder.linked_student_id
      LIMIT 1;
    END IF;

    RETURN jsonb_build_object(
      'verified', true,
      'entityType', 'founder_id',
      'status', v_founder.status,
      'credential', jsonb_build_object(
        'founderNumber', v_founder.founder_number,
        'fullName', v_founder.full_name,
        'designation', v_founder.designation,
        'organizationLabel', v_founder.organization_label,
        'editionName', v_founder.edition_name,
        'issuedAt', v_founder.issued_at,
        'collegeLinkStatus', v_founder.college_link_status,
        'linkedCollege', CASE WHEN v_student.id IS NOT NULL THEN jsonb_build_object(
          'collegeName', v_student.org_name,
          'collegeCode', v_student.org_code,
          'studentIdCode', v_student.student_id_code,
          'collegeRollNumber', v_student.college_roll_number,
          'courseName', v_student.course_name,
          'semesterName', v_student.semester_name,
          'sessionName', v_student.session_name,
          'membershipStatus', v_student.status
        ) ELSE NULL END
      )
    );
  END IF;

  -- Official Student Digital ID Verification
  SELECT * INTO v_card FROM public.student_digital_ids WHERE id = v_qr.entity_id LIMIT 1;
  IF NOT FOUND OR v_card.status <> 'active' OR v_card.expires_at < now() THEN
    RETURN jsonb_build_object('verified', false, 'entityType', 'student_id', 'reason', 'Digital ID card is expired, suspended, or revoked.');
  END IF;

  SELECT s.*, o.name AS org_name, c.name AS course_name, sem.name AS semester_name, sess.name AS session_name
  INTO v_student
  FROM public.students s
  JOIN public.organizations o ON o.id = s.organization_id
  LEFT JOIN public.courses c ON c.id = s.course_id
  LEFT JOIN public.semesters sem ON sem.id = s.semester_id
  LEFT JOIN public.academic_sessions sess ON sess.id = s.academic_session_id
  WHERE s.id = v_card.student_id
  LIMIT 1;

  IF NOT FOUND OR v_student.status <> 'active' THEN
    RETURN jsonb_build_object('verified', false, 'entityType', 'student_id', 'reason', 'Student membership is not active.');
  END IF;

  SELECT * INTO v_linked_founder
  FROM public.founder_identities
  WHERE linked_student_id = v_student.id
    AND linked_organization_id = v_student.organization_id
    AND status = 'active'
    AND college_link_status = 'approved'
  LIMIT 1;

  RETURN jsonb_build_object(
    'verified', true,
    'entityType', 'student_id',
    'status', 'active',
    'credential', jsonb_build_object(
      'cardNumber', v_card.card_number,
      'studentName', v_student.full_name,
      'studentIdCode', v_student.student_id_code,
      'collegeRollNumber', v_student.college_roll_number,
      'collegeName', v_student.org_name,
      'courseName', v_student.course_name,
      'semesterName', v_student.semester_name,
      'sessionName', v_student.session_name,
      'expiresAt', v_card.expires_at,
      'founderBadge', CASE WHEN v_linked_founder.id IS NOT NULL THEN jsonb_build_object(
        'founderNumber', v_linked_founder.founder_number,
        'designation', v_linked_founder.designation,
        'editionName', v_linked_founder.edition_name,
        'organizationLabel', v_linked_founder.organization_label
      ) ELSE NULL END
    )
  );
END;
$$;

-- 3. Atomic Book Issue Function (prevents race conditions, duplicate active title loans, overdue/fine/limit bypasses)
CREATE OR REPLACE FUNCTION public.qivora_issue_book(
  p_org_id uuid,
  p_student_id uuid,
  p_copy_id uuid,
  p_actor_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student record;
  v_copy record;
  v_settings record;
  v_active_loans integer;
  v_overdue_loans integer;
  v_duplicate_title integer;
  v_unpaid_fine numeric;
  v_due_at timestamptz;
  v_receipt text;
  v_loan_id uuid;
BEGIN
  -- Lock student and verify active membership inside org
  SELECT * INTO v_student FROM public.students
  WHERE id = p_student_id AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND OR v_student.status <> 'active' THEN
    RAISE EXCEPTION 'Student is not an active member of this institution.';
  END IF;

  -- Verify non-expired active Digital ID card if issued
  IF EXISTS (
    SELECT 1 FROM public.student_digital_ids
    WHERE student_id = p_student_id AND organization_id = p_org_id AND status = 'active' AND expires_at < now()
  ) THEN
    RAISE EXCEPTION 'Student Digital ID card has expired.';
  END IF;

  -- Lock physical copy row atomically
  SELECT * INTO v_copy FROM public.book_copies
  WHERE id = p_copy_id AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND OR v_copy.status NOT IN ('available', 'reserved') THEN
    RAISE EXCEPTION 'Selected physical book copy is unavailable (status: %).', COALESCE(v_copy.status, 'missing');
  END IF;

  -- Load library circulation policy
  SELECT * INTO v_settings FROM public.library_settings WHERE organization_id = p_org_id LIMIT 1;

  -- Count active loans, overdue loans, and duplicate title loans
  SELECT
    count(*) FILTER (WHERE status IN ('issued', 'overdue')),
    count(*) FILTER (WHERE status IN ('issued', 'overdue') AND due_at < now()),
    count(*) FILTER (WHERE status IN ('issued', 'overdue') AND book_id = v_copy.book_id)
  INTO v_active_loans, v_overdue_loans, v_duplicate_title
  FROM public.loans
  WHERE organization_id = p_org_id AND student_id = p_student_id;

  IF v_duplicate_title > 0 THEN
    RAISE EXCEPTION 'Student already holds an active loan for this book title.';
  END IF;

  IF v_overdue_loans > 0 THEN
    RAISE EXCEPTION 'Issuance blocked: student has % overdue book(s).', v_overdue_loans;
  END IF;

  IF v_active_loans >= COALESCE(v_settings.default_max_books, 4) THEN
    RAISE EXCEPTION 'Borrowing limit reached (% / % books).', v_active_loans, COALESCE(v_settings.default_max_books, 4);
  END IF;

  SELECT COALESCE(SUM(GREATEST(0, amount - paid_amount - waived_amount)), 0)
  INTO v_unpaid_fine
  FROM public.fines
  WHERE organization_id = p_org_id AND student_id = p_student_id AND status IN ('unpaid', 'partial');

  IF v_unpaid_fine >= COALESCE(v_settings.block_borrowing_fine_threshold, 100) THEN
    RAISE EXCEPTION 'Issuance blocked: unpaid fine balance exceeds library threshold.';
  END IF;

  v_due_at := now() + make_interval(days => COALESCE(v_settings.default_loan_days, 14));
  v_receipt := 'ISS-' || to_char(now(), 'YYYYMMDD') || '-' || substr(md5(random()::text), 1, 6);

  UPDATE public.book_copies
  SET status = 'issued', updated_at = now()
  WHERE id = p_copy_id AND organization_id = p_org_id;

  INSERT INTO public.loans (
    organization_id, student_id, book_id, book_copy_id, issued_by_profile_id,
    receipt_number, issued_at, due_at, status
  )
  VALUES (
    p_org_id, p_student_id, v_copy.book_id, p_copy_id, p_actor_profile_id,
    upper(v_receipt), now(), v_due_at, 'issued'
  )
  RETURNING id INTO v_loan_id;

  RETURN jsonb_build_object(
    'loanId', v_loan_id,
    'receiptNumber', upper(v_receipt),
    'dueAt', v_due_at
  );
END;
$$;
