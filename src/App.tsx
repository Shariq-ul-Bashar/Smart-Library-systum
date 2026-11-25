import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertTriangle, Loader2, LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import { Toaster } from 'sonner';
import { QivoraFooter, QivoraLogo } from './components/brand/QivoraLogo.tsx';
import { ForcePasswordChangeGate } from './components/auth/ForcePasswordChangeModal.tsx';
import { AppShell } from './components/layout/AppShell.tsx';
import { Button, SurfaceCard } from './components/ui/primitives.tsx';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import { ThemeProvider } from './contexts/ThemeContext.tsx';
import { LoginPage } from './pages/auth/LoginPage.tsx';
import { PublicRegisterPage } from './pages/auth/PublicRegisterPage.tsx';
import { UnauthorizedPage } from './pages/auth/UnauthorizedPage.tsx';
import { VerifyQrPage } from './pages/auth/VerifyQrPage.tsx';

// Code-split major workspaces for faster initial bundle load
const PlatformWorkspace = lazy(() =>
  import('./pages/platform/PlatformWorkspace.tsx').then((m) => ({ default: m.PlatformWorkspace }))
);
const OrgWorkspace = lazy(() =>
  import('./pages/org/OrgWorkspace.tsx').then((m) => ({ default: m.OrgWorkspace }))
);
const StudentWorkspace = lazy(() =>
  import('./pages/student/StudentWorkspace.tsx').then((m) => ({ default: m.StudentWorkspace }))
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || 'An unexpected rendering error occurred.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#F4F6FA] dark:bg-[#0B1120]">
          <SurfaceCard className="max-w-md w-full p-6 text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h1 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              Something went wrong
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {this.state.message}
            </p>
            <div className="flex items-center justify-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  queryClient.clear();
                  this.setState({ hasError: false, message: '' });
                }}
              >
                Try Again
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  queryClient.clear();
                  this.setState({ hasError: false, message: '' });
                  window.location.assign('/');
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reload QIVORA
              </Button>
            </div>
          </SurfaceCard>
          <QivoraFooter className="mt-6" />
        </div>
      );
    }
    return this.props.children;
  }
}

function FullPageLoader() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#F4F6FA] dark:bg-[#0B1120] text-slate-600 dark:text-slate-300">
      <QivoraLogo size="md" showTagline />
      <div className="flex items-center gap-2 text-xs">
        <Loader2 className="h-4 w-4 animate-spin text-[#4F46E5] dark:text-indigo-400" />
        <span>Loading QIVORA workspace and permissions...</span>
      </div>
    </div>
  );
}

function PendingAssignmentScreen() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#F4F6FA] dark:bg-[#0B1120]">
      <SurfaceCard className="max-w-md w-full p-6 space-y-5 text-center">
        <div className="flex justify-center">
          <QivoraLogo size="sm" />
        </div>
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-lg font-display font-bold text-slate-900 dark:text-white">
            No Active Organization Role Assigned
          </h1>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            You are signed in as{' '}
            <span className="font-medium text-slate-800 dark:text-slate-200">{user?.email}</span>,
            but no college administrator or platform administrator has linked an active institutional role to this account yet.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Link to="/register">
            <Button variant="outline" size="sm" className="w-full sm:w-auto">
              Apply as Student
            </Button>
          </Link>
          <Button variant="primary" size="sm" onClick={logout}>
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </SurfaceCard>
      <QivoraFooter className="mt-6" />
    </div>
  );
}

function HomeRedirect() {
  const { user, activeWorkspace, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!activeWorkspace) return <PendingAssignmentScreen />;
  if (activeWorkspace.type === 'platform') return <Navigate to="/platform" replace />;
  if (activeWorkspace.membership.roleSlug === 'student') return <Navigate to="/student" replace />;
  return <Navigate to="/org" replace />;
}

function PublicOnlyLogin() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}

function RequirePlatformSuperAdmin({ children }: { children: React.ReactNode }) {
  const { user, activeWorkspace, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.isSuperAdmin || activeWorkspace?.type !== 'platform') {
    return <Navigate to="/unauthorized" replace />;
  }
  return <AppShell>{children}</AppShell>;
}

function RequireOrgStaff({ children }: { children: React.ReactNode }) {
  const { user, activeWorkspace, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (
    activeWorkspace?.type !== 'organization' ||
    (activeWorkspace.membership.roleSlug !== 'college_admin' &&
      activeWorkspace.membership.roleSlug !== 'librarian')
  ) {
    return <Navigate to="/unauthorized" replace />;
  }
  return <AppShell>{children}</AppShell>;
}

function RequireStudent({ children }: { children: React.ReactNode }) {
  const { user, activeWorkspace, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (
    activeWorkspace?.type !== 'organization' ||
    activeWorkspace.membership.roleSlug !== 'student'
  ) {
    return <Navigate to="/unauthorized" replace />;
  }
  return <AppShell>{children}</AppShell>;
}

export default function App() {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <BrowserRouter>
              <Suspense fallback={<FullPageLoader />}>
                <Routes>
                  {/* Public Routes */}
                  <Route path="/login" element={<PublicOnlyLogin />} />
                  <Route path="/register" element={<PublicRegisterPage />} />
                  <Route path="/verify" element={<VerifyQrPage />} />
                  <Route path="/verify/:token" element={<VerifyQrPage />} />
                  <Route path="/unauthorized" element={<UnauthorizedPage />} />

                  {/* Role-Gated Multi-Tenant Workspaces */}
                  <Route
                    path="/platform/*"
                    element={
                      <RequirePlatformSuperAdmin>
                        <PlatformWorkspace />
                      </RequirePlatformSuperAdmin>
                    }
                  />
                  <Route
                    path="/org/*"
                    element={
                      <RequireOrgStaff>
                        <OrgWorkspace />
                      </RequireOrgStaff>
                    }
                  />
                  <Route
                    path="/student/*"
                    element={
                      <RequireStudent>
                        <StudentWorkspace />
                      </RequireStudent>
                    }
                  />

                  {/* Root & Fallback */}
                  <Route path="/" element={<HomeRedirect />} />
                  <Route path="*" element={<HomeRedirect />} />
                </Routes>
              </Suspense>
              <ForcePasswordChangeGate />
            </BrowserRouter>
            <Toaster position="top-right" richColors closeButton />
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
