import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Upload,
} from 'lucide-react';
import Papa from 'papaparse';
import { toast } from 'sonner';
import {
  Button,
  EmptyState,
  Field,
  MetricTile,
  Select,
  SkeletonRows,
  StatusText,
  SurfaceCard,
} from '../../components/ui/primitives.tsx';
import { apiRequest } from '../../lib/api.ts';
import { exportToCsv, formatDateTime } from '../../lib/utils.ts';

type ImportType = 'students' | 'books' | 'inventory' | 'fines';

interface FieldSpec {
  key: string;
  label: string;
  required?: boolean;
  aliases: string[];
}

const TARGET_SCHEMAS: Record<
  ImportType,
  {
    label: string;
    description: string;
    fields: FieldSpec[];
    sampleRow: Record<string, string | number>;
  }
> = {
  students: {
    label: 'Students Register',
    description: 'Digitize paper admission ledgers into student member profiles.',
    fields: [
      { key: 'fullName', label: 'Full Name', required: true, aliases: ['full_name', 'name', 'student_name', 'fullname'] },
      { key: 'collegeRollNumber', label: 'College Roll Number', required: true, aliases: ['roll', 'roll_no', 'roll_number', 'college_roll_number', 'enrollment'] },
      { key: 'email', label: 'Email Address', required: true, aliases: ['email', 'mail', 'student_email'] },
      { key: 'fatherName', label: "Father's Name", aliases: ['father_name', 'father', 'guardian'] },
      { key: 'phone', label: 'Phone Number', aliases: ['phone', 'mobile', 'contact'] },
      { key: 'address', label: 'Address', aliases: ['address', 'city'] },
    ],
    sampleRow: {
      fullName: 'Aarav Sharma',
      collegeRollNumber: 'BCA-2026-101',
      email: 'aarav.sharma@college.edu',
      fatherName: 'Rajesh Sharma',
      phone: '9876543210',
      address: 'Sector 14, Campus Road',
    },
  },
  books: {
    label: 'Book Catalog Titles',
    description: 'Import book titles with automatic physical barcode copy generation.',
    fields: [
      { key: 'title', label: 'Book Title', required: true, aliases: ['title', 'book_title', 'name'] },
      { key: 'isbn', label: 'ISBN', required: true, aliases: ['isbn', 'isbn13', 'isbn10', 'code'] },
      { key: 'authorName', label: 'Author Name', aliases: ['author', 'author_name', 'writer'] },
      { key: 'publisherName', label: 'Publisher', aliases: ['publisher', 'publisher_name'] },
      { key: 'subject', label: 'Subject', aliases: ['subject', 'department', 'topic'] },
      { key: 'edition', label: 'Edition', aliases: ['edition'] },
      { key: 'publicationYear', label: 'Publication Year', aliases: ['year', 'pub_year', 'publication_year'] },
      { key: 'copies', label: 'Copies to Generate', aliases: ['copies', 'qty', 'quantity', 'count'] },
    ],
    sampleRow: {
      title: 'Operating System Concepts',
      isbn: '9781119800361',
      authorName: 'Abraham Silberschatz',
      publisherName: 'Wiley',
      subject: 'Computer Science',
      edition: '10th',
      publicationYear: 2021,
      copies: 3,
    },
  },
  inventory: {
    label: 'Physical Book Copies / Barcodes',
    description: 'Attach legacy accession numbers and physical barcodes to existing ISBN titles.',
    fields: [
      { key: 'isbn', label: 'Catalog Book ISBN', required: true, aliases: ['isbn', 'book_isbn'] },
      { key: 'barcode', label: 'Copy Barcode', required: true, aliases: ['barcode', 'copy_code', 'tag'] },
      { key: 'accessionNumber', label: 'Accession Number', aliases: ['accession', 'accession_number', 'acc_no'] },
      { key: 'condition', label: 'Condition (new/good/fair/poor)', aliases: ['condition', 'state'] },
    ],
    sampleRow: {
      isbn: '9781119800361',
      barcode: 'LIB-OS-0091',
      accessionNumber: 'ACC-2026-0091',
      condition: 'good',
    },
  },
  fines: {
    label: 'Legacy Fine Balances',
    description: 'Migrate pending student fine balances from paper registers.',
    fields: [
      { key: 'collegeRollNumber', label: 'Student Roll Number', required: true, aliases: ['roll', 'roll_no', 'college_roll_number'] },
      { key: 'amount', label: 'Fine Amount', required: true, aliases: ['amount', 'fine', 'balance', 'due'] },
      { key: 'reason', label: 'Fine Reason', required: true, aliases: ['reason', 'note', 'description', 'remarks'] },
    ],
    sampleRow: {
      collegeRollNumber: 'BCA-2026-101',
      amount: 45,
      reason: 'Legacy overdue ledger balance (2025-26)',
    },
  },
};

interface ValidationResult {
  totalRows: number;
  validCount: number;
  duplicateCount: number;
  errorCount: number;
  validRows: Array<Record<string, unknown>>;
  duplicateRows: Array<{ rowNumber: number; reason: string; data: Record<string, unknown> }>;
  errorRows: Array<{ rowNumber: number; reason: string; data: Record<string, unknown> }>;
}

interface MigrationRun {
  id: string;
  importType: string;
  fileName: string;
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  errorRows: number;
  status: string;
  createdAt: string;
}

export function MigrationCenterPage() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [importType, setImportType] = useState<ImportType>('students');
  const [fileName, setFileName] = useState('');
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Array<Record<string, unknown>>>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [commitSummary, setCommitSummary] = useState<{ importedCount: number; run: MigrationRun } | null>(null);

  const schemaSpec = TARGET_SCHEMAS[importType];

  const { data: historyData, isLoading: historyLoading, isError: historyError, refetch: refetchHistory } = useQuery({
    queryKey: ['org-migration-history'],
    queryFn: () => apiRequest<{ runs: MigrationRun[] }>('/org/migrations/history'),
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields || [];
        const rows = (results.data || []).slice(0, 1000);
        if (headers.length === 0 || rows.length === 0) {
          toast.error('CSV file contains no readable header columns or data rows.');
          return;
        }
        setRawHeaders(headers);
        setRawRows(rows);

        // Auto-match headers to target schema fields
        const autoMap: Record<string, string> = {};
        for (const field of TARGET_SCHEMAS[importType].fields) {
          const matched = headers.find((h) => {
            const norm = h.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (norm === field.key.toLowerCase()) return true;
            return field.aliases.some((a) => a.replace(/[^a-z0-9]/g, '') === norm);
          });
          if (matched) autoMap[field.key] = matched;
        }
        setMapping(autoMap);
        setValidation(null);
        setCommitSummary(null);
        setStep(2);
        toast.success(`Loaded ${rows.length} row(s) from ${file.name}`);
      },
      error: (err) => {
        toast.error(`CSV parsing failed: ${err.message}`);
      },
    });
    e.target.value = '';
  };

  const mappedRows = useMemo(() => {
    return rawRows.map((row) => {
      const mapped: Record<string, unknown> = {};
      for (const field of schemaSpec.fields) {
        const sourceCol = mapping[field.key];
        if (sourceCol && row[sourceCol] !== undefined) {
          mapped[field.key] = row[sourceCol];
        }
      }
      return mapped;
    });
  }, [rawRows, mapping, schemaSpec.fields]);

  const validateMutation = useMutation({
    mutationFn: () =>
      apiRequest<ValidationResult>('/org/migrations/validate', {
        method: 'POST',
        body: { importType, rows: mappedRows },
      }),
    onSuccess: (res) => {
      setValidation(res);
      setStep(3);
      toast.success(`Validation complete: ${res.validCount} valid, ${res.duplicateCount} duplicates, ${res.errorCount} errors.`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const commitMutation = useMutation({
    mutationFn: () => {
      if (!validation) throw new Error('Run validation before committing.');
      return apiRequest<{ run: MigrationRun; importedCount: number }>('/org/migrations/commit', {
        method: 'POST',
        body: {
          importType,
          fileName: fileName || `${importType}-import.csv`,
          columnMapping: mapping,
          validRows: validation.validRows,
          duplicateCount: validation.duplicateCount,
          errorCount: validation.errorCount,
          errorSample: validation.errorRows.slice(0, 25),
        },
      });
    },
    onSuccess: (res) => {
      setCommitSummary(res);
      setStep(4);
      queryClient.invalidateQueries({ queryKey: ['org-migration-history'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });
      toast.success(`Imported ${res.importedCount} record(s) into Cloud Firestore.`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resetWizard = () => {
    setStep(1);
    setFileName('');
    setRawHeaders([]);
    setRawRows([]);
    setMapping({});
    setValidation(null);
    setCommitSummary(null);
  };

  const downloadSample = () => {
    exportToCsv(`qivora-sample-${importType}.csv`, [schemaSpec.sampleRow]);
  };

  const downloadErrorReport = () => {
    if (!validation) return;
    const issues = [
      ...validation.errorRows.map((e) => ({ Row: e.rowNumber, IssueType: 'Error', Reason: e.reason, ...e.data })),
      ...validation.duplicateRows.map((d) => ({ Row: d.rowNumber, IssueType: 'Duplicate', Reason: d.reason, ...d.data })),
    ];
    if (issues.length === 0) return;
    exportToCsv(`qivora-migration-errors-${importType}.csv`, issues);
  };

  const missingRequired = schemaSpec.fields.filter((f) => f.required && !mapping[f.key]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Smart Migration Center
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Transition paper registers and Excel spreadsheets into QIVORA with automated column mapping, duplicate checks, and atomic database commits.
          </p>
        </div>
        {step > 1 && (
          <Button variant="outline" size="sm" onClick={resetWizard}>
            <RefreshCw className="h-3.5 w-3.5" />
            Start New Import
          </Button>
        )}
      </div>

      {/* Stepper */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { num: 1, label: '1. Select & Upload CSV' },
          { num: 2, label: '2. Map Columns' },
          { num: 3, label: '3. Validate & Preview' },
          { num: 4, label: '4. Import Summary' },
        ].map((s) => (
          <div
            key={s.num}
            className={`rounded-2xl border px-4 py-3 text-xs font-semibold transition-all ${
              step === s.num
                ? 'border-[#4F46E5] bg-gradient-to-r from-[#2563EB] to-[#6D28D9] text-white shadow-xs'
                : step > s.num
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-400'
            }`}
          >
            {s.label}
          </div>
        ))}
      </div>

      {/* Step 1: Select Type & Upload */}
      {step === 1 && (
        <SurfaceCard className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {(Object.keys(TARGET_SCHEMAS) as ImportType[]).map((key) => {
              const info = TARGET_SCHEMAS[key];
              const active = importType === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setImportType(key)}
                  className={`rounded-2xl border p-4 text-left transition-all cursor-pointer ${
                    active
                      ? 'border-[#4F46E5] bg-indigo-50/70 dark:bg-indigo-950/30 ring-1 ring-[#4F46E5]'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-[#0F172A] dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                    <FileSpreadsheet className="h-4 w-4 text-[#4F46E5]" />
                    {info.label}
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {info.description}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-6 dark:border-slate-700 dark:bg-slate-900/40">
            <div className="space-y-1 text-center sm:text-left">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                Upload CSV File for {schemaSpec.label}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                UTF-8 CSV exported from Excel or Google Sheets (up to 1,000 rows per transaction batch).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button variant="outline" size="sm" onClick={downloadSample}>
                <Download className="h-3.5 w-3.5" />
                Download Sample CSV
              </Button>
              <label className="inline-flex h-9 items-center gap-2 rounded-xl bg-gradient-to-r from-[#2563EB] to-[#6D28D9] px-4 text-xs font-medium text-white shadow-xs hover:brightness-105 cursor-pointer">
                <Upload className="h-3.5 w-3.5" />
                Select CSV File
                <input type="file" accept=".csv,text/csv" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
          </div>
        </SurfaceCard>
      )}

      {/* Step 2: Column Mapping */}
      {step === 2 && (
        <SurfaceCard className="p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Map Spreadsheet Columns ({fileName})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {rawRows.length} rows detected · Match each QIVORA database field to your CSV column.
              </p>
            </div>
            <Button
              onClick={() => validateMutation.mutate()}
              loading={validateMutation.isPending}
              disabled={missingRequired.length > 0}
            >
              Validate Rows
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>

          {missingRequired.length > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Map required fields before validation: {missingRequired.map((f) => f.label).join(', ')}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {schemaSpec.fields.map((field) => (
              <Field key={field.key} label={field.label} required={field.required}>
                <Select
                  value={mapping[field.key] || ''}
                  onChange={(e) => setMapping((prev) => ({ ...prev, [field.key]: e.target.value }))}
                >
                  <option value="">— Ignore / Not Mapped —</option>
                  {rawHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>

          <div className="pt-2">
            <div className="text-xs font-semibold text-slate-500 mb-2">
              Preview (First 5 Mapped Rows)
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-600 dark:text-slate-300">
                  <tr>
                    {schemaSpec.fields.map((f) => (
                      <th key={f.key} className="px-3 py-2 font-semibold">
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {mappedRows.slice(0, 5).map((r, i) => (
                    <tr key={i}>
                      {schemaSpec.fields.map((f) => (
                        <td key={f.key} className="px-3 py-2 text-slate-700 dark:text-slate-200">
                          {String(r[f.key] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </SurfaceCard>
      )}

      {/* Step 3: Validation Report & Commit */}
      {step === 3 && validation && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <MetricTile label="Total Rows" value={validation.totalRows} pastel="blue" />
            <MetricTile label="Ready to Import" value={validation.validCount} tone="success" pastel="emerald" />
            <MetricTile label="Duplicates Skipped" value={validation.duplicateCount} tone="warning" pastel="amber" />
            <MetricTile label="Row Errors" value={validation.errorCount} tone={validation.errorCount > 0 ? 'danger' : 'default'} pastel="rose" />
          </div>

          <SurfaceCard className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Pre-Commit Integrity Audit
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Only valid non-duplicate rows will be committed in an atomic database transaction.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(validation.errorCount > 0 || validation.duplicateCount > 0) && (
                  <Button variant="outline" size="sm" onClick={downloadErrorReport}>
                    <Download className="h-3.5 w-3.5" />
                    Download Error Report CSV
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setStep(2)}>
                  Adjust Mapping
                </Button>
                <Button
                  size="sm"
                  onClick={() => commitMutation.mutate()}
                  loading={commitMutation.isPending}
                  disabled={validation.validCount === 0}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Commit {validation.validCount} Valid Row(s)
                </Button>
              </div>
            </div>

            {(validation.errorRows.length > 0 || validation.duplicateRows.length > 0) && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="px-3 py-2">CSV Row #</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {validation.errorRows.slice(0, 20).map((e, i) => (
                      <tr key={`err-${i}`}>
                        <td className="px-3 py-2 font-mono">{e.rowNumber}</td>
                        <td className="px-3 py-2 font-semibold text-red-600">Error</td>
                        <td className="px-3 py-2">{e.reason}</td>
                      </tr>
                    ))}
                    {validation.duplicateRows.slice(0, 20).map((d, i) => (
                      <tr key={`dup-${i}`}>
                        <td className="px-3 py-2 font-mono">{d.rowNumber}</td>
                        <td className="px-3 py-2 font-semibold text-amber-600">Duplicate</td>
                        <td className="px-3 py-2">{d.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SurfaceCard>
        </div>
      )}

      {/* Step 4: Completion Summary */}
      {step === 4 && commitSummary && (
        <SurfaceCard className="p-6 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            Migration Committed Successfully
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Imported <strong>{commitSummary.importedCount}</strong> record(s) from{' '}
            <span className="font-mono">{commitSummary.run.fileName}</span> into Cloud Firestore and logged the audit trail.
          </p>
          <div className="pt-2">
            <Button size="sm" onClick={resetWizard}>
              Run Another Migration
            </Button>
          </div>
        </SurfaceCard>
      )}

      {/* Audit History */}
      <SurfaceCard className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Migration Audit History
          </h2>
        </div>
        {historyLoading ? (
          <div className="p-5">
            <SkeletonRows rows={3} />
          </div>
        ) : historyError ? (
          <div className="p-6">
            <EmptyState
              title="Unable to load migration history"
              description="Please try again to view completed CSV imports."
              action={<Button size="sm" onClick={() => refetchHistory()}>Retry</Button>}
            />
          </div>
        ) : !historyData?.runs?.length ? (
          <div className="p-6">
            <EmptyState
              title="No migration runs yet"
              description="Completed CSV imports will appear here with row counts, duplicates skipped, and status."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Dataset</th>
                  <th className="px-4 py-3">File Name</th>
                  <th className="px-4 py-3">Imported</th>
                  <th className="px-4 py-3">Duplicates</th>
                  <th className="px-4 py-3">Errors</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {historyData.runs.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono text-slate-500">{formatDateTime(run.createdAt)}</td>
                    <td className="px-4 py-3 font-medium capitalize text-slate-900 dark:text-white">
                      {run.importType}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">{run.fileName}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                      {run.importedRows} / {run.totalRows}
                    </td>
                    <td className="px-4 py-3 font-mono text-amber-600">{run.duplicateRows}</td>
                    <td className="px-4 py-3 font-mono text-red-600">{run.errorRows}</td>
                    <td className="px-4 py-3">
                      <StatusText status={run.status} />
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
