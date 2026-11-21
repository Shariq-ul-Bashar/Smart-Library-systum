import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  academicSessions,
  categories,
  courses,
  departments,
  idTemplates,
  idTemplateVersions,
  librarySettings,
  notificationTemplates,
  organizationBranding,
  permissions,
  platformSettings,
  profiles,
  rolePermissions,
  roles,
  semesters,
  shelves,
  studentCategories,
} from '../db/schema.ts';
import { LOCKED_OFFICIAL_FIELDS, STARTER_ID_TEMPLATES } from '../shared/id-presets.ts';
import { DEFAULT_PASSWORD_POLICY } from '../shared/security-and-tiers.ts';
import { generateSecureToken, hashPassword } from './auth.ts';

export const PRIMARY_SUPER_ADMIN_EMAIL = (
  process.env.SUPER_ADMIN_EMAIL || 'mohammad@shariq.com'
)
  .toLowerCase()
  .trim();

let bootstrapped = false;

const SYSTEM_ROLES = [
  {
    slug: 'platform_super_admin',
    name: 'Platform Super Admin',
    description: 'Owner-level SaaS governance across registered institutions and Founder IDs.',
    scope: 'platform',
  },
  {
    slug: 'college_admin',
    name: 'College Admin',
    description: 'Full institutional authority over students, librarians, catalog, branding, and ID templates.',
    scope: 'organization',
  },
  {
    slug: 'librarian',
    name: 'Librarian',
    description: 'Daily library circulation, returns, renewals, reservations, fines, and catalog operations.',
    scope: 'organization',
  },
  {
    slug: 'student',
    name: 'Student',
    description: 'Self-service portal for Digital ID, book discovery, reservations, loans, and fines.',
    scope: 'organization',
  },
];

const SYSTEM_PERMISSIONS = [
  { code: 'platform.manage_orgs', name: 'Manage Organizations', module: 'platform' },
  { code: 'platform.manage_admins', name: 'Manage College Admins', module: 'platform' },
  { code: 'platform.manage_founders', name: 'Manage Founder IDs', module: 'platform' },
  { code: 'platform.view_audit', name: 'View Platform Audit Logs', module: 'platform' },
  { code: 'org.manage_branding', name: 'Manage College Branding', module: 'organization' },
  { code: 'org.manage_settings', name: 'Manage Library Rules', module: 'organization' },
  { code: 'org.manage_librarians', name: 'Manage Librarians', module: 'staff' },
  { code: 'org.manage_id_templates', name: 'Manage ID Templates & Assignments', module: 'digital_id' },
  { code: 'org.manage_students', name: 'Manage Students & Applications', module: 'students' },
  { code: 'org.manage_books', name: 'Manage Books & Copies', module: 'catalog' },
  { code: 'org.operate_circulation', name: 'Issue, Return & Renew Books', module: 'circulation' },
  { code: 'org.manage_fines', name: 'Collect & Adjust Fines', module: 'fines' },
  { code: 'org.view_reports', name: 'View Library Analytics', module: 'reports' },
  { code: 'org.view_audit', name: 'View Organization Audit Logs', module: 'audit' },
  { code: 'student.self_service', name: 'Access Student Portal', module: 'student' },
];

const ROLE_PERMISSION_MAP: Record<string, string[]> = {
  platform_super_admin: [
    'platform.manage_orgs',
    'platform.manage_admins',
    'platform.manage_founders',
    'platform.view_audit',
  ],
  college_admin: [
    'org.manage_branding',
    'org.manage_settings',
    'org.manage_librarians',
    'org.manage_id_templates',
    'org.manage_students',
    'org.manage_books',
    'org.operate_circulation',
    'org.manage_fines',
    'org.view_reports',
    'org.view_audit',
  ],
  librarian: [
    'org.manage_students',
    'org.manage_books',
    'org.operate_circulation',
    'org.manage_fines',
    'org.view_reports',
  ],
  student: ['student.self_service'],
};

export async function ensureSystemBootstrapped() {
  if (bootstrapped) return;

  for (const r of SYSTEM_ROLES) {
    await db.insert(roles).values(r).onConflictDoNothing({ target: roles.slug });
  }
  for (const p of SYSTEM_PERMISSIONS) {
    await db.insert(permissions).values(p).onConflictDoNothing({ target: permissions.code });
  }

  const allRoles = await db.select().from(roles);
  const allPerms = await db.select().from(permissions);
  const roleBySlug = new Map(allRoles.map((r) => [r.slug, r.id]));
  const permByCode = new Map(allPerms.map((p) => [p.code, p.id]));

  for (const [slug, permCodes] of Object.entries(ROLE_PERMISSION_MAP)) {
    const roleId = roleBySlug.get(slug);
    if (!roleId) continue;
    for (const code of permCodes) {
      const permId = permByCode.get(code);
      if (!permId) continue;
      await db
        .insert(rolePermissions)
        .values({ roleId, permissionId: permId })
        .onConflictDoNothing();
    }
  }

  const defaultSettings = [
    {
      key: 'platform_identity',
      value: {
        productName: 'QIVORA',
        tagline: 'Intelligence for Every Library.',
        supportEmail: 'support@qivora.edu',
        maintenanceMode: false,
      },
      description: 'Global QIVORA Smart Library Management platform identity and operational flags',
    },
    {
      key: 'security_defaults',
      value: {
        qrTokenEntropyBytes: 24,
        sessionDurationDays: 7,
        allowPublicStudentRegistration: true,
        enforceStrictTenantIsolation: true,
      },
      description: 'Global platform security and tenant governance policy',
    },
    {
      key: 'password_policy',
      value: DEFAULT_PASSWORD_POLICY,
      description:
        'Configurable default password policy/template with unique temporary passwords and mandatory first-login password change',
    },
  ];

  for (const s of defaultSettings) {
    await db.insert(platformSettings).values(s).onConflictDoNothing({ target: platformSettings.key });
  }

  // Ensure primary Platform Super Admin account exists (email: mohammad@shariq.com by default).
  // Passwords are NEVER hardcoded in source: optional SUPER_ADMIN_INITIAL_PASSWORD env var
  // initializes the password hash server-side once; otherwise the secure one-time setup endpoint
  // allows the owner to initialize their password on first visit.
  const existingPrimary = await db
    .select()
    .from(profiles)
    .where(eq(profiles.email, PRIMARY_SUPER_ADMIN_EMAIL))
    .limit(1);

  const envInitialPassword = (process.env.SUPER_ADMIN_INITIAL_PASSWORD || '').trim();

  if (existingPrimary.length === 0) {
    const creds = envInitialPassword.length >= 8 ? hashPassword(envInitialPassword) : null;
    await db
      .insert(profiles)
      .values({
        uid: `superadmin_${generateSecureToken(12)}`,
        email: PRIMARY_SUPER_ADMIN_EMAIL,
        fullName: 'Mohammad Shariq',
        isSuperAdmin: true,
        status: 'active',
        passwordHash: creds?.hash || null,
        passwordSalt: creds?.salt || null,
        mustChangePassword: false,
      })
      .onConflictDoNothing({ target: profiles.email });
  } else {
    const current = existingPrimary[0];
    const updates: Partial<typeof profiles.$inferInsert> = {};
    if (!current.isSuperAdmin) updates.isSuperAdmin = true;
    if (current.status !== 'active') updates.status = 'active';
    if (!current.passwordHash && envInitialPassword.length >= 8) {
      const creds = hashPassword(envInitialPassword);
      updates.passwordHash = creds.hash;
      updates.passwordSalt = creds.salt;
      updates.mustChangePassword = false;
    }
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db.update(profiles).set(updates).where(eq(profiles.id, current.id));
    }
  }

  bootstrapped = true;
}

export async function provisionOrganizationDefaults(params: {
  organizationId: string;
  name: string;
  universityName?: string | null;
  logoUrl?: string | null;
  universityLogoUrl?: string | null;
  address?: string | null;
  contactNumber?: string | null;
  email?: string | null;
  website?: string | null;
  academicSession?: string | null;
  actorProfileId?: string | null;
}) {
  const { organizationId, name } = params;

  await db
    .insert(organizationBranding)
    .values({
      organizationId,
      collegeName: name,
      collegeLogoUrl: params.logoUrl || null,
      universityName: params.universityName || null,
      universityLogoUrl: params.universityLogoUrl || null,
      address: params.address || null,
      website: params.website || null,
      email: params.email || null,
      contactNumber: params.contactNumber || null,
      officialColor: '#1E3A8A',
      libraryContactDetails: params.contactNumber || params.email || null,
      allowStudentIdCustomization: false,
      allowStudentBgUpload: false,
    })
    .onConflictDoNothing();

  await db
    .insert(librarySettings)
    .values({
      organizationId,
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
    })
    .onConflictDoNothing();

  // Seed all 9 starter ID templates + version 1 records
  const existingTemplates = await db
    .select({ id: idTemplates.id })
    .from(idTemplates)
    .where(eq(idTemplates.organizationId, organizationId))
    .limit(1);

  if (existingTemplates.length === 0) {
    for (const preset of STARTER_ID_TEMPLATES) {
      const [tpl] = await db
        .insert(idTemplates)
        .values({
          organizationId,
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
          createdByProfileId: params.actorProfileId || null,
        })
        .returning();

      await db.insert(idTemplateVersions).values({
        templateId: tpl.id,
        organizationId,
        versionNumber: 1,
        frontConfig: preset.frontConfig,
        backConfig: preset.backConfig,
        changeNote: 'Initial starter preset version',
        createdByProfileId: params.actorProfileId || null,
      });
    }
  }

  // Academic session
  const sessionName = params.academicSession?.trim() || '2026-2027';
  await db
    .insert(academicSessions)
    .values({
      organizationId,
      name: sessionName,
      startDate: '2026-07-01',
      endDate: '2027-06-30',
      isCurrent: true,
      status: 'active',
    })
    .onConflictDoNothing();

  // Default student categories
  const defaultCategories = [
    { name: 'Undergraduate', maxBooksAllowed: 4, loanDurationDays: 14, maxRenewals: 2, finePerDay: '5.00' },
    { name: 'Postgraduate', maxBooksAllowed: 6, loanDurationDays: 21, maxRenewals: 3, finePerDay: '5.00' },
    { name: 'Research Scholar', maxBooksAllowed: 10, loanDurationDays: 30, maxRenewals: 4, finePerDay: '2.00' },
  ];
  for (const cat of defaultCategories) {
    await db
      .insert(studentCategories)
      .values({ organizationId, ...cat })
      .onConflictDoNothing();
  }

  // Starter Departments, Courses & Semesters
  const existingDepts = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.organizationId, organizationId))
    .limit(1);

  if (existingDepts.length === 0) {
    const [csDept] = await db
      .insert(departments)
      .values({ organizationId, name: 'Computer Applications & Science', code: 'CS' })
      .returning();
    const [mgmtDept] = await db
      .insert(departments)
      .values({ organizationId, name: 'Business & Commerce', code: 'COM' })
      .returning();

    const starterCourses = [
      { departmentId: csDept.id, name: 'Bachelor of Computer Applications (BCA)', code: 'BCA', durationSemesters: 6 },
      { departmentId: mgmtDept.id, name: 'Bachelor of Business Administration (BBA)', code: 'BBA', durationSemesters: 6 },
      { departmentId: mgmtDept.id, name: 'Bachelor of Commerce (B.Com)', code: 'BCOM', durationSemesters: 6 },
    ];

    for (const c of starterCourses) {
      const [createdCourse] = await db
        .insert(courses)
        .values({ organizationId, ...c })
        .returning();

      for (let s = 1; s <= c.durationSemesters; s++) {
        await db.insert(semesters).values({
          organizationId,
          courseId: createdCourse.id,
          number: s,
          name: `Semester ${s}`,
        });
      }
    }
  }

  // Starter Book Categories & Shelves
  const starterBookCats = [
    { name: 'Computer Science', code: 'CS', description: 'Algorithms, systems, software engineering, and computing.' },
    { name: 'Management & Finance', code: 'MGT', description: 'Business administration, accounting, and economics.' },
    { name: 'Reference & Journals', code: 'REF', description: 'Academic handbooks, encyclopedias, and periodicals.' },
  ];
  for (const bc of starterBookCats) {
    await db.insert(categories).values({ organizationId, ...bc }).onConflictDoNothing();
  }

  const starterShelves = [
    { rackCode: 'R1', shelfCode: 'S1', sectionName: 'Computing & Engineering', capacity: 120 },
    { rackCode: 'R1', shelfCode: 'S2', sectionName: 'Mathematics & Logic', capacity: 100 },
    { rackCode: 'R2', shelfCode: 'S1', sectionName: 'Commerce & Management', capacity: 120 },
  ];
  for (const sh of starterShelves) {
    await db.insert(shelves).values({ organizationId, ...sh }).onConflictDoNothing();
  }

  // Default notification templates
  const existingNotifTpls = await db
    .select({ id: notificationTemplates.id })
    .from(notificationTemplates)
    .where(eq(notificationTemplates.organizationId, organizationId))
    .limit(1);

  if (existingNotifTpls.length === 0) {
    await db.insert(notificationTemplates).values([
      {
        organizationId,
        eventKey: 'registration_approved',
        channel: 'in_app',
        subject: 'Library Membership Approved',
        bodyTemplate: 'Your student library registration has been approved and your Digital ID is active.',
      },
      {
        organizationId,
        eventKey: 'book_issued',
        channel: 'in_app',
        subject: 'Book Issued',
        bodyTemplate: 'A book copy has been issued to your account. Check your due date in My Books.',
      },
      {
        organizationId,
        eventKey: 'reservation_ready',
        channel: 'in_app',
        subject: 'Reserved Book Ready for Pickup',
        bodyTemplate: 'Your reserved book is now available at the library circulation desk.',
      },
    ]);
  }
}
