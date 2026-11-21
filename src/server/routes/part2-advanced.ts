import { Router } from 'express';
import { and, desc, eq, gte, inArray, lt, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  attendance,
  authors,
  automationJobs,
  automationLogs,
  bookCopies,
  books,
  categories,
  courses,
  fines,
  founderIdentities,
  founderNominations,
  idCards,
  integrationConfigs,
  loans,
  migrationRuns,
  notificationDeliveries,
  notificationPreferences,
  notificationTemplates,
  notifications,
  organizationMembers,
  organizations,
  payments,
  profiles,
  publishers,
  qrTokens,
  reservations,
  semesters,
  shelves,
  studentApplications,
  students,
} from '../../db/schema.ts';
import { getIsbnLookupCandidates, normalizeIsbn } from '../../shared/isbn.ts';
import {
  type AuthRequest,
  createNotification,
  generateSecureToken,
  logAudit,
  requireAuth,
  requireOrgRole,
  requireSuperAdmin,
} from '../auth.ts';

export const part2AdvancedRouter = Router();

// ============================================================================
// 1. SMART AUTOMATION ENGINE (10 Idempotent Jobs per Organization)
// ============================================================================

const DEFAULT_AUTOMATION_JOBS = [
  {
    jobKey: 'due_reminders',
    name: 'Upcoming Book Due Reminders',
    description: 'Notify students whose active loans are due within the next 48 hours.',
    scheduleCron: '0 8 * * *',
    config: { leadHours: 48 },
  },
  {
    jobKey: 'overdue_alerts',
    name: 'Overdue Book Notifications',
    description: 'Flag overdue loans and send automated overdue alerts to students.',
    scheduleCron: '0 9 * * *',
    config: { escalateDays: 7 },
  },
  {
    jobKey: 'id_expiry_alerts',
    name: 'Student ID Expiry Alerts',
    description: 'Warn students whose Digital Library ID expires within the next 30 days.',
    scheduleCron: '0 7 * * 1',
    config: { leadDays: 30 },
  },
  {
    jobKey: 'auto_id_expiry',
    name: 'Automatic Membership & ID Expiry',
    description: 'Automatically transition past-expiry Digital ID cards to expired status.',
    scheduleCron: '30 0 * * *',
    config: { revokeQrOnExpire: true },
  },
  {
    jobKey: 'reservation_alerts',
    name: 'Reservation Hold Expiry & Pickup Alerts',
    description: 'Expire uncollected ready reservations past their hold deadline and alert queued readers.',
    scheduleCron: '0 * * * *',
    config: {},
  },
  {
    jobKey: 'session_rollover',
    name: 'Academic Session Rollover Reminder',
    description: 'Remind College Admins to review academic sessions and student promotions.',
    scheduleCron: '0 9 1 5,11 *',
    config: {},
  },
  {
    jobKey: 'pending_apps',
    name: 'Pending Student Application Reminders',
    description: 'Alert library staff when student registration applications remain pending > 48 hours.',
    scheduleCron: '0 10 * * *',
    config: { staleHours: 48 },
  },
  {
    jobKey: 'scheduled_reports',
    name: 'Scheduled Operational Digest',
    description: 'Generate periodic circulation and inventory snapshot summary for institution admins.',
    scheduleCron: '0 18 * * 5',
    config: { cadence: 'weekly' },
  },
  {
    jobKey: 'inventory_verification',
    name: 'Low-Stock & Inventory Verification Reminder',
    description: 'Identify titles with zero or critically low available copies for staff verification.',
    scheduleCron: '0 9 * * 3',
    config: { threshold: 1 },
  },
  {
    jobKey: 'retry_notifications',
    name: 'Failed Notification Delivery Retry',
    description: 'Re-check failed external deliveries and log retry eligibility when providers are configured.',
    scheduleCron: '*/30 * * * *',
    config: { maxRetries: 3 },
  },
];

async function ensureOrgAutomationJobs(orgId: string) {
  for (const job of DEFAULT_AUTOMATION_JOBS) {
    await db
      .insert(automationJobs)
      .values({
        organizationId: orgId,
        jobKey: job.jobKey,
        name: job.name,
        description: job.description,
        scheduleCron: job.scheduleCron,
        config: job.config,
        isEnabled: true,
      })
      .onConflictDoNothing({ target: [automationJobs.organizationId, automationJobs.jobKey] });
  }
}

part2AdvancedRouter.get(
  '/org/automations',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      await ensureOrgAutomationJobs(orgId);
      const [jobs, logs] = await Promise.all([
        db
          .select()
          .from(automationJobs)
          .where(eq(automationJobs.organizationId, orgId))
          .orderBy(automationJobs.name),
        db
          .select()
          .from(automationLogs)
          .where(eq(automationLogs.organizationId, orgId))
          .orderBy(desc(automationLogs.executedAt))
          .limit(50),
      ]);
      res.json({ jobs, logs });
    } catch (error) {
      console.error('Load automations failed:', error);
      res.status(500).json({ error: 'Unable to load automation rules.' });
    }
  }
);

part2AdvancedRouter.patch(
  '/org/automations/:id',
  requireAuth,
  requireOrgRole(['college_admin']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        isEnabled: z.boolean().optional(),
        scheduleCron: z.string().min(5).max(60).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid automation configuration.' });

      const [updated] = await db
        .update(automationJobs)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(and(eq(automationJobs.id, req.params.id), eq(automationJobs.organizationId, req.orgId!)))
        .returning();

      if (!updated) return res.status(404).json({ error: 'Automation rule not found.' });
      res.json({ job: updated });
    } catch (error) {
      console.error('Update automation failed:', error);
      res.status(500).json({ error: 'Unable to update automation rule.' });
    }
  }
);

part2AdvancedRouter.post(
  '/org/automations/:id/run',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const [job] = await db
        .select()
        .from(automationJobs)
        .where(and(eq(automationJobs.id, req.params.id), eq(automationJobs.organizationId, orgId)))
        .limit(1);

      if (!job) return res.status(404).json({ error: 'Automation rule not found.' });

      // Idempotency key scoped by org + job + date-hour slot (or force override for explicit manual run)
      const now = new Date();
      const slot = `${now.toISOString().slice(0, 13)}:${Math.floor(now.getMinutes() / 5)}`;
      const idempotencyKey = `${orgId}:${job.jobKey}:${slot}:${req.body?.force ? Date.now() : 'slot'}`;

      const existingRun = await db
        .select()
        .from(automationLogs)
        .where(eq(automationLogs.idempotencyKey, idempotencyKey))
        .limit(1);

      if (existingRun.length > 0) {
        return res.json({
          skippedDuplicate: true,
          log: existingRun[0],
          message: 'Idempotent check: this automation already ran in the current 5-minute window.',
        });
      }

      let processedCount = 0;
      let notificationsSent = 0;
      let summary = '';

      if (job.jobKey === 'due_reminders') {
        const soon = new Date(now.getTime() + 48 * 3600 * 1000);
        const upcoming = await db
          .select({
            loanId: loans.id,
            dueAt: loans.dueAt,
            bookTitle: books.title,
            profileId: students.profileId,
          })
          .from(loans)
          .innerJoin(books, eq(loans.bookId, books.id))
          .innerJoin(students, eq(loans.studentId, students.id))
          .where(
            and(
              eq(loans.organizationId, orgId),
              eq(loans.status, 'active'),
              gte(loans.dueAt, now),
              lte(loans.dueAt, soon)
            )
          );
        processedCount = upcoming.length;
        for (const item of upcoming) {
          if (item.profileId) {
            await createNotification({
              organizationId: orgId,
              recipientProfileId: item.profileId,
              type: 'due_reminder',
              title: 'Book Due Within 48 Hours',
              message: `"${item.bookTitle}" is due on ${new Date(item.dueAt).toLocaleDateString()}. Return or renew on time to avoid overdue fines.`,
              entityType: 'loan',
              entityId: item.loanId,
            });
            notificationsSent++;
          }
        }
        summary = `Scanned active loans; sent ${notificationsSent} upcoming due reminder(s).`;
      } else if (job.jobKey === 'overdue_alerts') {
        const overdue = await db
          .select({
            loanId: loans.id,
            dueAt: loans.dueAt,
            bookTitle: books.title,
            profileId: students.profileId,
          })
          .from(loans)
          .innerJoin(books, eq(loans.bookId, books.id))
          .innerJoin(students, eq(loans.studentId, students.id))
          .where(
            and(
              eq(loans.organizationId, orgId),
              or(eq(loans.status, 'active'), eq(loans.status, 'overdue')),
              lt(loans.dueAt, now)
            )
          );
        processedCount = overdue.length;
        for (const item of overdue) {
          await db
            .update(loans)
            .set({ status: 'overdue', updatedAt: new Date() })
            .where(eq(loans.id, item.loanId));
          if (item.profileId) {
            await createNotification({
              organizationId: orgId,
              recipientProfileId: item.profileId,
              type: 'overdue',
              title: 'Overdue Book Notice',
              message: `"${item.bookTitle}" was due on ${new Date(item.dueAt).toLocaleDateString()}. Please return it promptly at the library desk.`,
              entityType: 'loan',
              entityId: item.loanId,
            });
            notificationsSent++;
          }
        }
        summary = `Marked ${processedCount} loan(s) overdue and sent ${notificationsSent} student alert(s).`;
      } else if (job.jobKey === 'id_expiry_alerts') {
        const leadDate = new Date(now.getTime() + 30 * 86400 * 1000);
        const expiring = await db
          .select({
            cardId: idCards.id,
            cardNumber: idCards.cardNumber,
            expiresAt: idCards.expiresAt,
            profileId: students.profileId,
          })
          .from(idCards)
          .innerJoin(students, eq(idCards.studentId, students.id))
          .where(
            and(
              eq(idCards.organizationId, orgId),
              eq(idCards.status, 'active'),
              gte(idCards.expiresAt, now),
              lte(idCards.expiresAt, leadDate)
            )
          );
        processedCount = expiring.length;
        for (const c of expiring) {
          if (c.profileId) {
            await createNotification({
              organizationId: orgId,
              recipientProfileId: c.profileId,
              type: 'id_status',
              title: 'Digital Library ID Expiring Soon',
              message: `Your Digital ID (${c.cardNumber}) expires on ${new Date(c.expiresAt).toLocaleDateString()}. Contact your library office for renewal.`,
              entityType: 'id_card',
              entityId: c.cardId,
            });
            notificationsSent++;
          }
        }
        summary = `Identified ${processedCount} expiring Digital ID(s); sent ${notificationsSent} reminder(s).`;
      } else if (job.jobKey === 'auto_id_expiry') {
        const expired = await db
          .update(idCards)
          .set({ status: 'expired', statusReason: 'Automated expiry past validity date', updatedAt: new Date() })
          .where(
            and(
              eq(idCards.organizationId, orgId),
              eq(idCards.status, 'active'),
              lt(idCards.expiresAt, now)
            )
          )
          .returning();
        processedCount = expired.length;
        for (const c of expired) {
          await db
            .update(qrTokens)
            .set({ isActive: false, revokedAt: new Date() })
            .where(and(eq(qrTokens.entityType, 'student_id'), eq(qrTokens.entityId, c.id)));
        }
        summary = `Expired ${processedCount} past-due Digital ID card(s) and deactivated their QR tokens.`;
      } else if (job.jobKey === 'reservation_alerts') {
        const staleReady = await db
          .update(reservations)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(
            and(
              eq(reservations.organizationId, orgId),
              eq(reservations.status, 'ready'),
              lt(reservations.expiresAt, now)
            )
          )
          .returning();
        processedCount = staleReady.length;
        for (const r of staleReady) {
          if (r.assignedCopyId) {
            await db
              .update(bookCopies)
              .set({ status: 'available', updatedAt: new Date() })
              .where(and(eq(bookCopies.id, r.assignedCopyId), eq(bookCopies.status, 'reserved')));
          }
        }
        summary = `Expired ${processedCount} uncollected reservation hold(s) and released physical copies.`;
      } else if (job.jobKey === 'pending_apps') {
        const pending = await db
          .select({ id: studentApplications.id })
          .from(studentApplications)
          .where(and(eq(studentApplications.organizationId, orgId), eq(studentApplications.status, 'pending')));
        processedCount = pending.length;
        if (pending.length > 0 && req.profile) {
          await createNotification({
            organizationId: orgId,
            recipientProfileId: req.profile.id,
            type: 'registration',
            title: 'Pending Student Registration Review',
            message: `${pending.length} student application(s) are waiting for review in the Applications queue.`,
            entityType: 'student_application',
          });
          notificationsSent = 1;
        }
        summary = `Found ${processedCount} pending student application(s).`;
      } else if (job.jobKey === 'inventory_verification') {
        const activeBooks = await db
          .select({ id: books.id, title: books.title })
          .from(books)
          .where(and(eq(books.organizationId, orgId), eq(books.status, 'active')));
        const availCopies = await db
          .select({ bookId: bookCopies.bookId })
          .from(bookCopies)
          .where(and(eq(bookCopies.organizationId, orgId), eq(bookCopies.status, 'available')));
        const availMap = new Map<string, number>();
        for (const c of availCopies) availMap.set(c.bookId, (availMap.get(c.bookId) || 0) + 1);
        const lowStock = activeBooks.filter((b) => (availMap.get(b.id) || 0) <= 1);
        processedCount = lowStock.length;
        summary = `Scanned ${activeBooks.length} active titles; ${lowStock.length} title(s) have 1 or fewer available copies.`;
      } else if (job.jobKey === 'retry_notifications') {
        const failed = await db
          .select()
          .from(notificationDeliveries)
          .where(
            and(
              eq(notificationDeliveries.organizationId, orgId),
              eq(notificationDeliveries.status, 'failed')
            )
          );
        processedCount = failed.length;
        summary =
          processedCount === 0
            ? 'No failed deliveries pending retry.'
            : `Audited ${processedCount} failed delivery record(s); external provider credentials required to resend.`;
      } else {
        // session_rollover | scheduled_reports
        const [stuCount, loanCount] = await Promise.all([
          db.select({ id: students.id }).from(students).where(eq(students.organizationId, orgId)),
          db.select({ id: loans.id }).from(loans).where(eq(loans.organizationId, orgId)),
        ]);
        processedCount = stuCount.length + loanCount.length;
        if (req.profile) {
          await createNotification({
            organizationId: orgId,
            recipientProfileId: req.profile.id,
            type: 'announcement',
            title: job.name,
            message: `Snapshot complete: ${stuCount.length} students and ${loanCount.length} circulation records audited.`,
            entityType: 'automation',
          });
          notificationsSent = 1;
        }
        summary = `Completed ${job.name} (${stuCount.length} students, ${loanCount.length} loans reviewed).`;
      }

      const [log] = await db
        .insert(automationLogs)
        .values({
          organizationId: orgId,
          jobId: job.id,
          jobKey: job.jobKey,
          idempotencyKey,
          triggerSource: 'manual',
          status: 'success',
          processedCount,
          notificationsSent,
          summary,
          triggeredByProfileId: req.profile!.id,
        })
        .returning();

      await db
        .update(automationJobs)
        .set({
          lastRunAt: new Date(),
          lastStatus: 'success',
          lastSummary: summary,
          updatedAt: new Date(),
        })
        .where(eq(automationJobs.id, job.id));

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'automation_executed',
        entityType: 'automation_job',
        entityId: job.id,
        details: { jobKey: job.jobKey, processedCount, notificationsSent, summary },
      });

      res.json({ log, message: summary });
    } catch (error) {
      console.error('Run automation failed:', error);
      res.status(500).json({ error: 'Automation execution failed.' });
    }
  }
);

// ============================================================================
// 2. SMART MIGRATION CENTER (CSV/Excel Paper Register Digitization)
// ============================================================================

part2AdvancedRouter.get(
  '/org/migrations/history',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const runs = await db
        .select()
        .from(migrationRuns)
        .where(eq(migrationRuns.organizationId, req.orgId!))
        .orderBy(desc(migrationRuns.createdAt))
        .limit(40);
      res.json({ runs });
    } catch (error) {
      console.error('Load migration history failed:', error);
      res.status(500).json({ error: 'Unable to load migration history.' });
    }
  }
);

part2AdvancedRouter.post(
  '/org/migrations/validate',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        importType: z.enum(['students', 'books', 'inventory', 'fines']),
        rows: z.array(z.record(z.string(), z.unknown())).max(1000),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid migration payload (max 1,000 rows per batch).' });
      }
      const { importType, rows } = parsed.data;
      const orgId = req.orgId!;

      const validRows: Array<Record<string, unknown>> = [];
      const duplicateRows: Array<{ rowNumber: number; reason: string; data: Record<string, unknown> }> = [];
      const errorRows: Array<{ rowNumber: number; reason: string; data: Record<string, unknown> }> = [];

      if (importType === 'students') {
        const existing = await db
          .select({ roll: students.collegeRollNumber, email: students.email })
          .from(students)
          .where(eq(students.organizationId, orgId));
        const existingRolls = new Set(existing.map((e) => e.roll.toLowerCase()));
        const seenRolls = new Set<string>();

        rows.forEach((raw, idx) => {
          const rowNum = idx + 2;
          const fullName = String(raw.fullName || '').trim();
          const fatherName = String(raw.fatherName || '').trim() || 'Not Provided';
          const roll = String(raw.collegeRollNumber || '').trim();
          const email = String(raw.email || '').trim().toLowerCase();
          if (fullName.length < 2) {
            errorRows.push({ rowNumber: rowNum, reason: 'Missing or invalid student full name', data: raw });
            return;
          }
          if (!roll) {
            errorRows.push({ rowNumber: rowNum, reason: 'Missing college roll number', data: raw });
            return;
          }
          if (!email || !email.includes('@')) {
            errorRows.push({ rowNumber: rowNum, reason: 'Missing or invalid email address', data: raw });
            return;
          }
          if (existingRolls.has(roll.toLowerCase()) || seenRolls.has(roll.toLowerCase())) {
            duplicateRows.push({ rowNumber: rowNum, reason: `Duplicate college roll number "${roll}"`, data: raw });
            return;
          }
          seenRolls.add(roll.toLowerCase());
          validRows.push({
            fullName,
            fatherName,
            collegeRollNumber: roll,
            email,
            phone: String(raw.phone || '').trim() || null,
            address: String(raw.address || '').trim() || null,
          });
        });
      } else if (importType === 'books') {
        const existing = await db
          .select({ isbn: books.isbn })
          .from(books)
          .where(eq(books.organizationId, orgId));
        const existingIsbns = new Set(existing.map((b) => normalizeIsbn(b.isbn) || b.isbn.toLowerCase()));
        const seenIsbns = new Set<string>();

        rows.forEach((raw, idx) => {
          const rowNum = idx + 2;
          const title = String(raw.title || '').trim();
          const isbn = normalizeIsbn(String(raw.isbn || '')) || String(raw.isbn || '').trim().toUpperCase();
          const copies = Math.max(1, Math.min(100, Number(raw.copies || 1) || 1));
          if (title.length < 2) {
            errorRows.push({ rowNumber: rowNum, reason: 'Missing book title', data: raw });
            return;
          }
          if (isbn.length < 4) {
            errorRows.push({ rowNumber: rowNum, reason: 'Missing or short ISBN (min 4 chars)', data: raw });
            return;
          }
          if (existingIsbns.has(isbn) || seenIsbns.has(isbn)) {
            duplicateRows.push({ rowNumber: rowNum, reason: `ISBN "${isbn}" already exists`, data: raw });
            return;
          }
          seenIsbns.add(isbn);
          validRows.push({
            title,
            isbn,
            authorName: String(raw.authorName || '').trim() || null,
            publisherName: String(raw.publisherName || '').trim() || null,
            subject: String(raw.subject || '').trim() || null,
            edition: String(raw.edition || '').trim() || null,
            publicationYear: Number(raw.publicationYear) || null,
            copies,
          });
        });
      } else if (importType === 'inventory') {
        const [existingBooks, existingCopies] = await Promise.all([
          db.select({ id: books.id, isbn: books.isbn }).from(books).where(eq(books.organizationId, orgId)),
          db.select({ barcode: bookCopies.barcode }).from(bookCopies).where(eq(bookCopies.organizationId, orgId)),
        ]);
        const bookByIsbn = new Map<string, string>();
        for (const b of existingBooks) {
          for (const c of getIsbnLookupCandidates(b.isbn)) {
            bookByIsbn.set(c, b.id);
          }
          bookByIsbn.set(b.isbn.toLowerCase(), b.id);
        }
        const barcodeSet = new Set(existingCopies.map((c) => c.barcode.toLowerCase()));
        const seenBarcodes = new Set<string>();

        rows.forEach((raw, idx) => {
          const rowNum = idx + 2;
          const rawIsbn = String(raw.isbn || '').trim();
          const isbn = normalizeIsbn(rawIsbn) || rawIsbn;
          const barcode = String(raw.barcode || '').trim();
          const bookId = bookByIsbn.get(isbn) || bookByIsbn.get(rawIsbn.toLowerCase());
          if (!bookId) {
            errorRows.push({ rowNumber: rowNum, reason: `No catalog book matches ISBN "${rawIsbn}"`, data: raw });
            return;
          }
          if (!barcode) {
            errorRows.push({ rowNumber: rowNum, reason: 'Missing physical copy barcode', data: raw });
            return;
          }
          if (barcodeSet.has(barcode.toLowerCase()) || seenBarcodes.has(barcode.toLowerCase())) {
            duplicateRows.push({ rowNumber: rowNum, reason: `Barcode "${barcode}" already exists`, data: raw });
            return;
          }
          seenBarcodes.add(barcode.toLowerCase());
          validRows.push({
            bookId,
            isbn,
            barcode,
            accessionNumber: String(raw.accessionNumber || '').trim() || `ACC-${Date.now().toString().slice(-5)}-${idx}`,
            condition: ['new', 'good', 'fair', 'poor', 'damaged'].includes(String(raw.condition || '').toLowerCase())
              ? String(raw.condition).toLowerCase()
              : 'good',
          });
        });
      } else {
        // fines
        const existingStudents = await db
          .select({ id: students.id, roll: students.collegeRollNumber })
          .from(students)
          .where(eq(students.organizationId, orgId));
        const stuByRoll = new Map(existingStudents.map((s) => [s.roll.toLowerCase(), s.id]));
        rows.forEach((raw, idx) => {
          const rowNum = idx + 2;
          const roll = String(raw.collegeRollNumber || '').trim();
          const amount = Number(raw.amount);
          const reason = String(raw.reason || '').trim();
          const studentId = stuByRoll.get(roll.toLowerCase());
          if (!studentId) {
            errorRows.push({ rowNumber: rowNum, reason: `No student matches roll number "${roll}"`, data: raw });
            return;
          }
          if (!amount || amount <= 0) {
            errorRows.push({ rowNumber: rowNum, reason: 'Fine amount must be a positive number', data: raw });
            return;
          }
          if (reason.length < 3) {
            errorRows.push({ rowNumber: rowNum, reason: 'Missing fine reason', data: raw });
            return;
          }
          validRows.push({ studentId, collegeRollNumber: roll, amount, reason });
        });
      }

      res.json({
        totalRows: rows.length,
        validCount: validRows.length,
        duplicateCount: duplicateRows.length,
        errorCount: errorRows.length,
        validRows,
        duplicateRows,
        errorRows,
      });
    } catch (error) {
      console.error('Migration validation failed:', error);
      res.status(500).json({ error: 'Unable to validate import file.' });
    }
  }
);

part2AdvancedRouter.post(
  '/org/migrations/commit',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        importType: z.enum(['students', 'books', 'inventory', 'fines']),
        fileName: z.string().min(1),
        columnMapping: z.record(z.string(), z.string()).default({}),
        validRows: z.array(z.record(z.string(), z.unknown())).max(1000),
        duplicateCount: z.number().int().min(0).default(0),
        errorCount: z.number().int().min(0).default(0),
        errorSample: z.array(z.unknown()).max(50).default([]),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid migration commit payload.' });

      const { importType, fileName, columnMapping, validRows, duplicateCount, errorCount, errorSample } = parsed.data;
      const orgId = req.orgId!;

      let importedCount = 0;

      await db.transaction(async (tx) => {
        if (importType === 'students') {
          const [defaultCourse] = await tx.select().from(courses).where(eq(courses.organizationId, orgId)).limit(1);
          const [defaultSem] = defaultCourse
            ? await tx.select().from(semesters).where(eq(semesters.courseId, defaultCourse.id)).limit(1)
            : [];

          for (const row of validRows) {
            const studentIdCode = `QIV-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
            await tx.insert(students).values({
              organizationId: orgId,
              studentIdCode,
              fullName: String(row.fullName),
              fatherName: String(row.fatherName || 'Not Provided'),
              collegeRollNumber: String(row.collegeRollNumber),
              email: String(row.email).toLowerCase(),
              phone: row.phone ? String(row.phone) : 'Not Provided',
              address: row.address ? String(row.address) : null,
              courseId: defaultCourse?.id || null,
              semesterId: defaultSem?.id || null,
              status: 'active',
            });
            importedCount++;
          }
        } else if (importType === 'books') {
          const [defaultShelf] = await tx.select().from(shelves).where(eq(shelves.organizationId, orgId)).limit(1);
          for (const row of validRows) {
            let authorId: string | null = null;
            if (row.authorName) {
              const [a] = await tx
                .insert(authors)
                .values({ organizationId: orgId, name: String(row.authorName) })
                .returning();
              authorId = a.id;
            }
            let publisherId: string | null = null;
            if (row.publisherName) {
              const [p] = await tx
                .insert(publishers)
                .values({ organizationId: orgId, name: String(row.publisherName) })
                .returning();
              publisherId = p.id;
            }
            const [createdBook] = await tx
              .insert(books)
              .values({
                organizationId: orgId,
                isbn: normalizeIsbn(String(row.isbn)) || String(row.isbn).trim().toUpperCase(),
                title: String(row.title),
                authorId,
                publisherId,
                subject: row.subject ? String(row.subject) : null,
                edition: row.edition ? String(row.edition) : null,
                publicationYear: row.publicationYear ? Number(row.publicationYear) : null,
                defaultShelfId: defaultShelf?.id || null,
                status: 'active',
              })
              .returning();

            const copiesCount = Math.max(1, Math.min(50, Number(row.copies || 1)));
            const prefix = `MIG-${Date.now().toString().slice(-5)}-${importedCount}`;
            for (let i = 1; i <= copiesCount; i++) {
              const barcode = `${prefix}-${String(i).padStart(3, '0')}`;
              await tx.insert(bookCopies).values({
                organizationId: orgId,
                bookId: createdBook.id,
                barcode,
                accessionNumber: `ACC-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}-${i}`,
                qrCodeValue: barcode,
                shelfId: defaultShelf?.id || null,
                status: 'available',
                condition: 'good',
              });
            }
            importedCount++;
          }
        } else if (importType === 'inventory') {
          for (const row of validRows) {
            await tx.insert(bookCopies).values({
              organizationId: orgId,
              bookId: String(row.bookId),
              barcode: String(row.barcode),
              accessionNumber: String(row.accessionNumber),
              qrCodeValue: String(row.barcode),
              status: 'available',
              condition: String(row.condition || 'good'),
            });
            importedCount++;
          }
        } else if (importType === 'fines') {
          for (const row of validRows) {
            await tx.insert(fines).values({
              organizationId: orgId,
              studentId: String(row.studentId),
              amount: Number(row.amount).toFixed(2),
              reason: `[Imported] ${String(row.reason)}`,
              status: 'unpaid',
              createdByProfileId: req.profile!.id,
            });
            importedCount++;
          }
        }
      });

      const [run] = await db
        .insert(migrationRuns)
        .values({
          organizationId: orgId,
          importType,
          fileName,
          totalRows: validRows.length + duplicateCount + errorCount,
          importedRows: importedCount,
          duplicateRows: duplicateCount,
          errorRows: errorCount,
          status: errorCount > 0 ? 'partial' : 'completed',
          columnMapping,
          errorSample,
          performedByProfileId: req.profile!.id,
        })
        .returning();

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'migration_committed',
        entityType: 'migration_run',
        entityId: run.id,
        details: { importType, fileName, importedCount, duplicateCount, errorCount },
      });

      res.status(201).json({ run, importedCount });
    } catch (error) {
      console.error('Migration commit failed:', error);
      res.status(500).json({ error: 'Migration transaction failed and was rolled back safely.' });
    }
  }
);

// ============================================================================
// 3. ADVANCED NOTIFICATION CENTER (Inbox, Preferences, Templates, Broadcast)
// ============================================================================

part2AdvancedRouter.get(
  '/org/notifications/center',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian', 'student']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const profileId = req.profile!.id;

      const [items, prefsRow, templatesList, deliveries] = await Promise.all([
        db
          .select()
          .from(notifications)
          .where(eq(notifications.recipientProfileId, profileId))
          .orderBy(desc(notifications.createdAt))
          .limit(80),
        db
          .select()
          .from(notificationPreferences)
          .where(eq(notificationPreferences.profileId, profileId))
          .limit(1),
        req.orgRole === 'college_admin'
          ? db
              .select()
              .from(notificationTemplates)
              .where(eq(notificationTemplates.organizationId, orgId))
              .orderBy(notificationTemplates.eventKey)
          : Promise.resolve([]),
        req.orgRole !== 'student'
          ? db
              .select()
              .from(notificationDeliveries)
              .where(eq(notificationDeliveries.organizationId, orgId))
              .orderBy(desc(notificationDeliveries.createdAt))
              .limit(60)
          : Promise.resolve([]),
      ]);

      res.json({
        notifications: items,
        preferences: prefsRow[0] || {
          inAppEnabled: true,
          emailEnabled: false,
          pushEnabled: false,
          categories: {
            registration: true,
            id_status: true,
            circulation: true,
            due_reminders: true,
            overdue: true,
            reservations: true,
            fines: true,
            attendance: true,
            announcements: true,
          },
        },
        templates: templatesList,
        deliveries,
        providers: {
          smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
          webPushConfigured: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
          whatsappConfigured: Boolean(process.env.WHATSAPP_API_TOKEN),
        },
      });
    } catch (error) {
      console.error('Load notification center failed:', error);
      res.status(500).json({ error: 'Unable to load notification center.' });
    }
  }
);

part2AdvancedRouter.put('/org/notifications/preferences', requireAuth, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      inAppEnabled: z.boolean(),
      emailEnabled: z.boolean(),
      pushEnabled: z.boolean(),
      categories: z.record(z.string(), z.boolean()),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid preferences.' });

    const [saved] = await db
      .insert(notificationPreferences)
      .values({
        profileId: req.profile!.id,
        ...parsed.data,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: notificationPreferences.profileId,
        set: { ...parsed.data, updatedAt: new Date() },
      })
      .returning();

    res.json({ preferences: saved });
  } catch (error) {
    console.error('Save notification preferences failed:', error);
    res.status(500).json({ error: 'Unable to save preferences.' });
  }
});

part2AdvancedRouter.patch(
  '/org/notifications/templates/:id',
  requireAuth,
  requireOrgRole(['college_admin']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        subject: z.string().min(2).optional(),
        bodyTemplate: z.string().min(5).optional(),
        isEnabled: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid template update.' });

      const [updated] = await db
        .update(notificationTemplates)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(
          and(
            eq(notificationTemplates.id, req.params.id),
            eq(notificationTemplates.organizationId, req.orgId!)
          )
        )
        .returning();
      if (!updated) return res.status(404).json({ error: 'Notification template not found.' });
      res.json({ template: updated });
    } catch (error) {
      console.error('Update notification template failed:', error);
      res.status(500).json({ error: 'Unable to update template.' });
    }
  }
);

part2AdvancedRouter.post(
  '/org/notifications/announce',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        title: z.string().min(3).max(140),
        message: z.string().min(5).max(1000),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Title and message are required.' });

      const orgId = req.orgId!;
      const members = await db
        .select({ profileId: organizationMembers.profileId, email: profiles.email })
        .from(organizationMembers)
        .innerJoin(profiles, eq(organizationMembers.profileId, profiles.id))
        .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.status, 'active')));

      const uniqueRecipients = new Map(members.map((m) => [m.profileId, m.email]));
      let delivered = 0;

      for (const [profileId, email] of uniqueRecipients.entries()) {
        const [notif] = await db
          .insert(notifications)
          .values({
            organizationId: orgId,
            recipientProfileId: profileId,
            type: 'announcement',
            title: parsed.data.title.trim(),
            message: parsed.data.message.trim(),
            entityType: 'organization',
            entityId: orgId,
          })
          .returning();

        await db.insert(notificationDeliveries).values({
          organizationId: orgId,
          notificationId: notif.id,
          recipientEmail: email,
          channel: 'in_app',
          status: 'delivered',
          providerResponse: 'In-app inbox stored',
        });
        delivered++;
      }

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'announcement_broadcast',
        entityType: 'notification',
        details: { title: parsed.data.title, recipientCount: delivered },
      });

      res.status(201).json({ delivered, message: `Announcement delivered in-app to ${delivered} active member(s).` });
    } catch (error) {
      console.error('Broadcast announcement failed:', error);
      res.status(500).json({ error: 'Unable to send announcement.' });
    }
  }
);

// ============================================================================
// 4. ENTERPRISE ANALYTICS (12+ Real PostgreSQL Aggregations)
// ============================================================================

part2AdvancedRouter.get(
  '/org/analytics/enterprise',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const range = (req.query.range as string) || '30d';
      const fromParam = req.query.from as string | undefined;
      const toParam = req.query.to as string | undefined;

      const endDate = toParam ? new Date(toParam) : new Date();
      endDate.setHours(23, 59, 59, 999);
      let startDate = new Date();
      if (fromParam) {
        startDate = new Date(fromParam);
      } else if (range === '7d') {
        startDate.setDate(startDate.getDate() - 7);
      } else if (range === '90d') {
        startDate.setDate(startDate.getDate() - 90);
      } else if (range === 'year') {
        startDate.setFullYear(startDate.getFullYear() - 1);
      } else {
        startDate.setDate(startDate.getDate() - 30);
      }

      const [
        allLoans,
        allStudents,
        allCourses,
        allBooks,
        allCategories,
        allCopies,
        allVisits,
        allPayments,
        allFines,
      ] = await Promise.all([
        db
          .select({
            id: loans.id,
            bookId: loans.bookId,
            studentId: loans.studentId,
            status: loans.status,
            issuedAt: loans.issuedAt,
            dueAt: loans.dueAt,
            returnedAt: loans.returnedAt,
            receiptNumber: loans.receiptNumber,
          })
          .from(loans)
          .where(eq(loans.organizationId, orgId)),
        db
          .select({
            id: students.id,
            fullName: students.fullName,
            rollNumber: students.collegeRollNumber,
            courseId: students.courseId,
            createdAt: students.createdAt,
            status: students.status,
          })
          .from(students)
          .where(eq(students.organizationId, orgId)),
        db.select().from(courses).where(eq(courses.organizationId, orgId)),
        db
          .select({ id: books.id, title: books.title, isbn: books.isbn, categoryId: books.categoryId })
          .from(books)
          .where(and(eq(books.organizationId, orgId), eq(books.status, 'active'))),
        db.select().from(categories).where(eq(categories.organizationId, orgId)),
        db.select({ status: bookCopies.status, bookId: bookCopies.bookId }).from(bookCopies).where(eq(bookCopies.organizationId, orgId)),
        db.select().from(attendance).where(eq(attendance.organizationId, orgId)),
        db.select().from(payments).where(eq(payments.organizationId, orgId)),
        db.select().from(fines).where(eq(fines.organizationId, orgId)),
      ]);

      const courseMap = new Map(allCourses.map((c) => [c.id, c.code || c.name]));
      const catMap = new Map(allCategories.map((c) => [c.id, c.name]));
      const bookMap = new Map(allBooks.map((b) => [b.id, b.title]));
      const studentMap = new Map(allStudents.map((s) => [s.id, s]));

      const loansInRange = allLoans.filter((l) => {
        const dt = new Date(l.issuedAt);
        return dt >= startDate && dt <= endDate;
      });

      // 1. Daily Issue vs Return (within range)
      const dailyMap = new Map<string, { date: string; issued: number; returned: number; overdue: number }>();
      const now = new Date();
      for (const l of loansInRange) {
        const day = new Date(l.issuedAt).toISOString().slice(0, 10);
        const cur = dailyMap.get(day) || { date: day, issued: 0, returned: 0, overdue: 0 };
        cur.issued++;
        if (l.status !== 'returned' && new Date(l.dueAt) < now) cur.overdue++;
        dailyMap.set(day, cur);
        if (l.returnedAt) {
          const rDay = new Date(l.returnedAt).toISOString().slice(0, 10);
          const rCur = dailyMap.get(rDay) || { date: rDay, issued: 0, returned: 0, overdue: 0 };
          rCur.returned++;
          dailyMap.set(rDay, rCur);
        }
      }
      const dailyCirculation = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

      // 2. Monthly Circulation & Student Registration & Visitors & Fine Collection
      const monthlyCircMap = new Map<string, { month: string; issued: number; returned: number }>();
      for (const l of allLoans) {
        const m = new Date(l.issuedAt).toISOString().slice(0, 7);
        const cur = monthlyCircMap.get(m) || { month: m, issued: 0, returned: 0 };
        cur.issued++;
        if (l.returnedAt) cur.returned++;
        monthlyCircMap.set(m, cur);
      }

      const monthlyRegMap = new Map<string, { month: string; registrations: number }>();
      for (const s of allStudents) {
        const m = new Date(s.createdAt).toISOString().slice(0, 7);
        const cur = monthlyRegMap.get(m) || { month: m, registrations: 0 };
        cur.registrations++;
        monthlyRegMap.set(m, cur);
      }

      const monthlyVisitMap = new Map<string, { month: string; visits: number }>();
      const peakHoursMap = new Map<number, number>();
      for (const v of allVisits) {
        const d = new Date(v.checkInAt);
        const m = d.toISOString().slice(0, 7);
        const cur = monthlyVisitMap.get(m) || { month: m, visits: 0 };
        cur.visits++;
        monthlyVisitMap.set(m, cur);
        const hr = d.getHours();
        peakHoursMap.set(hr, (peakHoursMap.get(hr) || 0) + 1);
      }

      const fineTrendMap = new Map<string, { month: string; collected: number }>();
      for (const p of allPayments) {
        const m = new Date(p.paidAt).toISOString().slice(0, 7);
        const cur = fineTrendMap.get(m) || { month: m, collected: 0 };
        cur.collected = Number((cur.collected + Number(p.amount || 0)).toFixed(2));
        fineTrendMap.set(m, cur);
      }

      // 3. Course-wise Membership
      const courseDist = new Map<string, number>();
      for (const s of allStudents) {
        const k = (s.courseId && courseMap.get(s.courseId)) || 'Unassigned';
        courseDist.set(k, (courseDist.get(k) || 0) + 1);
      }

      // 4. Category-wise Book Distribution
      const catDist = new Map<string, number>();
      for (const b of allBooks) {
        const k = (b.categoryId && catMap.get(b.categoryId)) || 'General';
        catDist.set(k, (catDist.get(k) || 0) + 1);
      }

      // 5. Inventory Breakdown
      const inventoryBreakdown = [
        { name: 'Available', value: allCopies.filter((c) => c.status === 'available').length },
        { name: 'Issued', value: allCopies.filter((c) => c.status === 'issued').length },
        { name: 'Reserved', value: allCopies.filter((c) => c.status === 'reserved').length },
        {
          name: 'Damaged/Lost',
          value: allCopies.filter((c) => c.status === 'damaged' || c.status === 'lost').length,
        },
      ].filter((x) => x.value > 0);

      // 6. Most Borrowed Books & Most Active Students
      const bookBorrowCounts = new Map<string, number>();
      const studentBorrowCounts = new Map<string, number>();
      for (const l of allLoans) {
        bookBorrowCounts.set(l.bookId, (bookBorrowCounts.get(l.bookId) || 0) + 1);
        studentBorrowCounts.set(l.studentId, (studentBorrowCounts.get(l.studentId) || 0) + 1);
      }

      const mostBorrowedBooks = Array.from(bookBorrowCounts.entries())
        .map(([bookId, borrows]) => ({
          title: bookMap.get(bookId) || 'Archived Title',
          borrows,
        }))
        .sort((a, b) => b.borrows - a.borrows)
        .slice(0, 8);

      const mostActiveStudents = Array.from(studentBorrowCounts.entries())
        .map(([studentId, borrows]) => {
          const s = studentMap.get(studentId);
          return {
            name: s?.fullName || 'Student',
            rollNumber: s?.rollNumber || '—',
            borrows,
          };
        })
        .sort((a, b) => b.borrows - a.borrows)
        .slice(0, 8);

      const peakVisitingHours = Array.from(peakHoursMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([hour, visits]) => ({
          hour: `${String(hour).padStart(2, '0')}:00`,
          visits,
        }));

      const totalFinesGenerated = allFines.reduce((sum, f) => sum + Number(f.amount || 0), 0);
      const totalFinesCollected = allPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

      res.json({
        range: { startDate, endDate },
        summary: {
          totalStudents: allStudents.length,
          activeStudents: allStudents.filter((s) => s.status === 'active').length,
          totalBooks: allBooks.length,
          totalCopies: allCopies.length,
          availableCopies: allCopies.filter((c) => c.status === 'available').length,
          issuedCopies: allCopies.filter((c) => c.status === 'issued').length,
          overdueBooks: allLoans.filter((l) => l.status !== 'returned' && new Date(l.dueAt) < now).length,
          issuesInRange: loansInRange.length,
          returnsInRange: loansInRange.filter((l) => l.returnedAt !== null).length,
          totalVisits: allVisits.length,
          fineGenerated: Number(totalFinesGenerated.toFixed(2)),
          fineCollected: Number(totalFinesCollected.toFixed(2)),
        },
        dailyCirculation,
        monthlyCirculation: Array.from(monthlyCircMap.values()).sort((a, b) => a.month.localeCompare(b.month)),
        monthlyRegistrations: Array.from(monthlyRegMap.values()).sort((a, b) => a.month.localeCompare(b.month)),
        courseWiseMembership: Array.from(courseDist.entries()).map(([course, count]) => ({ course, count })),
        categoryDistribution: Array.from(catDist.entries()).map(([category, count]) => ({ category, count })),
        inventoryBreakdown,
        monthlyVisitors: Array.from(monthlyVisitMap.values()).sort((a, b) => a.month.localeCompare(b.month)),
        peakVisitingHours,
        fineCollectionTrends: Array.from(fineTrendMap.values()).sort((a, b) => a.month.localeCompare(b.month)),
        mostBorrowedBooks,
        mostActiveStudents,
      });
    } catch (error) {
      console.error('Enterprise analytics failed:', error);
      res.status(500).json({ error: 'Unable to aggregate enterprise analytics.' });
    }
  }
);

// ============================================================================
// 5. ATTENDANCE STATION (Live QR Gate & Manual Check-In / Check-Out)
// ============================================================================

part2AdvancedRouter.get(
  '/org/attendance',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const rows = await db
        .select({
          entry: attendance,
          studentName: students.fullName,
          studentIdCode: students.studentIdCode,
          rollNumber: students.collegeRollNumber,
          courseName: courses.name,
        })
        .from(attendance)
        .innerJoin(students, eq(attendance.studentId, students.id))
        .leftJoin(courses, eq(students.courseId, courses.id))
        .where(eq(attendance.organizationId, orgId))
        .orderBy(desc(attendance.checkInAt))
        .limit(120);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayRows = rows.filter((r) => new Date(r.entry.checkInAt) >= todayStart);

      res.json({
        entries: rows.map((r) => ({
          ...r.entry,
          studentName: r.studentName,
          studentIdCode: r.studentIdCode,
          rollNumber: r.rollNumber,
          courseName: r.courseName,
        })),
        stats: {
          todayTotal: todayRows.length,
          currentlyInside: todayRows.filter((r) => !r.entry.checkOutAt).length,
          checkedOutToday: todayRows.filter((r) => Boolean(r.entry.checkOutAt)).length,
        },
      });
    } catch (error) {
      console.error('Load attendance failed:', error);
      res.status(500).json({ error: 'Unable to load attendance logs.' });
    }
  }
);

part2AdvancedRouter.post(
  '/org/attendance/scan',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const rawQuery = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
      const method = req.body?.method === 'manual' ? 'manual' : 'qr';
      if (!rawQuery) return res.status(400).json({ error: 'Scan Digital ID QR or enter Student ID / Roll Number.' });

      const orgId = req.orgId!;
      const tokenCandidate = rawQuery.includes('/verify/') ? rawQuery.split('/verify/').pop()?.trim() || rawQuery : rawQuery;

      let studentRow;
      let founderBadge: { founderNumber: string; designation: string; verifiedCreator: boolean } | null = null;

      const [qrMatch] = await db
        .select()
        .from(qrTokens)
        .where(and(eq(qrTokens.token, tokenCandidate), eq(qrTokens.isActive, true)))
        .limit(1);

      if (qrMatch) {
        if (qrMatch.expiresAt && new Date(qrMatch.expiresAt) < new Date()) {
          return res.status(400).json({ error: 'Scanned Digital ID QR code has expired.' });
        }
        if (qrMatch.entityType === 'student_id' && qrMatch.organizationId === orgId) {
          const [card] = await db.select().from(idCards).where(eq(idCards.id, qrMatch.entityId)).limit(1);
          if (card && card.status === 'active') {
            [studentRow] = await db
              .select()
              .from(students)
              .where(and(eq(students.id, card.studentId), eq(students.organizationId, orgId)))
              .limit(1);
          }
        } else if (qrMatch.entityType === 'founder_id') {
          const [founder] = await db
            .select()
            .from(founderIdentities)
            .where(eq(founderIdentities.id, qrMatch.entityId))
            .limit(1);
          if (
            founder &&
            founder.status === 'active' &&
            founder.linkedOrganizationId === orgId &&
            founder.linkedStudentId &&
            founder.collegeLinkStatus === 'approved'
          ) {
            [studentRow] = await db
              .select()
              .from(students)
              .where(and(eq(students.id, founder.linkedStudentId), eq(students.organizationId, orgId)))
              .limit(1);
            founderBadge = {
              founderNumber: founder.founderNumber,
              designation: founder.designation,
              verifiedCreator: true,
            };
          } else if (founder) {
            return res.status(403).json({
              error: 'This Founder ID does not have an approved college membership at this institution.',
            });
          }
        }
      }

      if (!studentRow && /^QIV-FND-|^SHX-FND-/i.test(rawQuery)) {
        const [founder] = await db
          .select()
          .from(founderIdentities)
          .where(eq(founderIdentities.founderNumber, rawQuery.toUpperCase()))
          .limit(1);
        if (
          founder &&
          founder.status === 'active' &&
          founder.linkedOrganizationId === orgId &&
          founder.linkedStudentId &&
          founder.collegeLinkStatus === 'approved'
        ) {
          [studentRow] = await db
            .select()
            .from(students)
            .where(and(eq(students.id, founder.linkedStudentId), eq(students.organizationId, orgId)))
            .limit(1);
          founderBadge = {
            founderNumber: founder.founderNumber,
            designation: founder.designation,
            verifiedCreator: true,
          };
        }
      }

      if (!studentRow) {
        [studentRow] = await db
          .select()
          .from(students)
          .where(
            and(
              eq(students.organizationId, orgId),
              or(
                eq(students.studentIdCode, rawQuery),
                eq(students.collegeRollNumber, rawQuery),
                eq(students.email, rawQuery.toLowerCase())
              )
            )
          )
          .limit(1);
      }

      if (!studentRow) {
        return res.status(404).json({ error: 'Student not found or Digital ID QR is inactive.' });
      }
      if (studentRow.status !== 'active') {
        return res.status(403).json({
          error: `Library entry blocked: student membership status is "${studentRow.status}".`,
        });
      }

      if (!founderBadge) {
        const [linkedFnd] = await db
          .select({
            founderNumber: founderIdentities.founderNumber,
            designation: founderIdentities.designation,
          })
          .from(founderIdentities)
          .where(
            and(
              eq(founderIdentities.linkedStudentId, studentRow.id),
              eq(founderIdentities.linkedOrganizationId, orgId),
              eq(founderIdentities.status, 'active'),
              eq(founderIdentities.collegeLinkStatus, 'approved')
            )
          )
          .limit(1);
        if (linkedFnd) {
          founderBadge = {
            founderNumber: linkedFnd.founderNumber,
            designation: linkedFnd.designation,
            verifiedCreator: true,
          };
        }
      }

      // Check if student has an open check-in today -> toggle to check-out!
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const openVisits = await db
        .select()
        .from(attendance)
        .where(
          and(
            eq(attendance.organizationId, orgId),
            eq(attendance.studentId, studentRow.id),
            gte(attendance.checkInAt, todayStart)
          )
        )
        .orderBy(desc(attendance.checkInAt))
        .limit(1);

      if (openVisits[0] && !openVisits[0].checkOutAt) {
        const [updated] = await db
          .update(attendance)
          .set({ checkOutAt: new Date() })
          .where(eq(attendance.id, openVisits[0].id))
          .returning();
        return res.json({
          action: 'check_out',
          entry: updated,
          student: { fullName: studentRow.fullName, rollNumber: studentRow.collegeRollNumber },
          founderBadge,
          message: `Checked OUT: ${studentRow.fullName}`,
        });
      }

      const [created] = await db
        .insert(attendance)
        .values({
          organizationId: orgId,
          studentId: studentRow.id,
          method,
          recordedByProfileId: req.profile!.id,
          notes: req.body?.notes || (founderBadge ? `Verified via Linked Founder ID ${founderBadge.founderNumber}` : null),
        })
        .returning();

      res.status(201).json({
        action: 'check_in',
        entry: created,
        student: { fullName: studentRow.fullName, rollNumber: studentRow.collegeRollNumber },
        founderBadge,
        message: `Checked IN: ${studentRow.fullName}`,
      });
    } catch (error) {
      console.error('Attendance scan failed:', error);
      res.status(500).json({ error: 'Unable to process attendance scan.' });
    }
  }
);

part2AdvancedRouter.post(
  '/org/attendance/:id/checkout',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const [updated] = await db
        .update(attendance)
        .set({ checkOutAt: new Date() })
        .where(and(eq(attendance.id, req.params.id), eq(attendance.organizationId, req.orgId!)))
        .returning();
      if (!updated) return res.status(404).json({ error: 'Attendance record not found.' });
      res.json({ entry: updated });
    } catch (error) {
      console.error('Attendance checkout failed:', error);
      res.status(500).json({ error: 'Unable to check out visitor.' });
    }
  }
);

// ============================================================================
// 6. BULK STUDENT / BOOK OPERATIONS & ISBN LOOKUP INTERFACE
// ============================================================================

part2AdvancedRouter.post(
  '/org/students/bulk-status',
  requireAuth,
  requireOrgRole(['college_admin']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        studentIds: z.array(z.string().uuid()).min(1).max(200),
        status: z.enum(['active', 'suspended', 'blocked', 'graduated']),
        reason: z.string().min(3),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Select students, valid status, and audit reason (min 3 chars).' });
      }
      const { studentIds, status, reason } = parsed.data;
      const orgId = req.orgId!;

      const updated = await db
        .update(students)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(students.organizationId, orgId), inArray(students.id, studentIds)))
        .returning({ id: students.id });

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'students_bulk_status_changed',
        entityType: 'student',
        details: { count: updated.length, status, reason },
      });

      res.json({ updatedCount: updated.length });
    } catch (error) {
      console.error('Bulk student status failed:', error);
      res.status(500).json({ error: 'Unable to update selected students.' });
    }
  }
);

part2AdvancedRouter.post(
  '/org/books/bulk-archive',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        bookIds: z.array(z.string().uuid()).min(1).max(200),
        status: z.enum(['archived', 'active']),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Select at least one book.' });

      const updated = await db
        .update(books)
        .set({
          status: parsed.data.status,
          archivedAt: parsed.data.status === 'archived' ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(and(eq(books.organizationId, req.orgId!), inArray(books.id, parsed.data.bookIds)))
        .returning({ id: books.id });

      await logAudit({
        organizationId: req.orgId!,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'books_bulk_status_changed',
        entityType: 'book',
        details: { count: updated.length, status: parsed.data.status },
      });

      res.json({ updatedCount: updated.length });
    } catch (error) {
      console.error('Bulk book archive failed:', error);
      res.status(500).json({ error: 'Unable to update selected books.' });
    }
  }
);

part2AdvancedRouter.get(
  '/org/books/isbn-lookup',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const isbn = typeof req.query.isbn === 'string' ? normalizeIsbn(req.query.isbn) : '';
      if (isbn.length !== 10 && isbn.length !== 13) {
        return res.status(400).json({ error: 'Enter a valid 10- or 13-digit ISBN.' });
      }

      const orgId = req.orgId!;
      const candidates = getIsbnLookupCandidates(isbn);

      // Check if book already exists in this organization's catalog
      const existingMatches = await db
        .select({ id: books.id, title: books.title, isbn: books.isbn })
        .from(books)
        .where(
          and(
            eq(books.organizationId, orgId),
            eq(books.status, 'active'),
            sql`UPPER(REGEXP_REPLACE(${books.isbn}, '[^0-9Xx]', '', 'g')) IN (${sql.join(
              candidates.map((c) => sql`${c}`),
              sql`, `
            )})`
          )
        )
        .limit(1);

      let existingBook: {
        id: string;
        title: string;
        isbn: string;
        totalCopies: number;
        availableCopies: number;
      } | null = null;
      if (existingMatches[0]) {
        const copies = await db
          .select({ status: bookCopies.status })
          .from(bookCopies)
          .where(eq(bookCopies.bookId, existingMatches[0].id));
        existingBook = {
          ...existingMatches[0],
          totalCopies: copies.length,
          availableCopies: copies.filter((c) => c.status === 'available').length,
        };
      }

      const fetchWithTimeout = async (url: string, ms = 5500) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ms);
        try {
          const r = await fetch(url, { signal: controller.signal });
          clearTimeout(timer);
          return r;
        } catch (err) {
          clearTimeout(timer);
          throw err;
        }
      };

      const metadata = {
        isbn,
        title: '',
        subtitle: '',
        authorName: '',
        publisherName: '',
        publicationYear: undefined as number | undefined,
        categoryName: '',
        subject: '',
        description: '',
        coverImageUrl: '',
      };

      const providersUsed: string[] = [];

      // 1. Primary source: Open Library Bibliographic API
      try {
        const olResp = await fetchWithTimeout(
          `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`
        );
        if (olResp.ok) {
          const json = (await olResp.json()) as Record<
            string,
            {
              title?: string;
              subtitle?: string;
              authors?: Array<{ name?: string }>;
              publishers?: Array<{ name?: string }>;
              publish_date?: string;
              subjects?: Array<{ name?: string }>;
              notes?: string | { value?: string };
              cover?: { medium?: string; large?: string; small?: string };
            }
          >;
          const entry = json[`ISBN:${isbn}`];
          if (entry && entry.title) {
            providersUsed.push('Open Library');
            const yearMatch = entry.publish_date?.match(/\d{4}/);
            metadata.title = entry.title || '';
            metadata.subtitle = entry.subtitle || '';
            metadata.authorName = entry.authors?.map((a) => a.name).filter(Boolean).join(', ') || '';
            metadata.publisherName = entry.publishers?.[0]?.name || '';
            metadata.publicationYear = yearMatch ? Number(yearMatch[0]) : undefined;
            metadata.categoryName = entry.subjects?.[0]?.name || '';
            metadata.subject = entry.subjects?.slice(0, 2).map((s) => s.name).filter(Boolean).join(', ') || '';
            metadata.description =
              typeof entry.notes === 'string'
                ? entry.notes
                : entry.notes?.value || '';
            metadata.coverImageUrl = entry.cover?.large || entry.cover?.medium || entry.cover?.small || '';
          }
        }
      } catch {
        // Proceed to Google Books fallback silently
      }

      // 2. Fallback / enrichment source: Google Books API
      const needsGoogleBooks =
        !metadata.title || !metadata.authorName || !metadata.coverImageUrl || !metadata.categoryName;
      if (needsGoogleBooks) {
        try {
          const gbResp = await fetchWithTimeout(
            `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`
          );
          if (gbResp.ok) {
            const gbJson = (await gbResp.json()) as {
              items?: Array<{
                volumeInfo?: {
                  title?: string;
                  subtitle?: string;
                  authors?: string[];
                  publisher?: string;
                  publishedDate?: string;
                  categories?: string[];
                  description?: string;
                  imageLinks?: { thumbnail?: string; smallThumbnail?: string };
                };
              }>;
            };
            const vol = gbJson.items?.[0]?.volumeInfo;
            if (vol && vol.title) {
              providersUsed.push('Google Books');
              const yearMatch = vol.publishedDate?.match(/\d{4}/);
              if (!metadata.title) metadata.title = vol.title;
              if (!metadata.subtitle && vol.subtitle) metadata.subtitle = vol.subtitle;
              if (!metadata.authorName && vol.authors?.length) metadata.authorName = vol.authors.join(', ');
              if (!metadata.publisherName && vol.publisher) metadata.publisherName = vol.publisher;
              if (!metadata.publicationYear && yearMatch) metadata.publicationYear = Number(yearMatch[0]);
              if (!metadata.categoryName && vol.categories?.[0]) metadata.categoryName = vol.categories[0];
              if (!metadata.subject && vol.categories?.length) metadata.subject = vol.categories.join(', ');
              if (!metadata.description && vol.description) metadata.description = vol.description.slice(0, 600);
              const rawThumb = vol.imageLinks?.thumbnail || vol.imageLinks?.smallThumbnail || '';
              if (!metadata.coverImageUrl && rawThumb) {
                metadata.coverImageUrl = rawThumb.replace(/^http:\/\//i, 'https://');
              }
            }
          }
        } catch {
          // Both failed or timed out
        }
      }

      if (!metadata.title) {
        return res.status(404).json({
          error: `No bibliographic record found for ISBN ${isbn} in Open Library or Google Books. You can still enter the book details manually.`,
          isbn,
          existingBook,
        });
      }

      res.json({
        found: true,
        provider: providersUsed.join(' + '),
        metadata,
        existingBook,
      });
    } catch (error) {
      console.error('ISBN lookup failed:', error);
      res.status(500).json({ error: 'ISBN lookup failed.' });
    }
  }
);

// ============================================================================
// 7. FOUNDER ALLOCATION SECURITY BOUNDARY (EXCLUSIVE TO PLATFORM SUPER ADMIN)
// ============================================================================

part2AdvancedRouter.get(
  '/org/founder-nominations',
  requireAuth,
  async (_req: AuthRequest, res) => {
    return res.status(403).json({
      error: 'Access denied. Founder status allocation is exclusively managed by Platform Super Admin.',
    });
  }
);

part2AdvancedRouter.post(
  '/org/founder-nominations',
  requireAuth,
  async (_req: AuthRequest, res) => {
    return res.status(403).json({
      error: 'Access denied. Only Platform Super Admin can assign or revoke Founder status.',
    });
  }
);

part2AdvancedRouter.get(
  '/platform/founder-nominations',
  requireAuth,
  requireSuperAdmin,
  async (_req, res) => {
    try {
      const rows = await db
        .select({
          nomination: founderNominations,
          organizationName: organizations.name,
          organizationCode: organizations.code,
        })
        .from(founderNominations)
        .innerJoin(organizations, eq(founderNominations.organizationId, organizations.id))
        .orderBy(desc(founderNominations.createdAt));

      res.json({
        nominations: rows.map((r) => ({
          ...r.nomination,
          organizationName: r.organizationName,
          organizationCode: r.organizationCode,
        })),
      });
    } catch (error) {
      console.error('Platform list founder nominations failed:', error);
      res.status(500).json({ error: 'Unable to load founder nominations.' });
    }
  }
);

part2AdvancedRouter.post(
  '/platform/founder-nominations/:id/review',
  requireAuth,
  requireSuperAdmin,
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        decision: z.enum(['approved', 'rejected']),
        reviewNotes: z.string().min(3),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Decision and review notes (min 3 chars) required.' });
      }

      const [nom] = await db
        .select()
        .from(founderNominations)
        .where(eq(founderNominations.id, req.params.id))
        .limit(1);
      if (!nom || nom.status !== 'pending') {
        return res.status(404).json({ error: 'Pending nomination not found.' });
      }

      const [org] = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, nom.organizationId))
        .limit(1);

      let issuedFounderId: string | null = null;
      if (parsed.data.decision === 'approved') {
        const founderNumber = `QIV-FND-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
        const [founder] = await db
          .insert(founderIdentities)
          .values({
            founderNumber,
            fullName: nom.nomineeName,
            designation: nom.designation,
            organizationLabel: org?.name || 'QIVORA Partner Institution',
            editionName: 'QIVORA — GOLDEN FOUNDER EDITION',
            bio: nom.justification,
            status: 'active',
            issuedByProfileId: req.profile!.id,
          })
          .returning();

        await db.insert(qrTokens).values({
          token: generateSecureToken(24),
          entityType: 'founder_id',
          entityId: founder.id,
          isActive: true,
        });
        issuedFounderId = founder.id;
      }

      const [updated] = await db
        .update(founderNominations)
        .set({
          status: parsed.data.decision,
          reviewNotes: parsed.data.reviewNotes.trim(),
          reviewedByProfileId: req.profile!.id,
          reviewedAt: new Date(),
          issuedFounderId,
        })
        .where(eq(founderNominations.id, nom.id))
        .returning();

      await logAudit({
        organizationId: nom.organizationId,
        actorProfile: req.profile,
        actorRole: 'platform_super_admin',
        action: `founder_nomination_${parsed.data.decision}`,
        entityType: 'founder_nomination',
        entityId: nom.id,
        details: { nomineeName: nom.nomineeName, issuedFounderId, reviewNotes: parsed.data.reviewNotes },
      });

      res.json({ nomination: updated, issuedFounderId });
    } catch (error) {
      console.error('Review founder nomination failed:', error);
      res.status(500).json({ error: 'Unable to review nomination.' });
    }
  }
);

// ============================================================================
// 8. MODULAR INTEGRATIONS REGISTRY (Honest Configuration States — No Fake Connected)
// ============================================================================

const INTEGRATION_CATALOG = [
  {
    key: 'supabase_external',
    displayName: 'External Supabase Project (Auth, Postgres & Storage)',
    category: 'Database & Auth',
    description:
      'Connect your own Supabase project via VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY) with PostgreSQL RLS and Edge Functions.',
    envVars: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    publicFallbackAvailable: false,
  },
  {
    key: 'isbn_provider',
    displayName: 'Open Library / ISBN Metadata Provider',
    category: 'Cataloging',
    description: 'Fetch book titles, authors, publishers, and cover metadata automatically by ISBN.',
    envVars: ['ISBN_API_KEY'],
    publicFallbackAvailable: true,
  },
  {
    key: 'smtp_email',
    displayName: 'SMTP Transactional Email',
    category: 'Notifications',
    description: 'Deliver password resets, due reminders, and approval emails via institutional SMTP.',
    envVars: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'],
    publicFallbackAvailable: false,
  },
  {
    key: 'web_push',
    displayName: 'Web Push Notifications (VAPID)',
    category: 'Notifications',
    description: 'Browser push alerts for reservation availability and due dates.',
    envVars: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'],
    publicFallbackAvailable: false,
  },
  {
    key: 'whatsapp',
    displayName: 'WhatsApp Business Alerts',
    category: 'Notifications',
    description: 'Send circulation and overdue reminders via Meta WhatsApp Cloud API.',
    envVars: ['WHATSAPP_API_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
    publicFallbackAvailable: false,
  },
  {
    key: 'payment_gateway',
    displayName: 'Library Fine Payment Gateway',
    category: 'Operations',
    description: 'Optional online settlement for student library fines (counter cash/UPI ledger works out of the box).',
    envVars: ['PAYMENT_GATEWAY_KEY', 'PAYMENT_GATEWAY_SECRET'],
    publicFallbackAvailable: false,
  },
  {
    key: 'face_verification',
    displayName: 'Optional Face Verification Gate',
    category: 'Identity & Security',
    description: 'Biometric attendance check-in add-on. Always retains QR and manual check-in fallback.',
    envVars: ['FACE_VERIFICATION_ENDPOINT', 'FACE_VERIFICATION_API_KEY'],
    publicFallbackAvailable: false,
  },
  {
    key: 'rfid_inventory',
    displayName: 'RFID Shelf & Gate Inventory Bridge',
    category: 'Hardware',
    description: 'Connect UHF/HF RFID readers for rapid shelf stock verification and security gates.',
    envVars: ['RFID_BRIDGE_URL', 'RFID_BRIDGE_TOKEN'],
    publicFallbackAvailable: false,
  },
  {
    key: 'self_checkout_kiosk',
    displayName: 'Self-Checkout Kiosk Mode',
    category: 'Hardware',
    description: 'Dedicated campus kiosk pairing token for student self-issue/return stations.',
    envVars: ['KIOSK_DEVICE_SECRET'],
    publicFallbackAvailable: false,
  },
  {
    key: 'cloud_documents',
    displayName: 'Cloud Document & Backup Archival',
    category: 'Storage',
    description: 'Off-site encrypted backup snapshots and S3/GCS archival storage.',
    envVars: ['BACKUP_STORAGE_BUCKET', 'BACKUP_STORAGE_ACCESS_KEY'],
    publicFallbackAvailable: false,
  },
  {
    key: 'ai_assistant',
    displayName: 'Optional Library Discovery Assistant',
    category: 'Future Extension',
    description: 'Modular semantic catalog search connector (disabled unless explicitly configured).',
    envVars: ['LIBRARY_AI_ENDPOINT'],
    publicFallbackAvailable: false,
  },
];

part2AdvancedRouter.get(
  '/platform/integrations',
  requireAuth,
  requireSuperAdmin,
  async (_req, res) => {
    try {
      const saved = await db.select().from(integrationConfigs);
      const savedByKey = new Map(saved.map((s) => [s.integrationKey, s]));

      const list = INTEGRATION_CATALOG.map((item) => {
        const missingEnv = item.envVars.filter((k) => !process.env[k]);
        const credentialsConfigured = missingEnv.length === 0;
        const dbConfig = savedByKey.get(item.key);
        return {
          ...item,
          credentialsConfigured,
          missingEnv,
          status: credentialsConfigured
            ? dbConfig?.isEnabled
              ? 'configured_enabled'
              : 'configured_disabled'
            : item.publicFallbackAvailable
              ? 'public_api_ready'
              : 'not_configured',
          isEnabled: Boolean(dbConfig?.isEnabled),
          configMeta: dbConfig?.configMeta || {},
          updatedAt: dbConfig?.updatedAt || null,
        };
      });

      res.json({ integrations: list });
    } catch (error) {
      console.error('Load integrations failed:', error);
      res.status(500).json({ error: 'Unable to load integration registry.' });
    }
  }
);

part2AdvancedRouter.put(
  '/platform/integrations/:key',
  requireAuth,
  requireSuperAdmin,
  async (req: AuthRequest, res) => {
    try {
      const item = INTEGRATION_CATALOG.find((i) => i.key === req.params.key);
      if (!item) return res.status(404).json({ error: 'Integration module not found.' });

      const missingEnv = item.envVars.filter((k) => !process.env[k]);
      const wantsEnable = Boolean(req.body?.isEnabled);
      if (wantsEnable && missingEnv.length > 0 && !item.publicFallbackAvailable) {
        return res.status(400).json({
          error: `Cannot enable ${item.displayName}: configure ${missingEnv.join(', ')} in server environment first.`,
        });
      }

      const existing = await db
        .select()
        .from(integrationConfigs)
        .where(eq(integrationConfigs.integrationKey, item.key))
        .limit(1);

      let saved;
      if (existing[0]) {
        [saved] = await db
          .update(integrationConfigs)
          .set({
            isEnabled: wantsEnable,
            configMeta: req.body?.configMeta || existing[0].configMeta,
            updatedByProfileId: req.profile!.id,
            updatedAt: new Date(),
          })
          .where(eq(integrationConfigs.id, existing[0].id))
          .returning();
      } else {
        [saved] = await db
          .insert(integrationConfigs)
          .values({
            integrationKey: item.key,
            displayName: item.displayName,
            isEnabled: wantsEnable,
            configMeta: req.body?.configMeta || {},
            updatedByProfileId: req.profile!.id,
          })
          .returning();
      }

      await logAudit({
        actorProfile: req.profile,
        actorRole: 'platform_super_admin',
        action: 'integration_updated',
        entityType: 'integration',
        entityId: saved.id,
        details: { key: item.key, isEnabled: wantsEnable },
      });

      res.json({ integration: saved });
    } catch (error) {
      console.error('Update integration failed:', error);
      res.status(500).json({ error: 'Unable to update integration.' });
    }
  }
);
