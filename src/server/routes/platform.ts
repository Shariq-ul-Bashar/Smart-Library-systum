import { Router } from 'express';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  academicSessions,
  auditLogs,
  courses,
  founderIdentities,
  idCards,
  idTemplates,
  librarians,
  organizationBranding,
  organizationMembers,
  organizations,
  platformSettings,
  profiles,
  qrTokens,
  roles,
  semesters,
  students,
} from '../../db/schema.ts';
import {
  type AuthRequest,
  createNotification,
  generateSecureToken,
  hashPassword,
  logAudit,
  requireAuth,
  requireSuperAdmin,
} from '../auth.ts';
import { provisionOrganizationDefaults } from '../bootstrap.ts';
import {
  generatePolicyCompliantPassword,
  getPlatformPasswordPolicy,
} from '../password-policy.ts';
import {
  getPremiumStudentDesign,
  normalizePasswordPolicy,
  PREMIUM_STUDENT_DESIGNS,
  validatePasswordAgainstPolicy,
} from '../../shared/security-and-tiers.ts';
import { getServerSupabaseStatus } from '../supabase-admin.ts';

export const platformRouter = Router();

platformRouter.use(requireAuth, requireSuperAdmin);

platformRouter.get('/overview', async (_req, res) => {
  try {
    const start = Date.now();
    const [orgList, adminMembers, founderRows, recentAudits] = await Promise.all([
      db.select().from(organizations).orderBy(desc(organizations.createdAt)),
      db
        .select({
          id: organizationMembers.id,
          status: organizationMembers.status,
        })
        .from(organizationMembers)
        .innerJoin(roles, eq(organizationMembers.roleId, roles.id))
        .where(eq(roles.slug, 'college_admin')),
      db.select({ id: founderIdentities.id, status: founderIdentities.status }).from(founderIdentities),
      db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(15),
    ]);
    const dbLatencyMs = Date.now() - start;

    const totalOrganizations = orgList.length;
    const activeOrganizations = orgList.filter((o) => o.status === 'active').length;
    const suspendedOrganizations = orgList.filter((o) => o.status === 'suspended').length;
    const pendingOrganizations = orgList.filter((o) => o.status === 'pending').length;

    res.json({
      metrics: {
        totalOrganizations,
        activeOrganizations,
        suspendedOrganizations,
        pendingOrganizations,
        totalCollegeAdmins: adminMembers.length,
        activeFounderIds: founderRows.filter((f) => f.status === 'active').length,
        dbLatencyMs,
      },
      recentOrganizations: orgList.slice(0, 8),
      recentActivity: recentAudits,
    });
  } catch (error) {
    console.error('Platform overview failed:', error);
    res.status(500).json({ error: 'Unable to load platform overview.' });
  }
});

platformRouter.get('/organizations', async (_req, res) => {
  try {
    const orgs = await db.select().from(organizations).orderBy(desc(organizations.createdAt));
    const adminCounts = await db
      .select({
        organizationId: organizationMembers.organizationId,
        total: count(),
      })
      .from(organizationMembers)
      .innerJoin(roles, eq(organizationMembers.roleId, roles.id))
      .where(eq(roles.slug, 'college_admin'))
      .groupBy(organizationMembers.organizationId);

    const countMap = new Map(adminCounts.map((c) => [c.organizationId, Number(c.total)]));
    res.json({
      organizations: orgs.map((o) => ({
        ...o,
        adminCount: countMap.get(o.id) || 0,
      })),
    });
  } catch (error) {
    console.error('Fetch organizations failed:', error);
    res.status(500).json({ error: 'Failed to load organizations.' });
  }
});

const createOrgSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2).max(24),
  logoUrl: z.string().optional().nullable(),
  universityName: z.string().optional().nullable(),
  universityLogoUrl: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  contactNumber: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  website: z.string().optional().nullable(),
  academicSession: z.string().optional().nullable(),
  status: z.enum(['active', 'pending', 'suspended', 'inactive']).default('active'),
  assignSelfAsAdmin: z.boolean().optional().default(false),
  initialAdmin: z
    .object({
      fullName: z.string().min(2),
      email: z.string().email(),
      phone: z.string().optional().nullable(),
      password: z.string().min(8),
    })
    .optional(),
});

platformRouter.post('/organizations', async (req: AuthRequest, res) => {
  try {
    const parsed = createOrgSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid organization payload.' });
    }

    const d = parsed.data;
    const normalizedCode = d.code.trim().toUpperCase();

    const dup = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.code, normalizedCode))
      .limit(1);

    if (dup.length > 0) {
      return res.status(409).json({ error: `Organization code "${normalizedCode}" is already registered.` });
    }

    const [createdOrg] = await db
      .insert(organizations)
      .values({
        name: d.name.trim(),
        code: normalizedCode,
        logoUrl: d.logoUrl || null,
        universityName: d.universityName?.trim() || null,
        universityLogoUrl: d.universityLogoUrl || null,
        address: d.address?.trim() || null,
        contactNumber: d.contactNumber?.trim() || null,
        email: d.email?.trim() || null,
        website: d.website?.trim() || null,
        academicSession: d.academicSession?.trim() || '2026-2027',
        status: d.status,
      })
      .returning();

    await provisionOrganizationDefaults({
      organizationId: createdOrg.id,
      name: createdOrg.name,
      universityName: createdOrg.universityName,
      logoUrl: createdOrg.logoUrl,
      universityLogoUrl: createdOrg.universityLogoUrl,
      address: createdOrg.address,
      contactNumber: createdOrg.contactNumber,
      email: createdOrg.email,
      website: createdOrg.website,
      academicSession: createdOrg.academicSession,
      actorProfileId: req.profile!.id,
    });

    const [collegeAdminRole] = await db
      .select()
      .from(roles)
      .where(eq(roles.slug, 'college_admin'))
      .limit(1);

    let assignedAdminEmail: string | null = null;

    if (d.initialAdmin && collegeAdminRole) {
      const adminEmail = d.initialAdmin.email.toLowerCase().trim();
      let adminProfile = (
        await db.select().from(profiles).where(eq(profiles.email, adminEmail)).limit(1)
      )[0];

      if (!adminProfile) {
        const { salt, hash } = hashPassword(d.initialAdmin.password);
        [adminProfile] = await db
          .insert(profiles)
          .values({
            uid: `local_${generateSecureToken(12)}`,
            email: adminEmail,
            fullName: d.initialAdmin.fullName.trim(),
            phone: d.initialAdmin.phone?.trim() || null,
            passwordHash: hash,
            passwordSalt: salt,
            status: 'active',
          })
          .returning();
      }

      await db
        .insert(organizationMembers)
        .values({
          organizationId: createdOrg.id,
          profileId: adminProfile.id,
          roleId: collegeAdminRole.id,
          status: 'active',
          isDefault: true,
        })
        .onConflictDoNothing();

      assignedAdminEmail = adminEmail;
    }

    if (d.assignSelfAsAdmin && collegeAdminRole) {
      await db
        .insert(organizationMembers)
        .values({
          organizationId: createdOrg.id,
          profileId: req.profile!.id,
          roleId: collegeAdminRole.id,
          status: 'active',
          isDefault: false,
        })
        .onConflictDoNothing();
    }

    await logAudit({
      organizationId: createdOrg.id,
      actorProfile: req.profile,
      actorRole: 'platform_super_admin',
      action: 'organization_created',
      entityType: 'organization',
      entityId: createdOrg.id,
      details: {
        name: createdOrg.name,
        code: createdOrg.code,
        assignedAdminEmail,
      },
    });

    res.status(201).json({ organization: createdOrg, assignedAdminEmail });
  } catch (error) {
    console.error('Create organization failed:', error);
    res.status(500).json({ error: 'Unable to create organization.' });
  }
});

platformRouter.patch('/organizations/:id/status', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      status: z.enum(['active', 'pending', 'suspended', 'inactive']),
      reason: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid status value.' });
    }

    const [updated] = await db
      .update(organizations)
      .set({
        status: parsed.data.status,
        archivedAt: parsed.data.status === 'inactive' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, req.params.id))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: 'Organization not found.' });
    }

    await logAudit({
      organizationId: updated.id,
      actorProfile: req.profile,
      actorRole: 'platform_super_admin',
      action: 'organization_status_changed',
      entityType: 'organization',
      entityId: updated.id,
      details: { status: parsed.data.status, reason: parsed.data.reason || null },
    });

    res.json({ organization: updated });
  } catch (error) {
    console.error('Update org status failed:', error);
    res.status(500).json({ error: 'Failed to update organization status.' });
  }
});

platformRouter.get('/college-admins', async (_req, res) => {
  try {
    const rows = await db
      .select({
        membershipId: organizationMembers.id,
        status: organizationMembers.status,
        createdAt: organizationMembers.createdAt,
        organizationId: organizations.id,
        organizationName: organizations.name,
        organizationCode: organizations.code,
        profileId: profiles.id,
        fullName: profiles.fullName,
        email: profiles.email,
        phone: profiles.phone,
        profileStatus: profiles.status,
        lastLoginAt: profiles.lastLoginAt,
      })
      .from(organizationMembers)
      .innerJoin(roles, eq(organizationMembers.roleId, roles.id))
      .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
      .innerJoin(profiles, eq(organizationMembers.profileId, profiles.id))
      .where(eq(roles.slug, 'college_admin'))
      .orderBy(desc(organizationMembers.createdAt));

    res.json({ collegeAdmins: rows });
  } catch (error) {
    console.error('List college admins failed:', error);
    res.status(500).json({ error: 'Failed to load College Admin accounts.' });
  }
});

const createAdminSchema = z.object({
  organizationId: z.string().uuid(),
  fullName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  password: z.string().min(8).optional(),
});

platformRouter.post('/college-admins', async (req: AuthRequest, res) => {
  try {
    const parsed = createAdminSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid admin input.' });
    }
    const d = parsed.data;
    const email = d.email.toLowerCase().trim();

    const [roleRow] = await db.select().from(roles).where(eq(roles.slug, 'college_admin')).limit(1);
    if (!roleRow) {
      return res.status(500).json({ error: 'College Admin role missing.' });
    }

    let profile = (await db.select().from(profiles).where(eq(profiles.email, email)).limit(1))[0];
    if (!profile) {
      if (!d.password) {
        return res.status(400).json({ error: 'Password (min 8 characters) is required for a new account.' });
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

    const [membership] = await db
      .insert(organizationMembers)
      .values({
        organizationId: d.organizationId,
        profileId: profile.id,
        roleId: roleRow.id,
        status: 'active',
        isDefault: true,
      })
      .onConflictDoUpdate({
        target: [organizationMembers.organizationId, organizationMembers.profileId, organizationMembers.roleId],
        set: { status: 'active', updatedAt: new Date() },
      })
      .returning();

    await logAudit({
      organizationId: d.organizationId,
      actorProfile: req.profile,
      actorRole: 'platform_super_admin',
      action: 'college_admin_assigned',
      entityType: 'organization_member',
      entityId: membership.id,
      details: { email, fullName: d.fullName },
    });

    res.status(201).json({ membership, email });
  } catch (error) {
    console.error('Create college admin failed:', error);
    res.status(500).json({ error: 'Unable to assign College Admin.' });
  }
});

platformRouter.patch('/college-admins/:membershipId/status', async (req: AuthRequest, res) => {
  try {
    const status = req.body?.status === 'suspended' ? 'suspended' : 'active';
    const [updated] = await db
      .update(organizationMembers)
      .set({ status, updatedAt: new Date() })
      .where(eq(organizationMembers.id, req.params.membershipId))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: 'Membership not found.' });
    }

    await logAudit({
      organizationId: updated.organizationId,
      actorProfile: req.profile,
      actorRole: 'platform_super_admin',
      action: 'college_admin_status_changed',
      entityType: 'organization_member',
      entityId: updated.id,
      details: { status },
    });

    res.json({ membership: updated });
  } catch (error) {
    console.error('Update college admin status failed:', error);
    res.status(500).json({ error: 'Unable to update admin status.' });
  }
});

// ============================================================================
// GOLDEN PREMIUM FOUNDER ID MANAGEMENT (Platform Super Admin ONLY)
// Supports linked college student membership while preserving strict college
// governance (College Admin approves college membership; Founder never bypasses rules).
// ============================================================================

async function hydrateFounderLinkedCollege(founder: typeof founderIdentities.$inferSelect) {
  if (!founder.linkedStudentId || !founder.linkedOrganizationId) {
    return null;
  }
  const [stRow, orgRow, brandRow] = await Promise.all([
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
      .select({ id: organizations.id, name: organizations.name, code: organizations.code })
      .from(organizations)
      .where(eq(organizations.id, founder.linkedOrganizationId))
      .limit(1),
    db
      .select({ collegeName: organizationBranding.collegeName })
      .from(organizationBranding)
      .where(eq(organizationBranding.organizationId, founder.linkedOrganizationId))
      .limit(1),
  ]);

  const st = stRow[0];
  if (!st) return null;

  const [cRow, sRow, acRow] = await Promise.all([
    st.courseId ? db.select({ name: courses.name }).from(courses).where(eq(courses.id, st.courseId)).limit(1) : Promise.resolve([]),
    st.semesterId ? db.select({ name: semesters.name }).from(semesters).where(eq(semesters.id, st.semesterId)).limit(1) : Promise.resolve([]),
    st.academicSessionId ? db.select({ name: academicSessions.name }).from(academicSessions).where(eq(academicSessions.id, st.academicSessionId)).limit(1) : Promise.resolve([]),
  ]);

  return {
    studentId: st.id,
    organizationId: st.organizationId,
    collegeName: brandRow[0]?.collegeName || orgRow[0]?.name || 'Registered College',
    collegeCode: orgRow[0]?.code || null,
    studentIdCode: st.studentIdCode,
    collegeRollNumber: st.collegeRollNumber,
    courseName: cRow[0]?.name || null,
    semesterName: sRow[0]?.name || null,
    academicSession: acRow[0]?.name || null,
    photoUrl: st.photoUrl,
    membershipStatus: st.status,
    collegeLinkStatus: founder.collegeLinkStatus,
    collegeApprovedAt: founder.collegeApprovedAt,
  };
}

platformRouter.get('/organizations/:orgId/students-lookup', async (req, res) => {
  try {
    const rows = await db
      .select({
        id: students.id,
        fullName: students.fullName,
        studentIdCode: students.studentIdCode,
        collegeRollNumber: students.collegeRollNumber,
        email: students.email,
        status: students.status,
        courseName: courses.name,
        semesterName: semesters.name,
      })
      .from(students)
      .leftJoin(courses, eq(students.courseId, courses.id))
      .leftJoin(semesters, eq(students.semesterId, semesters.id))
      .where(eq(students.organizationId, req.params.orgId))
      .orderBy(desc(students.createdAt))
      .limit(200);

    res.json({ students: rows });
  } catch (error) {
    console.error('Platform student lookup failed:', error);
    res.status(500).json({ error: 'Unable to load organization students.' });
  }
});

platformRouter.get('/founder-ids', async (_req, res) => {
  try {
    const rows = await db
      .select({
        founder: founderIdentities,
        qrToken: qrTokens.token,
        qrIsActive: qrTokens.isActive,
      })
      .from(founderIdentities)
      .leftJoin(qrTokens, eq(founderIdentities.qrTokenId, qrTokens.id))
      .orderBy(desc(founderIdentities.createdAt));

    const enriched = await Promise.all(
      rows.map(async (r) => ({
        ...r.founder,
        organizationLabel: r.founder.organizationLabel.replace(/SHARIXA/gi, 'QIVORA'),
        editionName: r.founder.editionName.replace(/SHARIXA/gi, 'QIVORA'),
        qrToken: r.qrToken,
        qrIsActive: r.qrIsActive,
        linkedCollege: await hydrateFounderLinkedCollege(r.founder),
      }))
    );

    res.json({ founderIds: enriched });
  } catch (error) {
    console.error('List founder IDs failed:', error);
    res.status(500).json({ error: 'Failed to load Founder IDs.' });
  }
});

const createFounderSchema = z.object({
  fullName: z.string().min(2),
  designation: z.string().min(2).default('Founder & Chief Architect'),
  organizationLabel: z.string().min(2).default('QIVORA Technologies'),
  photoUrl: z.string().optional().nullable(),
  bio: z.string().optional().nullable(),
  profileEmail: z.string().email().optional().or(z.literal('')),
  linkedOrganizationId: z.string().uuid().optional().nullable().or(z.literal('')),
  linkedStudentId: z.string().uuid().optional().nullable().or(z.literal('')),
});

platformRouter.post('/founder-ids', async (req: AuthRequest, res) => {
  try {
    const parsed = createFounderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid founder identity input.' });
    }
    const d = parsed.data;

    let linkedProfileId: string | null = null;
    if (d.profileEmail) {
      const [p] = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.email, d.profileEmail.toLowerCase().trim()))
        .limit(1);
      linkedProfileId = p?.id || null;
    }

    let linkedOrgId: string | null = d.linkedOrganizationId || null;
    let linkedStudentId: string | null = d.linkedStudentId || null;
    let collegeLinkStatus: 'unlinked' | 'pending_college_approval' | 'approved' = 'unlinked';
    let collegeApprovedByProfileId: string | null = null;
    let collegeApprovedAt: Date | null = null;

    if (linkedOrgId && linkedStudentId) {
      const [studentMatch] = await db
        .select()
        .from(students)
        .where(and(eq(students.id, linkedStudentId), eq(students.organizationId, linkedOrgId)))
        .limit(1);
      if (!studentMatch) {
        return res.status(400).json({
          error: 'Selected student does not belong to the chosen institution.',
        });
      }
      if (!linkedProfileId && studentMatch.profileId) {
        linkedProfileId = studentMatch.profileId;
      }

      // Exclusive Super Admin authority: Founder allocation is immediately approved & active
      collegeLinkStatus = 'approved';
      collegeApprovedByProfileId = req.profile!.id;
      collegeApprovedAt = new Date();
    } else {
      linkedOrgId = null;
      linkedStudentId = null;
    }

    const founderNumber = `QIV-FND-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const randomToken = generateSecureToken(28);

    const result = await db.transaction(async (tx) => {
      const [founder] = await tx
        .insert(founderIdentities)
        .values({
          profileId: linkedProfileId,
          linkedOrganizationId: linkedOrgId,
          linkedStudentId,
          collegeLinkStatus,
          collegeApprovedByProfileId,
          collegeApprovedAt,
          founderNumber,
          fullName: d.fullName.trim(),
          designation: d.designation.trim(),
          organizationLabel: d.organizationLabel.trim(),
          photoUrl: d.photoUrl || null,
          editionName: 'QIVORA — GOLDEN FOUNDER EDITION',
          bio: d.bio?.trim() || null,
          status: 'active',
          issuedByProfileId: req.profile!.id,
        })
        .returning();

      const [qr] = await tx
        .insert(qrTokens)
        .values({
          organizationId: null,
          entityType: 'founder_id',
          entityId: founder.id,
          token: randomToken,
          isActive: true,
        })
        .returning();

      const [updatedFounder] = await tx
        .update(founderIdentities)
        .set({ qrTokenId: qr.id })
        .where(eq(founderIdentities.id, founder.id))
        .returning();

      return { founder: updatedFounder, qrToken: qr.token };
    });

    // Super Admin Founder links are immediately active and require no College Admin approval.

    await logAudit({
      organizationId: linkedOrgId,
      actorProfile: req.profile,
      actorRole: 'platform_super_admin',
      action: 'founder_id_issued',
      entityType: 'founder_identity',
      entityId: result.founder.id,
      details: {
        founderNumber: result.founder.founderNumber,
        fullName: result.founder.fullName,
        linkedOrganizationId: linkedOrgId,
        linkedStudentId,
        collegeLinkStatus,
      },
    });

    const linkedCollege = await hydrateFounderLinkedCollege(result.founder);
    res.status(201).json({
      founderId: {
        ...result.founder,
        qrToken: result.qrToken,
        qrIsActive: true,
        linkedCollege,
      },
    });
  } catch (error) {
    console.error('Issue founder ID failed:', error);
    res.status(500).json({ error: 'Unable to issue Founder ID.' });
  }
});

platformRouter.patch('/founder-ids/:id/link-student', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      linkedOrganizationId: z.string().uuid().nullable(),
      linkedStudentId: z.string().uuid().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid organization or student link payload.' });
    }

    const [existing] = await db
      .select()
      .from(founderIdentities)
      .where(eq(founderIdentities.id, req.params.id))
      .limit(1);
    if (!existing) return res.status(404).json({ error: 'Founder identity not found.' });

    const { linkedOrganizationId, linkedStudentId } = parsed.data;

    if (!linkedOrganizationId || !linkedStudentId) {
      const [unlinked] = await db
        .update(founderIdentities)
        .set({
          linkedOrganizationId: null,
          linkedStudentId: null,
          collegeLinkStatus: 'unlinked',
          collegeApprovedByProfileId: null,
          collegeApprovedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(founderIdentities.id, existing.id))
        .returning();

      await logAudit({
        organizationId: existing.linkedOrganizationId,
        actorProfile: req.profile,
        actorRole: 'platform_super_admin',
        action: 'founder_college_unlinked',
        entityType: 'founder_identity',
        entityId: existing.id,
        details: { founderNumber: existing.founderNumber },
      });

      return res.json({
        founderId: { ...unlinked, linkedCollege: null },
        message: 'College student link removed from Founder ID.',
      });
    }

    const [studentMatch] = await db
      .select()
      .from(students)
      .where(and(eq(students.id, linkedStudentId), eq(students.organizationId, linkedOrganizationId)))
      .limit(1);
    if (!studentMatch) {
      return res.status(404).json({ error: 'Student record not found in the selected college.' });
    }

    // Exclusive Super Admin authority: Founder allocation is immediately approved & active
    const nextStatus = 'approved';

    const [updated] = await db
      .update(founderIdentities)
      .set({
        profileId: existing.profileId || studentMatch.profileId || null,
        linkedOrganizationId,
        linkedStudentId,
        collegeLinkStatus: nextStatus,
        collegeApprovedByProfileId: req.profile!.id,
        collegeApprovedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(founderIdentities.id, existing.id))
      .returning();

    if (studentMatch.profileId) {
      await createNotification({
        organizationId: linkedOrganizationId,
        recipientProfileId: studentMatch.profileId,
        type: 'founder_status_granted',
        title: 'QIVORA Golden Founder ID Activated',
        message: `Platform Super Admin assigned you Golden Founder status (${existing.founderNumber}). Your Golden Premium Founder Digital ID is now active.`,
        entityType: 'founder_identity',
        entityId: existing.id,
      });
    }

    await logAudit({
      organizationId: linkedOrganizationId,
      actorProfile: req.profile,
      actorRole: 'platform_super_admin',
      action: 'founder_college_linked',
      entityType: 'founder_identity',
      entityId: existing.id,
      details: {
        founderNumber: existing.founderNumber,
        linkedStudentId,
        studentIdCode: studentMatch.studentIdCode,
        collegeLinkStatus: nextStatus,
      },
    });

    const [qrRow] = updated.qrTokenId
      ? await db.select().from(qrTokens).where(eq(qrTokens.id, updated.qrTokenId)).limit(1)
      : [];

    const linkedCollege = await hydrateFounderLinkedCollege(updated);
    res.json({
      founderId: {
        ...updated,
        qrToken: qrRow?.token || null,
        qrIsActive: qrRow?.isActive ?? null,
        linkedCollege,
      },
      message:
        nextStatus === 'approved'
          ? 'Founder ID linked and approved for college library operations.'
          : 'Founder ID linked to college student. Pending College Admin approval.',
    });
  } catch (error) {
    console.error('Link founder to student failed:', error);
    res.status(500).json({ error: 'Unable to update Founder ID college link.' });
  }
});

platformRouter.post('/founder-ids/:id/regenerate', async (req: AuthRequest, res) => {
  try {
    const [existing] = await db
      .select()
      .from(founderIdentities)
      .where(eq(founderIdentities.id, req.params.id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: 'Founder identity not found.' });
    }

    const newToken = generateSecureToken(28);
    const result = await db.transaction(async (tx) => {
      if (existing.qrTokenId) {
        await tx
          .update(qrTokens)
          .set({ isActive: false, revokedAt: new Date(), revokedReason: 'Regenerated by Platform Super Admin' })
          .where(eq(qrTokens.id, existing.qrTokenId));
      }

      const [qr] = await tx
        .insert(qrTokens)
        .values({
          organizationId: null,
          entityType: 'founder_id',
          entityId: existing.id,
          token: newToken,
          isActive: true,
        })
        .returning();

      const [updated] = await tx
        .update(founderIdentities)
        .set({
          qrTokenId: qr.id,
          status: 'active',
          statusReason: 'Regenerated credential token',
          revokedAt: null,
          issuedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(founderIdentities.id, existing.id))
        .returning();

      return { founder: updated, qrToken: qr.token };
    });

    await logAudit({
      actorProfile: req.profile,
      actorRole: 'platform_super_admin',
      action: 'founder_id_regenerated',
      entityType: 'founder_identity',
      entityId: existing.id,
      details: { founderNumber: existing.founderNumber },
    });

    res.json({ founderId: { ...result.founder, qrToken: result.qrToken, qrIsActive: true } });
  } catch (error) {
    console.error('Regenerate founder ID failed:', error);
    res.status(500).json({ error: 'Unable to regenerate Founder ID.' });
  }
});

platformRouter.post('/founder-ids/:id/revoke', async (req: AuthRequest, res) => {
  try {
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : 'Revoked by Platform Super Admin';

    const [existing] = await db
      .select()
      .from(founderIdentities)
      .where(eq(founderIdentities.id, req.params.id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: 'Founder identity not found.' });
    }

    await db.transaction(async (tx) => {
      if (existing.qrTokenId) {
        await tx
          .update(qrTokens)
          .set({ isActive: false, revokedAt: new Date(), revokedReason: reason })
          .where(eq(qrTokens.id, existing.qrTokenId));
      }
      await tx
        .update(founderIdentities)
        .set({ status: 'revoked', statusReason: reason, revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(founderIdentities.id, existing.id));
    });

    await logAudit({
      actorProfile: req.profile,
      actorRole: 'platform_super_admin',
      action: 'founder_id_revoked',
      entityType: 'founder_identity',
      entityId: existing.id,
      details: { founderNumber: existing.founderNumber, reason },
    });

    res.json({ message: 'Founder ID revoked successfully.' });
  } catch (error) {
    console.error('Revoke founder ID failed:', error);
    res.status(500).json({ error: 'Unable to revoke Founder ID.' });
  }
});

platformRouter.get('/settings', async (_req, res) => {
  try {
    const settings = await db.select().from(platformSettings);
    res.json({ settings });
  } catch (error) {
    console.error('Fetch platform settings failed:', error);
    res.status(500).json({ error: 'Unable to load platform settings.' });
  }
});

platformRouter.put('/settings', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      key: z.string().min(2),
      value: z.record(z.string(), z.unknown()),
      description: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid platform setting payload.' });
    }

    const [saved] = await db
      .insert(platformSettings)
      .values({
        key: parsed.data.key,
        value: parsed.data.value,
        description: parsed.data.description || null,
        updatedByProfileId: req.profile!.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: {
          value: parsed.data.value,
          description: parsed.data.description || null,
          updatedByProfileId: req.profile!.id,
          updatedAt: new Date(),
        },
      })
      .returning();

    await logAudit({
      actorProfile: req.profile,
      actorRole: 'platform_super_admin',
      action: 'platform_setting_updated',
      entityType: 'platform_setting',
      entityId: saved.id,
      details: { key: saved.key },
    });

    res.json({ setting: saved });
  } catch (error) {
    console.error('Update platform settings failed:', error);
    res.status(500).json({ error: 'Unable to update platform settings.' });
  }
});

platformRouter.get('/audit-logs', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 250);
    const logs = await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
    res.json({ auditLogs: logs });
  } catch (error) {
    console.error('Platform audit logs failed:', error);
    res.status(500).json({ error: 'Unable to load audit logs.' });
  }
});

platformRouter.get('/health', async (_req, res) => {
  try {
    const started = Date.now();
    await db.execute(sql`SELECT 1`);
    const dbPingMs = Date.now() - started;

    const [orgCount] = await db.select({ total: count() }).from(organizations);
    const [profileCount] = await db.select({ total: count() }).from(profiles);
    const [auditCount] = await db.select({ total: count() }).from(auditLogs);

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        latencyMs: dbPingMs,
      },
      totals: {
        organizations: Number(orgCount?.total || 0),
        profiles: Number(profileCount?.total || 0),
        auditLogs: Number(auditCount?.total || 0),
      },
      uptimeSeconds: Math.floor(process.uptime()),
      integrations: {
        supabaseExternal: getServerSupabaseStatus(),
        firebaseAuth: true,
        smtpEmail: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
        whatsapp: Boolean(process.env.WHATSAPP_API_TOKEN),
        webPush: Boolean(process.env.VAPID_PUBLIC_KEY || process.env.WEB_PUSH_VAPID_PUBLIC_KEY),
      },
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({ status: 'degraded', error: 'Database connectivity check failed.' });
  }
});

// ============================================================================
// CENTRALIZED PASSWORD POLICY & ACCOUNT MANAGEMENT (SUPER ADMIN ONLY)
// ============================================================================

platformRouter.get('/password-policy', async (_req, res) => {
  try {
    const policy = await getPlatformPasswordPolicy();
    res.json({ policy });
  } catch (error) {
    console.error('Load password policy failed:', error);
    res.status(500).json({ error: 'Unable to load password policy.' });
  }
});

platformRouter.put('/password-policy', async (req: AuthRequest, res) => {
  try {
    const policy = normalizePasswordPolicy(req.body);
    await db
      .insert(platformSettings)
      .values({
        key: 'password_policy',
        value: policy as unknown as Record<string, unknown>,
        description:
          'Configurable default password policy/template with unique temporary passwords and mandatory first-login password change',
        updatedByProfileId: req.profile!.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: {
          value: policy as unknown as Record<string, unknown>,
          updatedByProfileId: req.profile!.id,
          updatedAt: new Date(),
        },
      });

    await logAudit({
      actorProfile: req.profile,
      actorRole: 'platform_super_admin',
      action: 'password_policy_updated',
      entityType: 'platform_setting',
      details: {
        enabled: policy.enabled,
        minLength: policy.minLength,
        prefix: policy.prefix,
        forceChangeOnFirstLogin: policy.forceChangeOnFirstLogin,
      },
    });

    res.json({ policy, message: 'Default password policy saved.' });
  } catch (error) {
    console.error('Save password policy failed:', error);
    res.status(500).json({ error: 'Unable to save password policy.' });
  }
});

platformRouter.get('/accounts', async (req, res) => {
  try {
    const roleFilter = typeof req.query.role === 'string' ? req.query.role.trim() : 'all';
    const orgFilter = typeof req.query.organizationId === 'string' ? req.query.organizationId.trim() : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

    const rows = await db
      .select({
        membershipId: organizationMembers.id,
        organizationId: organizations.id,
        organizationName: organizations.name,
        organizationCode: organizations.code,
        roleSlug: roles.slug,
        roleName: roles.name,
        membershipStatus: organizationMembers.status,
        profileId: profiles.id,
        fullName: profiles.fullName,
        email: profiles.email,
        phone: profiles.phone,
        profileStatus: profiles.status,
        isSuperAdmin: profiles.isSuperAdmin,
        mustChangePassword: profiles.mustChangePassword,
        hasPassword: sql<boolean>`(${profiles.passwordHash} IS NOT NULL)`,
        lastLoginAt: profiles.lastLoginAt,
        passwordChangedAt: profiles.passwordChangedAt,
        createdAt: profiles.createdAt,
      })
      .from(organizationMembers)
      .innerJoin(profiles, eq(organizationMembers.profileId, profiles.id))
      .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
      .innerJoin(roles, eq(organizationMembers.roleId, roles.id))
      .orderBy(desc(organizationMembers.createdAt));

    const filtered = rows.filter((r) => {
      if (roleFilter && roleFilter !== 'all' && r.roleSlug !== roleFilter) return false;
      if (orgFilter && r.organizationId !== orgFilter) return false;
      if (search) {
        const hay = `${r.fullName} ${r.email} ${r.organizationName} ${r.organizationCode} ${r.roleName}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    res.json({ accounts: filtered });
  } catch (error) {
    console.error('List platform accounts failed:', error);
    res.status(500).json({ error: 'Unable to load platform accounts.' });
  }
});

platformRouter.post('/accounts', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      organizationId: z.string().uuid(),
      roleSlug: z.enum(['college_admin', 'librarian', 'student']),
      fullName: z.string().min(2),
      email: z.string().email(),
      phone: z.string().optional().nullable(),
      password: z.string().optional().nullable(),
      autoGeneratePassword: z.boolean().optional().default(true),
      requirePasswordChange: z.boolean().optional(),
      // Optional student-specific fields
      collegeRollNumber: z.string().optional().nullable(),
      fatherName: z.string().optional().nullable(),
      designation: z.string().optional().nullable(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid account data.' });
    }

    const d = parsed.data;
    const normalizedEmail = d.email.toLowerCase().trim();
    const policy = await getPlatformPasswordPolicy();

    const [orgRow] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, d.organizationId))
      .limit(1);
    if (!orgRow) {
      return res.status(404).json({ error: 'Selected college/organization does not exist.' });
    }

    const [roleRow] = await db
      .select()
      .from(roles)
      .where(eq(roles.slug, d.roleSlug))
      .limit(1);
    if (!roleRow) {
      return res.status(500).json({ error: `Role "${d.roleSlug}" is not initialized.` });
    }

    const useAuto = d.autoGeneratePassword || !d.password?.trim();
    const plainTempPassword = useAuto
      ? generatePolicyCompliantPassword(policy)
      : d.password!.trim();

    if (!useAuto) {
      const check = validatePasswordAgainstPolicy(plainTempPassword, policy);
      if (!check.valid) {
        return res.status(400).json({ error: check.error });
      }
    }

    const forceChange =
      d.requirePasswordChange !== undefined
        ? d.requirePasswordChange
        : policy.forceChangeOnFirstLogin;

    const { salt, hash } = hashPassword(plainTempPassword);

    // Prevent duplicate student roll if student role
    const rollNumber =
      d.collegeRollNumber?.trim() ||
      `ROLL-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const createdResult = await db.transaction(async (tx) => {
      let [profile] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.email, normalizedEmail))
        .limit(1);

      if (profile) {
        const [updatedProfile] = await tx
          .update(profiles)
          .set({
            fullName: d.fullName.trim(),
            phone: d.phone?.trim() || profile.phone,
            passwordHash: hash,
            passwordSalt: salt,
            mustChangePassword: forceChange,
            status: 'active',
            updatedAt: new Date(),
          })
          .where(eq(profiles.id, profile.id))
          .returning();
        profile = updatedProfile;
      } else {
        const [insertedProfile] = await tx
          .insert(profiles)
          .values({
            uid: `user_${generateSecureToken(12)}`,
            email: normalizedEmail,
            fullName: d.fullName.trim(),
            phone: d.phone?.trim() || null,
            passwordHash: hash,
            passwordSalt: salt,
            mustChangePassword: forceChange,
            status: 'active',
          })
          .returning();
        profile = insertedProfile;
      }

      await tx
        .insert(organizationMembers)
        .values({
          organizationId: d.organizationId,
          profileId: profile.id,
          roleId: roleRow.id,
          status: 'active',
          isDefault: true,
        })
        .onConflictDoUpdate({
          target: [
            organizationMembers.organizationId,
            organizationMembers.profileId,
            organizationMembers.roleId,
          ],
          set: { status: 'active', updatedAt: new Date() },
        });

      if (d.roleSlug === 'librarian') {
        const existingLib = await tx
          .select({ id: librarians.id })
          .from(librarians)
          .where(and(eq(librarians.organizationId, d.organizationId), eq(librarians.profileId, profile.id)))
          .limit(1);
        if (existingLib.length === 0) {
          await tx.insert(librarians).values({
            organizationId: d.organizationId,
            profileId: profile.id,
            employeeCode: `LIB-${Math.floor(1000 + Math.random() * 9000)}`,
            fullName: d.fullName.trim(),
            email: normalizedEmail,
            phone: d.phone?.trim() || null,
            designation: d.designation?.trim() || 'Librarian',
            status: 'active',
          });
        }
      }

      if (d.roleSlug === 'student') {
        const existingStudent = await tx
          .select({ id: students.id })
          .from(students)
          .where(and(eq(students.organizationId, d.organizationId), eq(students.profileId, profile.id)))
          .limit(1);

        if (existingStudent.length === 0) {
          const studentIdCode = `STU-${orgRow.code.slice(0, 4).toUpperCase()}-${Math.floor(10000 + Math.random() * 90000)}`;
          const [studentRow] = await tx
            .insert(students)
            .values({
              organizationId: d.organizationId,
              profileId: profile.id,
              studentIdCode,
              fullName: d.fullName.trim(),
              fatherName: d.fatherName?.trim() || 'N/A',
              collegeRollNumber: rollNumber,
              phone: d.phone?.trim() || 'N/A',
              email: normalizedEmail,
              status: 'active',
            })
            .returning();

          // Auto-issue Digital ID card using institution's first published template
          const [tpl] = await tx
            .select()
            .from(idTemplates)
            .where(eq(idTemplates.organizationId, d.organizationId))
            .limit(1);

          if (tpl) {
            const cardNumber = `ID-${orgRow.code.slice(0, 4).toUpperCase()}-${Math.floor(100000 + Math.random() * 900000)}`;
            const expiresAt = new Date();
            expiresAt.setFullYear(expiresAt.getFullYear() + 1);
            const [card] = await tx
              .insert(idCards)
              .values({
                organizationId: d.organizationId,
                studentId: studentRow.id,
                templateId: tpl.id,
                templateVersion: tpl.currentVersion,
                cardNumber,
                status: 'active',
                expiresAt,
                issuedByProfileId: req.profile!.id,
              })
              .returning();

            await tx.insert(qrTokens).values({
              organizationId: d.organizationId,
              entityType: 'student_id',
              entityId: card.id,
              token: generateSecureToken(24),
              isActive: true,
              expiresAt,
            });
          }
        }
      }

      return profile;
    });

    await logAudit({
      organizationId: d.organizationId,
      actorProfile: req.profile,
      actorRole: 'platform_super_admin',
      action: 'platform_account_provisioned',
      entityType: 'profile',
      entityId: createdResult.id,
      details: {
        email: normalizedEmail,
        roleSlug: d.roleSlug,
        mustChangePassword: forceChange,
      },
    });

    res.status(201).json({
      account: {
        profileId: createdResult.id,
        fullName: createdResult.fullName,
        email: createdResult.email,
        roleSlug: d.roleSlug,
        organizationName: orgRow.name,
        mustChangePassword: forceChange,
      },
      temporaryPasswordOnce: plainTempPassword,
      mustChangePassword: forceChange,
      message: `${roleRow.name} account created. Copy the one-time temporary password now — it is hashed and never stored in plaintext.`,
    });
  } catch (error) {
    console.error('Create platform account failed:', error);
    res.status(500).json({ error: 'Unable to create account. Ensure roll number and email are unique.' });
  }
});

platformRouter.post('/accounts/:profileId/reset-password', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      customPassword: z.string().optional().nullable(),
      requirePasswordChange: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid password reset request.' });
    }

    const [target] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, req.params.profileId))
      .limit(1);

    if (!target) {
      return res.status(404).json({ error: 'Target account not found.' });
    }

    const policy = await getPlatformPasswordPolicy();
    const customPwd = parsed.data.customPassword?.trim();
    const plainTempPassword = customPwd
      ? customPwd
      : generatePolicyCompliantPassword(policy);

    if (customPwd) {
      const check = validatePasswordAgainstPolicy(customPwd, policy);
      if (!check.valid) {
        return res.status(400).json({ error: check.error });
      }
    }

    const forceChange =
      parsed.data.requirePasswordChange !== undefined
        ? parsed.data.requirePasswordChange
        : policy.forceChangeOnFirstLogin;

    const { salt, hash } = hashPassword(plainTempPassword);
    await db
      .update(profiles)
      .set({
        passwordHash: hash,
        passwordSalt: salt,
        mustChangePassword: forceChange,
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, target.id));

    await createNotification({
      recipientProfileId: target.id,
      type: 'password_reset_by_super_admin',
      title: 'Temporary Password Issued by Platform Super Admin',
      message: forceChange
        ? 'Your account password was reset by the Platform Super Admin. You will be required to set a new personal password on your next sign-in.'
        : 'Your account password was updated by the Platform Super Admin.',
      entityType: 'profile',
      entityId: target.id,
    });

    await logAudit({
      actorProfile: req.profile,
      actorRole: 'platform_super_admin',
      action: 'platform_account_password_reset',
      entityType: 'profile',
      entityId: target.id,
      details: { targetEmail: target.email, mustChangePassword: forceChange },
    });

    res.json({
      email: target.email,
      fullName: target.fullName,
      temporaryPasswordOnce: plainTempPassword,
      mustChangePassword: forceChange,
      message:
        'Unique temporary password generated and hashed. Share it securely — it will not be shown again.',
    });
  } catch (error) {
    console.error('Reset account password failed:', error);
    res.status(500).json({ error: 'Unable to reset account password.' });
  }
});

platformRouter.patch('/accounts/:profileId/status', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({ status: z.enum(['active', 'suspended']) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Status must be "active" or "suspended".' });
    }

    const [target] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, req.params.profileId))
      .limit(1);
    if (!target) return res.status(404).json({ error: 'Account not found.' });
    if (target.id === req.profile!.id) {
      return res.status(400).json({ error: 'You cannot suspend your own Super Admin account.' });
    }

    const [updated] = await db
      .update(profiles)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(eq(profiles.id, target.id))
      .returning();

    await logAudit({
      actorProfile: req.profile,
      actorRole: 'platform_super_admin',
      action: 'platform_account_status_changed',
      entityType: 'profile',
      entityId: updated.id,
      details: { email: updated.email, status: updated.status },
    });

    res.json({
      profileId: updated.id,
      status: updated.status,
      message: `Account ${updated.status === 'active' ? 'reactivated' : 'suspended'}.`,
    });
  } catch (error) {
    console.error('Update account status failed:', error);
    res.status(500).json({ error: 'Unable to update account status.' });
  }
});

// ============================================================================
// EXCLUSIVE FOUNDER & INDEPENDENT PREMIUM STUDENT ALLOCATION (SUPER ADMIN ONLY)
// ============================================================================

platformRouter.get('/students/directory', async (req, res) => {
  try {
    const orgFilter = typeof req.query.organizationId === 'string' ? req.query.organizationId.trim() : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const tierFilter = typeof req.query.tier === 'string' ? req.query.tier.trim() : 'all'; // all | founder | premium | standard

    const [studentRows, founderRows] = await Promise.all([
      db
        .select({
          student: students,
          organizationName: organizations.name,
          organizationCode: organizations.code,
          courseName: courses.name,
          semesterName: semesters.name,
          sessionName: academicSessions.name,
        })
        .from(students)
        .innerJoin(organizations, eq(students.organizationId, organizations.id))
        .leftJoin(courses, eq(students.courseId, courses.id))
        .leftJoin(semesters, eq(students.semesterId, semesters.id))
        .leftJoin(academicSessions, eq(students.academicSessionId, academicSessions.id))
        .orderBy(desc(students.createdAt)),
      db
        .select({
          founder: founderIdentities,
          qrToken: qrTokens.token,
        })
        .from(founderIdentities)
        .leftJoin(qrTokens, eq(founderIdentities.qrTokenId, qrTokens.id))
        .where(eq(founderIdentities.status, 'active')),
    ]);

    const activeFounderByStudent = new Map(
      founderRows
        .filter((f) => f.founder.linkedStudentId)
        .map((f) => [
          f.founder.linkedStudentId!,
          {
            id: f.founder.id,
            founderNumber: f.founder.founderNumber,
            designation: f.founder.designation,
            editionName: f.founder.editionName.replace(/SHARIXA/gi, 'QIVORA'),
            organizationLabel: f.founder.organizationLabel.replace(/SHARIXA/gi, 'QIVORA'),
            status: f.founder.status,
            collegeLinkStatus: f.founder.collegeLinkStatus,
            issuedAt: f.founder.issuedAt,
            qrToken: f.qrToken,
          },
        ])
    );

    const enriched = studentRows
      .map((row) => {
        const s = row.student;
        const founder = activeFounderByStudent.get(s.id) || null;
        return {
          id: s.id,
          organizationId: s.organizationId,
          organizationName: row.organizationName,
          organizationCode: row.organizationCode,
          profileId: s.profileId,
          studentIdCode: s.studentIdCode,
          fullName: s.fullName,
          collegeRollNumber: s.collegeRollNumber,
          email: s.email,
          phone: s.phone,
          photoUrl: s.photoUrl,
          courseName: row.courseName,
          semesterName: row.semesterName,
          sessionName: row.sessionName,
          status: s.status,
          isFounder: Boolean(founder),
          founder,
          isPremium: s.isPremium,
          premiumTier: s.premiumTier,
          premiumDesign: s.premiumDesign,
          premiumBadgeLabel: s.premiumBadgeLabel,
          premiumGrantedAt: s.premiumGrantedAt,
          premiumNote: s.premiumNote,
        };
      })
      .filter((item) => {
        if (orgFilter && item.organizationId !== orgFilter) return false;
        if (tierFilter === 'founder' && !item.isFounder) return false;
        if (tierFilter === 'premium' && !item.isPremium) return false;
        if (tierFilter === 'standard' && (item.isFounder || item.isPremium)) return false;
        if (search) {
          const hay = `${item.fullName} ${item.email} ${item.studentIdCode} ${item.collegeRollNumber} ${item.organizationName} ${item.organizationCode}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      });

    res.json({
      students: enriched,
      premiumDesigns: PREMIUM_STUDENT_DESIGNS,
    });
  } catch (error) {
    console.error('Platform student directory failed:', error);
    res.status(500).json({ error: 'Unable to load cross-college student directory.' });
  }
});

// Exclusive Super Admin action: Assign Founder Status + Auto-Generate Golden Premium Founder Digital ID
platformRouter.post('/students/:studentId/founder', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      designation: z.string().min(2).max(120).optional().default('QIVORA Golden Founder'),
      organizationLabel: z.string().min(2).max(120).optional().default('QIVORA Smart Library Network'),
      bio: z.string().max(400).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid Founder designation details.' });
    }

    const [student] = await db
      .select()
      .from(students)
      .where(eq(students.id, req.params.studentId))
      .limit(1);

    if (!student) {
      return res.status(404).json({ error: 'Student not found across registered colleges.' });
    }

    // Check if student already holds an active Founder identity
    const existingActive = await db
      .select()
      .from(founderIdentities)
      .where(
        and(
          eq(founderIdentities.linkedStudentId, student.id),
          eq(founderIdentities.status, 'active')
        )
      )
      .limit(1);

    if (existingActive.length > 0) {
      return res.status(409).json({
        error: `${student.fullName} already holds an active Golden Founder ID (${existingActive[0].founderNumber}).`,
      });
    }

    const founderNumber = `QIV-FND-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const randomToken = generateSecureToken(28);

    const created = await db.transaction(async (tx) => {
      const [founder] = await tx
        .insert(founderIdentities)
        .values({
          profileId: student.profileId || null,
          linkedOrganizationId: student.organizationId,
          linkedStudentId: student.id,
          collegeLinkStatus: 'approved',
          collegeApprovedByProfileId: req.profile!.id,
          collegeApprovedAt: new Date(),
          founderNumber,
          fullName: student.fullName,
          designation: parsed.data.designation.trim(),
          organizationLabel: parsed.data.organizationLabel.trim(),
          photoUrl: student.photoUrl || null,
          editionName: 'QIVORA — GOLDEN FOUNDER EDITION',
          bio:
            parsed.data.bio?.trim() ||
            'Exclusively awarded QIVORA Golden Founder recognition by Platform Super Admin.',
          status: 'active',
          issuedByProfileId: req.profile!.id,
        })
        .returning();

      const [qr] = await tx
        .insert(qrTokens)
        .values({
          organizationId: null,
          entityType: 'founder_id',
          entityId: founder.id,
          token: randomToken,
          isActive: true,
        })
        .returning();

      const [updatedFounder] = await tx
        .update(founderIdentities)
        .set({ qrTokenId: qr.id })
        .where(eq(founderIdentities.id, founder.id))
        .returning();

      return { founder: updatedFounder, qrToken: qr.token };
    });

    if (student.profileId) {
      await createNotification({
        organizationId: student.organizationId,
        recipientProfileId: student.profileId,
        type: 'founder_status_granted',
        title: 'Golden Founder Status Awarded',
        message: `Congratulations! Platform Super Admin awarded you QIVORA Golden Founder status (${created.founder.founderNumber}). Your exclusive Golden Premium Founder Digital ID is now live in your Student Portal.`,
        entityType: 'founder_identity',
        entityId: created.founder.id,
      });
    }

    await logAudit({
      organizationId: student.organizationId,
      actorProfile: req.profile,
      actorRole: 'platform_super_admin',
      action: 'exclusive_founder_assigned',
      entityType: 'founder_identity',
      entityId: created.founder.id,
      details: {
        studentId: student.id,
        studentName: student.fullName,
        founderNumber: created.founder.founderNumber,
      },
    });

    const linkedCollege = await hydrateFounderLinkedCollege(created.founder);
    res.status(201).json({
      founderId: {
        ...created.founder,
        qrToken: created.qrToken,
        qrIsActive: true,
        linkedCollege,
      },
      message: `Golden Founder status assigned to ${student.fullName} and Golden Premium Founder Digital ID generated.`,
    });
  } catch (error) {
    console.error('Assign exclusive founder failed:', error);
    res.status(500).json({ error: 'Unable to assign Founder status.' });
  }
});

// Exclusive Super Admin action: Revoke Founder Status from any student
platformRouter.delete('/students/:studentId/founder', async (req: AuthRequest, res) => {
  try {
    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim()
        : 'Founder status revoked by Platform Super Admin';

    const [student] = await db
      .select()
      .from(students)
      .where(eq(students.id, req.params.studentId))
      .limit(1);
    if (!student) return res.status(404).json({ error: 'Student not found.' });

    const activeFounders = await db
      .select()
      .from(founderIdentities)
      .where(
        and(
          eq(founderIdentities.linkedStudentId, student.id),
          eq(founderIdentities.status, 'active')
        )
      );

    if (activeFounders.length === 0) {
      return res.status(404).json({ error: 'This student does not currently hold active Founder status.' });
    }

    await db.transaction(async (tx) => {
      for (const f of activeFounders) {
        if (f.qrTokenId) {
          await tx
            .update(qrTokens)
            .set({ isActive: false, revokedAt: new Date(), revokedReason: reason })
            .where(eq(qrTokens.id, f.qrTokenId));
        }
        await tx
          .update(founderIdentities)
          .set({
            status: 'revoked',
            collegeLinkStatus: 'revoked',
            statusReason: reason,
            revokedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(founderIdentities.id, f.id));
      }
    });

    if (student.profileId) {
      await createNotification({
        organizationId: student.organizationId,
        recipientProfileId: student.profileId,
        type: 'founder_status_revoked',
        title: 'Founder Status Updated',
        message: 'Your QIVORA Golden Founder designation was revoked by the Platform Super Admin. Your standard institutional student Digital ID remains active.',
        entityType: 'student',
        entityId: student.id,
      });
    }

    await logAudit({
      organizationId: student.organizationId,
      actorProfile: req.profile,
      actorRole: 'platform_super_admin',
      action: 'exclusive_founder_revoked',
      entityType: 'student',
      entityId: student.id,
      details: {
        studentName: student.fullName,
        revokedFounderNumbers: activeFounders.map((f) => f.founderNumber),
        reason,
      },
    });

    res.json({ message: `Founder status revoked for ${student.fullName}.` });
  } catch (error) {
    console.error('Revoke student founder status failed:', error);
    res.status(500).json({ error: 'Unable to revoke Founder status.' });
  }
});

// Independent Premium Student Status & Premium Digital ID Design (WITHOUT Founder privileges)
platformRouter.post('/students/:studentId/premium', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      premiumDesign: z
        .enum(['obsidian_platinum', 'royal_sapphire', 'emerald_prestige', 'crimson_scholar'])
        .default('obsidian_platinum'),
      premiumBadgeLabel: z.string().min(2).max(40).optional(),
      premiumNote: z.string().max(300).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Choose a valid Premium Student Digital ID design.' });
    }

    const [student] = await db
      .select()
      .from(students)
      .where(eq(students.id, req.params.studentId))
      .limit(1);
    if (!student) return res.status(404).json({ error: 'Student not found.' });

    const preset = getPremiumStudentDesign(parsed.data.premiumDesign);
    const badgeLabel = parsed.data.premiumBadgeLabel?.trim() || preset.badgeLabel;

    const [updated] = await db
      .update(students)
      .set({
        isPremium: true,
        premiumTier: preset.key,
        premiumDesign: preset.key,
        premiumBadgeLabel: badgeLabel,
        premiumGrantedAt: new Date(),
        premiumGrantedByProfileId: req.profile!.id,
        premiumNote: parsed.data.premiumNote?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(students.id, student.id))
      .returning();

    if (student.profileId) {
      await createNotification({
        organizationId: student.organizationId,
        recipientProfileId: student.profileId,
        type: 'premium_student_granted',
        title: `Premium Student ID Activated — ${preset.name}`,
        message: `Platform Super Admin assigned you the "${preset.name}" Premium Student Digital ID (${badgeLabel}). View your upgraded Digital ID in the Student Portal.`,
        entityType: 'student',
        entityId: student.id,
      });
    }

    await logAudit({
      organizationId: student.organizationId,
      actorProfile: req.profile,
      actorRole: 'platform_super_admin',
      action: 'premium_student_assigned',
      entityType: 'student',
      entityId: student.id,
      details: {
        studentName: student.fullName,
        premiumDesign: preset.key,
        premiumBadgeLabel: badgeLabel,
      },
    });

    res.json({
      student: {
        id: updated.id,
        fullName: updated.fullName,
        isPremium: updated.isPremium,
        premiumTier: updated.premiumTier,
        premiumDesign: updated.premiumDesign,
        premiumBadgeLabel: updated.premiumBadgeLabel,
        premiumGrantedAt: updated.premiumGrantedAt,
      },
      message: `Premium Student ID (${preset.name}) assigned to ${student.fullName} without granting Founder privileges.`,
    });
  } catch (error) {
    console.error('Assign premium student failed:', error);
    res.status(500).json({ error: 'Unable to assign Premium Student status.' });
  }
});

platformRouter.delete('/students/:studentId/premium', async (req: AuthRequest, res) => {
  try {
    const [student] = await db
      .select()
      .from(students)
      .where(eq(students.id, req.params.studentId))
      .limit(1);
    if (!student) return res.status(404).json({ error: 'Student not found.' });

    await db
      .update(students)
      .set({
        isPremium: false,
        premiumTier: null,
        premiumDesign: null,
        premiumBadgeLabel: null,
        premiumGrantedAt: null,
        premiumGrantedByProfileId: null,
        premiumNote: null,
        updatedAt: new Date(),
      })
      .where(eq(students.id, student.id));

    if (student.profileId) {
      await createNotification({
        organizationId: student.organizationId,
        recipientProfileId: student.profileId,
        type: 'premium_student_revoked',
        title: 'Premium Student ID Updated',
        message: 'Your Premium Student ID tier was removed by Platform Super Admin. Your standard institutional Digital ID remains active.',
        entityType: 'student',
        entityId: student.id,
      });
    }

    await logAudit({
      organizationId: student.organizationId,
      actorProfile: req.profile,
      actorRole: 'platform_super_admin',
      action: 'premium_student_revoked',
      entityType: 'student',
      entityId: student.id,
      details: { studentName: student.fullName },
    });

    res.json({ message: `Premium Student status revoked for ${student.fullName}.` });
  } catch (error) {
    console.error('Revoke premium student failed:', error);
    res.status(500).json({ error: 'Unable to revoke Premium Student status.' });
  }
});

