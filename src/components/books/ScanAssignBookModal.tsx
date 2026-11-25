import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRightLeft,
  BookOpen,
  Camera,
  CheckCircle2,
  Download,
  QrCode,
  RotateCcw,
  ScanBarcode,
  Search,
  UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { QrScannerModal } from '../scanner/QrScannerModal.tsx';
import { Button, Input, Modal, Select, StatusText } from '../ui/primitives.tsx';
import { apiRequest } from '../../lib/api.ts';
import { downloadReceiptPdf, formatDate } from '../../lib/utils.ts';

interface ScanAssignBookModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  organizationName: string;
  onAssigned: () => void;
}

interface LookupCopyItem {
  id: string;
  barcode: string;
  accessionNumber?: string;
  status: string;
  rackCode?: string | null;
  shelfCode?: string | null;
  activeLoan?: {
    id: string;
    studentId: string;
    studentName?: string;
    studentRollNumber?: string;
    dueAt?: string;
  } | null;
}

interface CopyLookupResponse {
  matchedBy?: string;
  statusMessage?: string;
  inventory?: { total: number; available: number; issued: number; reserved: number };
  copy: LookupCopyItem | null;
  copies?: LookupCopyItem[];
  book: { id?: string; title: string; isbn: string; authorName?: string | null };
}

interface StudentListItem {
  id: string;
  studentIdCode: string;
  fullName: string;
  collegeRollNumber: string;
  email: string;
  status: string;
  courseName?: string | null;
  semesterName?: string | null;
}

interface ResolvedStudentEligibility {
  student: {
    id: string;
    fullName: string;
    studentIdCode: string;
    collegeRollNumber: string;
    status: string;
    courseName?: string | null;
    semesterName?: string | null;
  };
  eligibility: {
    eligible: boolean;
    activeLoansCount: number;
    maxBooksAllowed: number;
    loanDurationDays: number;
    outstandingFine: number;
    blockReason?: string | null;
  };
}

export function ScanAssignBookModal({
  open,
  onOpenChange,
  orgId,
  organizationName,
  onAssigned,
}: ScanAssignBookModalProps) {
  const [barcodeInput, setBarcodeInput] = useState('');
  const [bookLoading, setBookLoading] = useState(false);
  const [bookLookup, setBookLookup] = useState<CopyLookupResponse | null>(null);
  const [selectedCopyId, setSelectedCopyId] = useState<string>('');

  const [studentSearch, setStudentSearch] = useState('');
  const [studentEligibility, setStudentEligibility] = useState<ResolvedStudentEligibility | null>(null);
  const [checkingStudent, setCheckingStudent] = useState(false);

  const [scannerMode, setScannerMode] = useState<'book' | 'student' | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [returningCopy, setReturningCopy] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [receipt, setReceipt] = useState<{
    receiptNumber: string;
    issuedAt: string;
    dueAt: string;
    bookTitle: string;
    barcode: string;
    studentName: string;
    studentIdCode: string;
  } | null>(null);

  const { data: studentsData } = useQuery({
    queryKey: ['org-students', orgId],
    queryFn: () => apiRequest<{ students: StudentListItem[] }>('/org/students'),
    enabled: Boolean(open && orgId),
  });

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    const list = (studentsData?.students || []).filter((s) => s.status === 'active');
    if (!q) return list.slice(0, 12);
    return list
      .filter(
        (s) =>
          s.fullName.toLowerCase().includes(q) ||
          s.collegeRollNumber.toLowerCase().includes(q) ||
          s.studentIdCode.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q)
      )
      .slice(0, 15);
  }, [studentsData?.students, studentSearch]);

  const handleLookupBook = async (rawCode?: string) => {
    const code = (rawCode ?? barcodeInput).trim();
    if (!code) return;
    setBarcodeInput(code);
    setBookLoading(true);
    setReceipt(null);
    try {
      const res = await apiRequest<CopyLookupResponse>(
        `/org/copies/lookup?code=${encodeURIComponent(code)}&mode=issue`
      );
      setBookLookup(res);
      if (res.copy) {
        setSelectedCopyId(res.copy.id);
        if (res.copy.status !== 'available' && res.copy.status !== 'reserved') {
          toast.warning(res.statusMessage || `Copy ${res.copy.barcode} is currently ${res.copy.status}.`);
        } else {
          toast.success(`Scanned "${res.book.title}" (Copy ${res.copy.barcode}). Now select a student.`);
        }
      } else {
        setSelectedCopyId('');
        toast.warning(res.statusMessage || 'Book found, but no available physical copies are ready.');
      }
    } catch (err: unknown) {
      setBookLookup(null);
      setSelectedCopyId('');
      toast.error(err instanceof Error ? err.message : 'No saved book matched that barcode or ISBN.');
    } finally {
      setBookLoading(false);
    }
  };

  const handleSelectStudent = async (query: string) => {
    if (!query.trim()) return;
    setCheckingStudent(true);
    try {
      const res = await apiRequest<ResolvedStudentEligibility>(
        `/org/circulation/resolve-student?q=${encodeURIComponent(query.trim())}`
      );
      setStudentEligibility(res);
      if (!res.eligibility.eligible && res.eligibility.blockReason) {
        toast.warning(res.eligibility.blockReason);
      } else {
        toast.success(`Selected ${res.student.fullName} (${res.student.studentIdCode}).`);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to resolve student.');
    } finally {
      setCheckingStudent(false);
    }
  };

  const activeCopy = useMemo(() => {
    if (!bookLookup) return null;
    if (selectedCopyId && bookLookup.copies?.length) {
      return bookLookup.copies.find((c) => c.id === selectedCopyId) || bookLookup.copy;
    }
    return bookLookup.copy;
  }, [bookLookup, selectedCopyId]);

  const canAssign =
    Boolean(activeCopy) &&
    (activeCopy?.status === 'available' || activeCopy?.status === 'reserved') &&
    Boolean(studentEligibility?.eligibility.eligible);

  const canReassign =
    Boolean(activeCopy) &&
    activeCopy?.status === 'issued' &&
    Boolean(studentEligibility?.eligibility.eligible) &&
    activeCopy?.activeLoan?.studentId !== studentEligibility?.student.id;

  const handleAssignBook = async () => {
    if (!activeCopy || !studentEligibility) return;
    setIssuing(true);
    try {
      const res = await apiRequest<{
        receipt: {
          receiptNumber: string;
          issuedAt: string;
          dueAt: string;
          bookTitle: string;
          barcode: string;
          studentName: string;
          studentIdCode: string;
        };
      }>('/org/circulation/issue', {
        method: 'POST',
        body: {
          studentId: studentEligibility.student.id,
          bookCopyId: activeCopy.id,
        },
      });
      setReceipt(res.receipt);
      toast.success(`Book "${res.receipt.bookTitle}" assigned to ${res.receipt.studentName}!`);
      onAssigned();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to assign book.');
    } finally {
      setIssuing(false);
    }
  };

  const handleReturnIssuedCopy = async () => {
    if (!activeCopy?.activeLoan?.id) return;
    setReturningCopy(true);
    try {
      await apiRequest('/org/circulation/return', {
        method: 'POST',
        body: { loanId: activeCopy.activeLoan.id },
      });
      toast.success(`Copy ${activeCopy.barcode} returned and is now available.`);
      onAssigned();
      await handleLookupBook(activeCopy.barcode);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to return copy.');
    } finally {
      setReturningCopy(false);
    }
  };

  const handleReassignBook = async () => {
    if (!activeCopy || !studentEligibility) return;
    setReassigning(true);
    try {
      const res = await apiRequest<{
        receipt: {
          receiptNumber: string;
          issuedAt: string;
          dueAt: string;
          bookTitle: string;
          barcode: string;
          studentName: string;
          studentIdCode: string;
        };
      }>('/org/circulation/reassign', {
        method: 'POST',
        body: {
          bookCopyId: activeCopy.id,
          studentId: studentEligibility.student.id,
        },
      });
      setReceipt(res.receipt);
      toast.success(`Copy ${res.receipt.barcode} reassigned to ${res.receipt.studentName}!`);
      onAssigned();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to reassign book copy.');
    } finally {
      setReassigning(false);
    }
  };

  const resetForNext = () => {
    setBarcodeInput('');
    setBookLookup(null);
    setSelectedCopyId('');
    setReceipt(null);
  };

  const handleDownloadReceipt = () => {
    if (!receipt) return;
    downloadReceiptPdf({
      title: 'Book Issue Receipt',
      receiptNumber: receipt.receiptNumber,
      organizationName,
      lines: [
        { label: 'Student', value: `${receipt.studentName} (${receipt.studentIdCode})` },
        { label: 'Book Title', value: receipt.bookTitle },
        { label: 'Physical Barcode', value: receipt.barcode },
        { label: 'Issued Date', value: formatDate(receipt.issuedAt) },
        { label: 'Due Date', value: formatDate(receipt.dueAt) },
      ],
    });
  };

  return (
    <>
      <Modal
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            setReceipt(null);
          }
          onOpenChange(o);
        }}
        title="Scan Saved Book Barcode & Assign to Student"
        description="Scan a saved physical book barcode or ISBN, select any active student, and issue the book immediately."
        maxWidth="max-w-3xl"
      >
        {receipt ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-5 space-y-3">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-display font-bold text-base">
                <CheckCircle2 className="h-5 w-5" />
                Book Assigned &amp; Issued Successfully
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div>
                  <span className="text-slate-500">Book Title</span>
                  <div className="font-semibold text-slate-900 dark:text-white mt-0.5">
                    {receipt.bookTitle}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Physical Barcode</span>
                  <div className="font-mono font-semibold text-slate-900 dark:text-white mt-0.5">
                    {receipt.barcode}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Assigned Student</span>
                  <div className="font-semibold text-slate-900 dark:text-white mt-0.5">
                    {receipt.studentName} ({receipt.studentIdCode})
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Receipt &amp; Due Date</span>
                  <div className="font-mono text-slate-900 dark:text-white mt-0.5">
                    {receipt.receiptNumber} · Due {formatDate(receipt.dueAt)}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <Button variant="outline" onClick={handleDownloadReceipt}>
                <Download className="h-4 w-4" />
                Download Receipt PDF
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={resetForNext}>
                  <ScanBarcode className="h-4 w-4" />
                  Scan &amp; Assign Another Book
                </Button>
                <Button onClick={() => onOpenChange(false)}>Done</Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* STEP 1: Scan or Enter Saved Book Barcode */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-display font-bold uppercase tracking-wider text-[#1E3A8A] dark:text-[#60A5FA]">
                  <ScanBarcode className="h-4 w-4" />
                  Step 1 · Scan Saved Book Barcode
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setScannerMode('book')}
                >
                  <Camera className="h-3.5 w-3.5" />
                  Scan Book Barcode
                </Button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleLookupBook();
                }}
                className="flex gap-2"
              >
                <Input
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  placeholder="Scan physical book barcode, accession no., or ISBN..."
                  className="font-mono"
                  autoFocus
                />
                <Button type="submit" variant="secondary" loading={bookLoading}>
                  Find Book
                </Button>
              </form>

              {bookLookup && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50 p-3.5 text-xs space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-semibold text-sm text-slate-900 dark:text-white">
                        <BookOpen className="h-4 w-4 text-[#2563EB] shrink-0" />
                        <span className="truncate">{bookLookup.book.title}</span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                        ISBN {bookLookup.book.isbn}
                        {bookLookup.book.authorName ? ` · ${bookLookup.book.authorName}` : ''}
                      </div>
                    </div>
                    {activeCopy && <StatusText status={activeCopy.status} />}
                  </div>

                  {bookLookup.copies && bookLookup.copies.length > 1 ? (
                    <div className="pt-1">
                      <label className="text-[11px] text-slate-500 block mb-1">
                        Select Physical Copy Barcode to Issue
                      </label>
                      <Select
                        value={selectedCopyId}
                        onChange={(e) => setSelectedCopyId(e.target.value)}
                        className="h-8 text-xs font-mono"
                      >
                        {bookLookup.copies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.barcode} ({c.status}
                            {c.rackCode ? ` · Shelf ${c.rackCode}-${c.shelfCode}` : ''})
                          </option>
                        ))}
                      </Select>
                    </div>
                  ) : activeCopy ? (
                    <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                      Physical Copy Barcode: <strong>{activeCopy.barcode}</strong>
                      {activeCopy.rackCode ? ` · Shelf ${activeCopy.rackCode}-${activeCopy.shelfCode}` : ''}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span>{bookLookup.statusMessage || 'No available copy found for this title.'}</span>
                    </div>
                  )}
                  {bookLookup.inventory && (
                    <div className="flex flex-wrap gap-3 text-[11px] font-mono text-slate-600 dark:text-slate-300">
                      <span>Total: {bookLookup.inventory.total}</span>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        Available: {bookLookup.inventory.available}
                      </span>
                      <span className="text-blue-600 dark:text-blue-400">
                        Issued: {bookLookup.inventory.issued}
                      </span>
                    </div>
                  )}

                  {activeCopy?.status === 'issued' && activeCopy.activeLoan && (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 p-2.5 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] text-amber-900 dark:text-amber-200">
                        Currently issued to{' '}
                        <strong>{activeCopy.activeLoan.studentName || 'Active Borrower'}</strong>
                        {activeCopy.activeLoan.dueAt
                          ? ` · Due ${formatDate(activeCopy.activeLoan.dueAt)}`
                          : ''}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        loading={returningCopy}
                        onClick={() => void handleReturnIssuedCopy()}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Return Copy Now
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* STEP 2: Select Any Student */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-display font-bold uppercase tracking-wider text-[#1E3A8A] dark:text-[#60A5FA]">
                  <UserCheck className="h-4 w-4" />
                  Step 2 · Select Student to Assign Book
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setScannerMode('student')}
                >
                  <QrCode className="h-3.5 w-3.5" />
                  Scan Student ID QR
                </Button>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="Search any student by name, roll number, Student ID, or email..."
                  className="pl-9"
                />
              </div>

              {/* Searchable Student Picker List */}
              <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                {filteredStudents.length === 0 ? (
                  <div className="px-3.5 py-4 text-center text-xs text-slate-500">
                    No active students matched your search.
                  </div>
                ) : (
                  filteredStudents.map((s) => {
                    const isSelected = studentEligibility?.student.id === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => handleSelectStudent(s.studentIdCode)}
                        className={`w-full px-3.5 py-2.5 text-left text-xs flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-blue-50 dark:bg-blue-950/40'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 dark:text-white truncate">
                            {s.fullName}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {s.studentIdCode} · Roll {s.collegeRollNumber}
                            {s.courseName ? ` · ${s.courseName}` : ''}
                          </div>
                        </div>
                        <span
                          className={`text-[11px] font-semibold shrink-0 ${
                            isSelected ? 'text-[#2563EB] dark:text-[#60A5FA]' : 'text-slate-400'
                          }`}
                        >
                          {isSelected ? 'Selected ✓' : 'Select'}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              {checkingStudent && (
                <div className="text-xs text-slate-500">Verifying student borrowing eligibility...</div>
              )}

              {studentEligibility && (
                <div
                  className={`rounded-lg border p-3 text-xs space-y-1 ${
                    studentEligibility.eligibility.eligible
                      ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/20'
                      : 'border-red-200 bg-red-50/60 dark:border-red-900/50 dark:bg-red-950/20'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {studentEligibility.student.fullName} ({studentEligibility.student.studentIdCode})
                    </span>
                    <span className="font-mono text-[11px]">
                      Quota: {studentEligibility.eligibility.activeLoansCount} /{' '}
                      {studentEligibility.eligibility.maxBooksAllowed}
                    </span>
                  </div>
                  {studentEligibility.eligibility.eligible ? (
                    <div className="text-emerald-700 dark:text-emerald-400">
                      Eligible to borrow · Loan period: {studentEligibility.eligibility.loanDurationDays} days
                    </div>
                  ) : (
                    <div className="text-red-700 dark:text-red-400 font-medium">
                      {studentEligibility.eligibility.blockReason || 'Student is currently not eligible to borrow.'}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Confirm Footer */}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              {activeCopy?.status === 'issued' ? (
                <Button
                  type="button"
                  loading={reassigning}
                  disabled={!canReassign}
                  onClick={handleReassignBook}
                >
                  <ArrowRightLeft className="h-4 w-4" />
                  Return &amp; Reassign to Student
                </Button>
              ) : (
                <Button
                  type="button"
                  loading={issuing}
                  disabled={!canAssign}
                  onClick={handleAssignBook}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Assign &amp; Issue Book to Student
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <QrScannerModal
        open={Boolean(scannerMode)}
        onClose={() => setScannerMode(null)}
        title={scannerMode === 'book' ? 'Scan Saved Book Barcode' : 'Scan Student Digital ID QR'}
        description={
          scannerMode === 'book'
            ? 'Point the camera at the physical barcode sticker or ISBN barcode printed on the book.'
            : 'Point the camera at the student Digital ID or Golden Founder ID QR code.'
        }
        placeholder={scannerMode === 'book' ? 'Or enter book barcode / ISBN...' : 'Or enter Student ID / Roll No...'}
        mode={scannerMode === 'book' ? 'barcode' : 'qr'}
        onScan={(val) => {
          const mode = scannerMode;
          setScannerMode(null);
          if (mode === 'book') {
            void handleLookupBook(val);
          } else if (mode === 'student') {
            void handleSelectStudent(val);
          }
        }}
      />
    </>
  );
}
