import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Check, Download, Eye, Search, UserPlus, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { BulkStudentRegisterModal } from '../../components/students/BulkStudentRegisterModal.tsx';
import {
  Button,
  EmptyState,
  Field,
  FileUploadControl,
  Input,
  Modal,
  Select,
  SkeletonRows,
  StatusText,
  SurfaceCard,
  Textarea,
} from '../../components/ui/primitives.tsx';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { exportToCsv, formatCurrency, formatDate } from '../../lib/utils.ts';

interface AcademicsResponse {
  academicSessions: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  courses: Array<{ id: string; name: string; code: string }>;
  semesters: Array<{ id: string; courseId: string; name: string; number: number }>;
  studentCategories: Array<{ id: string; name: string }>;
}

interface StudentRow {
  id: string;
  studentIdCode: string;
  fullName: string;
  fatherName: string;
  collegeRollNumber: string;
  universityRollNumber?: string | null;
  courseId?: string | null;
  semesterId?: string | null;
  academicSessionId?: string | null;
  courseName?: string | null;
  courseCode?: string | null;
  semesterName?: string | null;
  sessionName?: string | null;
  phone: string;
  email: string;
  status: string;
  photoUrl?: string | null;
  activeIdCard?: {
    cardId: string;
    cardNumber: string;
    templateName: string;
  } | null;
  founderLink?: {
    founderId: string;
    founderNumber: string;
    designation: string;
    status: string;
    collegeLinkStatus: string;
    issuedAt: string;
  } | null;
}

export function StudentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { activeWorkspace } = useAuth();
  const orgId = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationId : null;

  const [search, setSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [semesterFilter, setSemesterFilter] = useState('');
  const [sessionFilter, setSessionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const isAdmin =
    activeWorkspace?.type === 'organization' &&
    activeWorkspace.membership.roleSlug === 'college_admin';

  const [addOpen, setAddOpen] = useState(searchParams.get('action') === 'new');
  const [bulkRegisterOpen, setBulkRegisterOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [statusModal, setStatusModal] = useState<{ student: StudentRow; nextStatus: string } | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<'active' | 'suspended' | 'graduated' | 'blocked'>('active');
  const [bulkReason, setBulkReason] = useState('');

  const orgName =
    activeWorkspace?.type === 'organization'
      ? activeWorkspace.membership.organizationName
      : 'QIVORA Library';

  const [form, setForm] = useState({
    fullName: '',
    fatherName: '',
    collegeRollNumber: '',
    universityRollNumber: '',
    courseId: '',
    semesterId: '',
    departmentId: '',
    academicSessionId: '',
    studentCategoryId: '',
    dateOfBirth: '',
    gender: '',
    phone: '',
    email: '',
    address: '',
    photoUrl: null as string | null,
    idProofUrl: null as string | null,
    password: '',
    autoGenerateId: true,
  });

  const { data: academics } = useQuery({
    queryKey: ['org-academics', orgId],
    queryFn: () => apiRequest<AcademicsResponse>('/org/academics'),
    enabled: Boolean(orgId),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['org-students', orgId],
    queryFn: () => apiRequest<{ students: StudentRow[] }>('/org/students'),
    enabled: Boolean(orgId),
  });

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ['org-student-detail', orgId, detailId],
    queryFn: () =>
      apiRequest<{
        student: StudentRow;
        loans: Array<{ id: string; receiptNumber: string; issuedAt: string; dueAt: string; status: string }>;
        fines: Array<{ id: string; amount: string; paidAmount: string; reason: string; status: string }>;
        attendance: Array<{ id: string; checkInAt: string; method: string }>;
        idHistory: Array<{ id: string; cardNumber: string; templateName: string; status: string; issuedAt: string }>;
      }>(`/org/students/${detailId}`),
    enabled: Boolean(detailId),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.students || []).filter((s) => {
      if (courseFilter && s.courseId !== courseFilter) return false;
      if (semesterFilter && s.semesterId !== semesterFilter) return false;
      if (sessionFilter && s.academicSessionId !== sessionFilter) return false;
      if (statusFilter && s.status !== statusFilter) return false;
      if (!q) return true;
      return (
        s.fullName.toLowerCase().includes(q) ||
        s.collegeRollNumber.toLowerCase().includes(q) ||
        s.studentIdCode.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q)
      );
    });
  }, [data?.students, search, courseFilter, semesterFilter, sessionFilter, statusFilter]);

  const existingRolls = useMemo(
    () => new Set((data?.students || []).map((s) => s.collegeRollNumber.trim().toLowerCase())),
    [data?.students]
  );

  const existingEmails = useMemo(
    () => new Set((data?.students || []).map((s) => s.email.trim().toLowerCase())),
    [data?.students]
  );

  const formSemesters = (academics?.semesters || []).filter(
    (s) => !form.courseId || s.courseId === form.courseId
  );

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest('/org/students', {
        method: 'POST',
        body: {
          ...form,
          courseId: form.courseId || null,
          semesterId: form.semesterId || null,
          departmentId: form.departmentId || null,
          academicSessionId: form.academicSessionId || null,
          studentCategoryId: form.studentCategoryId || null,
          password: form.password || undefined,
        },
      });
      toast.success('Student registered and official Digital ID issued.');
      setAddOpen(false);
      setSearchParams({});
      setForm({
        fullName: '',
        fatherName: '',
        collegeRollNumber: '',
        universityRollNumber: '',
        courseId: '',
        semesterId: '',
        departmentId: '',
        academicSessionId: '',
        studentCategoryId: '',
        dateOfBirth: '',
        gender: '',
        phone: '',
        email: '',
        address: '',
        photoUrl: null,
        idProofUrl: null,
        password: '',
        autoGenerateId: true,
      });
      queryClient.invalidateQueries({ queryKey: ['org-students'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to register student.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusModal) return;
    try {
      await apiRequest(`/org/students/${statusModal.student.id}/status`, {
        method: 'PATCH',
        body: { status: statusModal.nextStatus, reason: statusReason },
      });
      toast.success(`Student status changed to ${statusModal.nextStatus}.`);
      setStatusModal(null);
      setStatusReason('');
      queryClient.invalidateQueries({ queryKey: ['org-students'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Status update failed.');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map((s) => s.id));
    }
  };

  const handleBulkStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIds.length) return;
    setSubmitting(true);
    try {
      const res = await apiRequest<{ updatedCount: number }>('/org/students/bulk-status', {
        method: 'POST',
        body: { studentIds: selectedIds, status: bulkStatus, reason: bulkReason },
      });
      toast.success(`Updated ${res.updatedCount} student(s) to ${bulkStatus}.`);
      setBulkOpen(false);
      setBulkReason('');
      setSelectedIds([]);
      queryClient.invalidateQueries({ queryKey: ['org-students'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Bulk update failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportSelected = () => {
    const subset = selectedIds.length
      ? filtered.filter((s) => selectedIds.includes(s.id))
      : filtered;
    exportToCsv(
      `qivora-students-${Date.now()}.csv`,
      subset.map((s) => ({
        StudentID: s.studentIdCode,
        FullName: s.fullName,
        FatherName: s.fatherName,
        RollNumber: s.collegeRollNumber,
        Course: s.courseName || '—',
        Semester: s.semesterName || '—',
        Email: s.email,
        Phone: s.phone,
        Status: s.status,
      }))
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Student Directory
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Manage verified student memberships, academic details, borrowing eligibility, and IDs.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportSelected} disabled={!filtered.length}>
            <Download className="h-3.5 w-3.5" />
            Export {selectedIds.length ? `Selected (${selectedIds.length})` : 'CSV'}
          </Button>
          {isAdmin && selectedIds.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setBulkOpen(true)}>
              Bulk Status ({selectedIds.length})
            </Button>
          )}
          <Button variant="outline" onClick={() => setBulkRegisterOpen(true)}>
            <Users className="h-4 w-4" />
            Bulk Register Students
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Register Student
          </Button>
        </div>
      </div>

      {/* Filters */}
      <SurfaceCard className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, roll no., ID, email..."
              className="pl-9"
            />
          </div>
          <Select value={courseFilter} onChange={(e) => { setCourseFilter(e.target.value); setSemesterFilter(''); }}>
            <option value="">All Courses</option>
            {(academics?.courses || []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Select value={semesterFilter} onChange={(e) => setSemesterFilter(e.target.value)}>
            <option value="">All Semesters</option>
            {(academics?.semesters || [])
              .filter((s) => !courseFilter || s.courseId === courseFilter)
              .map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
          </Select>
          <Select value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value)}>
            <option value="">All Sessions</option>
            {(academics?.academicSessions || []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="graduated">Graduated</option>
            <option value="archived">Archived</option>
          </Select>
        </div>
      </SurfaceCard>

      {/* Table */}
      <SurfaceCard className="overflow-hidden">
        {isLoading ? (
          <div className="p-5"><SkeletonRows rows={5} /></div>
        ) : !filtered.length ? (
          <div className="p-6">
            <EmptyState
              title="No matching students"
              description="Register your first student or approve pending applications from the Applications tab."
              action={<Button onClick={() => setAddOpen(true)}>Register Student</Button>}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                <tr>
                  <th className="px-3 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && selectedIds.length === filtered.length}
                      onChange={toggleSelectAll}
                      aria-label="Select all students"
                    />
                  </th>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Student ID / Roll</th>
                  <th className="px-4 py-3">Course & Semester</th>
                  <th className="px-4 py-3">Official ID Card</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(s.id)}
                        onChange={() => toggleSelect(s.id)}
                        aria-label={`Select ${s.fullName}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {s.fullName}
                        </span>
                        {s.founderLink && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                              s.founderLink.collegeLinkStatus === 'approved'
                                ? 'bg-[#0A0B0F] text-[#F6DF9C] border border-[#D4AF37]/60'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                            }`}
                          >
                            <Award className="h-2.5 w-2.5 text-[#D4AF37]" />
                            {s.founderLink.collegeLinkStatus === 'approved'
                              ? 'Founder'
                              : 'Founder Link Pending'}
                          </span>
                        )}
                      </div>
                      <div className="text-slate-500">{s.email} · {s.phone}</div>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      <div>{s.studentIdCode}</div>
                      <div className="text-slate-500">Roll: {s.collegeRollNumber}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{s.courseCode || s.courseName || '—'} · {s.semesterName || '—'}</div>
                      <div className="text-slate-500 font-mono">{s.sessionName || '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      {s.activeIdCard ? (
                        <div>
                          <div className="font-mono text-slate-900 dark:text-slate-100">
                            {s.activeIdCard.cardNumber}
                          </div>
                          <div className="text-slate-500">{s.activeIdCard.templateName}</div>
                        </div>
                      ) : (
                        <span className="text-slate-400">Not issued</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={s.status} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                      <Button size="sm" variant="outline" onClick={() => setDetailId(s.id)}>
                        <Eye className="h-3.5 w-3.5" />
                        Profile
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setStatusModal({
                            student: s,
                            nextStatus: s.status === 'active' ? 'suspended' : 'active',
                          })
                        }
                      >
                        {s.status === 'active' ? 'Suspend' : 'Reactivate'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      {/* Register Student Modal */}
      <Modal
        open={addOpen}
        onOpenChange={(o) => { setAddOpen(o); if (!o) setSearchParams({}); }}
        title="Register New Student"
        description="Creates student record, assigns organization membership, and applies the highest-priority official ID template."
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleRegister} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Student Full Name" required>
              <Input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </Field>
            <Field label="Father's Name" required>
              <Input required value={form.fatherName} onChange={(e) => setForm({ ...form, fatherName: e.target.value })} />
            </Field>
            <Field label="College Roll Number" required>
              <Input required value={form.collegeRollNumber} onChange={(e) => setForm({ ...form, collegeRollNumber: e.target.value })} />
            </Field>
            <Field label="University Roll Number">
              <Input value={form.universityRollNumber} onChange={(e) => setForm({ ...form, universityRollNumber: e.target.value })} />
            </Field>
            <Field label="Department">
              <Select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                <option value="">Select department</option>
                {(academics?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Course">
              <Select value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value, semesterId: '' })}>
                <option value="">Select course</option>
                {(academics?.courses || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Semester">
              <Select value={form.semesterId} onChange={(e) => setForm({ ...form, semesterId: e.target.value })}>
                <option value="">Select semester</option>
                {formSemesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Academic Session">
              <Select value={form.academicSessionId} onChange={(e) => setForm({ ...form, academicSessionId: e.target.value })}>
                <option value="">Select session</option>
                {(academics?.academicSessions || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Student Category">
              <Select value={form.studentCategoryId} onChange={(e) => setForm({ ...form, studentCategoryId: e.target.value })}>
                <option value="">Select category</option>
                {(academics?.studentCategories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Date of Birth">
              <Input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
            </Field>
            <Field label="Phone Number" required>
              <Input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Email Address" required>
              <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Portal Password" hint="Defaults to Qiv@<RollNumber> if left blank.">
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 8 characters" />
            </Field>
            <Field label="Gender">
              <Select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="">Optional</option>
                <option value="Female">Female</option>
                <option value="Male">Male</option>
                <option value="Other">Other</option>
              </Select>
            </Field>
            <Field label="Profile Photograph">
              <FileUploadControl
                bucket="student_photos"
                label="Upload Photo"
                currentUrl={form.photoUrl}
                onUploaded={(url) => setForm({ ...form, photoUrl: url })}
                allowClear
              />
            </Field>
            <Field label="College ID Proof (Private Storage)">
              <FileUploadControl
                bucket="student_documents"
                label="Upload ID Proof"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                currentUrl={form.idProofUrl}
                onUploaded={(url) => setForm({ ...form, idProofUrl: url })}
                allowClear
              />
            </Field>
          </div>
          <Field label="Address">
            <Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.autoGenerateId}
              onChange={(e) => setForm({ ...form, autoGenerateId: e.target.checked })}
            />
            Generate official Digital ID immediately using assigned course/semester template
          </label>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit" loading={submitting}>Register Student</Button>
          </div>
        </form>
      </Modal>

      {/* Student Profile Drawer Modal */}
      <Modal
        open={Boolean(detailId)}
        onOpenChange={(o) => !o && setDetailId(null)}
        title={detailData?.student.fullName || 'Student Profile'}
        description={detailData ? `${detailData.student.studentIdCode} · Roll ${detailData.student.collegeRollNumber}` : undefined}
        maxWidth="max-w-2xl"
      >
        {detailLoading ? (
          <SkeletonRows rows={4} />
        ) : detailData ? (
          <div className="space-y-5 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div><div className="text-slate-400">Father's Name</div><div className="font-medium mt-0.5">{detailData.student.fatherName}</div></div>
              <div><div className="text-slate-400">Email</div><div className="font-medium mt-0.5">{detailData.student.email}</div></div>
              <div><div className="text-slate-400">Phone</div><div className="font-medium mt-0.5">{detailData.student.phone}</div></div>
              <div><div className="text-slate-400">Status</div><div className="mt-0.5"><StatusText status={detailData.student.status} /></div></div>
            </div>

            {detailData.student.founderLink && (
              <div className="rounded-xl border border-[#D4AF37]/50 bg-[#0A0B0F] p-4 text-[#F6DF9C] space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Award className="h-4 w-4 text-[#D4AF37]" />
                    <span className="font-display font-semibold text-sm">
                      Linked QIVORA Golden Founder ID
                    </span>
                  </div>
                  <span className="font-mono text-[10.5px] uppercase tracking-wider text-[#D4AF37]">
                    {detailData.student.founderLink.collegeLinkStatus.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[#9A834B]">Founder No.</span>
                    <div className="font-mono font-semibold mt-0.5">
                      {detailData.student.founderLink.founderNumber}
                    </div>
                  </div>
                  <div>
                    <span className="text-[#9A834B]">Designation</span>
                    <div className="mt-0.5">{detailData.student.founderLink.designation}</div>
                  </div>
                </div>
                <p className="text-[11px] text-[#C7B482]">
                  Founder credentials are exclusively assigned and managed by the Platform Super
                  Admin. Standard college borrowing rules, limits, and fines remain enforced.
                </p>
              </div>
            )}

            <div>
              <h3 className="font-display font-semibold text-sm mb-2">Issued Books ({detailData.loans.length})</h3>
              {!detailData.loans.length ? (
                <p className="text-slate-500">No circulation history yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                  {detailData.loans.slice(0, 6).map((l) => (
                    <div key={l.id} className="px-3 py-2 flex items-center justify-between">
                      <span className="font-mono">{l.receiptNumber}</span>
                      <span className="font-mono text-slate-500">Due {formatDate(l.dueAt)}</span>
                      <StatusText status={l.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="font-display font-semibold text-sm mb-2">Fine Records ({detailData.fines.length})</h3>
              {!detailData.fines.length ? (
                <p className="text-slate-500">No fines recorded.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                  {detailData.fines.map((f) => (
                    <div key={f.id} className="px-3 py-2 flex items-center justify-between gap-2">
                      <span className="truncate">{f.reason}</span>
                      <span className="font-mono tabular-nums">{formatCurrency(f.amount)}</span>
                      <StatusText status={f.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="font-display font-semibold text-sm mb-2">Digital ID History ({detailData.idHistory.length})</h3>
              {!detailData.idHistory.length ? (
                <p className="text-slate-500">No Digital IDs issued yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                  {detailData.idHistory.map((c) => (
                    <div key={c.id} className="px-3 py-2 flex items-center justify-between">
                      <span className="font-mono">{c.cardNumber}</span>
                      <span>{c.templateName}</span>
                      <StatusText status={c.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Bulk Student Registration Modal */}
      <BulkStudentRegisterModal
        open={bulkRegisterOpen}
        onOpenChange={setBulkRegisterOpen}
        organizationName={orgName}
        courses={academics?.courses || []}
        semesters={academics?.semesters || []}
        academicSessions={academics?.academicSessions || []}
        existingRolls={existingRolls}
        existingEmails={existingEmails}
        onCompleted={() => {
          queryClient.invalidateQueries({ queryKey: ['org-students'] });
          queryClient.invalidateQueries({ queryKey: ['org-overview'] });
          queryClient.invalidateQueries({ queryKey: ['org-academics'] });
        }}
      />

      {/* Suspend / Reactivate Modal */}
      <Modal
        open={Boolean(statusModal)}
        onOpenChange={(o) => !o && setStatusModal(null)}
        title={`${statusModal?.nextStatus === 'active' ? 'Reactivate' : 'Suspend'} Student`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleStatusChange} className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Provide an auditable reason for changing <strong>{statusModal?.student.fullName}</strong> to{' '}
            <strong>{statusModal?.nextStatus}</strong>.
          </p>
          <Field label="Reason" required>
            <Input
              required
              minLength={3}
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              placeholder="e.g. Overdue clearance / disciplinary hold"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setStatusModal(null)}>Cancel</Button>
            <Button type="submit" variant={statusModal?.nextStatus === 'suspended' ? 'danger' : 'primary'}>
              Confirm
            </Button>
          </div>
        </form>
      </Modal>

      {/* Bulk Status Modal */}
      <Modal
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title={`Bulk Status Update (${selectedIds.length} students)`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleBulkStatus} className="space-y-4">
          <Field label="Target Status" required>
            <Select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value as typeof bulkStatus)}
            >
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="graduated">Graduated</option>
              <option value="blocked">Blocked</option>
            </Select>
          </Field>
          <Field label="Auditable Reason" required>
            <Input
              required
              minLength={3}
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              placeholder="e.g., End-of-term graduation cohort update"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button type="submit" loading={submitting}>Apply Bulk Update</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function StudentApplicationsPage() {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useAuth();
  const orgId = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationId : null;

  const [statusTab, setStatusTab] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [rejectTarget, setRejectTarget] = useState<{ id: string; fullName: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['org-student-applications', orgId, statusTab],
    queryFn: () =>
      apiRequest<{
        applications: Array<{
          id: string;
          fullName: string;
          fatherName: string;
          collegeRollNumber: string;
          email: string;
          phone: string;
          courseName?: string;
          semesterName?: string;
          sessionName?: string;
          status: string;
          rejectionReason?: string;
          createdAt: string;
        }>;
      }>(`/org/student-applications?status=${statusTab}`),
    enabled: Boolean(orgId),
  });

  const approve = async (id: string) => {
    setBusyId(id);
    try {
      await apiRequest(`/org/student-applications/${id}/approve`, { method: 'POST' });
      toast.success('Application approved. Student activated and Digital ID generated.');
      queryClient.invalidateQueries({ queryKey: ['org-student-applications'] });
      queryClient.invalidateQueries({ queryKey: ['org-students'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Approval failed.');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget) return;
    setBusyId(rejectTarget.id);
    try {
      await apiRequest(`/org/student-applications/${rejectTarget.id}/reject`, {
        method: 'POST',
        body: { reason: rejectReason },
      });
      toast.success('Application rejected and student notified.');
      setRejectTarget(null);
      setRejectReason('');
      queryClient.invalidateQueries({ queryKey: ['org-student-applications'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Rejection failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Student Registration Applications
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Review self-registered students. Approval activates library access and generates their
            official Digital ID card.
          </p>
        </div>

        <div className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800/80">
          {(['pending', 'approved', 'rejected', 'all'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusTab(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors cursor-pointer ${
                statusTab === tab
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <SurfaceCard className="overflow-hidden">
        {isLoading ? (
          <div className="p-5"><SkeletonRows rows={4} /></div>
        ) : !data?.applications?.length ? (
          <div className="p-6">
            <EmptyState
              title={`No ${statusTab} applications`}
              description="Students can submit registration requests via the public Student Registration form on the sign-in screen."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3">Applicant</th>
                  <th className="px-4 py-3">Roll Number</th>
                  <th className="px-4 py-3">Academic Details</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.applications.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900 dark:text-white">{a.fullName}</div>
                      <div className="text-slate-500">S/O · D/O {a.fatherName} · {a.email}</div>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">{a.collegeRollNumber}</td>
                    <td className="px-4 py-3">
                      <div>{a.courseName || '—'} · {a.semesterName || '—'}</div>
                      <div className="text-slate-500 font-mono">{a.sessionName || '—'}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500 tabular-nums">
                      {formatDate(a.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={a.status} />
                      {a.rejectionReason && (
                        <div className="text-[11px] text-red-500 mt-0.5 max-w-[200px] truncate">
                          {a.rejectionReason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                      {a.status === 'pending' && (
                        <>
                          <Button
                            size="sm"
                            loading={busyId === a.id}
                            onClick={() => approve(a.id)}
                          >
                            <Check className="h-3.5 w-3.5" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setRejectTarget({ id: a.id, fullName: a.fullName })}
                          >
                            <X className="h-3.5 w-3.5" />
                            Reject
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      <Modal
        open={Boolean(rejectTarget)}
        onOpenChange={(o) => !o && setRejectTarget(null)}
        title={`Reject ${rejectTarget?.fullName || ''}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={reject} className="space-y-4">
          <Field label="Rejection Reason" required>
            <Textarea
              required
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Explain why the registration cannot be approved..."
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button type="submit" variant="danger" loading={busyId === rejectTarget?.id}>
              Reject Application
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
