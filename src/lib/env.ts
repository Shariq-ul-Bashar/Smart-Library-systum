/**
 * QIVORA — Centralized Frontend Environment Configuration & Firebase Diagnostics
 *
 * SECURITY RULES:
 * - Only public Firebase web SDK configuration keys belong in VITE_FIREBASE_* variables.
 * - Never place service account keys or admin secrets in frontend environment variables.
 * - Falls back seamlessly to firebase-applet-config.json when VITE_FIREBASE_* overrides are not set.
 */

import appletConfig from '../../firebase-applet-config.json';

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  firestoreDatabaseId?: string;
  measurementId?: string;
}

export interface FirebaseConfigDiagnostics {
  projectId: string;
  authDomain: string;
  firestoreDatabaseId: string;
  source: 'env' | 'firebase-applet-config';
  currentHost: string;
  isConfigured: boolean;
}

function readViteEnv(key: string): string | null {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const raw = env?.[key];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('YOUR_') || trimmed.startsWith('MY_')) {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

export function getFirebaseClientConfig(): FirebaseClientConfig {
  const envApiKey = readViteEnv('VITE_FIREBASE_API_KEY');
  const envProjectId = readViteEnv('VITE_FIREBASE_PROJECT_ID');
  const envAuthDomain = readViteEnv('VITE_FIREBASE_AUTH_DOMAIN');
  const envStorageBucket = readViteEnv('VITE_FIREBASE_STORAGE_BUCKET');
  const envMessagingSenderId = readViteEnv('VITE_FIREBASE_MESSAGING_SENDER_ID');
  const envAppId = readViteEnv('VITE_FIREBASE_APP_ID');
  const envDatabaseId = readViteEnv('VITE_FIREBASE_FIRESTORE_DATABASE_ID');
  const envMeasurementId = readViteEnv('VITE_FIREBASE_MEASUREMENT_ID');

  return {
    apiKey: envApiKey || appletConfig.apiKey,
    authDomain: envAuthDomain || appletConfig.authDomain,
    projectId: envProjectId || appletConfig.projectId,
    storageBucket: envStorageBucket || appletConfig.storageBucket,
    messagingSenderId: envMessagingSenderId || appletConfig.messagingSenderId,
    appId: envAppId || appletConfig.appId,
    firestoreDatabaseId: envDatabaseId || appletConfig.firestoreDatabaseId || '(default)',
    measurementId: envMeasurementId || appletConfig.measurementId || undefined,
  };
}

export function getFirebaseConfigDiagnostics(): FirebaseConfigDiagnostics {
  const cfg = getFirebaseClientConfig();
  const hasEnvOverride = Boolean(readViteEnv('VITE_FIREBASE_API_KEY') && readViteEnv('VITE_FIREBASE_PROJECT_ID'));
  const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'server';

  return {
    projectId: cfg.projectId,
    authDomain: cfg.authDomain,
    firestoreDatabaseId: cfg.firestoreDatabaseId || '(default)',
    source: hasEnvOverride ? 'env' : 'firebase-applet-config',
    currentHost,
    isConfigured: Boolean(cfg.apiKey && cfg.projectId && cfg.appId && cfg.projectId !== 'remixed-project-id'),
  };
}

export const APP_IDENTITY = {
  name: 'QIVORA',
  subtitle: 'Smart Library Management System',
  tagline: 'Intelligence for Every Library.',
  creditLine1: 'Designed & Developed by MOHAMMAD SHARIQ',
  creditLine2: 'BCA 1st Year | 2026–2027 Batch',
} as const;
