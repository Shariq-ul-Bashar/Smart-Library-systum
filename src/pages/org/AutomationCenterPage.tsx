import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Play, RefreshCw, ShieldCheck, Zap } from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  EmptyState,
  MetricTile,
  SkeletonRows,
  StatusText,
  SurfaceCard,
} from '../../components/ui/primitives.tsx';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/utils.ts';

interface AutomationJob {
  id: string;
  jobKey: string;
  name: string;
  description: string;
  scheduleCron: string;
  isEnabled: boolean;
  lastRunAt?: string | null;
  lastStatus?: string | null;
  lastSummary?: string | null;
}

interface AutomationLog {
  id: string;
  jobKey: string;
  triggerSource: string;
  status: string;
  processedCount: number;
  notificationsSent: number;
  summary: string;
  executedAt: string;
}

export function AutomationCenterPage() {
  const { activeWorkspace } = useAuth();
  const queryClient = useQueryClient();
  const [runningId, setRunningId] = useState<string | null>(null);

  const isAdmin =
    activeWorkspace?.type === 'organization' &&
    activeWorkspace.membership.roleSlug === 'college_admin';

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-automations'],
    queryFn: () => apiRequest<{ jobs: AutomationJob[]; logs: AutomationLog[] }>('/org/automations'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      apiRequest(`/org/automations/${id}`, {
        method: 'PATCH',
        body: { isEnabled },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-automations'] });
      toast.success('Automation rule updated.');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const runMutation = useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) => {
      setRunningId(id);
      return apiRequest<{ message: string; skippedDuplicate?: boolean }>(`/org/automations/${id}/run`, {
        method: 'POST',
        body: { force: Boolean(force) },
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['org-automations'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });
      if (res.skippedDuplicate) {
        toast.info(res.message);
      } else {
        toast.success(res.message);
      }
    },
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => setRunningId(null),
  });

  if (isLoading) return <SkeletonRows rows={6} />;

  const jobs = data?.jobs || [];
  const logs = data?.logs || [];
  const enabledCount = jobs.filter((j) => j.isEnabled).length;
  const totalNotifs = logs.reduce((acc, l) => acc + (l.notificationsSent || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Smart Automation Engine
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Idempotent, organization-scoped operational jobs for overdue detection, ID expiry, reservation releases, and low-stock audits.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh State
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricTile label="Automation Rules" value={jobs.length} icon={Zap} pastel="purple" />
        <MetricTile label="Active Schedules" value={enabledCount} icon={ShieldCheck} pastel="emerald" tone="success" />
        <MetricTile label="Logged Executions" value={logs.length} icon={Clock} pastel="blue" />
        <MetricTile label="Alerts Dispatched" value={totalNotifs} pastel="amber" />
      </div>

      {/* Rules Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {jobs.map((job) => (
          <SurfaceCard key={job.id} className="p-5 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                    {job.name}
                  </h3>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] font-mono text-slate-500">
                    <span>{job.jobKey}</span>
                    <span>·</span>
                    <span>CRON: {job.scheduleCron}</span>
                  </div>
                </div>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => toggleMutation.mutate({ id: job.id, isEnabled: !job.isEnabled })}
                    disabled={toggleMutation.isPending}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                      job.isEnabled ? 'bg-[#4F46E5]' : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                    aria-label={`Toggle ${job.name}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        job.isEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                ) : (
                  <StatusText status={job.isEnabled ? 'active' : 'inactive'} />
                )}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {job.description}
              </p>
              {job.lastSummary && (
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900/70 dark:text-slate-300">
                  <span className="font-medium">Last result:</span> {job.lastSummary}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <div className="text-[11px] text-slate-500">
                {job.lastRunAt ? `Last run: ${formatDateTime(job.lastRunAt)}` : 'Not yet executed'}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  loading={runningId === job.id && runMutation.isPending}
                  onClick={() => runMutation.mutate({ id: job.id, force: false })}
                >
                  <Play className="h-3.5 w-3.5" />
                  Run Now
                </Button>
              </div>
            </div>
          </SurfaceCard>
        ))}
      </div>

      {/* Execution Logs */}
      <SurfaceCard className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Automation Execution History
          </h2>
        </div>
        {!logs.length ? (
          <div className="p-6">
            <EmptyState
              title="No automation executions logged yet"
              description="Run any rule above to execute real database checks with idempotency protection and view full audit logs here."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3">Executed At</th>
                  <th className="px-4 py-3">Rule Key</th>
                  <th className="px-4 py-3">Trigger</th>
                  <th className="px-4 py-3">Processed</th>
                  <th className="px-4 py-3">Alerts Sent</th>
                  <th className="px-4 py-3">Summary</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono text-slate-500">{formatDateTime(log.executedAt)}</td>
                    <td className="px-4 py-3 font-mono text-slate-800 dark:text-slate-200">{log.jobKey}</td>
                    <td className="px-4 py-3 capitalize">{log.triggerSource}</td>
                    <td className="px-4 py-3 font-mono">{log.processedCount}</td>
                    <td className="px-4 py-3 font-mono">{log.notificationsSent}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300 max-w-md">{log.summary}</td>
                    <td className="px-4 py-3">
                      <StatusText status={log.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}
