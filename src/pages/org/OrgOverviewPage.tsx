import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  BookPlus,
  BookmarkCheck,
  Camera,
  ClipboardCheck,
  CornerDownLeft,
  IdCard,
  IndianRupee,
  Palette,
  Repeat,
  Search,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { QrScannerModal } from '../../components/scanner/QrScannerModal.tsx';
import {
  Button,
  EmptyState,
  MetricTile,
  QuickActionTile,
  SkeletonRows,
  StatusText,
  SurfaceCard,
  WelcomeBanner,
} from '../../components/ui/primitives.tsx';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatCurrency, formatDate } from '../../lib/utils.ts';

export function OrgOverviewPage() {
  const { user, activeWorkspace } = useAuth();
  const navigate = useNavigate();
  const [scanOpen, setScanOpen] = useState(false);

  const role =
    activeWorkspace?.type === 'organization' ? activeWorkspace.membership.roleSlug : 'librarian';
  const orgId =
    activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationId : null;

  const { data, isLoading } = useQuery({
    queryKey: ['org-overview', orgId],
    queryFn: () =>
      apiRequest<{
        organization: { name: string; code: string; academicSession?: string } | null;
        metrics: {
          totalStudents: number;
          activeStudents: number;
          pendingApplications: number;
          totalBookTitles: number;
          totalPhysicalCopies: number;
          availableCopies: number;
          issuedCopies: number;
          overdueBooks: number;
          activeReservations: number;
          todayVisitors: number;
          todayIssued: number;
          todayReturned: number;
          fineGenerated: number;
          fineCollected: number;
        };
        recentTransactions: Array<{
          id: string;
          receiptNumber: string;
          status: string;
          issuedAt: string;
          dueAt: string;
          returnedAt?: string | null;
          bookTitle: string;
          studentName: string;
          barcode: string;
        }>;
      }>('/org/overview'),
    enabled: Boolean(orgId),
  });

  const handleQuickScanStudent = async (scanned: string) => {
    try {
      const res = await apiRequest<{
        student: { fullName: string; studentIdCode: string; collegeRollNumber: string };
        eligibility: { eligible: boolean; activeLoansCount: number; maxBooksAllowed: number };
      }>(`/org/circulation/resolve-student?q=${encodeURIComponent(scanned)}`);
      toast.success(
        `Verified: ${res.student.fullName} (${res.student.studentIdCode}) · ${res.eligibility.activeLoansCount}/${res.eligibility.maxBooksAllowed} active loans`
      );
      navigate(`/org/circulation?student=${encodeURIComponent(res.student.studentIdCode)}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Student ID could not be resolved.');
    }
  };

  if (isLoading) return <SkeletonRows rows={6} />;

  const m = data?.metrics;
  const totalCopies = m?.totalPhysicalCopies ?? 0;
  const availCopies = m?.availableCopies ?? 0;
  const inventoryReadyPct = totalCopies > 0 ? Math.round((availCopies / totalCopies) * 100) : 100;
  const activeStudentsPct =
    (m?.totalStudents ?? 0) > 0
      ? Math.round(((m?.activeStudents ?? 0) / (m?.totalStudents ?? 1)) * 100)
      : 100;

  return (
    <div className="space-y-6">
      {/* Reference Blue-Purple Welcome Banner */}
      <WelcomeBanner
        name={user?.fullName || (role === 'college_admin' ? 'College Administrator' : 'Library Officer')}
        roleLabel={role === 'college_admin' ? 'College Admin' : 'Librarian'}
        organizationName={data?.organization?.name}
        subtitle={
          role === 'college_admin'
            ? `Academic Session ${data?.organization?.academicSession || '2026-2027'} · Code ${data?.organization?.code || 'ORG'} · Institutional library command center.`
            : `Circulation & Operations Desk · Code ${data?.organization?.code || 'ORG'} · Fast QR/barcode issue, return & verification.`
        }
        avatarUrl={user?.avatarUrl}
        progressLabel={role === 'college_admin' ? 'Active Membership Rate' : 'Shelf Inventory Ready'}
        progressValue={role === 'college_admin' ? activeStudentsPct : inventoryReadyPct}
        progressSubtext={
          role === 'college_admin'
            ? `${m?.activeStudents ?? 0} of ${m?.totalStudents ?? 0} students active`
            : `${availCopies} of ${totalCopies} copies ready on shelf`
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => setScanOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 px-3.5 py-2 text-xs font-semibold text-white transition-colors cursor-pointer"
            >
              <Camera className="h-3.5 w-3.5" />
              Scan Student QR
            </button>
            <Link
              to="/org/circulation?tab=issue"
              className="inline-flex items-center gap-2 rounded-xl bg-white text-[#2563EB] hover:bg-blue-50 px-3.5 py-2 text-xs font-semibold shadow-xs transition-colors"
            >
              <Repeat className="h-3.5 w-3.5" />
              Issue Book
            </Link>
          </>
        }
      />

      {/* Pastel Stat Cards Grid — Strictly Real PostgreSQL Counts */}
      {role === 'college_admin' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <MetricTile
            label="Registered Students"
            value={m?.totalStudents ?? 0}
            subtext={`${m?.activeStudents ?? 0} active members`}
            icon={Users}
            pastel="blue"
            to="/org/students"
          />
          <MetricTile
            label="Pending Applications"
            value={m?.pendingApplications ?? 0}
            subtext="Awaiting verification"
            tone={(m?.pendingApplications ?? 0) > 0 ? 'warning' : 'default'}
            icon={ClipboardCheck}
            pastel="amber"
            to="/org/applications"
          />
          <MetricTile
            label="Book Catalog"
            value={m?.totalBookTitles ?? 0}
            subtext={`${m?.totalPhysicalCopies ?? 0} physical copies`}
            icon={BookOpen}
            pastel="purple"
            to="/org/books"
          />
          <MetricTile
            label="Available Copies"
            value={m?.availableCopies ?? 0}
            tone="success"
            subtext={`${m?.issuedCopies ?? 0} currently issued`}
            icon={BookmarkCheck}
            pastel="emerald"
            to="/org/books"
          />
          <MetricTile
            label="Overdue Books"
            value={m?.overdueBooks ?? 0}
            subtext="Needs immediate follow-up"
            tone={(m?.overdueBooks ?? 0) > 0 ? 'danger' : 'default'}
            icon={AlertTriangle}
            pastel="rose"
            to="/org/circulation?tab=loans"
          />
          <MetricTile
            label="Active Reservations"
            value={m?.activeReservations ?? 0}
            subtext="Queued & ready holds"
            icon={Repeat}
            pastel="indigo"
            to="/org/reservations"
          />
          <MetricTile
            label="Fines Generated"
            value={formatCurrency(m?.fineGenerated)}
            subtext={`Collected: ${formatCurrency(m?.fineCollected)}`}
            icon={IndianRupee}
            pastel="emerald"
            to="/org/fines"
          />
          <MetricTile
            label="Today's Circulation"
            value={`${m?.todayIssued ?? 0} / ${m?.todayReturned ?? 0}`}
            subtext={`Issued / Returned · ${m?.todayVisitors ?? 0} visits`}
            icon={UserCheck}
            pastel="cyan"
            to="/org/attendance"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricTile label="Today Issued" value={m?.todayIssued ?? 0} icon={Repeat} pastel="blue" to="/org/circulation" />
          <MetricTile label="Today Returned" value={m?.todayReturned ?? 0} tone="success" icon={CornerDownLeft} pastel="emerald" to="/org/circulation?tab=return" />
          <MetricTile label="Currently Issued" value={m?.issuedCopies ?? 0} icon={BookOpen} pastel="indigo" to="/org/circulation?tab=loans" />
          <MetricTile
            label="Overdue Books"
            value={m?.overdueBooks ?? 0}
            tone={(m?.overdueBooks ?? 0) > 0 ? 'danger' : 'default'}
            icon={AlertTriangle}
            pastel="rose"
            to="/org/circulation?tab=loans"
          />
          <MetricTile label="Reservations" value={m?.activeReservations ?? 0} icon={BookmarkCheck} pastel="purple" to="/org/reservations" />
          <MetricTile label="Active Students" value={m?.activeStudents ?? 0} icon={Users} pastel="cyan" to="/org/students" />
        </div>
      )}

      {/* Colorful Pastel Quick Action Grid (Role-Tailored) */}
      <div className="space-y-2.5">
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
          Quick Actions
        </h2>
        {role === 'college_admin' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <QuickActionTile label="Add Book" description="Catalog & ISBN lookup" icon={BookPlus} pastel="blue" to="/org/books?action=new" />
            <QuickActionTile label="Add Student" description="Register member" icon={UserPlus} pastel="purple" to="/org/students?action=new" />
            <QuickActionTile label="Approve Apps" description={`${m?.pendingApplications ?? 0} pending`} icon={ClipboardCheck} pastel="amber" to="/org/applications" />
            <QuickActionTile label="ID Templates" description="Visual card studio" icon={Palette} pastel="indigo" to="/org/id-studio" />
            <QuickActionTile label="View Reports" description="Enterprise analytics" icon={BarChart3} pastel="emerald" to="/org/reports" />
            <QuickActionTile label="Manage Staff" description="Librarian accounts" icon={UserCog} pastel="cyan" to="/org/librarians" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <QuickActionTile label="Issue Book" description="Scan ID & barcode" icon={Repeat} pastel="blue" to="/org/circulation?tab=issue" />
            <QuickActionTile label="Return Book" description="Fine calc & receipt" icon={CornerDownLeft} pastel="emerald" to="/org/circulation?tab=return" />
            <QuickActionTile label="Scan Student" description="Verify QR Digital ID" icon={Camera} pastel="purple" onClick={() => setScanOpen(true)} />
            <QuickActionTile label="Add Book" description="Add title & copies" icon={BookPlus} pastel="indigo" to="/org/books?action=new" />
            <QuickActionTile label="Search Catalog" description="Shelf & availability" icon={Search} pastel="cyan" to="/org/books" />
            <QuickActionTile label="Overdue Books" description={`${m?.overdueBooks ?? 0} overdue`} icon={IdCard} pastel="rose" to="/org/circulation?tab=loans" />
          </div>
        )}
      </div>

      {/* Recent Circulation Transactions */}
      <SurfaceCard className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Recent Circulation Transactions
          </h2>
          <Link
            to="/org/circulation"
            className="text-xs font-semibold text-[#4F46E5] hover:underline dark:text-indigo-400"
          >
            Open Circulation Desk
          </Link>
        </div>
        {!data?.recentTransactions?.length ? (
          <div className="p-6">
            <EmptyState
              title="No circulation transactions yet"
              description="Once you register students and add books with physical copies, issue and return activity will appear here in real time."
              action={
                <Link to="/org/circulation">
                  <Button size="sm">Go to Issue & Return</Button>
                </Link>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3">Receipt</th>
                  <th className="px-4 py-3">Book Title</th>
                  <th className="px-4 py-3">Copy Barcode</th>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Issued</th>
                  <th className="px-4 py-3">Due</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.recentTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono tabular-nums">{tx.receiptNumber}</td>
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                      {tx.bookTitle}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500">{tx.barcode}</td>
                    <td className="px-4 py-3">{tx.studentName}</td>
                    <td className="px-4 py-3 font-mono tabular-nums text-slate-500">
                      {formatDate(tx.issuedAt)}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-slate-500">
                      {formatDate(tx.dueAt)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={tx.status} />
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
        title="Scan Student Digital ID"
        placeholder="Scan QR or enter Student ID / Roll Number..."
        onScan={handleQuickScanStudent}
      />
    </div>
  );
}
