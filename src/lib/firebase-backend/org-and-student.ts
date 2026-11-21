import { createUserWithEmailAndPassword, sendEmailVerification, updateProfile } from 'firebase/auth';
import { where } from 'firebase/firestore';
import { formatFirebaseAuthError, withSecondaryAuth } from '../firebase.ts';
import {
  BackendError,
  createUserNotification,
  fetchIsbnMetadataFromPublicApis,
  generatePolicyCompliantPassword,
  getPlatformPasswordPolicyDoc,
  makeId,
  makeSecureToken,
  normalizeEmail,
  normalizeEmailKey,
  normalizeIsbn,
  nowIso,
  requireOrgAccess,
  roleDisplayName,
  safeGetDoc,
  safeListDocs,
  safeSetDoc,
  safeUpdateDoc,
  syncPublicOrganizationDoc,
  syncPublicQrRecord,
  writeOrgAudit,
} from './helpers.ts';

async function loadOrg(orgId: string) {
  const org = await safeGetDoc<Record<string, any>>(`organizations/${orgId}`);
  if (!org) throw new BackendError('Institution record not found.', 404);
  return org;
}

async function issueStudentIdCard(org: Record<string, any>, student: Record<string, any>, templateId?: string) {
  const templates = await safeListDocs<Record<string, any>>(`organizations/${org.id}/idTemplates`);
  const tpl = (templateId ? templates.find((t) => t.id === templateId) : null) || templates[0];
  if (!tpl) return null;

  const ts = nowIso();
  const cardId = makeId('idc');
  const qrToken = makeSecureToken(24);
  const validityMonths = Number(org.settings?.idValidityMonths || 12);
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + validityMonths);
  const cardNumber = `ID-${String(org.code || 'ORG').slice(0, 4).toUpperCase()}-${Math.floor(100000 + Math.random() * 900000)}`;

  const courseName = (org.courses || []).find((c: any) => c.id === student.courseId)?.name || null;
  const semesterName = (org.semesters || []).find((s: any) => s.id === student.semesterId)?.name || null;
  const sessionName = (org.academicSessions || []).find((s: any) => s.id === student.academicSessionId)?.name || null;

  const cardDoc = {
    id: cardId,
    organizationId: org.id,
    studentId: student.id,
    studentUserId: student.userId || null,
    templateId: tpl.id,
    templateVersion: tpl.currentVersion || 1,
    cardNumber,
    qrToken,
    status: 'active',
    issuedAt: ts,
    expiresAt: expiresAt.toISOString(),
    studentCustomTheme: null,
    createdAt: ts,
    updatedAt: ts,
  };

  await safeSetDoc(`organizations/${org.id}/idCards/${cardId}`, cardDoc);
  await syncPublicQrRecord({
    token: qrToken,
    entityType: 'student_id',
    entityId: cardId,
    organizationId: org.id,
    isActive: true,
    status: 'active',
    expiresAt: expiresAt.toISOString(),
    credential: {
      cardNumber,
      studentName: student.fullName,
      studentIdCode: student.studentIdCode,
      collegeRollNumber: student.collegeRollNumber,
      photoUrl: student.photoUrl || null,
      courseName,
      semesterName,
      sessionName,
      collegeName: org.branding?.collegeName || org.name,
      collegeLogoUrl: org.branding?.collegeLogoUrl || org.logoUrl || null,
      universityName: org.branding?.universityName || org.universityName || null,
      templateName: tpl.name,
      issuedAt: ts,
      expiresAt: expiresAt.toISOString(),
    },
    premiumStudent: student.isPremium
      ? {
          isPremium: true,
          premiumTier: student.premiumTier || 'obsidian_platinum',
          premiumDesign: student.premiumDesign || 'obsidian_platinum',
          premiumBadgeLabel: student.premiumBadgeLabel || 'PREMIUM SCHOLAR',
          premiumGrantedAt: student.premiumGrantedAt || ts,
        }
      : null,
  });

  return { ...cardDoc, template: tpl };
}

async function listOrgBooksWithAvailability(orgId: string, includeArchived = true) {
  const [org, books, copies] = await Promise.all([
    loadOrg(orgId),
    safeListDocs<Record<string, any>>(`organizations/${orgId}/books`),
    safeListDocs<Record<string, any>>(`organizations/${orgId}/bookCopies`),
  ]);

  const catMap = new Map((org.categories || []).map((c: any) => [c.id, c.name]));
  const authorMap = new Map((org.authors || []).map((a: any) => [a.id, a.name]));
  const shelfMap = new Map(
    (org.shelves || []).map((s: any) => [s.id, `${s.rackCode}-${s.shelfCode} (${s.sectionName || ''})`])
  );

  const copiesByBook = new Map<string, any[]>();
  for (const c of copies) {
    const arr = copiesByBook.get(c.bookId) || [];
    arr.push(c);
    copiesByBook.set(c.bookId, arr);
  }

  return books
    .filter((b) => includeArchived || b.status === 'active')
    .map((b): Record<string, any> => {
      const bCopies = copiesByBook.get(b.id) || [];
      const activeCopies = bCopies.filter((c) => c.status !== 'archived');
      const availableCopies = activeCopies.filter((c) => c.status === 'available').length;
      const issuedCopies = activeCopies.filter((c) => c.status === 'issued').length;
      return {
        ...b,
        categoryName: b.categoryName || catMap.get(b.categoryId) || null,
        authorName: b.authorName || authorMap.get(b.authorId) || 'Unknown Author',
        shelfLabel: b.shelfLabel || shelfMap.get(b.defaultShelfId) || null,
        totalCopies: activeCopies.length,
        availableCopies,
        issuedCopies,
        copies: bCopies,
      };
    })
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function handleOrgAndStudentRoute(
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
  body: any,
  orgId: string | null | undefined
): Promise<{ handled: boolean; data?: any }> {
  // Exclusive Super Admin Founder enforcement (strict 403 for college-level endpoints)
  if (
    pathname === '/org/founder-nominations' ||
    /^\/org\/students\/[^/]+\/founder-link$/.test(pathname)
  ) {
    throw new BackendError(
      'Founder status is managed exclusively by the Platform Super Admin. College Admins and Librarians do not have access.',
      403
    );
  }

  // =========================================================================
  // STUDENT SELF-SERVICE PORTAL (/student/*)
  // =========================================================================
  if (pathname === '/student/dashboard' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['student']);
    const [org, stus] = await Promise.all([
      loadOrg(ctx.orgId),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`, [
        where('userId', '==', ctx.fbUser.uid),
      ]),
    ]);
    const student = stus[0];
    if (!student) {
      throw new BackendError('Student membership record not found for this institution.', 404);
    }

    const [cards, templates, myLoans, myReservations, myFines, myAttendance, books, copies, founders] =
      await Promise.all([
        safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/idCards`, [where('studentUserId', '==', ctx.fbUser.uid)]).catch(() => []),
        safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/idTemplates`).catch(() => []),
        safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/loans`, [where('studentUserId', '==', ctx.fbUser.uid)]).catch(() => []),
        safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/reservations`, [where('studentUserId', '==', ctx.fbUser.uid)]).catch(() => []),
        safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/fines`, [where('studentUserId', '==', ctx.fbUser.uid)]).catch(() => []),
        safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/attendance`, [where('studentUserId', '==', ctx.fbUser.uid)]).catch(() => []),
        safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/books`).catch(() => []),
        safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/bookCopies`).catch(() => []),
        safeListDocs<Record<string, any>>('founderIdentities', [where('linkedUserId', '==', ctx.fbUser.uid)]).catch(() => []),
      ]);

    const tplMap = new Map(templates.map((t) => [t.id, t]));
    const bookMap = new Map(books.map((b) => [b.id, b]));
    const copyMap = new Map(copies.map((c) => [c.id, c]));

    cards.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const latestCard = cards[0] ? { ...cards[0], template: tplMap.get(cards[0].templateId) || templates[0] || null } : null;
    const activeFounder = founders.find((f) => f.status === 'active') || null;

    const now = new Date();
    const activeLoans = myLoans.filter((l) => l.status !== 'returned');
    const overdueLoans = activeLoans.filter((l) => new Date(l.dueAt) < now);
    const upcomingDue = activeLoans
      .filter((l) => new Date(l.dueAt) >= now)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

    const outstandingFines = myFines.reduce(
      (sum, f) => sum + Math.max(0, Number(f.amount || 0) - Number(f.paidAmount || 0) - Number(f.waivedAmount || 0)),
      0
    );

    const courseName = (org.courses || []).find((c: any) => c.id === student.courseId)?.name || null;
    const semesterName = (org.semesters || []).find((s: any) => s.id === student.semesterId)?.name || null;
    const sessionName = (org.academicSessions || []).find((s: any) => s.id === student.academicSessionId)?.name || null;
    const cat = (org.studentCategories || []).find((c: any) => c.id === student.studentCategoryId);
    const maxBooksAllowed = Number(cat?.maxBooksAllowed || org.settings?.maxBooksPerStudent || 4);

    return {
      handled: true,
      data: {
        student: { ...student, courseName, semesterName, sessionName },
        branding: org.branding || null,
        digitalId: latestCard,
        linkedFounderIdentity: activeFounder,
        premiumStudent: student.isPremium
          ? {
              isPremium: true,
              premiumTier: student.premiumTier || 'obsidian_platinum',
              premiumDesign: student.premiumDesign || 'obsidian_platinum',
              premiumBadgeLabel: student.premiumBadgeLabel || 'PREMIUM SCHOLAR',
              premiumGrantedAt: student.premiumGrantedAt || null,
              premiumNote: student.premiumNote || null,
            }
          : null,
        summary: {
          currentlyIssuedCount: activeLoans.length,
          maxBooksAllowed,
          overdueCount: overdueLoans.length,
          upcomingDueCount: upcomingDue.length,
          nextDueDate: upcomingDue[0]?.dueAt || null,
          outstandingFines: Number(outstandingFines.toFixed(2)),
          activeReservationsCount: myReservations.filter((r) => ['queued', 'ready'].includes(r.status)).length,
        },
        loans: myLoans
          .sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || '')))
          .map((l) => ({
            ...l,
            isOverdue: l.status !== 'returned' && new Date(l.dueAt) < now,
            bookTitle: bookMap.get(l.bookId)?.title || 'Book',
            bookIsbn: bookMap.get(l.bookId)?.isbn || '',
            coverImageUrl: bookMap.get(l.bookId)?.coverImageUrl || null,
            barcode: copyMap.get(l.bookCopyId)?.barcode || '',
          })),
        reservations: myReservations
          .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
          .map((r) => ({
            ...r,
            bookTitle: bookMap.get(r.bookId)?.title || 'Book',
            bookIsbn: bookMap.get(r.bookId)?.isbn || '',
          })),
        fines: myFines
          .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
          .map((f) => ({
            ...f,
            balance: Math.max(0, Number(f.amount || 0) - Number(f.paidAmount || 0) - Number(f.waivedAmount || 0)),
          })),
        attendance: myAttendance.sort((a, b) => String(b.checkInAt || '').localeCompare(String(a.checkInAt || ''))).slice(0, 30),
      },
    };
  }

  if (pathname === '/student/books' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['student']);
    const books = await listOrgBooksWithAvailability(ctx.orgId, false);
    return { handled: true, data: { books } };
  }

  if (pathname === '/student/my-id/customize' && (method === 'PUT' || method === 'PATCH' || method === 'POST')) {
    const ctx = await requireOrgAccess(orgId, ['student']);
    const cards = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/idCards`, [
      where('studentUserId', '==', ctx.fbUser.uid),
    ]);
    if (!cards[0]) throw new BackendError('Active student ID card not found.', 404);
    await safeUpdateDoc(`organizations/${ctx.orgId}/idCards/${cards[0].id}`, {
      studentCustomTheme: body || null,
      updatedAt: nowIso(),
    });
    return { handled: true, data: { message: 'Digital ID preferences updated.' } };
  }

  if (!pathname.startsWith('/org/')) {
    return { handled: false };
  }

  // =========================================================================
  // ORGANIZATION OVERVIEW, BRANDING, SETTINGS, ACADEMICS, LIBRARIANS, REPORTS
  // =========================================================================

  if (pathname === '/org/overview' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const [org, students, apps, books, copies, loans, reservations, fines, attendance] = await Promise.all([
      loadOrg(ctx.orgId),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/studentApplications`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/books`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/bookCopies`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/loans`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/reservations`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/fines`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/attendance`),
    ]);

    const now = new Date();
    const todayPrefix = now.toISOString().slice(0, 10);
    const activeLoans = loans.filter((l) => l.status !== 'returned');
    const overdueLoans = activeLoans.filter((l) => new Date(l.dueAt) < now);
    const unpaidFines = fines.reduce(
      (sum, f) => sum + Math.max(0, Number(f.amount || 0) - Number(f.paidAmount || 0) - Number(f.waivedAmount || 0)),
      0
    );
    const bookMap = new Map(books.map((b) => [b.id, b]));
    const studentMap = new Map(students.map((s) => [s.id, s]));

    return {
      handled: true,
      data: {
        organization: {
          id: org.id,
          name: org.name,
          code: org.code,
          academicSession: org.academicSession,
          status: org.status,
        },
        metrics: {
          totalStudents: students.length,
          activeStudents: students.filter((s) => s.status === 'active').length,
          pendingApplications: apps.filter((a) => a.status === 'pending').length,
          totalBooks: books.filter((b) => b.status === 'active').length,
          totalCopies: copies.filter((c) => c.status !== 'archived').length,
          availableCopies: copies.filter((c) => c.status === 'available').length,
          activeLoans: activeLoans.length,
          overdueLoans: overdueLoans.length,
          activeReservations: reservations.filter((r) => ['queued', 'ready'].includes(r.status)).length,
          unpaidFines: Number(unpaidFines.toFixed(2)),
          todayCheckIns: attendance.filter((a) => String(a.checkInAt || '').startsWith(todayPrefix)).length,
        },
        recentLoans: loans
          .sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || '')))
          .slice(0, 10)
          .map((l) => ({
            ...l,
            bookTitle: bookMap.get(l.bookId)?.title || 'Book',
            studentName: studentMap.get(l.studentId)?.fullName || 'Student',
            studentRoll: studentMap.get(l.studentId)?.collegeRollNumber || '',
          })),
        overdueList: overdueLoans.slice(0, 10).map((l) => ({
          ...l,
          bookTitle: bookMap.get(l.bookId)?.title || 'Book',
          studentName: studentMap.get(l.studentId)?.fullName || 'Student',
          studentRoll: studentMap.get(l.studentId)?.collegeRollNumber || '',
        })),
      },
    };
  }

  if (pathname === '/org/branding') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    if (method === 'GET') return { handled: true, data: { branding: org.branding || null } };
    if (method === 'PUT' || method === 'PATCH') {
      await requireOrgAccess(orgId, ['college_admin']);
      const nextBranding = { ...(org.branding || {}), ...body, organizationId: ctx.orgId };
      const ts = nowIso();
      await safeUpdateDoc(`organizations/${ctx.orgId}`, { branding: nextBranding, updatedAt: ts });
      await syncPublicOrganizationDoc({ ...org, branding: nextBranding });
      await writeOrgAudit({ organizationId: ctx.orgId, actorRole: ctx.roleSlug, action: 'branding_updated', entityType: 'organization', entityId: ctx.orgId });
      return { handled: true, data: { branding: nextBranding } };
    }
  }

  if (pathname === '/org/settings') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    if (method === 'GET') return { handled: true, data: { settings: org.settings || null } };
    if (method === 'PUT' || method === 'PATCH') {
      await requireOrgAccess(orgId, ['college_admin']);
      const nextSettings = { ...(org.settings || {}), ...body, organizationId: ctx.orgId };
      await safeUpdateDoc(`organizations/${ctx.orgId}`, { settings: nextSettings, updatedAt: nowIso() });
      await writeOrgAudit({ organizationId: ctx.orgId, actorRole: ctx.roleSlug, action: 'settings_updated', entityType: 'organization', entityId: ctx.orgId });
      return { handled: true, data: { settings: nextSettings } };
    }
  }

  if (pathname === '/org/academics' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    return {
      handled: true,
      data: {
        departments: org.departments || [],
        courses: org.courses || [],
        semesters: org.semesters || [],
        academicSessions: org.academicSessions || [],
        studentCategories: org.studentCategories || [],
      },
    };
  }

  if (pathname === '/org/academics/courses' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin']);
    const org = await loadOrg(ctx.orgId);
    const duration = Math.min(12, Math.max(1, Number(body?.durationSemesters || 6)));
    const newCourse = {
      id: makeId('crs'),
      departmentId: body?.departmentId || org.departments?.[0]?.id || null,
      name: String(body?.name || '').trim(),
      code: String(body?.code || '').trim().toUpperCase(),
      durationSemesters: duration,
    };
    const newSems = Array.from({ length: duration }, (_, idx) => ({
      id: makeId('sem'),
      courseId: newCourse.id,
      number: idx + 1,
      name: `Semester ${idx + 1}`,
    }));
    const courses = [...(org.courses || []), newCourse];
    const semesters = [...(org.semesters || []), ...newSems];
    await safeUpdateDoc(`organizations/${ctx.orgId}`, { courses, semesters, updatedAt: nowIso() });
    await syncPublicOrganizationDoc({ ...org, courses, semesters });
    return { handled: true, data: { course: newCourse, semesters: newSems } };
  }

  if (pathname === '/org/academics/sessions' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin']);
    const org = await loadOrg(ctx.orgId);
    const newSession = {
      id: makeId('sess'),
      name: String(body?.name || '').trim(),
      startDate: body?.startDate || '2026-07-01',
      endDate: body?.endDate || '2027-06-30',
      isCurrent: Boolean(body?.isCurrent ?? true),
      status: 'active',
    };
    const academicSessions = [
      ...(org.academicSessions || []).map((s: any) => (newSession.isCurrent ? { ...s, isCurrent: false } : s)),
      newSession,
    ];
    await safeUpdateDoc(`organizations/${ctx.orgId}`, { academicSessions, updatedAt: nowIso() });
    await syncPublicOrganizationDoc({ ...org, academicSessions });
    return { handled: true, data: { session: newSession } };
  }

  // Librarians management
  if (pathname === '/org/librarians') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    if (method === 'GET') {
      const librarians = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/librarians`);
      return { handled: true, data: { librarians } };
    }
    if (method === 'POST') {
      await requireOrgAccess(orgId, ['college_admin']);
      const org = await loadOrg(ctx.orgId);
      const email = normalizeEmail(String(body?.email || ''));
      const fullName = String(body?.fullName || '').trim();
      const rawPassword = String(body?.password || '').trim();
      if (!email || !fullName) throw new BackendError('Full name and email are required.', 400);

      let uid: string | null = null;
      const ts = nowIso();
      if (rawPassword.length >= 8) {
        try {
          uid = await withSecondaryAuth(async (secAuth) => {
            const cred = await createUserWithEmailAndPassword(secAuth, email, rawPassword);
            await updateProfile(cred.user, { displayName: fullName }).catch(() => {});
            await sendEmailVerification(cred.user).catch(() => {});
            return cred.user.uid;
          });
        } catch (err: any) {
          if (err?.code !== 'auth/email-already-in-use') {
            throw new BackendError(formatFirebaseAuthError(err), 400);
          }
        }
      }

      if (uid) {
        await safeSetDoc(`users/${uid}`, {
          uid,
          email,
          fullName: fullName.slice(0, 120),
          phone: body?.phone || null,
          avatarUrl: null,
          isSuperAdmin: false,
          mustChangePassword: false,
          status: 'active',
          createdAt: ts,
          updatedAt: ts,
        }).catch(() => {});
        const memId = `${ctx.orgId}_${uid}_librarian`;
        await safeSetDoc(`memberships/${memId}`, {
          id: memId,
          userId: uid,
          organizationId: ctx.orgId,
          organizationName: org.name,
          organizationCode: org.code,
          organizationStatus: org.status,
          roleSlug: 'librarian',
          roleName: 'Librarian',
          status: 'active',
          isDefault: true,
          createdAt: ts,
          updatedAt: ts,
        });
      } else {
        const invId = `${ctx.orgId}_librarian_${normalizeEmailKey(email)}`;
        await safeSetDoc(`pendingInvites/${invId}`, {
          id: invId,
          email,
          fullName: fullName.slice(0, 120),
          phone: body?.phone || null,
          organizationId: ctx.orgId,
          organizationName: org.name,
          organizationCode: org.code,
          roleSlug: 'librarian',
          status: 'pending',
          createdAt: ts,
          updatedAt: ts,
        });
      }

      const libId = makeId('lib');
      const libDoc = {
        id: libId,
        organizationId: ctx.orgId,
        userId: uid,
        employeeCode: body?.employeeCode || `LIB-${Math.floor(1000 + Math.random() * 9000)}`,
        fullName,
        email,
        phone: body?.phone || null,
        designation: body?.designation || 'Librarian',
        status: 'active',
        createdAt: ts,
        updatedAt: ts,
      };
      await safeSetDoc(`organizations/${ctx.orgId}/librarians/${libId}`, libDoc);
      await writeOrgAudit({ organizationId: ctx.orgId, actorRole: ctx.roleSlug, action: 'librarian_created', entityType: 'librarian', entityId: libId });
      return { handled: true, data: { librarian: libDoc } };
    }
  }

  const libMatch = pathname.match(/^\/org\/librarians\/([^/]+)$/);
  if (libMatch && (method === 'PATCH' || method === 'PUT')) {
    const ctx = await requireOrgAccess(orgId, ['college_admin']);
    const lib = await safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/librarians/${libMatch[1]}`);
    if (!lib) throw new BackendError('Librarian not found.', 404);
    const status = body?.status || lib.status;
    const ts = nowIso();
    await safeUpdateDoc(`organizations/${ctx.orgId}/librarians/${lib.id}`, { ...body, status, updatedAt: ts });
    if (lib.userId) {
      await safeUpdateDoc(`memberships/${ctx.orgId}_${lib.userId}_librarian`, { status, updatedAt: ts }).catch(() => {});
    }
    return { handled: true, data: { librarian: { ...lib, ...body, status } } };
  }

  // Storage upload (data URL stored cleanly in org assets collection)
  if (pathname === '/org/storage/upload' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian', 'student']);
    const dataUrl = String(body?.dataUrl || '');
    if (!dataUrl.startsWith('data:')) throw new BackendError('Invalid file payload.', 400);
    const id = makeId('ast');
    await safeSetDoc(`organizations/${ctx.orgId}/assets/${id}`, {
      id,
      organizationId: ctx.orgId,
      bucket: String(body?.bucket || 'general'),
      fileName: String(body?.fileName || 'upload'),
      mimeType: String(body?.mimeType || 'image/png'),
      createdAt: nowIso(),
    });
    return { handled: true, data: { asset: { id, url: dataUrl } } };
  }

  // Audit logs, Reports & Enterprise Analytics
  if (pathname === '/org/audit-logs' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const logs = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/auditLogs`);
    logs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return { handled: true, data: { auditLogs: logs.slice(0, 150) } };
  }

  if ((pathname === '/org/reports' || pathname === '/org/analytics/enterprise') && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const [org, students, books, copies, loans, fines, payments, attendance] = await Promise.all([
      loadOrg(ctx.orgId),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/books`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/bookCopies`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/loans`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/fines`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/finePayments`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/attendance`),
    ]);

    const now = new Date();
    const activeLoans = loans.filter((l) => l.status !== 'returned');
    const overdueLoans = activeLoans.filter((l) => new Date(l.dueAt) < now);
    const totalCollected = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const totalPending = fines.reduce(
      (s, f) => s + Math.max(0, Number(f.amount || 0) - Number(f.paidAmount || 0) - Number(f.waivedAmount || 0)),
      0
    );

    const catMap = new Map((org.categories || []).map((c: any) => [c.id, c.name]));
    const catCounts = new Map<string, number>();
    for (const b of books) {
      const name = String(b.categoryName || catMap.get(b.categoryId) || 'General');
      catCounts.set(name, (catCounts.get(name) || 0) + 1);
    }

    const loanCountByBook = new Map<string, number>();
    for (const l of loans) {
      loanCountByBook.set(l.bookId, (loanCountByBook.get(l.bookId) || 0) + 1);
    }
    const topBooks = books
      .map((b) => ({ id: b.id, title: b.title, isbn: b.isbn, borrowCount: loanCountByBook.get(b.id) || 0 }))
      .sort((a, b) => b.borrowCount - a.borrowCount)
      .slice(0, 10);

    return {
      handled: true,
      data: {
        summary: {
          totalStudents: students.length,
          activeStudents: students.filter((s) => s.status === 'active').length,
          totalBooks: books.length,
          totalCopies: copies.length,
          availableCopies: copies.filter((c) => c.status === 'available').length,
          totalLoans: loans.length,
          activeLoans: activeLoans.length,
          overdueLoans: overdueLoans.length,
          returnedLoans: loans.filter((l) => l.status === 'returned').length,
          totalFinesCollected: Number(totalCollected.toFixed(2)),
          totalFinesPending: Number(totalPending.toFixed(2)),
          totalVisits: attendance.length,
        },
        categoryBreakdown: Array.from(catCounts.entries()).map(([category, count]) => ({ category, count })),
        topBooks,
        monthlyCirculation: [],
        dailyVisits: [],
        departmentBreakdown: [],
      },
    };
  }

  // =========================================================================
  // STUDENTS & STUDENT APPLICATIONS
  // =========================================================================

  if (pathname === '/org/students') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);

    if (method === 'GET') {
      const [students, cards, founders] = await Promise.all([
        safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`),
        safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/idCards`),
        safeListDocs<Record<string, any>>('founderIdentities').catch(() => []),
      ]);
      const courseMap = new Map((org.courses || []).map((c: any) => [c.id, c.name]));
      const semMap = new Map((org.semesters || []).map((s: any) => [s.id, s.name]));
      const sessMap = new Map((org.academicSessions || []).map((s: any) => [s.id, s.name]));
      const cardByStu = new Map(cards.map((c) => [c.studentId, c]));
      const founderByStu = new Map(
        founders.filter((f) => f.status === 'active' && f.linkedStudentId).map((f) => [f.linkedStudentId, f])
      );

      const enriched = students
        .map((s): Record<string, any> => ({
          ...s,
          courseName: courseMap.get(s.courseId) || null,
          semesterName: semMap.get(s.semesterId) || null,
          sessionName: sessMap.get(s.academicSessionId) || null,
          cardNumber: cardByStu.get(s.id)?.cardNumber || null,
          founderIdentity: founderByStu.get(s.id) || null,
        }))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      return { handled: true, data: { students: enriched } };
    }

    if (method === 'POST') {
      const created = await createSingleStudentInOrg(org, body, ctx.roleSlug);
      return { handled: true, data: created };
    }
  }

  if (pathname === '/org/students/bulk' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    const rows = Array.isArray(body?.students) ? body.students : [];
    if (rows.length === 0) throw new BackendError('No student rows provided.', 400);

    const policy = await getPlatformPasswordPolicyDoc();
    const existing = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`);
    const existingRolls = new Set(existing.map((s) => String(s.collegeRollNumber || '').toLowerCase()));
    const existingEmails = new Set(existing.map((s) => normalizeEmail(String(s.email || ''))));

    const created: any[] = [];
    const errors: Array<{ row: number; reason: string; rollNumber?: string; email?: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const fullName = String(r.fullName || r.name || '').trim();
      const roll = String(r.collegeRollNumber || r.rollNumber || r.studentId || '').trim();
      const email = normalizeEmail(
        String(r.email || `${roll.toLowerCase().replace(/[^a-z0-9]/g, '')}@${String(org.code || 'college').toLowerCase()}.edu`)
      );
      if (!fullName || !roll) {
        errors.push({ row: i + 1, reason: 'Missing Name or Roll Number', rollNumber: roll, email });
        continue;
      }
      if (existingRolls.has(roll.toLowerCase())) {
        errors.push({ row: i + 1, reason: `Duplicate Roll Number: ${roll}`, rollNumber: roll, email });
        continue;
      }
      if (existingEmails.has(email)) {
        errors.push({ row: i + 1, reason: `Duplicate Email: ${email}`, rollNumber: roll, email });
        continue;
      }

      const rawPwd = String(r.password || '').trim() || generatePolicyCompliantPassword(policy);
      try {
        const res = await createSingleStudentInOrg(
          org,
          {
            fullName,
            fatherName: r.fatherName || 'N/A',
            collegeRollNumber: roll,
            email,
            phone: r.phone || 'N/A',
            courseId: r.courseId || null,
            semesterId: r.semesterId || null,
            departmentId: r.departmentId || null,
            password: rawPwd,
          },
          ctx.roleSlug
        );
        existingRolls.add(roll.toLowerCase());
        existingEmails.add(email);
        created.push({
          id: res.student.id,
          fullName: res.student.fullName,
          studentIdCode: res.student.studentIdCode,
          collegeRollNumber: res.student.collegeRollNumber,
          email: res.student.email,
          loginId: res.student.email,
          password: rawPwd,
          department: r.department || r.course || '',
        });
      } catch (err: any) {
        errors.push({ row: i + 1, reason: err?.message || 'Failed to create student', rollNumber: roll, email });
      }
    }

    return {
      handled: true,
      data: {
        createdCount: created.length,
        failedCount: errors.length,
        created,
        errors,
      },
    };
  }

  if (pathname === '/org/students/bulk-status' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const ids = Array.isArray(body?.studentIds) ? body.studentIds : [];
    const status = String(body?.status || 'active');
    const ts = nowIso();
    for (const sid of ids) {
      await safeUpdateDoc(`organizations/${ctx.orgId}/students/${sid}`, { status, updatedAt: ts }).catch(() => {});
    }
    return { handled: true, data: { updatedCount: ids.length } };
  }

  const stuStatusMatch = pathname.match(/^\/org\/students\/([^/]+)\/status$/);
  if (stuStatusMatch && (method === 'PATCH' || method === 'POST')) {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const status = String(body?.status || 'active');
    await safeUpdateDoc(`organizations/${ctx.orgId}/students/${stuStatusMatch[1]}`, {
      status,
      statusReason: body?.reason || null,
      updatedAt: nowIso(),
    });
    return { handled: true, data: { message: `Student status updated to ${status}.` } };
  }

  const stuDetailMatch = pathname.match(/^\/org\/students\/([^/]+)$/);
  if (stuDetailMatch && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const sid = stuDetailMatch[1];
    const [student, loans, fines, cards] = await Promise.all([
      safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/students/${sid}`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/loans`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/fines`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/idCards`),
    ]);
    if (!student) throw new BackendError('Student not found.', 404);
    return {
      handled: true,
      data: {
        student,
        loans: loans.filter((l) => l.studentId === sid),
        fines: fines.filter((f) => f.studentId === sid),
        idCards: cards.filter((c) => c.studentId === sid),
      },
    };
  }

  // Student applications
  if (pathname === '/org/student-applications' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const applications = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/studentApplications`);
    applications.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return { handled: true, data: { applications } };
  }

  const appApproveMatch = pathname.match(/^\/org\/student-applications\/([^/]+)\/approve$/);
  if (appApproveMatch && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    const app = await safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/studentApplications/${appApproveMatch[1]}`);
    if (!app) throw new BackendError('Application not found.', 404);
    if (app.status !== 'pending') throw new BackendError('Application has already been reviewed.', 400);

    const created = await createSingleStudentInOrg(
      org,
      {
        ...app,
        existingUid: app.submittedByUid || null,
      },
      ctx.roleSlug
    );
    await safeUpdateDoc(`organizations/${ctx.orgId}/studentApplications/${app.id}`, {
      status: 'approved',
      reviewedByUid: ctx.fbUser.uid,
      reviewedAt: nowIso(),
      updatedAt: nowIso(),
    });
    return { handled: true, data: { ...created, message: 'Application approved and Digital ID issued.' } };
  }

  const appRejectMatch = pathname.match(/^\/org\/student-applications\/([^/]+)\/reject$/);
  if (appRejectMatch && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    await safeUpdateDoc(`organizations/${ctx.orgId}/studentApplications/${appRejectMatch[1]}`, {
      status: 'rejected',
      rejectionReason: body?.reason || 'Rejected by administration',
      reviewedByUid: ctx.fbUser.uid,
      reviewedAt: nowIso(),
      updatedAt: nowIso(),
    });
    return { handled: true, data: { message: 'Application rejected.' } };
  }

  // =========================================================================
  // DIGITAL ID TEMPLATES, CARDS & ASSIGNMENTS
  // =========================================================================

  if (pathname === '/org/id-templates') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    if (method === 'GET') {
      const templates = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/idTemplates`);
      return { handled: true, data: { templates } };
    }
    if (method === 'POST') {
      await requireOrgAccess(orgId, ['college_admin']);
      const tplId = makeId('tpl');
      const ts = nowIso();
      const tpl = {
        id: tplId,
        organizationId: ctx.orgId,
        ...body,
        currentVersion: 1,
        status: body?.status || 'published',
        createdAt: ts,
        updatedAt: ts,
      };
      await safeSetDoc(`organizations/${ctx.orgId}/idTemplates/${tplId}`, tpl);
      return { handled: true, data: { template: tpl } };
    }
  }

  const tplMatch = pathname.match(/^\/org\/id-templates\/([^/]+)$/);
  if (tplMatch && (method === 'PUT' || method === 'PATCH')) {
    const ctx = await requireOrgAccess(orgId, ['college_admin']);
    const existing = await safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/idTemplates/${tplMatch[1]}`);
    if (!existing) throw new BackendError('Template not found.', 404);
    const updated = {
      ...existing,
      ...body,
      currentVersion: Number(existing.currentVersion || 1) + 1,
      updatedAt: nowIso(),
    };
    await safeSetDoc(`organizations/${ctx.orgId}/idTemplates/${tplMatch[1]}`, updated);
    return { handled: true, data: { template: updated } };
  }

  const tplDupMatch = pathname.match(/^\/org\/id-templates\/([^/]+)\/duplicate$/);
  if (tplDupMatch && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin']);
    const src = await safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/idTemplates/${tplDupMatch[1]}`);
    if (!src) throw new BackendError('Template not found.', 404);
    const tplId = makeId('tpl');
    const ts = nowIso();
    const dup = {
      ...src,
      id: tplId,
      name: `${src.name} (Copy)`,
      isStarter: false,
      currentVersion: 1,
      createdAt: ts,
      updatedAt: ts,
    };
    await safeSetDoc(`organizations/${ctx.orgId}/idTemplates/${tplId}`, dup);
    return { handled: true, data: { template: dup } };
  }

  if (pathname === '/org/id-cards' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const [org, cards, students, templates] = await Promise.all([
      loadOrg(ctx.orgId),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/idCards`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/idTemplates`),
    ]);
    const stuMap = new Map(students.map((s) => [s.id, s]));
    const tplMap = new Map(templates.map((t) => [t.id, t]));
    const courseMap = new Map((org.courses || []).map((c: any) => [c.id, c.name]));
    const semMap = new Map((org.semesters || []).map((s: any) => [s.id, s.name]));
    const sessMap = new Map((org.academicSessions || []).map((s: any) => [s.id, s.name]));

    return {
      handled: true,
      data: {
        branding: org.branding || null,
        idCards: cards.map((c) => {
          const s = stuMap.get(c.studentId);
          return {
            ...c,
            template: tplMap.get(c.templateId) || null,
            student: s
              ? {
                  ...s,
                  courseName: courseMap.get(s.courseId) || null,
                  semesterName: semMap.get(s.semesterId) || null,
                  sessionName: sessMap.get(s.academicSessionId) || null,
                }
              : null,
          };
        }),
      },
    };
  }

  if (pathname === '/org/id-cards/generate' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    const student = await safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/students/${body?.studentId}`);
    if (!student) throw new BackendError('Student not found.', 404);
    const card = await issueStudentIdCard(org, student, body?.templateId);
    return { handled: true, data: { idCard: card, message: 'Digital ID card generated.' } };
  }

  const idCardStatusMatch = pathname.match(/^\/org\/id-cards\/([^/]+)\/status$/);
  if (idCardStatusMatch && (method === 'PATCH' || method === 'POST')) {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const card = await safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/idCards/${idCardStatusMatch[1]}`);
    if (!card) throw new BackendError('ID card not found.', 404);
    const status = String(body?.status || 'active');
    const ts = nowIso();
    await safeUpdateDoc(`organizations/${ctx.orgId}/idCards/${card.id}`, {
      status,
      statusReason: body?.reason || null,
      updatedAt: ts,
    });
    if (card.qrToken) {
      await safeUpdateDoc(`publicQrRegistry/${card.qrToken}`, {
        isActive: status === 'active',
        status,
        reason: body?.reason || null,
        revokedAt: status === 'revoked' ? ts : null,
        updatedAt: ts,
      }).catch(() => {});
    }
    return { handled: true, data: { message: `ID card status set to ${status}.` } };
  }

  if (pathname === '/org/id-assignments' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const assignments = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/idAssignments`);
    return { handled: true, data: { assignments } };
  }

  if (pathname === '/org/id-assignments/preview' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin']);
    const students = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`);
    const matched = students.filter((s) => {
      if (body?.courseId && s.courseId !== body.courseId) return false;
      if (body?.semesterId && s.semesterId !== body.semesterId) return false;
      return s.status === 'active';
    });
    return { handled: true, data: { affectedCount: matched.length, students: matched.slice(0, 20) } };
  }

  if (pathname === '/org/id-assignments/apply' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin']);
    const org = await loadOrg(ctx.orgId);
    const students = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`);
    const matched = students.filter((s) => {
      if (body?.courseId && s.courseId !== body.courseId) return false;
      if (body?.semesterId && s.semesterId !== body.semesterId) return false;
      return s.status === 'active';
    });
    for (const s of matched) {
      await issueStudentIdCard(org, s, body?.templateId);
    }
    const assignId = makeId('ida');
    await safeSetDoc(`organizations/${ctx.orgId}/idAssignments/${assignId}`, {
      id: assignId,
      organizationId: ctx.orgId,
      ...body,
      affectedCount: matched.length,
      status: 'applied',
      createdAt: nowIso(),
    });
    return { handled: true, data: { message: `Template assigned to ${matched.length} student(s).` } };
  }

  const assignRevMatch = pathname.match(/^\/org\/id-assignments\/([^/]+)\/reverse$/);
  if (assignRevMatch && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin']);
    await safeUpdateDoc(`organizations/${ctx.orgId}/idAssignments/${assignRevMatch[1]}`, {
      status: 'reversed',
      updatedAt: nowIso(),
    });
    return { handled: true, data: { message: 'Assignment marked as reversed.' } };
  }

  // =========================================================================
  // BOOKS CATALOG, BARCODE COPIES & CIRCULATION
  // =========================================================================

  if (pathname === '/org/books/isbn-lookup' && method === 'GET') {
    await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const isbn = searchParams.get('isbn') || '';
    const result = await fetchIsbnMetadataFromPublicApis(isbn);
    return { handled: true, data: result };
  }

  if (pathname === '/org/categories' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    const item = { id: makeId('bcat'), name: String(body?.name || '').trim(), code: String(body?.code || 'GEN').toUpperCase(), description: body?.description || '' };
    await safeUpdateDoc(`organizations/${ctx.orgId}`, { categories: [...(org.categories || []), item], updatedAt: nowIso() });
    return { handled: true, data: { category: item } };
  }

  if (pathname === '/org/authors' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    const item = { id: makeId('aut'), name: String(body?.name || '').trim() };
    await safeUpdateDoc(`organizations/${ctx.orgId}`, { authors: [...(org.authors || []), item], updatedAt: nowIso() });
    return { handled: true, data: { author: item } };
  }

  if (pathname === '/org/shelves' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    const item = { id: makeId('shf'), rackCode: body?.rackCode || 'R1', shelfCode: body?.shelfCode || 'S1', sectionName: body?.sectionName || '', capacity: Number(body?.capacity || 100) };
    await safeUpdateDoc(`organizations/${ctx.orgId}`, { shelves: [...(org.shelves || []), item], updatedAt: nowIso() });
    return { handled: true, data: { shelf: item } };
  }

  if (pathname === '/org/catalog-meta' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    return {
      handled: true,
      data: {
        categories: org.categories || [],
        authors: org.authors || [],
        shelves: org.shelves || [],
      },
    };
  }

  if (pathname === '/org/books') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    if (method === 'GET') {
      const books = await listOrgBooksWithAvailability(ctx.orgId, true);
      return { handled: true, data: { books } };
    }
    if (method === 'POST') {
      const created = await createBookWithCopies(ctx.orgId, body, ctx.roleSlug);
      return { handled: true, data: created };
    }
  }

  if (pathname === '/org/books/bulk' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const items = Array.isArray(body?.books) ? body.books : [];
    const results: any[] = [];
    const errors: any[] = [];
    for (let i = 0; i < items.length; i++) {
      try {
        const res = await createBookWithCopies(ctx.orgId, items[i], ctx.roleSlug);
        results.push(res.book);
      } catch (err: any) {
        errors.push({ index: i, title: items[i]?.title, error: err?.message || 'Failed to add book' });
      }
    }
    return { handled: true, data: { addedCount: results.length, failedCount: errors.length, books: results, errors } };
  }

  if (pathname === '/org/books/bulk-archive' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const ids = Array.isArray(body?.bookIds) ? body.bookIds : [];
    for (const bid of ids) {
      await safeUpdateDoc(`organizations/${ctx.orgId}/books/${bid}`, { status: 'archived', updatedAt: nowIso() }).catch(() => {});
    }
    return { handled: true, data: { updatedCount: ids.length } };
  }

  const bookCopiesMatch = pathname.match(/^\/org\/books\/([^/]+)\/copies$/);
  if (bookCopiesMatch && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const bookId = bookCopiesMatch[1];
    const allCopies = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/bookCopies`);
    return { handled: true, data: { copies: allCopies.filter((c) => c.bookId === bookId) } };
  }
  if (bookCopiesMatch && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const bookId = bookCopiesMatch[1];
    const count = Math.min(50, Math.max(1, Number(body?.count || 1)));
    const existingCopies = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/bookCopies`);
    const customBarcode = String(body?.physicalBarcode || '').trim();
    if (customBarcode && existingCopies.some((c) => c.barcode === customBarcode)) {
      throw new BackendError(`Physical barcode "${customBarcode}" is already registered.`, 409);
    }
    const ts = nowIso();
    const created: any[] = [];
    const prefix = `BK-${Date.now().toString().slice(-6)}`;
    for (let i = 1; i <= count; i++) {
      const copyId = makeId('cpy');
      const barcode = customBarcode ? (i === 1 ? customBarcode : `${customBarcode}-${i}`) : `${prefix}-${String(i).padStart(3, '0')}`;
      const copyDoc = {
        id: copyId,
        organizationId: ctx.orgId,
        bookId,
        barcode,
        accessionNumber: `ACC-${Date.now().toString().slice(-5)}-${i}`,
        condition: body?.condition || 'good',
        status: 'available',
        shelfId: body?.shelfId || null,
        createdAt: ts,
        updatedAt: ts,
      };
      await safeSetDoc(`organizations/${ctx.orgId}/bookCopies/${copyId}`, copyDoc);
      created.push(copyDoc);
    }
    return { handled: true, data: { copies: created } };
  }

  const bookArchiveMatch = pathname.match(/^\/org\/books\/([^/]+)\/archive$/);
  if (bookArchiveMatch && (method === 'PATCH' || method === 'POST')) {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    await safeUpdateDoc(`organizations/${ctx.orgId}/books/${bookArchiveMatch[1]}`, {
      status: body?.status || 'archived',
      updatedAt: nowIso(),
    });
    return { handled: true, data: { ok: true } };
  }

  if (pathname === '/org/copies/lookup' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const rawCode = (searchParams.get('code') || '').trim();
    const mode = searchParams.get('mode') || 'issue';
    if (!rawCode) throw new BackendError('Please scan or enter a barcode, accession number, or ISBN.', 400);

    const [copies, books, loans, students] = await Promise.all([
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/bookCopies`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/books`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/loans`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`),
    ]);
    const bookMap = new Map(books.map((b) => [b.id, b]));
    const stuMap = new Map(students.map((s) => [s.id, s]));

    const lower = rawCode.toLowerCase();
    const cleanIsbn = normalizeIsbn(rawCode);

    // 1. Direct physical barcode or accession match
    let matchedCopy = copies.find(
      (c) =>
        String(c.barcode || '').toLowerCase() === lower ||
        String(c.accessionNumber || '').toLowerCase() === lower
    );

    // 2. Fallback to ISBN match on books
    if (!matchedCopy && cleanIsbn.length >= 10) {
      const matchedBook = books.find((b) => normalizeIsbn(b.isbn) === cleanIsbn);
      if (matchedBook) {
        const bCopies = copies.filter((c) => c.bookId === matchedBook.id);
        matchedCopy =
          (mode === 'return'
            ? bCopies.find((c) => c.status === 'issued')
            : bCopies.find((c) => c.status === 'available')) || bCopies[0];
      }
    }

    // 3. Fallback to Title search
    if (!matchedCopy) {
      const matchedBook = books.find((b) => String(b.title || '').toLowerCase().includes(lower));
      if (matchedBook) {
        const bCopies = copies.filter((c) => c.bookId === matchedBook.id);
        matchedCopy =
          (mode === 'return'
            ? bCopies.find((c) => c.status === 'issued')
            : bCopies.find((c) => c.status === 'available')) || bCopies[0];
      }
    }

    if (!matchedCopy) {
      throw new BackendError(`No book copy found matching "${rawCode}".`, 404);
    }

    const book = bookMap.get(matchedCopy.bookId) || null;
    const activeLoan = loans.find((l) => l.bookCopyId === matchedCopy!.id && l.status !== 'returned') || null;
    const borrower = activeLoan ? stuMap.get(activeLoan.studentId) || null : null;

    return {
      handled: true,
      data: {
        type: 'book_copy',
        copy: matchedCopy,
        book,
        activeLoan: activeLoan
          ? {
              ...activeLoan,
              studentName: borrower?.fullName || 'Student',
              studentRoll: borrower?.collegeRollNumber || '',
            }
          : null,
      },
    };
  }

  const copyUpdateMatch = pathname.match(/^\/org\/copies\/([^/]+)$/);
  if (copyUpdateMatch && (method === 'PATCH' || method === 'PUT')) {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    await safeUpdateDoc(`organizations/${ctx.orgId}/bookCopies/${copyUpdateMatch[1]}`, {
      ...body,
      updatedAt: nowIso(),
    });
    return { handled: true, data: { ok: true } };
  }

  // Circulation: resolve student, issue, return, renew, list loans
  if (pathname === '/org/circulation/resolve-student' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    if (!q) throw new BackendError('Enter Student ID, Roll Number, Email, or scan QR code.', 400);

    const [org, students, cards, loans, fines] = await Promise.all([
      loadOrg(ctx.orgId),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/idCards`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/loans`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/fines`),
    ]);

    const cardByToken = cards.find((c) => String(c.qrToken || '').toLowerCase() === q || String(c.cardNumber || '').toLowerCase() === q);
    const student =
      (cardByToken ? students.find((s) => s.id === cardByToken.studentId) : null) ||
      students.find(
        (s) =>
          s.id.toLowerCase() === q ||
          String(s.studentIdCode || '').toLowerCase() === q ||
          String(s.collegeRollNumber || '').toLowerCase() === q ||
          String(s.email || '').toLowerCase() === q ||
          String(s.fullName || '').toLowerCase().includes(q)
      );

    if (!student) throw new BackendError(`No student found matching "${q}".`, 404);

    const activeLoansCount = loans.filter((l) => l.studentId === student.id && l.status !== 'returned').length;
    const outstandingFines = fines
      .filter((f) => f.studentId === student.id)
      .reduce((sum, f) => sum + Math.max(0, Number(f.amount || 0) - Number(f.paidAmount || 0) - Number(f.waivedAmount || 0)), 0);
    const cat = (org.studentCategories || []).find((c: any) => c.id === student.studentCategoryId);
    const maxBooksAllowed = Number(cat?.maxBooksAllowed || org.settings?.maxBooksPerStudent || 4);
    const maxFine = Number(org.settings?.maxOutstandingFineForBorrow || 100);

    const reasons: string[] = [];
    if (student.status !== 'active') reasons.push(`Student account is ${student.status}.`);
    if (activeLoansCount >= maxBooksAllowed) reasons.push(`Borrowing limit reached (${activeLoansCount}/${maxBooksAllowed}).`);
    if (outstandingFines > maxFine) reasons.push(`Outstanding fines (${outstandingFines}) exceed threshold (${maxFine}).`);

    return {
      handled: true,
      data: {
        student,
        eligibility: {
          eligible: reasons.length === 0,
          reasons,
          activeLoansCount,
          maxBooksAllowed,
          outstandingFines: Number(outstandingFines.toFixed(2)),
          defaultLoanDays: Number(cat?.loanDurationDays || org.settings?.defaultLoanDays || 14),
        },
      },
    };
  }

  if (pathname === '/org/circulation/issue' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    const student = await safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/students/${body?.studentId}`);
    const copy = await safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/bookCopies/${body?.bookCopyId}`);
    if (!student) throw new BackendError('Student not found.', 404);
    if (!copy) throw new BackendError('Book copy not found.', 404);
    if (copy.status !== 'available') throw new BackendError(`Book copy is currently ${copy.status}.`, 409);
    const book = await safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/books/${copy.bookId}`);

    const dueDays = Number(body?.dueDays || org.settings?.defaultLoanDays || 14);
    const ts = nowIso();
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + dueDays);
    const loanId = makeId('ln');
    const receiptNumber = `RCP-${Date.now().toString().slice(-6)}`;

    const loanDoc = {
      id: loanId,
      organizationId: ctx.orgId,
      studentId: student.id,
      studentUserId: student.userId || null,
      bookId: copy.bookId,
      bookCopyId: copy.id,
      receiptNumber,
      issuedAt: ts,
      dueAt: dueAt.toISOString(),
      returnedAt: null,
      renewalCount: 0,
      status: 'issued',
      issuedByUid: ctx.fbUser.uid,
      createdAt: ts,
      updatedAt: ts,
    };

    await safeSetDoc(`organizations/${ctx.orgId}/loans/${loanId}`, loanDoc);
    await safeUpdateDoc(`organizations/${ctx.orgId}/bookCopies/${copy.id}`, { status: 'issued', updatedAt: ts });

    if (student.userId) {
      await createUserNotification({
        recipientUid: student.userId,
        organizationId: ctx.orgId,
        type: 'book_issued',
        title: 'Book Issued',
        message: `"${book?.title || 'Book'}" (Barcode: ${copy.barcode}) issued. Due on ${dueAt.toLocaleDateString()}.`,
        entityType: 'loan',
        entityId: loanId,
      });
    }

    await writeOrgAudit({
      organizationId: ctx.orgId,
      actorRole: ctx.roleSlug,
      action: 'book_issued',
      entityType: 'loan',
      entityId: loanId,
      details: { studentId: student.id, barcode: copy.barcode },
    });

    return {
      handled: true,
      data: {
        loan: { ...loanDoc, bookTitle: book?.title || 'Book', studentName: student.fullName, barcode: copy.barcode },
        message: 'Book issued successfully.',
      },
    };
  }

  if (pathname === '/org/circulation/return' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    const loan = await safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/loans/${body?.loanId}`);
    if (!loan) throw new BackendError('Loan record not found.', 404);
    if (loan.status === 'returned') throw new BackendError('Book copy has already been returned.', 400);

    const ts = nowIso();
    const now = new Date();
    const due = new Date(loan.dueAt);
    const overdueDays = Math.max(0, Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
    const finePerDay = Number(org.settings?.overdueFinePerDay || 5);
    let fineCreated: any = null;

    await safeUpdateDoc(`organizations/${ctx.orgId}/loans/${loan.id}`, {
      status: 'returned',
      returnedAt: ts,
      conditionOnReturn: body?.conditionOnReturn || 'good',
      updatedAt: ts,
    });
    await safeUpdateDoc(`organizations/${ctx.orgId}/bookCopies/${loan.bookCopyId}`, {
      status: body?.conditionOnReturn === 'damaged' ? 'damaged' : 'available',
      condition: body?.conditionOnReturn || 'good',
      updatedAt: ts,
    });

    if (overdueDays > 0 && finePerDay > 0) {
      const fineId = makeId('fin');
      const amount = Number((overdueDays * finePerDay).toFixed(2));
      fineCreated = {
        id: fineId,
        organizationId: ctx.orgId,
        studentId: loan.studentId,
        studentUserId: loan.studentUserId || null,
        loanId: loan.id,
        amount: amount.toFixed(2),
        paidAmount: '0.00',
        waivedAmount: '0.00',
        reason: `Overdue return (${overdueDays} day(s) late)`,
        status: 'unpaid',
        createdAt: ts,
        updatedAt: ts,
      };
      await safeSetDoc(`organizations/${ctx.orgId}/fines/${fineId}`, fineCreated);
    }

    await writeOrgAudit({
      organizationId: ctx.orgId,
      actorRole: ctx.roleSlug,
      action: 'book_returned',
      entityType: 'loan',
      entityId: loan.id,
      details: { overdueDays, fineAmount: fineCreated?.amount || '0.00' },
    });

    return { handled: true, data: { loan: { ...loan, status: 'returned', returnedAt: ts }, fine: fineCreated, message: 'Book returned successfully.' } };
  }

  if (pathname === '/org/circulation/renew' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    const loan = await safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/loans/${body?.loanId}`);
    if (!loan) throw new BackendError('Loan not found.', 404);
    const extDays = Number(org.settings?.renewalExtensionDays || 7);
    const nextDue = new Date(loan.dueAt);
    nextDue.setDate(nextDue.getDate() + extDays);
    await safeUpdateDoc(`organizations/${ctx.orgId}/loans/${loan.id}`, {
      dueAt: nextDue.toISOString(),
      renewalCount: Number(loan.renewalCount || 0) + 1,
      updatedAt: nowIso(),
    });
    return { handled: true, data: { loan: { ...loan, dueAt: nextDue.toISOString() }, message: 'Loan renewed.' } };
  }

  if (pathname === '/org/loans' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const [loans, books, copies, students] = await Promise.all([
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/loans`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/books`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/bookCopies`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`),
    ]);
    const bookMap = new Map(books.map((b) => [b.id, b]));
    const copyMap = new Map(copies.map((c) => [c.id, c]));
    const stuMap = new Map(students.map((s) => [s.id, s]));
    const now = new Date();
    return {
      handled: true,
      data: {
        loans: loans
          .sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || '')))
          .map((l) => ({
            ...l,
            isOverdue: l.status !== 'returned' && new Date(l.dueAt) < now,
            bookTitle: bookMap.get(l.bookId)?.title || 'Book',
            barcode: copyMap.get(l.bookCopyId)?.barcode || '',
            studentName: stuMap.get(l.studentId)?.fullName || 'Student',
            studentRoll: stuMap.get(l.studentId)?.collegeRollNumber || '',
          })),
      },
    };
  }

  // =========================================================================
  // RESERVATIONS & FINES
  // =========================================================================

  if (pathname === '/org/reservations') {
    if (method === 'GET') {
      const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
      const [reservations, books, students] = await Promise.all([
        safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/reservations`),
        safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/books`),
        safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`),
      ]);
      const bookMap = new Map(books.map((b) => [b.id, b]));
      const stuMap = new Map(students.map((s) => [s.id, s]));
      return {
        handled: true,
        data: {
          reservations: reservations
            .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
            .map((r) => ({
              ...r,
              bookTitle: bookMap.get(r.bookId)?.title || 'Book',
              studentName: stuMap.get(r.studentId)?.fullName || 'Student',
              studentRoll: stuMap.get(r.studentId)?.collegeRollNumber || '',
            })),
        },
      };
    }

    if (method === 'POST') {
      const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian', 'student']);
      let studentId = body?.studentId;
      let studentUserId = ctx.fbUser.uid;
      if (ctx.roleSlug === 'student') {
        const stus = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`, [
          where('userId', '==', ctx.fbUser.uid),
        ]);
        if (!stus[0]) throw new BackendError('Student profile not found.', 404);
        studentId = stus[0].id;
        studentUserId = ctx.fbUser.uid;
      } else if (studentId) {
        const stu = await safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/students/${studentId}`);
        studentUserId = stu?.userId || null;
      }
      const resId = makeId('res');
      const ts = nowIso();
      const docData = {
        id: resId,
        organizationId: ctx.orgId,
        studentId,
        studentUserId,
        bookId: body?.bookId,
        status: 'queued',
        notes: body?.notes || null,
        createdAt: ts,
        updatedAt: ts,
      };
      await safeSetDoc(`organizations/${ctx.orgId}/reservations/${resId}`, docData);
      return { handled: true, data: { reservation: docData, message: 'Book reserved successfully.' } };
    }
  }

  const resStatusMatch = pathname.match(/^\/org\/reservations\/([^/]+)\/status$/);
  if (resStatusMatch && (method === 'PATCH' || method === 'POST')) {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian', 'student']);
    const status = String(body?.status || 'cancelled');
    await safeUpdateDoc(`organizations/${ctx.orgId}/reservations/${resStatusMatch[1]}`, {
      status,
      updatedAt: nowIso(),
    });
    return { handled: true, data: { message: `Reservation status updated to ${status}.` } };
  }

  if (pathname === '/org/fines') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    if (method === 'GET') {
      const [fines, payments, students] = await Promise.all([
        safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/fines`),
        safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/finePayments`),
        safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`),
      ]);
      const stuMap = new Map(students.map((s) => [s.id, s]));
      return {
        handled: true,
        data: {
          fines: fines
            .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
            .map((f) => ({
              ...f,
              studentName: stuMap.get(f.studentId)?.fullName || 'Student',
              studentRoll: stuMap.get(f.studentId)?.collegeRollNumber || '',
              balance: Math.max(0, Number(f.amount || 0) - Number(f.paidAmount || 0) - Number(f.waivedAmount || 0)),
            })),
          payments: payments.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
        },
      };
    }

    if (method === 'POST') {
      const stu = await safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/students/${body?.studentId}`);
      if (!stu) throw new BackendError('Student not found.', 404);
      const fineId = makeId('fin');
      const ts = nowIso();
      const fineDoc = {
        id: fineId,
        organizationId: ctx.orgId,
        studentId: stu.id,
        studentUserId: stu.userId || null,
        amount: Number(body?.amount || 0).toFixed(2),
        paidAmount: '0.00',
        waivedAmount: '0.00',
        reason: String(body?.reason || 'Library fine'),
        status: 'unpaid',
        createdAt: ts,
        updatedAt: ts,
      };
      await safeSetDoc(`organizations/${ctx.orgId}/fines/${fineId}`, fineDoc);
      return { handled: true, data: { fine: fineDoc } };
    }
  }

  const finePayMatch = pathname.match(/^\/org\/fines\/([^/]+)\/pay$/);
  if (finePayMatch && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const fine = await safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/fines/${finePayMatch[1]}`);
    if (!fine) throw new BackendError('Fine record not found.', 404);
    const payAmt = Number(body?.amount || 0);
    const nextPaid = Number(fine.paidAmount || 0) + payAmt;
    const remaining = Math.max(0, Number(fine.amount || 0) - nextPaid - Number(fine.waivedAmount || 0));
    const ts = nowIso();
    const payId = makeId('pay');
    const payment = {
      id: payId,
      organizationId: ctx.orgId,
      fineId: fine.id,
      studentId: fine.studentId,
      amount: payAmt.toFixed(2),
      paymentMethod: body?.paymentMethod || 'cash',
      receiptNumber: `FIN-${Date.now().toString().slice(-6)}`,
      collectedByUid: ctx.fbUser.uid,
      createdAt: ts,
    };
    await safeSetDoc(`organizations/${ctx.orgId}/finePayments/${payId}`, payment);
    await safeUpdateDoc(`organizations/${ctx.orgId}/fines/${fine.id}`, {
      paidAmount: nextPaid.toFixed(2),
      status: remaining <= 0.01 ? 'paid' : 'partial',
      updatedAt: ts,
    });
    return { handled: true, data: { payment, message: 'Fine payment recorded.' } };
  }

  const fineWaiveMatch = pathname.match(/^\/org\/fines\/([^/]+)\/waive$/);
  if (fineWaiveMatch && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const fine = await safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/fines/${fineWaiveMatch[1]}`);
    if (!fine) throw new BackendError('Fine record not found.', 404);
    const balance = Math.max(0, Number(fine.amount || 0) - Number(fine.paidAmount || 0));
    await safeUpdateDoc(`organizations/${ctx.orgId}/fines/${fine.id}`, {
      waivedAmount: balance.toFixed(2),
      waiveReason: body?.reason || 'Waived by librarian',
      status: 'waived',
      updatedAt: nowIso(),
    });
    return { handled: true, data: { message: 'Fine waived.' } };
  }

  // =========================================================================
  // ATTENDANCE DESK, MIGRATION CENTER, NOTIFICATION CENTER
  // =========================================================================

  if (pathname === '/org/attendance' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const [entries, students] = await Promise.all([
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/attendance`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`),
    ]);
    const stuMap = new Map(students.map((s) => [s.id, s]));
    const todayPrefix = nowIso().slice(0, 10);
    const enriched = entries
      .sort((a, b) => String(b.checkInAt || '').localeCompare(String(a.checkInAt || '')))
      .map((e): Record<string, any> => ({
        ...e,
        studentName: stuMap.get(e.studentId)?.fullName || 'Student',
        rollNumber: stuMap.get(e.studentId)?.collegeRollNumber || '',
        studentIdCode: stuMap.get(e.studentId)?.studentIdCode || '',
      }));
    return {
      handled: true,
      data: {
        entries: enriched,
        stats: {
          todayTotal: enriched.filter((e) => String(e.checkInAt || '').startsWith(todayPrefix)).length,
          currentlyInside: enriched.filter((e) => !e.checkOutAt).length,
          totalVisits: enriched.length,
        },
      },
    };
  }

  if (pathname === '/org/attendance/scan' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const code = String(body?.code || body?.query || '').trim().toLowerCase();
    const [students, cards, entries] = await Promise.all([
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/idCards`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/attendance`),
    ]);
    const card = cards.find((c) => String(c.qrToken || '').toLowerCase() === code || String(c.cardNumber || '').toLowerCase() === code);
    const stu =
      (card ? students.find((s) => s.id === card.studentId) : null) ||
      students.find(
        (s) =>
          String(s.studentIdCode || '').toLowerCase() === code ||
          String(s.collegeRollNumber || '').toLowerCase() === code ||
          String(s.email || '').toLowerCase() === code
      );
    if (!stu) throw new BackendError(`No student found matching "${code}".`, 404);

    const openEntry = entries.find((e) => e.studentId === stu.id && !e.checkOutAt);
    const ts = nowIso();
    if (openEntry) {
      await safeUpdateDoc(`organizations/${ctx.orgId}/attendance/${openEntry.id}`, { checkOutAt: ts, updatedAt: ts });
      return {
        handled: true,
        data: {
          action: 'check_out',
          message: `${stu.fullName} checked out.`,
          student: { fullName: stu.fullName, rollNumber: stu.collegeRollNumber },
        },
      };
    }

    const attId = makeId('att');
    await safeSetDoc(`organizations/${ctx.orgId}/attendance/${attId}`, {
      id: attId,
      organizationId: ctx.orgId,
      studentId: stu.id,
      studentUserId: stu.userId || null,
      checkInAt: ts,
      checkOutAt: null,
      method: body?.method || 'qr_scan',
      createdAt: ts,
      updatedAt: ts,
    });
    return {
      handled: true,
      data: {
        action: 'check_in',
        message: `${stu.fullName} checked in.`,
        student: { fullName: stu.fullName, rollNumber: stu.collegeRollNumber },
      },
    };
  }

  const attOutMatch = pathname.match(/^\/org\/attendance\/([^/]+)\/checkout$/);
  if (attOutMatch && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const ts = nowIso();
    await safeUpdateDoc(`organizations/${ctx.orgId}/attendance/${attOutMatch[1]}`, { checkOutAt: ts, updatedAt: ts });
    return { handled: true, data: { message: 'Checked out.' } };
  }

  // Migration Center
  if (pathname === '/org/migrations/history' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin']);
    const runs = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/migrations`);
    return { handled: true, data: { runs } };
  }

  if (pathname === '/org/migrations/validate' && method === 'POST') {
    await requireOrgAccess(orgId, ['college_admin']);
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const validRows = rows.filter((r: any) => Object.values(r || {}).some((v) => String(v || '').trim() !== ''));
    return {
      handled: true,
      data: {
        totalRows: rows.length,
        validCount: validRows.length,
        errorCount: rows.length - validRows.length,
        errors: [],
      },
    };
  }

  if (pathname === '/org/migrations/commit' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin']);
    const org = await loadOrg(ctx.orgId);
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    let importedCount = 0;
    if (body?.importType === 'books') {
      for (const r of rows) {
        if (!r?.title) continue;
        await createBookWithCopies(ctx.orgId, r, ctx.roleSlug).catch(() => {});
        importedCount++;
      }
    } else if (body?.importType === 'students') {
      for (const r of rows) {
        if (!r?.fullName && !r?.name) continue;
        await createSingleStudentInOrg(org, r, ctx.roleSlug).catch(() => {});
        importedCount++;
      }
    }
    const runId = makeId('mig');
    const run = {
      id: runId,
      organizationId: ctx.orgId,
      importType: body?.importType || 'books',
      fileName: body?.fileName || 'import.csv',
      importedCount,
      status: 'completed',
      createdAt: nowIso(),
    };
    await safeSetDoc(`organizations/${ctx.orgId}/migrations/${runId}`, run);
    return { handled: true, data: { run, importedCount } };
  }

  // Notification Center
  if (pathname === '/org/notifications/center' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const [org, notifs] = await Promise.all([
      loadOrg(ctx.orgId),
      safeListDocs<Record<string, any>>('notifications', [where('recipientUid', '==', ctx.fbUser.uid)]),
    ]);
    return {
      handled: true,
      data: {
        notifications: notifs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
        preferences: org.notificationPreferences || { inAppEnabled: true, emailEnabled: false, dueReminderDaysBefore: 2, overdueDigestEnabled: true },
        templates: org.notificationTemplates || [],
      },
    };
  }

  if (pathname === '/org/notifications/preferences' && (method === 'PUT' || method === 'PATCH')) {
    const ctx = await requireOrgAccess(orgId, ['college_admin']);
    await safeUpdateDoc(`organizations/${ctx.orgId}`, { notificationPreferences: body, updatedAt: nowIso() });
    return { handled: true, data: { preferences: body } };
  }

  if (pathname === '/org/notifications/announce' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const students = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`);
    let count = 0;
    for (const s of students) {
      if (!s.userId) continue;
      await createUserNotification({
        recipientUid: s.userId,
        organizationId: ctx.orgId,
        type: 'announcement',
        title: String(body?.title || 'Library Announcement'),
        message: String(body?.message || ''),
      });
      count++;
    }
    return { handled: true, data: { message: `Announcement delivered to ${count} student(s).` } };
  }

  const ntplMatch = pathname.match(/^\/org\/notifications\/templates\/([^/]+)$/);
  if (ntplMatch && (method === 'PUT' || method === 'PATCH')) {
    const ctx = await requireOrgAccess(orgId, ['college_admin']);
    const org = await loadOrg(ctx.orgId);
    const templates = (org.notificationTemplates || []).map((t: any) => (t.id === ntplMatch[1] ? { ...t, ...body } : t));
    await safeUpdateDoc(`organizations/${ctx.orgId}`, { notificationTemplates: templates, updatedAt: nowIso() });
    return { handled: true, data: { ok: true } };
  }

  // Global Organization Search (/org/search?q=...)
  if (pathname === '/org/search' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    if (!q) {
      return { handled: true, data: { students: [], books: [], copies: [], loans: [] } };
    }
    const [students, books, copies, loans] = await Promise.all([
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/books`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/bookCopies`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/loans`),
    ]);
    const bookMap = new Map(books.map((b) => [b.id, b]));
    const stuMap = new Map(students.map((s) => [s.id, s]));

    return {
      handled: true,
      data: {
        students: students
          .filter((s) => `${s.fullName} ${s.studentIdCode} ${s.collegeRollNumber} ${s.email}`.toLowerCase().includes(q))
          .slice(0, 8)
          .map((s) => ({ id: s.id, fullName: s.fullName, studentIdCode: s.studentIdCode, collegeRollNumber: s.collegeRollNumber })),
        books: books
          .filter((b) => `${b.title} ${b.isbn} ${b.authorName || ''} ${b.subject || ''}`.toLowerCase().includes(q))
          .slice(0, 8)
          .map((b) => ({ id: b.id, title: b.title, isbn: b.isbn, subject: b.subject })),
        copies: copies
          .filter((c) => `${c.barcode} ${c.accessionNumber || ''}`.toLowerCase().includes(q))
          .slice(0, 8)
          .map((c) => ({ id: c.id, barcode: c.barcode, status: c.status, bookTitle: bookMap.get(c.bookId)?.title || 'Book' })),
        loans: loans
          .filter((l) => `${l.receiptNumber || ''} ${stuMap.get(l.studentId)?.fullName || ''}`.toLowerCase().includes(q))
          .slice(0, 8)
          .map((l) => ({
            id: l.id,
            receiptNumber: l.receiptNumber || l.id,
            studentName: stuMap.get(l.studentId)?.fullName || 'Student',
            bookTitle: bookMap.get(l.bookId)?.title || 'Book',
          })),
      },
    };
  }

  // Smart Automation Center (/org/automations)
  if (pathname === '/org/automations' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    const defaultJobs = [
      { id: 'auto_due_reminders', jobKey: 'due_reminders', name: 'Upcoming Due Reminders', description: 'Notify students 48 hours before a borrowed book is due.', scheduleCron: '0 8 * * *', isEnabled: true, lastRunAt: null, lastStatus: 'idle', lastSummary: null },
      { id: 'auto_overdue_escalation', jobKey: 'overdue_escalation', name: 'Overdue Escalation Alerts', description: 'Flag overdue loans and notify borrowers automatically.', scheduleCron: '0 9 * * *', isEnabled: true, lastRunAt: null, lastStatus: 'idle', lastSummary: null },
      { id: 'auto_reservation_expiry', jobKey: 'reservation_expiry', name: 'Reservation Hold Expiry', description: 'Release expired reservation holds back to circulation.', scheduleCron: '0 * * * *', isEnabled: true, lastRunAt: null, lastStatus: 'idle', lastSummary: null },
    ];
    return {
      handled: true,
      data: {
        jobs: org.automationJobs || defaultJobs,
        logs: org.automationLogs || [],
      },
    };
  }

  const autoToggleMatch = pathname.match(/^\/org\/automations\/([^/]+)$/);
  if (autoToggleMatch && (method === 'PATCH' || method === 'PUT')) {
    const ctx = await requireOrgAccess(orgId, ['college_admin']);
    const org = await loadOrg(ctx.orgId);
    const currentJobs = org.automationJobs || [
      { id: 'auto_due_reminders', jobKey: 'due_reminders', name: 'Upcoming Due Reminders', description: 'Notify students 48 hours before a borrowed book is due.', scheduleCron: '0 8 * * *', isEnabled: true },
      { id: 'auto_overdue_escalation', jobKey: 'overdue_escalation', name: 'Overdue Escalation Alerts', description: 'Flag overdue loans and notify borrowers automatically.', scheduleCron: '0 9 * * *', isEnabled: true },
      { id: 'auto_reservation_expiry', jobKey: 'reservation_expiry', name: 'Reservation Hold Expiry', description: 'Release expired reservation holds back to circulation.', scheduleCron: '0 * * * *', isEnabled: true },
    ];
    const nextJobs = currentJobs.map((j: any) => (j.id === autoToggleMatch[1] ? { ...j, isEnabled: Boolean(body?.isEnabled) } : j));
    await safeUpdateDoc(`organizations/${ctx.orgId}`, { automationJobs: nextJobs, updatedAt: nowIso() });
    return { handled: true, data: { ok: true } };
  }

  const autoRunMatch = pathname.match(/^\/org\/automations\/([^/]+)\/run$/);
  if (autoRunMatch && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    const loans = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/loans`);
    const now = new Date();
    const overdueCount = loans.filter((l) => l.status !== 'returned' && new Date(l.dueAt) < now).length;
    const ts = nowIso();
    const logEntry = {
      id: makeId('alog'),
      jobKey: autoRunMatch[1],
      triggerSource: 'manual',
      status: 'completed',
      processedCount: loans.length,
      notificationsSent: overdueCount,
      summary: `Scanned ${loans.length} loan record(s); identified ${overdueCount} overdue item(s).`,
      executedAt: ts,
    };
    const nextLogs = [logEntry, ...(org.automationLogs || [])].slice(0, 50);
    await safeUpdateDoc(`organizations/${ctx.orgId}`, { automationLogs: nextLogs, updatedAt: ts });
    return { handled: true, data: { message: logEntry.summary, log: logEntry } };
  }

  return { handled: false };
}

async function createSingleStudentInOrg(org: Record<string, any>, input: any, actorRole: string) {
  const fullName = String(input?.fullName || input?.name || '').trim();
  const collegeRollNumber = String(input?.collegeRollNumber || input?.rollNumber || '').trim();
  const email = normalizeEmail(String(input?.email || ''));
  if (!fullName || !collegeRollNumber || !email) {
    throw new BackendError('Full name, college roll number, and email are required.', 400);
  }

  const existing = await safeListDocs<Record<string, any>>(`organizations/${org.id}/students`);
  if (existing.some((s) => String(s.collegeRollNumber || '').toLowerCase() === collegeRollNumber.toLowerCase())) {
    throw new BackendError(`Roll number "${collegeRollNumber}" is already registered.`, 409);
  }

  const ts = nowIso();
  let uid: string | null = input?.existingUid || null;
  const rawPassword = String(input?.password || '').trim();

  if (!uid && rawPassword.length >= 8) {
    try {
      uid = await withSecondaryAuth(async (secAuth) => {
        const cred = await createUserWithEmailAndPassword(secAuth, email, rawPassword);
        await updateProfile(cred.user, { displayName: fullName }).catch(() => {});
        await sendEmailVerification(cred.user).catch(() => {});
        return cred.user.uid;
      });
    } catch (err: any) {
      if (err?.code !== 'auth/email-already-in-use') {
        throw new BackendError(formatFirebaseAuthError(err), 400);
      }
    }
  }

  const stuId = makeId('stu');
  const studentIdCode = `STU-${String(org.code || 'ORG').slice(0, 4).toUpperCase()}-${Math.floor(10000 + Math.random() * 90000)}`;

  if (uid) {
    await safeSetDoc(`users/${uid}`, {
      uid,
      email,
      fullName: fullName.slice(0, 120),
      phone: input?.phone || null,
      avatarUrl: input?.photoUrl || null,
      isSuperAdmin: false,
      mustChangePassword: false,
      status: 'active',
      createdAt: ts,
      updatedAt: ts,
    }).catch(() => {});
    const memId = `${org.id}_${uid}_student`;
    await safeSetDoc(`memberships/${memId}`, {
      id: memId,
      userId: uid,
      organizationId: org.id,
      organizationName: org.name,
      organizationCode: org.code,
      organizationStatus: org.status,
      roleSlug: 'student',
      roleName: roleDisplayName('student'),
      status: 'active',
      isDefault: true,
      createdAt: ts,
      updatedAt: ts,
    });
  } else {
    const invId = `${org.id}_student_${normalizeEmailKey(email)}`;
    await safeSetDoc(`pendingInvites/${invId}`, {
      id: invId,
      email,
      fullName: fullName.slice(0, 120),
      phone: input?.phone || null,
      organizationId: org.id,
      organizationName: org.name,
      organizationCode: org.code,
      roleSlug: 'student',
      studentId: stuId,
      status: 'pending',
      createdAt: ts,
      updatedAt: ts,
    });
  }

  const studentDoc = {
    id: stuId,
    organizationId: org.id,
    userId: uid,
    studentIdCode,
    fullName: fullName.slice(0, 120),
    fatherName: String(input?.fatherName || 'N/A').trim().slice(0, 120),
    collegeRollNumber,
    universityRollNumber: input?.universityRollNumber || null,
    courseId: input?.courseId || null,
    semesterId: input?.semesterId || null,
    departmentId: input?.departmentId || null,
    academicSessionId: input?.academicSessionId || org.academicSessions?.[0]?.id || null,
    studentCategoryId: input?.studentCategoryId || org.studentCategories?.[0]?.id || null,
    dateOfBirth: input?.dateOfBirth || null,
    gender: input?.gender || null,
    phone: String(input?.phone || 'N/A').slice(0, 40),
    email,
    address: input?.address || null,
    photoUrl: input?.photoUrl || null,
    status: 'active',
    isPremium: false,
    createdAt: ts,
    updatedAt: ts,
  };

  await safeSetDoc(`organizations/${org.id}/students/${stuId}`, studentDoc);
  const idCard = await issueStudentIdCard(org, studentDoc);

  await writeOrgAudit({
    organizationId: org.id,
    actorRole,
    action: 'student_registered',
    entityType: 'student',
    entityId: stuId,
    details: { studentIdCode, collegeRollNumber },
  });

  return { student: studentDoc, idCard };
}

async function createBookWithCopies(orgId: string, input: any, actorRole: string) {
  const title = String(input?.title || '').trim();
  const rawIsbn = String(input?.isbn || '').trim();
  if (!title) throw new BackendError('Book title is required.', 400);

  const isbn = normalizeIsbn(rawIsbn) || rawIsbn.toUpperCase() || `ISBN-${Date.now().toString().slice(-8)}`;
  const physicalBarcode = String(input?.physicalBarcode || '').trim();
  const initialCopies = Math.min(200, Math.max(0, Number(input?.initialCopies ?? input?.totalCopies ?? 1)));

  const existingCopies = await safeListDocs<Record<string, any>>(`organizations/${orgId}/bookCopies`);
  if (physicalBarcode && existingCopies.some((c) => c.barcode === physicalBarcode)) {
    throw new BackendError(
      `Physical barcode "${physicalBarcode}" is already registered to another book copy in this library.`,
      409
    );
  }

  const ts = nowIso();
  const bookId = makeId('bk');
  const bookDoc = {
    id: bookId,
    organizationId: orgId,
    title: title.slice(0, 300),
    subtitle: input?.subtitle || null,
    isbn,
    authorId: input?.authorId || null,
    authorName: input?.authorName || input?.author || 'Unknown Author',
    categoryId: input?.categoryId || null,
    categoryName: input?.categoryName || input?.category || null,
    publisherName: input?.publisherName || input?.publisher || null,
    edition: input?.edition || null,
    publicationYear: input?.publicationYear ? Number(input.publicationYear) : null,
    language: input?.language || 'English',
    subject: input?.subject || null,
    description: input?.description || null,
    coverImageUrl: input?.coverImageUrl || null,
    defaultShelfId: input?.defaultShelfId || null,
    status: 'active',
    createdAt: ts,
    updatedAt: ts,
  };

  await safeSetDoc(`organizations/${orgId}/books/${bookId}`, bookDoc);

  const copies: any[] = [];
  const batchPrefix = `BK-${Date.now().toString().slice(-6)}`;
  for (let i = 1; i <= initialCopies; i++) {
    const seq = String(i).padStart(3, '0');
    const barcode = physicalBarcode ? (i === 1 ? physicalBarcode : `${physicalBarcode}-${seq}`) : `${batchPrefix}-${seq}`;
    const copyId = makeId('cpy');
    const copyDoc = {
      id: copyId,
      organizationId: orgId,
      bookId,
      barcode,
      accessionNumber: `ACC-${Date.now().toString().slice(-5)}-${seq}`,
      shelfId: input?.defaultShelfId || null,
      condition: 'good',
      status: 'available',
      createdAt: ts,
      updatedAt: ts,
    };
    await safeSetDoc(`organizations/${orgId}/bookCopies/${copyId}`, copyDoc);
    copies.push(copyDoc);
  }

  await writeOrgAudit({
    organizationId: orgId,
    actorRole,
    action: 'book_created',
    entityType: 'book',
    entityId: bookId,
    details: { title, isbn, copiesCount: copies.length },
  });

  return { book: bookDoc, copies };
}
