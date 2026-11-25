import { createUserWithEmailAndPassword, sendEmailVerification, updateProfile } from 'firebase/auth';
import { where } from 'firebase/firestore';
import { formatFirebaseAuthError, withSecondaryAuth } from '../firebase.ts';
import {
  BackendError,
  createUserNotification,
  extractCompactCode,
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
  const qrToken = makeSecureToken(16);
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
      const reservedCopies = activeCopies.filter((c) => c.status === 'reserved').length;
      const damagedCopies = activeCopies.filter((c) => c.status === 'damaged').length;
      const lostCopies = activeCopies.filter((c) => c.status === 'lost').length;
      return {
        ...b,
        categoryName: b.categoryName || catMap.get(b.categoryId) || null,
        authorName: b.authorName || authorMap.get(b.authorId) || 'Unknown Author',
        shelfLabel: b.shelfLabel || shelfMap.get(b.defaultShelfId) || null,
        totalCopies: activeCopies.length,
        availableCopies,
        issuedCopies,
        inventory: {
          total: activeCopies.length,
          available: availableCopies,
          issued: issuedCopies,
          reserved: reservedCopies,
          damaged: damagedCopies,
          lost: lostCopies,
        },
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
    const [org, students, apps, books, copies, loans, reservations, fines, payments, attendance] = await Promise.all([
      loadOrg(ctx.orgId),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/studentApplications`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/books`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/bookCopies`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/loans`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/reservations`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/fines`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/finePayments`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/attendance`),
    ]);

    const now = new Date();
    const todayPrefix = now.toISOString().slice(0, 10);
    const localTodayPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const isToday = (iso?: string | null) => {
      if (!iso) return false;
      const s = String(iso);
      return s.startsWith(todayPrefix) || s.startsWith(localTodayPrefix);
    };

    const activeBooks = books.filter((b) => b.status !== 'archived');
    const activeCopies = copies.filter((c) => c.status !== 'archived');
    const availableCopies = activeCopies.filter((c) => c.status === 'available').length;
    const issuedCopies = activeCopies.filter((c) => c.status === 'issued').length;
    const activeLoans = loans.filter((l) => l.status !== 'returned');
    const overdueLoans = activeLoans.filter((l) => new Date(l.dueAt) < now);
    const fineGenerated = fines.reduce((sum, f) => sum + Number(f.amount || 0), 0);
    const fineCollectedFromPayments = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const fineCollectedFromFines = fines.reduce((sum, f) => sum + Number(f.paidAmount || 0), 0);
    const fineCollected = Math.max(fineCollectedFromPayments, fineCollectedFromFines);
    const unpaidFines = fines.reduce(
      (sum, f) => sum + Math.max(0, Number(f.amount || 0) - Number(f.paidAmount || 0) - Number(f.waivedAmount || 0)),
      0
    );
    const bookMap = new Map(books.map((b) => [b.id, b]));
    const copyMap = new Map(copies.map((c) => [c.id, c]));
    const studentMap = new Map(students.map((s) => [s.id, s]));

    const recentTransactions = loans
      .sort((a, b) => String(b.issuedAt || b.createdAt || '').localeCompare(String(a.issuedAt || a.createdAt || '')))
      .slice(0, 10)
      .map((l) => ({
        ...l,
        bookTitle: bookMap.get(l.bookId)?.title || 'Book',
        barcode: copyMap.get(l.bookCopyId)?.barcode || l.barcode || '',
        studentName: studentMap.get(l.studentId)?.fullName || 'Student',
        studentRoll: studentMap.get(l.studentId)?.collegeRollNumber || '',
      }));

    const todayVisitors = attendance.filter((a) => isToday(a.checkInAt)).length;
    const todayIssued = loans.filter((l) => isToday(l.issuedAt)).length;
    const todayReturned = loans.filter((l) => isToday(l.returnedAt)).length;

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
          totalBookTitles: activeBooks.length,
          totalPhysicalCopies: activeCopies.length,
          totalBooks: activeBooks.length,
          totalCopies: activeCopies.length,
          availableCopies,
          issuedCopies,
          activeLoans: activeLoans.length,
          overdueBooks: overdueLoans.length,
          overdueLoans: overdueLoans.length,
          activeReservations: reservations.filter((r) => ['queued', 'ready'].includes(r.status)).length,
          todayVisitors,
          todayCheckIns: todayVisitors,
          todayIssued,
          todayReturned,
          fineGenerated: Number(fineGenerated.toFixed(2)),
          fineCollected: Number(fineCollected.toFixed(2)),
          unpaidFines: Number(unpaidFines.toFixed(2)),
        },
        recentTransactions,
        recentLoans: recentTransactions,
        overdueList: overdueLoans.slice(0, 10).map((l) => ({
          ...l,
          bookTitle: bookMap.get(l.bookId)?.title || 'Book',
          barcode: copyMap.get(l.bookCopyId)?.barcode || '',
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
        if (ctx.profile.isSuperAdmin) {
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
        }
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
    const [org, allStudents, books, copies, allLoans, allFines, allPayments, allAttendance] = await Promise.all([
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
    const rangeParam = (searchParams.get('range') || '30d').toLowerCase();
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const courseFilter = (searchParams.get('courseId') || '').trim();

    let startDate = new Date(now);
    let endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);

    if (rangeParam === 'custom' && fromParam && toParam) {
      const parsedFrom = new Date(`${fromParam}T00:00:00`);
      const parsedTo = new Date(`${toParam}T23:59:59.999`);
      if (!Number.isNaN(parsedFrom.getTime())) startDate = parsedFrom;
      if (!Number.isNaN(parsedTo.getTime())) endDate = parsedTo;
    } else if (rangeParam === '7d') {
      startDate.setDate(startDate.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);
    } else if (rangeParam === '90d') {
      startDate.setDate(startDate.getDate() - 89);
      startDate.setHours(0, 0, 0, 0);
    } else if (rangeParam === 'year') {
      startDate.setMonth(startDate.getMonth() - 11, 1);
      startDate.setHours(0, 0, 0, 0);
    } else {
      startDate.setDate(startDate.getDate() - 29);
      startDate.setHours(0, 0, 0, 0);
    }

    const inRange = (iso?: string | null) => {
      if (!iso) return false;
      const d = new Date(iso);
      return !Number.isNaN(d.getTime()) && d >= startDate && d <= endDate;
    };

    // Course-wise filtering across students, loans, fines, payments, and attendance
    const students = courseFilter
      ? allStudents.filter((s) => s.courseId === courseFilter)
      : allStudents;
    const allowedStudentIds = new Set(students.map((s) => s.id));
    const loans = courseFilter ? allLoans.filter((l) => allowedStudentIds.has(l.studentId)) : allLoans;
    const fines = courseFilter ? allFines.filter((f) => allowedStudentIds.has(f.studentId)) : allFines;
    const fineIdSet = new Set(fines.map((f) => f.id));
    const payments = courseFilter
      ? allPayments.filter((p) => (p.studentId ? allowedStudentIds.has(p.studentId) : fineIdSet.has(p.fineId)))
      : allPayments;
    const attendance = courseFilter
      ? allAttendance.filter((a) => allowedStudentIds.has(a.studentId))
      : allAttendance;

    const activeBooks = books.filter((b) => b.status !== 'archived');
    const activeCopies = copies.filter((c) => c.status !== 'archived');
    const activeLoans = loans.filter((l) => l.status !== 'returned');
    const overdueLoans = activeLoans.filter((l) => new Date(l.dueAt) < now);

    const issuesInRangeList = loans.filter((l) => inRange(l.issuedAt || l.createdAt));
    const returnsInRangeList = loans.filter((l) => l.status === 'returned' && inRange(l.returnedAt));
    const visitsInRangeList = attendance.filter((a) => inRange(a.checkInAt || a.createdAt));
    const finesInRangeList = fines.filter((f) => inRange(f.createdAt));
    const paymentsInRangeList = payments.filter((p) => inRange(p.paidAt || p.createdAt));

    const fineGenerated = finesInRangeList.reduce((s, f) => s + Number(f.amount || 0), 0);
    const fineCollectedPayments = paymentsInRangeList.reduce((s, p) => s + Number(p.amount || 0), 0);
    const fineCollectedFines = finesInRangeList.reduce((s, f) => s + Number(f.paidAmount || 0), 0);
    const fineCollected = Math.max(fineCollectedPayments, fineCollectedFines);
    const totalPending = fines.reduce(
      (s, f) => s + Math.max(0, Number(f.amount || 0) - Number(f.paidAmount || 0) - Number(f.waivedAmount || 0)),
      0
    );

    const fmtDayKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const fmtMonthKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const fmtMonthLabel = (ym: string) => {
      const [y, m] = ym.split('-').map(Number);
      return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    };

    // 1. Daily Circulation (up to 31 days within selected range)
    const dailyMap = new Map<string, { issued: number; returned: number; overdue: number }>();
    const totalDaysSpan = Math.min(
      62,
      Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1)
    );
    for (let i = 0; i < totalDaysSpan; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      if (d > endDate) break;
      dailyMap.set(fmtDayKey(d), { issued: 0, returned: 0, overdue: 0 });
    }
    for (const l of issuesInRangeList) {
      const k = fmtDayKey(new Date(l.issuedAt || l.createdAt));
      const b = dailyMap.get(k);
      if (b) {
        b.issued++;
        if (l.status !== 'returned' && new Date(l.dueAt) < now) b.overdue++;
      }
    }
    for (const l of returnsInRangeList) {
      const k = fmtDayKey(new Date(l.returnedAt));
      const b = dailyMap.get(k);
      if (b) b.returned++;
    }
    const dailyCirculation = Array.from(dailyMap.entries()).map(([dateKey, v]) => ({
      date: dateKey.slice(5),
      issued: v.issued,
      returned: v.returned,
      overdue: v.overdue,
    }));

    // Build last 6–12 month buckets covering range
    const monthKeys: string[] = [];
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const minMonthsStart = new Date(endDate.getFullYear(), endDate.getMonth() - 5, 1);
    const monthStart = cursor < minMonthsStart ? cursor : minMonthsStart;
    const iter = new Date(monthStart);
    while (iter <= endDate && monthKeys.length < 13) {
      monthKeys.push(fmtMonthKey(iter));
      iter.setMonth(iter.getMonth() + 1);
    }

    // 2. Monthly Circulation
    const monthlyCircMap = new Map(monthKeys.map((k) => [k, { issued: 0, returned: 0 }]));
    for (const l of loans) {
      const ik = l.issuedAt ? fmtMonthKey(new Date(l.issuedAt)) : '';
      if (monthlyCircMap.has(ik)) monthlyCircMap.get(ik)!.issued++;
      const rk = l.returnedAt ? fmtMonthKey(new Date(l.returnedAt)) : '';
      if (monthlyCircMap.has(rk)) monthlyCircMap.get(rk)!.returned++;
    }
    const monthlyCirculation = monthKeys.map((k) => ({
      month: fmtMonthLabel(k),
      issued: monthlyCircMap.get(k)?.issued || 0,
      returned: monthlyCircMap.get(k)?.returned || 0,
    }));

    // 3. Monthly Student Registrations
    const regMap = new Map(monthKeys.map((k) => [k, 0]));
    for (const s of students) {
      const mk = s.createdAt ? fmtMonthKey(new Date(s.createdAt)) : '';
      if (regMap.has(mk)) regMap.set(mk, (regMap.get(mk) || 0) + 1);
    }
    const monthlyRegistrations = monthKeys.map((k) => ({
      month: fmtMonthLabel(k),
      registrations: regMap.get(k) || 0,
      count: regMap.get(k) || 0,
    }));

    // 4. Course-Wise Membership
    const coursesList: Array<{ id: string; name: string; code: string }> = (org.courses || []).map((c: any) => ({
      id: String(c.id),
      name: String(c.name || ''),
      code: String(c.code || c.name || ''),
    }));
    const courseLookup = new Map<string, { id: string; name: string; code: string }>(
      coursesList.map((c) => [c.id, c])
    );
    const courseCounts = new Map<string, { course: string; code: string; count: number }>();
    for (const s of allStudents) {
      const c = courseLookup.get(s.courseId);
      const key = c?.id || 'unassigned';
      const entry = courseCounts.get(key) || {
        course: c?.name || 'Unassigned',
        code: c?.code || 'GEN',
        count: 0,
      };
      entry.count++;
      courseCounts.set(key, entry);
    }
    const courseWiseMembership = Array.from(courseCounts.values()).sort((a, b) => b.count - a.count);

    // 5. Category Distribution
    const catMap = new Map((org.categories || []).map((c: any) => [c.id, c.name]));
    const catCounts = new Map<string, number>();
    for (const b of activeBooks) {
      const name = String(b.categoryName || catMap.get(b.categoryId) || 'General');
      catCounts.set(name, (catCounts.get(name) || 0) + 1);
    }
    const categoryDistribution = Array.from(catCounts.entries())
      .map(([category, count]) => ({ category, count, name: category, value: count }))
      .sort((a, b) => b.count - a.count);

    // 6. Inventory Breakdown
    const invStatusCounts = new Map<string, number>();
    for (const c of activeCopies) {
      const st = String(c.status || 'available');
      invStatusCounts.set(st, (invStatusCounts.get(st) || 0) + 1);
    }
    const inventoryBreakdown = Array.from(invStatusCounts.entries()).map(([status, count]) => ({
      name: status.charAt(0).toUpperCase() + status.slice(1),
      value: count,
      status: status.charAt(0).toUpperCase() + status.slice(1),
      count,
    }));

    // 7. Monthly Visitors
    const visMap = new Map(monthKeys.map((k) => [k, 0]));
    for (const a of attendance) {
      const mk = a.checkInAt ? fmtMonthKey(new Date(a.checkInAt)) : '';
      if (visMap.has(mk)) visMap.set(mk, (visMap.get(mk) || 0) + 1);
    }
    const monthlyVisitors = monthKeys.map((k) => ({
      month: fmtMonthLabel(k),
      visits: visMap.get(k) || 0,
    }));

    // 8. Peak Visiting Hours (8 AM – 8 PM)
    const hourBuckets = new Map<number, number>();
    for (let h = 8; h <= 20; h++) hourBuckets.set(h, 0);
    for (const a of visitsInRangeList) {
      if (!a.checkInAt) continue;
      const h = new Date(a.checkInAt).getHours();
      if (hourBuckets.has(h)) hourBuckets.set(h, (hourBuckets.get(h) || 0) + 1);
    }
    const peakVisitingHours = Array.from(hourBuckets.entries()).map(([h, visits]) => ({
      hour: `${h > 12 ? h - 12 : h}${h >= 12 ? ' PM' : ' AM'}`,
      visits,
    }));

    // 9. Fine Collection Trends
    const fineTrendMap = new Map(monthKeys.map((k) => [k, { generated: 0, collected: 0 }]));
    for (const f of fines) {
      const mk = f.createdAt ? fmtMonthKey(new Date(f.createdAt)) : '';
      if (fineTrendMap.has(mk)) {
        fineTrendMap.get(mk)!.generated += Number(f.amount || 0);
        fineTrendMap.get(mk)!.collected += Number(f.paidAmount || 0);
      }
    }
    const fineCollectionTrends = monthKeys.map((k) => ({
      month: fmtMonthLabel(k),
      generated: Number((fineTrendMap.get(k)?.generated || 0).toFixed(2)),
      collected: Number((fineTrendMap.get(k)?.collected || 0).toFixed(2)),
    }));

    // 10. Most Borrowed Books (within selected date range + course filter)
    const loanCountByBook = new Map<string, number>();
    for (const l of issuesInRangeList) {
      loanCountByBook.set(l.bookId, (loanCountByBook.get(l.bookId) || 0) + 1);
    }
    const mostBorrowedBooks = activeBooks
      .map((b) => ({
        bookId: b.id,
        title: b.title,
        isbn: b.isbn || '—',
        borrows: loanCountByBook.get(b.id) || 0,
        borrowCount: loanCountByBook.get(b.id) || 0,
      }))
      .filter((b) => b.borrows > 0)
      .sort((a, b) => b.borrows - a.borrows)
      .slice(0, 10);

    // 11. Most Active Students
    const loansByStudent = new Map<string, number>();
    for (const l of issuesInRangeList) {
      loansByStudent.set(l.studentId, (loansByStudent.get(l.studentId) || 0) + 1);
    }
    const visitsByStudent = new Map<string, number>();
    for (const a of visitsInRangeList) {
      visitsByStudent.set(a.studentId, (visitsByStudent.get(a.studentId) || 0) + 1);
    }
    const mostActiveStudents = students
      .map((s) => ({
        studentId: s.id,
        name: s.fullName,
        fullName: s.fullName,
        rollNumber: s.collegeRollNumber,
        borrows: loansByStudent.get(s.id) || 0,
        loans: loansByStudent.get(s.id) || 0,
        visits: visitsByStudent.get(s.id) || 0,
        totalActivity: (loansByStudent.get(s.id) || 0) + (visitsByStudent.get(s.id) || 0),
      }))
      .filter((s) => s.totalActivity > 0)
      .sort((a, b) => b.totalActivity - a.totalActivity)
      .slice(0, 10);

    return {
      handled: true,
      data: {
        range: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        courses: coursesList,
        selectedCourseId: courseFilter || null,
        summary: {
          totalStudents: students.length,
          activeStudents: students.filter((s) => s.status === 'active').length,
          totalBooks: activeBooks.length,
          totalCopies: activeCopies.length,
          availableCopies: activeCopies.filter((c) => c.status === 'available').length,
          issuedCopies: activeCopies.filter((c) => c.status === 'issued').length,
          overdueBooks: overdueLoans.length,
          issuesInRange: issuesInRangeList.length,
          returnsInRange: returnsInRangeList.length,
          totalVisits: visitsInRangeList.length,
          fineGenerated: Number(fineGenerated.toFixed(2)),
          fineCollected: Number(fineCollected.toFixed(2)),
          totalLoans: loans.length,
          activeLoans: activeLoans.length,
          overdueLoans: overdueLoans.length,
          returnedLoans: loans.filter((l) => l.status === 'returned').length,
          totalFinesCollected: Number(fineCollected.toFixed(2)),
          totalFinesPending: Number(totalPending.toFixed(2)),
        },
        dailyCirculation,
        monthlyCirculation,
        monthlyRegistrations,
        courseWiseMembership,
        categoryDistribution,
        inventoryBreakdown,
        monthlyVisitors,
        peakVisitingHours,
        fineCollectionTrends,
        mostBorrowedBooks,
        mostActiveStudents,
        categoryBreakdown: categoryDistribution.map((c) => ({ category: c.name, count: c.value })),
        topBooks: mostBorrowedBooks.map((b) => ({ id: b.bookId, title: b.title, isbn: b.isbn, borrowCount: b.borrowCount })),
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
        safeListDocs<Record<string, any>>('founderIdentities', [
          where('linkedOrganizationId', '==', ctx.orgId),
        ]).catch(() => []),
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

    const defaultCourseId = body?.defaultCourseId || null;
    const defaultSemesterId = body?.defaultSemesterId || null;
    const defaultAcademicSessionId = body?.defaultAcademicSessionId || null;
    const autoGenerateId = body?.autoGenerateId !== false;

    const orgCourses = org.courses || [];
    const courseById = new Map<string, any>(orgCourses.map((c: any) => [c.id, c]));

    const resolveCourse = (rawLabel?: string | null) => {
      const label = String(rawLabel || '').trim().toLowerCase();
      if (label) {
        const matched = orgCourses.find(
          (c: any) =>
            String(c.code || '').toLowerCase() === label ||
            String(c.name || '').toLowerCase() === label ||
            String(c.name || '').toLowerCase().includes(label)
        );
        if (matched) return matched;
      }
      if (defaultCourseId && courseById.has(defaultCourseId)) {
        return courseById.get(defaultCourseId);
      }
      return null;
    };

    const policy = await getPlatformPasswordPolicyDoc();
    const existing = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`);
    const existingRolls = new Set(existing.map((s) => String(s.collegeRollNumber || '').toLowerCase()));
    const existingEmails = new Set(existing.map((s) => normalizeEmail(String(s.email || ''))));

    const created: any[] = [];
    const failed: Array<{
      rowNumber: number;
      fullName: string;
      collegeRollNumber: string;
      email: string;
      reason: string;
    }> = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const fullName = String(r.fullName || r.name || '').trim();
      const roll = String(r.collegeRollNumber || r.rollNumber || r.studentId || '').trim();
      const rawEmail = String(r.email || '').trim();
      const email = normalizeEmail(
        rawEmail || `${roll.toLowerCase().replace(/[^a-z0-9]/g, '')}@${String(org.code || 'college').toLowerCase()}.edu`
      );
      if (!fullName || !roll) {
        failed.push({
          rowNumber: i + 1,
          fullName,
          collegeRollNumber: roll,
          email,
          reason: 'Missing Name or Roll Number',
        });
        continue;
      }
      if (existingRolls.has(roll.toLowerCase())) {
        failed.push({
          rowNumber: i + 1,
          fullName,
          collegeRollNumber: roll,
          email,
          reason: `Duplicate Roll Number: ${roll}`,
        });
        continue;
      }
      if (existingEmails.has(email)) {
        failed.push({
          rowNumber: i + 1,
          fullName,
          collegeRollNumber: roll,
          email,
          reason: `Duplicate Email: ${email}`,
        });
        continue;
      }

      const providedPwd = String(r.password || '').trim();
      const passwordAutoGenerated = !providedPwd;
      const rawPwd = providedPwd || generatePolicyCompliantPassword(policy);
      const matchedCourse = resolveCourse(r.departmentOrCourse || r.course || r.department);
      const courseLabel =
        matchedCourse?.name ||
        String(r.departmentOrCourse || r.course || r.department || 'General').trim() ||
        'General';

      try {
        const res = await createSingleStudentInOrg(
          org,
          {
            fullName,
            fatherName: r.fatherName || 'N/A',
            collegeRollNumber: roll,
            email,
            phone: r.phone || 'N/A',
            courseId: r.courseId || matchedCourse?.id || defaultCourseId || null,
            semesterId: r.semesterId || defaultSemesterId || null,
            departmentId: r.departmentId || matchedCourse?.departmentId || null,
            academicSessionId: r.academicSessionId || defaultAcademicSessionId || null,
            autoGenerateId,
            password: rawPwd,
          },
          ctx.roleSlug
        );
        existingRolls.add(roll.toLowerCase());
        existingEmails.add(email);
        created.push({
          rowNumber: i + 1,
          id: res.student.id,
          studentId: res.student.id,
          fullName: res.student.fullName,
          studentIdCode: res.student.studentIdCode,
          collegeRollNumber: res.student.collegeRollNumber,
          departmentOrCourse: courseLabel,
          courseId: res.student.courseId || null,
          courseCode: matchedCourse?.code || courseLabel,
          email: res.student.email,
          loginId: res.student.email,
          password: rawPwd,
          passwordAutoGenerated,
          phone: res.student.phone || '',
          cardNumber: res.idCard?.cardNumber || null,
        });
      } catch (err: any) {
        failed.push({
          rowNumber: i + 1,
          fullName,
          collegeRollNumber: roll,
          email,
          reason: err?.message || 'Failed to create student',
        });
      }
    }

    return {
      handled: true,
      data: {
        created,
        failed,
        errors: failed,
        summary: {
          total: rows.length,
          createdCount: created.length,
          failedCount: failed.length,
        },
        createdCount: created.length,
        failedCount: failed.length,
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

  // Student applications (with accurate status tab filtering & academic enrichment)
  if (pathname === '/org/student-applications' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const [org, rawApps] = await Promise.all([
      loadOrg(ctx.orgId),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/studentApplications`),
    ]);
    const statusFilter = (searchParams.get('status') || '').trim().toLowerCase();
    const courseMap = new Map((org.courses || []).map((c: any) => [c.id, c.name]));
    const semMap = new Map((org.semesters || []).map((s: any) => [s.id, s.name]));
    const deptMap = new Map((org.departments || []).map((d: any) => [d.id, d.name]));
    const sessMap = new Map((org.academicSessions || []).map((s: any) => [s.id, s.name]));

    const filtered = rawApps
      .filter((a) => !statusFilter || statusFilter === 'all' || String(a.status || 'pending').toLowerCase() === statusFilter)
      .map((a): Record<string, any> => ({
        ...a,
        courseName: courseMap.get(a.courseId) || null,
        semesterName: semMap.get(a.semesterId) || null,
        departmentName: deptMap.get(a.departmentId) || null,
        sessionName: sessMap.get(a.academicSessionId) || null,
      }))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return { handled: true, data: { applications: filtered } };
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
    const org = await loadOrg(ctx.orgId);
    const shelfById = new Map<string, any>((org.shelves || []).map((s: any) => [s.id, s]));
    const authorById = new Map<string, any>((org.authors || []).map((a: any) => [a.id, a]));
    const bookMap = new Map(books.map((b) => [b.id, b]));
    const stuMap = new Map(students.map((s) => [s.id, s]));

    const compactCode = extractCompactCode(rawCode);
    const lower = compactCode.toLowerCase();
    const cleanIsbn = normalizeIsbn(compactCode);
    let matchedBy: 'barcode' | 'accession' | 'isbn' | 'title' = 'barcode';

    // 1. Direct physical barcode or accession match
    let matchedCopy = copies.find((c) => String(c.barcode || '').toLowerCase() === lower);
    if (!matchedCopy) {
      matchedCopy = copies.find((c) => String(c.accessionNumber || '').toLowerCase() === lower);
      if (matchedCopy) matchedBy = 'accession';
    }

    // 2. Fallback to ISBN match on books
    let matchedBook: Record<string, any> | null = matchedCopy ? bookMap.get(matchedCopy.bookId) || null : null;
    if (!matchedCopy && cleanIsbn.length >= 10) {
      matchedBook = books.find((b) => normalizeIsbn(b.isbn) === cleanIsbn) || null;
      if (matchedBook) {
        matchedBy = 'isbn';
        const bCopies = copies.filter((c) => c.bookId === matchedBook!.id && c.status !== 'archived');
        matchedCopy =
          (mode === 'return'
            ? bCopies.find((c) => c.status === 'issued')
            : bCopies.find((c) => c.status === 'available')) || bCopies[0];
      }
    }

    // 3. Fallback to Title search
    if (!matchedCopy) {
      matchedBook = books.find((b) => String(b.title || '').toLowerCase().includes(lower)) || null;
      if (matchedBook) {
        matchedBy = 'title';
        const bCopies = copies.filter((c) => c.bookId === matchedBook!.id && c.status !== 'archived');
        matchedCopy =
          (mode === 'return'
            ? bCopies.find((c) => c.status === 'issued')
            : bCopies.find((c) => c.status === 'available')) || bCopies[0];
      }
    }

    if (!matchedCopy) {
      throw new BackendError(`No book copy found matching "${compactCode}".`, 404);
    }

    const bookRaw = matchedBook || bookMap.get(matchedCopy.bookId) || null;
    const book = bookRaw
      ? {
          ...bookRaw,
          authorName: bookRaw.authorName || authorById.get(bookRaw.authorId)?.name || 'Unknown Author',
        }
      : null;

    const enrichCopy = (c: Record<string, any>): Record<string, any> => {
      const shelf = c.shelfId ? shelfById.get(c.shelfId) : null;
      const loan = loans.find((l) => l.bookCopyId === c.id && l.status !== 'returned') || null;
      const borrower = loan ? stuMap.get(loan.studentId) || null : null;
      return {
        ...c,
        rackCode: shelf?.rackCode || null,
        shelfCode: shelf?.shelfCode || null,
        activeLoan: loan
          ? {
              ...loan,
              loanId: loan.id,
              studentName: borrower?.fullName || 'Student',
              studentRoll: borrower?.collegeRollNumber || '',
              studentIdCode: borrower?.studentIdCode || '',
              rollNumber: borrower?.collegeRollNumber || '',
            }
          : null,
      };
    };

    const allBookCopies = copies
      .filter((c) => c.bookId === matchedCopy!.bookId && c.status !== 'archived')
      .map(enrichCopy);
    const enrichedCopy = allBookCopies.find((c) => c.id === matchedCopy!.id) || enrichCopy(matchedCopy);
    const inventory = {
      total: allBookCopies.length,
      available: allBookCopies.filter((c) => c.status === 'available').length,
      issued: allBookCopies.filter((c) => c.status === 'issued').length,
      reserved: allBookCopies.filter((c) => c.status === 'reserved').length,
    };

    const statusMessage =
      enrichedCopy.status === 'available'
        ? `Copy ${enrichedCopy.barcode} is available and ready to issue.`
        : enrichedCopy.status === 'issued'
          ? `Copy ${enrichedCopy.barcode} is currently issued to ${enrichedCopy.activeLoan?.studentName || 'a student'}. You can return or reassign it below.`
          : `Copy ${enrichedCopy.barcode} is currently marked as ${enrichedCopy.status}.`;

    return {
      handled: true,
      data: {
        type: 'book_copy',
        matchedBy,
        statusMessage,
        copy: enrichedCopy,
        copies: allBookCopies,
        book,
        inventory,
        activeLoan: enrichedCopy.activeLoan,
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

  // Circulation: resolve student, issue, reassign, return, renew, list loans
  if (pathname === '/org/circulation/resolve-student' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const rawQ = searchParams.get('q') || '';
    const q = extractCompactCode(rawQ).toLowerCase();
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

    if (!student) throw new BackendError(`No student found matching "${extractCompactCode(rawQ)}".`, 404);

    const activeLoansCount = loans.filter((l) => l.studentId === student.id && l.status !== 'returned').length;
    const outstandingFines = fines
      .filter((f) => f.studentId === student.id)
      .reduce((sum, f) => sum + Math.max(0, Number(f.amount || 0) - Number(f.paidAmount || 0) - Number(f.waivedAmount || 0)), 0);
    const cat = (org.studentCategories || []).find((c: any) => c.id === student.studentCategoryId);
    const maxBooksAllowed = Number(cat?.maxBooksAllowed || org.settings?.maxBooksPerStudent || 4);
    const maxFine = Number(org.settings?.maxOutstandingFineForBorrow || 100);
    const defaultLoanDays = Number(cat?.loanDurationDays || org.settings?.defaultLoanDays || 14);

    const reasons: string[] = [];
    if (student.status !== 'active') reasons.push(`Student account is ${student.status}.`);
    if (activeLoansCount >= maxBooksAllowed) reasons.push(`Borrowing limit reached (${activeLoansCount}/${maxBooksAllowed}).`);
    if (outstandingFines > maxFine) reasons.push(`Outstanding fines (${outstandingFines.toFixed(2)}) exceed threshold (${maxFine}).`);

    return {
      handled: true,
      data: {
        student,
        eligibility: {
          eligible: reasons.length === 0,
          reasons,
          blockReason: reasons[0] || null,
          activeLoansCount,
          maxBooksAllowed,
          outstandingFines: Number(outstandingFines.toFixed(2)),
          outstandingFine: Number(outstandingFines.toFixed(2)),
          defaultLoanDays,
          loanDurationDays: defaultLoanDays,
        },
      },
    };
  }

  if (pathname === '/org/circulation/issue' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const [org, student, copy, existingLoans] = await Promise.all([
      loadOrg(ctx.orgId),
      safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/students/${body?.studentId}`),
      safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/bookCopies/${body?.bookCopyId}`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/loans`),
    ]);
    if (!student) throw new BackendError('Student not found.', 404);
    if (!copy) throw new BackendError('Book copy not found.', 404);
    if (student.status !== 'active') {
      throw new BackendError(`Cannot issue book: student account is ${student.status}.`, 400);
    }
    const existingActiveForCopy = existingLoans.find((l) => l.bookCopyId === copy.id && l.status !== 'returned');
    if (copy.status !== 'available' || existingActiveForCopy) {
      throw new BackendError(`Book copy ${copy.barcode} is already ${copy.status === 'available' ? 'allocated to an active loan' : copy.status}.`, 409);
    }
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

    const receipt = {
      receiptNumber,
      issuedAt: ts,
      dueAt: dueAt.toISOString(),
      bookTitle: book?.title || 'Book',
      barcode: copy.barcode,
      studentName: student.fullName,
      studentIdCode: student.studentIdCode || student.collegeRollNumber || '',
    };

    return {
      handled: true,
      data: {
        loan: { ...loanDoc, bookTitle: book?.title || 'Book', studentName: student.fullName, barcode: copy.barcode },
        receipt,
        message: 'Book issued successfully.',
      },
    };
  }

  // Atomic Reassign of an currently-issued book copy to another eligible student
  if (pathname === '/org/circulation/reassign' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const bookCopyId = String(body?.bookCopyId || '').trim();
    const newStudentId = String(body?.studentId || '').trim();
    if (!bookCopyId || !newStudentId) {
      throw new BackendError('Book copy and target student are required for reassignment.', 400);
    }

    const [org, newStudent, copy, allLoans] = await Promise.all([
      loadOrg(ctx.orgId),
      safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/students/${newStudentId}`),
      safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/bookCopies/${bookCopyId}`),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/loans`),
    ]);
    if (!newStudent) throw new BackendError('Target student not found.', 404);
    if (!copy) throw new BackendError('Book copy not found.', 404);
    if (newStudent.status !== 'active') {
      throw new BackendError(`Cannot reassign: target student account is ${newStudent.status}.`, 400);
    }

    const activeLoan = allLoans.find((l) => l.bookCopyId === copy.id && l.status !== 'returned');
    if (!activeLoan) {
      throw new BackendError('This book copy has no active loan to reassign. Use Issue instead.', 409);
    }
    if (activeLoan.studentId === newStudent.id) {
      throw new BackendError('This book copy is already issued to the selected student.', 409);
    }

    const cat = (org.studentCategories || []).find((c: any) => c.id === newStudent.studentCategoryId);
    const maxBooks = Number(cat?.maxBooksAllowed || org.settings?.maxBooksPerStudent || 4);
    const studentActiveLoans = allLoans.filter((l) => l.studentId === newStudent.id && l.status !== 'returned').length;
    if (studentActiveLoans >= maxBooks) {
      throw new BackendError(`${newStudent.fullName} has already reached the borrowing limit (${studentActiveLoans}/${maxBooks}).`, 409);
    }

    const book = await safeGetDoc<Record<string, any>>(`organizations/${ctx.orgId}/books/${copy.bookId}`);
    const ts = nowIso();
    const dueDays = Number(body?.dueDays || cat?.loanDurationDays || org.settings?.defaultLoanDays || 14);
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + dueDays);
    const newLoanId = makeId('ln');
    const receiptNumber = `RCP-${Date.now().toString().slice(-6)}`;

    // 1. Close previous loan cleanly
    await safeUpdateDoc(`organizations/${ctx.orgId}/loans/${activeLoan.id}`, {
      status: 'returned',
      returnedAt: ts,
      conditionOnReturn: 'reassigned',
      updatedAt: ts,
    });

    // 2. Create new loan for target student
    const newLoanDoc = {
      id: newLoanId,
      organizationId: ctx.orgId,
      studentId: newStudent.id,
      studentUserId: newStudent.userId || null,
      bookId: copy.bookId,
      bookCopyId: copy.id,
      receiptNumber,
      issuedAt: ts,
      dueAt: dueAt.toISOString(),
      returnedAt: null,
      renewalCount: 0,
      status: 'issued',
      issuedByUid: ctx.fbUser.uid,
      reassignedFromLoanId: activeLoan.id,
      createdAt: ts,
      updatedAt: ts,
    };
    await safeSetDoc(`organizations/${ctx.orgId}/loans/${newLoanId}`, newLoanDoc);
    await safeUpdateDoc(`organizations/${ctx.orgId}/bookCopies/${copy.id}`, {
      status: 'issued',
      updatedAt: ts,
    });

    if (newStudent.userId) {
      await createUserNotification({
        recipientUid: newStudent.userId,
        organizationId: ctx.orgId,
        type: 'book_issued',
        title: 'Book Assigned to Your Account',
        message: `"${book?.title || 'Book'}" (Barcode: ${copy.barcode}) was assigned to you. Due on ${dueAt.toLocaleDateString()}.`,
        entityType: 'loan',
        entityId: newLoanId,
      });
    }

    await writeOrgAudit({
      organizationId: ctx.orgId,
      actorRole: ctx.roleSlug,
      action: 'book_reassigned',
      entityType: 'loan',
      entityId: newLoanId,
      details: { previousLoanId: activeLoan.id, previousStudentId: activeLoan.studentId, newStudentId: newStudent.id, barcode: copy.barcode },
    });

    return {
      handled: true,
      data: {
        loan: { ...newLoanDoc, bookTitle: book?.title || 'Book', studentName: newStudent.fullName, barcode: copy.barcode },
        receipt: {
          receiptNumber,
          issuedAt: ts,
          dueAt: dueAt.toISOString(),
          bookTitle: book?.title || 'Book',
          barcode: copy.barcode,
          studentName: newStudent.fullName,
          studentIdCode: newStudent.studentIdCode || newStudent.collegeRollNumber || '',
        },
        message: `Book copy ${copy.barcode} reassigned to ${newStudent.fullName}.`,
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
    const nowDate = new Date();
    const localTodayPrefix = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;
    const isTodayDate = (iso?: string | null) =>
      Boolean(iso) && (String(iso).startsWith(todayPrefix) || String(iso).startsWith(localTodayPrefix));

    return {
      handled: true,
      data: {
        entries: enriched,
        stats: {
          todayTotal: enriched.filter((e) => isTodayDate(e.checkInAt)).length,
          currentlyInside: enriched.filter((e) => !e.checkOutAt).length,
          checkedOutToday: enriched.filter((e) => Boolean(e.checkOutAt) && isTodayDate(e.checkOutAt)).length,
          totalVisits: enriched.length,
        },
      },
    };
  }

  if (pathname === '/org/attendance/scan' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const compact = extractCompactCode(String(body?.code || body?.query || ''));
    const code = compact.toLowerCase();
    if (!code) throw new BackendError('Please scan a Student QR code or enter Roll Number / Student ID.', 400);

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
    if (!stu) throw new BackendError(`No student found matching "${compact}".`, 404);

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

  // Migration Center (supports College Admin & Librarian with full dry-run validation)
  if (pathname === '/org/migrations/history' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const runs = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/migrations`);
    runs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return { handled: true, data: { runs } };
  }

  if (pathname === '/org/migrations/validate' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const importType = String(body?.importType || 'books');
    const rows = Array.isArray(body?.rows) ? body.rows : [];

    const validRows: Array<{ rowNumber: number; data: Record<string, any> }> = [];
    const duplicateRows: Array<{ rowNumber: number; reason: string; raw: Record<string, any> }> = [];
    const errorRows: Array<{ rowNumber: number; errors: string[]; raw: Record<string, any> }> = [];

    if (importType === 'books') {
      const existingBooks = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/books`);
      const existingIsbns = new Set(existingBooks.map((b) => normalizeIsbn(b.isbn)).filter(Boolean));
      const seenIsbns = new Set<string>();

      rows.forEach((raw: Record<string, any>, idx: number) => {
        const rowNumber = idx + 1;
        const title = String(raw?.title || '').trim();
        const isbn = normalizeIsbn(raw?.isbn);
        const errs: string[] = [];
        if (!title) errs.push('Missing book title');
        if (errs.length > 0) {
          errorRows.push({ rowNumber, errors: errs, raw });
          return;
        }
        if (isbn && (existingIsbns.has(isbn) || seenIsbns.has(isbn))) {
          duplicateRows.push({ rowNumber, reason: `Duplicate ISBN ${isbn}`, raw });
          return;
        }
        if (isbn) seenIsbns.add(isbn);
        validRows.push({ rowNumber, data: { ...raw, title, isbn: raw?.isbn || '' } });
      });
    } else if (importType === 'students') {
      const existingStudents = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`);
      const existingRolls = new Set(existingStudents.map((s) => String(s.collegeRollNumber || '').toLowerCase()));
      const existingEmails = new Set(existingStudents.map((s) => normalizeEmail(String(s.email || ''))));
      const seenRolls = new Set<string>();
      const seenEmails = new Set<string>();

      rows.forEach((raw: Record<string, any>, idx: number) => {
        const rowNumber = idx + 1;
        const fullName = String(raw?.fullName || raw?.name || '').trim();
        const roll = String(raw?.collegeRollNumber || raw?.rollNumber || '').trim();
        const email = normalizeEmail(String(raw?.email || ''));
        const errs: string[] = [];
        if (!fullName) errs.push('Missing fullName');
        if (!roll) errs.push('Missing collegeRollNumber');
        if (!email) errs.push('Missing email');
        if (errs.length > 0) {
          errorRows.push({ rowNumber, errors: errs, raw });
          return;
        }
        if (existingRolls.has(roll.toLowerCase()) || seenRolls.has(roll.toLowerCase())) {
          duplicateRows.push({ rowNumber, reason: `Duplicate roll number ${roll}`, raw });
          return;
        }
        if (existingEmails.has(email) || seenEmails.has(email)) {
          duplicateRows.push({ rowNumber, reason: `Duplicate email ${email}`, raw });
          return;
        }
        seenRolls.add(roll.toLowerCase());
        seenEmails.add(email);
        validRows.push({ rowNumber, data: { ...raw, fullName, collegeRollNumber: roll, email } });
      });
    } else {
      rows.forEach((raw: Record<string, any>, idx: number) => {
        const rowNumber = idx + 1;
        const hasValues = Object.values(raw || {}).some((v) => String(v || '').trim() !== '');
        if (!hasValues) {
          errorRows.push({ rowNumber, errors: ['Empty row'], raw });
        } else {
          validRows.push({ rowNumber, data: raw });
        }
      });
    }

    return {
      handled: true,
      data: {
        totalRows: rows.length,
        validCount: validRows.length,
        duplicateCount: duplicateRows.length,
        errorCount: errorRows.length,
        validRows,
        duplicateRows,
        errorRows,
      },
    };
  }

  if (pathname === '/org/migrations/commit' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    const rawRows = Array.isArray(body?.validRows)
      ? body.validRows
      : Array.isArray(body?.rows)
        ? body.rows
        : [];
    const importType = String(body?.importType || 'books');
    let importedCount = 0;
    let skippedCount = 0;

    if (importType === 'books') {
      for (const item of rawRows) {
        const r = item?.data && typeof item.data === 'object' ? item.data : item;
        if (!r?.title) {
          skippedCount++;
          continue;
        }
        try {
          await createBookWithCopies(ctx.orgId, r, ctx.roleSlug);
          importedCount++;
        } catch {
          skippedCount++;
        }
      }
    } else if (importType === 'students') {
      for (const item of rawRows) {
        const r = item?.data && typeof item.data === 'object' ? item.data : item;
        if (!r?.fullName && !r?.name) {
          skippedCount++;
          continue;
        }
        try {
          await createSingleStudentInOrg(org, r, ctx.roleSlug);
          importedCount++;
        } catch {
          skippedCount++;
        }
      }
    } else if (importType === 'book_copies') {
      const books = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/books`);
      const bookByIsbn = new Map(books.map((b) => [normalizeIsbn(b.isbn), b]));
      for (const item of rawRows) {
        const r = item?.data && typeof item.data === 'object' ? item.data : item;
        const book = bookByIsbn.get(normalizeIsbn(r?.isbn));
        if (!book || !r?.barcode) {
          skippedCount++;
          continue;
        }
        const copyId = makeId('cpy');
        const ts = nowIso();
        await safeSetDoc(`organizations/${ctx.orgId}/bookCopies/${copyId}`, {
          id: copyId,
          organizationId: ctx.orgId,
          bookId: book.id,
          barcode: String(r.barcode).trim(),
          accessionNumber: String(r.accessionNumber || `ACC-${Date.now().toString().slice(-5)}`),
          condition: String(r.condition || 'good'),
          status: 'available',
          createdAt: ts,
          updatedAt: ts,
        });
        importedCount++;
      }
    }

    const runId = makeId('mig');
    const run = {
      id: runId,
      organizationId: ctx.orgId,
      importType,
      fileName: body?.fileName || 'import.csv',
      totalRows: Number(body?.totalRows || rawRows.length),
      validRows: rawRows.length,
      importedRows: importedCount,
      importedCount,
      skippedRows: Number(body?.duplicateCount || 0) + skippedCount,
      failedRows: Number(body?.errorCount || 0),
      status: 'completed',
      createdAt: nowIso(),
    };
    await safeSetDoc(`organizations/${ctx.orgId}/migrations/${runId}`, run);
    return {
      handled: true,
      data: {
        run,
        importedCount,
        message: `Successfully imported ${importedCount} record(s) into Cloud Firestore.`,
      },
    };
  }

  // Notification Center (accessible to Admin, Librarian & Student with real providers + deliveries)
  if (pathname === '/org/notifications/center' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian', 'student']);
    const [org, notifs] = await Promise.all([
      loadOrg(ctx.orgId),
      safeListDocs<Record<string, any>>('notifications', [where('recipientUid', '==', ctx.fbUser.uid)]),
    ]);
    const defaultCategories = {
      registration: true,
      id_status: true,
      circulation: true,
      due_reminders: true,
      overdue: true,
      reservations: true,
      fines: true,
      attendance: true,
      announcements: true,
    };
    const storedPrefs = org.notificationPreferences || {};
    const preferences = {
      inAppEnabled: storedPrefs.inAppEnabled ?? true,
      emailEnabled: Boolean(storedPrefs.emailEnabled),
      pushEnabled: Boolean(storedPrefs.pushEnabled ?? storedPrefs.webPushEnabled),
      dueReminderDaysBefore: Number(storedPrefs.dueReminderDaysBefore ?? 2),
      overdueDigestEnabled: storedPrefs.overdueDigestEnabled ?? true,
      categories: { ...defaultCategories, ...(storedPrefs.categories || {}) },
    };
    const templates = (org.notificationTemplates || []).map((t: any) => ({
      ...t,
      isEnabled: t.isEnabled ?? t.isActive ?? true,
    }));
    const deliveries = (Array.isArray(org.notificationDeliveries) ? org.notificationDeliveries : []).map(
      (d: any) => ({
        id: d.id || makeId('dlv'),
        recipientEmail: d.recipientEmail || d.recipientAddress || 'In-App Student',
        channel: d.channel || 'in_app',
        status: d.status || 'delivered',
        providerResponse: d.providerResponse || d.errorMessage || d.subject || 'Delivered via Cloud Firestore',
        createdAt: d.createdAt || d.sentAt || nowIso(),
      })
    );
    return {
      handled: true,
      data: {
        notifications: notifs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
        preferences,
        templates,
        deliveries,
        providers: {
          smtpConfigured: false,
          webPushConfigured: false,
          whatsappConfigured: false,
        },
      },
    };
  }

  if (pathname === '/org/notifications/preferences' && (method === 'PUT' || method === 'PATCH')) {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    const nextPrefs = {
      inAppEnabled: true,
      emailEnabled: false,
      pushEnabled: false,
      dueReminderDaysBefore: 2,
      overdueDigestEnabled: true,
      categories: {},
      ...(org.notificationPreferences || {}),
      ...(body || {}),
    };
    await safeUpdateDoc(`organizations/${ctx.orgId}`, {
      notificationPreferences: nextPrefs,
      updatedAt: nowIso(),
    });
    return { handled: true, data: { preferences: nextPrefs } };
  }

  if (pathname === '/org/notifications/announce' && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const [org, students] = await Promise.all([
      loadOrg(ctx.orgId),
      safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/students`),
    ]);
    const title = String(body?.title || 'Library Announcement').trim();
    const message = String(body?.message || '').trim();
    if (!title || !message) {
      throw new BackendError('Announcement title and message are required.', 400);
    }

    let count = 0;
    const newLogs: any[] = [];
    const ts = nowIso();
    for (const s of students) {
      if (!s.userId) continue;
      await createUserNotification({
        recipientUid: s.userId,
        organizationId: ctx.orgId,
        type: 'announcement',
        title,
        message,
      });
      count++;
      if (newLogs.length < 25) {
        newLogs.push({
          id: makeId('dlv'),
          channel: 'in_app',
          recipientEmail: s.email || s.fullName,
          subject: title,
          status: 'delivered',
          providerResponse: `In-app notification delivered (${title})`,
          createdAt: ts,
        });
      }
    }

    if (newLogs.length === 0) {
      newLogs.push({
        id: makeId('dlv'),
        channel: 'in_app',
        recipientEmail: 'All Active Students (0 linked accounts)',
        subject: title,
        status: 'skipped',
        providerResponse: 'No student portal accounts linked yet.',
        createdAt: ts,
      });
    }

    const nextDeliveries = [...newLogs, ...(org.notificationDeliveries || [])].slice(0, 80);
    await safeUpdateDoc(`organizations/${ctx.orgId}`, {
      notificationDeliveries: nextDeliveries,
      updatedAt: ts,
    }).catch(() => {});

    return {
      handled: true,
      data: {
        deliveredCount: count,
        message:
          count > 0
            ? `Announcement delivered to ${count} student account(s).`
            : 'Announcement logged (no student portal accounts linked yet).',
      },
    };
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
  const DEFAULT_AUTOMATION_JOBS = [
    { id: 'auto_due_reminders', jobKey: 'due_reminders', name: 'Upcoming Due Reminders', description: 'Notify students 48 hours before a borrowed book is due.', scheduleCron: '0 8 * * *', isEnabled: true, lastRunAt: null, lastStatus: 'idle', lastSummary: null },
    { id: 'auto_overdue_escalation', jobKey: 'overdue_escalation', name: 'Overdue Escalation Alerts', description: 'Flag overdue loans and notify borrowers automatically.', scheduleCron: '0 9 * * *', isEnabled: true, lastRunAt: null, lastStatus: 'idle', lastSummary: null },
    { id: 'auto_reservation_expiry', jobKey: 'reservation_expiry', name: 'Reservation Hold Expiry', description: 'Release expired reservation holds back to circulation.', scheduleCron: '0 * * * *', isEnabled: true, lastRunAt: null, lastStatus: 'idle', lastSummary: null },
  ];

  if (pathname === '/org/automations' && method === 'GET') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    return {
      handled: true,
      data: {
        jobs: Array.isArray(org.automationJobs) && org.automationJobs.length > 0 ? org.automationJobs : DEFAULT_AUTOMATION_JOBS,
        logs: Array.isArray(org.automationLogs) ? org.automationLogs : [],
      },
    };
  }

  const autoToggleMatch = pathname.match(/^\/org\/automations\/([^/]+)$/);
  if (autoToggleMatch && (method === 'PATCH' || method === 'PUT')) {
    const ctx = await requireOrgAccess(orgId, ['college_admin']);
    const org = await loadOrg(ctx.orgId);
    const currentJobs =
      Array.isArray(org.automationJobs) && org.automationJobs.length > 0
        ? org.automationJobs
        : DEFAULT_AUTOMATION_JOBS;
    const nextJobs = currentJobs.map((j: any) =>
      j.id === autoToggleMatch[1] || j.jobKey === autoToggleMatch[1]
        ? { ...j, isEnabled: Boolean(body?.isEnabled) }
        : j
    );
    await safeUpdateDoc(`organizations/${ctx.orgId}`, { automationJobs: nextJobs, updatedAt: nowIso() });
    return { handled: true, data: { ok: true, jobs: nextJobs } };
  }

  const autoRunMatch = pathname.match(/^\/org\/automations\/([^/]+)\/run$/);
  if (autoRunMatch && method === 'POST') {
    const ctx = await requireOrgAccess(orgId, ['college_admin', 'librarian']);
    const org = await loadOrg(ctx.orgId);
    const currentJobs =
      Array.isArray(org.automationJobs) && org.automationJobs.length > 0
        ? org.automationJobs
        : DEFAULT_AUTOMATION_JOBS;
    const targetJob = currentJobs.find(
      (j: any) => j.id === autoRunMatch[1] || j.jobKey === autoRunMatch[1]
    );
    const jobKey = targetJob?.jobKey || autoRunMatch[1];
    const now = new Date();
    const ts = nowIso();

    let processedCount = 0;
    let notificationsSent = 0;
    let summary = '';

    if (jobKey === 'reservation_expiry') {
      const reservations = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/reservations`);
      const holdDays = Number(org.settings?.reservationHoldDays || 3);
      processedCount = reservations.length;
      for (const r of reservations) {
        if (r.status === 'ready') {
          const refDate = new Date(r.expiresAt || r.updatedAt || r.createdAt);
          const expiry = r.expiresAt
            ? refDate
            : new Date(refDate.getTime() + holdDays * 86400_000);
          if (expiry < now) {
            await safeUpdateDoc(`organizations/${ctx.orgId}/reservations/${r.id}`, {
              status: 'expired',
              updatedAt: ts,
            }).catch(() => {});
            notificationsSent++;
          }
        }
      }
      summary = `Checked ${processedCount} reservation(s); expired ${notificationsSent} past-hold reservation(s).`;
    } else if (jobKey === 'due_reminders') {
      const loans = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/loans`);
      const windowHours = Number(org.notificationPreferences?.dueReminderDaysBefore || 2) * 24;
      const horizon = new Date(now.getTime() + windowHours * 3600_000);
      const active = loans.filter((l) => l.status !== 'returned');
      processedCount = active.length;
      for (const l of active) {
        const due = new Date(l.dueAt);
        if (due >= now && due <= horizon && l.studentUserId) {
          await createUserNotification({
            recipientUid: l.studentUserId,
            organizationId: ctx.orgId,
            type: 'due_reminder',
            title: 'Upcoming Book Return Due',
            message: `Reminder: your borrowed book is due on ${due.toLocaleDateString()}. Return or renew in time to avoid fines.`,
            entityType: 'loan',
            entityId: l.id,
          });
          notificationsSent++;
        }
      }
      summary = `Scanned ${processedCount} active loan(s); sent ${notificationsSent} upcoming due reminder(s).`;
    } else {
      const loans = await safeListDocs<Record<string, any>>(`organizations/${ctx.orgId}/loans`);
      const active = loans.filter((l) => l.status !== 'returned');
      processedCount = active.length;
      for (const l of active) {
        if (new Date(l.dueAt) < now) {
          if (l.status !== 'overdue') {
            await safeUpdateDoc(`organizations/${ctx.orgId}/loans/${l.id}`, {
              status: 'overdue',
              updatedAt: ts,
            }).catch(() => {});
          }
          if (l.studentUserId) {
            await createUserNotification({
              recipientUid: l.studentUserId,
              organizationId: ctx.orgId,
              type: 'overdue_alert',
              title: 'Overdue Library Book Alert',
              message: `Your borrowed book was due on ${new Date(l.dueAt).toLocaleDateString()}. Please return it immediately to prevent additional fines.`,
              entityType: 'loan',
              entityId: l.id,
            });
            notificationsSent++;
          }
        }
      }
      summary = `Scanned ${processedCount} active loan(s); notified ${notificationsSent} overdue borrower(s).`;
    }

    const logEntry = {
      id: makeId('alog'),
      jobKey,
      triggerSource: 'manual',
      status: 'completed',
      processedCount,
      notificationsSent,
      summary,
      executedAt: ts,
    };
    const nextJobs = currentJobs.map((j: any) =>
      j.id === autoRunMatch[1] || j.jobKey === jobKey
        ? { ...j, lastRunAt: ts, lastStatus: 'completed', lastSummary: summary }
        : j
    );
    const nextLogs = [logEntry, ...(org.automationLogs || [])].slice(0, 50);
    await safeUpdateDoc(`organizations/${ctx.orgId}`, {
      automationJobs: nextJobs,
      automationLogs: nextLogs,
      updatedAt: ts,
    });
    return { handled: true, data: { message: summary, log: logEntry } };
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
    if (actorRole === 'platform_super_admin' || actorRole === 'super_admin') {
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
    }
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
  const idCard = input?.autoGenerateId === false ? null : await issueStudentIdCard(org, studentDoc);

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
