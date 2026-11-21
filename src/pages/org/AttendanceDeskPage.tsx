import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Award,
  Camera,
  CheckCircle2,
  Download,
  LogIn,
  LogOut,
  QrCode,
  UserCheck,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { QrScannerModal } from '../../components/scanner/QrScannerModal.tsx';
import {
  Button,
  EmptyState,
  Input,
  MetricTile,
  SkeletonRows,
  StatusText,
  SurfaceCard,
} from '../../components/ui/primitives.tsx';
import { apiRequest } from '../../lib/api.ts';
import { exportToCsv, formatDateTime } from '../../lib/utils.ts';

interface AttendanceEntry {
  id: string;
  studentId: string;
  studentName: string;
  studentIdCode: string;
  rollNumber: string;
  courseName?: string | null;
  checkInAt: string;
  checkOutAt?: string | null;
  method: string;
  notes?: string | null;
}

export function AttendanceDeskPage() {
  const queryClient = useQueryClient();
  const [scanOpen, setScanOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [lastFeedback, setLastFeedback] = useState<{
    action: 'check_in' | 'check_out';
    message: string;
    studentName: string;
    rollNumber: string;
    founderBadge?: { founderNumber: string; designation: string } | null;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['org-attendance'],
    queryFn: () =>
      apiRequest<{
        entries: AttendanceEntry[];
        stats: {
          todayTotal: number;
          currentlyInside: number;
          checkedOutToday: number;
        };
      }>('/org/attendance'),
  });

  const scanMutation = useMutation({
    mutationFn: ({ query, method }: { query: string; method: 'qr' | 'manual' }) =>
      apiRequest<{
        action: 'check_in' | 'check_out';
        message: string;
        student: { fullName: string; rollNumber: string };
        founderBadge?: { founderNumber: string; designation: string } | null;
      }>('/org/attendance/scan', {
        method: 'POST',
        body: { query, method },
      }),
    onSuccess: (res) => {
      setManualQuery('');
      setLastFeedback({
        action: res.action,
        message: res.message,
        studentName: res.student.fullName,
        rollNumber: res.student.rollNumber,
        founderBadge: res.founderBadge || null,
      });
      queryClient.invalidateQueries({ queryKey: ['org-attendance'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });
      toast.success(res.message);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const checkoutMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/org/attendance/${id}/checkout`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-attendance'] });
      toast.success('Visitor checked out.');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualQuery.trim()) return;
    scanMutation.mutate({ query: manualQuery.trim(), method: 'manual' });
  };

  const handleExport = () => {
    const rows = (data?.entries || []).map((e) => ({
      StudentName: e.studentName,
      StudentID: e.studentIdCode,
      RollNumber: e.rollNumber,
      Course: e.courseName || '—',
      Method: e.method,
      CheckIn: formatDateTime(e.checkInAt),
      CheckOut: e.checkOutAt ? formatDateTime(e.checkOutAt) : 'Inside',
    }));
    exportToCsv(`qivora-attendance-${Date.now()}.csv`, rows);
  };

  if (isLoading) return <SkeletonRows rows={6} />;

  const entries = data?.entries || [];
  const stats = data?.stats;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Library Entry & Attendance Gate
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Scan student Digital ID QR codes or enter Roll Numbers. Scanning automatically toggles Check-In and Check-Out.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!entries.length}>
            <Download className="h-3.5 w-3.5" />
            Export Log CSV
          </Button>
          <Button size="sm" onClick={() => setScanOpen(true)}>
            <Camera className="h-3.5 w-3.5" />
            Open QR Gate Camera
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricTile
          label="Today's Total Visits"
          value={stats?.todayTotal ?? 0}
          icon={Users}
          pastel="blue"
        />
        <MetricTile
          label="Currently Inside Library"
          value={stats?.currentlyInside ?? 0}
          icon={UserCheck}
          pastel="emerald"
          tone="success"
        />
        <MetricTile
          label="Checked Out Today"
          value={stats?.checkedOutToday ?? 0}
          icon={LogOut}
          pastel="purple"
        />
      </div>

      {/* Live Gate Desk Input */}
      <SurfaceCard className="p-5 space-y-4">
        <form onSubmit={handleManualSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <QrCode className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={manualQuery}
              onChange={(e) => setManualQuery(e.target.value)}
              placeholder="Scan Student QR, Golden Founder QR, Student ID, Roll Number, or Email..."
              className="pl-9"
              autoFocus
            />
          </div>
          <Button type="submit" loading={scanMutation.isPending} disabled={!manualQuery.trim()}>
            <LogIn className="h-4 w-4" />
            Record Entry / Exit
          </Button>
        </form>

        {lastFeedback && (
          <div
            className={`flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-xs font-medium ${
              lastFeedback.action === 'check_in'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'
                : 'bg-blue-50 text-blue-800 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                <strong>{lastFeedback.message}</strong> · Roll {lastFeedback.rollNumber}
              </span>
              {lastFeedback.founderBadge && (
                <span className="inline-flex items-center gap-1 rounded-md border border-[#D4AF37]/70 bg-[#0A0B0F] px-2 py-0.5 text-[10px] font-semibold text-[#F6DF9C]">
                  <Award className="h-3 w-3 text-[#D4AF37]" />
                  Verified QIVORA Founder · {lastFeedback.founderBadge.founderNumber}
                </span>
              )}
            </div>
            <span className="font-mono uppercase">{lastFeedback.action.replace('_', ' ')}</span>
          </div>
        )}
      </SurfaceCard>

      {/* Attendance Table */}
      <SurfaceCard className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Recent Library Visits
          </h2>
        </div>
        {!entries.length ? (
          <div className="p-6">
            <EmptyState
              title="No attendance entries recorded yet"
              description="Scan a student Digital ID QR code or enter their roll number above to log reading room check-ins."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Roll / ID</th>
                  <th className="px-4 py-3">Course</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">Check-In</th>
                  <th className="px-4 py-3">Check-Out</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                      {entry.studentName}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">
                      {entry.rollNumber} · {entry.studentIdCode}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{entry.courseName || '—'}</td>
                    <td className="px-4 py-3 uppercase font-mono text-slate-500">{entry.method}</td>
                    <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">
                      {formatDateTime(entry.checkInAt)}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500">
                      {entry.checkOutAt ? formatDateTime(entry.checkOutAt) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={entry.checkOutAt ? 'returned' : 'active'} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!entry.checkOutAt ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => checkoutMutation.mutate(entry.id)}
                          loading={checkoutMutation.isPending}
                        >
                          Check Out
                        </Button>
                      ) : (
                        <span className="text-slate-400">Completed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      <QrScannerModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        title="Scan Student Digital ID at Entry Gate"
        placeholder="Scan QR or enter Student ID / Roll Number..."
        onScan={(code) => scanMutation.mutate({ query: code, method: 'qr' })}
      />
    </div>
  );
}
