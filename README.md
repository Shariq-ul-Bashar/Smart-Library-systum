# QIVORA — Smart Library Management System

**Tagline:** *Intelligence for Every Library.*

QIVORA is a multi-tenant, commercial-grade Institutional Library Management SaaS built for colleges and universities. All four role workspaces — **Platform Super Admin**, **College Admin**, **Librarian**, and **Student** — operate inside one unified, tenant-isolated application with Light and Dark theme support.

---

## Core Capabilities

- **Multi-Tenant Governance**: Strict per-institution data isolation (`organization_id` scoping enforced server-side and in PostgreSQL RLS policies).
- **Unified Linked Founder Identity**: Exclusive Black & Gold **QIVORA — Golden Founder Edition** credentials can be securely linked to an official College Student membership (zero duplicate student accounts, zero duplicate borrowing histories). Scanning the Founder QR works at public verification (`/verify/:token`), Circulation Desk, and Attendance Gate while strictly enforcing all college borrowing limits, overdue blocks, and fine rules.
- **Copy-Level Catalog & Atomic Circulation**: Master book catalog + individual barcoded physical copies, ISBN lookup, barcode PDF label sheets, atomic issue/return/renewal locking, duplicate-title prevention, automatic overdue fine computation, reservations queue, and instant PDF receipts.
- **Official Digital ID Studio**: 9 institutional starter templates, course/semester assignment priority rules, custom branding, PDF/print export, and public QR verification.
- **Attendance Gate, Analytics & Automation**: QR/manual reading-room entry/exit tracking, enterprise analytics with CSV/Excel/PDF exports, smart automation jobs, and CSV data migration center.
- **Real PostgreSQL + Official Supabase SDK**: Runs live against PostgreSQL (`drizzle-orm`) with official `@supabase/supabase-js` client & server-side JWT verification ready for Supabase Cloud.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, TanStack Query, React Router, Lucide Icons, jsPDF, html5-qrcode.
- **Backend**: Express + TypeScript (`server.ts`), Drizzle ORM, PostgreSQL.
- **Supabase Integration**: Official `@supabase/supabase-js` (`src/lib/supabase.ts`, `src/server/supabase-admin.ts`), SQL RLS migrations (`supabase/migrations/`), and Edge Functions (`supabase/functions/`).

---

## Documentation

- [Supabase Setup Guide](docs/SUPABASE_SETUP.md)
- [Production Deployment & Backup Guide](docs/PRODUCTION_DEPLOYMENT.md)
- [Security & Multi-Tenant Audit Report](docs/SECURITY_AUDIT.md)
- [Environment Configuration Template](.env.example)

---

## Credits

**Designed & Developed by MOHAMMAD SHARIQ**  
**BCA 1st Year | 2026–2027 Batch**
