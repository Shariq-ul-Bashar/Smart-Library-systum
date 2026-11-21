import { deleteApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import { getFirebaseClientConfig } from './env.ts';

export const firebaseConfig = getFirebaseClientConfig();

const existingPrimary = getApps().find((a) => a.name === '[DEFAULT]');
export const app: FirebaseApp = existingPrimary || initializeApp(firebaseConfig);

// CRITICAL: Connect to the provisioned named Firestore database when configured
export const db =
  firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
    : getFirestore(app);

export const auth: Auth = getAuth(app);

export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });

/**
 * Secondary Firebase App instance used solely when an Admin provisions a new
 * Email/Password account so the Admin's own active Firebase session is never signed out.
 */
export async function withSecondaryAuth<T>(fn: (secondaryAuth: Auth) => Promise<T>): Promise<T> {
  const secondaryName = `qivora-provision-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const secondaryApp = initializeApp(firebaseConfig, secondaryName);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    return await fn(secondaryAuth);
  } finally {
    await secondaryAuth.signOut().catch(() => {});
    await deleteApp(secondaryApp).catch(() => {});
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<{ connected: boolean; latencyMs: number; error?: string }> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return { connected: true, latencyMs: Math.max(1, Math.round(ended - started)) };
  } catch (error) {
    const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return { connected: false, latencyMs: Math.round(ended - started), error: 'Firestore client is offline. Verify Firebase project and database configuration.' };
    }
    // Missing test/connection doc or permission reply still proves live Firestore server connectivity
    if (message.includes('Missing or insufficient permissions') || message.includes('permission-denied')) {
      return { connected: true, latencyMs: Math.max(1, Math.round(ended - started)) };
    }
    return { connected: false, latencyMs: Math.round(ended - started), error: message };
  }
}

// Validate connection to Firestore on startup
if (typeof window !== 'undefined') {
  void testConnection();
}

export function formatFirebaseAuthError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
  const msg = error instanceof Error ? error.message : String(error || 'Authentication failed.');
  const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';

  switch (code) {
    case 'auth/unauthorized-domain':
      return `Domain "${host}" is not authorized in Firebase Auth. Add "${host}" in Firebase Console → Authentication → Settings → Authorized domains (Project: ${firebaseConfig.projectId}).`;
    case 'auth/operation-not-allowed':
      return `This sign-in provider is disabled in Firebase Console. Enable Email/Password and Google providers in Firebase Console → Authentication → Sign-in method (Project: ${firebaseConfig.projectId}).`;
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid email or password. Verify your credentials or use Forgot Password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists in Firebase Authentication.';
    case 'auth/weak-password':
      return 'Password is too weak. Please use a stronger password (at least 8 characters).';
    case 'auth/too-many-requests':
      return 'Too many failed sign-in attempts. Please wait a few minutes and try again.';
    case 'auth/popup-closed-by-user':
      return 'Google Sign-In popup was closed before completion.';
    case 'auth/popup-blocked':
      return 'Sign-In popup was blocked by your browser. Allow popups for this site and try again.';
    case 'auth/requires-recent-login':
      return 'For security, please sign out and sign back in before changing your email or password.';
    case 'auth/network-request-failed':
      return 'Network error while contacting Firebase Authentication. Check your internet connection.';
    default:
      return msg.replace(/^Firebase:\s*/i, '').trim() || 'Authentication failed. Please try again.';
  }
}
