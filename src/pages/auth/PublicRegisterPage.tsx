import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Moon, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { QivoraFooter, QivoraLogo } from '../../components/brand/QivoraLogo.tsx';
import { Button, Field, Input, Select, SurfaceCard, Textarea } from '../../components/ui/primitives.tsx';
import { useTheme } from '../../contexts/ThemeContext.tsx';
import { apiRequest } from '../../lib/api.ts';

export function PublicRegisterPage() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const [orgId, setOrgId] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    fullName: '',
    fatherName: '',
    collegeRollNumber: '',
    universityRollNumber: '',
    proposedStudentId: '',
    departmentId: '',
    courseId: '',
    semesterId: '',
    academicSessionId: '',
    studentCategoryId: '',
    dateOfBirth: '',
    gender: '',
    phone: '',
    email: '',
    address: '',
    password: '',
  });

  const { data: orgsData } = useQuery({
    queryKey: ['public-organizations'],
    queryFn: () =>
      apiRequest<{
        organizations: Array<{ id: string; name: string; code: string; universityName?: string }>;
      }>('/public/organizations', { skipAuth: true }),
  });

  const { data: academics } = useQuery({
    queryKey: ['public-academics', orgId],
    queryFn: () =>
      apiRequest<{
        departments: Array<{ id: string; name: string }>;
        courses: Array<{ id: string; name: string; code: string }>;
        semesters: Array<{ id: string; courseId: string; name: string; number: number }>;
        academicSessions: Array<{ id: string; name: string; isCurrent: boolean }>;
        studentCategories: Array<{ id: string; name: string }>;
      }>(`/public/organizations/${orgId}/academics`, { skipAuth: true }),
    enabled: Boolean(orgId),
  });

  const filteredSemesters = (academics?.semesters || []).filter(
    (s) => !form.courseId || s.courseId === form.courseId
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) {
      toast.error('Select your college or university first.');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/public/student-register', {
        method: 'POST',
        skipAuth: true,
        body: {
          organizationId: orgId,
          fullName: form.fullName,
          fatherName: form.fatherName,
          collegeRollNumber: form.collegeRollNumber,
          universityRollNumber: form.universityRollNumber || null,
          proposedStudentId: form.proposedStudentId || null,
          departmentId: form.departmentId || null,
          courseId: form.courseId || null,
          semesterId: form.semesterId || null,
          academicSessionId: form.academicSessionId || null,
          studentCategoryId: form.studentCategoryId || null,
          dateOfBirth: form.dateOfBirth || null,
          gender: form.gender || null,
          phone: form.phone,
          email: form.email,
          address: form.address || null,
          password: form.password || undefined,
        },
      });
      setSubmitted(true);
      toast.success('Registration submitted for college approval.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to submit registration.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1120] py-8 px-4 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <Link to="/login" className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Back to Sign In
          </Link>
          <div className="flex items-center gap-3">
            <QivoraLogo size="sm" />
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 cursor-pointer"
            >
              {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {submitted ? (
          <SurfaceCard className="p-8 text-center space-y-4">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600 dark:text-emerald-400" />
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              Registration Application Submitted
            </h1>
            <p className="mx-auto max-w-md text-sm text-slate-600 dark:text-slate-400">
              Your application is now pending review by your College Admin or Librarian. Once approved,
              your official Digital ID card will be issued automatically and you can sign in to the
              QIVORA Student Portal.
            </p>
            <div className="pt-2">
              <Link to="/login">
                <Button>Return to Login</Button>
              </Link>
            </div>
          </SurfaceCard>
        ) : (
          <SurfaceCard className="p-6 sm:p-8">
            <div className="border-b border-slate-200 dark:border-slate-800 pb-5">
              <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                Student Library Registration
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Register for library membership and your official Digital ID card at your college.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-6">
              <Field label="Select College / University" required>
                <Select
                  required
                  value={orgId}
                  onChange={(e) => {
                    setOrgId(e.target.value);
                    setForm((f) => ({
                      ...f,
                      departmentId: '',
                      courseId: '',
                      semesterId: '',
                      academicSessionId: '',
                      studentCategoryId: '',
                    }));
                  }}
                >
                  <option value="">Choose your institution...</option>
                  {(orgsData?.organizations || []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.code})
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Student Full Name" required>
                  <Input
                    required
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    placeholder="Full legal name"
                  />
                </Field>
                <Field label="Father's Name" required>
                  <Input
                    required
                    value={form.fatherName}
                    onChange={(e) => setForm({ ...form, fatherName: e.target.value })}
                    placeholder="Father's full name"
                  />
                </Field>
                <Field label="College Roll Number" required>
                  <Input
                    required
                    value={form.collegeRollNumber}
                    onChange={(e) => setForm({ ...form, collegeRollNumber: e.target.value })}
                    placeholder="e.g. BCA-2026-042"
                  />
                </Field>
                <Field label="University Roll Number">
                  <Input
                    value={form.universityRollNumber}
                    onChange={(e) => setForm({ ...form, universityRollNumber: e.target.value })}
                    placeholder="Optional university roll no."
                  />
                </Field>
                <Field label="Department">
                  <Select
                    value={form.departmentId}
                    onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                    disabled={!orgId}
                  >
                    <option value="">Select department</option>
                    {(academics?.departments || []).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Course">
                  <Select
                    value={form.courseId}
                    onChange={(e) => setForm({ ...form, courseId: e.target.value, semesterId: '' })}
                    disabled={!orgId}
                  >
                    <option value="">Select course</option>
                    {(academics?.courses || []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Semester">
                  <Select
                    value={form.semesterId}
                    onChange={(e) => setForm({ ...form, semesterId: e.target.value })}
                    disabled={!orgId}
                  >
                    <option value="">Select semester</option>
                    {filteredSemesters.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Academic Session">
                  <Select
                    value={form.academicSessionId}
                    onChange={(e) => setForm({ ...form, academicSessionId: e.target.value })}
                    disabled={!orgId}
                  >
                    <option value="">Select session</option>
                    {(academics?.academicSessions || []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Student Category">
                  <Select
                    value={form.studentCategoryId}
                    onChange={(e) => setForm({ ...form, studentCategoryId: e.target.value })}
                    disabled={!orgId}
                  >
                    <option value="">Select category</option>
                    {(academics?.studentCategories || []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Date of Birth">
                  <Input
                    type="date"
                    value={form.dateOfBirth}
                    onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                  />
                </Field>
                <Field label="Gender">
                  <Select
                    value={form.gender}
                    onChange={(e) => setForm({ ...form, gender: e.target.value })}
                  >
                    <option value="">Prefer not to specify</option>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Other">Other</option>
                  </Select>
                </Field>
                <Field label="Phone Number" required>
                  <Input
                    required
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+91 98765 43210"
                  />
                </Field>
                <Field label="Email Address" required>
                  <Input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="student@college.edu"
                  />
                </Field>
                <Field label="Portal Password" required hint="Minimum 8 characters for signing in after approval.">
                  <Input
                    type="password"
                    required
                    minLength={8}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="Create a secure password"
                  />
                </Field>
              </div>

              <Field label="Residential Address">
                <Textarea
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="Full residential address"
                />
              </Field>

              <div className="flex justify-end gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <Link to="/login">
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Link>
                <Button type="submit" loading={submitting} disabled={!orgId}>
                  Submit Application
                </Button>
              </div>
            </form>
          </SurfaceCard>
        )}
        <QivoraFooter className="pt-4" />
      </div>
    </div>
  );
}
