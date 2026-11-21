import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ============================================================================
// 1. ORGANIZATION & ACCESS CONTROL
// ============================================================================

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    code: text('code').notNull().unique(),
    logoUrl: text('logo_url'),
    universityName: text('university_name'),
    universityLogoUrl: text('university_logo_url'),
    address: text('address'),
    contactNumber: text('contact_number'),
    email: text('email'),
    website: text('website'),
    academicSession: text('academic_session'),
    status: text('status').notNull().default('active'), // active | pending | suspended | inactive
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_organizations_status').on(table.status)]
);

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    uid: text('uid').notNull().unique(), // Firebase Auth UID or server-generated local UID
    email: text('email').notNull().unique(),
    fullName: text('full_name').notNull(),
    phone: text('phone'),
    avatarUrl: text('avatar_url'),
    passwordHash: text('password_hash'),
    passwordSalt: text('password_salt'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    passwordChangedAt: timestamp('password_changed_at'),
    isSuperAdmin: boolean('is_super_admin').notNull().default(false),
    status: text('status').notNull().default('active'), // active | suspended
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_profiles_email').on(table.email)]
);

export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(), // platform_super_admin | college_admin | librarian | student
  name: text('name').notNull(),
  description: text('description'),
  scope: text('scope').notNull().default('organization'), // platform | organization
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const permissions = pgTable('permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  module: text('module').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('uq_role_permissions').on(table.roleId, table.permissionId)]
);

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('active'), // active | suspended | pending
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_org_member_role').on(table.organizationId, table.profileId, table.roleId),
    index('idx_org_members_org').on(table.organizationId),
    index('idx_org_members_profile').on(table.profileId),
  ]
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_reset_tokens_profile').on(table.profileId)]
);

// ============================================================================
// 2. ACADEMIC INFORMATION
// ============================================================================

export const academicSessions = pgTable(
  'academic_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    startDate: text('start_date'),
    endDate: text('end_date'),
    isCurrent: boolean('is_current').notNull().default(false),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_academic_session_org_name').on(table.organizationId, table.name),
    index('idx_academic_sessions_org').on(table.organizationId),
  ]
);

export const departments = pgTable(
  'departments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_departments_org_code').on(table.organizationId, table.code),
    index('idx_departments_org').on(table.organizationId),
  ]
);

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    durationSemesters: integer('duration_semesters').notNull().default(6),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_courses_org_code').on(table.organizationId, table.code),
    index('idx_courses_org').on(table.organizationId),
  ]
);

export const semesters = pgTable(
  'semesters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id').references(() => courses.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_semesters_org').on(table.organizationId)]
);

export const studentCategories = pgTable(
  'student_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    maxBooksAllowed: integer('max_books_allowed').notNull().default(4),
    loanDurationDays: integer('loan_duration_days').notNull().default(14),
    maxRenewals: integer('max_renewals').notNull().default(2),
    finePerDay: numeric('fine_per_day', { precision: 10, scale: 2 }).notNull().default('5.00'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_student_categories_org_name').on(table.organizationId, table.name),
    index('idx_student_categories_org').on(table.organizationId),
  ]
);

// ============================================================================
// 3. STUDENTS & STAFF
// ============================================================================

export const students = pgTable(
  'students',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'set null' }),
    studentIdCode: text('student_id_code').notNull(),
    fullName: text('full_name').notNull(),
    fatherName: text('father_name').notNull(),
    collegeRollNumber: text('college_roll_number').notNull(),
    universityRollNumber: text('university_roll_number'),
    courseId: uuid('course_id').references(() => courses.id, { onDelete: 'set null' }),
    semesterId: uuid('semester_id').references(() => semesters.id, { onDelete: 'set null' }),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    academicSessionId: uuid('academic_session_id').references(() => academicSessions.id, {
      onDelete: 'set null',
    }),
    studentCategoryId: uuid('student_category_id').references(() => studentCategories.id, {
      onDelete: 'set null',
    }),
    dateOfBirth: text('date_of_birth'),
    gender: text('gender'),
    phone: text('phone').notNull(),
    email: text('email').notNull(),
    address: text('address'),
    photoUrl: text('photo_url'),
    idProofUrl: text('id_proof_url'),
    status: text('status').notNull().default('active'), // active | suspended | graduated | archived
    statusReason: text('status_reason'),
    isPremium: boolean('is_premium').notNull().default(false),
    premiumTier: text('premium_tier'), // obsidian_platinum | royal_sapphire | emerald_prestige | crimson_scholar
    premiumDesign: text('premium_design'),
    premiumBadgeLabel: text('premium_badge_label'),
    premiumGrantedAt: timestamp('premium_granted_at'),
    premiumGrantedByProfileId: uuid('premium_granted_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    premiumNote: text('premium_note'),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_students_org_roll').on(table.organizationId, table.collegeRollNumber),
    uniqueIndex('uq_students_org_code').on(table.organizationId, table.studentIdCode),
    uniqueIndex('uq_students_org_email').on(table.organizationId, table.email),
    index('idx_students_org').on(table.organizationId),
    index('idx_students_org_course_sem').on(table.organizationId, table.courseId, table.semesterId),
  ]
);

export const studentApplications = pgTable(
  'student_applications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    submittedByProfileId: uuid('submitted_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    fullName: text('full_name').notNull(),
    fatherName: text('father_name').notNull(),
    collegeRollNumber: text('college_roll_number').notNull(),
    universityRollNumber: text('university_roll_number'),
    proposedStudentId: text('proposed_student_id'),
    courseId: uuid('course_id').references(() => courses.id, { onDelete: 'set null' }),
    semesterId: uuid('semester_id').references(() => semesters.id, { onDelete: 'set null' }),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    academicSessionId: uuid('academic_session_id').references(() => academicSessions.id, {
      onDelete: 'set null',
    }),
    studentCategoryId: uuid('student_category_id').references(() => studentCategories.id, {
      onDelete: 'set null',
    }),
    dateOfBirth: text('date_of_birth'),
    gender: text('gender'),
    phone: text('phone').notNull(),
    email: text('email').notNull(),
    address: text('address'),
    photoUrl: text('photo_url'),
    idProofUrl: text('id_proof_url'),
    status: text('status').notNull().default('pending'), // pending | approved | rejected
    rejectionReason: text('rejection_reason'),
    reviewedByProfileId: uuid('reviewed_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_student_apps_org_status').on(table.organizationId, table.status),
  ]
);

export const librarians = pgTable(
  'librarians',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    employeeCode: text('employee_code').notNull(),
    fullName: text('full_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    designation: text('designation').notNull().default('Librarian'),
    canRegisterStudents: boolean('can_register_students').notNull().default(true),
    canAdjustFines: boolean('can_adjust_fines').notNull().default(false),
    status: text('status').notNull().default('active'), // active | suspended
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_librarians_org_code').on(table.organizationId, table.employeeCode),
    index('idx_librarians_org').on(table.organizationId),
  ]
);

export const staffMembers = pgTable(
  'staff_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'set null' }),
    staffCode: text('staff_code').notNull(),
    fullName: text('full_name').notNull(),
    roleTitle: text('role_title').notNull(),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    email: text('email').notNull(),
    phone: text('phone'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_staff_members_org').on(table.organizationId)]
);

// ============================================================================
// 4. DIGITAL ID SYSTEM, BRANDING & FOUNDER EDITION
// ============================================================================

export const organizationBranding = pgTable('organization_branding', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  collegeName: text('college_name').notNull(),
  collegeLogoUrl: text('college_logo_url'),
  universityName: text('university_name'),
  universityLogoUrl: text('university_logo_url'),
  address: text('address'),
  website: text('website'),
  email: text('email'),
  contactNumber: text('contact_number'),
  officialColor: text('official_color').notNull().default('#1E3A8A'),
  authorizedSignatureUrl: text('authorized_signature_url'),
  authorizedSignatoryName: text('authorized_signatory_name').default('Chief Librarian / Registrar'),
  libraryContactDetails: text('library_contact_details'),
  idCardInstructions: text('id_card_instructions').default(
    'This official digital ID is non-transferable and remains the property of the institution. Present QR code at library circulation desk.'
  ),
  allowStudentIdCustomization: boolean('allow_student_id_customization').notNull().default(false),
  allowStudentBgUpload: boolean('allow_student_bg_upload').notNull().default(false),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const idCardAssets = pgTable(
  'id_card_assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    uploadedByProfileId: uuid('uploaded_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    bucket: text('bucket').notNull(), // college_logos | university_logos | student_photos | student_documents | book_covers | id_backgrounds | id_assets
    isPublic: boolean('is_public').notNull().default(true),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSize: integer('file_size').notNull(),
    dataUrl: text('data_url').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_assets_org_bucket').on(table.organizationId, table.bucket)]
);

export const idTemplates = pgTable(
  'id_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    presetKey: text('preset_key').notNull().default('custom'),
    description: text('description'),
    isSystemPreset: boolean('is_system_preset').notNull().default(false),
    status: text('status').notNull().default('published'), // draft | published | archived
    currentVersion: integer('current_version').notNull().default(1),
    frontConfig: jsonb('front_config').notNull(),
    backConfig: jsonb('back_config').notNull(),
    lockedFields: jsonb('locked_fields').notNull(),
    backgroundImageUrl: text('background_image_url'),
    createdByProfileId: uuid('created_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_id_templates_org_slug').on(table.organizationId, table.slug),
    index('idx_id_templates_org').on(table.organizationId),
  ]
);

export const idTemplateVersions = pgTable(
  'id_template_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => idTemplates.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    frontConfig: jsonb('front_config').notNull(),
    backConfig: jsonb('back_config').notNull(),
    backgroundImageUrl: text('background_image_url'),
    changeNote: text('change_note'),
    createdByProfileId: uuid('created_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_template_versions_template').on(table.templateId)]
);

export const idTemplateAssignments = pgTable(
  'id_template_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => idTemplates.id, { onDelete: 'cascade' }),
    scopeType: text('scope_type').notNull(), // all_existing | all_new | course | semester | academic_session | student_category | individual_student | combined
    courseId: uuid('course_id').references(() => courses.id, { onDelete: 'set null' }),
    semesterId: uuid('semester_id').references(() => semesters.id, { onDelete: 'set null' }),
    academicSessionId: uuid('academic_session_id').references(() => academicSessions.id, {
      onDelete: 'set null',
    }),
    studentCategoryId: uuid('student_category_id').references(() => studentCategories.id, {
      onDelete: 'set null',
    }),
    studentId: uuid('student_id').references(() => students.id, { onDelete: 'set null' }),
    priority: integer('priority').notNull().default(10), // Higher = higher precedence (individual=100, combined=70, semester=50, course=30, default=10)
    applyToNewStudents: boolean('apply_to_new_students').notNull().default(true),
    affectedCount: integer('affected_count').notNull().default(0),
    previousAssignmentSnapshot: jsonb('previous_assignment_snapshot'),
    status: text('status').notNull().default('active'), // active | reversed
    assignedByProfileId: uuid('assigned_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_template_assignments_org').on(table.organizationId)]
);

export const idCards = pgTable(
  'id_cards',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => idTemplates.id, { onDelete: 'restrict' }),
    templateVersion: integer('template_version').notNull().default(1),
    cardNumber: text('card_number').notNull().unique(),
    status: text('status').notNull().default('active'), // pending | active | suspended | blocked | expired | revoked
    statusReason: text('status_reason'),
    issuedAt: timestamp('issued_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    issuedByProfileId: uuid('issued_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revoked_at'),
    revokedByProfileId: uuid('revoked_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    customBgUrl: text('custom_bg_url'),
    customBgSettings: jsonb('custom_bg_settings'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_id_cards_org').on(table.organizationId),
    index('idx_id_cards_student').on(table.studentId),
  ]
);

export const idDesigns = pgTable(
  'id_designs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    idCardId: uuid('id_card_id')
      .notNull()
      .references(() => idCards.id, { onDelete: 'cascade' }),
    backgroundAssetId: uuid('background_asset_id').references(() => idCardAssets.id, {
      onDelete: 'set null',
    }),
    cropConfig: jsonb('crop_config'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_id_designs_student').on(table.studentId)]
);

export const qrTokens = pgTable(
  'qr_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    entityType: text('entity_type').notNull(), // student_id | founder_id
    entityId: uuid('entity_id').notNull(),
    token: text('token').notNull().unique(), // Cryptographically random unguessable token
    isActive: boolean('is_active').notNull().default(true),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
    revokedReason: text('revoked_reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_qr_tokens_token').on(table.token),
    index('idx_qr_tokens_entity').on(table.entityType, table.entityId),
  ]
);

export const founderIdentities = pgTable(
  'founder_identities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'set null' }),
    linkedOrganizationId: uuid('linked_organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    linkedStudentId: uuid('linked_student_id').references(() => students.id, {
      onDelete: 'set null',
    }),
    collegeLinkStatus: text('college_link_status').notNull().default('unlinked'), // unlinked | pending_college_approval | approved | revoked
    collegeApprovedByProfileId: uuid('college_approved_by_profile_id').references(
      () => profiles.id,
      { onDelete: 'set null' }
    ),
    collegeApprovedAt: timestamp('college_approved_at'),
    founderNumber: text('founder_number').notNull().unique(),
    fullName: text('full_name').notNull(),
    designation: text('designation').notNull().default('Founder & Chief Architect'),
    organizationLabel: text('organization_label').notNull().default('QIVORA Technologies'),
    photoUrl: text('photo_url'),
    editionName: text('edition_name').notNull().default('QIVORA — GOLDEN FOUNDER EDITION'),
    bio: text('bio'),
    status: text('status').notNull().default('active'), // active | revoked
    statusReason: text('status_reason'),
    qrTokenId: uuid('qr_token_id').references(() => qrTokens.id, { onDelete: 'set null' }),
    issuedByProfileId: uuid('issued_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    issuedAt: timestamp('issued_at').defaultNow().notNull(),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_founder_identities_status').on(table.status),
    index('idx_founder_identities_linked_student').on(table.linkedStudentId),
    index('idx_founder_identities_linked_org').on(table.linkedOrganizationId),
    index('idx_founder_identities_profile').on(table.profileId),
  ]
);

// ============================================================================
// 5. BOOKS & PHYSICAL INVENTORY
// ============================================================================

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_categories_org_code').on(table.organizationId, table.code),
    index('idx_categories_org').on(table.organizationId),
  ]
);

export const authors = pgTable(
  'authors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    biography: text('biography'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_authors_org').on(table.organizationId)]
);

export const publishers = pgTable(
  'publishers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    website: text('website'),
    contact: text('contact'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_publishers_org').on(table.organizationId)]
);

export const shelves = pgTable(
  'shelves',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    rackCode: text('rack_code').notNull(),
    shelfCode: text('shelf_code').notNull(),
    sectionName: text('section_name').notNull(),
    capacity: integer('capacity').notNull().default(100),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_shelves_org_rack_shelf').on(
      table.organizationId,
      table.rackCode,
      table.shelfCode
    ),
    index('idx_shelves_org').on(table.organizationId),
  ]
);

export const books = pgTable(
  'books',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    isbn: text('isbn').notNull(),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    authorId: uuid('author_id').references(() => authors.id, { onDelete: 'set null' }),
    publisherId: uuid('publisher_id').references(() => publishers.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    edition: text('edition'),
    publicationYear: integer('publication_year'),
    language: text('language').default('English'),
    subject: text('subject'),
    courseId: uuid('course_id').references(() => courses.id, { onDelete: 'set null' }),
    semesterId: uuid('semester_id').references(() => semesters.id, { onDelete: 'set null' }),
    description: text('description'),
    coverImageUrl: text('cover_image_url'),
    defaultShelfId: uuid('default_shelf_id').references(() => shelves.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('active'), // active | archived
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_books_org').on(table.organizationId),
    index('idx_books_org_isbn').on(table.organizationId, table.isbn),
  ]
);

export const bookCopies = pgTable(
  'book_copies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    barcode: text('barcode').notNull(),
    accessionNumber: text('accession_number').notNull(),
    qrCodeValue: text('qr_code_value').notNull(),
    shelfId: uuid('shelf_id').references(() => shelves.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('available'), // available | issued | reserved | damaged | lost | under_maintenance
    condition: text('condition').notNull().default('good'), // new | good | fair | poor | damaged
    purchaseDate: text('purchase_date'),
    purchasePrice: numeric('purchase_price', { precision: 10, scale: 2 }),
    supplier: text('supplier'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_book_copies_org_barcode').on(table.organizationId, table.barcode),
    uniqueIndex('uq_book_copies_org_accession').on(table.organizationId, table.accessionNumber),
    index('idx_book_copies_org_book').on(table.organizationId, table.bookId),
    index('idx_book_copies_status').on(table.organizationId, table.status),
  ]
);

export const acquisitions = pgTable(
  'acquisitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    supplier: text('supplier'),
    invoiceNumber: text('invoice_number'),
    quantity: integer('quantity').notNull(),
    unitPrice: numeric('unit_price', { precision: 10, scale: 2 }),
    totalCost: numeric('total_cost', { precision: 12, scale: 2 }),
    purchasedAt: text('purchased_at'),
    recordedByProfileId: uuid('recorded_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_acquisitions_org').on(table.organizationId)]
);

// ============================================================================
// 6. CIRCULATION, RESERVATIONS & FINES
// ============================================================================

export const loans = pgTable(
  'loans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    bookCopyId: uuid('book_copy_id')
      .notNull()
      .references(() => bookCopies.id, { onDelete: 'restrict' }),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'restrict' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    issuedByProfileId: uuid('issued_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    issuedAt: timestamp('issued_at').defaultNow().notNull(),
    dueAt: timestamp('due_at').notNull(),
    returnedAt: timestamp('returned_at'),
    returnedToProfileId: uuid('returned_to_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    returnCondition: text('return_condition'),
    renewalCount: integer('renewal_count').notNull().default(0),
    status: text('status').notNull().default('active'), // active | returned | overdue | lost
    receiptNumber: text('receipt_number').notNull().unique(),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_loans_org_status').on(table.organizationId, table.status),
    index('idx_loans_student').on(table.studentId),
    index('idx_loans_copy').on(table.bookCopyId),
  ]
);

export const renewals = pgTable(
  'renewals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    loanId: uuid('loan_id')
      .notNull()
      .references(() => loans.id, { onDelete: 'cascade' }),
    renewedByProfileId: uuid('renewed_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    previousDueAt: timestamp('previous_due_at').notNull(),
    newDueAt: timestamp('new_due_at').notNull(),
    renewalNumber: integer('renewal_number').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_renewals_loan').on(table.loanId)]
);

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    assignedCopyId: uuid('assigned_copy_id').references(() => bookCopies.id, {
      onDelete: 'set null',
    }),
    queuePosition: integer('queue_position').notNull().default(1),
    status: text('status').notNull().default('queued'), // queued | ready | fulfilled | cancelled | expired
    notifiedAt: timestamp('notified_at'),
    expiresAt: timestamp('expires_at'),
    fulfilledAt: timestamp('fulfilled_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_reservations_org_status').on(table.organizationId, table.status),
    index('idx_reservations_book').on(table.bookId),
    index('idx_reservations_student').on(table.studentId),
  ]
);

export const fines = pgTable(
  'fines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    loanId: uuid('loan_id').references(() => loans.id, { onDelete: 'set null' }),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    paidAmount: numeric('paid_amount', { precision: 10, scale: 2 }).notNull().default('0.00'),
    waivedAmount: numeric('waived_amount', { precision: 10, scale: 2 }).notNull().default('0.00'),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('unpaid'), // unpaid | partial | paid | waived | waiver_requested
    waiverReason: text('waiver_reason'),
    waiverRequestedByProfileId: uuid('waiver_requested_by_profile_id').references(
      () => profiles.id,
      { onDelete: 'set null' }
    ),
    waiverApprovedByProfileId: uuid('waiver_approved_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    createdByProfileId: uuid('created_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_fines_org_status').on(table.organizationId, table.status),
    index('idx_fines_student').on(table.studentId),
  ]
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    fineId: uuid('fine_id')
      .notNull()
      .references(() => fines.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    paymentMethod: text('payment_method').notNull().default('cash'), // cash | card_counter | bank_transfer | upi_counter | adjustment
    receiptNumber: text('receipt_number').notNull().unique(),
    referenceNote: text('reference_note'),
    recordedByProfileId: uuid('recorded_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    paidAt: timestamp('paid_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_payments_org').on(table.organizationId),
    index('idx_payments_fine').on(table.fineId),
  ]
);

export const damageReports = pgTable(
  'damage_reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    bookCopyId: uuid('book_copy_id')
      .notNull()
      .references(() => bookCopies.id, { onDelete: 'cascade' }),
    loanId: uuid('loan_id').references(() => loans.id, { onDelete: 'set null' }),
    studentId: uuid('student_id').references(() => students.id, { onDelete: 'set null' }),
    severity: text('severity').notNull().default('minor'), // minor | moderate | severe | lost
    description: text('description').notNull(),
    assessedFine: numeric('assessed_fine', { precision: 10, scale: 2 }).default('0.00'),
    reportedByProfileId: uuid('reported_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull().default('open'), // open | resolved
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_damage_reports_org').on(table.organizationId)]
);

// ============================================================================
// 7. ATTENDANCE & COMMUNICATION
// ============================================================================

export const attendance = pgTable(
  'attendance',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    checkInAt: timestamp('check_in_at').defaultNow().notNull(),
    checkOutAt: timestamp('check_out_at'),
    method: text('method').notNull().default('qr'), // qr | manual
    recordedByProfileId: uuid('recorded_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
  },
  (table) => [
    index('idx_attendance_org').on(table.organizationId),
    index('idx_attendance_student').on(table.studentId),
  ]
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    recipientProfileId: uuid('recipient_profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    isRead: boolean('is_read').notNull().default(false),
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_notifications_recipient').on(table.recipientProfileId, table.isRead),
    index('idx_notifications_org').on(table.organizationId),
  ]
);

export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    eventKey: text('event_key').notNull(),
    channel: text('channel').notNull().default('in_app'), // in_app | email | push | whatsapp
    subject: text('subject').notNull(),
    bodyTemplate: text('body_template').notNull(),
    isEnabled: boolean('is_enabled').notNull().default(true),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_notif_templates_org').on(table.organizationId)]
);

// ============================================================================
// 8. PLATFORM & LIBRARY MANAGEMENT
// ============================================================================

export const librarySettings = pgTable('library_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  defaultLoanDays: integer('default_loan_days').notNull().default(14),
  maxBooksPerStudent: integer('max_books_per_student').notNull().default(4),
  maxRenewals: integer('max_renewals').notNull().default(2),
  renewalExtensionDays: integer('renewal_extension_days').notNull().default(7),
  overdueFinePerDay: numeric('overdue_fine_per_day', { precision: 10, scale: 2 })
    .notNull()
    .default('5.00'),
  reservationHoldDays: integer('reservation_hold_days').notNull().default(3),
  allowRenewalWhenReserved: boolean('allow_renewal_when_reserved').notNull().default(false),
  allowRenewalWhenOverdue: boolean('allow_renewal_when_overdue').notNull().default(false),
  maxOutstandingFineForBorrow: numeric('max_outstanding_fine_for_borrow', {
    precision: 10,
    scale: 2,
  })
    .notNull()
    .default('100.00'),
  currencySymbol: text('currency_symbol').notNull().default('₹'),
  idValidityMonths: integer('id_validity_months').notNull().default(12),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    actorProfileId: uuid('actor_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    actorEmail: text('actor_email'),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    details: jsonb('details'),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_audit_logs_org').on(table.organizationId, table.createdAt),
    index('idx_audit_logs_actor').on(table.actorProfileId),
  ]
);

export const platformSettings = pgTable('platform_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  value: jsonb('value').notNull(),
  description: text('description'),
  updatedByProfileId: uuid('updated_by_profile_id').references(() => profiles.id, {
    onDelete: 'set null',
  }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================================
// 9. PART 2 — SMART AUTOMATION, MIGRATION CENTER, NOMINATIONS & INTEGRATIONS
// ============================================================================

export const automationJobs = pgTable(
  'automation_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    jobKey: text('job_key').notNull(), // due_reminders | overdue_alerts | id_expiry_alerts | auto_id_expiry | reservation_alerts | session_rollover | pending_apps | scheduled_reports | inventory_verification | retry_notifications
    name: text('name').notNull(),
    description: text('description'),
    scheduleCron: text('schedule_cron').notNull().default('0 8 * * *'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    config: jsonb('config').default({}).notNull(),
    lastRunAt: timestamp('last_run_at'),
    lastStatus: text('last_status').default('idle'), // idle | success | failed
    lastSummary: text('last_summary'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_automation_org_job').on(table.organizationId, table.jobKey),
    index('idx_automation_org').on(table.organizationId),
  ]
);

export const automationLogs = pgTable(
  'automation_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => automationJobs.id, { onDelete: 'cascade' }),
    jobKey: text('job_key').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    triggerSource: text('trigger_source').notNull().default('manual'), // manual | scheduled | edge_function
    status: text('status').notNull().default('success'), // success | partial | failed
    processedCount: integer('processed_count').notNull().default(0),
    notificationsSent: integer('notifications_sent').notNull().default(0),
    summary: text('summary'),
    details: jsonb('details'),
    triggeredByProfileId: uuid('triggered_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    executedAt: timestamp('executed_at').defaultNow().notNull(),
  },
  (table) => [index('idx_automation_logs_org').on(table.organizationId, table.executedAt)]
);

export const migrationRuns = pgTable(
  'migration_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    importType: text('import_type').notNull(), // students | books | inventory | loans | fines
    fileName: text('file_name').notNull(),
    totalRows: integer('total_rows').notNull().default(0),
    importedRows: integer('imported_rows').notNull().default(0),
    duplicateRows: integer('duplicate_rows').notNull().default(0),
    errorRows: integer('error_rows').notNull().default(0),
    status: text('status').notNull().default('completed'), // completed | partial | failed
    columnMapping: jsonb('column_mapping').default({}).notNull(),
    errorSample: jsonb('error_sample').default([]).notNull(),
    performedByProfileId: uuid('performed_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_migration_runs_org').on(table.organizationId, table.createdAt)]
);

export const founderNominations = pgTable(
  'founder_nominations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id').references(() => students.id, { onDelete: 'set null' }),
    nomineeName: text('nominee_name').notNull(),
    nomineeEmail: text('nominee_email'),
    designation: text('designation').notNull().default('Distinguished Library Fellow'),
    justification: text('justification').notNull(),
    status: text('status').notNull().default('pending'), // pending | approved | rejected
    nominatedByProfileId: uuid('nominated_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    reviewedByProfileId: uuid('reviewed_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    reviewNotes: text('review_notes'),
    issuedFounderId: uuid('issued_founder_id').references(() => founderIdentities.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_founder_nominations_status').on(table.status, table.organizationId)]
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    profileId: uuid('profile_id')
      .notNull()
      .unique()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    inAppEnabled: boolean('in_app_enabled').notNull().default(true),
    emailEnabled: boolean('email_enabled').notNull().default(false),
    pushEnabled: boolean('push_enabled').notNull().default(false),
    categories: jsonb('categories')
      .default({
        registration: true,
        id_status: true,
        circulation: true,
        due_reminders: true,
        overdue: true,
        reservations: true,
        fines: true,
        attendance: true,
        announcements: true,
      })
      .notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  }
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    notificationId: uuid('notification_id').references(() => notifications.id, {
      onDelete: 'set null',
    }),
    recipientEmail: text('recipient_email'),
    channel: text('channel').notNull().default('in_app'), // in_app | email | push | whatsapp
    status: text('status').notNull().default('delivered'), // delivered | failed | skipped_unconfigured
    providerResponse: text('provider_response'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_notif_deliveries_org').on(table.organizationId, table.createdAt)]
);

export const integrationConfigs = pgTable(
  'integration_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    integrationKey: text('integration_key').notNull(), // face_verification | ai_assistant | rfid_inventory | self_checkout_kiosk | whatsapp | payment_gateway | isbn_provider | cloud_documents | smtp_email | web_push
    displayName: text('display_name').notNull(),
    isEnabled: boolean('is_enabled').notNull().default(false),
    configMeta: jsonb('config_meta').default({}).notNull(), // Non-secret settings only
    updatedByProfileId: uuid('updated_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_integration_configs_key').on(table.integrationKey, table.organizationId)]
);

// ============================================================================
// DRIZZLE RELATIONS
// ============================================================================

export const organizationsRelations = relations(organizations, ({ many, one }) => ({
  members: many(organizationMembers),
  branding: one(organizationBranding),
  settings: one(librarySettings),
  students: many(students),
  books: many(books),
}));

export const profilesRelations = relations(profiles, ({ many }) => ({
  memberships: many(organizationMembers),
  notifications: many(notifications),
}));

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMembers.organizationId],
    references: [organizations.id],
  }),
  profile: one(profiles, {
    fields: [organizationMembers.profileId],
    references: [profiles.id],
  }),
  role: one(roles, {
    fields: [organizationMembers.roleId],
    references: [roles.id],
  }),
}));

export const booksRelations = relations(books, ({ one, many }) => ({
  author: one(authors, { fields: [books.authorId], references: [authors.id] }),
  publisher: one(publishers, { fields: [books.publisherId], references: [publishers.id] }),
  category: one(categories, { fields: [books.categoryId], references: [categories.id] }),
  copies: many(bookCopies),
}));

export const bookCopiesRelations = relations(bookCopies, ({ one }) => ({
  book: one(books, { fields: [bookCopies.bookId], references: [books.id] }),
  shelf: one(shelves, { fields: [bookCopies.shelfId], references: [shelves.id] }),
}));
