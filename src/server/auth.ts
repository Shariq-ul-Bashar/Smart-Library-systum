import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  auditLogs,
  notifications,
  organizationMembers,
  organizations,
  profiles,
  roles,
} from '../db/schema.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
import { ensureSystemBootstrapped } from './bootstrap.ts';
import { verifySupabaseAccessToken } from './supabase-admin.ts';

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto
    .createHash('sha256')
    .update(`${process.env.SQL_DB_NAME || 'qivora'}-qivora-session-v1`)
    .digest('hex');

export function hashPassword(password: string, existingSalt?: string) {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const derived = crypto.scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expectedHash, 'hex');
  if (derived.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(derived, expectedBuf);
}

export function generateSecureToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function signSessionToken(payload: { profileId: string; uid: string; email: string }): string {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 7 days
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `qiv.${body}.${sig}`;
}

export function verifySessionToken(
  token: string
): { profileId: string; uid: string; email: string; exp: number } | null {
  if (!token.startsWith('qiv.') && !token.startsWith('shx.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, body, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export interface MembershipSummary {
  membershipId: string;
  organizationId: string;
  organizationName: string;
  organizationCode: string;
  organizationStatus: string;
  roleSlug: string;
  roleName: string;
  status: string;
  isDefault: boolean;
}

export interface AuthRequest extends Request {
  profile?: typeof profiles.$inferSelect;
  memberships?: MembershipSummary[];
  orgId?: string;
  orgRole?: string;
}

export async function loadProfileMemberships(profileId: string): Promise<MembershipSummary[]> {
  const rows = await db
    .select({
      membershipId: organizationMembers.id,
      organizationId: organizationMembers.organizationId,
      organizationName: organizations.name,
      organizationCode: organizations.code,
      organizationStatus: organizations.status,
      roleSlug: roles.slug,
      roleName: roles.name,
      status: organizationMembers.status,
      isDefault: organizationMembers.isDefault,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .innerJoin(roles, eq(organizationMembers.roleId, roles.id))
    .where(and(eq(organizationMembers.profileId, profileId), eq(organizationMembers.status, 'active')));

  return rows;
}

async function syncFirebaseProfile(uid: string, email: string, name?: string, picture?: string) {
  const normalizedEmail = email.toLowerCase().trim();

  // Check if a profile already exists by email (e.g., created by an admin before first Google Sign-In)
  const existingByEmail = await db
    .select()
    .from(profiles)
    .where(eq(profiles.email, normalizedEmail))
    .limit(1);

  if (existingByEmail.length > 0) {
    const existing = existingByEmail[0];
    const [updated] = await db
      .update(profiles)
      .set({
        uid,
        avatarUrl: existing.avatarUrl || picture || null,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, existing.id))
      .returning();
    return updated;
  }

  // Determine whether this is the very first platform owner bootstrap
  const existingAdmins = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.isSuperAdmin, true))
    .limit(1);
  const shouldBeSuperAdmin = existingAdmins.length === 0;

  const [upserted] = await db
    .insert(profiles)
    .values({
      uid,
      email: normalizedEmail,
      fullName: name || normalizedEmail.split('@')[0],
      avatarUrl: picture || null,
      isSuperAdmin: shouldBeSuperAdmin,
      status: 'active',
      lastLoginAt: new Date(),
    })
    .onConflictDoUpdate({
      target: profiles.uid,
      set: {
        email: normalizedEmail,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();

  return upserted;
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await ensureSystemBootstrapped();
  } catch (err) {
    console.error('Bootstrap error:', err);
    return res.status(503).json({ error: 'Database initialization unavailable. Please retry.' });
  }

  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : queryToken;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }

  try {
    let profile: typeof profiles.$inferSelect | undefined;

    if (token.startsWith('qiv.') || token.startsWith('shx.')) {
      const decoded = verifySessionToken(token);
      if (!decoded) {
        return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
      }
      const rows = await db
        .select()
        .from(profiles)
        .where(eq(profiles.id, decoded.profileId))
        .limit(1);
      profile = rows[0];
    } else {
      // Try Supabase Auth JWT first if Supabase is configured, otherwise verify Firebase Auth token
      const sbUser = await verifySupabaseAccessToken(token);
      if (sbUser) {
        profile = await syncFirebaseProfile(
          sbUser.uid,
          sbUser.email,
          sbUser.fullName,
          sbUser.avatarUrl
        );
      } else {
        const decodedFirebase = await adminAuth.verifyIdToken(token);
        if (!decodedFirebase.email) {
          return res.status(401).json({ error: 'Verified email is required to sign in.' });
        }
        profile = await syncFirebaseProfile(
          decodedFirebase.uid,
          decodedFirebase.email,
          decodedFirebase.name,
          decodedFirebase.picture
        );
      }
    }

    if (!profile) {
      return res.status(401).json({ error: 'Account not found.' });
    }
    if (profile.status !== 'active') {
      return res.status(403).json({ error: 'This account has been suspended. Contact your administrator.' });
    }

    req.profile = profile;
    req.memberships = await loadProfileMemberships(profile.id);
    next();
  } catch (error) {
    console.error('Authentication verification failed:', error);
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
};

export const requireSuperAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.profile?.isSuperAdmin) {
    return res.status(403).json({
      error: 'Access denied. Platform Super Admin privileges are required for this action.',
    });
  }
  next();
};

export function requireOrgRole(allowedRoles: Array<'college_admin' | 'librarian' | 'student'>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const headerOrgId =
      (req.headers['x-organization-id'] as string | undefined) ||
      (req.params.orgId as string | undefined) ||
      (req.query.organizationId as string | undefined);

    if (!headerOrgId) {
      return res.status(400).json({ error: 'Organization context (x-organization-id) is required.' });
    }

    const memberships = req.memberships || [];
    const matching = memberships.find(
      (m) =>
        m.organizationId === headerOrgId &&
        m.status === 'active' &&
        allowedRoles.includes(m.roleSlug as 'college_admin' | 'librarian' | 'student')
    );

    if (!matching) {
      return res.status(403).json({
        error: 'Access denied. You do not hold an authorized role for this institution.',
      });
    }

    if (matching.organizationStatus !== 'active') {
      return res.status(403).json({
        error: `Institution access is currently ${matching.organizationStatus}. Contact QIVORA support.`,
      });
    }

    req.orgId = matching.organizationId;
    req.orgRole = matching.roleSlug;
    next();
  };
}

export async function logAudit(params: {
  organizationId?: string | null;
  actorProfile?: typeof profiles.$inferSelect | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}) {
  try {
    await db.insert(auditLogs).values({
      organizationId: params.organizationId || null,
      actorProfileId: params.actorProfile?.id || null,
      actorEmail: params.actorProfile?.email || 'system',
      actorRole: params.actorRole || (params.actorProfile?.isSuperAdmin ? 'platform_super_admin' : 'unknown'),
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId || null,
      details: params.details || {},
      ipAddress: params.ipAddress || null,
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

export async function createNotification(params: {
  organizationId?: string | null;
  recipientProfileId: string;
  type: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
}) {
  try {
    await db.insert(notifications).values({
      organizationId: params.organizationId || null,
      recipientProfileId: params.recipientProfileId,
      type: params.type,
      title: params.title,
      message: params.message,
      entityType: params.entityType || null,
      entityId: params.entityId || null,
    });
  } catch (err) {
    console.error('Failed to create notification:', err);
  }
}
