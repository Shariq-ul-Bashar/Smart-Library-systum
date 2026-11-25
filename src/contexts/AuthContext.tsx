import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  browserLocalPersistence,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { setApiOrganizationId } from '../lib/api.ts';
import { auth, formatFirebaseAuthError, googleAuthProvider } from '../lib/firebase.ts';
import { hydrateCurrentFirebaseSession } from '../lib/firebase-backend/auth-and-platform.ts';

export interface AuthUser {
  id: string;
  uid: string;
  email: string;
  fullName: string;
  phone?: string | null;
  avatarUrl?: string | null;
  isSuperAdmin: boolean;
  mustChangePassword?: boolean;
  status: string;
}

export interface OrganizationMembership {
  membershipId: string;
  organizationId: string;
  organizationName: string;
  organizationCode: string;
  organizationStatus: string;
  roleSlug: 'college_admin' | 'librarian' | 'student';
  roleName: string;
  status: string;
  isDefault: boolean;
}

export type ActiveWorkspace =
  | { type: 'platform' }
  | { type: 'organization'; membership: OrganizationMembership };

interface AuthContextValue {
  user: AuthUser | null;
  memberships: OrganizationMembership[];
  activeWorkspace: ActiveWorkspace | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  selectWorkspace: (ws: ActiveWorkspace) => void;
  updateUser: (updated: AuthUser) => void;
  applySessionUpdate: (
    token: string,
    updatedUser: AuthUser,
    nextMemberships?: OrganizationMembership[]
  ) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [memberships, setMemberships] = useState<OrganizationMembership[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspace | null>(null);
  const [loading, setLoading] = useState(true);

  const pickDefaultWorkspace = useCallback(
    (u: AuthUser, mems: OrganizationMembership[], current: ActiveWorkspace | null): ActiveWorkspace | null => {
      if (current?.type === 'platform' && u.isSuperAdmin) return current;
      if (current?.type === 'organization') {
        const stillValid = mems.find(
          (m) =>
            m.organizationId === current.membership.organizationId &&
            m.roleSlug === current.membership.roleSlug
        );
        if (stillValid) return { type: 'organization', membership: stillValid };
      }
      if (u.isSuperAdmin) return { type: 'platform' };
      const activeOrg = mems.find((m) => m.organizationStatus === 'active') || mems[0];
      if (activeOrg) return { type: 'organization', membership: activeOrg };
      return null;
    },
    []
  );

  const applyWorkspace = useCallback((ws: ActiveWorkspace | null) => {
    setActiveWorkspace(ws);
    if (ws?.type === 'organization') {
      setApiOrganizationId(ws.membership.organizationId);
    } else {
      setApiOrganizationId(null);
    }
  }, []);

  const hydrateFromFirestore = useCallback(async () => {
    const data = await hydrateCurrentFirebaseSession();
    setUser(data.user);
    setMemberships(data.memberships);
    setActiveWorkspace((prev) => {
      const next = pickDefaultWorkspace(data.user, data.memberships, prev);
      setApiOrganizationId(next?.type === 'organization' ? next.membership.organizationId : null);
      return next;
    });
  }, [pickDefaultWorkspace]);

  useEffect(() => {
    let mounted = true;

    // Ensure session persists across page refreshes on Netlify & Vercel
    void setPersistence(auth, browserLocalPersistence).catch(() => {});

    // Complete Google Sign-In if returning from a redirect fallback (e.g., mobile/popup-blocked browsers)
    void getRedirectResult(auth).catch((err) => {
      console.warn('Google Sign-In redirect check:', formatFirebaseAuthError(err));
    });

    const safetyTimer = window.setTimeout(() => {
      if (mounted) {
        setLoading(false);
      }
    }, 12_000);

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!mounted) return;
      if (fbUser) {
        try {
          await Promise.race([
            hydrateFromFirestore(),
            new Promise<never>((_, reject) =>
              window.setTimeout(() => reject(new Error('Session hydration timed out. Please retry.')), 11_000)
            ),
          ]);
        } catch (err) {
          console.error('Failed to hydrate QIVORA Firestore profile:', err);
          if (mounted) {
            setUser(null);
            setMemberships([]);
            applyWorkspace(null);
          }
        } finally {
          window.clearTimeout(safetyTimer);
          if (mounted) setLoading(false);
        }
        return;
      }

      window.clearTimeout(safetyTimer);
      setUser(null);
      setMemberships([]);
      applyWorkspace(null);
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      window.clearTimeout(safetyTimer);
      unsubscribe();
    };
  }, [applyWorkspace, hydrateFromFirestore]);

  const signInWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleAuthProvider);
      await hydrateFromFirestore();
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code || '')
          : '';
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment'
      ) {
        await signInWithRedirect(auth, googleAuthProvider);
        return;
      }
      throw new Error(formatFirebaseAuthError(err));
    }
  };

  const signInWithPassword = async (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      throw new Error('Please enter both your email address and password.');
    }
    try {
      await signInWithEmailAndPassword(auth, normalizedEmail, password);
      await hydrateFromFirestore();
    } catch (err: unknown) {
      throw new Error(formatFirebaseAuthError(err));
    }
  };

  const logout = async () => {
    setApiOrganizationId(null);
    setUser(null);
    setMemberships([]);
    setActiveWorkspace(null);
    try {
      if (auth.currentUser) {
        await signOut(auth);
      }
    } catch {
      // ignore signOut errors
    }
  };

  const selectWorkspace = (ws: ActiveWorkspace) => {
    if (ws.type === 'platform' && !user?.isSuperAdmin) return;
    if (ws.type === 'organization') {
      const authorized = memberships.some(
        (m) =>
          m.organizationId === ws.membership.organizationId &&
          m.roleSlug === ws.membership.roleSlug
      );
      if (!authorized) return;
    }
    applyWorkspace(ws);
  };

  const updateUser = useCallback((updated: AuthUser) => {
    setUser(updated);
  }, []);

  const applySessionUpdate = useCallback(
    (_token: string, updatedUser: AuthUser, nextMemberships?: OrganizationMembership[]) => {
      setUser(updatedUser);
      if (nextMemberships) {
        setMemberships(nextMemberships);
        const nextWs = pickDefaultWorkspace(updatedUser, nextMemberships, null);
        applyWorkspace(nextWs);
      }
    },
    [applyWorkspace, pickDefaultWorkspace]
  );

  const refreshSession = useCallback(async () => {
    if (!auth.currentUser) return;
    await hydrateFromFirestore();
  }, [hydrateFromFirestore]);

  return (
    <AuthContext.Provider
      value={{
        user,
        memberships,
        activeWorkspace,
        loading,
        signInWithGoogle,
        signInWithPassword,
        logout,
        refreshSession,
        selectWorkspace,
        updateUser,
        applySessionUpdate,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
