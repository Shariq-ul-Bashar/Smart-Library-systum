import { Link } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import { QivoraFooter, QivoraLogo } from '../../components/brand/QivoraLogo.tsx';
import { Button, SurfaceCard } from '../../components/ui/primitives.tsx';
import { useAuth } from '../../contexts/AuthContext.tsx';

export function UnauthorizedPage() {
  const { logout } = useAuth();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F4F6FA] dark:bg-[#0B1120] p-4">
      <SurfaceCard className="max-w-md w-full p-8 text-center space-y-5">
        <div className="flex justify-center">
          <QivoraLogo size="sm" />
        </div>
        <ShieldOff className="mx-auto h-10 w-10 text-red-600 dark:text-red-400" />
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            Unauthorized Access
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Your account does not have permission to view this workspace or institution record.
          </p>
        </div>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link to="/">
            <Button variant="primary">Go to My Workspace</Button>
          </Link>
          <Button variant="outline" onClick={logout}>
            Sign Out
          </Button>
        </div>
      </SurfaceCard>
      <QivoraFooter className="mt-6" />
    </div>
  );
}
