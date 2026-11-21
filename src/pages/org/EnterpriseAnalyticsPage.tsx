import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  BookOpen,
  Download,
  FileSpreadsheet,
  FileText,
  IndianRupee,
  Repeat,
  Users,
} from 'lucide-react';
import {
  Button,
  EmptyState,
  Input,
  MetricTile,
  SkeletonRows,
  SurfaceCard,
} from '../../components/ui/primitives.tsx';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import {
  downloadReportPdf,
  exportToCsv,
  exportToExcel,
  formatCurrency,
} from '../../lib/utils.ts';

interface EnterpriseAnalyticsResponse {
  range: { startDate: string; endDate: string };
  summary: {
    totalStudents: number;
    activeStudents: number;
    totalBooks: number;
    totalCopies: number;
    availableCopies: number;
    issuedCopies: number;
    overdueBooks: number;
    issuesInRange: number;
    returnsInRange: number;
    totalVisits: number;
    fineGenerated: number;
    fineCollected: number;
  };
  dailyCirculation: Array<{ date: string; issued: number; returned: number; overdue: number }>;
  monthlyCirculation: Array<{ month: string; issued: number; returned: number }>;
  monthlyRegistrations: Array<{ month: string; registrations: number }>;
  courseWiseMembership: Array<{ course: string; count: number }>;
  categoryDistribution: Array<{ category: string; count: number }>;
  inventoryBreakdown: Array<{ name: string; value: number }>;
  monthlyVisitors: Array<{ month: string; visits: number }>;
  peakVisitingHours: Array<{ hour: string; visits: number }>;
  fineCollectionTrends: Array<{ month: string; collected: number }>;
  mostBorrowedBooks: Array<{ title: string; borrows: number }>;
  mostActiveStudents: Array<{ name: string; rollNumber: string; borrows: number }>;
}

const PIE_COLORS = ['#10B981', '#2563EB', '#7C3AED', '#EF4444'];

function ChartCard({
  title,
  subtitle,
  empty,
  children,
}: {
  title: string;
  subtitle?: string;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <SurfaceCard className="p-5 flex flex-col">
      <div className="mb-4">
        <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {empty ? (
        <div className="flex-1 flex items-center justify-center py-10 text-xs text-slate-400">
          No recorded data yet for this metric.
        </div>
      ) : (
        <div className="h-64 w-full">{children}</div>
      )}
    </SurfaceCard>
  );
}

export function EnterpriseAnalyticsPage() {
  const { activeWorkspace } = useAuth();
  const [range, setRange] = useState<'7d' | '30d' | '90d' | 'year' | 'custom'>('30d');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const orgName =
    activeWorkspace?.type === 'organization'
      ? activeWorkspace.membership.organizationName
      : 'QIVORA Library';

  const queryParams =
    range === 'custom' && fromDate && toDate
      ? `?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`
      : `?range=${range === 'custom' ? '30d' : range}`;

  const { data, isLoading } = useQuery({
    queryKey: ['enterprise-analytics', range, fromDate, toDate],
    queryFn: () => apiRequest<EnterpriseAnalyticsResponse>(`/org/analytics/enterprise${queryParams}`),
  });

  const handleExportCsv = () => {
    if (!data) return;
    exportToCsv(`qivora-analytics-${range}.csv`, data.dailyCirculation);
  };

  const handleExportExcel = () => {
    if (!data) return;
    const rows = data.mostBorrowedBooks.length
      ? data.mostBorrowedBooks
      : [{ title: 'Summary', borrows: data.summary.issuesInRange }];
    exportToExcel(`qivora-analytics-${range}`, rows);
  };

  const handleExportPdf = () => {
    if (!data) return;
    const s = data.summary;
    downloadReportPdf({
      title: 'Enterprise Library Operations & Circulation Report',
      organizationName: orgName,
      dateRangeLabel: `Window: ${range.toUpperCase()}`,
      metrics: [
        { label: 'Total Students', value: String(s.totalStudents) },
        { label: 'Catalog Titles', value: String(s.totalBooks) },
        { label: 'Physical Copies', value: String(s.totalCopies) },
        { label: 'Issues (Range)', value: String(s.issuesInRange) },
        { label: 'Overdue Loans', value: String(s.overdueBooks) },
        { label: 'Fines Collected', value: formatCurrency(s.fineCollected) },
      ],
      rows: data.mostBorrowedBooks.map((b, i) => ({
        Rank: i + 1,
        Title: b.title,
        TotalBorrows: b.borrows,
      })),
    });
  };

  if (isLoading) return <SkeletonRows rows={7} />;
  if (!data) {
    return (
      <EmptyState
        title="Analytics unavailable"
        description="Unable to load organization analytics right now."
      />
    );
  }

  const s = data.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Enterprise Analytics & Reports
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Real-time PostgreSQL intelligence across circulation, inventory utilization, student engagement, visits, and fine recovery.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCsv}>
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportExcel}>
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Excel
          </Button>
          <Button size="sm" onClick={handleExportPdf}>
            <FileText className="h-3.5 w-3.5" />
            PDF Report
          </Button>
        </div>
      </div>

      {/* Date Range Filter Bar */}
      <SurfaceCard className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: '7d' as const, label: 'Last 7 Days' },
            { id: '30d' as const, label: 'Last 30 Days' },
            { id: '90d' as const, label: 'Last 90 Days' },
            { id: 'year' as const, label: 'Past 12 Months' },
            { id: 'custom' as const, label: 'Custom Range' },
          ].map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setRange(preset.id)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                range === preset.id
                  ? 'bg-gradient-to-r from-[#2563EB] to-[#6D28D9] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {range === 'custom' && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-8 w-36 text-xs"
            />
            <span className="text-xs text-slate-400">to</span>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-8 w-36 text-xs"
            />
          </div>
        )}
      </SurfaceCard>

      {/* Top KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricTile label="Active Students" value={s.activeStudents} subtext={`of ${s.totalStudents} total`} icon={Users} pastel="blue" />
        <MetricTile label="Catalog Titles" value={s.totalBooks} subtext={`${s.totalCopies} copies`} icon={BookOpen} pastel="purple" />
        <MetricTile label="Issues (Window)" value={s.issuesInRange} subtext={`${s.returnsInRange} returned`} icon={Repeat} pastel="indigo" />
        <MetricTile label="Overdue Books" value={s.overdueBooks} tone={s.overdueBooks > 0 ? 'danger' : 'default'} icon={AlertTriangle} pastel="rose" />
        <MetricTile label="Library Visits" value={s.totalVisits} pastel="cyan" />
        <MetricTile label="Fines Collected" value={formatCurrency(s.fineCollected)} subtext={`Gen: ${formatCurrency(s.fineGenerated)}`} icon={IndianRupee} pastel="emerald" tone="success" />
      </div>

      {/* Primary Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard
          title="Daily Issue vs Return Trend"
          subtitle="Circulation volume across the selected date window"
          empty={!data.dailyCirculation.length}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.dailyCirculation}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.4} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Area type="monotone" dataKey="issued" name="Issued" stroke="#2563EB" fill="#3B82F6" fillOpacity={0.2} />
              <Area type="monotone" dataKey="returned" name="Returned" stroke="#10B981" fill="#10B981" fillOpacity={0.2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Monthly Circulation Volume"
          subtitle="All-time monthly borrowing & return performance"
          empty={!data.monthlyCirculation.length}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.monthlyCirculation}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.4} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="issued" name="Issued" fill="#4F46E5" radius={[6, 6, 0, 0]} />
              <Bar dataKey="returned" name="Returned" fill="#10B981" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Inventory, Categories & Membership */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <ChartCard
          title="Inventory Status Distribution"
          subtitle="Available vs Issued vs Reserved physical copies"
          empty={!data.inventoryBreakdown.length}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data.inventoryBreakdown}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={52}
                outerRadius={82}
                paddingAngle={3}
              >
                {data.inventoryBreakdown.map((_, idx) => (
                  <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Course-Wise Student Membership"
          subtitle="Active student distribution across courses"
          empty={!data.courseWiseMembership.length}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.courseWiseMembership}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.4} />
              <XAxis dataKey="course" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" name="Students" fill="#7C3AED" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Category-Wise Book Catalog"
          subtitle="Active titles grouped by library category"
          empty={!data.categoryDistribution.length}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.categoryDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.4} />
              <XAxis dataKey="category" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" name="Titles" fill="#2563EB" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Registrations, Visitors, Peak Hours, Fines */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard
          title="Monthly Student Registrations"
          subtitle="Growth in verified digital library members"
          empty={!data.monthlyRegistrations.length}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.monthlyRegistrations}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.4} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="registrations" name="New Members" stroke="#4F46E5" strokeWidth={2.5} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Fine Collection Trends"
          subtitle="Settled fine payments by month"
          empty={!data.fineCollectionTrends.length}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.fineCollectionTrends}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.4} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Area type="monotone" dataKey="collected" name="Collected (₹)" stroke="#10B981" fill="#10B981" fillOpacity={0.22} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Monthly Reading Room Visitors"
          subtitle="Gate QR & manual check-ins per month"
          empty={!data.monthlyVisitors.length}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.monthlyVisitors}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.4} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Area type="monotone" dataKey="visits" name="Visits" stroke="#0EA5E9" fill="#0EA5E9" fillOpacity={0.2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Peak Visiting Hours"
          subtitle="Hourly attendance distribution across library hours"
          empty={!data.peakVisitingHours.length}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.peakVisitingHours}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.4} />
              <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="visits" name="Check-Ins" fill="#F59E0B" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Leaderboards: Most Borrowed Books & Most Active Readers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard
          title="Most Borrowed Books"
          subtitle="Top circulating titles in your catalog"
          empty={!data.mostBorrowedBooks.length}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.mostBorrowedBooks} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.4} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="title" width={140} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="borrows" name="Borrows" fill="#2563EB" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <SurfaceCard className="p-5">
          <div className="mb-4">
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
              Most Active Student Readers
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Top readers ranked by total verified circulation records
            </p>
          </div>
          {!data.mostActiveStudents.length ? (
            <div className="py-10 text-center text-xs text-slate-400">
              No borrowing leaderboards recorded yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.mostActiveStudents.map((stu, idx) => (
                <div key={idx} className="flex items-center justify-between py-2.5 text-xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-50 font-mono font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-white truncate">
                        {stu.name}
                      </div>
                      <div className="font-mono text-[11px] text-slate-400">{stu.rollNumber}</div>
                    </div>
                  </div>
                  <div className="font-mono font-semibold text-[#4F46E5] dark:text-indigo-400">
                    {stu.borrows} loan{stu.borrows === 1 ? '' : 's'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}
