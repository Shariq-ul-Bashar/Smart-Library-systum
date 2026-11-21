# QIVORA — Security & Multi-Tenant Audit Report

**Product:** QIVORA — Smart Library Management System  
**Audit Scope:** Authentication, Multi-Tenant Isolation, Linked Founder Identity Governance, Library Transaction Integrity, Secret Hygiene, and Public QR Privacy.

---

## 1. Multi-Tenant Data Isolation
- Every institutional API route under `/api/org/*` and `/api/student/*` resolves the active `organizationId` exclusively from server-verified `organization_memberships` records via `requireOrgMember(...)` in `src/server/auth.ts`.
- Request headers (`X-Organization-Id`) are validated against the authenticated user's active memberships — untrusted headers cannot access another college's tenant data.
- PostgreSQL Row-Level Security (`supabase/migrations/0001_qivora_rls_and_storage.sql`) mirrors all role & tenant boundaries directly at the database layer.

## 2. Linked Founder ID Security Boundaries
- **Zero Privilege Escalation**: Holding a Golden Founder ID never grants Platform Super Admin, College Admin, or Librarian permissions. Permissions come strictly from `profiles.is_super_admin` and `organization_memberships`.
- **Dual Governance**:
  - Only **Platform Super Admin** can issue, revoke, rotate QR tokens, or link/unlink a Founder ID (`POST /api/platform/founder-ids`, `PATCH /api/platform/founder-ids/:id/link-student`).
  - **College Admin** can approve or revoke the college library link for a student inside their own college (`PATCH /api/org/students/:id/founder-link`).
- **Zero Rule Bypass**: When a linked Founder ID QR is scanned at `/api/org/circulation/resolve-student`, `/api/org/circulation/issue`, or `/api/org/attendance/scan`, the backend resolves the real linked `students` record and strictly enforces:
  - Tenant boundary (`founder.linkedOrganizationId === activeOrgId`)
  - Explicit approval (`founder.collegeLinkStatus === 'approved'`)
  - Active Founder ID & active Student membership
  - Non-expired official Student Digital ID card
  - Maximum active book borrowing limit
  - Overdue book hold block
  - Unpaid fine threshold block
  - Duplicate active loan prevention for the same book title

## 3. Public QR Verification Privacy
- Public `GET /api/verify/qr/:token` and `qivora_verify_qr_public()` strictly return ONLY approved public verification fields (name, college name, student ID, roll number, course/semester/session, membership status, Founder designation/number).
- Private fields (email, phone, residential address, date of birth, fine balances, loan history, ID proof documents) are NEVER returned on public endpoints.
- Revoked, suspended, or expired credentials immediately fail verification.

## 4. Secret & Credential Hygiene
- `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, SMTP passwords, and SQL credentials are read exclusively on the Node.js server (`src/server/*`) and never bundled into frontend Vite assets.
- Institutional passwords are hashed using salted `scrypt` (`crypto.scryptSync`) with constant-time comparison (`crypto.timingSafeEqual`).
- No hardcoded API keys or credentials exist in client or server code.

## 5. Atomic Circulation & Transaction Integrity
- Physical copy status transitions (`available` → `issued`) execute inside PostgreSQL transactions using conditional atomic `UPDATE ... WHERE status IN ('available', 'reserved')` guards, eliminating concurrent double-issue race conditions.
- Returning a book atomically updates loan return timestamp, copy condition/status, overdue fine calculation, and reservation queue notification.

---

*Designed & Developed by MOHAMMAD SHARIQ · BCA 1st Year | 2026–2027 Batch*
