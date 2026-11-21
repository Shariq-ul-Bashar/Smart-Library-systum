import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Download,
  FileSpreadsheet,
  Plus,
  Save,
  Shield,
  UserCheck,
  UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import {
  downloadReportPdf,
  exportToCsv,
  formatCurrency,
  formatDate,
  formatDateTime,
} from '../../lib/utils.ts';
import {
  Button,
  EmptyState,
  Field,
  FileUploadControl,
  Input,
  MetricTile,
  Modal,
  Select,
  SkeletonRows,
  StatusText,
  SurfaceCard,
  Textarea,
} from '../../components/ui/primitives.tsx';

// ============================================================================
// COLLEGE BRANDING MANAGEMENT (College Admin ONLY)
// ============================================================================

interface BrandingRecord {
  collegeName: string;
  collegeLogoUrl?: string | null;
  universityName?: string | null;
  universityLogoUrl?: string | null;
  address?: string | null;
  website?: string | null;
  email?: string | null;
  contactNumber?: string | null;
  officialColor: string;
  authorizedSignatureUrl?: string | null;
  authorizedSignatoryName?: string | null;
  libraryContactDetails?: string | null;
  idCardInstructions?: string | null;
  allowStudentIdCustomization: boolean;
  allowStudentBgUpload: boolean;
}

export function CollegeBrandingPage() {
  const { activeWorkspace } = useAuth();
  const orgId = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationId : null;
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['org-branding', orgId],
    queryFn: () => apiRequest<{ branding: BrandingRecord | null }>('/org/branding'),
    enabled: Boolean(orgId),
  });

  const [form, setForm] = useState<BrandingRecord>({
    collegeName: '',
    collegeLogoUrl: null,
    universityName: '',
    universityLogoUrl: null,
    address: '',
    website: '',
    email: '',
    contactNumber: '',
    officialColor: '#1E3A8A',
    authorizedSignatureUrl: null,
    authorizedSignatoryName: 'Chief Librarian / Principal',
    libraryContactDetails: '',
    idCardInstructions: '',
    allowStudentIdCustomization: false,
    allowStudentBgUpload: false,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.branding) {
      setForm({
        collegeName: data.branding.collegeName || '',
        collegeLogoUrl: data.branding.collegeLogoUrl || null,
        universityName: data.branding.universityName || '',
        universityLogoUrl: data.branding.universityLogoUrl || null,
        address: data.branding.address || '',
        website: data.branding.website || '',
        email: data.branding.email || '',
        contactNumber: data.branding.contactNumber || '',
        officialColor: data.branding.officialColor || '#1E3A8A',
        authorizedSignatureUrl: data.branding.authorizedSignatureUrl || null,
        authorizedSignatoryName: data.branding.authorizedSignatoryName || '',
        libraryContactDetails: data.branding.libraryContactDetails || '',
        idCardInstructions: data.branding.idCardInstructions || '',
        allowStudentIdCustomization: Boolean(data.branding.allowStudentIdCustomization),
        allowStudentBgUpload: Boolean(data.branding.allowStudentBgUpload),
      });
    }
  }, [data]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.collegeName.trim().length < 2) {
      toast.error('College name must be at least 2 characters.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/org/branding', {
        method: 'PUT',
        body: {
          ...form,
          collegeName: form.collegeName.trim(),
          allowStudentBgUpload: form.allowStudentIdCustomization ? form.allowStudentBgUpload : false,
        },
      });
      toast.success('College branding and ID identity defaults saved.');
      queryClient.invalidateQueries({ queryKey: ['org-branding'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to save branding.');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <SurfaceCard className="p-6">
        <SkeletonRows rows={6} />
      </SurfaceCard>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
            College Branding & Official Identity
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Configure institutional logos, signatory stamps, contact details, and student Digital ID customization controls.
          </p>
        </div>
        <Button type="submit" loading={saving}>
          <Save className="h-4 w-4" />
          Save Branding
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SurfaceCard className="p-5 space-y-4">
          <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
            Institution Identity
          </h2>
          <Field label="College / Institution Name" required>
            <Input
              value={form.collegeName}
              onChange={(e) => setForm({ ...form, collegeName: e.target.value })}
              required
            />
          </Field>
          <Field label="Affiliated University Name">
            <Input
              value={form.universityName || ''}
              onChange={(e) => setForm({ ...form, universityName: e.target.value })}
              placeholder="e.g. State University of Technology"
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Official Email">
              <Input
                type="email"
                value={form.email || ''}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="library@college.edu"
              />
            </Field>
            <Field label="Contact Number">
              <Input
                value={form.contactNumber || ''}
                onChange={(e) => setForm({ ...form, contactNumber: e.target.value })}
                placeholder="+91 98765 43210"
              />
            </Field>
          </div>
          <Field label="Official Website">
            <Input
              value={form.website || ''}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              placeholder="https://college.edu"
            />
          </Field>
          <Field label="Campus Address">
            <Textarea
              value={form.address || ''}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Full campus street address shown on ID back side and receipts"
            />
          </Field>
          <Field label="Official Primary Accent Color">
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={form.officialColor}
                onChange={(e) => setForm({ ...form, officialColor: e.target.value })}
                className="h-10 w-14 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent cursor-pointer"
              />
              <Input
                value={form.officialColor}
                onChange={(e) => setForm({ ...form, officialColor: e.target.value })}
                className="font-mono max-w-[160px]"
              />
            </div>
          </Field>
        </SurfaceCard>

        <div className="space-y-6">
          <SurfaceCard className="p-5 space-y-4">
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
              Official Logos & Authorized Signatory
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="College Logo">
                <FileUploadControl
                  bucket="college_logos"
                  label="Upload College Logo"
                  currentUrl={form.collegeLogoUrl}
                  onUploaded={(url) => setForm({ ...form, collegeLogoUrl: url })}
                  allowClear
                />
                {form.collegeLogoUrl && (
                  <img
                    src={form.collegeLogoUrl}
                    alt="College logo preview"
                    className="mt-2 h-14 w-14 rounded-lg border border-slate-200 dark:border-slate-700 object-contain p-1 bg-white"
                  />
                )}
              </Field>
              <Field label="University Logo">
                <FileUploadControl
                  bucket="university_logos"
                  label="Upload University Logo"
                  currentUrl={form.universityLogoUrl}
                  onUploaded={(url) => setForm({ ...form, universityLogoUrl: url })}
                  allowClear
                />
                {form.universityLogoUrl && (
                  <img
                    src={form.universityLogoUrl}
                    alt="University logo preview"
                    className="mt-2 h-14 w-14 rounded-lg border border-slate-200 dark:border-slate-700 object-contain p-1 bg-white"
                  />
                )}
              </Field>
            </div>
            <Field label="Authorized Signatory Title / Name">
              <Input
                value={form.authorizedSignatoryName || ''}
                onChange={(e) => setForm({ ...form, authorizedSignatoryName: e.target.value })}
                placeholder="Chief Librarian / Principal"
              />
            </Field>
            <Field label="Authorized Signature Image (PNG/JPG)">
              <FileUploadControl
                bucket="id_assets"
                label="Upload Signature"
                currentUrl={form.authorizedSignatureUrl}
                onUploaded={(url) => setForm({ ...form, authorizedSignatureUrl: url })}
                allowClear
              />
              {form.authorizedSignatureUrl && (
                <img
                  src={form.authorizedSignatureUrl}
                  alt="Signature preview"
                  className="mt-2 h-10 object-contain rounded border border-slate-200 dark:border-slate-700 bg-white px-2"
                />
              )}
            </Field>
            <Field label="Digital ID Back-Side Instructions">
              <Textarea
                value={form.idCardInstructions || ''}
                onChange={(e) => setForm({ ...form, idCardInstructions: e.target.value })}
                placeholder="Instructions printed on the back of every student Digital ID card..."
              />
            </Field>
            <Field label="Library Helpdesk Contact Note">
              <Input
                value={form.libraryContactDetails || ''}
                onChange={(e) => setForm({ ...form, libraryContactDetails: e.target.value })}
                placeholder="Mon–Sat, 09:00 AM – 06:00 PM · Central Library Block"
              />
            </Field>
          </SurfaceCard>

          <SurfaceCard className="p-5 space-y-4">
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
              Student ID Background Customization Controls
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Official student identity fields, QR verification codes, college/university branding, and assigned templates remain locked regardless of these settings.
            </p>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.allowStudentIdCustomization}
                onChange={(e) =>
                  setForm({
                    ...form,
                    allowStudentIdCustomization: e.target.checked,
                    allowStudentBgUpload: e.target.checked ? form.allowStudentBgUpload : false,
                  })
                }
                className="mt-1 h-4 w-4 rounded border-slate-300"
              />
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-white">
                  Allow students to customize their Digital ID background layer
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Enables safe background overlay tuning in the Student Portal without altering official identity data.
                </div>
              </div>
            </label>
            <label
              className={`flex items-start gap-3 ${
                form.allowStudentIdCustomization ? 'cursor-pointer' : 'opacity-50 pointer-events-none'
              }`}
            >
              <input
                type="checkbox"
                checked={form.allowStudentBgUpload}
                disabled={!form.allowStudentIdCustomization}
                onChange={(e) => setForm({ ...form, allowStudentBgUpload: e.target.checked })}
                className="mt-1 h-4 w-4 rounded border-slate-300"
              />
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-white">
                  Allow students to upload custom background images (PNG/JPG/WebP)
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Validated server-side (max 3 MB). Students can adjust zoom, fit, position, and readability overlay.
                </div>
              </div>
            </label>
          </SurfaceCard>
        </div>
      </div>
    </form>
  );
}

// ============================================================================
// LIBRARY RULES SETTINGS & ACADEMIC STRUCTURE (College Admin ONLY)
// ============================================================================

interface LibrarySettingsRecord {
  defaultLoanDays: number;
  maxBooksPerStudent: number;
  maxRenewals: number;
  renewalExtensionDays: number;
  overdueFinePerDay: string | number;
  reservationHoldDays: number;
  allowRenewalWhenReserved: boolean;
  allowRenewalWhenOverdue: boolean;
  maxOutstandingFineForBorrow: string | number;
  currencySymbol: string;
  idValidityMonths: number;
}

export function LibrarySettingsPage() {
  const { activeWorkspace } = useAuth();
  const orgId = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationId : null;
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['org-settings', orgId],
    queryFn: () => apiRequest<{ settings: LibrarySettingsRecord | null }>('/org/settings'),
    enabled: Boolean(orgId),
  });

  const { data: academics } = useQuery({
    queryKey: ['org-academics', orgId],
    queryFn: () =>
      apiRequest<{
        courses: Array<{ id: string; name: string; code: string; durationSemesters: number }>;
        academicSessions: Array<{ id: string; name: string; isCurrent: boolean }>;
      }>('/org/academics'),
    enabled: Boolean(orgId),
  });

  const [form, setForm] = useState<LibrarySettingsRecord>({
    defaultLoanDays: 14,
    maxBooksPerStudent: 4,
    maxRenewals: 2,
    renewalExtensionDays: 7,
    overdueFinePerDay: 5,
    reservationHoldDays: 3,
    allowRenewalWhenReserved: false,
    allowRenewalWhenOverdue: false,
    maxOutstandingFineForBorrow: 100,
    currencySymbol: '₹',
    idValidityMonths: 12,
  });
  const [saving, setSaving] = useState(false);

  // Add Course / Session quick forms
  const [courseName, setCourseName] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [courseSems, setCourseSems] = useState('6');
  const [addingCourse, setAddingCourse] = useState(false);

  const [sessionName, setSessionName] = useState('');
  const [sessionCurrent, setSessionCurrent] = useState(false);
  const [addingSession, setAddingSession] = useState(false);

  useEffect(() => {
    if (data?.settings) {
      setForm({
        ...data.settings,
        overdueFinePerDay: Number(data.settings.overdueFinePerDay),
        maxOutstandingFineForBorrow: Number(data.settings.maxOutstandingFineForBorrow),
      });
    }
  }, [data]);

  const handleSaveRules = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest('/org/settings', {
        method: 'PUT',
        body: {
          ...form,
          defaultLoanDays: Number(form.defaultLoanDays),
          maxBooksPerStudent: Number(form.maxBooksPerStudent),
          maxRenewals: Number(form.maxRenewals),
          renewalExtensionDays: Number(form.renewalExtensionDays),
          overdueFinePerDay: Number(form.overdueFinePerDay),
          reservationHoldDays: Number(form.reservationHoldDays),
          maxOutstandingFineForBorrow: Number(form.maxOutstandingFineForBorrow),
          idValidityMonths: Number(form.idValidityMonths),
        },
      });
      toast.success('Library circulation rules updated.');
      queryClient.invalidateQueries({ queryKey: ['org-settings'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to update library settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseName.trim() || !courseCode.trim()) return;
    setAddingCourse(true);
    try {
      await apiRequest('/org/academics/courses', {
        method: 'POST',
        body: {
          name: courseName.trim(),
          code: courseCode.trim(),
          durationSemesters: Number(courseSems) || 6,
        },
      });
      toast.success('Course and semesters created.');
      setCourseName('');
      setCourseCode('');
      queryClient.invalidateQueries({ queryKey: ['org-academics'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to add course.');
    } finally {
      setAddingCourse(false);
    }
  };

  const handleAddSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionName.trim()) return;
    setAddingSession(true);
    try {
      await apiRequest('/org/academics/sessions', {
        method: 'POST',
        body: { name: sessionName.trim(), isCurrent: sessionCurrent },
      });
      toast.success('Academic session added.');
      setSessionName('');
      setSessionCurrent(false);
      queryClient.invalidateQueries({ queryKey: ['org-academics'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to add academic session.');
    } finally {
      setAddingSession(false);
    }
  };

  if (isLoading) {
    return (
      <SurfaceCard className="p-6">
        <SkeletonRows rows={6} />
      </SurfaceCard>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
            Library Circulation Rules & Academic Setup
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Define borrowing quotas, overdue fine rates, renewal restrictions, and active courses/sessions.
          </p>
        </div>
      </div>

      <form onSubmit={handleSaveRules}>
        <SurfaceCard className="p-5 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
              Circulation & Fine Policy
            </h2>
            <Button type="submit" loading={saving}>
              <Save className="h-4 w-4" />
              Save Rules
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="Default Loan Duration (Days)" required>
              <Input
                type="number"
                min={1}
                max={365}
                value={form.defaultLoanDays}
                onChange={(e) => setForm({ ...form, defaultLoanDays: Number(e.target.value) })}
              />
            </Field>
            <Field label="Max Active Books per Student" required>
              <Input
                type="number"
                min={1}
                max={50}
                value={form.maxBooksPerStudent}
                onChange={(e) => setForm({ ...form, maxBooksPerStudent: Number(e.target.value) })}
              />
            </Field>
            <Field label="Max Renewals per Loan" required>
              <Input
                type="number"
                min={0}
                max={10}
                value={form.maxRenewals}
                onChange={(e) => setForm({ ...form, maxRenewals: Number(e.target.value) })}
              />
            </Field>
            <Field label="Renewal Extension (Days)" required>
              <Input
                type="number"
                min={1}
                max={90}
                value={form.renewalExtensionDays}
                onChange={(e) => setForm({ ...form, renewalExtensionDays: Number(e.target.value) })}
              />
            </Field>
            <Field label="Overdue Fine per Day" required>
              <Input
                type="number"
                step="0.5"
                min={0}
                value={form.overdueFinePerDay}
                onChange={(e) => setForm({ ...form, overdueFinePerDay: e.target.value })}
              />
            </Field>
            <Field label="Max Unpaid Fine Before Borrow Block" required>
              <Input
                type="number"
                step="1"
                min={0}
                value={form.maxOutstandingFineForBorrow}
                onChange={(e) => setForm({ ...form, maxOutstandingFineForBorrow: e.target.value })}
              />
            </Field>
            <Field label="Reservation Pickup Hold Window (Days)" required>
              <Input
                type="number"
                min={1}
                max={30}
                value={form.reservationHoldDays}
                onChange={(e) => setForm({ ...form, reservationHoldDays: Number(e.target.value) })}
              />
            </Field>
            <Field label="Digital ID Default Validity (Months)" required>
              <Input
                type="number"
                min={1}
                max={72}
                value={form.idValidityMonths}
                onChange={(e) => setForm({ ...form, idValidityMonths: Number(e.target.value) })}
              />
            </Field>
            <Field label="Currency Symbol" required>
              <Input
                value={form.currencySymbol}
                maxLength={5}
                onChange={(e) => setForm({ ...form, currencySymbol: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.allowRenewalWhenReserved}
                onChange={(e) => setForm({ ...form, allowRenewalWhenReserved: e.target.checked })}
                className="mt-1 h-4 w-4 rounded border-slate-300"
              />
              <div className="text-xs">
                <div className="font-semibold text-slate-900 dark:text-white">
                  Allow renewal when another student has reserved the book
                </div>
                <div className="text-slate-500">Recommended OFF to keep queue wait times fair.</div>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.allowRenewalWhenOverdue}
                onChange={(e) => setForm({ ...form, allowRenewalWhenOverdue: e.target.checked })}
                className="mt-1 h-4 w-4 rounded border-slate-300"
              />
              <div className="text-xs">
                <div className="font-semibold text-slate-900 dark:text-white">
                  Allow renewal of already overdue books
                </div>
                <div className="text-slate-500">Recommended OFF so overdue fines are settled on return.</div>
              </div>
            </label>
          </div>
        </SurfaceCard>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SurfaceCard className="p-5 space-y-4">
          <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
            Courses & Auto-Generated Semesters
          </h2>
          <form onSubmit={handleAddCourse} className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <Input
              placeholder="Course name (e.g. B.Sc CS)"
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              className="sm:col-span-2"
              required
            />
            <Input
              placeholder="Code (BSC)"
              value={courseCode}
              onChange={(e) => setCourseCode(e.target.value)}
              required
            />
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                max={12}
                value={courseSems}
                onChange={(e) => setCourseSems(e.target.value)}
                title="Semesters"
              />
              <Button type="submit" size="sm" loading={addingCourse}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </form>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
            {(academics?.courses || []).map((c) => (
              <div key={c.id} className="flex items-center justify-between px-3 py-2 text-xs">
                <div>
                  <span className="font-semibold text-slate-900 dark:text-white">{c.name}</span>{' '}
                  <span className="font-mono text-slate-500">({c.code})</span>
                </div>
                <span className="text-slate-500 tabular-nums">{c.durationSemesters} semesters</span>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-5 space-y-4">
          <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
            Academic Sessions
          </h2>
          <form onSubmit={handleAddSession} className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="e.g. 2026-2027"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              className="flex-1 min-w-[160px]"
              required
            />
            <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={sessionCurrent}
                onChange={(e) => setSessionCurrent(e.target.checked)}
              />
              Current
            </label>
            <Button type="submit" size="sm" loading={addingSession}>
              Add Session
            </Button>
          </form>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
            {(academics?.academicSessions || []).map((s) => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2 text-xs">
                <span className="font-mono font-semibold text-slate-900 dark:text-white">{s.name}</span>
                <StatusText status={s.isCurrent ? 'active' : 'inactive'} />
              </div>
            ))}
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}

// ============================================================================
// LIBRARIANS MANAGEMENT (College Admin ONLY)
// ============================================================================

interface LibrarianItem {
  id: string;
  employeeCode: string;
  fullName: string;
  email: string;
  phone?: string | null;
  designation: string;
  canRegisterStudents: boolean;
  canAdjustFines: boolean;
  status: string;
  createdAt: string;
}

export function LibrariansPage() {
  const { activeWorkspace } = useAuth();
  const orgId = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationId : null;
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [designation, setDesignation] = useState('Assistant Librarian');
  const [password, setPassword] = useState('');
  const [canRegisterStudents, setCanRegisterStudents] = useState(true);
  const [canAdjustFines, setCanAdjustFines] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['org-librarians', orgId],
    queryFn: () => apiRequest<{ librarians: LibrarianItem[] }>('/org/librarians'),
    enabled: Boolean(orgId),
  });

  const list = data?.librarians || [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest('/org/librarians', {
        method: 'POST',
        body: {
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          employeeCode: employeeCode.trim(),
          designation: designation.trim() || 'Librarian',
          canRegisterStudents,
          canAdjustFines,
          password: password || undefined,
        },
      });
      toast.success('Librarian account created and authorized for this institution.');
      setCreateOpen(false);
      setFullName('');
      setEmail('');
      setPhone('');
      setEmployeeCode('');
      setPassword('');
      queryClient.invalidateQueries({ queryKey: ['org-librarians'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to add librarian.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (lib: LibrarianItem) => {
    const next = lib.status === 'active' ? 'suspended' : 'active';
    try {
      await apiRequest(`/org/librarians/${lib.id}`, {
        method: 'PATCH',
        body: { status: next },
      });
      toast.success(`Librarian ${lib.fullName} marked ${next}.`);
      queryClient.invalidateQueries({ queryKey: ['org-librarians'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to update librarian.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
            Library Staff & Librarians
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Provision circulation desk librarians with scoped institutional permissions.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Add Librarian
        </Button>
      </div>

      <SurfaceCard className="overflow-hidden">
        {isLoading ? (
          <div className="p-5">
            <SkeletonRows rows={5} />
          </div>
        ) : list.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No librarians assigned yet"
              description="Add library desk staff to manage daily book issue, return, cataloging, and student verification."
              action={
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  Add First Librarian
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Staff Member</th>
                  <th className="px-4 py-3">Employee Code</th>
                  <th className="px-4 py-3">Designation</th>
                  <th className="px-4 py-3">Permissions</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {list.map((lib) => (
                  <tr key={lib.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">{lib.fullName}</div>
                      <div className="text-xs text-slate-500">
                        {lib.email} {lib.phone ? `· ${lib.phone}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{lib.employeeCode}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                      {lib.designation}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                      <div>Register Students: {lib.canRegisterStudents ? 'Yes' : 'No'}</div>
                      <div>Adjust Fines: {lib.canAdjustFines ? 'Yes' : 'Request Only'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={lib.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant={lib.status === 'active' ? 'outline' : 'primary'}
                        onClick={() => toggleStatus(lib)}
                      >
                        {lib.status === 'active' ? (
                          <>
                            <UserX className="h-3.5 w-3.5" />
                            Suspend
                          </>
                        ) : (
                          <>
                            <UserCheck className="h-3.5 w-3.5" />
                            Reactivate
                          </>
                        )}
                      </Button>
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
        title="Add Institutional Librarian"
        description="Creates or links a staff account with the Librarian role scoped strictly to this college."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full Name" required>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </Field>
            <Field label="Employee Code" required>
              <Input
                value={employeeCode}
                onChange={(e) => setEmployeeCode(e.target.value)}
                placeholder="LIB-001"
                required
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Institutional Email" required>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Phone Number">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Designation" required>
              <Input value={designation} onChange={(e) => setDesignation(e.target.value)} required />
            </Field>
            <Field label="Initial Password" hint="Required for new accounts (min 8 chars)">
              <Input
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 8 characters"
              />
            </Field>
          </div>
          <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={canRegisterStudents}
                onChange={(e) => setCanRegisterStudents(e.target.checked)}
              />
              <span>Allow registering and approving student applications</span>
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={canAdjustFines}
                onChange={(e) => setCanAdjustFines(e.target.checked)}
              />
              <span>Allow fine adjustments (waiver approvals still audited)</span>
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              <Shield className="h-4 w-4" />
              Create Librarian
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ============================================================================
// REAL POSTGRESQL ANALYTICS & REPORTS (Date-filtered + CSV & PDF Export)
// ============================================================================

interface OrgReportResponse {
  range: { startDate: string; endDate: string };
  summary: {
    totalBookTitles: number;
    totalCopies: number;
    availableCopies: number;
    issuedCopies: number;
    overdueBooks: number;
    studentRegistrationsInRange: number;
    issuesInRange: number;
    returnsInRange: number;
    fineGenerated: number;
    fineCollected: number;
  };
  courseWiseStudents: Array<{ course: string; fullName: string; students: number }>;
  mostBorrowedBooks: Array<{ bookId: string; title: string; isbn: string; borrows: number }>;
  recentIssues: Array<{
    id: string;
    receiptNumber: string;
    status: string;
    issuedAt: string;
    dueAt: string;
    returnedAt?: string | null;
    bookTitle: string;
    studentName: string;
    rollNumber: string;
    barcode: string;
  }>;
  recentReturns: Array<{
    id: string;
    receiptNumber: string;
    returnedAt: string;
    bookTitle: string;
    studentName: string;
    barcode: string;
  }>;
}

export function OrgReportsPage() {
  const { activeWorkspace } = useAuth();
  const orgId = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationId : null;
  const orgName = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationName : 'QIVORA Library';

  const [range, setRange] = useState('30d');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const queryParams = new URLSearchParams();
  if (range === 'custom' && fromDate && toDate) {
    queryParams.set('from', fromDate);
    queryParams.set('to', toDate);
  } else {
    queryParams.set('range', range === 'custom' ? '30d' : range);
  }

  const { data, isLoading } = useQuery({
    queryKey: ['org-reports', orgId, queryParams.toString()],
    queryFn: () => apiRequest<OrgReportResponse>(`/org/reports?${queryParams.toString()}`),
    enabled: Boolean(orgId),
  });

  const { data: settingsData } = useQuery({
    queryKey: ['org-settings', orgId],
    queryFn: () => apiRequest<{ settings: { currencySymbol?: string } | null }>('/org/settings'),
    enabled: Boolean(orgId),
  });
  const currency = settingsData?.settings?.currencySymbol || '₹';

  const handleExportCsv = () => {
    if (!data?.recentIssues.length) {
      toast.error('No circulation records in this period to export.');
      return;
    }
    exportToCsv(
      `qivora-circulation-${range}.csv`,
      data.recentIssues.map((r) => ({
        Receipt: r.receiptNumber,
        Student: r.studentName,
        RollNumber: r.rollNumber,
        BookTitle: r.bookTitle,
        Barcode: r.barcode,
        IssuedAt: formatDateTime(r.issuedAt),
        DueAt: formatDate(r.dueAt),
        ReturnedAt: r.returnedAt ? formatDateTime(r.returnedAt) : 'Not Returned',
        Status: r.status,
      }))
    );
    toast.success('CSV report downloaded.');
  };

  const handleExportPdf = () => {
    if (!data) return;
    downloadReportPdf({
      title: 'Institutional Library Operations Report',
      organizationName: orgName,
      dateRangeLabel: `${formatDate(data.range.startDate)} to ${formatDate(data.range.endDate)}`,
      metrics: [
        { label: 'Book Titles', value: String(data.summary.totalBookTitles) },
        { label: 'Physical Copies', value: String(data.summary.totalCopies) },
        { label: 'Issues in Period', value: String(data.summary.issuesInRange) },
        { label: 'Returns in Period', value: String(data.summary.returnsInRange) },
        { label: 'Overdue Books', value: String(data.summary.overdueBooks) },
        { label: 'Fines Collected', value: formatCurrency(data.summary.fineCollected, currency) },
      ],
      rows: data.recentIssues.map((r) => ({
        Receipt: r.receiptNumber,
        Student: r.studentName,
        Book: r.bookTitle,
        Issued: formatDate(r.issuedAt),
        Status: r.status,
      })),
    });
    toast.success('PDF report generated.');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
            Analytics & Operational Reports
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Live database metrics filtered by reporting window with CSV and PDF export.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!data}>
            <FileSpreadsheet className="h-4 w-4" />
            Export CSV
          </Button>
          <Button size="sm" onClick={handleExportPdf} disabled={!data}>
            <Download className="h-4 w-4" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* Date Range Controls */}
      <SurfaceCard className="p-4 flex flex-wrap items-end gap-3">
        <Field label="Reporting Period" className="w-44">
          <Select value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="today">Today</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
            <option value="year">Past 12 Months</option>
            <option value="custom">Custom Range</option>
          </Select>
        </Field>
        {range === 'custom' && (
          <>
            <Field label="From Date">
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </Field>
            <Field label="To Date">
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </Field>
          </>
        )}
        {data && (
          <div className="text-xs text-slate-500 dark:text-slate-400 ml-auto pb-2 font-mono tabular-nums">
            Window: {formatDate(data.range.startDate)} — {formatDate(data.range.endDate)}
          </div>
        )}
      </SurfaceCard>

      {isLoading || !data ? (
        <SurfaceCard className="p-6">
          <SkeletonRows rows={6} />
        </SurfaceCard>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <MetricTile label="Book Titles" value={data.summary.totalBookTitles} subtext={`${data.summary.totalCopies} total copies`} />
            <MetricTile label="Issued in Period" value={data.summary.issuesInRange} subtext={`${data.summary.returnsInRange} returned`} />
            <MetricTile
              label="Overdue Books"
              value={data.summary.overdueBooks}
              tone={data.summary.overdueBooks > 0 ? 'danger' : 'default'}
            />
            <MetricTile label="New Students" value={data.summary.studentRegistrationsInRange} />
            <MetricTile
              label="Fines Collected"
              value={formatCurrency(data.summary.fineCollected, currency)}
              subtext={`Assessed: ${formatCurrency(data.summary.fineGenerated, currency)}`}
              tone="success"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SurfaceCard className="p-5">
              <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white mb-4">
                Course-wise Student Distribution
              </h2>
              {data.courseWiseStudents.length === 0 ? (
                <EmptyState
                  title="No enrolled student data yet"
                  description="Course distribution will chart automatically as students are approved."
                />
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.courseWiseStudents} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#94a3b825" />
                      <XAxis dataKey="course" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="students" fill="#1E3A8A" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </SurfaceCard>

            <SurfaceCard className="p-5">
              <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white mb-4">
                Most Borrowed Titles
              </h2>
              {data.mostBorrowedBooks.length === 0 ? (
                <EmptyState
                  title="No borrowing activity yet"
                  description="Top circulating books will appear once issues are processed at the desk."
                />
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.mostBorrowedBooks.map((b) => ({
                        name: b.title.length > 18 ? `${b.title.slice(0, 18)}…` : b.title,
                        borrows: b.borrows,
                      }))}
                      margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#94a3b825" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="borrows" fill="#2563EB" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </SurfaceCard>
          </div>

          <SurfaceCard className="overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white">
                Circulation Transactions in Period ({data.recentIssues.length})
              </h2>
            </div>
            {data.recentIssues.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No transactions in selected date range"
                  description="Try widening the reporting window or issue books from the Circulation Desk."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs font-semibold text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Receipt</th>
                      <th className="px-4 py-3">Student</th>
                      <th className="px-4 py-3">Book & Copy</th>
                      <th className="px-4 py-3">Issued</th>
                      <th className="px-4 py-3">Due / Returned</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {data.recentIssues.map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-2.5 font-mono font-semibold">{row.receiptNumber}</td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-900 dark:text-white">{row.studentName}</div>
                          <div className="font-mono text-slate-500">{row.rollNumber}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-900 dark:text-white">{row.bookTitle}</div>
                          <div className="font-mono text-slate-500">{row.barcode}</div>
                        </td>
                        <td className="px-4 py-2.5 font-mono tabular-nums">{formatDate(row.issuedAt)}</td>
                        <td className="px-4 py-2.5 font-mono tabular-nums">
                          {row.returnedAt ? `Returned ${formatDate(row.returnedAt)}` : `Due ${formatDate(row.dueAt)}`}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusText status={row.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SurfaceCard>
        </>
      )}
    </div>
  );
}

// ============================================================================
// ORGANIZATION AUDIT LOGS (College Admin ONLY)
// ============================================================================

interface AuditLogRow {
  id: string;
  actorName?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
  createdAt: string;
}

export function OrgAuditLogsPage() {
  const { activeWorkspace } = useAuth();
  const orgId = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationId : null;

  const { data, isLoading } = useQuery({
    queryKey: ['org-audit-logs', orgId],
    queryFn: () => apiRequest<{ auditLogs: AuditLogRow[] }>('/org/audit-logs?limit=150'),
    enabled: Boolean(orgId),
  });

  const logs = data?.auditLogs || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
          Institutional Audit Trail
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Immutable log of sensitive student, circulation, fine waiver, template, and governance events for this institution.
        </p>
      </div>

      <SurfaceCard className="overflow-hidden">
        {isLoading ? (
          <div className="p-5">
            <SkeletonRows rows={6} />
          </div>
        ) : logs.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No audit events recorded yet"
              description="Administrative actions, approvals, circulation receipts, and ID card lifecycle changes will be recorded automatically."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3">Audit Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-2.5 font-mono text-slate-500 whitespace-nowrap tabular-nums">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900 dark:text-white">
                        {log.actorName || 'System'}
                      </div>
                      <div className="text-[11px] text-slate-500">{log.actorRole || '—'}</div>
                    </td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-800 dark:text-slate-200">
                      {log.action}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{log.entityType}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500 max-w-md truncate">
                      {log.details ? JSON.stringify(log.details) : '—'}
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
