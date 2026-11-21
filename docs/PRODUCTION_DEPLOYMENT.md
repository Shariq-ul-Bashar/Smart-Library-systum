# QIVORA — Production Deployment, Operations & Backup Guide

**Product:** QIVORA — Smart Library Management System  
**Tagline:** *Intelligence for Every Library.*

---

## 1. Pre-Deployment Checklist

1. **Environment Variables**: Copy `.env.example` and configure all required secrets in your hosting platform (AI Studio Secrets / Cloud Run / Render / Railway / Fly.io):
   - `APP_URL`: Public HTTPS origin (e.g., `https://library.yourcollege.edu`).
   - `SESSION_SECRET`: Strong 32+ byte random string (`openssl rand -hex 32`).
   - PostgreSQL connection (`SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DB_NAME`) OR Supabase credentials (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
   - Optional integrations (`SMTP_*`, `VAPID_*`, `WHATSAPP_*`) — leave blank if unused; QIVORA will honestly report them as not configured.
2. **Database Schema & Migrations**:
   - Ensure PostgreSQL schema is synchronized (`drizzle-kit push` or `supabase/migrations/0001..0003`).
3. **Build Verification**:
   ```bash
   npm ci
   npm run lint
   npm run build
   ```
4. **Production Start Command**:
   ```bash
   NODE_ENV=production npm start
   ```
   (`server.ts` serves the compiled Vite SPA from `dist/` and mounts all `/api/*` endpoints on port `3000`.)

---

## 2. Role & First-College Onboarding Procedure

1. Sign in as **Platform Super Admin** (configured via `SUPER_ADMIN_EMAILS` or initial admin account).
2. Create the first institution under **Organizations** (`/platform/organizations`).
3. Assign a **College Admin** under **College Admins** (`/platform/college-admins`).
4. Have the College Admin configure **College Branding** (`/org/branding`), **Library Settings** (`/org/settings`), academic courses/semesters, and Digital ID template assignments (`/org/id-assignments`).
5. *(Optional)* Issue a **QIVORA — Golden Founder Edition** credential under `/platform/founder-ids`, link it to your College Student record, and confirm College Admin approval in `/org/students`.

---

## 3. Backup, Recovery & Audit Maintenance

- **Automated Daily Backups**: Enable daily Point-in-Time Recovery (PITR) on Cloud SQL / Supabase PostgreSQL with at least 14–30 days retention.
- **Logical Export Snapshot**:
  ```bash
  pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" -f qivora-backup-$(date +%F).dump
  ```
- **Disaster Recovery Drill**: Restore snapshot to a staging database and verify `/api/health`, student count, active loans, and QR verification before cutover:
  ```bash
  pg_restore --clean --if-exists --no-owner --dbname="$STAGING_DATABASE_URL" qivora-backup-YYYY-MM-DD.dump
  ```
- **Audit Trail Retention**: `audit_logs` records all administrative, circulation, fine waiver, and Founder link actions immutably. Archive periodically to cold object storage per institutional compliance policy.

---

## 4. Health & Monitoring Endpoints

- `GET /api/health` — Lightweight public liveness & PostgreSQL ping endpoint (for load balancers / Cloud Run health checks).
- `GET /api/platform/health` — Authenticated Super Admin diagnostic view showing PostgreSQL latency, entity totals, Supabase client/server readiness, and integration credential status.

---

*Designed & Developed by MOHAMMAD SHARIQ · BCA 1st Year | 2026–2027 Batch*
