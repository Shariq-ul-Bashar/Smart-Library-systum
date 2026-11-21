import { Router } from 'express';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  academicSessions,
  courses,
  departments,
  founderIdentities,
  idCards,
  idTemplates,
  librarians,
  notifications,
  organizationBranding,
  organizationMembers,
  organizations,
  passwordResetTokens,
  profiles,
  qrTokens,
  roles,
  semesters,
  studentApplications,
  studentCategories,
  students,
} from '../../db/schema.ts';
import {
  type AuthRequest,
  createNotification,
  generateSecureToken,
  hashPassword,
  loadProfileMemberships,
  logAudit,
  requireAuth,
  sha256,
  signSessionToken,
  verifyPassword,
} from '../auth.ts';
import { ensureSystemBootstrapped, PRIMARY_SUPER_ADMIN_EMAIL } from '../bootstrap.ts';
import { getPlatformPasswordPolicy } from '../password-policy.ts';
import {
  DEFAULT_PASSWORD_POLICY,
  getPremiumStudentDesign,
  validatePasswordAgainstPolicy,
} from '../../shared/security-and-tiers.ts';

export const authRouter = Router();

function serializeAuthUser(profile: typeof profiles.$inferSelect) {
  return {
    id: profile.id,
    uid: profile.uid,
    email: profile.email,
    fullName: profile.fullName,
    phone: profile.phone,
    avatarUrl: profile.avatarUrl,
    isSuperAdmin: profile.isSuperAdmin,
    mustChangePassword: profile.mustChangePassword,
    status: profile.status,
  };
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

authRouter.post('/auth/login', async (req, res) => {
  try {
    await ensureSystemBootstrapped();
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Please enter a valid email address and password.' });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const rows = await db.select().from(profiles).where(eq(profiles.email, email)).limit(1);
    const profile = rows[0];

    if (!profile || !profile.passwordHash || !profile.passwordSalt) {
      return res.status(401).json({
        error: 'Invalid credentials or this account uses Google Sign-In.',
      });
    }

    if (profile.status !== 'active') {
      return res.status(403).json({ error: 'Account is suspended. Contact your administrator.' });
    }

    const valid = verifyPassword(parsed.data.password, profile.passwordSalt, profile.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    await db
      .update(profiles)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(profiles.id, profile.id));

    const token = signSessionToken({
      profileId: profile.id,
      uid: profile.uid,
      email: profile.email,
    });
    const memberships = await loadProfileMemberships(profile.id);

    res.json({
      token,
      user: serializeAuthUser(profile),
      memberships,
    });
  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).json({ error: 'Authentication service failed. Please try again.' });
  }
});

// Secure one-time Super Admin initial password status check (never exposes secrets or hashes)
authRouter.get('/auth/setup-status', async (_req, res) => {
  try {
    await ensureSystemBootstrapped();
    const [primary] = await db
      .select({
        id: profiles.id,
        email: profiles.email,
        passwordHash: profiles.passwordHash,
      })
      .from(profiles)
      .where(eq(profiles.email, PRIMARY_SUPER_ADMIN_EMAIL))
      .limit(1);

    const needsSuperAdminSetup = Boolean(primary && !primary.passwordHash);
    res.json({
      superAdminEmail: PRIMARY_SUPER_ADMIN_EMAIL,
      needsSuperAdminSetup,
    });
  } catch (error) {
    console.error('Setup status check failed:', error);
    res.status(500).json({ error: 'Unable to check initialization status.' });
  }
});

// Secure one-time server-side Super Admin initial password initialization
// Permanently locks itself as soon as mohammad@shariq.com has a password hash stored.
authRouter.post('/auth/setup-super-admin', async (req, res) => {
  try {
    await ensureSystemBootstrapped();
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      fullName: z.string().min(2).max(120).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Valid email and strong password (min 8 chars) are required.',
      });
    }

    const requestedEmail = parsed.data.email.toLowerCase().trim();
    if (requestedEmail !== PRIMARY_SUPER_ADMIN_EMAIL) {
      return res.status(403).json({
        error: `Initial Super Admin setup is restricted exclusively to ${PRIMARY_SUPER_ADMIN_EMAIL}.`,
      });
    }

    const [primary] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.email, PRIMARY_SUPER_ADMIN_EMAIL))
      .limit(1);

    if (!primary) {
      return res.status(404).json({ error: 'Super Admin bootstrap record not found.' });
    }

    if (primary.passwordHash) {
      return res.status(403).json({
        error: 'Super Admin password is already initialized. Sign in or use password recovery.',
      });
    }

    const policyCheck = validatePasswordAgainstPolicy(parsed.data.password, DEFAULT_PASSWORD_POLICY);
    if (!policyCheck.valid) {
      return res.status(400).json({ error: policyCheck.error });
    }

    const { salt, hash } = hashPassword(parsed.data.password);
    const [updated] = await db
      .update(profiles)
      .set({
        fullName: parsed.data.fullName?.trim() || primary.fullName,
        passwordHash: hash,
        passwordSalt: salt,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        lastLoginAt: new Date(),
        isSuperAdmin: true,
        status: 'active',
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, primary.id))
      .returning();

    await logAudit({
      actorProfile: updated,
      actorRole: 'platform_super_admin',
      action: 'super_admin_initialized',
      entityType: 'profile',
      entityId: updated.id,
      details: { email: updated.email },
    });

    const token = signSessionToken({
      profileId: updated.id,
      uid: updated.uid,
      email: updated.email,
    });
    const memberships = await loadProfileMemberships(updated.id);

    res.status(201).json({
      token,
      user: serializeAuthUser(updated),
      memberships,
      message: `Super Admin account (${updated.email}) initialized securely.`,
    });
  } catch (error) {
    console.error('Super Admin setup failed:', error);
    res.status(500).json({ error: 'Unable to complete Super Admin setup.' });
  }
});

authRouter.post('/auth/forgot-password', async (req, res) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : '';
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    const rows = await db.select().from(profiles).where(eq(profiles.email, email)).limit(1);
    if (rows.length === 0) {
      // Return neutral response to prevent account enumeration
      return res.json({
        message: 'If an institutional account matches this email, a password reset token has been generated.',
      });
    }

    const profile = rows[0];
    const rawToken = generateSecureToken(24);
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30); // 30 mins

    await db.insert(passwordResetTokens).values({
      profileId: profile.id,
      tokenHash,
      expiresAt,
    });

    await logAudit({
      actorProfile: profile,
      action: 'password_reset_requested',
      entityType: 'profile',
      entityId: profile.id,
      details: { email: profile.email },
    });

    // Note: External email delivery requires SMTP credentials in .env; do not claim email was delivered.
    const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
    res.json({
      message: smtpConfigured
        ? 'Password reset link queued for email delivery.'
        : 'SMTP email delivery is not configured yet. Use the secure reset token below to complete your password reset.',
      smtpConfigured,
      resetToken: smtpConfigured ? undefined : rawToken,
      expiresAt,
    });
  } catch (error) {
    console.error('Forgot password failed:', error);
    res.status(500).json({ error: 'Unable to initiate password reset.' });
  }
});

const resetSchema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

authRouter.post('/auth/reset-password', async (req, res) => {
  try {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid reset input.' });
    }

    const tokenHash = sha256(parsed.data.token.trim());
    const found = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date())
        )
      )
      .limit(1);

    if (found.length === 0) {
      return res.status(400).json({ error: 'Reset token is invalid or has expired.' });
    }

    const record = found[0];
    const { salt, hash } = hashPassword(parsed.data.newPassword);

    await db.transaction(async (tx) => {
      await tx
        .update(profiles)
        .set({
          passwordHash: hash,
          passwordSalt: salt,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, record.profileId));
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, record.id));
    });

    res.json({ message: 'Password updated successfully. You may now sign in.' });
  } catch (error) {
    console.error('Reset password failed:', error);
    res.status(500).json({ error: 'Unable to reset password.' });
  }
});

authRouter.get('/auth/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const profile = req.profile!;
    const memberships = req.memberships || [];

    const studentRecords = await db
      .select()
      .from(students)
      .where(eq(students.profileId, profile.id));

    res.json({
      user: serializeAuthUser(profile),
      memberships,
      studentProfiles: studentRecords,
    });
  } catch (error) {
    console.error('Fetch /auth/me failed:', error);
    res.status(500).json({ error: 'Failed to load authenticated profile.' });
  }
});

authRouter.patch('/auth/profile', requireAuth, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      fullName: z.string().min(2).max(120).optional(),
      phone: z.string().max(30).optional().nullable(),
      avatarUrl: z.string().max(500000).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid profile update payload.' });
    }

    const [updated] = await db
      .update(profiles)
      .set({
        ...(parsed.data.fullName ? { fullName: parsed.data.fullName.trim() } : {}),
        ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
        ...(parsed.data.avatarUrl !== undefined ? { avatarUrl: parsed.data.avatarUrl } : {}),
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, req.profile!.id))
      .returning();

    res.json({
      user: serializeAuthUser(updated),
    });
  } catch (error) {
    console.error('Update profile failed:', error);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// Authenticated password change (enforces policy & clears mustChangePassword flag)
authRouter.post('/auth/change-password', requireAuth, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      currentPassword: z.string().optional(),
      newPassword: z.string().min(8),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'New password must be at least 8 characters.',
      });
    }

    const profile = req.profile!;
    const hasExistingPassword = Boolean(profile.passwordHash && profile.passwordSalt);

    if (hasExistingPassword) {
      if (!parsed.data.currentPassword) {
        return res.status(400).json({ error: 'Current password is required.' });
      }
      const matches = verifyPassword(
        parsed.data.currentPassword,
        profile.passwordSalt!,
        profile.passwordHash!
      );
      if (!matches) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }
      if (parsed.data.currentPassword === parsed.data.newPassword) {
        return res.status(400).json({
          error: 'New password must be different from your current temporary or existing password.',
        });
      }
    }

    const policy = await getPlatformPasswordPolicy();
    const policyResult = validatePasswordAgainstPolicy(parsed.data.newPassword, policy);
    if (!policyResult.valid) {
      return res.status(400).json({ error: policyResult.error });
    }

    const { salt, hash } = hashPassword(parsed.data.newPassword);
    const [updated] = await db
      .update(profiles)
      .set({
        passwordHash: hash,
        passwordSalt: salt,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, profile.id))
      .returning();

    await logAudit({
      actorProfile: updated,
      action: 'password_changed',
      entityType: 'profile',
      entityId: updated.id,
      details: { forcedFirstLoginChange: profile.mustChangePassword },
    });

    res.json({
      user: serializeAuthUser(updated),
      message: 'Password updated successfully.',
    });
  } catch (error) {
    console.error('Change password failed:', error);
    res.status(500).json({ error: 'Unable to update password.' });
  }
});

// Authenticated email change (allows Super Admin and authorized users to change login email anytime)
authRouter.post('/auth/change-email', requireAuth, async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      newEmail: z.string().email(),
      currentPassword: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Please provide a valid new email address.' });
    }

    const profile = req.profile!;
    const newEmail = parsed.data.newEmail.toLowerCase().trim();
    if (newEmail === profile.email.toLowerCase().trim()) {
      return res.status(400).json({ error: 'New email address is the same as your current email.' });
    }

    // Require current password verification when account has a local password
    if (profile.passwordHash && profile.passwordSalt) {
      if (!parsed.data.currentPassword) {
        return res.status(400).json({ error: 'Current password is required to change your login email.' });
      }
      const valid = verifyPassword(
        parsed.data.currentPassword,
        profile.passwordSalt,
        profile.passwordHash
      );
      if (!valid) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }
    }

    const existing = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, newEmail))
      .limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with this email address already exists.' });
    }

    const oldEmail = profile.email;
    const [updated] = await db.transaction(async (tx) => {
      const [u] = await tx
        .update(profiles)
        .set({ email: newEmail, updatedAt: new Date() })
        .where(eq(profiles.id, profile.id))
        .returning();

      await tx
        .update(students)
        .set({ email: newEmail, updatedAt: new Date() })
        .where(eq(students.profileId, profile.id));

      await tx
        .update(librarians)
        .set({ email: newEmail, updatedAt: new Date() })
        .where(eq(librarians.profileId, profile.id));

      return [u];
    });

    await logAudit({
      actorProfile: updated,
      action: 'login_email_changed',
      entityType: 'profile',
      entityId: updated.id,
      details: { previousEmail: oldEmail, newEmail },
    });

    const token = signSessionToken({
      profileId: updated.id,
      uid: updated.uid,
      email: updated.email,
    });

    res.json({
      token,
      user: serializeAuthUser(updated),
      message: `Login email updated to ${newEmail}.`,
    });
  } catch (error) {
    console.error('Change email failed:', error);
    res.status(500).json({ error: 'Unable to update email address.' });
  }
});

// Public organization directory for student registration form (strictly public metadata only)
authRouter.get('/public/organizations', async (_req, res) => {
  try {
    await ensureSystemBootstrapped();
    const orgs = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        code: organizations.code,
        universityName: organizations.universityName,
        logoUrl: organizations.logoUrl,
      })
      .from(organizations)
      .where(eq(organizations.status, 'active'))
      .orderBy(organizations.name);

    res.json({ organizations: orgs });
  } catch (error) {
    console.error('Public org list failed:', error);
    res.status(500).json({ error: 'Unable to load institutions.' });
  }
});

authRouter.get('/public/organizations/:orgId/academics', async (req, res) => {
  try {
    const { orgId } = req.params;
    const [orgRow] = await db
      .select({ id: organizations.id, name: organizations.name, status: organizations.status })
      .from(organizations)
      .where(and(eq(organizations.id, orgId), eq(organizations.status, 'active')))
      .limit(1);

    if (!orgRow) {
      return res.status(404).json({ error: 'Institution not found or inactive.' });
    }

    const [depts, crs, sems, sess, cats] = await Promise.all([
      db.select().from(departments).where(eq(departments.organizationId, orgId)),
      db.select().from(courses).where(eq(courses.organizationId, orgId)),
      db.select().from(semesters).where(eq(semesters.organizationId, orgId)),
      db.select().from(academicSessions).where(eq(academicSessions.organizationId, orgId)),
      db.select().from(studentCategories).where(eq(studentCategories.organizationId, orgId)),
    ]);

    res.json({
      organization: orgRow,
      departments: depts,
      courses: crs,
      semesters: sems,
      academicSessions: sess,
      studentCategories: cats,
    });
  } catch (error) {
    console.error('Public academics fetch failed:', error);
    res.status(500).json({ error: 'Unable to load academic structure.' });
  }
});

const publicRegistrationSchema = z.object({
  organizationId: z.string().uuid(),
  fullName: z.string().min(2),
  fatherName: z.string().min(2),
  collegeRollNumber: z.string().min(2),
  universityRollNumber: z.string().optional().nullable(),
  proposedStudentId: z.string().optional().nullable(),
  courseId: z.string().uuid().optional().nullable(),
  semesterId: z.string().uuid().optional().nullable(),
  departmentId: z.string().uuid().optional().nullable(),
  academicSessionId: z.string().uuid().optional().nullable(),
  studentCategoryId: z.string().uuid().optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  phone: z.string().min(7),
  email: z.string().email(),
  address: z.string().optional().nullable(),
  photoUrl: z.string().optional().nullable(),
  idProofUrl: z.string().optional().nullable(),
  password: z.string().min(8).optional(),
});

authRouter.post('/public/student-register', async (req, res) => {
  try {
    const parsed = publicRegistrationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration data.' });
    }

    const d = parsed.data;
    const normalizedEmail = d.email.toLowerCase().trim();
    const normalizedRoll = d.collegeRollNumber.trim();

    // Prevent duplicate active student or pending application in same college
    const existingStudent = await db
      .select({ id: students.id })
      .from(students)
      .where(
        and(
          eq(students.organizationId, d.organizationId),
          eq(students.collegeRollNumber, normalizedRoll)
        )
      )
      .limit(1);

    if (existingStudent.length > 0) {
      return res.status(409).json({
        error: 'A student with this College Roll Number is already registered at this institution.',
      });
    }

    const existingEmailStudent = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.organizationId, d.organizationId), eq(students.email, normalizedEmail)))
      .limit(1);

    if (existingEmailStudent.length > 0) {
      return res.status(409).json({
        error: 'A student with this email address is already registered at this institution.',
      });
    }

    const existingPending = await db
      .select({ id: studentApplications.id })
      .from(studentApplications)
      .where(
        and(
          eq(studentApplications.organizationId, d.organizationId),
          eq(studentApplications.collegeRollNumber, normalizedRoll),
          eq(studentApplications.status, 'pending')
        )
      )
      .limit(1);

    if (existingPending.length > 0) {
      return res.status(409).json({
        error: 'A pending registration application for this roll number already exists.',
      });
    }

    // Create or link profile so student can log in once approved
    let profileId: string | null = null;
    const existingProfile = await db
      .select()
      .from(profiles)
      .where(eq(profiles.email, normalizedEmail))
      .limit(1);

    if (existingProfile.length > 0) {
      profileId = existingProfile[0].id;
    } else if (d.password) {
      const { salt, hash } = hashPassword(d.password);
      const [createdProfile] = await db
        .insert(profiles)
        .values({
          uid: `local_${generateSecureToken(12)}`,
          email: normalizedEmail,
          fullName: d.fullName.trim(),
          phone: d.phone.trim(),
          avatarUrl: d.photoUrl || null,
          passwordHash: hash,
          passwordSalt: salt,
          status: 'active',
        })
        .returning();
      profileId = createdProfile.id;
    }

    const [application] = await db
      .insert(studentApplications)
      .values({
        organizationId: d.organizationId,
        submittedByProfileId: profileId,
        fullName: d.fullName.trim(),
        fatherName: d.fatherName.trim(),
        collegeRollNumber: normalizedRoll,
        universityRollNumber: d.universityRollNumber?.trim() || null,
        proposedStudentId: d.proposedStudentId?.trim() || null,
        courseId: d.courseId || null,
        semesterId: d.semesterId || null,
        departmentId: d.departmentId || null,
        academicSessionId: d.academicSessionId || null,
        studentCategoryId: d.studentCategoryId || null,
        dateOfBirth: d.dateOfBirth || null,
        gender: d.gender || null,
        phone: d.phone.trim(),
        email: normalizedEmail,
        address: d.address?.trim() || null,
        photoUrl: d.photoUrl || null,
        idProofUrl: d.idProofUrl || null,
        status: 'pending',
      })
      .returning();

    // Notify College Admins and Librarians in that org
    const staffMembers = await db
      .select({ profileId: organizationMembers.profileId, roleSlug: roles.slug })
      .from(organizationMembers)
      .innerJoin(roles, eq(organizationMembers.roleId, roles.id))
      .where(
        and(
          eq(organizationMembers.organizationId, d.organizationId),
          eq(organizationMembers.status, 'active')
        )
      );

    for (const staff of staffMembers) {
      if (staff.roleSlug === 'college_admin' || staff.roleSlug === 'librarian') {
        await createNotification({
          organizationId: d.organizationId,
          recipientProfileId: staff.profileId,
          type: 'new_student_application',
          title: 'New Student Registration',
          message: `${d.fullName} (Roll: ${normalizedRoll}) submitted a library registration application.`,
          entityType: 'student_application',
          entityId: application.id,
        });
      }
    }

    if (profileId) {
      await createNotification({
        organizationId: d.organizationId,
        recipientProfileId: profileId,
        type: 'registration_submitted',
        title: 'Registration Submitted',
        message: 'Your library membership application is pending review by your college administration.',
        entityType: 'student_application',
        entityId: application.id,
      });
    }

    res.status(201).json({
      application,
      message: 'Registration submitted successfully. You will be notified once approved.',
    });
  } catch (error) {
    console.error('Public student registration failed:', error);
    res.status(500).json({ error: 'Unable to submit registration.' });
  }
});

// PUBLIC QR VERIFICATION ENDPOINT — Never exposes sensitive personal info (phone, address, email, DOB)
authRouter.get('/verify/qr/:token', async (req, res) => {
  try {
    const token = req.params.token?.trim();
    if (!token || token.length < 12) {
      return res.status(404).json({ verified: false, reason: 'Invalid verification token format.' });
    }

    const tokenRows = await db.select().from(qrTokens).where(eq(qrTokens.token, token)).limit(1);
    if (tokenRows.length === 0) {
      return res.status(404).json({ verified: false, reason: 'Credential not found in QIVORA registry.' });
    }

    const qr = tokenRows[0];

    if (!qr.isActive || qr.revokedAt) {
      return res.json({
        verified: false,
        status: 'revoked',
        entityType: qr.entityType,
        reason: qr.revokedReason || 'This digital credential has been revoked and is no longer valid.',
        revokedAt: qr.revokedAt,
      });
    }

    if (qr.expiresAt && new Date(qr.expiresAt) < new Date()) {
      return res.json({
        verified: false,
        status: 'expired',
        entityType: qr.entityType,
        reason: 'This digital credential has expired.',
        expiresAt: qr.expiresAt,
      });
    }

    if (qr.entityType === 'founder_id') {
      const founderRows = await db
        .select()
        .from(founderIdentities)
        .where(eq(founderIdentities.id, qr.entityId))
        .limit(1);

      const founder = founderRows[0];
      if (!founder || founder.status !== 'active') {
        return res.json({
          verified: false,
          status: founder?.status || 'revoked',
          entityType: 'founder_id',
          reason: founder?.statusReason || 'Founder credential is not active.',
        });
      }

      // Check for approved linked college student membership (strictly approved public identity fields ONLY)
      let linkedCollege: Record<string, string | boolean | null> | null = null;
      if (
        founder.linkedStudentId &&
        founder.linkedOrganizationId &&
        founder.collegeLinkStatus === 'approved'
      ) {
        const [studentRow, orgRow, brandingRow] = await Promise.all([
          db
            .select()
            .from(students)
            .where(
              and(
                eq(students.id, founder.linkedStudentId),
                eq(students.organizationId, founder.linkedOrganizationId)
              )
            )
            .limit(1),
          db
            .select({ name: organizations.name, code: organizations.code, status: organizations.status })
            .from(organizations)
            .where(eq(organizations.id, founder.linkedOrganizationId))
            .limit(1),
          db
            .select({
              collegeName: organizationBranding.collegeName,
              collegeLogoUrl: organizationBranding.collegeLogoUrl,
              universityName: organizationBranding.universityName,
            })
            .from(organizationBranding)
            .where(eq(organizationBranding.organizationId, founder.linkedOrganizationId))
            .limit(1),
        ]);

        const st = studentRow[0];
        if (st && orgRow[0]?.status === 'active') {
          const [cRow, sRow, acRow] = await Promise.all([
            st.courseId ? db.select({ name: courses.name }).from(courses).where(eq(courses.id, st.courseId)).limit(1) : Promise.resolve([]),
            st.semesterId ? db.select({ name: semesters.name }).from(semesters).where(eq(semesters.id, st.semesterId)).limit(1) : Promise.resolve([]),
            st.academicSessionId ? db.select({ name: academicSessions.name }).from(academicSessions).where(eq(academicSessions.id, st.academicSessionId)).limit(1) : Promise.resolve([]),
          ]);

          linkedCollege = {
            collegeName: brandingRow[0]?.collegeName || orgRow[0]?.name || 'Registered College',
            collegeLogoUrl: brandingRow[0]?.collegeLogoUrl || null,
            universityName: brandingRow[0]?.universityName || null,
            studentIdCode: st.studentIdCode,
            collegeRollNumber: st.collegeRollNumber,
            courseName: cRow[0]?.name || null,
            semesterName: sRow[0]?.name || null,
            academicSession: acRow[0]?.name || null,
            membershipStatus: st.status,
            collegeVerified: st.status === 'active',
          };
        }
      }

      return res.json({
        verified: true,
        entityType: 'founder_id',
        status: 'active',
        credential: {
          editionName: founder.editionName.replace(/SHARIXA/gi, 'QIVORA'),
          founderNumber: founder.founderNumber,
          fullName: founder.fullName,
          designation: founder.designation,
          organizationLabel: founder.organizationLabel.replace(/SHARIXA/gi, 'QIVORA'),
          photoUrl: founder.photoUrl,
          issuedAt: founder.issuedAt,
          verifiedCreatorBadge: true,
          collegeLinkStatus: founder.collegeLinkStatus,
          note: 'Verified QIVORA Creator Credential. College borrowing rules, limits, and fines remain strictly governed by the institution.',
        },
        linkedCollege,
      });
    }

    // Student Digital ID Verification
    const cardRows = await db.select().from(idCards).where(eq(idCards.id, qr.entityId)).limit(1);
    const card = cardRows[0];
    if (!card) {
      return res.status(404).json({ verified: false, reason: 'Associated ID card record not found.' });
    }

    const isCardActive = card.status === 'active' && new Date(card.expiresAt) >= new Date();
    const [studentRows, brandingRows, orgRows, tplRows] = await Promise.all([
      db.select().from(students).where(eq(students.id, card.studentId)).limit(1),
      db.select().from(organizationBranding).where(eq(organizationBranding.organizationId, card.organizationId)).limit(1),
      db.select().from(organizations).where(eq(organizations.id, card.organizationId)).limit(1),
      db.select({ name: idTemplates.name }).from(idTemplates).where(eq(idTemplates.id, card.templateId)).limit(1),
    ]);

    const student = studentRows[0];
    const branding = brandingRows[0];
    const org = orgRows[0];

    let courseName: string | null = null;
    let semesterName: string | null = null;
    let sessionName: string | null = null;
    if (student?.courseId) {
      const [c] = await db.select({ name: courses.name }).from(courses).where(eq(courses.id, student.courseId)).limit(1);
      courseName = c?.name || null;
    }
    if (student?.semesterId) {
      const [s] = await db.select({ name: semesters.name }).from(semesters).where(eq(semesters.id, student.semesterId)).limit(1);
      semesterName = s?.name || null;
    }
    if (student?.academicSessionId) {
      const [ac] = await db.select({ name: academicSessions.name }).from(academicSessions).where(eq(academicSessions.id, student.academicSessionId)).limit(1);
      sessionName = ac?.name || null;
    }

    if (!isCardActive || student?.status !== 'active') {
      return res.json({
        verified: false,
        entityType: 'student_id',
        status: student?.status !== 'active' ? student?.status : card.status,
        reason:
          card.statusReason ||
          (student?.status !== 'active'
            ? `Student account status is ${student?.status}.`
            : `ID card status is ${card.status}.`),
        credential: {
          cardNumber: card.cardNumber,
          collegeName: branding?.collegeName || org?.name,
        },
      });
    }

    // Check if this student holds an active, approved linked Founder Identity
    const [linkedFounder] = await db
      .select({
        founderNumber: founderIdentities.founderNumber,
        designation: founderIdentities.designation,
        editionName: founderIdentities.editionName,
        organizationLabel: founderIdentities.organizationLabel,
      })
      .from(founderIdentities)
      .where(
        and(
          eq(founderIdentities.linkedStudentId, student.id),
          eq(founderIdentities.linkedOrganizationId, card.organizationId),
          eq(founderIdentities.status, 'active'),
          eq(founderIdentities.collegeLinkStatus, 'approved')
        )
      )
      .limit(1);

    // Return ONLY approved public verification information (zero private phone/address/email/DOB/fines)
    return res.json({
      verified: true,
      entityType: 'student_id',
      status: 'active',
      credential: {
        cardNumber: card.cardNumber,
        studentName: student.fullName,
        studentIdCode: student.studentIdCode,
        collegeRollNumber: student.collegeRollNumber,
        photoUrl: student.photoUrl,
        courseName,
        semesterName,
        sessionName,
        collegeName: branding?.collegeName || org?.name,
        collegeLogoUrl: branding?.collegeLogoUrl || org?.logoUrl,
        universityName: branding?.universityName || org?.universityName,
        templateName: tplRows[0]?.name || null,
        issuedAt: card.issuedAt,
        expiresAt: card.expiresAt,
      },
      founderBadge: linkedFounder
        ? {
            founderNumber: linkedFounder.founderNumber,
            designation: linkedFounder.designation,
            editionName: linkedFounder.editionName.replace(/SHARIXA/gi, 'QIVORA'),
            organizationLabel: linkedFounder.organizationLabel.replace(/SHARIXA/gi, 'QIVORA'),
            verifiedCreator: true,
          }
        : null,
      premiumStudent: student.isPremium
        ? {
            isPremium: true,
            premiumTier: student.premiumTier || 'obsidian_platinum',
            premiumDesign: student.premiumDesign || student.premiumTier || 'obsidian_platinum',
            premiumBadgeLabel:
              student.premiumBadgeLabel ||
              getPremiumStudentDesign(student.premiumDesign || student.premiumTier).badgeLabel,
            premiumGrantedAt: student.premiumGrantedAt,
          }
        : null,
    });
  } catch (error) {
    console.error('QR verification failed:', error);
    res.status(500).json({ verified: false, reason: 'Verification service encountered an error.' });
  }
});

// Check recent active notifications count
authRouter.get('/auth/notifications/summary', requireAuth, async (req: AuthRequest, res) => {
  try {
    const items = await db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientProfileId, req.profile!.id))
      .orderBy(desc(notifications.createdAt))
      .limit(20);
    const unreadCount = items.filter((n) => !n.isRead).length;
    res.json({ unreadCount, items });
  } catch (error) {
    console.error('Notification summary failed:', error);
    res.status(500).json({ error: 'Unable to load notifications.' });
  }
});
