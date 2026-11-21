import { useEffect, useState } from 'react';
import {
  getSupabaseConfigDiagnostics,
  verifySupabaseConnection,
  type SupabaseVerificationResult,
} from '../lib/supabase.ts';

export function useSupabaseStatus(autoVerify = false) {
  const diagnostics = getSupabaseConfigDiagnostics();
  const [verification, setVerification] = useState<SupabaseVerificationResult>({
    configured: diagnostics.isConfigured,
    connected: false,
    keyType: diagnostics.keyType,
    error: diagnostics.validationError || undefined,
  });
  const [checking, setChecking] = useState(false);

  const checkNow = async () => {
    setChecking(true);
    try {
      const result = await verifySupabaseConnection();
      setVerification(result);
      return result;
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (autoVerify && diagnostics.isConfigured) {
      void checkNow();
    }
  }, [autoVerify, diagnostics.isConfigured]);

  return {
    diagnostics,
    verification,
    checking,
    checkNow,
  };
}
