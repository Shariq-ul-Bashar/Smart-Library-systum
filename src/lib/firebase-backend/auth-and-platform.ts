import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  updatePassword,
  updateProfile,
  verifyBeforeUpdateEmail,
} from 'firebase/auth';
import { where } from 'firebase/firestore';
import {
  auth,
  firebaseConfig,
  formatFirebaseAuthError,
  testConnection,
  withSecondaryAuth,
} from '../firebase.ts';
import { getFirebaseConfigDiagnostics } from '../env.ts';
import {
  DEFAULT_PASSWORD_POLICY,
  getPremiumStudentDesign,
  PREMIUM_STUDENT_DESIGNS,
  validatePasswordAgainstPolicy,
  type PasswordPolicyConfig,
} from '../../shared/security-and-tiers.ts';
import {
  BackendError,
  BOOTSTRAPPED_OWNER_EMAILS,
  createUserNotification,
  generatePolicyCompliantPassword,
  getPlatformPasswordPolicyDoc,
  makeId,
  makeSecureToken,
  normalizeEmail,
  normalizeEmailKey,
  nowIso,
  PRIMARY_SUPER_ADMIN_EMAIL,
  provisionOrganizationDefaultsInFirestore,
  requireSignedInUser,
  requireSuperAdminUser,
  roleDisplayName,
  safeDeleteDoc,
  safeGetDoc,
  safeListDocs,
  safeSetDoc,
  safeUpdateDoc,
  syncPublicOrganizationDoc,
  syncPublicQrRecord,
  writePlatformAudit,
} from './helpers.ts';

export function serializeUser(profile: Record<string, any>) {
  return {
    id: profile.uid || profile.id,
    uid: profile.uid || profile.id,
    email: profile.email,
    fullName: profile.fullName || 'QIVORA User',
    phone: profile.phone ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    isSuperAdmin: Boolean(profile.isSuperAdmin),
    mustChangePassword: Boolean(profile.mustChangePassword),
    status: profile.status || 'active',
  };
}

const inFlightHydrations = new Map<string, Promise<{ user: ReturnType<typeof serializeUser>; memberships: any[] }>>();

/**
 * Hydrates the currently signed-in Firebase Auth user from Cloud Firestore.
 * Deduplicates concurrent calls (e.g., onAuthStateChanged + signInWithPassword)
 * so user profile creation never races, and bootstraps the Platform Super Admin.
 */
export async function hydrateCurrentFirebaseSession() {
  const fbUser = auth.currentUser;
  if (!fbUser) {
    throw new BackendError('Not authenticated.', 401);
  }

  const existingPromise = inFlightHydrations.get(fbUser.uid);
  if (existingPromise) {
    return existingPromise;
  }

  const task = runHydrateCurrentFirebaseSession(fbUser).finally(() => {
    inFlightHydrations.delete(fbUser.uid);
  });
  inFlightHydrations.set(fbUser.uid, task);
  return task;
}

async function runHydrateCurrentFirebaseSession(fbUser: NonNullable<typeof auth.currentUser>) {
  const email = normalizeEmail(fbUser.email || '');
  const ts = nowIso();
  const isOwnerEmail = Boolean(
    email === PRIMARY_SUPER_ADMIN_EMAIL ||
    (fbUser.emailVerified && BOOTSTRAPPED_OWNER_EMAILS.includes(email))
  );

  // Check if user is already in trusted /admins/{uid}
  const existingAdminDoc = await safeGetDoc(`admins/${fbUser.uid}`).catch(() => null);
  let isSuperAdmin = Boolean(existingAdminDoc) || isOwnerEmail;

  // Bootstrap /admins/{uid} for owner emails on first sign-in
  if (isOwnerEmail && !existingAdminDoc) {
    await safeSetDoc(`admins/${fbUser.uid}`, {
      uid: fbUser.uid,
      email,
      fullName: fbUser.displayName || 'Mohammad Shariq',
      createdAt: ts,
      updatedAt: ts,
    });
    await safeSetDoc('platformSettings/setup_status', {
      key: 'setup_status',
      value: {
        superAdminEmail: PRIMARY_SUPER_ADMIN_EMAIL,
        initialized: true,
        initializedByEmail: email,
      },
      description: 'Platform Super Admin initialization flag',
      updatedAt: ts,
    }).catch(() => {});
    isSuperAdmin = true;
  }

  // Load or create /users/{uid}
  let profile = await safeGetDoc<Record<string, any>>(`users/${fbUser.uid}`);
  if (!profile) {
    const newProfile = {
      uid: fbUser.uid,
      email,
      fullName: fbUser.displayName || (email === PRIMARY_SUPER_ADMIN_EMAIL ? 'Mohammad Shariq' : email.split('@')[0] || 'QIVORA User'),
      phone: fbUser.phoneNumber || null,
      avatarUrl: fbUser.photoURL || null,
      isSuperAdmin,
      mustChangePassword: false,
      status: 'active',
      lastLoginAt: ts,
      createdAt: ts,
      updatedAt: ts,
    };
    await safeSetDoc(`users/${fbUser.uid}`, newProfile);
    profile = { id: fbUser.uid, ...newProfile };
  } else {
    if (profile.status === 'suspended') {
      throw new BackendError('Your account has been suspended. Contact your administrator.', 403);
    }
    const updates: Record<string, any> = { lastLoginAt: ts, updatedAt: ts };
    if (email && profile.email !== email) updates.email = email;
    if (isSuperAdmin && !profile.isSuperAdmin) updates.isSuperAdmin = true;
    await safeUpdateDoc(`users/${fbUser.uid}`, updates).catch(() => {});
    profile = { ...profile, ...updates, isSuperAdmin: isSuperAdmin || Boolean(profile.isSuperAdmin) };
  }

  // Claim any pending invites matching this verified email
  if (fbUser.emailVerified && email) {
    const invites = await safeListDocs<Record<string, any>>('pendingInvites', [
      where('email', '==', email),
    ]).catch(() => []);

    for (const inv of invites) {
      if (inv.status !== 'pending') continue;
      const membershipId = `${inv.organizationId}_${fbUser.uid}_${inv.roleSlug}`;
      const existingMem = await safeGetDoc(`memberships/${membershipId}`).catch(() => null);
      if (!existingMem) {
        await safeSetDoc(`memberships/${membershipId}`, {
          id: membershipId,
          userId: fbUser.uid,
          organizationId: inv.organizationId,
          organizationName: inv.organizationName || 'Registered Institution',
          organizationCode: inv.organizationCode || 'ORG',
          organizationStatus: 'active',
          roleSlug: inv.roleSlug,
          roleName: roleDisplayName(inv.roleSlug),
          status: 'active',
          isDefault: true,
          createdAt: ts,
          updatedAt: ts,
        }).catch(() => {});
      }
      await safeUpdateDoc(`pendingInvites/${inv.id}`, {
        status: 'claimed',
        claimedByUid: fbUser.uid,
        updatedAt: ts,
      }).catch(() => {});
    }
  }

  const membershipsRaw = await safeListDocs<Record<string, any>>('memberships', [
    where('userId', '==', fbUser.uid),
  ]);

  const memberships = membershipsRaw
    .filter((m) => m.status === 'active')
    .map((m) => ({
      membershipId: m.id,
      organizationId: m.organizationId,
      organizationName: m.organizationName || 'Institution',
      organizationCode: m.organizationCode || 'ORG',
      organizationStatus: m.organizationStatus || 'active',
      roleSlug: m.roleSlug,
      roleName: m.roleName || roleDisplayName(m.roleSlug),
      status: m.status,
      isDefault: Boolean(m.isDefault),
    }));

  return {
    user: serializeUser(profile),
    memberships,
  };
}

export async function handleAuthAndPublicRoute(
  method: string,
  pathname: string,
  _searchParams: URLSearchParams,
  body: any
): Promise<{ handled: boolean; data?: any }> {
  // 1. Setup status — one-time setup is permanently completed
  if (method === 'GET' && pathname === '/auth/setup-status') {
    return {
      handled: true,
      data: {
        superAdminEmail: PRIMARY_SUPER_ADMIN_EMAIL,
        needsSuperAdminSetup: false,
      },
    };
  }

  // 2. One-time Super Admin setup is permanently locked after initial setup
  if (method === 'POST' && pathname === '/auth/setup-super-admin') {
    throw new BackendError(
      'Initial Super Admin setup has already been completed and is locked. Please sign in with your email and password or Google.',
      403
    );
  }

  // 3. Current user hydration
  if (method === 'GET' && pathname === '/auth/me') {
    const session = await hydrateCurrentFirebaseSession();
    return { handled: true, data: session };
  }

  // 4. Forgot password via Firebase Authentication email delivery
  if (method === 'POST' && pathname === '/auth/forgot-password') {
    const email = normalizeEmail(String(body?.email || ''));
    if (!email || !email.includes('@')) {
      throw new BackendError('Please enter a valid email address.', 400);
    }
    try {
      await sendPasswordResetEmail(auth, email);
      return {
        handled: true,
        data: {
          smtpConfigured: true,
          message: `Password reset email sent to ${email}. Follow the link in your inbox to set a new password.`,
        },
      };
    } catch (err) {
      throw new BackendError(formatFirebaseAuthError(err), 400);
    }
  }

  // 5. Update authenticated profile
  if (method === 'PATCH' && pathname === '/auth/profile') {
    const { fbUser, profile } = await requireSignedInUser();
    const updates: Record<string, any> = { updatedAt: nowIso() };
    if (typeof body?.fullName === 'string' && body.fullName.trim().length >= 2) {
      updates.fullName = body.fullName.trim().slice(0, 120);
      await updateProfile(fbUser, { displayName: updates.fullName }).catch(() => {});
    }
    if (body?.phone !== undefined) updates.phone = body.phone ? String(body.phone).slice(0, 40) : null;
    if (body?.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl || null;

    await safeUpdateDoc(`users/${fbUser.uid}`, updates);
    return { handled: true, data: { user: serializeUser({ ...profile, ...updates }) } };
  }

  // 6. Change password in Firebase Auth
  if (method === 'POST' && pathname === '/auth/change-password') {
    const { fbUser, profile } = await requireSignedInUser();
    const currentPassword = String(body?.currentPassword || '');
    const newPassword = String(body?.newPassword || '');
    if (newPassword.length < 8) {
      throw new BackendError('New password must be at least 8 characters.', 400);
    }
    const policy = await getPlatformPasswordPolicyDoc();
    const check = validatePasswordAgainstPolicy(newPassword, policy);
    if (!check.valid) {
      throw new BackendError(check.error || 'Password does not satisfy password policy.', 400);
    }
    try {
      if (currentPassword && fbUser.email) {
        const cred = EmailAuthProvider.credential(fbUser.email, currentPassword);
        await reauthenticateWithCredential(fbUser, cred);
      }
      await updatePassword(fbUser, newPassword);
      const ts = nowIso();
      await safeUpdateDoc(`users/${fbUser.uid}`, {
        mustChangePassword: false,
        passwordChangedAt: ts,
        updatedAt: ts,
      });
      return {
        handled: true,
        data: {
          user: serializeUser({ ...profile, mustChangePassword: false, passwordChangedAt: ts }),
          message: 'Password updated successfully in Firebase Authentication.',
        },
      };
    } catch (err) {
      throw new BackendError(formatFirebaseAuthError(err), 400);
    }
  }

  // 7. Change login email in Firebase Auth
  if (method === 'POST' && pathname === '/auth/change-email') {
    const { fbUser, profile } = await requireSignedInUser();
    const newEmail = normalizeEmail(String(body?.newEmail || ''));
    const currentPassword = String(body?.currentPassword || '');
    if (!newEmail || !newEmail.includes('@')) {
      throw new BackendError('Please provide a valid new email address.', 400);
    }
    try {
      if (currentPassword && fbUser.email) {
        const cred = EmailAuthProvider.credential(fbUser.email, currentPassword);
        await reauthenticateWithCredential(fbUser, cred);
      }
      await verifyBeforeUpdateEmail(fbUser, newEmail);
      const ts = nowIso();
      await safeUpdateDoc(`users/${fbUser.uid}`, { email: newEmail, updatedAt: ts });
      const token = await fbUser.getIdToken(true);
      return {
        handled: true,
        data: {
          token,
          user: serializeUser({ ...profile, email: newEmail }),
          message: `Verification link sent to ${newEmail}. Click the link in your inbox to finalize your login email update.`,
        },
      };
    } catch (err) {
      throw new BackendError(formatFirebaseAuthError(err), 400);
    }
  }

  // 8. Notifications summary & mark all read
  if (method === 'GET' && (pathname === '/auth/notifications/summary' || pathname === '/org/notifications')) {
    if (!auth.currentUser) {
      return {
        handled: true,
        data: { unreadCount: 0, notifications: [], items: [] },
      };
    }
    const uid = auth.currentUser.uid;
    const items = await safeListDocs<Record<string, any>>('notifications', [
      where('recipientUid', '==', uid),
    ]);
    items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const top20 = items.slice(0, 20);
    return {
      handled: true,
      data: {
        unreadCount: top20.filter((n) => !n.isRead).length,
        notifications: top20,
        items: top20,
      },
    };
  }

  if (method === 'POST' && (pathname === '/auth/notifications/read-all' || pathname === '/org/notifications/read-all')) {
    const { fbUser } = await requireSignedInUser();
    const items = await safeListDocs<Record<string, any>>('notifications', [
      where('recipientUid', '==', fbUser.uid),
    ]);
    await Promise.all(
      items
        .filter((n) => !n.isRead)
        .map((n) => safeUpdateDoc(`notifications/${n.id}`, { isRead: true }).catch(() => {}))
    );
    return { handled: true, data: { message: 'All notifications marked as read.' } };
  }

  const notifReadMatch = pathname.match(/^\/org\/notifications\/([^/]+)\/read$/);
  if (method === 'PATCH' && notifReadMatch) {
    await requireSignedInUser();
    await safeUpdateDoc(`notifications/${notifReadMatch[1]}`, { isRead: true });
    return { handled: true, data: { ok: true } };
  }

  // 9. Public organizations directory (for /register)
  if (method === 'GET' && pathname === '/public/organizations') {
    const orgs = await safeListDocs<Record<string, any>>('publicOrganizations', [
      where('status', '==', 'active'),
    ]);
    orgs.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return { handled: true, data: { organizations: orgs } };
  }

  const pubAcadMatch = pathname.match(/^\/public\/organizations\/([^/]+)\/academics$/);
  if (method === 'GET' && pubAcadMatch) {
    const pubOrg = await safeGetDoc<Record<string, any>>(`publicOrganizations/${pubAcadMatch[1]}`);
    if (!pubOrg || pubOrg.status !== 'active') {
      throw new BackendError('Institution not found or inactive.', 404);
    }
    return {
      handled: true,
      data: {
        organization: { id: pubOrg.id, name: pubOrg.name, status: pubOrg.status },
        departments: pubOrg.departments || [],
        courses: pubOrg.courses || [],
        semesters: pubOrg.semesters || [],
        academicSessions: pubOrg.academicSessions || [],
        studentCategories: pubOrg.studentCategories || [],
      },
    };
  }

  // 10. Public Student Registration
  if (method === 'POST' && pathname === '/public/student-register') {
    const orgId = String(body?.organizationId || '').trim();
    const fullName = String(body?.fullName || '').trim();
    const email = normalizeEmail(String(body?.email || ''));
    const collegeRollNumber = String(body?.collegeRollNumber || '').trim();
    if (!orgId || !fullName || !email || !collegeRollNumber) {
      throw new BackendError('Organization, full name, email, and roll number are required.', 400);
    }

    // Optionally provision Firebase Auth Email/Password credentials for the applicant
    let submittedByUid: string | null = null;
    const rawPassword = String(body?.password || '').trim();
    if (rawPassword.length >= 8) {
      try {
        submittedByUid = await withSecondaryAuth(async (secAuth) => {
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

    const appId = makeId('app');
    const ts = nowIso();
    const application = {
      id: appId,
      organizationId: orgId,
      submittedByUid,
      fullName: fullName.slice(0, 120),
      fatherName: String(body?.fatherName || 'N/A').trim().slice(0, 120),
      collegeRollNumber: collegeRollNumber.slice(0, 64),
      universityRollNumber: body?.universityRollNumber ? String(body.universityRollNumber).trim() : null,
      proposedStudentId: body?.proposedStudentId ? String(body.proposedStudentId).trim() : null,
      courseId: body?.courseId || null,
      semesterId: body?.semesterId || null,
      departmentId: body?.departmentId || null,
      academicSessionId: body?.academicSessionId || null,
      studentCategoryId: body?.studentCategoryId || null,
      dateOfBirth: body?.dateOfBirth || null,
      gender: body?.gender || null,
      phone: String(body?.phone || '').trim().slice(0, 40),
      email,
      address: body?.address ? String(body.address).trim().slice(0, 400) : null,
      photoUrl: body?.photoUrl || null,
      idProofUrl: body?.idProofUrl || null,
      status: 'pending',
      createdAt: ts,
      updatedAt: ts,
    };

    await safeSetDoc(`organizations/${orgId}/studentApplications/${appId}`, application);
    return {
      handled: true,
      data: {
        application,
        message: 'Registration submitted successfully. You will be notified once approved by your college administration.',
      },
    };
  }

  // 11. Public QR Verification
  const verifyMatch = pathname.match(/^\/verify\/qr\/([^/]+)$/);
  if (method === 'GET' && verifyMatch) {
    const token = decodeURIComponent(verifyMatch[1]).trim();
    if (!token || token.length < 8) {
      throw new BackendError('Invalid verification token format.', 404);
    }
    const qr = await safeGetDoc<Record<string, any>>(`publicQrRegistry/${token}`);
    if (!qr) {
      return {
        handled: true,
        data: { verified: false, reason: 'Credential not found in QIVORA registry.' },
      };
    }
    if (!qr.isActive || qr.status === 'revoked') {
      return {
        handled: true,
        data: {
          verified: false,
          status: 'revoked',
          entityType: qr.entityType,
          reason: qr.reason || 'This digital credential has been revoked and is no longer valid.',
          revokedAt: qr.revokedAt || null,
        },
      };
    }
    if (qr.expiresAt && new Date(qr.expiresAt) < new Date()) {
      return {
        handled: true,
        data: {
          verified: false,
          status: 'expired',
          entityType: qr.entityType,
          reason: 'This digital credential has expired.',
          expiresAt: qr.expiresAt,
        },
      };
    }
    return {
      handled: true,
      data: {
        verified: true,
        entityType: qr.entityType,
        status: qr.status || 'active',
        credential: qr.credential,
        founderBadge: qr.founderBadge || null,
        premiumStudent: qr.premiumStudent || null,
        linkedCollege: qr.linkedCollege || null,
      },
    };
  }

  return { handled: false };
}

export async function handlePlatformRoute(
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
  body: any
): Promise<{ handled: boolean; data?: any }> {
  if (!pathname.startsWith('/platform/')) {
    return { handled: false };
  }

  await requireSuperAdminUser();

  // 1. Platform Overview
  if (method === 'GET' && pathname === '/platform/overview') {
    const [orgs, founders, memberships, auditLogs] = await Promise.all([
      safeListDocs<Record<string, any>>('organizations'),
      safeListDocs<Record<string, any>>('founderIdentities'),
      safeListDocs<Record<string, any>>('memberships'),
      safeListDocs<Record<string, any>>('platformAuditLogs'),
    ]);

    let totalStudents = 0;
    let totalBooks = 0;
    let totalActiveLoans = 0;
    const orgSummaries = await Promise.all(
      orgs.map(async (org) => {
        const [stus, bks, lns] = await Promise.all([
          safeListDocs(`organizations/${org.id}/students`).catch(() => []),
          safeListDocs(`organizations/${org.id}/books`).catch(() => []),
          safeListDocs(`organizations/${org.id}/loans`).catch(() => []),
        ]);
        const activeLns = lns.filter((l: any) => l.status !== 'returned').length;
        totalStudents += stus.length;
        totalBooks += bks.length;
        totalActiveLoans += activeLns;
        return {
          ...org,
          studentCount: stus.length,
          bookCount: bks.length,
          activeLoanCount: activeLns,
        };
      })
    );

    auditLogs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return {
      handled: true,
      data: {
        metrics: {
          totalOrganizations: orgs.length,
          activeOrganizations: orgs.filter((o) => o.status === 'active').length,
          suspendedOrganizations: orgs.filter((o) => o.status === 'suspended').length,
          totalStudents,
          totalBooks,
          totalActiveLoans,
          totalCollegeAdmins: memberships.filter((m) => m.roleSlug === 'college_admin' && m.status === 'active').length,
          activeFounderIds: founders.filter((f) => f.status === 'active').length,
        },
        organizations: orgSummaries,
        recentAuditLogs: auditLogs.slice(0, 15),
      },
    };
  }

  // 2. Organizations CRUD
  if (method === 'GET' && pathname === '/platform/organizations') {
    const orgs = await safeListDocs<Record<string, any>>('organizations');
    orgs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return { handled: true, data: { organizations: orgs } };
  }

  if (method === 'POST' && pathname === '/platform/organizations') {
    const name = String(body?.name || '').trim();
    const code = String(body?.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!name || !code) {
      throw new BackendError('Institution name and unique code are required.', 400);
    }
    const existingOrgs = await safeListDocs<Record<string, any>>('organizations');
    if (existingOrgs.some((o) => String(o.code || '').toUpperCase() === code)) {
      throw new BackendError(`Organization code "${code}" is already registered.`, 409);
    }
    const orgId = makeId('org');
    const orgDoc = await provisionOrganizationDefaultsInFirestore({
      orgId,
      name,
      code,
      universityName: body?.universityName || null,
      logoUrl: body?.logoUrl || null,
      address: body?.address || null,
      contactNumber: body?.contactNumber || null,
      email: body?.email || null,
      website: body?.website || null,
      academicSession: body?.academicSession || '2026-2027',
    });

    await writePlatformAudit({
      action: 'organization_created',
      entityType: 'organization',
      entityId: orgId,
      organizationId: orgId,
      details: { name, code },
    });

    return { handled: true, data: { organization: orgDoc } };
  }

  const orgStatusMatch = pathname.match(/^\/platform\/organizations\/([^/]+)\/status$/);
  if (method === 'PATCH' && orgStatusMatch) {
    const orgId = orgStatusMatch[1];
    const status = body?.status === 'suspended' ? 'suspended' : 'active';
    const org = await safeGetDoc<Record<string, any>>(`organizations/${orgId}`);
    if (!org) throw new BackendError('Organization not found.', 404);
    const ts = nowIso();
    await safeUpdateDoc(`organizations/${orgId}`, { status, updatedAt: ts });
    await syncPublicOrganizationDoc({ ...org, status });

    const mems = await safeListDocs<Record<string, any>>('memberships');
    await Promise.all(
      mems
        .filter((m) => m.organizationId === orgId)
        .map((m) => safeUpdateDoc(`memberships/${m.id}`, { organizationStatus: status, updatedAt: ts }).catch(() => {}))
    );

    await writePlatformAudit({
      action: 'organization_status_changed',
      entityType: 'organization',
      entityId: orgId,
      organizationId: orgId,
      details: { status, reason: body?.reason || null },
    });
    return { handled: true, data: { organization: { ...org, status } } };
  }

  const orgStudentsLookupMatch = pathname.match(/^\/platform\/organizations\/([^/]+)\/students-lookup$/);
  if (method === 'GET' && orgStudentsLookupMatch) {
    const students = await safeListDocs<Record<string, any>>(`organizations/${orgStudentsLookupMatch[1]}/students`);
    return { handled: true, data: { students } };
  }

  // 3. College Admins Management
  if (method === 'GET' && pathname === '/platform/college-admins') {
    const [mems, users] = await Promise.all([
      safeListDocs<Record<string, any>>('memberships'),
      safeListDocs<Record<string, any>>('users'),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const rows = mems
      .filter((m) => m.roleSlug === 'college_admin')
      .map((m) => {
        const u = userMap.get(m.userId);
        return {
          membershipId: m.id,
          status: m.status,
          createdAt: m.createdAt,
          organizationId: m.organizationId,
          organizationName: m.organizationName,
          organizationCode: m.organizationCode,
          profileId: m.userId,
          fullName: u?.fullName || 'College Admin',
          email: u?.email || '',
          phone: u?.phone || null,
          profileStatus: u?.status || 'active',
          lastLoginAt: u?.lastLoginAt || null,
        };
      });
    return { handled: true, data: { collegeAdmins: rows } };
  }

  if (method === 'POST' && pathname === '/platform/college-admins') {
    const res = await provisionAccountAsSuperAdmin({
      organizationId: body?.organizationId,
      roleSlug: 'college_admin',
      fullName: body?.fullName,
      email: body?.email,
      phone: body?.phone,
      password: body?.password,
      autoGeneratePassword: !body?.password,
      requirePasswordChange: false,
    });
    return { handled: true, data: { membership: res.account, email: res.account.email } };
  }

  const cAdminStatusMatch = pathname.match(/^\/platform\/college-admins\/([^/]+)\/status$/);
  if (method === 'PATCH' && cAdminStatusMatch) {
    const status = body?.status === 'suspended' ? 'suspended' : 'active';
    await safeUpdateDoc(`memberships/${cAdminStatusMatch[1]}`, { status, updatedAt: nowIso() });
    return { handled: true, data: { membership: { id: cAdminStatusMatch[1], status } } };
  }

  // 4. Centralized Accounts & Password Management
  if (method === 'GET' && pathname === '/platform/accounts') {
    const [mems, users] = await Promise.all([
      safeListDocs<Record<string, any>>('memberships'),
      safeListDocs<Record<string, any>>('users'),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const orgFilter = searchParams.get('organizationId') || '';
    const roleFilter = searchParams.get('role') || '';
    const search = (searchParams.get('search') || '').trim().toLowerCase();

    const accounts = mems
      .map((m) => {
        const u = userMap.get(m.userId);
        return {
          membershipId: m.id,
          organizationId: m.organizationId,
          organizationName: m.organizationName || 'Institution',
          organizationCode: m.organizationCode || 'ORG',
          roleSlug: m.roleSlug,
          roleName: m.roleName || roleDisplayName(m.roleSlug),
          membershipStatus: m.status,
          profileId: m.userId,
          fullName: u?.fullName || 'User',
          email: u?.email || '',
          phone: u?.phone || null,
          profileStatus: u?.status || 'active',
          isSuperAdmin: Boolean(u?.isSuperAdmin),
          mustChangePassword: Boolean(u?.mustChangePassword),
          hasPassword: true,
          lastLoginAt: u?.lastLoginAt || null,
          passwordChangedAt: u?.passwordChangedAt || null,
          createdAt: m.createdAt || u?.createdAt || nowIso(),
        };
      })
      .filter((row) => {
        if (orgFilter && orgFilter !== 'all' && row.organizationId !== orgFilter) return false;
        if (roleFilter && roleFilter !== 'all' && row.roleSlug !== roleFilter) return false;
        if (search) {
          const hay = `${row.fullName} ${row.email} ${row.organizationName} ${row.roleSlug}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return { handled: true, data: { accounts } };
  }

  if (method === 'POST' && pathname === '/platform/accounts') {
    const res = await provisionAccountAsSuperAdmin(body);
    return { handled: true, data: res };
  }

  const accResetMatch = pathname.match(/^\/platform\/accounts\/([^/]+)\/reset-password$/);
  if (method === 'POST' && accResetMatch) {
    const targetUid = accResetMatch[1];
    const target = await safeGetDoc<Record<string, any>>(`users/${targetUid}`);
    if (!target) throw new BackendError('Target user account not found.', 404);
    try {
      await sendPasswordResetEmail(auth, target.email);
    } catch (err) {
      throw new BackendError(formatFirebaseAuthError(err), 400);
    }
    const forceChange = Boolean(body?.requirePasswordChange ?? true);
    await safeUpdateDoc(`users/${targetUid}`, {
      mustChangePassword: forceChange,
      updatedAt: nowIso(),
    });
    await writePlatformAudit({
      action: 'platform_account_password_reset',
      entityType: 'profile',
      entityId: targetUid,
      details: { targetEmail: target.email, delivery: 'firebase_password_reset_email' },
    });
    return {
      handled: true,
      data: {
        email: target.email,
        fullName: target.fullName,
        temporaryPasswordOnce: 'Reset Link Sent via Firebase Email',
        mustChangePassword: forceChange,
        message: `Firebase password reset email sent directly to ${target.email}.`,
      },
    };
  }

  const accStatusMatch = pathname.match(/^\/platform\/accounts\/([^/]+)\/status$/);
  if (method === 'PATCH' && accStatusMatch) {
    const targetUid = accStatusMatch[1];
    const status = body?.status === 'suspended' ? 'suspended' : 'active';
    if (targetUid === auth.currentUser?.uid) {
      throw new BackendError('You cannot suspend your own Super Admin account.', 400);
    }
    await safeUpdateDoc(`users/${targetUid}`, { status, updatedAt: nowIso() });
    await writePlatformAudit({
      action: 'platform_account_status_changed',
      entityType: 'profile',
      entityId: targetUid,
      details: { status },
    });
    return { handled: true, data: { profileId: targetUid, status, message: `Account ${status}.` } };
  }

  // 5. Password Policy
  if (method === 'GET' && pathname === '/platform/password-policy') {
    const policy = await getPlatformPasswordPolicyDoc();
    return { handled: true, data: { policy } };
  }

  if (method === 'PUT' && pathname === '/platform/password-policy') {
    const current = await getPlatformPasswordPolicyDoc();
    const next: PasswordPolicyConfig = {
      ...current,
      ...body,
    };
    await safeSetDoc('platformSettings/password_policy', {
      key: 'password_policy',
      value: next,
      description: 'Default password policy and template',
      updatedAt: nowIso(),
    });
    await writePlatformAudit({
      action: 'password_policy_updated',
      entityType: 'platform_setting',
      entityId: 'password_policy',
      details: next as unknown as Record<string, unknown>,
    });
    return { handled: true, data: { policy: next, message: 'Password policy saved.' } };
  }

  // 6. Cross-College Student Directory + Exclusive Founder & Independent Premium IDs
  if (method === 'GET' && pathname === '/platform/students/directory') {
    const orgFilter = searchParams.get('organizationId') || '';
    const tierFilter = searchParams.get('tier') || 'all';
    const search = (searchParams.get('search') || '').trim().toLowerCase();

    const [orgs, founders] = await Promise.all([
      safeListDocs<Record<string, any>>('organizations'),
      safeListDocs<Record<string, any>>('founderIdentities'),
    ]);

    const founderByStudent = new Map(
      founders
        .filter((f) => f.status === 'active' && f.linkedStudentId)
        .map((f) => [f.linkedStudentId, f])
    );

    const allStudents: any[] = [];
    for (const org of orgs) {
      if (orgFilter && orgFilter !== 'all' && org.id !== orgFilter) continue;
      const stus = await safeListDocs<Record<string, any>>(`organizations/${org.id}/students`).catch(() => []);
      const courseMap = new Map((org.courses || []).map((c: any) => [c.id, c.name]));
      const semMap = new Map((org.semesters || []).map((s: any) => [s.id, s.name]));
      const sessMap = new Map((org.academicSessions || []).map((s: any) => [s.id, s.name]));

      for (const s of stus) {
        const founder = founderByStudent.get(s.id) || null;
        const row = {
          id: s.id,
          organizationId: org.id,
          organizationName: org.name,
          organizationCode: org.code,
          studentIdCode: s.studentIdCode,
          fullName: s.fullName,
          collegeRollNumber: s.collegeRollNumber,
          email: s.email,
          phone: s.phone,
          photoUrl: s.photoUrl || null,
          courseName: courseMap.get(s.courseId) || null,
          semesterName: semMap.get(s.semesterId) || null,
          sessionName: sessMap.get(s.academicSessionId) || null,
          status: s.status,
          isFounder: Boolean(founder),
          founder,
          isPremium: Boolean(s.isPremium),
          premiumTier: s.premiumTier || null,
          premiumDesign: s.premiumDesign || null,
          premiumBadgeLabel: s.premiumBadgeLabel || null,
          premiumGrantedAt: s.premiumGrantedAt || null,
          premiumNote: s.premiumNote || null,
        };

        if (tierFilter === 'founder' && !row.isFounder) continue;
        if (tierFilter === 'premium' && !row.isPremium) continue;
        if (tierFilter === 'standard' && (row.isFounder || row.isPremium)) continue;
        if (search) {
          const hay = `${row.fullName} ${row.email} ${row.collegeRollNumber} ${row.studentIdCode} ${row.organizationName}`.toLowerCase();
          if (!hay.includes(search)) continue;
        }
        allStudents.push(row);
      }
    }

    return {
      handled: true,
      data: {
        students: allStudents,
        premiumDesigns: PREMIUM_STUDENT_DESIGNS,
      },
    };
  }

  // Assign / Revoke Founder for a student (Super Admin ONLY)
  const stuFounderMatch = pathname.match(/^\/platform\/students\/([^/]+)\/founder$/);
  if (stuFounderMatch) {
    const studentId = stuFounderMatch[1];
    const found = await findStudentAcrossOrgs(studentId);
    if (!found) throw new BackendError('Student not found.', 404);
    const { org, student } = found;

    if (method === 'POST') {
      const existingFounders = await safeListDocs<Record<string, any>>('founderIdentities');
      const activeExisting = existingFounders.find((f) => f.linkedStudentId === studentId && f.status === 'active');
      if (activeExisting) {
        return { handled: true, data: { founderId: activeExisting, message: 'Student already holds an active Golden Founder ID.' } };
      }

      const founderId = makeId('fnd');
      const qrToken = makeSecureToken(24);
      const founderNumber = `QIV-FND-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const ts = nowIso();
      const editionName = String(body?.editionName || 'QIVORA GOLDEN FOUNDER EDITION').trim();
      const designation = String(body?.designation || 'Founding Scholar').trim();

      const linkedCollege = {
        studentId: student.id,
        organizationId: org.id,
        collegeName: org.branding?.collegeName || org.name,
        collegeLogoUrl: org.branding?.collegeLogoUrl || org.logoUrl || null,
        universityName: org.branding?.universityName || org.universityName || null,
        studentIdCode: student.studentIdCode,
        collegeRollNumber: student.collegeRollNumber,
        photoUrl: student.photoUrl || null,
        membershipStatus: student.status,
        collegeLinkStatus: 'approved',
        collegeVerified: student.status === 'active',
      };

      const record = {
        id: founderId,
        founderNumber,
        fullName: student.fullName,
        designation,
        editionName,
        organizationLabel: 'QIVORA — Smart Library Management System',
        photoUrl: student.photoUrl || null,
        linkedStudentId: student.id,
        linkedOrganizationId: org.id,
        linkedUserId: student.userId || null,
        qrToken,
        qrIsActive: true,
        status: 'active',
        collegeLinkStatus: 'approved',
        issuedAt: ts,
        linkedCollege,
        createdAt: ts,
        updatedAt: ts,
      };

      await safeSetDoc(`founderIdentities/${founderId}`, record);
      await syncPublicQrRecord({
        token: qrToken,
        entityType: 'founder_id',
        entityId: founderId,
        organizationId: org.id,
        isActive: true,
        status: 'active',
        credential: {
          editionName,
          founderNumber,
          fullName: student.fullName,
          designation,
          organizationLabel: 'QIVORA — Smart Library Management System',
          photoUrl: student.photoUrl || null,
          issuedAt: ts,
          verifiedCreatorBadge: true,
          collegeLinkStatus: 'approved',
          note: 'Verified QIVORA Golden Founder Credential.',
        },
        linkedCollege,
      });

      if (student.userId) {
        await createUserNotification({
          recipientUid: student.userId,
          organizationId: org.id,
          type: 'founder_id_granted',
          title: 'Golden Premium Founder ID Activated',
          message: `You have been awarded an official QIVORA Golden Founder Digital ID (${founderNumber}).`,
          entityType: 'founder_id',
          entityId: founderId,
        });
      }

      await writePlatformAudit({
        action: 'founder_assigned',
        entityType: 'founder_identity',
        entityId: founderId,
        organizationId: org.id,
        details: { studentId, founderNumber },
      });

      return {
        handled: true,
        data: { founderId: record, message: `Golden Founder ID (${founderNumber}) issued to ${student.fullName}.` },
      };
    }

    if (method === 'DELETE') {
      const existingFounders = await safeListDocs<Record<string, any>>('founderIdentities');
      const matches = existingFounders.filter((f) => f.linkedStudentId === studentId && f.status === 'active');
      const ts = nowIso();
      for (const f of matches) {
        await safeUpdateDoc(`founderIdentities/${f.id}`, {
          status: 'revoked',
          qrIsActive: false,
          statusReason: 'Revoked by Platform Super Admin',
          updatedAt: ts,
        });
        if (f.qrToken) {
          await safeUpdateDoc(`publicQrRegistry/${f.qrToken}`, {
            isActive: false,
            status: 'revoked',
            reason: 'Founder credential revoked by Platform Super Admin.',
            revokedAt: ts,
            updatedAt: ts,
          }).catch(() => {});
        }
      }
      await writePlatformAudit({
        action: 'founder_revoked',
        entityType: 'student',
        entityId: studentId,
        organizationId: org.id,
        details: { revokedCount: matches.length },
      });
      return { handled: true, data: { message: `Founder status revoked for ${student.fullName}.` } };
    }
  }

  // Assign / Revoke Independent Premium Student ID (Super Admin ONLY)
  const stuPremMatch = pathname.match(/^\/platform\/students\/([^/]+)\/premium$/);
  if (stuPremMatch) {
    const studentId = stuPremMatch[1];
    const found = await findStudentAcrossOrgs(studentId);
    if (!found) throw new BackendError('Student not found.', 404);
    const { org, student } = found;
    const ts = nowIso();

    if (method === 'POST') {
      const design = getPremiumStudentDesign(body?.premiumDesign || body?.design || 'obsidian_platinum');
      const badgeLabel = String(body?.premiumBadgeLabel || body?.badgeLabel || design.badgeLabel).trim().slice(0, 64);
      const note = body?.premiumNote ? String(body.premiumNote).trim().slice(0, 240) : null;

      const updates = {
        isPremium: true,
        premiumTier: design.key,
        premiumDesign: design.key,
        premiumBadgeLabel: badgeLabel,
        premiumGrantedAt: ts,
        premiumNote: note,
        updatedAt: ts,
      };
      await safeUpdateDoc(`organizations/${org.id}/students/${studentId}`, updates);

      // Update student's active QR card registry with premium metadata
      const cards = await safeListDocs<Record<string, any>>(`organizations/${org.id}/idCards`);
      const stuCard = cards.find((c) => c.studentId === studentId && c.status === 'active');
      if (stuCard?.qrToken) {
        await safeUpdateDoc(`publicQrRegistry/${stuCard.qrToken}`, {
          premiumStudent: {
            isPremium: true,
            premiumTier: design.key,
            premiumDesign: design.key,
            premiumBadgeLabel: badgeLabel,
            premiumGrantedAt: ts,
          },
          updatedAt: ts,
        }).catch(() => {});
      }

      if (student.userId) {
        await createUserNotification({
          recipientUid: student.userId,
          organizationId: org.id,
          type: 'premium_id_granted',
          title: 'Premium Student Digital ID Activated',
          message: `Your Premium Student ID (${design.name}) is now active in your Student Portal.`,
          entityType: 'student',
          entityId: studentId,
        });
      }

      await writePlatformAudit({
        action: 'premium_student_assigned',
        entityType: 'student',
        entityId: studentId,
        organizationId: org.id,
        details: { premiumDesign: design.key, badgeLabel },
      });

      return {
        handled: true,
        data: {
          student: { id: studentId, fullName: student.fullName, ...updates },
          message: `Premium Student ID (${design.name}) activated for ${student.fullName}.`,
        },
      };
    }

    if (method === 'DELETE') {
      const updates = {
        isPremium: false,
        premiumTier: null,
        premiumDesign: null,
        premiumBadgeLabel: null,
        premiumGrantedAt: null,
        premiumNote: null,
        updatedAt: ts,
      };
      await safeUpdateDoc(`organizations/${org.id}/students/${studentId}`, updates);

      const cards = await safeListDocs<Record<string, any>>(`organizations/${org.id}/idCards`);
      const stuCard = cards.find((c) => c.studentId === studentId && c.status === 'active');
      if (stuCard?.qrToken) {
        await safeUpdateDoc(`publicQrRegistry/${stuCard.qrToken}`, {
          premiumStudent: null,
          updatedAt: ts,
        }).catch(() => {});
      }

      await writePlatformAudit({
        action: 'premium_student_revoked',
        entityType: 'student',
        entityId: studentId,
        organizationId: org.id,
      });

      return { handled: true, data: { message: `Premium Student ID revoked for ${student.fullName}.` } };
    }
  }

  // 7. Founder IDs Studio endpoints
  if (method === 'GET' && pathname === '/platform/founder-ids') {
    const founderIds = await safeListDocs<Record<string, any>>('founderIdentities');
    founderIds.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return { handled: true, data: { founderIds } };
  }

  if (method === 'POST' && pathname === '/platform/founder-ids') {
    const fullName = String(body?.fullName || '').trim();
    if (!fullName) throw new BackendError('Full name is required.', 400);
    const founderId = makeId('fnd');
    const qrToken = makeSecureToken(24);
    const founderNumber = `QIV-FND-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const ts = nowIso();
    const record = {
      id: founderId,
      founderNumber,
      fullName,
      designation: String(body?.designation || 'Founder & Architect').trim(),
      editionName: String(body?.editionName || 'QIVORA GOLDEN FOUNDER EDITION').trim(),
      organizationLabel: String(body?.organizationLabel || 'QIVORA — Smart Library Management System').trim(),
      photoUrl: body?.photoUrl || null,
      linkedStudentId: body?.linkedStudentId || null,
      linkedOrganizationId: body?.linkedOrganizationId || null,
      linkedUserId: null,
      qrToken,
      qrIsActive: true,
      status: 'active',
      collegeLinkStatus: body?.linkedStudentId ? 'approved' : 'none',
      issuedAt: ts,
      createdAt: ts,
      updatedAt: ts,
    };
    await safeSetDoc(`founderIdentities/${founderId}`, record);
    await syncPublicQrRecord({
      token: qrToken,
      entityType: 'founder_id',
      entityId: founderId,
      organizationId: record.linkedOrganizationId,
      isActive: true,
      status: 'active',
      credential: {
        editionName: record.editionName,
        founderNumber,
        fullName,
        designation: record.designation,
        organizationLabel: record.organizationLabel,
        photoUrl: record.photoUrl,
        issuedAt: ts,
        verifiedCreatorBadge: true,
        collegeLinkStatus: record.collegeLinkStatus,
      },
    });
    return { handled: true, data: { founderId: record } };
  }

  const fndRegenMatch = pathname.match(/^\/platform\/founder-ids\/([^/]+)\/regenerate$/);
  if (method === 'POST' && fndRegenMatch) {
    const f = await safeGetDoc<Record<string, any>>(`founderIdentities/${fndRegenMatch[1]}`);
    if (!f) throw new BackendError('Founder ID not found.', 404);
    const ts = nowIso();
    if (f.qrToken) {
      await safeUpdateDoc(`publicQrRegistry/${f.qrToken}`, { isActive: false, status: 'revoked', revokedAt: ts, updatedAt: ts }).catch(() => {});
    }
    const newToken = makeSecureToken(24);
    await safeUpdateDoc(`founderIdentities/${f.id}`, { qrToken: newToken, qrIsActive: true, updatedAt: ts });
    await syncPublicQrRecord({
      token: newToken,
      entityType: 'founder_id',
      entityId: f.id,
      organizationId: f.linkedOrganizationId || null,
      isActive: true,
      status: 'active',
      credential: {
        editionName: f.editionName,
        founderNumber: f.founderNumber,
        fullName: f.fullName,
        designation: f.designation,
        organizationLabel: f.organizationLabel,
        photoUrl: f.photoUrl || null,
        issuedAt: f.issuedAt,
        verifiedCreatorBadge: true,
        collegeLinkStatus: f.collegeLinkStatus,
      },
      linkedCollege: f.linkedCollege || null,
    });
    return { handled: true, data: { founderId: { ...f, qrToken: newToken } } };
  }

  const fndRevokeMatch = pathname.match(/^\/platform\/founder-ids\/([^/]+)\/revoke$/);
  if (method === 'POST' && fndRevokeMatch) {
    const f = await safeGetDoc<Record<string, any>>(`founderIdentities/${fndRevokeMatch[1]}`);
    if (!f) throw new BackendError('Founder ID not found.', 404);
    const ts = nowIso();
    await safeUpdateDoc(`founderIdentities/${f.id}`, {
      status: 'revoked',
      qrIsActive: false,
      statusReason: body?.reason || 'Revoked by Platform Super Admin',
      updatedAt: ts,
    });
    if (f.qrToken) {
      await safeUpdateDoc(`publicQrRegistry/${f.qrToken}`, {
        isActive: false,
        status: 'revoked',
        reason: body?.reason || 'Revoked by Platform Super Admin',
        revokedAt: ts,
        updatedAt: ts,
      }).catch(() => {});
    }
    return { handled: true, data: { message: 'Founder ID revoked.' } };
  }

  const fndLinkMatch = pathname.match(/^\/platform\/founder-ids\/([^/]+)\/link-student$/);
  if ((method === 'PATCH' || method === 'POST') && fndLinkMatch) {
    const f = await safeGetDoc<Record<string, any>>(`founderIdentities/${fndLinkMatch[1]}`);
    if (!f) throw new BackendError('Founder ID not found.', 404);
    const ts = nowIso();
    const linkedOrganizationId = body?.linkedOrganizationId || null;
    const linkedStudentId = body?.linkedStudentId || null;

    if (!linkedStudentId || !linkedOrganizationId) {
      await safeUpdateDoc(`founderIdentities/${f.id}`, {
        linkedOrganizationId: null,
        linkedStudentId: null,
        linkedUserId: null,
        linkedCollege: null,
        collegeLinkStatus: 'none',
        updatedAt: ts,
      });
      if (f.qrToken) {
        await safeUpdateDoc(`publicQrRegistry/${f.qrToken}`, { linkedCollege: null, updatedAt: ts }).catch(() => {});
      }
      return { handled: true, data: { founderId: { ...f, linkedOrganizationId: null, linkedStudentId: null, collegeLinkStatus: 'none' }, message: 'Founder ID unlinked from student.' } };
    }

    const [org, stu] = await Promise.all([
      safeGetDoc<Record<string, any>>(`organizations/${linkedOrganizationId}`),
      safeGetDoc<Record<string, any>>(`organizations/${linkedOrganizationId}/students/${linkedStudentId}`),
    ]);
    if (!org || !stu) throw new BackendError('Selected organization or student not found.', 404);

    const linkedCollege = {
      studentId: stu.id,
      organizationId: org.id,
      collegeName: org.branding?.collegeName || org.name,
      collegeLogoUrl: org.branding?.collegeLogoUrl || org.logoUrl || null,
      universityName: org.branding?.universityName || org.universityName || null,
      studentIdCode: stu.studentIdCode,
      collegeRollNumber: stu.collegeRollNumber,
      photoUrl: stu.photoUrl || null,
      membershipStatus: stu.status,
      collegeLinkStatus: 'approved',
      collegeVerified: stu.status === 'active',
    };

    const updated = {
      ...f,
      linkedOrganizationId: org.id,
      linkedStudentId: stu.id,
      linkedUserId: stu.userId || null,
      collegeLinkStatus: 'approved',
      linkedCollege,
      updatedAt: ts,
    };
    await safeUpdateDoc(`founderIdentities/${f.id}`, {
      linkedOrganizationId: org.id,
      linkedStudentId: stu.id,
      linkedUserId: stu.userId || null,
      collegeLinkStatus: 'approved',
      linkedCollege,
      updatedAt: ts,
    });
    if (f.qrToken) {
      await safeUpdateDoc(`publicQrRegistry/${f.qrToken}`, { linkedCollege, updatedAt: ts }).catch(() => {});
    }
    return { handled: true, data: { founderId: updated, message: `Founder ID linked to ${stu.fullName} (${org.name}).` } };
  }

  if (method === 'GET' && pathname === '/platform/founder-nominations') {
    return { handled: true, data: { nominations: [] } };
  }

  const fndNomReviewMatch = pathname.match(/^\/platform\/founder-nominations\/([^/]+)\/review$/);
  if (method === 'POST' && fndNomReviewMatch) {
    return { handled: true, data: { message: 'Nomination reviewed.' } };
  }

  // 8. Platform Settings, Audit Logs, Integrations, Database Health
  if (method === 'GET' && pathname === '/platform/settings') {
    const rows = await safeListDocs<Record<string, any>>('platformSettings');
    return { handled: true, data: { settings: rows } };
  }

  if (method === 'PUT' && pathname === '/platform/settings') {
    const key = String(body?.key || 'platform_identity').trim();
    await safeSetDoc(`platformSettings/${key}`, {
      key,
      value: body?.value || {},
      description: body?.description || '',
      updatedAt: nowIso(),
    });
    return { handled: true, data: { message: 'Platform setting saved.' } };
  }

  if (method === 'GET' && pathname === '/platform/audit-logs') {
    const logs = await safeListDocs<Record<string, any>>('platformAuditLogs');
    logs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return { handled: true, data: { auditLogs: logs.slice(0, 150) } };
  }

  if (method === 'GET' && pathname === '/platform/integrations') {
    const docData = await safeGetDoc<{ value?: { modules?: any[] } }>('platformSettings/integrations').catch(() => null);
    const defaultModules = [
      { key: 'firebase_auth', name: 'Firebase Authentication', category: 'Identity', status: 'configured', enabled: true, description: 'Google Sign-In & Email/Password authentication.' },
      { key: 'cloud_firestore', name: 'Cloud Firestore', category: 'Database', status: 'configured', enabled: true, description: `Multi-tenant NoSQL store (${firebaseConfig.firestoreDatabaseId}).` },
      { key: 'open_library_isbn', name: 'Open Library & Google Books ISBN API', category: 'Catalog', status: 'configured', enabled: true, description: 'Automatic book metadata lookup from scanned barcodes.' },
    ];
    return { handled: true, data: { integrations: docData?.value?.modules || defaultModules } };
  }

  const intToggleMatch = pathname.match(/^\/platform\/integrations\/([^/]+)$/);
  if ((method === 'PATCH' || method === 'PUT') && intToggleMatch) {
    const docData = await safeGetDoc<{ value?: { modules?: any[] } }>('platformSettings/integrations').catch(() => null);
    const modules = (docData?.value?.modules || []).map((m: any) =>
      m.key === intToggleMatch[1] ? { ...m, enabled: Boolean(body?.enabled) } : m
    );
    await safeSetDoc('platformSettings/integrations', {
      key: 'integrations',
      value: { modules },
      description: 'Platform integration modules',
      updatedAt: nowIso(),
    });
    return { handled: true, data: { ok: true } };
  }

  if (method === 'GET' && (pathname === '/platform/health' || pathname === '/platform/database/health')) {
    const [conn, orgs, users, auditLogs] = await Promise.all([
      testConnection(),
      safeListDocs('organizations').catch(() => []),
      safeListDocs('users').catch(() => []),
      safeListDocs('platformAuditLogs').catch(() => []),
    ]);
    const diag = getFirebaseConfigDiagnostics();
    return {
      handled: true,
      data: {
        status: conn.connected ? 'ok' : 'degraded',
        timestamp: nowIso(),
        engine: 'Cloud Firestore (Firebase)',
        database: {
          connected: conn.connected,
          latencyMs: conn.latencyMs,
          projectId: diag.projectId,
          authDomain: diag.authDomain,
          firestoreDatabaseId: diag.firestoreDatabaseId,
          currentHost: diag.currentHost,
          configSource: diag.source,
          error: conn.error || null,
        },
        totals: {
          organizations: orgs.length,
          profiles: users.length,
          auditLogs: auditLogs.length,
        },
        uptimeSeconds: 0,
        integrations: {
          firebaseAuth: diag.isConfigured,
          cloudFirestore: conn.connected,
          smtpEmail: false,
          whatsapp: false,
          webPush: false,
        },
      },
    };
  }

  return { handled: false };
}

async function findStudentAcrossOrgs(studentId: string) {
  const orgs = await safeListDocs<Record<string, any>>('organizations');
  for (const org of orgs) {
    const stu = await safeGetDoc<Record<string, any>>(`organizations/${org.id}/students/${studentId}`).catch(() => null);
    if (stu) return { org, student: stu };
  }
  return null;
}

async function provisionAccountAsSuperAdmin(input: any) {
  const organizationId = String(input?.organizationId || '').trim();
  const roleSlug = String(input?.roleSlug || '') as 'college_admin' | 'librarian' | 'student';
  const fullName = String(input?.fullName || '').trim();
  const email = normalizeEmail(String(input?.email || ''));
  const phone = input?.phone ? String(input.phone).trim().slice(0, 40) : null;

  if (!organizationId || !['college_admin', 'librarian', 'student'].includes(roleSlug) || !fullName || !email) {
    throw new BackendError('Organization, role, full name, and email are required.', 400);
  }

  const org = await safeGetDoc<Record<string, any>>(`organizations/${organizationId}`);
  if (!org) throw new BackendError('Selected institution does not exist.', 404);

  const policy = await getPlatformPasswordPolicyDoc();
  const useAuto = input?.autoGeneratePassword !== false && !String(input?.password || '').trim();
  const plainTempPassword = useAuto
    ? generatePolicyCompliantPassword(policy)
    : String(input.password).trim();

  if (!useAuto) {
    const check = validatePasswordAgainstPolicy(plainTempPassword, policy);
    if (!check.valid) throw new BackendError(check.error || 'Password does not meet policy.', 400);
  }

  const forceChange =
    input?.requirePasswordChange !== undefined
      ? Boolean(input.requirePasswordChange)
      : policy.forceChangeOnFirstLogin;

  const ts = nowIso();
  let targetUid: string | null = null;
  let alreadyExistedInAuth = false;

  // Provision real Firebase Authentication user via secondary app (keeps Super Admin signed in!)
  try {
    targetUid = await withSecondaryAuth(async (secAuth) => {
      const cred = await createUserWithEmailAndPassword(secAuth, email, plainTempPassword);
      await updateProfile(cred.user, { displayName: fullName }).catch(() => {});
      await sendEmailVerification(cred.user).catch(() => {});
      return cred.user.uid;
    });
  } catch (err: any) {
    if (err?.code === 'auth/email-already-in-use') {
      alreadyExistedInAuth = true;
      const existingUsers = await safeListDocs<Record<string, any>>('users', [where('email', '==', email)]);
      targetUid = existingUsers[0]?.uid || null;
    } else {
      throw new BackendError(formatFirebaseAuthError(err), 400);
    }
  }

  if (targetUid) {
    const existingProfile = await safeGetDoc<Record<string, any>>(`users/${targetUid}`).catch(() => null);
    if (existingProfile) {
      await safeUpdateDoc(`users/${targetUid}`, {
        fullName: fullName.slice(0, 120),
        phone: phone || existingProfile.phone || null,
        mustChangePassword: forceChange,
        status: 'active',
        updatedAt: ts,
      });
    } else {
      await safeSetDoc(`users/${targetUid}`, {
        uid: targetUid,
        email,
        fullName: fullName.slice(0, 120),
        phone,
        avatarUrl: null,
        isSuperAdmin: false,
        mustChangePassword: forceChange,
        status: 'active',
        createdAt: ts,
        updatedAt: ts,
      });
    }

    const membershipId = `${organizationId}_${targetUid}_${roleSlug}`;
    await safeSetDoc(`memberships/${membershipId}`, {
      id: membershipId,
      userId: targetUid,
      organizationId,
      organizationName: org.name,
      organizationCode: org.code,
      organizationStatus: org.status || 'active',
      roleSlug,
      roleName: roleDisplayName(roleSlug),
      status: 'active',
      isDefault: true,
      createdAt: ts,
      updatedAt: ts,
    });
  } else {
    // Email exists in Firebase Auth without a Firestore profile yet — create a pending invite so next sign-in binds automatically
    const inviteId = `${organizationId}_${roleSlug}_${normalizeEmailKey(email)}`;
    await safeSetDoc(`pendingInvites/${inviteId}`, {
      id: inviteId,
      email,
      fullName: fullName.slice(0, 120),
      phone,
      organizationId,
      organizationName: org.name,
      organizationCode: org.code,
      roleSlug,
      mustChangePassword: forceChange,
      status: 'pending',
      createdAt: ts,
      updatedAt: ts,
    });
  }

  // Create institutional sub-record for Librarian or Student
  if (roleSlug === 'librarian') {
    const libId = makeId('lib');
    await safeSetDoc(`organizations/${organizationId}/librarians/${libId}`, {
      id: libId,
      organizationId,
      userId: targetUid,
      employeeCode: `LIB-${Math.floor(1000 + Math.random() * 9000)}`,
      fullName: fullName.slice(0, 120),
      email,
      phone,
      designation: String(input?.designation || 'Librarian').trim(),
      status: 'active',
      createdAt: ts,
      updatedAt: ts,
    });
  } else if (roleSlug === 'student') {
    const stuId = makeId('stu');
    const studentIdCode = `STU-${String(org.code || 'ORG').slice(0, 4).toUpperCase()}-${Math.floor(10000 + Math.random() * 90000)}`;
    const rollNumber = String(input?.collegeRollNumber || '').trim() || `ROLL-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const studentDoc = {
      id: stuId,
      organizationId,
      userId: targetUid,
      studentIdCode,
      fullName: fullName.slice(0, 120),
      fatherName: String(input?.fatherName || 'N/A').trim(),
      collegeRollNumber: rollNumber,
      phone: phone || 'N/A',
      email,
      status: 'active',
      isPremium: false,
      createdAt: ts,
      updatedAt: ts,
    };
    await safeSetDoc(`organizations/${organizationId}/students/${stuId}`, studentDoc);

    // Issue default digital ID card
    const tpls = await safeListDocs<Record<string, any>>(`organizations/${organizationId}/idTemplates`);
    if (tpls[0]) {
      const cardId = makeId('idc');
      const qrToken = makeSecureToken(24);
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      const cardNumber = `ID-${String(org.code || 'ORG').slice(0, 4).toUpperCase()}-${Math.floor(100000 + Math.random() * 900000)}`;
      await safeSetDoc(`organizations/${organizationId}/idCards/${cardId}`, {
        id: cardId,
        organizationId,
        studentId: stuId,
        studentUserId: targetUid,
        templateId: tpls[0].id,
        templateVersion: tpls[0].currentVersion || 1,
        cardNumber,
        qrToken,
        status: 'active',
        issuedAt: ts,
        expiresAt: expiresAt.toISOString(),
        createdAt: ts,
        updatedAt: ts,
      });
      await syncPublicQrRecord({
        token: qrToken,
        entityType: 'student_id',
        entityId: cardId,
        organizationId,
        isActive: true,
        status: 'active',
        expiresAt: expiresAt.toISOString(),
        credential: {
          cardNumber,
          studentName: studentDoc.fullName,
          studentIdCode,
          collegeRollNumber: rollNumber,
          photoUrl: null,
          collegeName: org.branding?.collegeName || org.name,
          collegeLogoUrl: org.branding?.collegeLogoUrl || org.logoUrl || null,
          universityName: org.branding?.universityName || org.universityName || null,
          templateName: tpls[0].name,
          issuedAt: ts,
          expiresAt: expiresAt.toISOString(),
        },
      });
    }
  }

  await writePlatformAudit({
    action: 'platform_account_provisioned',
    entityType: 'profile',
    entityId: targetUid || email,
    organizationId,
    details: { email, roleSlug, mustChangePassword: forceChange },
  });

  return {
    account: {
      profileId: targetUid || email,
      fullName,
      email,
      roleSlug,
      organizationName: org.name,
      mustChangePassword: forceChange,
    },
    temporaryPasswordOnce: alreadyExistedInAuth ? '(Existing Firebase Password Retained)' : plainTempPassword,
    mustChangePassword: forceChange,
    message: alreadyExistedInAuth
      ? `${roleDisplayName(roleSlug)} role attached to existing Firebase account (${email}).`
      : `${roleDisplayName(roleSlug)} account created in Firebase Auth. Copy the one-time temporary password now — it is never stored in plaintext.`,
  };
}
