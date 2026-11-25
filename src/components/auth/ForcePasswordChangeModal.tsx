import React, { useState } from 'react';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { type AuthUser, useAuth } from '../../contexts/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { QivoraLogo } from '../brand/QivoraLogo.tsx';
import { Button, Field, Input, SurfaceCard } from '../ui/primitives.tsx';

export function ForcePasswordChangeGate() {
  const { user, updateUser, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedForUid, setDismissedForUid] = useState<string | null>(null);

  if (!user || !user.mustChangePassword || dismissedForUid === user.uid) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest<{ user: AuthUser; message: string }>('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      updateUser(res.user);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password updated! Your QIVORA workspace is now secured.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to update password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
      <SurfaceCard className="w-full max-w-md p-6 sm:p-7 space-y-5 shadow-2xl border-indigo-200 dark:border-indigo-900/60">
        <div className="flex items-center justify-between">
          <QivoraLogo size="sm" />
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            Temporary Password Notice
          </span>
        </div>

        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            Set Your Personal Password
          </h2>
          <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            You signed in to <strong className="text-slate-900 dark:text-white">{user.email}</strong>{' '}
            using an administrator-issued temporary password. We recommend setting a personal password now,
            or you can skip and change it anytime from your Profile / Account Settings.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Current Temporary Password" required>
            <Input
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter temporary password"
            />
          </Field>

          <Field
            label="New Personal Password"
            required
            hint="Use uppercase, lowercase, a number, and a special character (min 8 characters)."
          >
            <Input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Choose a strong new password"
            />
          </Field>

          <Field label="Confirm New Password" required>
            <Input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
            />
          </Field>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div className="flex items-center gap-1.5">
              <Button type="button" variant="ghost" size="sm" onClick={logout}>
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDismissedForUid(user.uid)}
              >
                Change Later
              </Button>
            </div>
            <Button type="submit" loading={submitting}>
              <KeyRound className="h-4 w-4" />
              Save New Password
            </Button>
          </div>
        </form>
      </SurfaceCard>
    </div>
  );
}
