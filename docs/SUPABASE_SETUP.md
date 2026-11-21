# QIVORA — Supabase Setup & Integration Guide

QIVORA includes official `@supabase/supabase-js` integration (`src/lib/supabase.ts` for frontend, `src/server/supabase-admin.ts` for backend JWT verification and admin operations), complete PostgreSQL Row-Level Security migrations, and Supabase Edge Functions.

> **Honest Configuration Policy**: QIVORA never simulates or fakes a Supabase connection. Until real Supabase environment variables are supplied, System Health and Integrations Hub accurately display **Not Configured**.

---

## 1. Required Environment Variables

Add the following credentials in **AI Studio Secrets** or your hosting provider's environment settings (never commit real keys into git):

| Variable | Scope | Required | Description |
| :--- | :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | Frontend & Server | Yes | Your Supabase project URL (`https://<project-ref>.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Frontend | Yes* | Supabase public `anon` key (*or provide `VITE_SUPABASE_PUBLISHABLE_KEY`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend | Optional | Alternative modern Supabase publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server Only** | Recommended | Privileged service role key — **NEVER** prefix with `VITE_` or expose in browser code |

---

## 2. Database Migrations & RLS Policies

Run the SQL migrations in order using the Supabase SQL Editor or Supabase CLI (`supabase db push`):

1. `src/db/schema.ts` (apply base tables via `drizzle-kit push` or SQL export).
2. `supabase/migrations/0001_qivora_rls_and_storage.sql` — enables RLS across all tenant-scoped tables, defines `qivora_current_profile_id()`, `qivora_is_super_admin()`, and `qivora_has_org_role()`, and creates Storage buckets (`college-logos`, `book-covers`, `student-photos`, `student-documents`, `id-backgrounds`).
3. `supabase/migrations/0002_qivora_part2_advanced.sql` — adds Part 2 enterprise analytics, automation, migration, and notification tables.
4. `supabase/migrations/0003_qivora_founder_college_link_and_transactions.sql` — adds Linked Founder Identity columns (`linked_organization_id`, `linked_student_id`, `college_link_status`), strict Founder RLS policies, unified public QR RPC (`qivora_verify_qr_public`), and atomic book issue RPC (`qivora_issue_book`).

---

## 3. Supabase Edge Functions

Two production Edge Functions are included in `supabase/functions/`:

- **`verify-qr`** (`supabase/functions/verify-qr/index.ts`): Public QR verification endpoint calling `qivora_verify_qr_public` (exposes only approved public fields for Student Digital IDs and Linked Golden Founder IDs).
- **`automation-runner`** (`supabase/functions/automation-runner/index.ts`): Scheduled cron worker that transitions overdue loans and expires uncollected pickup reservations.

Deploy with the Supabase CLI:
```bash
supabase functions deploy verify-qr --no-verify-jwt
supabase functions deploy automation-runner
```

---

## 4. Verifying Your Live Supabase Connection

1. Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in Secrets.
2. Restart the server (`npm run dev` or redeploy).
3. Sign in as **Platform Super Admin** and navigate to **System Health & Database Diagnostics** (`/platform/health`).
4. Click **Test Supabase Connection** to execute a live network probe and verify latency.
5. On `/login`, the **Sign In via Supabase Auth** option automatically activates once `VITE_SUPABASE_URL` and an anon/publishable key are detected.

---

*Designed & Developed by MOHAMMAD SHARIQ · BCA 1st Year | 2026–2027 Batch*
