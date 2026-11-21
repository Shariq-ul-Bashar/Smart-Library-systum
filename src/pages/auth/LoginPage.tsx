import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, KeyRound, Moon, QrCode, Sun, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { QivoraFooter, QivoraLogo } from '../../components/brand/QivoraLogo.tsx';
import { Button, Field, Input, Modal } from '../../components/ui/primitives.tsx';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { useTheme } from '../../contexts/ThemeContext.tsx';
import { apiRequest } from '../../lib/api.ts';

export function LoginPage() {
  const { signInWithGoogle, signInWithPassword } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSentNotice, setResetSentNotice] = useState<string | null>(null);


  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInWithPassword(email, password);
      toast.success('Signed in to QIVORA');
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      toast.success('Authenticated with Google');
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google Sign-In was cancelled or failed.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetLoading(true);
    setResetSentNotice(null);
    try {
      const res = await apiRequest<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: { email: resetEmail },
        skipAuth: true,
      });
      toast.success(res.message);
      setResetSentNotice(res.message);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to send password reset email.');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-12 bg-[#F8FAFC] dark:bg-[#0B1120]">
      {/* Left Architectural Panel */}
      <div className="relative hidden lg:flex lg:col-span-6 xl:col-span-7 flex-col justify-between overflow-hidden bg-[#0F172A] p-12 text-white">
        <img
          src="/src/assets/images/sharixa_library_atrium_1795150660987.jpg"
          alt="Modern university library atrium"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover opacity-45"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B1120] via-[#0F172A]/65 to-[#0F172A]/40" />

        <div className="relative z-10">
          <QivoraLogo size="lg" variant="inverted" showTagline />
        </div>

        <div className="relative z-10 max-w-xl space-y-6">
          <h1 className="font-display text-4xl font-bold leading-tight tracking-tight text-white">
            Institutional library infrastructure built for multi-campus governance.
          </h1>
          <p className="text-base text-slate-300 leading-relaxed">
            Unified catalog inventory, atomic book circulation, official course-assigned Digital ID
            cards, and tenant-isolated access for colleges and universities.
          </p>
          <div className="grid grid-cols-3 gap-6 border-t border-white/15 pt-6 text-xs text-slate-300">
            <div>
              <div className="font-display text-sm font-semibold text-white">Multi-Tenant</div>
              <div className="mt-1 text-slate-400">Strict per-institution data isolation</div>
            </div>
            <div>
              <div className="font-display text-sm font-semibold text-white">Digital ID Studio</div>
              <div className="mt-1 text-slate-400">9 starter templates & QR verification</div>
            </div>
            <div>
              <div className="font-display text-sm font-semibold text-white">Atomic Circulation</div>
              <div className="mt-1 text-slate-400">Copy-level inventory, reservations & fines</div>
            </div>
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between text-xs text-slate-400">
          <span>QIVORA — Smart Library Management System</span>
          <span>Firebase Auth · Cloud Firestore RBAC</span>
        </div>
      </div>

      {/* Right Authentication Form */}
      <div className="lg:col-span-6 xl:col-span-5 flex flex-col justify-between p-6 sm:p-10 lg:p-14">
        <div className="flex items-center justify-between">
          <div className="lg:hidden">
            <QivoraLogo size="md" showTagline />
          </div>
          <div className="hidden lg:block text-xs font-medium text-slate-500 dark:text-slate-400">
            Unified Institutional Sign-In
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle color theme"
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 cursor-pointer"
          >
            {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>

        <div className="mx-auto w-full max-w-md py-8">
          <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Sign in to QIVORA
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Access your Platform Super Admin, College Admin, Librarian, or Student workspace.
          </p>


          {error && (
            <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Primary Google Sign-In (Firebase Auth) */}
          <div className="mt-6">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full"
              loading={googleLoading}
              onClick={handleGoogleSignIn}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.56-5.15 3.56-8.65z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.94H1.29v3.1A12 12 0 0 0 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.3a7.18 7.18 0 0 1 0-4.6V6.6H1.29a12 12 0 0 0 0 10.8l3.99-3.1z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.6l3.99 3.1C6.23 6.86 8.88 4.75 12 4.75z"
                />
              </svg>
              Continue with Google
            </Button>
          </div>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            <span className="text-xs text-slate-400">or institutional credentials</span>
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <Field label="Institutional Email" required>
              <Input
                type="email"
                required
                autoComplete="email"
                placeholder="name@college.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>

            <Field label="Password" required>
              <Input
                type="password"
                required
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => {
                  setResetEmail(email);
                  setResetSentNotice(null);
                  setResetModalOpen(true);
                }}
                className="text-xs font-medium text-[#4F46E5] hover:underline dark:text-indigo-400 cursor-pointer"
              >
                Forgot password?
              </button>
            </div>

            <Button type="submit" size="lg" className="w-full" loading={submitting}>
              Sign In
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-slate-200 dark:border-slate-800 pt-6">
            <Link
              to="/register"
              className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Student Registration
            </Link>
            <Link
              to="/verify"
              className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <QrCode className="h-3.5 w-3.5" />
              Verify Digital ID
            </Link>
          </div>
        </div>

        <QivoraFooter className="pt-4" />
      </div>

      {/* Password Reset Modal (Firebase Authentication) */}
      <Modal
        open={resetModalOpen}
        onOpenChange={setResetModalOpen}
        title="Reset Account Password"
        description="Enter your registered institutional email to receive a secure Firebase password reset link."
        maxWidth="max-w-md"
      >
        <form onSubmit={handleForgotPassword} className="space-y-4">
          {resetSentNotice && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
              {resetSentNotice}
            </div>
          )}
          <Field label="Email Address" required>
            <Input
              type="email"
              required
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              placeholder="name@college.edu"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setResetModalOpen(false)}>
              Close
            </Button>
            <Button type="submit" loading={resetLoading}>
              <KeyRound className="h-4 w-4" />
              Send Reset Email
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
