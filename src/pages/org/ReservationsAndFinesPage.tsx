import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  Plus,
  Receipt,
  Search,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import {
  downloadReceiptPdf,
  formatCurrency,
  formatDate,
  formatDateTime,
} from '../../lib/utils.ts';
import {
  Button,
  EmptyState,
  Field,
  Input,
  MetricTile,
  Modal,
  Select,
  SkeletonRows,
  StatusText,
  SurfaceCard,
  Textarea,
} from '../../components/ui/primitives.tsx';

interface ReservationItem {
  id: string;
  bookId: string;
  studentId: string;
  queuePosition: number;
  status: string;
  notifiedAt?: string | null;
  expiresAt?: string | null;
  fulfilledAt?: string | null;
  createdAt: string;
  bookTitle: string;
  bookIsbn: string;
  studentName: string;
  studentIdCode: string;
  rollNumber: string;
}

interface FineItem {
  id: string;
  studentId: string;
  loanId?: string | null;
  amount: string;
  paidAmount: string;
  waivedAmount: string;
  balance: number;
  reason: string;
  status: string;
  waiverReason?: string | null;
  createdAt: string;
  studentName: string;
  studentIdCode: string;
  rollNumber: string;
}

interface PaymentItem {
  id: string;
  fineId: string;
  studentId: string;
  studentName: string;
  amount: string;
  paymentMethod: string;
  receiptNumber: string;
  referenceNote?: string | null;
  paidAt: string;
}

interface SimpleStudent {
  id: string;
  fullName: string;
  studentIdCode: string;
  collegeRollNumber: string;
  status: string;
}

interface SimpleBook {
  id: string;
  title: string;
  isbn: string;
  inventory?: { available: number; total: number };
}

// ============================================================================
// RESERVATION QUEUE MANAGEMENT
// ============================================================================

export function ReservationsPage() {
  const { activeWorkspace } = useAuth();
  const orgId = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationId : null;
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedBookId, setSelectedBookId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['org-reservations', orgId],
    queryFn: () => apiRequest<{ reservations: ReservationItem[] }>('/org/reservations'),
    enabled: Boolean(orgId),
  });

  const { data: studentsData } = useQuery({
    queryKey: ['org-students-for-res', orgId],
    queryFn: () => apiRequest<{ students: SimpleStudent[] }>('/org/students'),
    enabled: Boolean(orgId) && createOpen,
  });

  const { data: booksData } = useQuery({
    queryKey: ['org-books-for-res', orgId],
    queryFn: () => apiRequest<{ books: SimpleBook[] }>('/org/books'),
    enabled: Boolean(orgId) && createOpen,
  });

  const list = data?.reservations || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.bookTitle.toLowerCase().includes(q) ||
        r.bookIsbn.toLowerCase().includes(q) ||
        r.studentName.toLowerCase().includes(q) ||
        r.rollNumber.toLowerCase().includes(q) ||
        r.studentIdCode.toLowerCase().includes(q)
      );
    });
  }, [list, statusFilter, search]);

  const queuedCount = list.filter((r) => r.status === 'queued').length;
  const readyCount = list.filter((r) => r.status === 'ready').length;
  const fulfilledCount = list.filter((r) => r.status === 'fulfilled').length;

  const handleStatusChange = async (id: string, status: 'ready' | 'fulfilled' | 'cancelled' | 'expired') => {
    setUpdatingId(id);
    try {
      await apiRequest(`/org/reservations/${id}/status`, {
        method: 'PATCH',
        body: { status },
      });
      toast.success(
        status === 'ready'
          ? 'Reservation marked ready for pickup and student notified.'
          : `Reservation status updated to ${status}.`
      );
      queryClient.invalidateQueries({ queryKey: ['org-reservations'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to update reservation.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCreateReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudentId || !selectedBookId) {
      toast.error('Please select both a student and a book title.');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/org/reservations', {
        method: 'POST',
        body: { studentId: selectedStudentId, bookId: selectedBookId },
      });
      toast.success('Student added to the book reservation queue.');
      setCreateOpen(false);
      setSelectedStudentId('');
      setSelectedBookId('');
      queryClient.invalidateQueries({ queryKey: ['org-reservations'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to create reservation.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
            Book Reservation Queue
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Manage waiting lists, pickup hold windows, and automated student notifications when copies return.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New Reservation
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricTile label="Total Requests" value={list.length} />
        <MetricTile label="Queued" value={queuedCount} tone={queuedCount > 0 ? 'warning' : 'default'} />
        <MetricTile label="Ready for Pickup" value={readyCount} tone={readyCount > 0 ? 'success' : 'default'} />
        <MetricTile label="Fulfilled" value={fulfilledCount} />
      </div>

      <SurfaceCard className="p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by book title, ISBN, student name, or roll number..."
              className="pl-9"
            />
          </div>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="sm:w-48"
          >
            <option value="all">All Statuses</option>
            <option value="queued">Queued</option>
            <option value="ready">Ready for Pickup</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
      </SurfaceCard>

      <SurfaceCard className="overflow-hidden">
        {isLoading ? (
          <div className="p-5">
            <SkeletonRows rows={6} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No reservations found"
              description="Book reservation requests created by students or circulation staff will appear here in FIFO queue order."
              action={
                <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                  Add Reservation
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Queue</th>
                  <th className="px-4 py-3">Book Title</th>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Hold / Created</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-mono text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                      #{item.queuePosition}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">{item.bookTitle}</div>
                      <div className="text-xs font-mono text-slate-500">ISBN {item.bookIsbn}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">{item.studentName}</div>
                      <div className="text-xs font-mono text-slate-500">
                        {item.studentIdCode} · Roll {item.rollNumber}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={item.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                      <div>Requested: {formatDate(item.createdAt)}</div>
                      {item.expiresAt && (
                        <div className="text-amber-700 dark:text-amber-400 flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3" />
                          Hold until {formatDate(item.expiresAt)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {item.status === 'queued' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={updatingId === item.id}
                            onClick={() => handleStatusChange(item.id, 'ready')}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Mark Ready
                          </Button>
                        )}
                        {item.status === 'ready' && (
                          <>
                            <Button
                              size="sm"
                              disabled={updatingId === item.id}
                              onClick={() => handleStatusChange(item.id, 'fulfilled')}
                            >
                              Fulfill
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={updatingId === item.id}
                              onClick={() => handleStatusChange(item.id, 'expired')}
                            >
                              Expire
                            </Button>
                          </>
                        )}
                        {(item.status === 'queued' || item.status === 'ready') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={updatingId === item.id}
                            onClick={() => handleStatusChange(item.id, 'cancelled')}
                            className="text-red-600 hover:text-red-700 dark:text-red-400"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Cancel
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Place Book Reservation"
        description="Reserve a title on behalf of an active student in queue order."
      >
        <form onSubmit={handleCreateReservation} className="space-y-4">
          <Field label="Student" required>
            <Select
              value={selectedStudentId}
              onChange={(e) => setSelectedStudentId(e.target.value)}
              required
            >
              <option value="">Select active student...</option>
              {(studentsData?.students || [])
                .filter((s) => s.status === 'active')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName} ({s.collegeRollNumber} · {s.studentIdCode})
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Book Title" required>
            <Select
              value={selectedBookId}
              onChange={(e) => setSelectedBookId(e.target.value)}
              required
            >
              <option value="">Select book title...</option>
              {(booksData?.books || []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title} (ISBN {b.isbn} · {b.inventory?.available ?? 0}/{b.inventory?.total ?? 0} avail)
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Add to Queue
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ============================================================================
// LIBRARY FINES & OPERATIONAL COUNTER PAYMENTS (NO SAAS SUBSCRIPTION BILLING)
// ============================================================================

export function FinesAndPaymentsPage() {
  const { activeWorkspace } = useAuth();
  const orgId = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationId : null;
  const orgName = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationName : 'QIVORA Library';
  const roleSlug = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.roleSlug : null;
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'fines' | 'payments'>('fines');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  // Create manual fine modal
  const [newFineOpen, setNewFineOpen] = useState(false);
  const [fineStudentId, setFineStudentId] = useState('');
  const [fineAmount, setFineAmount] = useState('');
  const [fineReason, setFineReason] = useState('');
  const [creatingFine, setCreatingFine] = useState(false);

  // Payment modal
  const [payFine, setPayFine] = useState<FineItem | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'card_counter' | 'bank_transfer' | 'upi_counter'>('cash');
  const [payRef, setPayRef] = useState('');
  const [paying, setPaying] = useState(false);

  // Waiver modal
  const [waiveFine, setWaiveFine] = useState<FineItem | null>(null);
  const [waiveReason, setWaiveReason] = useState('');
  const [waiving, setWaiving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['org-fines', orgId],
    queryFn: () => apiRequest<{ fines: FineItem[]; payments: PaymentItem[] }>('/org/fines'),
    enabled: Boolean(orgId),
  });

  const { data: settingsData } = useQuery({
    queryKey: ['org-settings', orgId],
    queryFn: () => apiRequest<{ settings: { currencySymbol?: string } | null }>('/org/settings'),
    enabled: Boolean(orgId),
  });

  const { data: studentsData } = useQuery({
    queryKey: ['org-students-for-fines', orgId],
    queryFn: () => apiRequest<{ students: SimpleStudent[] }>('/org/students'),
    enabled: Boolean(orgId) && newFineOpen,
  });

  const currency = settingsData?.settings?.currencySymbol || '₹';
  const fineList = data?.fines || [];
  const paymentList = data?.payments || [];

  const totals = useMemo(() => {
    const generated = fineList.reduce((s, f) => s + Number(f.amount || 0), 0);
    const collected = paymentList.reduce((s, p) => s + Number(p.amount || 0), 0);
    const waived = fineList.reduce((s, f) => s + Number(f.waivedAmount || 0), 0);
    const outstanding = fineList.reduce((s, f) => s + Number(f.balance || 0), 0);
    return { generated, collected, waived, outstanding };
  }, [fineList, paymentList]);

  const filteredFines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fineList.filter((f) => {
      if (statusFilter !== 'all' && f.status !== statusFilter) return false;
      if (!q) return true;
      return (
        f.studentName.toLowerCase().includes(q) ||
        f.rollNumber.toLowerCase().includes(q) ||
        f.studentIdCode.toLowerCase().includes(q) ||
        f.reason.toLowerCase().includes(q)
      );
    });
  }, [fineList, statusFilter, search]);

  const handleCreateFine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fineStudentId || !fineAmount || Number(fineAmount) <= 0 || fineReason.trim().length < 3) {
      toast.error('Select a student, enter a positive fine amount, and provide a clear reason.');
      return;
    }
    setCreatingFine(true);
    try {
      await apiRequest('/org/fines', {
        method: 'POST',
        body: {
          studentId: fineStudentId,
          amount: Number(fineAmount),
          reason: fineReason.trim(),
        },
      });
      toast.success('Library fine recorded and student notified.');
      setNewFineOpen(false);
      setFineStudentId('');
      setFineAmount('');
      setFineReason('');
      queryClient.invalidateQueries({ queryKey: ['org-fines'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to create fine.');
    } finally {
      setCreatingFine(false);
    }
  };

  const openPayDialog = (fine: FineItem) => {
    setPayFine(fine);
    setPayAmount(fine.balance.toFixed(2));
    setPayMethod('cash');
    setPayRef('');
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payFine) return;
    const amt = Number(payAmount);
    if (!amt || amt <= 0) {
      toast.error('Enter a valid payment amount.');
      return;
    }
    setPaying(true);
    try {
      const res = await apiRequest<{ payment: PaymentItem }>(`/org/fines/${payFine.id}/pay`, {
        method: 'POST',
        body: {
          amount: amt,
          paymentMethod: payMethod,
          referenceNote: payRef.trim() || null,
        },
      });
      toast.success(`Counter payment recorded (${res.payment.receiptNumber}).`);
      downloadReceiptPdf({
        title: 'Library Fine Payment Receipt',
        receiptNumber: res.payment.receiptNumber,
        organizationName: orgName,
        lines: [
          { label: 'Student Name', value: payFine.studentName },
          { label: 'Student ID / Roll', value: `${payFine.studentIdCode} · ${payFine.rollNumber}` },
          { label: 'Fine Reason', value: payFine.reason },
          { label: 'Amount Paid', value: formatCurrency(res.payment.amount, currency) },
          { label: 'Payment Mode', value: payMethod.replace('_', ' ').toUpperCase() },
          { label: 'Reference', value: payRef.trim() || 'Counter Desk Receipt' },
          { label: 'Paid Date', value: formatDateTime(res.payment.paidAt) },
        ],
      });
      setPayFine(null);
      queryClient.invalidateQueries({ queryKey: ['org-fines'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to record payment.');
    } finally {
      setPaying(false);
    }
  };

  const handleWaiver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waiveFine || waiveReason.trim().length < 3) {
      toast.error('Please enter a valid audit reason (minimum 3 characters).');
      return;
    }
    setWaiving(true);
    try {
      const res = await apiRequest<{ message: string }>(`/org/fines/${waiveFine.id}/waive`, {
        method: 'POST',
        body: { reason: waiveReason.trim() },
      });
      toast.success(res.message || 'Waiver processed.');
      setWaiveFine(null);
      setWaiveReason('');
      queryClient.invalidateQueries({ queryKey: ['org-fines'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to process waiver.');
    } finally {
      setWaiving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
            Library Fines & Operational Payments
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Track overdue, damage, or lost-book assessments, collect counter payments with PDF receipts, and audit fine waivers.
          </p>
        </div>
        <Button onClick={() => setNewFineOpen(true)}>
          <Plus className="h-4 w-4" />
          Record Fine
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricTile label="Total Fines Assessed" value={formatCurrency(totals.generated, currency)} />
        <MetricTile
          label="Collected at Desk"
          value={formatCurrency(totals.collected, currency)}
          tone="success"
        />
        <MetricTile
          label="Outstanding Balance"
          value={formatCurrency(totals.outstanding, currency)}
          tone={totals.outstanding > 0 ? 'danger' : 'default'}
        />
        <MetricTile label="Waived Total" value={formatCurrency(totals.waived, currency)} />
      </div>

      {/* Explicit operational payment notice */}
      <SurfaceCard className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-900/60">
        <div className="text-xs text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-white">Operational Counter Ledger:</span>{' '}
          Cash, counter card swipe, bank transfer, and counter UPI entries are recorded with official receipts. Automated online payment gateways are not configured in Part 1.
        </div>
      </SurfaceCard>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-1">
          <button
            type="button"
            onClick={() => setActiveTab('fines')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors ${
              activeTab === 'fines'
                ? 'bg-[#1E3A8A] text-white dark:bg-[#2563EB]'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
            }`}
          >
            Fines Ledger ({fineList.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('payments')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors ${
              activeTab === 'payments'
                ? 'bg-[#1E3A8A] text-white dark:bg-[#2563EB]'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
            }`}
          >
            Payment Receipts ({paymentList.length})
          </button>
        </div>

        {activeTab === 'fines' && (
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search student or reason..."
                className="pl-9"
              />
            </div>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-40"
            >
              <option value="all">All Statuses</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partial</option>
              <option value="waiver_requested">Waiver Requested</option>
              <option value="paid">Paid</option>
              <option value="waived">Waived</option>
            </Select>
          </div>
        )}
      </div>

      <SurfaceCard className="overflow-hidden">
        {isLoading ? (
          <div className="p-5">
            <SkeletonRows rows={6} />
          </div>
        ) : activeTab === 'fines' ? (
          filteredFines.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No fine records found"
                description="Overdue return fines and manually assessed damage/lost book charges will appear here."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3 text-right">Assessed</th>
                    <th className="px-4 py-3 text-right">Paid / Waived</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredFines.map((fine) => (
                    <tr key={fine.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-white">{fine.studentName}</div>
                        <div className="text-xs font-mono text-slate-500">
                          {fine.studentIdCode} · Roll {fine.rollNumber}
                        </div>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <div className="text-xs text-slate-800 dark:text-slate-200">{fine.reason}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                          {formatDateTime(fine.createdAt)}
                        </div>
                        {fine.waiverReason && (
                          <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                            Waiver note: {fine.waiverReason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        {formatCurrency(fine.amount, currency)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-500">
                        <div>Paid: {formatCurrency(fine.paidAmount, currency)}</div>
                        {Number(fine.waivedAmount) > 0 && (
                          <div>Waived: {formatCurrency(fine.waivedAmount, currency)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums text-slate-900 dark:text-white">
                        {formatCurrency(fine.balance, currency)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusText status={fine.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {fine.balance > 0.01 ? (
                          <div className="inline-flex items-center gap-1.5">
                            <Button size="sm" onClick={() => openPayDialog(fine)}>
                              <CreditCard className="h-3.5 w-3.5" />
                              Collect
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setWaiveFine(fine);
                                setWaiveReason(fine.waiverReason || '');
                              }}
                            >
                              <ShieldAlert className="h-3.5 w-3.5" />
                              {roleSlug === 'college_admin' ? 'Approve Waiver' : 'Request Waiver'}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Settled</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : paymentList.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No counter payments recorded yet"
              description="Once library fines are collected at the desk, official payment receipts will be logged here."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Receipt No.</th>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Payment Method</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paymentList.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900 dark:text-white">
                      {p.receiptNumber}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                      {p.studentName}
                    </td>
                    <td className="px-4 py-3 text-xs uppercase text-slate-600 dark:text-slate-300">
                      {p.paymentMethod.replace('_', ' ')}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {p.referenceNote || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-slate-500 tabular-nums">
                      {formatDateTime(p.paidAt)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                      {formatCurrency(p.amount, currency)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          downloadReceiptPdf({
                            title: 'Library Fine Payment Receipt',
                            receiptNumber: p.receiptNumber,
                            organizationName: orgName,
                            lines: [
                              { label: 'Student Name', value: p.studentName },
                              { label: 'Amount Paid', value: formatCurrency(p.amount, currency) },
                              { label: 'Payment Method', value: p.paymentMethod.replace('_', ' ').toUpperCase() },
                              { label: 'Reference', value: p.referenceNote || 'Library Desk Payment' },
                              { label: 'Paid On', value: formatDateTime(p.paidAt) },
                            ],
                          })
                        }
                      >
                        <Download className="h-3.5 w-3.5" />
                        PDF
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      {/* Manual Fine Modal */}
      <Modal
        open={newFineOpen}
        onOpenChange={setNewFineOpen}
        title="Record Manual Library Fine"
        description="Assess a library charge (damage, lost copy, or late settlement) to a student account."
      >
        <form onSubmit={handleCreateFine} className="space-y-4">
          <Field label="Student" required>
            <Select value={fineStudentId} onChange={(e) => setFineStudentId(e.target.value)} required>
              <option value="">Select student...</option>
              {(studentsData?.students || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName} ({s.collegeRollNumber} · {s.studentIdCode})
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Fine Amount (${currency})`} required>
            <Input
              type="number"
              step="0.01"
              min="1"
              value={fineAmount}
              onChange={(e) => setFineAmount(e.target.value)}
              placeholder="e.g. 50.00"
              required
            />
          </Field>
          <Field label="Assessment Reason" required>
            <Textarea
              value={fineReason}
              onChange={(e) => setFineReason(e.target.value)}
              placeholder="e.g. Water damage to cover pages of copy BK-102931-001"
              required
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setNewFineOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={creatingFine}>
              <Receipt className="h-4 w-4" />
              Save Fine
            </Button>
          </div>
        </form>
      </Modal>

      {/* Collect Payment Modal */}
      <Modal
        open={Boolean(payFine)}
        onOpenChange={(o) => !o && setPayFine(null)}
        title="Record Counter Payment"
        description={
          payFine
            ? `${payFine.studentName} · Remaining balance ${formatCurrency(payFine.balance, currency)}`
            : undefined
        }
      >
        {payFine && (
          <form onSubmit={handleRecordPayment} className="space-y-4">
            <Field label={`Amount Received (${currency})`} required>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max={payFine.balance}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                required
              />
            </Field>
            <Field label="Counter Payment Method" required>
              <Select
                value={payMethod}
                onChange={(e) =>
                  setPayMethod(e.target.value as 'cash' | 'card_counter' | 'bank_transfer' | 'upi_counter')
                }
              >
                <option value="cash">Cash at Library Desk</option>
                <option value="upi_counter">UPI / QR at Counter</option>
                <option value="card_counter">Card Terminal at Counter</option>
                <option value="bank_transfer">Bank Transfer Reference</option>
              </Select>
            </Field>
            <Field label="Reference / Transaction Note" hint="Optional slip number or UPI reference ID">
              <Input
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="e.g. UPI Ref #429104"
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setPayFine(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={paying}>
                Confirm Payment & Download Receipt
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Waiver Modal */}
      <Modal
        open={Boolean(waiveFine)}
        onOpenChange={(o) => !o && setWaiveFine(null)}
        title={roleSlug === 'college_admin' ? 'Approve Fine Waiver' : 'Request Fine Waiver'}
        description={
          roleSlug === 'college_admin'
            ? 'Waiving this fine clears the remaining balance and logs your approval permanently in the audit trail.'
            : 'Librarians can submit waiver requests with justification for College Admin approval.'
        }
      >
        {waiveFine && (
          <form onSubmit={handleWaiver} className="space-y-4">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-xs space-y-1">
              <div className="font-semibold text-slate-900 dark:text-white">{waiveFine.studentName}</div>
              <div className="text-slate-500">{waiveFine.reason}</div>
              <div className="font-mono font-semibold text-slate-900 dark:text-white">
                Remaining Balance: {formatCurrency(waiveFine.balance, currency)}
              </div>
            </div>
            <Field label="Mandatory Waiver Justification" required>
              <Textarea
                value={waiveReason}
                onChange={(e) => setWaiveReason(e.target.value)}
                placeholder="Explain why this fine is being waived (recorded in immutable audit log)..."
                required
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setWaiveFine(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={waiving}>
                {roleSlug === 'college_admin' ? 'Approve & Waive Fine' : 'Submit Waiver Request'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
