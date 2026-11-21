import { Router } from 'express';
import { and, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  academicSessions,
  attendance,
  auditLogs,
  bookCopies,
  books,
  courses,
  departments,
  fines,
  idCardAssets,
  librarians,
  librarySettings,
  loans,
  notifications,
  organizationBranding,
  organizationMembers,
  organizations,
  payments,
  profiles,
  reservations,
  roles,
  semesters,
  studentApplications,
  studentCategories,
  students,
} from '../../db/schema.ts';
import { getIsbnLookupCandidates, normalizeIsbn } from '../../shared/isbn.ts';
import {
  type AuthRequest,
  generateSecureToken,
  hashPassword,
  logAudit,
  requireAuth,
  requireOrgRole,
} from '../auth.ts';

export const orgAdminRouter = Router();

// Public & Private Storage Serving (separate auth rules)
orgAdminRouter.get('/storage/public/:id', async (req, res) => {
  try {
    const [asset] = await db
      .select()
      .from(idCardAssets)
      .where(and(eq(idCardAssets.id, req.params.id), eq(idCardAssets.isPublic, true)))
      .limit(1);

    if (!asset) {
      return res.status(404).json({ error: 'Asset not found.' });
    }
    const commaIdx = asset.dataUrl.indexOf(',');
    const base64 = commaIdx >= 0 ? asset.dataUrl.slice(commaIdx + 1) : asset.dataUrl;
    const buffer = Buffer.from(base64, 'base64');
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (error) {
    console.error('Serve public asset failed:', error);
    res.status(500).json({ error: 'Unable to retrieve asset.' });
  }
});

orgAdminRouter.get('/storage/private/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const [asset] = await db
      .select()
      .from(idCardAssets)
      .where(eq(idCardAssets.id, req.params.id))
      .limit(1);

    if (!asset) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const memberships = req.memberships || [];
    const hasOrgStaffAccess = asset.organizationId
      ? memberships.some(
          (m) =>
            m.organizationId === asset.organizationId &&
            (m.roleSlug === 'college_admin' || m.roleSlug === 'librarian')
        )
      : false;

    const isOwner = asset.uploadedByProfileId === req.profile!.id;
    if (!hasOrgStaffAccess && !isOwner) {
      return res.status(403).json({ error: 'Access denied to private document.' });
    }

    const commaIdx = asset.dataUrl.indexOf(',');
    const base64 = commaIdx >= 0 ? asset.dataUrl.slice(commaIdx + 1) : asset.dataUrl;
    const buffer = Buffer.from(base64, 'base64');
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buffer);
  } catch (error) {
    console.error('Serve private asset failed:', error);
    res.status(500).json({ error: 'Unable to retrieve private document.' });
  }
});

// Upload validated asset (PNG/JPG/JPEG/WebP/PDF, max 3MB)
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/pdf',
]);
const ALLOWED_BUCKETS = new Set([
  'college_logos',
  'university_logos',
  'student_photos',
  'student_documents',
  'book_covers',
  'id_backgrounds',
  'id_assets',
]);
const PRIVATE_BUCKETS = new Set(['student_documents']);

orgAdminRouter.post('/org/storage/upload', requireAuth, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      bucket: z.string(),
      fileName: z.string().min(1).max(180),
      mimeType: z.string(),
      dataUrl: z.string().min(20),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid upload payload.' });
    }

    const { bucket, fileName, mimeType, dataUrl } = parsed.data;
    if (!ALLOWED_BUCKETS.has(bucket)) {
      return res.status(400).json({ error: 'Invalid storage bucket.' });
    }
    if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
      return res.status(400).json({
        error: 'Unsupported file format. Allowed formats: PNG, JPG, JPEG, WebP, or PDF.',
      });
    }

    const commaIdx = dataUrl.indexOf(',');
    const rawBase64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    const fileSize = Math.floor((rawBase64.length * 3) / 4);
    if (fileSize > 3 * 1024 * 1024) {
      return res.status(400).json({ error: 'File exceeds the maximum allowed size of 3 MB.' });
    }

    const orgId = (req.headers['x-organization-id'] as string | undefined) || null;
    const isPublic = !PRIVATE_BUCKETS.has(bucket);
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');

    const [saved] = await db
      .insert(idCardAssets)
      .values({
        organizationId: orgId,
        uploadedByProfileId: req.profile!.id,
        bucket,
        isPublic,
        fileName: safeName,
        mimeType: mimeType.toLowerCase(),
        fileSize,
        dataUrl,
      })
      .returning();

    const url = isPublic ? `/api/storage/public/${saved.id}` : `/api/storage/private/${saved.id}`;
    res.status(201).json({
      asset: {
        id: saved.id,
        bucket: saved.bucket,
        fileName: saved.fileName,
        mimeType: saved.mimeType,
        fileSize: saved.fileSize,
        isPublic: saved.isPublic,
        url,
      },
    });
  } catch (error) {
    console.error('Asset upload failed:', error);
    res.status(500).json({ error: 'File upload failed.' });
  }
});

// ============================================================================
// ORGANIZATION OVERVIEW (College Admin & Librarian — Real PostgreSQL Metrics)
// ============================================================================

orgAdminRouter.get(
  '/org/overview',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [
        allStudents,
        pendingApps,
        allBooks,
        allCopies,
        allLoans,
        activeReservations,
        todayVisits,
        allFines,
        allPayments,
        orgInfo,
        brandingRow,
      ] = await Promise.all([
        db.select({ id: students.id, status: students.status }).from(students).where(eq(students.organizationId, orgId)),
        db
          .select({ id: studentApplications.id })
          .from(studentApplications)
          .where(and(eq(studentApplications.organizationId, orgId), eq(studentApplications.status, 'pending'))),
        db.select({ id: books.id, status: books.status }).from(books).where(eq(books.organizationId, orgId)),
        db.select({ id: bookCopies.id, status: bookCopies.status }).from(bookCopies).where(eq(bookCopies.organizationId, orgId)),
        db
          .select({
            id: loans.id,
            status: loans.status,
            issuedAt: loans.issuedAt,
            returnedAt: loans.returnedAt,
            dueAt: loans.dueAt,
            receiptNumber: loans.receiptNumber,
            bookTitle: books.title,
            studentName: students.fullName,
            barcode: bookCopies.barcode,
          })
          .from(loans)
          .innerJoin(books, eq(loans.bookId, books.id))
          .innerJoin(students, eq(loans.studentId, students.id))
          .innerJoin(bookCopies, eq(loans.bookCopyId, bookCopies.id))
          .where(eq(loans.organizationId, orgId))
          .orderBy(desc(loans.createdAt)),
        db
          .select({ id: reservations.id })
          .from(reservations)
          .where(
            and(
              eq(reservations.organizationId, orgId),
              or(eq(reservations.status, 'queued'), eq(reservations.status, 'ready'))
            )
          ),
        db
          .select({ id: attendance.id })
          .from(attendance)
          .where(and(eq(attendance.organizationId, orgId), gte(attendance.checkInAt, todayStart))),
        db.select({ amount: fines.amount, waivedAmount: fines.waivedAmount }).from(fines).where(eq(fines.organizationId, orgId)),
        db.select({ amount: payments.amount }).from(payments).where(eq(payments.organizationId, orgId)),
        db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1),
        db.select().from(organizationBranding).where(eq(organizationBranding.organizationId, orgId)).limit(1),
      ]);

      const now = new Date();
      const activeLoans = allLoans.filter((l) => l.status === 'active' || l.status === 'overdue');
      const overdueLoans = activeLoans.filter((l) => new Date(l.dueAt) < now);
      const todayIssued = allLoans.filter((l) => new Date(l.issuedAt) >= todayStart).length;
      const todayReturned = allLoans.filter((l) => l.returnedAt && new Date(l.returnedAt) >= todayStart).length;

      const totalFineGenerated = allFines.reduce((sum, f) => sum + Number(f.amount || 0), 0);
      const totalFineCollected = allPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

      res.json({
        organization: orgInfo[0] || null,
        branding: brandingRow[0] || null,
        metrics: {
          totalStudents: allStudents.length,
          activeStudents: allStudents.filter((s) => s.status === 'active').length,
          pendingApplications: pendingApps.length,
          totalBookTitles: allBooks.filter((b) => b.status === 'active').length,
          totalPhysicalCopies: allCopies.length,
          availableCopies: allCopies.filter((c) => c.status === 'available').length,
          issuedCopies: allCopies.filter((c) => c.status === 'issued').length,
          overdueBooks: overdueLoans.length,
          activeReservations: activeReservations.length,
          todayVisitors: todayVisits.length,
          todayIssued,
          todayReturned,
          fineGenerated: Number(totalFineGenerated.toFixed(2)),
          fineCollected: Number(totalFineCollected.toFixed(2)),
        },
        recentTransactions: allLoans.slice(0, 10),
      });
    } catch (error) {
      console.error('Org overview failed:', error);
      res.status(500).json({ error: 'Unable to load organization dashboard metrics.' });
    }
  }
);

// ============================================================================
// COLLEGE BRANDING MANAGEMENT
// ============================================================================

orgAdminRouter.get(
  '/org/branding',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian', 'student']),
  async (req: AuthRequest, res) => {
    try {
      const [branding] = await db
        .select()
        .from(organizationBranding)
        .where(eq(organizationBranding.organizationId, req.orgId!))
        .limit(1);
      res.json({ branding: branding || null });
    } catch (error) {
      console.error('Fetch branding failed:', error);
      res.status(500).json({ error: 'Unable to load college branding.' });
    }
  }
);

orgAdminRouter.put(
  '/org/branding',
  requireAuth,
  requireOrgRole(['college_admin']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        collegeName: z.string().min(2),
        collegeLogoUrl: z.string().optional().nullable(),
        universityName: z.string().optional().nullable(),
        universityLogoUrl: z.string().optional().nullable(),
        address: z.string().optional().nullable(),
        website: z.string().optional().nullable(),
        email: z.string().optional().nullable(),
        contactNumber: z.string().optional().nullable(),
        officialColor: z.string().min(4).max(20).default('#1E3A8A'),
        authorizedSignatureUrl: z.string().optional().nullable(),
        authorizedSignatoryName: z.string().optional().nullable(),
        libraryContactDetails: z.string().optional().nullable(),
        idCardInstructions: z.string().optional().nullable(),
        allowStudentIdCustomization: z.boolean().optional(),
        allowStudentBgUpload: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid branding input.' });
      }
      const d = parsed.data;
      const orgId = req.orgId!;

      const [saved] = await db
        .insert(organizationBranding)
        .values({
          organizationId: orgId,
          ...d,
          allowStudentIdCustomization: d.allowStudentIdCustomization ?? false,
          allowStudentBgUpload: d.allowStudentBgUpload ?? false,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: organizationBranding.organizationId,
          set: {
            ...d,
            updatedAt: new Date(),
          },
        })
        .returning();

      // Keep organizations table synced with primary branding profile
      await db
        .update(organizations)
        .set({
          name: d.collegeName,
          logoUrl: d.collegeLogoUrl || null,
          universityName: d.universityName || null,
          universityLogoUrl: d.universityLogoUrl || null,
          address: d.address || null,
          website: d.website || null,
          email: d.email || null,
          contactNumber: d.contactNumber || null,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, orgId));

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'college_branding_updated',
        entityType: 'organization_branding',
        entityId: saved.id,
        details: {
          collegeName: saved.collegeName,
          allowStudentIdCustomization: saved.allowStudentIdCustomization,
          allowStudentBgUpload: saved.allowStudentBgUpload,
        },
      });

      res.json({ branding: saved });
    } catch (error) {
      console.error('Update branding failed:', error);
      res.status(500).json({ error: 'Unable to save branding configuration.' });
    }
  }
);

// ============================================================================
// LIBRARY SETTINGS (College Admin write, Staff read)
// ============================================================================

orgAdminRouter.get(
  '/org/settings',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const [settings] = await db
        .select()
        .from(librarySettings)
        .where(eq(librarySettings.organizationId, req.orgId!))
        .limit(1);
      res.json({ settings: settings || null });
    } catch (error) {
      console.error('Fetch library settings failed:', error);
      res.status(500).json({ error: 'Unable to load library settings.' });
    }
  }
);

orgAdminRouter.put(
  '/org/settings',
  requireAuth,
  requireOrgRole(['college_admin']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        defaultLoanDays: z.coerce.number().int().min(1).max(365),
        maxBooksPerStudent: z.coerce.number().int().min(1).max(50),
        maxRenewals: z.coerce.number().int().min(0).max(10),
        renewalExtensionDays: z.coerce.number().int().min(1).max(90),
        overdueFinePerDay: z.coerce.number().min(0).max(1000),
        reservationHoldDays: z.coerce.number().int().min(1).max(30),
        allowRenewalWhenReserved: z.boolean(),
        allowRenewalWhenOverdue: z.boolean(),
        maxOutstandingFineForBorrow: z.coerce.number().min(0).max(50000),
        currencySymbol: z.string().min(1).max(5),
        idValidityMonths: z.coerce.number().int().min(1).max(72),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid library settings.' });
      }
      const d = parsed.data;
      const orgId = req.orgId!;

      const [saved] = await db
        .insert(librarySettings)
        .values({
          organizationId: orgId,
          ...d,
          overdueFinePerDay: d.overdueFinePerDay.toFixed(2),
          maxOutstandingFineForBorrow: d.maxOutstandingFineForBorrow.toFixed(2),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: librarySettings.organizationId,
          set: {
            ...d,
            overdueFinePerDay: d.overdueFinePerDay.toFixed(2),
            maxOutstandingFineForBorrow: d.maxOutstandingFineForBorrow.toFixed(2),
            updatedAt: new Date(),
          },
        })
        .returning();

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'library_settings_updated',
        entityType: 'library_settings',
        entityId: saved.id,
        details: d,
      });

      res.json({ settings: saved });
    } catch (error) {
      console.error('Update library settings failed:', error);
      res.status(500).json({ error: 'Unable to save library settings.' });
    }
  }
);

// ============================================================================
// ACADEMICS METADATA (Sessions, Departments, Courses, Semesters, Student Categories)
// ============================================================================

orgAdminRouter.get(
  '/org/academics',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian', 'student']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const [sessionsList, depts, crs, sems, cats] = await Promise.all([
        db.select().from(academicSessions).where(eq(academicSessions.organizationId, orgId)).orderBy(desc(academicSessions.createdAt)),
        db.select().from(departments).where(eq(departments.organizationId, orgId)).orderBy(departments.name),
        db.select().from(courses).where(eq(courses.organizationId, orgId)).orderBy(courses.name),
        db.select().from(semesters).where(eq(semesters.organizationId, orgId)).orderBy(semesters.number),
        db.select().from(studentCategories).where(eq(studentCategories.organizationId, orgId)).orderBy(studentCategories.name),
      ]);
      res.json({
        academicSessions: sessionsList,
        departments: depts,
        courses: crs,
        semesters: sems,
        studentCategories: cats,
      });
    } catch (error) {
      console.error('Load academics failed:', error);
      res.status(500).json({ error: 'Unable to load academic metadata.' });
    }
  }
);

orgAdminRouter.post(
  '/org/academics/courses',
  requireAuth,
  requireOrgRole(['college_admin']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        name: z.string().min(2),
        code: z.string().min(2).max(20),
        departmentId: z.string().uuid().optional().nullable(),
        durationSemesters: z.coerce.number().int().min(1).max(12).default(6),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid course input.' });

      const orgId = req.orgId!;
      const [course] = await db
        .insert(courses)
        .values({
          organizationId: orgId,
          departmentId: parsed.data.departmentId || null,
          name: parsed.data.name.trim(),
          code: parsed.data.code.trim().toUpperCase(),
          durationSemesters: parsed.data.durationSemesters,
        })
        .returning();

      for (let i = 1; i <= course.durationSemesters; i++) {
        await db.insert(semesters).values({
          organizationId: orgId,
          courseId: course.id,
          number: i,
          name: `Semester ${i}`,
        });
      }

      res.status(201).json({ course });
    } catch (error) {
      console.error('Create course failed:', error);
      res.status(409).json({ error: 'Course code already exists or could not be created.' });
    }
  }
);

orgAdminRouter.post(
  '/org/academics/sessions',
  requireAuth,
  requireOrgRole(['college_admin']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        name: z.string().min(4),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        isCurrent: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid academic session.' });

      const orgId = req.orgId!;
      if (parsed.data.isCurrent) {
        await db
          .update(academicSessions)
          .set({ isCurrent: false })
          .where(eq(academicSessions.organizationId, orgId));
      }

      const [session] = await db
        .insert(academicSessions)
        .values({
          organizationId: orgId,
          name: parsed.data.name.trim(),
          startDate: parsed.data.startDate || null,
          endDate: parsed.data.endDate || null,
          isCurrent: Boolean(parsed.data.isCurrent),
        })
        .returning();

      res.status(201).json({ academicSession: session });
    } catch (error) {
      console.error('Create academic session failed:', error);
      res.status(409).json({ error: 'Academic session already exists.' });
    }
  }
);

// ============================================================================
// LIBRARIANS MANAGEMENT (College Admin ONLY)
// ============================================================================

orgAdminRouter.get(
  '/org/librarians',
  requireAuth,
  requireOrgRole(['college_admin']),
  async (req: AuthRequest, res) => {
    try {
      const list = await db
        .select()
        .from(librarians)
        .where(eq(librarians.organizationId, req.orgId!))
        .orderBy(desc(librarians.createdAt));
      res.json({ librarians: list });
    } catch (error) {
      console.error('List librarians failed:', error);
      res.status(500).json({ error: 'Unable to load librarians.' });
    }
  }
);

orgAdminRouter.post(
  '/org/librarians',
  requireAuth,
  requireOrgRole(['college_admin']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        fullName: z.string().min(2),
        email: z.string().email(),
        phone: z.string().optional().nullable(),
        employeeCode: z.string().min(2),
        designation: z.string().default('Librarian'),
        canRegisterStudents: z.boolean().default(true),
        canAdjustFines: z.boolean().default(false),
        password: z.string().min(8).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid librarian input.' });
      }
      const d = parsed.data;
      const orgId = req.orgId!;
      const email = d.email.toLowerCase().trim();

      const [libRole] = await db.select().from(roles).where(eq(roles.slug, 'librarian')).limit(1);
      if (!libRole) return res.status(500).json({ error: 'Librarian role not configured.' });

      let profile = (await db.select().from(profiles).where(eq(profiles.email, email)).limit(1))[0];
      if (!profile) {
        if (!d.password) {
          return res.status(400).json({ error: 'Initial password (min 8 chars) is required for a new librarian.' });
        }
        const { salt, hash } = hashPassword(d.password);
        [profile] = await db
          .insert(profiles)
          .values({
            uid: `local_${generateSecureToken(12)}`,
            email,
            fullName: d.fullName.trim(),
            phone: d.phone?.trim() || null,
            passwordHash: hash,
            passwordSalt: salt,
            status: 'active',
          })
          .returning();
      }

      const [created] = await db
        .insert(librarians)
        .values({
          organizationId: orgId,
          profileId: profile.id,
          employeeCode: d.employeeCode.trim().toUpperCase(),
          fullName: d.fullName.trim(),
          email,
          phone: d.phone?.trim() || null,
          designation: d.designation.trim(),
          canRegisterStudents: d.canRegisterStudents,
          canAdjustFines: d.canAdjustFines,
          status: 'active',
        })
        .returning();

      await db
        .insert(organizationMembers)
        .values({
          organizationId: orgId,
          profileId: profile.id,
          roleId: libRole.id,
          status: 'active',
          isDefault: true,
        })
        .onConflictDoUpdate({
          target: [organizationMembers.organizationId, organizationMembers.profileId, organizationMembers.roleId],
          set: { status: 'active', updatedAt: new Date() },
        });

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'librarian_created',
        entityType: 'librarian',
        entityId: created.id,
        details: { email, employeeCode: created.employeeCode },
      });

      res.status(201).json({ librarian: created });
    } catch (error) {
      console.error('Create librarian failed:', error);
      res.status(409).json({ error: 'Employee code already exists or unable to add librarian.' });
    }
  }
);

orgAdminRouter.patch(
  '/org/librarians/:id',
  requireAuth,
  requireOrgRole(['college_admin']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        status: z.enum(['active', 'suspended']).optional(),
        canRegisterStudents: z.boolean().optional(),
        canAdjustFines: z.boolean().optional(),
        designation: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid update data.' });

      const [updated] = await db
        .update(librarians)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(and(eq(librarians.id, req.params.id), eq(librarians.organizationId, req.orgId!)))
        .returning();

      if (!updated) return res.status(404).json({ error: 'Librarian not found.' });

      if (parsed.data.status) {
        const [libRole] = await db.select().from(roles).where(eq(roles.slug, 'librarian')).limit(1);
        if (libRole) {
          await db
            .update(organizationMembers)
            .set({ status: parsed.data.status, updatedAt: new Date() })
            .where(
              and(
                eq(organizationMembers.organizationId, req.orgId!),
                eq(organizationMembers.profileId, updated.profileId),
                eq(organizationMembers.roleId, libRole.id)
              )
            );
        }
      }

      await logAudit({
        organizationId: req.orgId!,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'librarian_updated',
        entityType: 'librarian',
        entityId: updated.id,
        details: parsed.data,
      });

      res.json({ librarian: updated });
    } catch (error) {
      console.error('Update librarian failed:', error);
      res.status(500).json({ error: 'Unable to update librarian.' });
    }
  }
);

// ============================================================================
// GLOBAL SEARCH (Strictly Scoped to User Role & Organization)
// ============================================================================

orgAdminRouter.get(
  '/org/search',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian', 'student']),
  async (req: AuthRequest, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (q.length < 2) {
        return res.json({ students: [], books: [], copies: [], loans: [], reservations: [] });
      }
      const orgId = req.orgId!;
      const pattern = `%${q}%`;
      const normIsbn = normalizeIsbn(q);
      const isbnCandidates = getIsbnLookupCandidates(q);

      const bookConditions = [
        ilike(books.title, pattern),
        ilike(books.isbn, pattern),
        ilike(books.subject, pattern),
      ];
      if (normIsbn.length >= 3) {
        bookConditions.push(
          sql`UPPER(REGEXP_REPLACE(${books.isbn}, '[^0-9Xx]', '', 'g')) LIKE ${`%${normIsbn}%`}`
        );
      }
      if (isbnCandidates.length > 0 && normIsbn.length >= 10) {
        bookConditions.push(
          sql`UPPER(REGEXP_REPLACE(${books.isbn}, '[^0-9Xx]', '', 'g')) IN (${sql.join(
            isbnCandidates.map((c) => sql`${c}`),
            sql`, `
          )})`
        );
      }

      const matchedBooks = await db
        .select({
          id: books.id,
          title: books.title,
          isbn: books.isbn,
          subject: books.subject,
        })
        .from(books)
        .where(
          and(
            eq(books.organizationId, orgId),
            eq(books.status, 'active'),
            or(...bookConditions)
          )
        )
        .limit(8);

      // Students ONLY search public catalog (books) — NEVER other students' private records!
      if (req.orgRole === 'student') {
        return res.json({
          students: [],
          books: matchedBooks,
          copies: [],
          loans: [],
          reservations: [],
        });
      }

      const [matchedStudents, matchedCopies, matchedLoans] = await Promise.all([
        db
          .select({
            id: students.id,
            fullName: students.fullName,
            studentIdCode: students.studentIdCode,
            collegeRollNumber: students.collegeRollNumber,
            status: students.status,
          })
          .from(students)
          .where(
            and(
              eq(students.organizationId, orgId),
              or(
                ilike(students.fullName, pattern),
                ilike(students.studentIdCode, pattern),
                ilike(students.collegeRollNumber, pattern),
                ilike(students.email, pattern)
              )
            )
          )
          .limit(8),
        db
          .select({
            id: bookCopies.id,
            barcode: bookCopies.barcode,
            accessionNumber: bookCopies.accessionNumber,
            status: bookCopies.status,
            bookId: bookCopies.bookId,
            bookTitle: books.title,
          })
          .from(bookCopies)
          .innerJoin(books, eq(bookCopies.bookId, books.id))
          .where(
            and(
              eq(bookCopies.organizationId, orgId),
              or(ilike(bookCopies.barcode, pattern), ilike(bookCopies.accessionNumber, pattern))
            )
          )
          .limit(8),
        db
          .select({
            id: loans.id,
            receiptNumber: loans.receiptNumber,
            status: loans.status,
            studentName: students.fullName,
            bookTitle: books.title,
          })
          .from(loans)
          .innerJoin(students, eq(loans.studentId, students.id))
          .innerJoin(books, eq(loans.bookId, books.id))
          .where(
            and(
              eq(loans.organizationId, orgId),
              or(ilike(loans.receiptNumber, pattern), ilike(students.fullName, pattern))
            )
          )
          .limit(6),
      ]);

      res.json({
        students: matchedStudents,
        books: matchedBooks,
        copies: matchedCopies,
        loans: matchedLoans,
        reservations: [],
      });
    } catch (error) {
      console.error('Global search failed:', error);
      res.status(500).json({ error: 'Search failed.' });
    }
  }
);

// ============================================================================
// NOTIFICATIONS (User-specific)
// ============================================================================

orgAdminRouter.get('/org/notifications', requireAuth, async (req: AuthRequest, res) => {
  try {
    const items = await db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientProfileId, req.profile!.id))
      .orderBy(desc(notifications.createdAt))
      .limit(60);

    res.json({
      notifications: items,
      unreadCount: items.filter((n) => !n.isRead).length,
    });
  } catch (error) {
    console.error('Load notifications failed:', error);
    res.status(500).json({ error: 'Unable to load notifications.' });
  }
});

orgAdminRouter.patch('/org/notifications/:id/read', requireAuth, async (req: AuthRequest, res) => {
  try {
    await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(notifications.id, req.params.id),
          eq(notifications.recipientProfileId, req.profile!.id)
        )
      );
    res.json({ ok: true });
  } catch (error) {
    console.error('Mark notification read failed:', error);
    res.status(500).json({ error: 'Unable to update notification.' });
  }
});

orgAdminRouter.post('/org/notifications/read-all', requireAuth, async (req: AuthRequest, res) => {
  try {
    await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(notifications.recipientProfileId, req.profile!.id),
          eq(notifications.isRead, false)
        )
      );
    res.json({ ok: true });
  } catch (error) {
    console.error('Mark all notifications read failed:', error);
    res.status(500).json({ error: 'Unable to mark notifications as read.' });
  }
});

// ============================================================================
// ORGANIZATION AUDIT LOGS (College Admin ONLY)
// ============================================================================

orgAdminRouter.get(
  '/org/audit-logs',
  requireAuth,
  requireOrgRole(['college_admin']),
  async (req: AuthRequest, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 120, 300);
      const logs = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.organizationId, req.orgId!))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit);
      res.json({ auditLogs: logs });
    } catch (error) {
      console.error('Org audit logs failed:', error);
      res.status(500).json({ error: 'Unable to load audit logs.' });
    }
  }
);

// ============================================================================
// REPORTS & REAL POSTGRESQL ANALYTICS (Date-filtered)
// ============================================================================

orgAdminRouter.get(
  '/org/reports',
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
      } else if (range === 'today') {
        startDate.setHours(0, 0, 0, 0);
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
        allCopies,
        allBooks,
        courseDistribution,
        rangeLoans,
        rangeRegistrations,
        rangeFines,
        rangePayments,
        mostBorrowed,
      ] = await Promise.all([
        db.select({ status: bookCopies.status }).from(bookCopies).where(eq(bookCopies.organizationId, orgId)),
        db.select({ id: books.id }).from(books).where(and(eq(books.organizationId, orgId), eq(books.status, 'active'))),
        db
          .select({
            courseName: courses.name,
            courseCode: courses.code,
            studentCount: count(),
          })
          .from(students)
          .leftJoin(courses, eq(students.courseId, courses.id))
          .where(eq(students.organizationId, orgId))
          .groupBy(courses.name, courses.code),
        db
          .select({
            id: loans.id,
            receiptNumber: loans.receiptNumber,
            status: loans.status,
            issuedAt: loans.issuedAt,
            dueAt: loans.dueAt,
            returnedAt: loans.returnedAt,
            bookTitle: books.title,
            studentName: students.fullName,
            rollNumber: students.collegeRollNumber,
            barcode: bookCopies.barcode,
          })
          .from(loans)
          .innerJoin(books, eq(loans.bookId, books.id))
          .innerJoin(students, eq(loans.studentId, students.id))
          .innerJoin(bookCopies, eq(loans.bookCopyId, bookCopies.id))
          .where(
            and(
              eq(loans.organizationId, orgId),
              gte(loans.issuedAt, startDate),
              lte(loans.issuedAt, endDate)
            )
          )
          .orderBy(desc(loans.issuedAt)),
        db
          .select({ id: students.id, createdAt: students.createdAt })
          .from(students)
          .where(
            and(
              eq(students.organizationId, orgId),
              gte(students.createdAt, startDate),
              lte(students.createdAt, endDate)
            )
          ),
        db
          .select({ amount: fines.amount, createdAt: fines.createdAt })
          .from(fines)
          .where(
            and(
              eq(fines.organizationId, orgId),
              gte(fines.createdAt, startDate),
              lte(fines.createdAt, endDate)
            )
          ),
        db
          .select({ amount: payments.amount, paidAt: payments.paidAt })
          .from(payments)
          .where(
            and(
              eq(payments.organizationId, orgId),
              gte(payments.paidAt, startDate),
              lte(payments.paidAt, endDate)
            )
          ),
        db
          .select({
            bookId: books.id,
            title: books.title,
            isbn: books.isbn,
            borrowCount: count(),
          })
          .from(loans)
          .innerJoin(books, eq(loans.bookId, books.id))
          .where(eq(loans.organizationId, orgId))
          .groupBy(books.id, books.title, books.isbn)
          .orderBy(desc(sql`count(*)`))
          .limit(8),
      ]);

      const now = new Date();
      const summary = {
        totalBookTitles: allBooks.length,
        totalCopies: allCopies.length,
        availableCopies: allCopies.filter((c) => c.status === 'available').length,
        issuedCopies: allCopies.filter((c) => c.status === 'issued').length,
        overdueBooks: rangeLoans.filter((l) => l.status !== 'returned' && new Date(l.dueAt) < now).length,
        studentRegistrationsInRange: rangeRegistrations.length,
        issuesInRange: rangeLoans.length,
        returnsInRange: rangeLoans.filter((l) => l.returnedAt !== null).length,
        fineGenerated: Number(rangeFines.reduce((acc, f) => acc + Number(f.amount || 0), 0).toFixed(2)),
        fineCollected: Number(rangePayments.reduce((acc, p) => acc + Number(p.amount || 0), 0).toFixed(2)),
      };

      res.json({
        range: { startDate, endDate },
        summary,
        courseWiseStudents: courseDistribution.map((c) => ({
          course: c.courseCode || c.courseName || 'Unassigned',
          fullName: c.courseName || 'Unassigned',
          students: Number(c.studentCount),
        })),
        mostBorrowedBooks: mostBorrowed.map((b) => ({
          bookId: b.bookId,
          title: b.title,
          isbn: b.isbn,
          borrows: Number(b.borrowCount),
        })),
        recentIssues: rangeLoans.slice(0, 20),
        recentReturns: rangeLoans.filter((l) => l.returnedAt).slice(0, 20),
      });
    } catch (error) {
      console.error('Reports query failed:', error);
      res.status(500).json({ error: 'Unable to generate analytics report.' });
    }
  }
);
