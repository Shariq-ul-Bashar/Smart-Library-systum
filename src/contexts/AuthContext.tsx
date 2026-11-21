import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { apiRequest, setApiOrganizationId, setApiToken, setApiTokenProvider } from '../lib/api.ts';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { isSupabaseConfigured, supabase } from '../lib/supabase.ts';

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
  supabaseConfigured: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signInWithSupabasePassword: (email: string, password: string) => Promise<void>;
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

const SESSION_KEY = 'qivora-session-token';
const LEGACY_SESSION_KEY = 'sharixa-session-token';

function readStoredSession(): string | null {
  try {
    const current = sessionStorage.getItem(SESSION_KEY);
    if (current) return current;
    const legacy = sessionStorage.getItem(LEGACY_SESSION_KEY);
    if (legacy) {
      sessionStorage.setItem(SESSION_KEY, legacy);
      sessionStorage.removeItem(LEGACY_SESSION_KEY);
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

function clearStoredSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // ignore
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [memberships, setMemberships] = useState<OrganizationMembership[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const supabaseConfigured = isSupabaseConfigured();

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

  const hydrateFromServer = useCallback(async () => {
    try {
      const data = await apiRequest<{
        user: AuthUser;
        memberships: OrganizationMembership[];
      }>('/auth/me');
      setUser(data.user);
      setMemberships(data.memberships);
      setActiveWorkspace((prev) => {
        const next = pickDefaultWorkspace(data.user, data.memberships, prev);
        setApiOrganizationId(next?.type === 'organization' ? next.membership.organizationId : null);
        return next;
      });
    } catch {
      setUser(null);
      setMemberships([]);
      applyWorkspace(null);
      setApiToken(null);
      clearStoredSession();
    }
  }, [applyWorkspace, pickDefaultWorkspace]);

  useEffect(() => {
    let mounted = true;

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!mounted) return;
      if (fbUser) {
        setApiTokenProvider(async () => {
          const current = auth.currentUser;
          return current ? current.getIdToken() : null;
        });
        const idToken = await fbUser.getIdToken();
        setApiToken(idToken);
        await hydrateFromServer();
        if (mounted) setLoading(false);
        return;
      }

      // Check active Supabase Auth session if configured
      if (supabase) {
        try {
          const { data: sbSessionData } = await supabase.auth.getSession();
          const sbAccessToken = sbSessionData.session?.access_token;
          if (sbAccessToken) {
            setApiTokenProvider(async () => {
              const latest = await supabase?.auth.getSession();
              return latest?.data.session?.access_token ?? null;
            });
            setApiToken(sbAccessToken);
            await hydrateFromServer();
            if (mounted) setLoading(false);
            return;
          }
        } catch {
          // Fall through to institutional session check
        }
      }

      // Check institutional session token in sessionStorage (tab-scoped, not localStorage)
      const storedSession = readStoredSession();

      if (storedSession) {
        setApiTokenProvider(null);
        setApiToken(storedSession);
        await hydrateFromServer();
      } else {
        setUser(null);
        setMemberships([]);
        applyWorkspace(null);
      }
      if (mounted) setLoading(false);
    });

    const sbSubscription = supabase
      ? supabase.auth.onAuthStateChange(async (event, session) => {
          if (!mounted) return;
          if (event === 'SIGNED_IN' && session?.access_token) {
            setApiTokenProvider(async () => {
              const latest = await supabase?.auth.getSession();
              return latest?.data.session?.access_token ?? null;
            });
            setApiToken(session.access_token);
            await hydrateFromServer();
          } else if (event === 'SIGNED_OUT') {
            if (!auth.currentUser && !readStoredSession()) {
              setApiTokenProvider(null);
              setApiToken(null);
              setUser(null);
              setMemberships([]);
              applyWorkspace(null);
            }
          }
        })
      : null;

    return () => {
      mounted = false;
      unsubscribe();
      sbSubscription?.data.subscription.unsubscribe();
    };
  }, [applyWorkspace, hydrateFromServer]);

  const signInWithGoogle = async () => {
    const cred = await signInWithPopup(auth, googleAuthProvider);
    const idToken = await cred.user.getIdToken();
    setApiTokenProvider(async () => (auth.currentUser ? auth.currentUser.getIdToken() : null));
    setApiToken(idToken);
    clearStoredSession();
    await hydrateFromServer();
  };

  const signInWithSupabasePassword = async (email: string, password: string) => {
    if (!supabase) {
      throw new Error(
        'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to use Supabase Auth.'
      );
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session?.access_token) {
      throw new Error(error?.message || 'Supabase authentication failed.');
    }
    setApiTokenProvider(async () => {
      const latest = await supabase?.auth.getSession();
      return latest?.data.session?.access_token ?? null;
    });
    setApiToken(data.session.access_token);
    clearStoredSession();
    await hydrateFromServer();
  };

  const signInWithPassword = async (email: string, password: string) => {
    const res = await apiRequest<{
      token: string;
      user: AuthUser;
      memberships: OrganizationMembership[];
    }>('/auth/login', {
      method: 'POST',
      body: { email, password },
      skipAuth: true,
    });

    if (auth.currentUser) {
      await signOut(auth);
    }
    if (supabase) {
      await supabase.auth.signOut().catch(() => {});
    }
    setApiTokenProvider(null);
    setApiToken(res.token);
    try {
      sessionStorage.setItem(SESSION_KEY, res.token);
    } catch {
      // ignore
    }
    setUser(res.user);
    setMemberships(res.memberships);
    const next = pickDefaultWorkspace(res.user, res.memberships, null);
    applyWorkspace(next);
  };

  const logout = async () => {
    try {
      if (auth.currentUser) {
        await signOut(auth);
      }
    } catch {
      // ignore
    }
    try {
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch {
      // ignore
    }
    clearStoredSession();
    setApiTokenProvider(null);
    setApiToken(null);
    setApiOrganizationId(null);
    setUser(null);
    setMemberships([]);
    setActiveWorkspace(null);
  };

  const selectWorkspace = (ws: ActiveWorkspace) => {
    // Only allow switching to server-verified workspaces
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
    (token: string, updatedUser: AuthUser, nextMemberships?: OrganizationMembership[]) => {
      setApiTokenProvider(null);
      setApiToken(token);
      try {
        sessionStorage.setItem(SESSION_KEY, token);
      } catch {
        // ignore
      }
      setUser(updatedUser);
      if (nextMemberships) {
        setMemberships(nextMemberships);
        const nextWs = pickDefaultWorkspace(updatedUser, nextMemberships, null);
        applyWorkspace(nextWs);
      }
    },
    [applyWorkspace, pickDefaultWorkspace]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        memberships,
        activeWorkspace,
        loading,
        supabaseConfigured,
        signInWithGoogle,
        signInWithPassword,
        signInWithSupabasePassword,
        logout,
        refreshSession: hydrateFromServer,
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
