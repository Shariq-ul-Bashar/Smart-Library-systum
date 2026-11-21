import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
} from '../firebase.ts';
import { LOCKED_OFFICIAL_FIELDS, STARTER_ID_TEMPLATES } from '../../shared/id-presets.ts';
import {
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicyConfig,
} from '../../shared/security-and-tiers.ts';

export const PRIMARY_SUPER_ADMIN_EMAIL = 'mohammad@shariq.com';
export const BOOTSTRAPPED_OWNER_EMAILS = [
  'mohammad@shariq.com',
  'shariqansariboy@gmail.com',
];

export class BackendError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(prefix = 'id'): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

export function makeSecureToken(byteLength = 24): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export function normalizeEmailKey(email: string): string {
  return normalizeEmail(email).replace(/[^a-z0-9]/g, '_');
}

export function normalizeIsbn(raw: string | null | undefined): string {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^0-9X]/g, '');
}

export function generatePolicyCompliantPassword(policy: PasswordPolicyConfig): string {
  const prefix = (policy.prefix || 'QIV').replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'QIV';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '@#$%&*!';
  const pool = upper + lower + digits + symbols;

  const pick = (chars: string) => {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return chars[arr[0] % chars.length];
  };

  const targetLen = Math.max(policy.minLength || 10, prefix.length + 7);
  const bodyChars: string[] = [];
  if (policy.requireUppercase) bodyChars.push(pick(upper));
  if (policy.requireLowercase) bodyChars.push(pick(lower));
  if (policy.requireNumber) bodyChars.push(pick(digits));
  if (policy.requireSpecial) bodyChars.push(pick(symbols));

  while (prefix.length + 1 + bodyChars.length < targetLen) {
    bodyChars.push(pick(pool));
  }

  // Fisher-Yates shuffle
  for (let i = bodyChars.length - 1; i > 0; i--) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    const j = arr[0] % (i + 1);
    [bodyChars[i], bodyChars[j]] = [bodyChars[j], bodyChars[i]];
  }

  return `${prefix}-${bodyChars.join('')}`;
}

export function roleDisplayName(roleSlug: string): string {
  switch (roleSlug) {
    case 'college_admin':
      return 'College Admin';
    case 'librarian':
      return 'Librarian';
    case 'student':
      return 'Student';
    case 'platform_super_admin':
      return 'Platform Super Admin';
    default:
      return roleSlug;
  }
}

export async function safeGetDoc<T = Record<string, any>>(path: string): Promise<(T & { id: string }) | null> {
  const segments = path.split('/').filter(Boolean);
  try {
    const snap = await getDoc(doc(db, segments[0], ...segments.slice(1)));
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as T) };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function safeListDocs<T = Record<string, any>>(
  path: string,
  constraints: QueryConstraint[] = []
): Promise<Array<T & { id: string }>> {
  const segments = path.split('/').filter(Boolean);
  try {
    const ref = collection(db, segments[0], ...segments.slice(1));
    const q = constraints.length > 0 ? query(ref, ...constraints) : ref;
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function safeSetDoc(path: string, data: Record<string, any>, merge = false): Promise<void> {
  const segments = path.split('/').filter(Boolean);
  try {
    await setDoc(doc(db, segments[0], ...segments.slice(1)), data, { merge });
  } catch (error) {
    handleFirestoreError(error, merge ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function safeUpdateDoc(path: string, data: Record<string, any>): Promise<void> {
  const segments = path.split('/').filter(Boolean);
  try {
    await updateDoc(doc(db, segments[0], ...segments.slice(1)), data);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function safeDeleteDoc(path: string): Promise<void> {
  const segments = path.split('/').filter(Boolean);
  try {
    await deleteDoc(doc(db, segments[0], ...segments.slice(1)));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function getPlatformPasswordPolicyDoc(): Promise<PasswordPolicyConfig> {
  const row = await safeGetDoc<{ value?: Partial<PasswordPolicyConfig> }>('platformSettings/password_policy').catch(() => null);
  return {
    ...DEFAULT_PASSWORD_POLICY,
    ...(row?.value || {}),
  };
}

export async function requireSignedInUser() {
  const current = auth.currentUser;
  if (!current) {
    throw new BackendError('Authentication required. Please sign in to continue.', 401);
  }
  const profile = await safeGetDoc<Record<string, any>>(`users/${current.uid}`);
  if (!profile) {
    throw new BackendError('User profile not initialized. Please sign in again.', 401);
  }
  if (profile.status === 'suspended') {
    throw new BackendError('Your account has been suspended. Contact your administrator.', 403);
  }
  return { fbUser: current, profile };
}

export async function requireSuperAdminUser() {
  const ctx = await requireSignedInUser();
  const normalized = normalizeEmail(ctx.fbUser.email || '');
  const isOwnerEmail =
    normalized === PRIMARY_SUPER_ADMIN_EMAIL ||
    (ctx.fbUser.emailVerified && BOOTSTRAPPED_OWNER_EMAILS.includes(normalized));
  if (!ctx.profile.isSuperAdmin && !isOwnerEmail) {
    throw new BackendError('Platform Super Admin authority required.', 403);
  }
  return ctx;
}

export async function requireOrgAccess(
  orgId: string | null | undefined,
  allowedRoles: Array<'college_admin' | 'librarian' | 'student'>
) {
  const ctx = await requireSignedInUser();
  if (!orgId) {
    throw new BackendError('Active institution context is required.', 400);
  }
  if (ctx.profile.isSuperAdmin) {
    return { ...ctx, orgId, roleSlug: 'platform_super_admin' as const };
  }
  const memberships = await safeListDocs<Record<string, any>>('memberships', [
    where('userId', '==', ctx.fbUser.uid),
  ]);
  const active = memberships.find(
    (m) =>
      m.organizationId === orgId &&
      m.status === 'active' &&
      allowedRoles.includes(m.roleSlug)
  );
  if (!active) {
    throw new BackendError('You do not have permission to perform this action in this institution.', 403);
  }
  return { ...ctx, orgId, roleSlug: active.roleSlug as 'college_admin' | 'librarian' | 'student' };
}

export async function writePlatformAudit(input: {
  action: string;
  entityType: string;
  entityId: string;
  organizationId?: string | null;
  details?: Record<string, unknown>;
}) {
  const current = auth.currentUser;
  const id = makeId('pal');
  await safeSetDoc(`platformAuditLogs/${id}`, {
    id,
    organizationId: input.organizationId || null,
    actorUid: current?.uid || null,
    actorEmail: current?.email || null,
    actorRole: 'platform_super_admin',
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    details: input.details || {},
    createdAt: nowIso(),
  }).catch(() => {});
}

export async function writeOrgAudit(input: {
  organizationId: string;
  actorRole?: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
}) {
  const current = auth.currentUser;
  const id = makeId('oal');
  await safeSetDoc(`organizations/${input.organizationId}/auditLogs/${id}`, {
    id,
    organizationId: input.organizationId,
    actorUid: current?.uid || null,
    actorEmail: current?.email || null,
    actorRole: input.actorRole || 'staff',
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    details: input.details || {},
    createdAt: nowIso(),
  }).catch(() => {});
}

export async function createUserNotification(input: {
  recipientUid: string;
  organizationId?: string | null;
  type: string;
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
}) {
  const id = makeId('ntf');
  await safeSetDoc(`notifications/${id}`, {
    id,
    recipientUid: input.recipientUid,
    organizationId: input.organizationId || null,
    type: input.type,
    title: input.title.slice(0, 200),
    message: input.message.slice(0, 1000),
    isRead: false,
    entityType: input.entityType || null,
    entityId: input.entityId || null,
    createdAt: nowIso(),
  }).catch(() => {});
}

export async function syncPublicOrganizationDoc(org: Record<string, any>) {
  await safeSetDoc(`publicOrganizations/${org.id}`, {
    id: org.id,
    name: org.name,
    code: org.code,
    universityName: org.branding?.universityName || org.universityName || null,
    logoUrl: org.branding?.collegeLogoUrl || org.logoUrl || null,
    status: org.status || 'active',
    departments: org.departments || [],
    courses: org.courses || [],
    semesters: org.semesters || [],
    academicSessions: org.academicSessions || [],
    studentCategories: org.studentCategories || [],
    updatedAt: nowIso(),
  });
}

export async function syncPublicQrRecord(record: {
  token: string;
  entityType: 'student_id' | 'founder_id';
  entityId: string;
  organizationId?: string | null;
  isActive: boolean;
  status: string;
  reason?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  credential: Record<string, unknown>;
  founderBadge?: Record<string, unknown> | null;
  premiumStudent?: Record<string, unknown> | null;
  linkedCollege?: Record<string, unknown> | null;
}) {
  await safeSetDoc(`publicQrRegistry/${record.token}`, {
    token: record.token,
    entityType: record.entityType,
    entityId: record.entityId,
    organizationId: record.organizationId || null,
    isActive: record.isActive,
    status: record.status,
    reason: record.reason || null,
    expiresAt: record.expiresAt || null,
    revokedAt: record.revokedAt || null,
    credential: record.credential,
    founderBadge: record.founderBadge || null,
    premiumStudent: record.premiumStudent || null,
    linkedCollege: record.linkedCollege || null,
    updatedAt: nowIso(),
  });
}

export async function provisionOrganizationDefaultsInFirestore(params: {
  orgId: string;
  name: string;
  code: string;
  universityName?: string | null;
  logoUrl?: string | null;
  address?: string | null;
  contactNumber?: string | null;
  email?: string | null;
  website?: string | null;
  academicSession?: string | null;
}) {
  const ts = nowIso();
  const csDeptId = makeId('dept');
  const mgmtDeptId = makeId('dept');
  const bcaId = makeId('crs');
  const bbaId = makeId('crs');
  const bcomId = makeId('crs');
  const sessionName = params.academicSession?.trim() || '2026-2027';

  const departments = [
    { id: csDeptId, name: 'Computer Applications & Science', code: 'CS' },
    { id: mgmtDeptId, name: 'Business & Commerce', code: 'COM' },
  ];

  const courses = [
    { id: bcaId, departmentId: csDeptId, name: 'Bachelor of Computer Applications (BCA)', code: 'BCA', durationSemesters: 6 },
    { id: bbaId, departmentId: mgmtDeptId, name: 'Bachelor of Business Administration (BBA)', code: 'BBA', durationSemesters: 6 },
    { id: bcomId, departmentId: mgmtDeptId, name: 'Bachelor of Commerce (B.Com)', code: 'BCOM', durationSemesters: 6 },
  ];

  const semesters: Array<{ id: string; courseId: string; number: number; name: string }> = [];
  for (const c of courses) {
    for (let s = 1; s <= c.durationSemesters; s++) {
      semesters.push({ id: makeId('sem'), courseId: c.id, number: s, name: `Semester ${s}` });
    }
  }

  const academicSessions = [
    {
      id: makeId('sess'),
      name: sessionName,
      startDate: '2026-07-01',
      endDate: '2027-06-30',
      isCurrent: true,
      status: 'active',
    },
  ];

  const studentCategories = [
    { id: makeId('scat'), name: 'Undergraduate', maxBooksAllowed: 4, loanDurationDays: 14, maxRenewals: 2, finePerDay: '5.00' },
    { id: makeId('scat'), name: 'Postgraduate', maxBooksAllowed: 6, loanDurationDays: 21, maxRenewals: 3, finePerDay: '5.00' },
    { id: makeId('scat'), name: 'Research Scholar', maxBooksAllowed: 10, loanDurationDays: 30, maxRenewals: 4, finePerDay: '2.00' },
  ];

  const categories = [
    { id: makeId('bcat'), name: 'Computer Science', code: 'CS', description: 'Algorithms, systems, software engineering, and computing.' },
    { id: makeId('bcat'), name: 'Management & Finance', code: 'MGT', description: 'Business administration, accounting, and economics.' },
    { id: makeId('bcat'), name: 'Reference & Journals', code: 'REF', description: 'Academic handbooks, encyclopedias, and periodicals.' },
  ];

  const shelves = [
    { id: makeId('shf'), rackCode: 'R1', shelfCode: 'S1', sectionName: 'Computing & Engineering', capacity: 120 },
    { id: makeId('shf'), rackCode: 'R1', shelfCode: 'S2', sectionName: 'Mathematics & Logic', capacity: 100 },
    { id: makeId('shf'), rackCode: 'R2', shelfCode: 'S1', sectionName: 'Commerce & Management', capacity: 120 },
  ];

  const notificationTemplates = [
    {
      id: makeId('ntpl'),
      eventKey: 'registration_approved',
      channel: 'in_app',
      subject: 'Library Membership Approved',
      bodyTemplate: 'Your student library registration has been approved and your Digital ID is active.',
      isActive: true,
    },
    {
      id: makeId('ntpl'),
      eventKey: 'book_issued',
      channel: 'in_app',
      subject: 'Book Issued',
      bodyTemplate: 'A book copy has been issued to your account. Check your due date in My Books.',
      isActive: true,
    },
    {
      id: makeId('ntpl'),
      eventKey: 'reservation_ready',
      channel: 'in_app',
      subject: 'Reserved Book Ready for Pickup',
      bodyTemplate: 'Your reserved book is now available at the library circulation desk.',
      isActive: true,
    },
  ];

  const orgDoc = {
    id: params.orgId,
    name: params.name,
    code: params.code,
    universityName: params.universityName || null,
    logoUrl: params.logoUrl || null,
    address: params.address || null,
    contactNumber: params.contactNumber || null,
    email: params.email || null,
    website: params.website || null,
    academicSession: sessionName,
    status: 'active',
    branding: {
      organizationId: params.orgId,
      collegeName: params.name,
      collegeLogoUrl: params.logoUrl || null,
      universityName: params.universityName || null,
      universityLogoUrl: null,
      address: params.address || null,
      website: params.website || null,
      email: params.email || null,
      contactNumber: params.contactNumber || null,
      officialColor: '#1E3A8A',
      libraryContactDetails: params.contactNumber || params.email || null,
      allowStudentIdCustomization: false,
      allowStudentBgUpload: false,
      defaultIdTheme: 'classic_academic',
      signatureTitle: 'Chief Librarian',
      signatureImageUrl: null,
    },
    settings: {
      organizationId: params.orgId,
      defaultLoanDays: 14,
      maxBooksPerStudent: 4,
      maxRenewals: 2,
      renewalExtensionDays: 7,
      overdueFinePerDay: '5.00',
      reservationHoldDays: 3,
      allowRenewalWhenReserved: false,
      allowRenewalWhenOverdue: false,
      maxOutstandingFineForBorrow: '100.00',
      currencySymbol: '₹',
      idValidityMonths: 12,
    },
    departments,
    courses,
    semesters,
    academicSessions,
    studentCategories,
    categories,
    authors: [],
    shelves,
    notificationTemplates,
    notificationPreferences: {
      inAppEnabled: true,
      emailEnabled: false,
      dueReminderDaysBefore: 2,
      overdueDigestEnabled: true,
    },
    createdAt: ts,
    updatedAt: ts,
  };

  await safeSetDoc(`organizations/${params.orgId}`, orgDoc);
  await syncPublicOrganizationDoc(orgDoc);

  // Seed all 9 starter ID templates
  for (const preset of STARTER_ID_TEMPLATES) {
    const tplId = makeId('tpl');
    await safeSetDoc(`organizations/${params.orgId}/idTemplates/${tplId}`, {
      id: tplId,
      organizationId: params.orgId,
      name: preset.name,
      slug: preset.slug,
      presetKey: preset.presetKey,
      description: preset.description,
      isSystemPreset: true,
      status: 'published',
      currentVersion: 1,
      frontConfig: preset.frontConfig,
      backConfig: preset.backConfig,
      lockedFields: [...LOCKED_OFFICIAL_FIELDS],
      createdAt: ts,
      updatedAt: ts,
    });
  }

  return orgDoc;
}

/**
 * Direct browser CORS metadata lookup via Open Library API with Google Books API fallback.
 * Works 100% client-side on Vercel and AI Studio with zero custom server required.
 */
export async function fetchIsbnMetadataFromPublicApis(rawIsbn: string) {
  const isbn = normalizeIsbn(rawIsbn);
  if (!isbn || (isbn.length !== 10 && isbn.length !== 13)) {
    throw new BackendError('Please provide a valid 10-digit or 13-digit ISBN.', 400);
  }

  // 1. Try Open Library API
  try {
    const olRes = await fetch(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`
    );
    if (olRes.ok) {
      const olJson = (await olRes.json()) as Record<string, any>;
      const entry = olJson[`ISBN:${isbn}`];
      if (entry && entry.title) {
        const yearMatch = String(entry.publish_date || '').match(/\b(1[5-9]\d{2}|20\d{2})\b/);
        return {
          found: true,
          source: 'open_library',
          metadata: {
            isbn,
            title: String(entry.title).trim(),
            subtitle: entry.subtitle ? String(entry.subtitle).trim() : null,
            authorName:
              Array.isArray(entry.authors) && entry.authors.length > 0
                ? entry.authors.map((a: any) => a.name).filter(Boolean).join(', ')
                : null,
            publisherName:
              Array.isArray(entry.publishers) && entry.publishers.length > 0
                ? entry.publishers[0]?.name || null
                : null,
            publicationYear: yearMatch ? Number(yearMatch[1]) : null,
            subject:
              Array.isArray(entry.subjects) && entry.subjects.length > 0
                ? entry.subjects[0]?.name || null
                : null,
            description:
              typeof entry.notes === 'string'
                ? entry.notes.slice(0, 600)
                : entry.notes?.value
                ? String(entry.notes.value).slice(0, 600)
                : null,
            coverImageUrl:
              entry.cover?.large || entry.cover?.medium || entry.cover?.small || null,
            language: 'English',
          },
        };
      }
    }
  } catch {
    // Fall through to Google Books API
  }

  // 2. Fallback to Google Books API
  try {
    const gbRes = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`
    );
    if (gbRes.ok) {
      const gbJson = (await gbRes.json()) as { items?: Array<{ volumeInfo?: any }> };
      const info = gbJson.items?.[0]?.volumeInfo;
      if (info && info.title) {
        const yearMatch = String(info.publishedDate || '').match(/\b(1[5-9]\d{2}|20\d{2})\b/);
        const rawThumb = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || null;
        return {
          found: true,
          source: 'google_books',
          metadata: {
            isbn,
            title: String(info.title).trim(),
            subtitle: info.subtitle ? String(info.subtitle).trim() : null,
            authorName: Array.isArray(info.authors) ? info.authors.join(', ') : null,
            publisherName: info.publisher || null,
            publicationYear: yearMatch ? Number(yearMatch[1]) : null,
            subject: Array.isArray(info.categories) ? info.categories[0] || null : null,
            description: info.description ? String(info.description).slice(0, 600) : null,
            coverImageUrl: rawThumb ? String(rawThumb).replace(/^http:/, 'https:') : null,
            language: info.language === 'en' ? 'English' : info.language || 'English',
          },
        };
      }
    }
  } catch {
    // ignore
  }

  return {
    found: false,
    source: 'none',
    metadata: null,
    message: `No public metadata found for ISBN ${isbn}. You may enter the book details manually.`,
  };
}
