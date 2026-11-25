import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Plug, ShieldAlert, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  EmptyState,
  MetricTile,
  SkeletonRows,
  StatusText,
  SurfaceCard,
} from '../../components/ui/primitives.tsx';
import { apiRequest } from '../../lib/api.ts';

interface IntegrationModule {
  key: string;
  displayName: string;
  category: string;
  description: string;
  envVars: string[];
  publicFallbackAvailable: boolean;
  credentialsConfigured: boolean;
  missingEnv: string[];
  status: 'configured_enabled' | 'configured_disabled' | 'public_api_ready' | 'not_configured';
  isEnabled: boolean;
}

export function PlatformIntegrationsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['platform-integrations'],
    queryFn: () => apiRequest<{ integrations: IntegrationModule[] }>('/platform/integrations'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ key, isEnabled }: { key: string; isEnabled: boolean }) =>
      apiRequest(`/platform/integrations/${key}`, {
        method: 'PUT',
        body: { isEnabled },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-integrations'] });
      toast.success('Integration module state saved.');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <SkeletonRows rows={6} />;
  if (isError) {
    return (
      <EmptyState
        title="Integrations Hub unavailable"
        description="Unable to load integration module status from Cloud Firestore."
        action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  const list = Array.isArray(data?.integrations) ? data.integrations : [];
  const configuredCount = list.filter((i) => i.credentialsConfigured || i.publicFallbackAvailable).length;
  const activeCount = list.filter(
    (i) => i.status === 'configured_enabled' || (i.publicFallbackAvailable && i.isEnabled)
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          Modular Integrations Hub
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Verified connectors for QIVORA. Modules validate real credentials and gracefully disable unconfigured external services.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricTile label="Available Connectors" value={list.length} icon={Plug} pastel="purple" />
        <MetricTile label="Ready / Configured" value={configuredCount} icon={ShieldCheck} pastel="blue" />
        <MetricTile label="Active Modules" value={activeCount} icon={Database} pastel="emerald" tone="success" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {list.map((mod) => {
          const envVars = Array.isArray(mod.envVars) ? mod.envVars : [];
          const missingEnv = Array.isArray(mod.missingEnv) ? mod.missingEnv : [];
          const canEnable = Boolean(mod.credentialsConfigured || mod.publicFallbackAvailable);
          return (
            <SurfaceCard key={mod.key} className="p-5 flex flex-col justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[#4F46E5] dark:text-indigo-400">
                      {mod.category}
                    </div>
                    <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
                      {mod.displayName}
                    </h3>
                  </div>
                  <StatusText status={mod.status} />
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {mod.description}
                </p>
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-mono text-slate-600 dark:bg-slate-900/70 dark:text-slate-400">
                  Required Env: {envVars.length > 0 ? envVars.join(', ') : 'None (Public API)'}
                  {missingEnv.length > 0 && (
                    <div className="mt-1 text-amber-700 dark:text-amber-400">
                      Not configured: {missingEnv.join(', ')}
                      {mod.publicFallbackAvailable ? ' (Public API fallback available)' : ''}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
                <span className="text-[11px] text-slate-500">
                  {canEnable
                    ? 'Ready for activation'
                    : 'Not configured on this Firebase-only deployment'}
                </span>
                <Button
                  size="sm"
                  variant={mod.isEnabled ? 'outline' : 'primary'}
                  disabled={!canEnable && !mod.isEnabled}
                  loading={toggleMutation.isPending}
                  onClick={() => toggleMutation.mutate({ key: mod.key, isEnabled: !mod.isEnabled })}
                >
                  {mod.isEnabled ? 'Disable' : 'Enable Module'}
                </Button>
              </div>
            </SurfaceCard>
          );
        })}
      </div>

      <SurfaceCard className="p-5 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Honest Integration Security Policy
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Firebase Authentication, Cloud Firestore, and Public ISBN lookup are active directly. Optional external mailers or WhatsApp relays are gracefully disabled until configured, and never simulate fake deliveries.
          </p>
        </div>
      </SurfaceCard>
    </div>
  );
}
