import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  academicSessions,
  attendance,
  courses,
  departments,
  fines,
  founderIdentities,
  idCards,
  idDesigns,
  idTemplateAssignments,
  idTemplates,
  idTemplateVersions,
  librarySettings,
  loans,
  organizationBranding,
  organizationMembers,
  organizations,
  profiles,
  qrTokens,
  roles,
  semesters,
  studentApplications,
  studentCategories,
  students,
} from '../../db/schema.ts';
import { LOCKED_OFFICIAL_FIELDS } from '../../shared/id-presets.ts';
import {
  type AuthRequest,
  createNotification,
  generateSecureToken,
  hashPassword,
  logAudit,
  requireAuth,
  requireOrgRole,
} from '../auth.ts';

export const studentsAndIdsRouter = Router();

function generateStrongPassword(length = 10): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '@#$%&*';
  const all = upper + lower + digits + symbols;
  const pick = (chars: string) => chars[randomBytes(1)[0] % chars.length];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < length) {
    chars.push(pick(all));
  }
  // Fisher-Yates shuffle using crypto bytes
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// Priority resolution for official ID template assignment:
// Individual Student (100) > Combined (70) > Semester (50) > Course (30) > Category (25) > Session (20) > All New / All Existing (10)
async function resolveTemplateForStudent(
  orgId: string,
  student: {
    id: string;
    courseId: string | null;
    semesterId: string | null;
    academicSessionId: string | null;
    studentCategoryId: string | null;
  }
) {
  const activeAssignments = await db
    .select()
    .from(idTemplateAssignments)
    .where(
      and(
        eq(idTemplateAssignments.organizationId, orgId),
        eq(idTemplateAssignments.status, 'active')
      )
    )
    .orderBy(desc(idTemplateAssignments.priority), desc(idTemplateAssignments.createdAt));

  for (const a of activeAssignments) {
    if (a.scopeType === 'individual_student' && a.studentId === student.id) {
      return a.templateId;
    }
    if (a.scopeType === 'combined') {
      const courseOk = !a.courseId || a.courseId === student.courseId;
      const semOk = !a.semesterId || a.semesterId === student.semesterId;
      const sessOk = !a.academicSessionId || a.academicSessionId === student.academicSessionId;
      const catOk = !a.studentCategoryId || a.studentCategoryId === student.studentCategoryId;
      if (courseOk && semOk && sessOk && catOk) return a.templateId;
    }
    if (a.scopeType === 'semester' && a.semesterId && a.semesterId === student.semesterId) {
      if (!a.courseId || a.courseId === student.courseId) return a.templateId;
    }
    if (a.scopeType === 'course' && a.courseId && a.courseId === student.courseId) {
      return a.templateId;
    }
    if (a.scopeType === 'student_category' && a.studentCategoryId && a.studentCategoryId === student.studentCategoryId) {
      return a.templateId;
    }
    if (a.scopeType === 'academic_session' && a.academicSessionId && a.academicSessionId === student.academicSessionId) {
      return a.templateId;
    }
    if ((a.scopeType === 'all_new' || a.scopeType === 'all_existing') && a.applyToNewStudents) {
      return a.templateId;
    }
  }

  // Fallback to Modern Blue or first published template in org
  const templates = await db
    .select()
    .from(idTemplates)
    .where(and(eq(idTemplates.organizationId, orgId), eq(idTemplates.status, 'published')));
  const modernBlue = templates.find((t) => t.presetKey === 'modern_blue');
  return modernBlue?.id || templates[0]?.id || null;
}

async function issueDigitalIdForStudent(params: {
  orgId: string;
  studentId: string;
  templateId?: string | null;
  actorProfileId?: string | null;
}) {
  const [student] = await db
    .select()
    .from(students)
    .where(and(eq(students.id, params.studentId), eq(students.organizationId, params.orgId)))
    .limit(1);

  if (!student) throw new Error('Student not found');

  const resolvedTemplateId =
    params.templateId || (await resolveTemplateForStudent(params.orgId, student));
  if (!resolvedTemplateId) throw new Error('No published ID template available for this organization.');

  const [tpl] = await db
    .select()
    .from(idTemplates)
    .where(and(eq(idTemplates.id, resolvedTemplateId), eq(idTemplates.organizationId, params.orgId)))
    .limit(1);
  if (!tpl) throw new Error('Template not found.');

  const [settings] = await db
    .select()
    .from(librarySettings)
    .where(eq(librarySettings.organizationId, params.orgId))
    .limit(1);

  const validityMonths = settings?.idValidityMonths || 12;
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt);
  expiresAt.setMonth(expiresAt.getMonth() + validityMonths);

  const cardNumber = `QIV-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
  const qrTokenValue = generateSecureToken(24);

  return await db.transaction(async (tx) => {
    // Revoke any existing active cards for this student cleanly
    const existingCards = await tx
      .select()
      .from(idCards)
      .where(and(eq(idCards.studentId, student.id), eq(idCards.status, 'active')));

    for (const oldCard of existingCards) {
      await tx
        .update(idCards)
        .set({
          status: 'revoked',
          statusReason: 'Superseded by newly generated ID card',
          revokedAt: new Date(),
          revokedByProfileId: params.actorProfileId || null,
          updatedAt: new Date(),
        })
        .where(eq(idCards.id, oldCard.id));

      await tx
        .update(qrTokens)
        .set({
          isActive: false,
          revokedAt: new Date(),
          revokedReason: 'Superseded by newly generated ID card',
        })
        .where(and(eq(qrTokens.entityType, 'student_id'), eq(qrTokens.entityId, oldCard.id)));
    }

    const [card] = await tx
      .insert(idCards)
      .values({
        organizationId: params.orgId,
        studentId: student.id,
        templateId: tpl.id,
        templateVersion: tpl.currentVersion,
        cardNumber,
        status: 'active',
        statusReason: 'Official digital ID issued',
        issuedAt,
        expiresAt,
        issuedByProfileId: params.actorProfileId || null,
      })
      .returning();

    const [qr] = await tx
      .insert(qrTokens)
      .values({
        organizationId: params.orgId,
        entityType: 'student_id',
        entityId: card.id,
        token: qrTokenValue,
        isActive: true,
        expiresAt,
      })
      .returning();

    if (student.profileId) {
      await createNotification({
        organizationId: params.orgId,
        recipientProfileId: student.profileId,
        type: 'digital_id_issued',
        title: 'Digital ID Card Issued',
        message: `Your official Digital ID (${cardNumber}) is now active using the ${tpl.name} template.`,
        entityType: 'id_card',
        entityId: card.id,
      });
    }

    return { card, qrToken: qr.token, template: tpl };
  });
}

// ============================================================================
// STUDENT APPLICATIONS
// ============================================================================

studentsAndIdsRouter.get(
  '/org/student-applications',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const statusFilter = req.query.status as string | undefined;
      const orgId = req.orgId!;
      const rows = await db
        .select({
          application: studentApplications,
          courseName: courses.name,
          semesterName: semesters.name,
          departmentName: departments.name,
          sessionName: academicSessions.name,
        })
        .from(studentApplications)
        .leftJoin(courses, eq(studentApplications.courseId, courses.id))
        .leftJoin(semesters, eq(studentApplications.semesterId, semesters.id))
        .leftJoin(departments, eq(studentApplications.departmentId, departments.id))
        .leftJoin(academicSessions, eq(studentApplications.academicSessionId, academicSessions.id))
        .where(
          statusFilter && statusFilter !== 'all'
            ? and(
                eq(studentApplications.organizationId, orgId),
                eq(studentApplications.status, statusFilter)
              )
            : eq(studentApplications.organizationId, orgId)
        )
        .orderBy(desc(studentApplications.createdAt));

      res.json({
        applications: rows.map((r) => ({
          ...r.application,
          courseName: r.courseName,
          semesterName: r.semesterName,
          departmentName: r.departmentName,
          sessionName: r.sessionName,
        })),
      });
    } catch (error) {
      console.error('List applications failed:', error);
      res.status(500).json({ error: 'Unable to load student applications.' });
    }
  }
);

studentsAndIdsRouter.post(
  '/org/student-applications/:id/approve',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const [app] = await db
        .select()
        .from(studentApplications)
        .where(
          and(
            eq(studentApplications.id, req.params.id),
            eq(studentApplications.organizationId, orgId)
          )
        )
        .limit(1);

      if (!app) return res.status(404).json({ error: 'Application not found.' });
      if (app.status !== 'pending') {
        return res.status(400).json({ error: `Application has already been ${app.status}.` });
      }

      // Check duplicates
      const dup = await db
        .select({ id: students.id })
        .from(students)
        .where(
          and(
            eq(students.organizationId, orgId),
            eq(students.collegeRollNumber, app.collegeRollNumber)
          )
        )
        .limit(1);
      if (dup.length > 0) {
        return res.status(409).json({
          error: 'A student with this College Roll Number already exists in this institution.',
        });
      }

      const [studentRole] = await db.select().from(roles).where(eq(roles.slug, 'student')).limit(1);

      // Link or create user profile
      let profileId = app.submittedByProfileId;
      if (!profileId) {
        const existingProfile = await db
          .select()
          .from(profiles)
          .where(eq(profiles.email, app.email.toLowerCase()))
          .limit(1);
        if (existingProfile.length > 0) {
          profileId = existingProfile[0].id;
        } else {
          const tempPass = req.body?.initialPassword || `Qiv@${app.collegeRollNumber}`;
          const { salt, hash } = hashPassword(tempPass);
          const [createdProfile] = await db
            .insert(profiles)
            .values({
              uid: `local_${generateSecureToken(12)}`,
              email: app.email.toLowerCase(),
              fullName: app.fullName,
              phone: app.phone,
              avatarUrl: app.photoUrl,
              passwordHash: hash,
              passwordSalt: salt,
              status: 'active',
            })
            .returning();
          profileId = createdProfile.id;
        }
      }

      const studentIdCode =
        app.proposedStudentId?.trim() ||
        `STU-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

      const [student] = await db
        .insert(students)
        .values({
          organizationId: orgId,
          profileId,
          studentIdCode,
          fullName: app.fullName,
          fatherName: app.fatherName,
          collegeRollNumber: app.collegeRollNumber,
          universityRollNumber: app.universityRollNumber,
          courseId: app.courseId,
          semesterId: app.semesterId,
          departmentId: app.departmentId,
          academicSessionId: app.academicSessionId,
          studentCategoryId: app.studentCategoryId,
          dateOfBirth: app.dateOfBirth,
          gender: app.gender,
          phone: app.phone,
          email: app.email.toLowerCase(),
          address: app.address,
          photoUrl: app.photoUrl,
          idProofUrl: app.idProofUrl,
          status: 'active',
        })
        .returning();

      if (profileId && studentRole) {
        await db
          .insert(organizationMembers)
          .values({
            organizationId: orgId,
            profileId,
            roleId: studentRole.id,
            status: 'active',
            isDefault: true,
          })
          .onConflictDoUpdate({
            target: [organizationMembers.organizationId, organizationMembers.profileId, organizationMembers.roleId],
            set: { status: 'active', updatedAt: new Date() },
          });
      }

      await db
        .update(studentApplications)
        .set({
          status: 'approved',
          reviewedByProfileId: req.profile!.id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(studentApplications.id, app.id));

      // Automatically apply official ID template assignment & issue Digital ID
      const issuedId = await issueDigitalIdForStudent({
        orgId,
        studentId: student.id,
        actorProfileId: req.profile!.id,
      });

      if (profileId) {
        await createNotification({
          organizationId: orgId,
          recipientProfileId: profileId,
          type: 'registration_approved',
          title: 'Registration Approved',
          message: `Welcome to the library! Your Student ID is ${student.studentIdCode} and your Digital ID has been generated.`,
          entityType: 'student',
          entityId: student.id,
        });
      }

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'student_application_approved',
        entityType: 'student',
        entityId: student.id,
        details: {
          applicationId: app.id,
          studentIdCode: student.studentIdCode,
          cardNumber: issuedId.card.cardNumber,
        },
      });

      res.json({ student, idCard: issuedId.card });
    } catch (error) {
      console.error('Approve application failed:', error);
      res.status(500).json({ error: 'Unable to approve student application.' });
    }
  }
);

studentsAndIdsRouter.post(
  '/org/student-applications/:id/reject',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim()
        : 'Application did not meet institutional verification requirements.';

      const [updated] = await db
        .update(studentApplications)
        .set({
          status: 'rejected',
          rejectionReason: reason,
          reviewedByProfileId: req.profile!.id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(studentApplications.id, req.params.id),
            eq(studentApplications.organizationId, req.orgId!)
          )
        )
        .returning();

      if (!updated) return res.status(404).json({ error: 'Application not found.' });

      if (updated.submittedByProfileId) {
        await createNotification({
          organizationId: req.orgId!,
          recipientProfileId: updated.submittedByProfileId,
          type: 'registration_rejected',
          title: 'Registration Application Rejected',
          message: `Reason: ${reason}`,
          entityType: 'student_application',
          entityId: updated.id,
        });
      }

      await logAudit({
        organizationId: req.orgId!,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'student_application_rejected',
        entityType: 'student_application',
        entityId: updated.id,
        details: { reason },
      });

      res.json({ application: updated });
    } catch (error) {
      console.error('Reject application failed:', error);
      res.status(500).json({ error: 'Unable to reject application.' });
    }
  }
);

// ============================================================================
// STUDENTS MANAGEMENT
// ============================================================================

studentsAndIdsRouter.get(
  '/org/students',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const rows = await db
        .select({
          student: students,
          courseName: courses.name,
          courseCode: courses.code,
          semesterName: semesters.name,
          departmentName: departments.name,
          sessionName: academicSessions.name,
          categoryName: studentCategories.name,
        })
        .from(students)
        .leftJoin(courses, eq(students.courseId, courses.id))
        .leftJoin(semesters, eq(students.semesterId, semesters.id))
        .leftJoin(departments, eq(students.departmentId, departments.id))
        .leftJoin(academicSessions, eq(students.academicSessionId, academicSessions.id))
        .leftJoin(studentCategories, eq(students.studentCategoryId, studentCategories.id))
        .where(eq(students.organizationId, orgId))
        .orderBy(desc(students.createdAt));

      // Attach active ID card summary
      const activeCards = await db
        .select({
          studentId: idCards.studentId,
          cardId: idCards.id,
          cardNumber: idCards.cardNumber,
          status: idCards.status,
          templateId: idCards.templateId,
          templateName: idTemplates.name,
        })
        .from(idCards)
        .innerJoin(idTemplates, eq(idCards.templateId, idTemplates.id))
        .where(and(eq(idCards.organizationId, orgId), eq(idCards.status, 'active')));

      const cardByStudent = new Map(activeCards.map((c) => [c.studentId, c]));

      // Attach any linked Founder Identities for this institution
      const linkedFounders = await db
        .select({
          id: founderIdentities.id,
          linkedStudentId: founderIdentities.linkedStudentId,
          founderNumber: founderIdentities.founderNumber,
          designation: founderIdentities.designation,
          editionName: founderIdentities.editionName,
          status: founderIdentities.status,
          collegeLinkStatus: founderIdentities.collegeLinkStatus,
          collegeApprovedAt: founderIdentities.collegeApprovedAt,
        })
        .from(founderIdentities)
        .where(eq(founderIdentities.linkedOrganizationId, orgId));

      const founderByStudent = new Map(
        linkedFounders
          .filter((f) => Boolean(f.linkedStudentId))
          .map((f) => [f.linkedStudentId!, f])
      );

      res.json({
        students: rows.map((r) => ({
          ...r.student,
          courseName: r.courseName,
          courseCode: r.courseCode,
          semesterName: r.semesterName,
          departmentName: r.departmentName,
          sessionName: r.sessionName,
          categoryName: r.categoryName,
          activeIdCard: cardByStudent.get(r.student.id) || null,
          founderLink: founderByStudent.get(r.student.id) || null,
        })),
      });
    } catch (error) {
      console.error('List students failed:', error);
      res.status(500).json({ error: 'Unable to load students.' });
    }
  }
);

const createStudentSchema = z.object({
  fullName: z.string().min(2),
  fatherName: z.string().min(2),
  collegeRollNumber: z.string().min(2),
  universityRollNumber: z.string().optional().nullable(),
  studentIdCode: z.string().optional(),
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
  autoGenerateId: z.boolean().optional().default(true),
});

studentsAndIdsRouter.post(
  '/org/students',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const parsed = createStudentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid student data.' });
      }
      const d = parsed.data;
      const orgId = req.orgId!;
      const email = d.email.toLowerCase().trim();
      const roll = d.collegeRollNumber.trim();

      const dup = await db
        .select({ id: students.id })
        .from(students)
        .where(and(eq(students.organizationId, orgId), eq(students.collegeRollNumber, roll)))
        .limit(1);
      if (dup.length > 0) {
        return res.status(409).json({ error: 'A student with this College Roll Number already exists.' });
      }

      const [studentRole] = await db.select().from(roles).where(eq(roles.slug, 'student')).limit(1);

      let profile = (await db.select().from(profiles).where(eq(profiles.email, email)).limit(1))[0];
      if (!profile) {
        const { salt, hash } = hashPassword(d.password || `Qiv@${roll}`);
        [profile] = await db
          .insert(profiles)
          .values({
            uid: `local_${generateSecureToken(12)}`,
            email,
            fullName: d.fullName.trim(),
            phone: d.phone.trim(),
            avatarUrl: d.photoUrl || null,
            passwordHash: hash,
            passwordSalt: salt,
            status: 'active',
          })
          .returning();
      }

      const studentIdCode =
        d.studentIdCode?.trim() ||
        `STU-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

      const [created] = await db
        .insert(students)
        .values({
          organizationId: orgId,
          profileId: profile.id,
          studentIdCode,
          fullName: d.fullName.trim(),
          fatherName: d.fatherName.trim(),
          collegeRollNumber: roll,
          universityRollNumber: d.universityRollNumber?.trim() || null,
          courseId: d.courseId || null,
          semesterId: d.semesterId || null,
          departmentId: d.departmentId || null,
          academicSessionId: d.academicSessionId || null,
          studentCategoryId: d.studentCategoryId || null,
          dateOfBirth: d.dateOfBirth || null,
          gender: d.gender || null,
          phone: d.phone.trim(),
          email,
          address: d.address?.trim() || null,
          photoUrl: d.photoUrl || null,
          idProofUrl: d.idProofUrl || null,
          status: 'active',
        })
        .returning();

      if (studentRole) {
        await db
          .insert(organizationMembers)
          .values({
            organizationId: orgId,
            profileId: profile.id,
            roleId: studentRole.id,
            status: 'active',
            isDefault: true,
          })
          .onConflictDoNothing();
      }

      let idCard = null;
      if (d.autoGenerateId) {
        const issued = await issueDigitalIdForStudent({
          orgId,
          studentId: created.id,
          actorProfileId: req.profile!.id,
        });
        idCard = issued.card;
      }

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'student_registered',
        entityType: 'student',
        entityId: created.id,
        details: { studentIdCode, roll, email },
      });

      res.status(201).json({ student: created, idCard });
    } catch (error) {
      console.error('Register student failed:', error);
      res.status(409).json({ error: 'Student roll number, ID code, or email already exists.' });
    }
  }
);

const bulkStudentRowSchema = z.object({
  fullName: z.string().optional().default(''),
  collegeRollNumber: z.string().optional().default(''),
  studentIdCode: z.string().optional().nullable(),
  fatherName: z.string().optional().nullable(),
  departmentOrCourse: z.string().optional().nullable(),
  courseId: z.string().uuid().optional().nullable(),
  departmentId: z.string().uuid().optional().nullable(),
  semesterId: z.string().uuid().optional().nullable(),
  academicSessionId: z.string().uuid().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
});

studentsAndIdsRouter.post(
  '/org/students/bulk',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        students: z.array(bulkStudentRowSchema).min(1).max(500),
        defaultCourseId: z.string().uuid().optional().nullable(),
        defaultSemesterId: z.string().uuid().optional().nullable(),
        defaultAcademicSessionId: z.string().uuid().optional().nullable(),
        autoGenerateId: z.boolean().optional().default(true),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Provide between 1 and 500 student rows.',
        });
      }

      const orgId = req.orgId!;
      const {
        students: inputRows,
        defaultCourseId,
        defaultSemesterId,
        defaultAcademicSessionId,
        autoGenerateId,
      } = parsed.data;

      const [orgRow, studentRoleRow, existingStudents, existingProfiles, orgCourses, orgDepartments] =
        await Promise.all([
          db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1),
          db.select().from(roles).where(eq(roles.slug, 'student')).limit(1),
          db
            .select({
              roll: students.collegeRollNumber,
              studentIdCode: students.studentIdCode,
              email: students.email,
            })
            .from(students)
            .where(eq(students.organizationId, orgId)),
          db.select({ id: profiles.id, email: profiles.email }).from(profiles),
          db.select().from(courses).where(eq(courses.organizationId, orgId)),
          db.select().from(departments).where(eq(departments.organizationId, orgId)),
        ]);

      const orgSlug = (orgRow[0]?.code || 'campus')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 18) || 'campus';
      const studentRole = studentRoleRow[0];

      const existingRolls = new Set(existingStudents.map((s) => s.roll.trim().toLowerCase()));
      const existingIdCodes = new Set(existingStudents.map((s) => s.studentIdCode.trim().toLowerCase()));
      const existingOrgEmails = new Set(existingStudents.map((s) => s.email.trim().toLowerCase()));
      const existingProfileEmails = new Set(existingProfiles.map((p) => p.email.trim().toLowerCase()));

      const courseLookup = new Map<string, { id: string; name: string; departmentId: string | null }>();
      for (const c of orgCourses) {
        courseLookup.set(c.name.trim().toLowerCase(), { id: c.id, name: c.name, departmentId: c.departmentId });
        if (c.code) {
          courseLookup.set(c.code.trim().toLowerCase(), { id: c.id, name: c.name, departmentId: c.departmentId });
        }
      }
      const deptLookup = new Map<string, { id: string; name: string }>();
      for (const dep of orgDepartments) {
        deptLookup.set(dep.name.trim().toLowerCase(), { id: dep.id, name: dep.name });
        if (dep.code) deptLookup.set(dep.code.trim().toLowerCase(), { id: dep.id, name: dep.name });
      }

      const created: Array<{
        rowNumber: number;
        studentId: string;
        fullName: string;
        collegeRollNumber: string;
        studentIdCode: string;
        departmentOrCourse: string;
        email: string;
        loginId: string;
        password: string;
        passwordAutoGenerated: boolean;
        phone: string;
        cardNumber: string | null;
      }> = [];

      const failed: Array<{
        rowNumber: number;
        fullName: string;
        collegeRollNumber: string;
        email: string;
        reason: string;
      }> = [];

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      for (let i = 0; i < inputRows.length; i++) {
        const rowNumber = i + 1;
        const raw = inputRows[i];
        const fullName = (raw.fullName || '').trim();
        const roll = (raw.collegeRollNumber || '').trim();
        const rawStudentIdCode = (raw.studentIdCode || '').trim();
        const rawEmail = (raw.email || '').trim().toLowerCase();
        const rawPhone = (raw.phone || '').trim();
        const rawPassword = (raw.password || '').trim();
        const deptCourseText = (raw.departmentOrCourse || '').trim();

        // Validation
        if (fullName.length < 2) {
          failed.push({
            rowNumber,
            fullName,
            collegeRollNumber: roll,
            email: rawEmail,
            reason: 'Student full name is required (min 2 characters).',
          });
          continue;
        }
        if (roll.length < 1) {
          failed.push({
            rowNumber,
            fullName,
            collegeRollNumber: roll,
            email: rawEmail,
            reason: 'Roll No / Student ID is required.',
          });
          continue;
        }
        if (existingRolls.has(roll.toLowerCase())) {
          failed.push({
            rowNumber,
            fullName,
            collegeRollNumber: roll,
            email: rawEmail,
            reason: `Duplicate Roll No / Student ID "${roll}" already exists in this institution or earlier in this batch.`,
          });
          continue;
        }
        if (rawStudentIdCode && existingIdCodes.has(rawStudentIdCode.toLowerCase())) {
          failed.push({
            rowNumber,
            fullName,
            collegeRollNumber: roll,
            email: rawEmail,
            reason: `Duplicate Student ID Code "${rawStudentIdCode}" already exists.`,
          });
          continue;
        }
        if (rawEmail && !emailRegex.test(rawEmail)) {
          failed.push({
            rowNumber,
            fullName,
            collegeRollNumber: roll,
            email: rawEmail,
            reason: `Invalid email address "${rawEmail}".`,
          });
          continue;
        }
        if (rawEmail && (existingOrgEmails.has(rawEmail) || existingProfileEmails.has(rawEmail))) {
          failed.push({
            rowNumber,
            fullName,
            collegeRollNumber: roll,
            email: rawEmail,
            reason: `Duplicate email "${rawEmail}" is already registered.`,
          });
          continue;
        }
        if (rawPassword && rawPassword.length < 6) {
          failed.push({
            rowNumber,
            fullName,
            collegeRollNumber: roll,
            email: rawEmail,
            reason: 'Provided password must be at least 6 characters (or leave blank to auto-generate).',
          });
          continue;
        }

        // Resolve or generate unique login email if omitted
        let email = rawEmail;
        if (!email) {
          const cleanRoll = roll.toLowerCase().replace(/[^a-z0-9]/g, '') || `stu${Date.now()}${i}`;
          let candidate = `${cleanRoll}@${orgSlug}.qivora.edu`;
          let suffix = 1;
          while (existingOrgEmails.has(candidate) || existingProfileEmails.has(candidate)) {
            candidate = `${cleanRoll}${suffix}@${orgSlug}.qivora.edu`;
            suffix++;
          }
          email = candidate;
        }

        // Resolve Student ID Code uniquely
        let studentIdCode = rawStudentIdCode || roll.toUpperCase();
        if (existingIdCodes.has(studentIdCode.toLowerCase())) {
          studentIdCode = `STU-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
          while (existingIdCodes.has(studentIdCode.toLowerCase())) {
            studentIdCode = `STU-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
          }
        }

        // Resolve Course & Department from IDs or text label
        let resolvedCourseId: string | null = raw.courseId || defaultCourseId || null;
        let resolvedDepartmentId: string | null = raw.departmentId || null;
        let resolvedCourseLabel = deptCourseText;

        if (deptCourseText) {
          const matchedCourse = courseLookup.get(deptCourseText.toLowerCase());
          const matchedDept = deptLookup.get(deptCourseText.toLowerCase());
          if (matchedCourse) {
            resolvedCourseId = matchedCourse.id;
            if (!resolvedDepartmentId && matchedCourse.departmentId) {
              resolvedDepartmentId = matchedCourse.departmentId;
            }
            resolvedCourseLabel = matchedCourse.name;
          } else if (matchedDept) {
            resolvedDepartmentId = matchedDept.id;
            resolvedCourseLabel = matchedDept.name;
          } else {
            // Auto-create course so arbitrary department/course strings are preserved in DB
            try {
              const codeBase =
                deptCourseText
                  .replace(/[^A-Za-z0-9]/g, '')
                  .toUpperCase()
                  .slice(0, 8) || `CRS${Math.floor(100 + Math.random() * 900)}`;
              const [newCourse] = await db
                .insert(courses)
                .values({
                  organizationId: orgId,
                  name: deptCourseText,
                  code: `${codeBase}-${Math.floor(10 + Math.random() * 89)}`,
                  durationSemesters: 6,
                })
                .returning();
              resolvedCourseId = newCourse.id;
              courseLookup.set(deptCourseText.toLowerCase(), {
                id: newCourse.id,
                name: newCourse.name,
                departmentId: null,
              });
              resolvedCourseLabel = newCourse.name;
            } catch {
              // Keep label even if course insert hit race
            }
          }
        } else if (resolvedCourseId) {
          const found = orgCourses.find((c) => c.id === resolvedCourseId);
          if (found) {
            resolvedCourseLabel = found.name;
            if (!resolvedDepartmentId && found.departmentId) {
              resolvedDepartmentId = found.departmentId;
            }
          }
        }

        const passwordAutoGenerated = !rawPassword;
        const finalPassword = rawPassword || generateStrongPassword(10);
        const { salt, hash } = hashPassword(finalPassword);
        const phone = rawPhone || 'Not Provided';
        const fatherName = (raw.fatherName || '').trim() || 'Not Provided';

        try {
          const [profile] = await db
            .insert(profiles)
            .values({
              uid: `local_${generateSecureToken(12)}`,
              email,
              fullName,
              phone: rawPhone || null,
              passwordHash: hash,
              passwordSalt: salt,
              status: 'active',
            })
            .returning();

          const [student] = await db
            .insert(students)
            .values({
              organizationId: orgId,
              profileId: profile.id,
              studentIdCode,
              fullName,
              fatherName,
              collegeRollNumber: roll,
              courseId: resolvedCourseId,
              semesterId: raw.semesterId || defaultSemesterId || null,
              departmentId: resolvedDepartmentId,
              academicSessionId: raw.academicSessionId || defaultAcademicSessionId || null,
              phone,
              email,
              status: 'active',
            })
            .returning();

          if (studentRole) {
            await db
              .insert(organizationMembers)
              .values({
                organizationId: orgId,
                profileId: profile.id,
                roleId: studentRole.id,
                status: 'active',
                isDefault: true,
              })
              .onConflictDoNothing();
          }

          let cardNumber: string | null = null;
          if (autoGenerateId) {
            try {
              const issued = await issueDigitalIdForStudent({
                orgId,
                studentId: student.id,
                actorProfileId: req.profile!.id,
              });
              cardNumber = issued.card.cardNumber;
            } catch {
              // Proceed even if no published ID template exists yet
            }
          }

          existingRolls.add(roll.toLowerCase());
          existingIdCodes.add(studentIdCode.toLowerCase());
          existingOrgEmails.add(email);
          existingProfileEmails.add(email);

          created.push({
            rowNumber,
            studentId: student.id,
            fullName: student.fullName,
            collegeRollNumber: student.collegeRollNumber,
            studentIdCode: student.studentIdCode,
            departmentOrCourse: resolvedCourseLabel || 'General',
            email,
            loginId: email,
            password: finalPassword,
            passwordAutoGenerated,
            phone,
            cardNumber,
          });
        } catch (err) {
          console.error(`Bulk student row ${rowNumber} failed:`, err);
          failed.push({
            rowNumber,
            fullName,
            collegeRollNumber: roll,
            email,
            reason: 'Database uniqueness conflict (roll number, student ID, or email already exists).',
          });
        }
      }

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'students_bulk_registered',
        entityType: 'student',
        details: {
          totalRequested: inputRows.length,
          createdCount: created.length,
          failedCount: failed.length,
        },
      });

      res.status(201).json({
        created,
        failed,
        summary: {
          total: inputRows.length,
          createdCount: created.length,
          failedCount: failed.length,
        },
      });
    } catch (error) {
      console.error('Bulk register students failed:', error);
      res.status(500).json({ error: 'Unable to complete bulk student registration.' });
    }
  }
);

studentsAndIdsRouter.get(
  '/org/students/:id',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const [student] = await db
        .select()
        .from(students)
        .where(and(eq(students.id, req.params.id), eq(students.organizationId, orgId)))
        .limit(1);

      if (!student) return res.status(404).json({ error: 'Student not found.' });

      const [studentLoans, studentFines, studentAttendance, studentCards] = await Promise.all([
        db.select().from(loans).where(and(eq(loans.studentId, student.id), eq(loans.organizationId, orgId))).orderBy(desc(loans.issuedAt)),
        db.select().from(fines).where(and(eq(fines.studentId, student.id), eq(fines.organizationId, orgId))).orderBy(desc(fines.createdAt)),
        db.select().from(attendance).where(and(eq(attendance.studentId, student.id), eq(attendance.organizationId, orgId))).orderBy(desc(attendance.checkInAt)).limit(30),
        db
          .select({
            card: idCards,
            templateName: idTemplates.name,
            qrToken: qrTokens.token,
          })
          .from(idCards)
          .innerJoin(idTemplates, eq(idCards.templateId, idTemplates.id))
          .leftJoin(
            qrTokens,
            and(eq(qrTokens.entityType, 'student_id'), eq(qrTokens.entityId, idCards.id))
          )
          .where(and(eq(idCards.studentId, student.id), eq(idCards.organizationId, orgId)))
          .orderBy(desc(idCards.createdAt)),
      ]);

      const [linkedFounder] = await db
        .select({
          id: founderIdentities.id,
          founderNumber: founderIdentities.founderNumber,
          designation: founderIdentities.designation,
          editionName: founderIdentities.editionName,
          status: founderIdentities.status,
          collegeLinkStatus: founderIdentities.collegeLinkStatus,
          collegeApprovedAt: founderIdentities.collegeApprovedAt,
        })
        .from(founderIdentities)
        .where(
          and(
            eq(founderIdentities.linkedStudentId, student.id),
            eq(founderIdentities.linkedOrganizationId, orgId)
          )
        )
        .limit(1);

      res.json({
        student,
        founderLink: linkedFounder || null,
        loans: studentLoans,
        fines: studentFines,
        attendance: studentAttendance,
        idHistory: studentCards.map((c) => ({
          ...c.card,
          templateName: c.templateName,
          qrToken: c.qrToken,
        })),
      });
    } catch (error) {
      console.error('Get student detail failed:', error);
      res.status(500).json({ error: 'Unable to load student profile.' });
    }
  }
);

// Exclusive Super Admin Security Boundary:
// College Admins and Librarians must NEVER assign, approve, modify, or revoke Founder status.
studentsAndIdsRouter.patch(
  '/org/students/:id/founder-link',
  requireAuth,
  async (_req: AuthRequest, res) => {
    return res.status(403).json({
      error: 'Access denied. Founder status allocation and management are exclusively restricted to Platform Super Admin.',
    });
  }
);


studentsAndIdsRouter.patch(
  '/org/students/:id/status',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        status: z.enum(['active', 'suspended', 'graduated', 'archived']),
        reason: z.string().min(3),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Status and reason (min 3 characters) are required.' });
      }

      const [updated] = await db
        .update(students)
        .set({
          status: parsed.data.status,
          statusReason: parsed.data.reason.trim(),
          archivedAt: parsed.data.status === 'archived' ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(and(eq(students.id, req.params.id), eq(students.organizationId, req.orgId!)))
        .returning();

      if (!updated) return res.status(404).json({ error: 'Student not found.' });

      if (updated.profileId) {
        await createNotification({
          organizationId: req.orgId!,
          recipientProfileId: updated.profileId,
          type: parsed.data.status === 'suspended' ? 'account_suspended' : 'account_reactivated',
          title: `Library Account ${parsed.data.status === 'active' ? 'Reactivated' : 'Status Updated'}`,
          message: `Your student library account status is now "${parsed.data.status}". Reason: ${parsed.data.reason}`,
          entityType: 'student',
          entityId: updated.id,
        });
      }

      await logAudit({
        organizationId: req.orgId!,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'student_status_changed',
        entityType: 'student',
        entityId: updated.id,
        details: { status: parsed.data.status, reason: parsed.data.reason },
      });

      res.json({ student: updated });
    } catch (error) {
      console.error('Update student status failed:', error);
      res.status(500).json({ error: 'Unable to update student status.' });
    }
  }
);

// ============================================================================
// ID TEMPLATE STUDIO (College Admin write, Staff read)
// ============================================================================

studentsAndIdsRouter.get(
  '/org/id-templates',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const templates = await db
        .select()
        .from(idTemplates)
        .where(eq(idTemplates.organizationId, req.orgId!))
        .orderBy(desc(idTemplates.updatedAt));
      res.json({ templates });
    } catch (error) {
      console.error('List ID templates failed:', error);
      res.status(500).json({ error: 'Unable to load ID templates.' });
    }
  }
);

studentsAndIdsRouter.post(
  '/org/id-templates',
  requireAuth,
  requireOrgRole(['college_admin']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        name: z.string().min(2),
        description: z.string().optional().nullable(),
        presetKey: z.string().default('custom'),
        frontConfig: z.record(z.string(), z.unknown()),
        backConfig: z.record(z.string(), z.unknown()),
        backgroundImageUrl: z.string().optional().nullable(),
        status: z.enum(['draft', 'published', 'archived']).default('published'),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid template configuration.' });

      const orgId = req.orgId!;
      const slug = `${parsed.data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

      const [created] = await db
        .insert(idTemplates)
        .values({
          organizationId: orgId,
          name: parsed.data.name.trim(),
          slug,
          presetKey: parsed.data.presetKey,
          description: parsed.data.description || null,
          isSystemPreset: false,
          status: parsed.data.status,
          currentVersion: 1,
          frontConfig: parsed.data.frontConfig,
          backConfig: parsed.data.backConfig,
          lockedFields: [...LOCKED_OFFICIAL_FIELDS],
          backgroundImageUrl: parsed.data.backgroundImageUrl || null,
          createdByProfileId: req.profile!.id,
        })
        .returning();

      await db.insert(idTemplateVersions).values({
        templateId: created.id,
        organizationId: orgId,
        versionNumber: 1,
        frontConfig: parsed.data.frontConfig,
        backConfig: parsed.data.backConfig,
        backgroundImageUrl: parsed.data.backgroundImageUrl || null,
        changeNote: 'Created in ID Template Studio',
        createdByProfileId: req.profile!.id,
      });

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'id_template_created',
        entityType: 'id_template',
        entityId: created.id,
        details: { name: created.name },
      });

      res.status(201).json({ template: created });
    } catch (error) {
      console.error('Create ID template failed:', error);
      res.status(500).json({ error: 'Unable to create ID template.' });
    }
  }
);

studentsAndIdsRouter.patch(
  '/org/id-templates/:id',
  requireAuth,
  requireOrgRole(['college_admin']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const [existing] = await db
        .select()
        .from(idTemplates)
        .where(and(eq(idTemplates.id, req.params.id), eq(idTemplates.organizationId, orgId)))
        .limit(1);

      if (!existing) return res.status(404).json({ error: 'Template not found.' });

      const nextVersion = existing.currentVersion + 1;
      const frontConfig = req.body.frontConfig || existing.frontConfig;
      const backConfig = req.body.backConfig || existing.backConfig;
      const backgroundImageUrl =
        req.body.backgroundImageUrl !== undefined
          ? req.body.backgroundImageUrl
          : existing.backgroundImageUrl;

      const [updated] = await db
        .update(idTemplates)
        .set({
          name: req.body.name?.trim() || existing.name,
          description: req.body.description !== undefined ? req.body.description : existing.description,
          status: req.body.status || existing.status,
          frontConfig,
          backConfig,
          backgroundImageUrl,
          currentVersion: nextVersion,
          updatedAt: new Date(),
        })
        .where(eq(idTemplates.id, existing.id))
        .returning();

      await db.insert(idTemplateVersions).values({
        templateId: updated.id,
        organizationId: orgId,
        versionNumber: nextVersion,
        frontConfig,
        backConfig,
        backgroundImageUrl,
        changeNote: req.body.changeNote || `Updated to version ${nextVersion}`,
        createdByProfileId: req.profile!.id,
      });

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'id_template_updated',
        entityType: 'id_template',
        entityId: updated.id,
        details: { version: nextVersion, name: updated.name },
      });

      res.json({ template: updated });
    } catch (error) {
      console.error('Update ID template failed:', error);
      res.status(500).json({ error: 'Unable to save ID template.' });
    }
  }
);

studentsAndIdsRouter.post(
  '/org/id-templates/:id/duplicate',
  requireAuth,
  requireOrgRole(['college_admin']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const [source] = await db
        .select()
        .from(idTemplates)
        .where(and(eq(idTemplates.id, req.params.id), eq(idTemplates.organizationId, orgId)))
        .limit(1);

      if (!source) return res.status(404).json({ error: 'Source template not found.' });

      const copyName = `${source.name} (Copy)`;
      const slug = `${source.slug}-copy-${Math.floor(1000 + Math.random() * 9000)}`;

      const [copy] = await db
        .insert(idTemplates)
        .values({
          organizationId: orgId,
          name: copyName,
          slug,
          presetKey: source.presetKey,
          description: source.description,
          isSystemPreset: false,
          status: 'draft',
          currentVersion: 1,
          frontConfig: source.frontConfig,
          backConfig: source.backConfig,
          lockedFields: source.lockedFields,
          backgroundImageUrl: source.backgroundImageUrl,
          createdByProfileId: req.profile!.id,
        })
        .returning();

      res.status(201).json({ template: copy });
    } catch (error) {
      console.error('Duplicate template failed:', error);
      res.status(500).json({ error: 'Unable to duplicate template.' });
    }
  }
);

// ============================================================================
// COURSE-WISE, SEMESTER-WISE & APPLY-TO-ALL ID TEMPLATE ASSIGNMENTS (College Admin ONLY)
// ============================================================================

const assignmentFilterSchema = z.object({
  templateId: z.string().uuid(),
  scopeType: z.enum([
    'all_existing',
    'all_new',
    'course',
    'semester',
    'academic_session',
    'student_category',
    'individual_student',
    'combined',
  ]),
  courseId: z.string().uuid().optional().nullable(),
  semesterId: z.string().uuid().optional().nullable(),
  academicSessionId: z.string().uuid().optional().nullable(),
  studentCategoryId: z.string().uuid().optional().nullable(),
  studentIds: z.array(z.string().uuid()).optional(),
  applyToNewStudents: z.boolean().optional().default(true),
  updateExistingCards: z.boolean().optional().default(true),
});

async function queryTargetStudents(orgId: string, d: z.infer<typeof assignmentFilterSchema>) {
  if (d.scopeType === 'all_new') {
    return [];
  }

  const conditions = [eq(students.organizationId, orgId), eq(students.status, 'active')];

  if (d.scopeType === 'individual_student' && d.studentIds?.length) {
    conditions.push(inArray(students.id, d.studentIds));
  } else if (d.scopeType !== 'all_existing') {
    if (d.courseId) conditions.push(eq(students.courseId, d.courseId));
    if (d.semesterId) conditions.push(eq(students.semesterId, d.semesterId));
    if (d.academicSessionId) conditions.push(eq(students.academicSessionId, d.academicSessionId));
    if (d.studentCategoryId) conditions.push(eq(students.studentCategoryId, d.studentCategoryId));
  }

  const matched = await db
    .select({
      id: students.id,
      fullName: students.fullName,
      studentIdCode: students.studentIdCode,
      collegeRollNumber: students.collegeRollNumber,
      courseName: courses.name,
      semesterName: semesters.name,
    })
    .from(students)
    .leftJoin(courses, eq(students.courseId, courses.id))
    .leftJoin(semesters, eq(students.semesterId, semesters.id))
    .where(and(...conditions));

  return matched;
}

function getScopePriority(scopeType: string): number {
  switch (scopeType) {
    case 'individual_student':
      return 100;
    case 'combined':
      return 70;
    case 'semester':
      return 50;
    case 'course':
      return 30;
    case 'student_category':
      return 25;
    case 'academic_session':
      return 20;
    default:
      return 10;
  }
}

studentsAndIdsRouter.get(
  '/org/id-assignments',
  requireAuth,
  requireOrgRole(['college_admin']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const rows = await db
        .select({
          assignment: idTemplateAssignments,
          templateName: idTemplates.name,
          courseName: courses.name,
          semesterName: semesters.name,
          sessionName: academicSessions.name,
          categoryName: studentCategories.name,
          studentName: students.fullName,
        })
        .from(idTemplateAssignments)
        .innerJoin(idTemplates, eq(idTemplateAssignments.templateId, idTemplates.id))
        .leftJoin(courses, eq(idTemplateAssignments.courseId, courses.id))
        .leftJoin(semesters, eq(idTemplateAssignments.semesterId, semesters.id))
        .leftJoin(academicSessions, eq(idTemplateAssignments.academicSessionId, academicSessions.id))
        .leftJoin(studentCategories, eq(idTemplateAssignments.studentCategoryId, studentCategories.id))
        .leftJoin(students, eq(idTemplateAssignments.studentId, students.id))
        .where(eq(idTemplateAssignments.organizationId, orgId))
        .orderBy(desc(idTemplateAssignments.createdAt));

      res.json({
        assignments: rows.map((r) => ({
          ...r.assignment,
          templateName: r.templateName,
          courseName: r.courseName,
          semesterName: r.semesterName,
          sessionName: r.sessionName,
          categoryName: r.categoryName,
          studentName: r.studentName,
        })),
      });
    } catch (error) {
      console.error('List ID assignments failed:', error);
      res.status(500).json({ error: 'Unable to load template assignments.' });
    }
  }
);

studentsAndIdsRouter.post(
  '/org/id-assignments/preview',
  requireAuth,
  requireOrgRole(['college_admin']),
  async (req: AuthRequest, res) => {
    try {
      const parsed = assignmentFilterSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid assignment preview filter.' });
      }
      const d = parsed.data;
      const orgId = req.orgId!;

      const [targetTemplate] = await db
        .select()
        .from(idTemplates)
        .where(and(eq(idTemplates.id, d.templateId), eq(idTemplates.organizationId, orgId)))
        .limit(1);
      if (!targetTemplate) return res.status(404).json({ error: 'Selected template not found.' });

      const matchedStudents = await queryTargetStudents(orgId, d);
      const studentIds = matchedStudents.map((s) => s.id);

      let existingCards: Array<{ studentId: string; templateName: string; templateId: string }> = [];
      if (studentIds.length > 0) {
        existingCards = await db
          .select({
            studentId: idCards.studentId,
            templateId: idCards.templateId,
            templateName: idTemplates.name,
          })
          .from(idCards)
          .innerJoin(idTemplates, eq(idCards.templateId, idTemplates.id))
          .where(
            and(
              eq(idCards.organizationId, orgId),
              eq(idCards.status, 'active'),
              inArray(idCards.studentId, studentIds)
            )
          );
      }

      const cardMap = new Map(existingCards.map((c) => [c.studentId, c]));
      const studentsWithCurrentTemplate = matchedStudents.map((s) => ({
        ...s,
        currentTemplateName: cardMap.get(s.id)?.templateName || 'No Active ID Yet',
        willReplaceExisting: Boolean(cardMap.get(s.id) && cardMap.get(s.id)!.templateId !== targetTemplate.id),
      }));

      res.json({
        targetTemplate: { id: targetTemplate.id, name: targetTemplate.name },
        affectedCount: studentsWithCurrentTemplate.length,
        existingCardsChanging: studentsWithCurrentTemplate.filter((s) => s.willReplaceExisting).length,
        applyToNewStudents: d.applyToNewStudents,
        priority: getScopePriority(d.scopeType),
        previewStudents: studentsWithCurrentTemplate.slice(0, 50),
      });
    } catch (error) {
      console.error('Preview assignment failed:', error);
      res.status(500).json({ error: 'Unable to calculate affected students.' });
    }
  }
);

studentsAndIdsRouter.post(
  '/org/id-assignments/apply',
  requireAuth,
  requireOrgRole(['college_admin']),
  async (req: AuthRequest, res) => {
    try {
      const parsed = assignmentFilterSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid assignment request.' });
      }
      const d = parsed.data;
      const orgId = req.orgId!;

      const [targetTemplate] = await db
        .select()
        .from(idTemplates)
        .where(and(eq(idTemplates.id, d.templateId), eq(idTemplates.organizationId, orgId)))
        .limit(1);
      if (!targetTemplate) return res.status(404).json({ error: 'Selected template not found.' });

      const matchedStudents = await queryTargetStudents(orgId, d);
      const priority = getScopePriority(d.scopeType);

      const snapshot: Array<{ cardId: string; previousTemplateId: string; previousVersion: number }> = [];
      let updatedCardsCount = 0;

      await db.transaction(async (tx) => {
        if (d.updateExistingCards && matchedStudents.length > 0) {
          const ids = matchedStudents.map((s) => s.id);
          const existingActiveCards = await tx
            .select()
            .from(idCards)
            .where(
              and(
                eq(idCards.organizationId, orgId),
                eq(idCards.status, 'active'),
                inArray(idCards.studentId, ids)
              )
            );

          for (const card of existingActiveCards) {
            snapshot.push({
              cardId: card.id,
              previousTemplateId: card.templateId,
              previousVersion: card.templateVersion,
            });
            await tx
              .update(idCards)
              .set({
                templateId: targetTemplate.id,
                templateVersion: targetTemplate.currentVersion,
                updatedAt: new Date(),
              })
              .where(eq(idCards.id, card.id));
            updatedCardsCount++;
          }
        }

        const primaryStudentId =
          d.scopeType === 'individual_student' && d.studentIds?.length === 1
            ? d.studentIds[0]
            : null;

        await tx.insert(idTemplateAssignments).values({
          organizationId: orgId,
          templateId: targetTemplate.id,
          scopeType: d.scopeType,
          courseId: d.courseId || null,
          semesterId: d.semesterId || null,
          academicSessionId: d.academicSessionId || null,
          studentCategoryId: d.studentCategoryId || null,
          studentId: primaryStudentId,
          priority,
          applyToNewStudents: d.applyToNewStudents,
          affectedCount: matchedStudents.length,
          previousAssignmentSnapshot: snapshot,
          status: 'active',
          assignedByProfileId: req.profile!.id,
        });
      });

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'id_template_assigned',
        entityType: 'id_template_assignment',
        entityId: targetTemplate.id,
        details: {
          templateName: targetTemplate.name,
          scopeType: d.scopeType,
          affectedCount: matchedStudents.length,
          updatedCardsCount,
          priority,
        },
      });

      res.status(201).json({
        message: `Assigned "${targetTemplate.name}" across ${matchedStudents.length} student(s) (${updatedCardsCount} active ID cards updated).`,
        affectedCount: matchedStudents.length,
        updatedCardsCount,
      });
    } catch (error) {
      console.error('Apply ID template assignment failed:', error);
      res.status(500).json({ error: 'Unable to apply template assignment.' });
    }
  }
);

studentsAndIdsRouter.post(
  '/org/id-assignments/:id/reverse',
  requireAuth,
  requireOrgRole(['college_admin']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const [assignment] = await db
        .select()
        .from(idTemplateAssignments)
        .where(
          and(
            eq(idTemplateAssignments.id, req.params.id),
            eq(idTemplateAssignments.organizationId, orgId)
          )
        )
        .limit(1);

      if (!assignment) return res.status(404).json({ error: 'Assignment record not found.' });
      if (assignment.status === 'reversed') {
        return res.status(400).json({ error: 'This assignment has already been reversed.' });
      }

      const snapshot = (assignment.previousAssignmentSnapshot || []) as Array<{
        cardId: string;
        previousTemplateId: string;
        previousVersion: number;
      }>;

      await db.transaction(async (tx) => {
        for (const item of snapshot) {
          await tx
            .update(idCards)
            .set({
              templateId: item.previousTemplateId,
              templateVersion: item.previousVersion,
              updatedAt: new Date(),
            })
            .where(and(eq(idCards.id, item.cardId), eq(idCards.organizationId, orgId)));
        }

        await tx
          .update(idTemplateAssignments)
          .set({ status: 'reversed' })
          .where(eq(idTemplateAssignments.id, assignment.id));
      });

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'id_template_assignment_reversed',
        entityType: 'id_template_assignment',
        entityId: assignment.id,
        details: { restoredCards: snapshot.length },
      });

      res.json({ message: `Assignment reversed. Restored ${snapshot.length} ID card(s).` });
    } catch (error) {
      console.error('Reverse assignment failed:', error);
      res.status(500).json({ error: 'Unable to reverse assignment.' });
    }
  }
);

// ============================================================================
// DIGITAL ID CARD REGISTRY (Generate, Regenerate, Status Changes, Revoke)
// ============================================================================

studentsAndIdsRouter.get(
  '/org/id-cards',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const [cards, brandingRow] = await Promise.all([
        db
          .select({
            card: idCards,
            student: students,
            template: idTemplates,
            courseName: courses.name,
            semesterName: semesters.name,
            sessionName: academicSessions.name,
            qrToken: qrTokens.token,
            qrIsActive: qrTokens.isActive,
          })
          .from(idCards)
          .innerJoin(students, eq(idCards.studentId, students.id))
          .innerJoin(idTemplates, eq(idCards.templateId, idTemplates.id))
          .leftJoin(courses, eq(students.courseId, courses.id))
          .leftJoin(semesters, eq(students.semesterId, semesters.id))
          .leftJoin(academicSessions, eq(students.academicSessionId, academicSessions.id))
          .leftJoin(
            qrTokens,
            and(eq(qrTokens.entityType, 'student_id'), eq(qrTokens.entityId, idCards.id))
          )
          .where(eq(idCards.organizationId, orgId))
          .orderBy(desc(idCards.createdAt)),
        db.select().from(organizationBranding).where(eq(organizationBranding.organizationId, orgId)).limit(1),
      ]);

      res.json({
        branding: brandingRow[0] || null,
        idCards: cards.map((c) => ({
          ...c.card,
          student: {
            ...c.student,
            courseName: c.courseName,
            semesterName: c.semesterName,
            sessionName: c.sessionName,
          },
          template: c.template,
          qrToken: c.qrToken,
          qrIsActive: c.qrIsActive,
        })),
      });
    } catch (error) {
      console.error('List ID cards failed:', error);
      res.status(500).json({ error: 'Unable to load Digital ID cards.' });
    }
  }
);

studentsAndIdsRouter.post(
  '/org/id-cards/generate',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const studentId = req.body?.studentId;
      const templateId = req.body?.templateId || null;
      if (!studentId) return res.status(400).json({ error: 'studentId is required.' });

      const result = await issueDigitalIdForStudent({
        orgId: req.orgId!,
        studentId,
        templateId: req.orgRole === 'college_admin' ? templateId : null,
        actorProfileId: req.profile!.id,
      });

      await logAudit({
        organizationId: req.orgId!,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'digital_id_generated',
        entityType: 'id_card',
        entityId: result.card.id,
        details: { studentId, cardNumber: result.card.cardNumber, template: result.template.name },
      });

      res.status(201).json({ card: result.card, qrToken: result.qrToken });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unable to generate Digital ID.';
      res.status(400).json({ error: msg });
    }
  }
);

studentsAndIdsRouter.patch(
  '/org/id-cards/:id/status',
  requireAuth,
  requireOrgRole(['college_admin', 'librarian']),
  async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        status: z.enum(['pending', 'active', 'suspended', 'blocked', 'expired', 'revoked']),
        reason: z.string().min(3, 'A clear reason is required for every ID status change.'),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid status change.' });
      }

      const orgId = req.orgId!;
      const [existing] = await db
        .select()
        .from(idCards)
        .where(and(eq(idCards.id, req.params.id), eq(idCards.organizationId, orgId)))
        .limit(1);

      if (!existing) return res.status(404).json({ error: 'ID card not found.' });

      const isNowActive = parsed.data.status === 'active';

      const [updated] = await db.transaction(async (tx) => {
        const [card] = await tx
          .update(idCards)
          .set({
            status: parsed.data.status,
            statusReason: parsed.data.reason.trim(),
            revokedAt: parsed.data.status === 'revoked' ? new Date() : existing.revokedAt,
            revokedByProfileId:
              parsed.data.status === 'revoked' ? req.profile!.id : existing.revokedByProfileId,
            updatedAt: new Date(),
          })
          .where(eq(idCards.id, existing.id))
          .returning();

        await tx
          .update(qrTokens)
          .set({
            isActive: isNowActive,
            revokedAt: isNowActive ? null : new Date(),
            revokedReason: isNowActive ? null : parsed.data.reason.trim(),
          })
          .where(and(eq(qrTokens.entityType, 'student_id'), eq(qrTokens.entityId, existing.id)));

        return [card];
      });

      await logAudit({
        organizationId: orgId,
        actorProfile: req.profile,
        actorRole: req.orgRole,
        action: 'digital_id_status_changed',
        entityType: 'id_card',
        entityId: updated.id,
        details: {
          cardNumber: updated.cardNumber,
          previousStatus: existing.status,
          newStatus: parsed.data.status,
          reason: parsed.data.reason.trim(),
        },
      });

      res.json({ card: updated });
    } catch (error) {
      console.error('Update ID card status failed:', error);
      res.status(500).json({ error: 'Unable to update ID card status.' });
    }
  }
);

// ============================================================================
// STUDENT SELF-SERVICE ID BACKGROUND CUSTOMIZATION (Strictly Admin-Gated)
// ============================================================================

studentsAndIdsRouter.patch(
  '/student/my-id/customize',
  requireAuth,
  requireOrgRole(['student']),
  async (req: AuthRequest, res) => {
    try {
      const orgId = req.orgId!;
      const [branding] = await db
        .select()
        .from(organizationBranding)
        .where(eq(organizationBranding.organizationId, orgId))
        .limit(1);

      if (!branding?.allowStudentIdCustomization) {
        return res.status(403).json({
          error: 'Student ID customization is disabled by your College Administrator.',
        });
      }

      const [student] = await db
        .select()
        .from(students)
        .where(and(eq(students.organizationId, orgId), eq(students.profileId, req.profile!.id)))
        .limit(1);
      if (!student) return res.status(404).json({ error: 'Student record not found.' });

      const [activeCard] = await db
        .select()
        .from(idCards)
        .where(and(eq(idCards.studentId, student.id), eq(idCards.status, 'active')))
        .orderBy(desc(idCards.createdAt))
        .limit(1);

      if (!activeCard) return res.status(404).json({ error: 'No active Digital ID found.' });

      const schema = z.object({
        customBgUrl: z.string().optional().nullable(),
        customBgSettings: z
          .object({
            zoom: z.number().min(0.5).max(3).default(1),
            positionX: z.number().min(0).max(100).default(50),
            positionY: z.number().min(0).max(100).default(50),
            fit: z.enum(['cover', 'contain', 'fill']).default('cover'),
            overlayOpacity: z.number().min(0).max(0.85).default(0.25),
          })
          .optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid customization settings.' });

      if (parsed.data.customBgUrl && !branding.allowStudentBgUpload) {
        return res.status(403).json({
          error: 'Background image uploads are not enabled by your College Administrator.',
        });
      }

      // Strictly update ONLY custom background fields — NEVER touch official template, identity, QR, or branding
      const [updated] = await db
        .update(idCards)
        .set({
          customBgUrl:
            parsed.data.customBgUrl !== undefined ? parsed.data.customBgUrl : activeCard.customBgUrl,
          customBgSettings: parsed.data.customBgSettings || activeCard.customBgSettings,
          updatedAt: new Date(),
        })
        .where(eq(idCards.id, activeCard.id))
        .returning();

      await db.insert(idDesigns).values({
        organizationId: orgId,
        studentId: student.id,
        idCardId: activeCard.id,
        cropConfig: parsed.data.customBgSettings || {},
      });

      res.json({ card: updated });
    } catch (error) {
      console.error('Student ID customize failed:', error);
      res.status(500).json({ error: 'Unable to save ID background customization.' });
    }
  }
);
