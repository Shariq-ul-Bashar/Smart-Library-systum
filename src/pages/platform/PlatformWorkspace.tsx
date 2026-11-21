import React, { useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Award,
  Building2,
  Check,
  Database,
  FileSearch,
  KeyRound,
  Link2,
  Mail,
  Plug,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Unlink,
  UserPlus,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { type FounderCardData, FounderIdCardView } from '../../components/id-cards/DigitalIdCardView.tsx';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  FileUploadControl,
  Input,
  MetricTile,
  Modal,
  QuickActionTile,
  Select,
  SkeletonRows,
  StatusText,
  SurfaceCard,
  Textarea,
  WelcomeBanner,
} from '../../components/ui/primitives.tsx';
import { type AuthUser, useAuth } from '../../contexts/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { getFirebaseConfigDiagnostics } from '../../lib/env.ts';
import { formatDate, formatDateTime } from '../../lib/utils.ts';
import { founderService } from '../../services/founderService.ts';
import { PlatformAccountsPage } from './PlatformAccountsPage.tsx';
import { PlatformIntegrationsPage } from './PlatformIntegrationsPage.tsx';
import { PlatformStudentTiersPage } from './PlatformStudentTiersPage.tsx';

function PlatformOverview() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['platform-overview'],
    queryFn: () =>
      apiRequest<{
        metrics: {
          totalOrganizations: number;
          activeOrganizations: number;
          suspendedOrganizations: number;
          pendingOrganizations: number;
          totalCollegeAdmins: number;
          activeFounderIds: number;
          dbLatencyMs: number;
        };
        recentOrganizations: Array<{
          id: string;
          name: string;
          code: string;
          universityName?: string;
          status: string;
          createdAt: string;
        }>;
        recentActivity: Array<{
          id: string;
          actorEmail: string;
          action: string;
          entityType: string;
          createdAt: string;
        }>;
      }>('/platform/overview'),
  });

  if (isLoading) return <SkeletonRows rows={6} />;

  const m = data?.metrics;
  const activeRatio =
    (m?.totalOrganizations ?? 0) > 0
      ? Math.round(((m?.activeOrganizations ?? 0) / (m?.totalOrganizations ?? 1)) * 100)
      : 100;

  return (
    <div className="space-y-6">
      <WelcomeBanner
        name={user?.fullName || 'Platform Super Admin'}
        roleLabel="Platform Super Admin"
        organizationName="QIVORA Global Governance"
        subtitle="Multi-tenant institutional registry, Founder credentials, and global platform health. Private tenant records remain strictly isolated."
        avatarUrl={user?.avatarUrl}
        progressLabel="Active Institutions"
        progressValue={activeRatio}
        progressSubtext={`${m?.activeOrganizations ?? 0} active · DB ping ${m?.dbLatencyMs ?? 0} ms`}
        actions={
          <Link
            to="/platform/organizations"
            className="inline-flex items-center gap-2 rounded-xl bg-white text-[#2563EB] hover:bg-blue-50 px-3.5 py-2 text-xs font-semibold shadow-xs transition-colors"
          >
            <Building2 className="h-3.5 w-3.5" />
            Manage Institutions
          </Link>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricTile
          label="Registered Institutions"
          value={m?.totalOrganizations ?? 0}
          icon={Building2}
          pastel="blue"
          to="/platform/organizations"
        />
        <MetricTile
          label="Active Institutions"
          value={m?.activeOrganizations ?? 0}
          tone="success"
          icon={ShieldCheck}
          pastel="emerald"
          to="/platform/organizations"
        />
        <MetricTile
          label="Suspended Institutions"
          value={m?.suspendedOrganizations ?? 0}
          tone={(m?.suspendedOrganizations ?? 0) > 0 ? 'danger' : 'default'}
          icon={ShieldAlert}
          pastel="rose"
          to="/platform/organizations"
        />
        <MetricTile
          label="College Admin Accounts"
          value={m?.totalCollegeAdmins ?? 0}
          icon={UserPlus}
          pastel="purple"
          to="/platform/college-admins"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <QuickActionTile label="Organizations" description="Onboard colleges" icon={Building2} pastel="blue" to="/platform/organizations" />
        <QuickActionTile label="College Admins" description="Assign leaders" icon={UserPlus} pastel="purple" to="/platform/college-admins" />
        <QuickActionTile label="Founder IDs" description="Golden Edition" icon={Award} pastel="amber" to="/platform/founder-ids" />
        <QuickActionTile label="Integrations" description="Env & connectors" icon={Plug} pastel="indigo" to="/platform/integrations" />
        <QuickActionTile label="Audit Logs" description="Global trail" icon={FileSearch} pastel="cyan" to="/platform/audit-logs" />
        <QuickActionTile label="System Health" description="DB latency" icon={Activity} pastel="emerald" to="/platform/health" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SurfaceCard className="p-5">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Recent Organization Registrations
          </h2>
          <div className="mt-4">
            {!data?.recentOrganizations?.length ? (
              <EmptyState
                title="No institutions onboarded yet"
                description="Create your first college or university under Organizations to initialize its isolated database workspace and 9 starter ID templates."
              />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.recentOrganizations.map((org) => (
                  <div key={org.id} className="flex items-center justify-between py-3 gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 dark:text-white truncate">
                        {org.name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono">{org.code}</span>
                        {org.universityName ? ` · ${org.universityName}` : ''}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <StatusText status={org.status} />
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5 tabular-nums">
                        {formatDate(org.createdAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-5">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Recent Platform Activity
          </h2>
          <div className="mt-4">
            {!data?.recentActivity?.length ? (
              <EmptyState
                title="No platform audit events"
                description="Administrative actions across organizations, College Admins, and Founder IDs appear here automatically."
              />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.recentActivity.slice(0, 8).map((a) => (
                  <div key={a.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {a.action.replace(/_/g, ' ')}
                      </span>
                      <div className="text-slate-500 dark:text-slate-400 truncate">
                        {a.actorEmail} · {a.entityType}
                      </div>
                    </div>
                    <span className="font-mono text-slate-400 whitespace-nowrap tabular-nums">
                      {formatDateTime(a.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}

function PlatformOrganizations() {
  const queryClient = useQueryClient();
  const { refreshSession } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusTarget, setStatusTarget] = useState<{ id: string; name: string; nextStatus: string } | null>(null);

  const [form, setForm] = useState({
    name: '',
    code: '',
    universityName: '',
    address: '',
    contactNumber: '',
    email: '',
    website: '',
    academicSession: '2026-2027',
    logoUrl: '' as string | null,
    universityLogoUrl: '' as string | null,
    assignSelfAsAdmin: true,
    adminName: '',
    adminEmail: '',
    adminPhone: '',
    adminPassword: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['platform-organizations'],
    queryFn: () =>
      apiRequest<{
        organizations: Array<{
          id: string;
          name: string;
          code: string;
          universityName?: string;
          email?: string;
          academicSession?: string;
          status: string;
          adminCount: number;
          createdAt: string;
        }>;
      }>('/platform/organizations'),
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest('/platform/organizations', {
        method: 'POST',
        body: {
          name: form.name,
          code: form.code,
          universityName: form.universityName || null,
          address: form.address || null,
          contactNumber: form.contactNumber || null,
          email: form.email || null,
          website: form.website || null,
          academicSession: form.academicSession || '2026-2027',
          logoUrl: form.logoUrl || null,
          universityLogoUrl: form.universityLogoUrl || null,
          assignSelfAsAdmin: form.assignSelfAsAdmin,
          initialAdmin:
            form.adminEmail && form.adminPassword
              ? {
                  fullName: form.adminName || `${form.name} Admin`,
                  email: form.adminEmail,
                  phone: form.adminPhone || null,
                  password: form.adminPassword,
                }
              : undefined,
        },
      });
      toast.success('Institution created with 9 starter ID templates and isolated workspace.');
      setModalOpen(false);
      setForm({
        name: '',
        code: '',
        universityName: '',
        address: '',
        contactNumber: '',
        email: '',
        website: '',
        academicSession: '2026-2027',
        logoUrl: null,
        universityLogoUrl: null,
        assignSelfAsAdmin: true,
        adminName: '',
        adminEmail: '',
        adminPhone: '',
        adminPassword: '',
      });
      queryClient.invalidateQueries({ queryKey: ['platform-organizations'] });
      queryClient.invalidateQueries({ queryKey: ['platform-overview'] });
      await refreshSession();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to create organization.');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmStatusChange = async () => {
    if (!statusTarget) return;
    try {
      await apiRequest(`/platform/organizations/${statusTarget.id}/status`, {
        method: 'PATCH',
        body: { status: statusTarget.nextStatus },
      });
      toast.success(`Institution marked as ${statusTarget.nextStatus}.`);
      setStatusTarget(null);
      queryClient.invalidateQueries({ queryKey: ['platform-organizations'] });
      queryClient.invalidateQueries({ queryKey: ['platform-overview'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Status update failed.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Registered Colleges & Universities
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Onboard institutions, assign their initial College Admin, and control tenant lifecycle.
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" />
          Onboard Organization
        </Button>
      </div>

      <SurfaceCard className="overflow-hidden">
        {isLoading ? (
          <div className="p-5">
            <SkeletonRows rows={5} />
          </div>
        ) : !data?.organizations?.length ? (
          <div className="p-6">
            <EmptyState
              title="No colleges registered yet"
              description="Click Onboard Organization to create your first multi-tenant college workspace with starter courses, shelves, library rules, and 9 Digital ID templates."
              action={
                <Button onClick={() => setModalOpen(true)}>
                  <Building2 className="h-4 w-4" />
                  Onboard First College
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3">Institution</th>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Session</th>
                  <th className="px-4 py-3">Admins</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.organizations.map((org) => (
                  <tr key={org.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">{org.name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {org.universityName || org.email || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">{org.code}</td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">
                      {org.academicSession || '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">{org.adminCount}</td>
                    <td className="px-4 py-3">
                      <StatusText status={org.status} />
                    </td>
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      {org.status !== 'active' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setStatusTarget({ id: org.id, name: org.name, nextStatus: 'active' })
                          }
                        >
                          Activate
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setStatusTarget({ id: org.id, name: org.name, nextStatus: 'suspended' })
                          }
                        >
                          Suspend
                        </Button>
                      )}
                      {org.status !== 'inactive' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setStatusTarget({ id: org.id, name: org.name, nextStatus: 'inactive' })
                          }
                        >
                          Deactivate
                        </Button>
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
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Onboard College / University"
        description="Creates an isolated tenant workspace with branding, library rules, academic structure, and 9 starter ID templates."
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="College Name" required>
              <Input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="St. Xavier's College"
              />
            </Field>
            <Field label="College Code" required>
              <Input
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="SXC-01"
              />
            </Field>
            <Field label="Affiliated University Name">
              <Input
                value={form.universityName}
                onChange={(e) => setForm({ ...form, universityName: e.target.value })}
                placeholder="University of Delhi"
              />
            </Field>
            <Field label="Academic Session">
              <Input
                value={form.academicSession}
                onChange={(e) => setForm({ ...form, academicSession: e.target.value })}
                placeholder="2026-2027"
              />
            </Field>
            <Field label="Official Email">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="library@college.edu"
              />
            </Field>
            <Field label="Contact Number">
              <Input
                value={form.contactNumber}
                onChange={(e) => setForm({ ...form, contactNumber: e.target.value })}
                placeholder="+91 11 2345 6789"
              />
            </Field>
            <Field label="Website">
              <Input
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                placeholder="https://college.edu"
              />
            </Field>
            <Field label="Campus Address">
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Campus street, city, postal code"
              />
            </Field>
            <Field label="College Logo">
              <FileUploadControl
                bucket="college_logos"
                label="Upload College Logo"
                currentUrl={form.logoUrl}
                onUploaded={(url) => setForm({ ...form, logoUrl: url })}
                allowClear
              />
            </Field>
            <Field label="University Logo">
              <FileUploadControl
                bucket="university_logos"
                label="Upload University Logo"
                currentUrl={form.universityLogoUrl}
                onUploaded={(url) => setForm({ ...form, universityLogoUrl: url })}
                allowClear
              />
            </Field>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-3">
            <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              First College Admin Account (Optional)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Admin Full Name">
                <Input
                  value={form.adminName}
                  onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                  placeholder="Dr. Meera Nair"
                />
              </Field>
              <Field label="Admin Email">
                <Input
                  type="email"
                  value={form.adminEmail}
                  onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                  placeholder="admin@college.edu"
                />
              </Field>
              <Field label="Admin Phone">
                <Input
                  value={form.adminPhone}
                  onChange={(e) => setForm({ ...form, adminPhone: e.target.value })}
                />
              </Field>
              <Field label="Temporary Password" hint="Min 8 chars if creating a new admin.">
                <Input
                  type="password"
                  value={form.adminPassword}
                  onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
                  placeholder="Minimum 8 characters"
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 pt-1">
              <input
                type="checkbox"
                checked={form.assignSelfAsAdmin}
                onChange={(e) => setForm({ ...form, assignSelfAsAdmin: e.target.checked })}
              />
              Also add my current account as an authorized College Admin for onboarding setup
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Create Organization
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(statusTarget)}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        title={`Change Status for ${statusTarget?.name || ''}`}
        description={`Are you sure you want to set this institution's status to "${statusTarget?.nextStatus}"? Suspended or inactive institutions cannot be accessed by their staff or students.`}
        confirmLabel="Update Status"
        danger={statusTarget?.nextStatus !== 'active'}
        onConfirm={confirmStatusChange}
      />
    </div>
  );
}

function PlatformCollegeAdmins() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    organizationId: '',
    fullName: '',
    email: '',
    phone: '',
    password: '',
  });

  const { data: orgsData } = useQuery({
    queryKey: ['platform-organizations'],
    queryFn: () =>
      apiRequest<{ organizations: Array<{ id: string; name: string; code: string }> }>(
        '/platform/organizations'
      ),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['platform-college-admins'],
    queryFn: () =>
      apiRequest<{
        collegeAdmins: Array<{
          membershipId: string;
          status: string;
          organizationName: string;
          organizationCode: string;
          fullName: string;
          email: string;
          phone?: string;
          lastLoginAt?: string;
        }>;
      }>('/platform/college-admins'),
  });

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest('/platform/college-admins', {
        method: 'POST',
        body: {
          organizationId: form.organizationId,
          fullName: form.fullName,
          email: form.email,
          phone: form.phone || null,
          password: form.password || undefined,
        },
      });
      toast.success('College Admin assigned successfully.');
      setOpen(false);
      setForm({ organizationId: '', fullName: '', email: '', phone: '', password: '' });
      queryClient.invalidateQueries({ queryKey: ['platform-college-admins'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to assign College Admin.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (membershipId: string, current: string) => {
    const next = current === 'active' ? 'suspended' : 'active';
    await apiRequest(`/platform/college-admins/${membershipId}/status`, {
      method: 'PATCH',
      body: { status: next },
    });
    toast.success(`Admin access ${next}.`);
    queryClient.invalidateQueries({ queryKey: ['platform-college-admins'] });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            College Admin Accounts
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Provision and govern institution-scoped administrators across registered colleges.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <UserPlus className="h-4 w-4" />
          Assign College Admin
        </Button>
      </div>

      <SurfaceCard className="overflow-hidden">
        {isLoading ? (
          <div className="p-5">
            <SkeletonRows rows={4} />
          </div>
        ) : !data?.collegeAdmins?.length ? (
          <div className="p-6">
            <EmptyState
              title="No College Admins assigned"
              description="Assign a College Admin to an onboarded institution so they can manage students, librarians, books, and Digital IDs."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3">Administrator</th>
                  <th className="px-4 py-3">Institution</th>
                  <th className="px-4 py-3">Last Sign-In</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.collegeAdmins.map((a) => (
                  <tr key={a.membershipId}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">{a.fullName}</div>
                      <div className="text-xs text-slate-500">{a.email}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-medium">{a.organizationName}</div>
                      <div className="font-mono text-slate-500">{a.organizationCode}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 tabular-nums">
                      {formatDateTime(a.lastLoginAt)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={a.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleStatus(a.membershipId, a.status)}
                      >
                        {a.status === 'active' ? 'Suspend' : 'Reactivate'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      <Modal open={open} onOpenChange={setOpen} title="Assign College Admin" maxWidth="max-w-lg">
        <form onSubmit={handleAssign} className="space-y-4">
          <Field label="Institution" required>
            <Select
              required
              value={form.organizationId}
              onChange={(e) => setForm({ ...form, organizationId: e.target.value })}
            >
              <option value="">Select institution...</option>
              {(orgsData?.organizations || []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Full Name" required>
            <Input
              required
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </Field>
          <Field label="Email Address" required>
            <Input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Password" hint="Required if creating a new account (min 8 chars).">
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Assign Admin
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function PlatformFounderIds() {
  const queryClient = useQueryClient();
  const [issueOpen, setIssueOpen] = useState(false);
  const [previewFounder, setPreviewFounder] = useState<FounderCardData | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<FounderCardData | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [linkTarget, setLinkTarget] = useState<FounderCardData | null>(null);
  const [linkOrgId, setLinkOrgId] = useState('');
  const [linkStudentId, setLinkStudentId] = useState('');
  const [linkAutoApprove, setLinkAutoApprove] = useState(true);
  const [reviewTarget, setReviewTarget] = useState<{
    id: string;
    nomineeName: string;
    decision: 'approved' | 'rejected';
  } | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    fullName: '',
    designation: 'Founder & Chief Architect',
    organizationLabel: 'QIVORA Technologies',
    profileEmail: '',
    bio: '',
    photoUrl: null as string | null,
    linkedOrganizationId: '',
    linkedStudentId: '',
    autoApproveCollegeLink: false,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['platform-founder-ids'],
    queryFn: () => apiRequest<{ founderIds: FounderCardData[] }>('/platform/founder-ids'),
  });

  const { data: orgsData } = useQuery({
    queryKey: ['platform-organizations'],
    queryFn: () =>
      apiRequest<{ organizations: Array<{ id: string; name: string; code: string; status: string }> }>(
        '/platform/organizations'
      ),
  });

  const { data: issueOrgStudents } = useQuery({
    queryKey: ['platform-org-students', form.linkedOrganizationId],
    queryFn: () => founderService.listOrgStudentsForLinking(form.linkedOrganizationId),
    enabled: Boolean(issueOpen && form.linkedOrganizationId),
  });

  const { data: linkOrgStudents } = useQuery({
    queryKey: ['platform-org-students', linkOrgId],
    queryFn: () => founderService.listOrgStudentsForLinking(linkOrgId),
    enabled: Boolean(linkTarget && linkOrgId),
  });

  const { data: nominationsData } = useQuery({
    queryKey: ['platform-founder-nominations'],
    queryFn: () =>
      apiRequest<{
        nominations: Array<{
          id: string;
          nomineeName: string;
          nomineeEmail?: string | null;
          designation: string;
          justification: string;
          organizationName: string;
          organizationCode: string;
          status: string;
          createdAt: string;
        }>;
      }>('/platform/founder-nominations'),
  });

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiRequest<{ founderId: FounderCardData }>('/platform/founder-ids', {
        method: 'POST',
        body: {
          ...form,
          linkedOrganizationId: form.linkedOrganizationId || null,
          linkedStudentId: form.linkedStudentId || null,
        },
      });
      toast.success('QIVORA — GOLDEN FOUNDER EDITION issued.');
      setIssueOpen(false);
      setPreviewFounder(res.founderId);
      setForm({
        fullName: '',
        designation: 'Founder & Chief Architect',
        organizationLabel: 'QIVORA Technologies',
        profileEmail: '',
        bio: '',
        photoUrl: null,
        linkedOrganizationId: '',
        linkedStudentId: '',
        autoApproveCollegeLink: false,
      });
      queryClient.invalidateQueries({ queryKey: ['platform-founder-ids'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to issue Founder ID.');
    } finally {
      setSubmitting(false);
    }
  };

  const openLinkModal = (f: FounderCardData) => {
    setLinkTarget(f);
    setLinkOrgId(f.linkedOrganizationId || '');
    setLinkStudentId(f.linkedStudentId || '');
    setLinkAutoApprove(f.collegeLinkStatus === 'approved');
  };

  const handleSaveLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkTarget) return;
    if (!linkOrgId || !linkStudentId) {
      toast.error('Select both a college and a registered student account.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await founderService.linkCollegeStudent(linkTarget.id, {
        linkedOrganizationId: linkOrgId,
        linkedStudentId: linkStudentId,
        autoApproveIfSameAdmin: linkAutoApprove,
      });
      toast.success(
        linkAutoApprove
          ? 'Founder ID linked and approved for college library scanning.'
          : 'College student link submitted. College Admin approval required.'
      );
      setLinkTarget(null);
      setPreviewFounder(res.founderId as unknown as FounderCardData);
      queryClient.invalidateQueries({ queryKey: ['platform-founder-ids'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to link college student.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnlink = async () => {
    if (!linkTarget) return;
    setSubmitting(true);
    try {
      await founderService.linkCollegeStudent(linkTarget.id, {
        linkedOrganizationId: null,
        linkedStudentId: null,
      });
      toast.success('Founder ID unlinked from college student account.');
      setLinkTarget(null);
      queryClient.invalidateQueries({ queryKey: ['platform-founder-ids'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to unlink.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegenerate = async (id: string) => {
    try {
      const res = await apiRequest<{ founderId: FounderCardData }>(
        `/platform/founder-ids/${id}/regenerate`,
        { method: 'POST' }
      );
      toast.success('Founder QR verification token regenerated.');
      setPreviewFounder(res.founderId);
      queryClient.invalidateQueries({ queryKey: ['platform-founder-ids'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Regeneration failed.');
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await apiRequest(`/platform/founder-ids/${revokeTarget.id}/revoke`, {
        method: 'POST',
        body: { reason: revokeReason || 'Revoked by Platform Super Admin' },
      });
      toast.success('Founder ID revoked and QR token invalidated.');
      setRevokeTarget(null);
      setRevokeReason('');
      queryClient.invalidateQueries({ queryKey: ['platform-founder-ids'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Revocation failed.');
    }
  };

  const handleReviewNomination = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewTarget) return;
    setSubmitting(true);
    try {
      await apiRequest(`/platform/founder-nominations/${reviewTarget.id}/review`, {
        method: 'POST',
        body: { decision: reviewTarget.decision, reviewNotes },
      });
      toast.success(
        reviewTarget.decision === 'approved'
          ? 'Nomination approved and QIVORA Golden Founder ID issued.'
          : 'Nomination rejected.'
      );
      setReviewTarget(null);
      setReviewNotes('');
      queryClient.invalidateQueries({ queryKey: ['platform-founder-nominations'] });
      queryClient.invalidateQueries({ queryKey: ['platform-founder-ids'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Review failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const pendingNominations = (nominationsData?.nominations || []).filter((n) => n.status === 'pending');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            QIVORA — Golden Founder Edition
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Issue dedicated Founder identity credentials and securely link them to an existing College
            Student library membership for unified QR scanning.
          </p>
        </div>
        <Button variant="gold" onClick={() => setIssueOpen(true)}>
          <Award className="h-4 w-4" />
          Issue Founder ID
        </Button>
      </div>

      <div className="rounded-xl border border-amber-300/60 bg-amber-50/70 px-4 py-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/25 dark:text-amber-200 flex items-start gap-2.5">
        <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          Security Boundary: Linking a Golden Founder ID to a College Student record reuses the real
          student membership (zero duplicate accounts). Founder designation never bypasses borrowing
          limits, overdue holds, fine limits, or tenant isolation.
        </span>
      </div>

      {/* Institutional Nominations Queue */}
      {pendingNominations.length > 0 && (
        <SurfaceCard className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
              Pending College Admin Nominations ({pendingNominations.length})
            </h2>
            <span className="text-xs text-slate-500">Super Admin approval required</span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {pendingNominations.map((nom) => (
              <div key={nom.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    {nom.nomineeName}{' '}
                    <span className="text-xs font-normal text-slate-500">· {nom.designation}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {nom.organizationName} ({nom.organizationCode}) · Submitted {formatDate(nom.createdAt)}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{nom.justification}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="gold"
                    onClick={() =>
                      setReviewTarget({ id: nom.id, nomineeName: nom.nomineeName, decision: 'approved' })
                    }
                  >
                    <Check className="h-3.5 w-3.5" />
                    Approve &amp; Issue
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setReviewTarget({ id: nom.id, nomineeName: nom.nomineeName, decision: 'rejected' })
                    }
                  >
                    <X className="h-3.5 w-3.5" />
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SurfaceCard>
      )}

      {isLoading ? (
        <SkeletonRows rows={4} />
      ) : !data?.founderIds?.length ? (
        <EmptyState
          title="No Founder IDs issued yet"
          description="Issue an official QIVORA — GOLDEN FOUNDER EDITION credential with unified QR verification."
          action={
            <Button variant="gold" onClick={() => setIssueOpen(true)}>
              Issue First Founder ID
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {data.founderIds.map((f) => (
            <SurfaceCard key={f.id} className="p-5 flex flex-col justify-between gap-4">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-amber-700 dark:text-amber-400">
                    {f.founderNumber}
                  </span>
                  <StatusText status={f.status} />
                </div>
                <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                  {f.fullName}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {f.designation} · {f.organizationLabel}
                </p>

                {/* Linked College Student Summary */}
                <div className="rounded-xl border border-slate-200/90 bg-slate-50/80 p-3 text-xs dark:border-slate-800 dark:bg-slate-900/70 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
                      College Library Link
                    </span>
                    <StatusText
                      status={
                        f.collegeLinkStatus === 'approved'
                          ? 'active'
                          : f.collegeLinkStatus === 'pending_college_approval'
                            ? 'pending'
                            : f.collegeLinkStatus === 'revoked'
                              ? 'revoked'
                              : 'inactive'
                      }
                    />
                  </div>
                  {f.linkedCollege ? (
                    <>
                      <div className="font-semibold text-slate-900 dark:text-white truncate">
                        {f.linkedCollege.collegeName}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {f.linkedCollege.studentIdCode} · Roll {f.linkedCollege.collegeRollNumber}
                      </div>
                    </>
                  ) : (
                    <div className="text-slate-500">Not linked to a college student record yet.</div>
                  )}
                </div>

                <p className="text-[11px] font-mono text-slate-400">
                  Issued {formatDate(f.issuedAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <Button size="sm" variant="primary" onClick={() => setPreviewFounder(f)}>
                  View Golden Card
                </Button>
                <Button size="sm" variant="outline" onClick={() => openLinkModal(f)}>
                  <Link2 className="h-3.5 w-3.5" />
                  {f.linkedStudentId ? 'Manage Link' : 'Link College'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleRegenerate(f.id)}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Rotate QR
                </Button>
                {f.status === 'active' && (
                  <Button size="sm" variant="danger" onClick={() => setRevokeTarget(f)}>
                    Revoke
                  </Button>
                )}
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}

      {/* Issue Founder ID Modal */}
      <Modal open={issueOpen} onOpenChange={setIssueOpen} title="Issue Golden Founder ID" maxWidth="max-w-lg">
        <form onSubmit={handleIssue} className="space-y-4">
          <Field label="Founder Full Name" required>
            <Input
              required
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </Field>
          <Field label="Founder Designation" required>
            <Input
              required
              value={form.designation}
              onChange={(e) => setForm({ ...form, designation: e.target.value })}
            />
          </Field>
          <Field label="Organization Label" required>
            <Input
              required
              value={form.organizationLabel}
              onChange={(e) => setForm({ ...form, organizationLabel: e.target.value })}
            />
          </Field>
          <Field label="Linked Profile Email (Optional)">
            <Input
              type="email"
              value={form.profileEmail}
              onChange={(e) => setForm({ ...form, profileEmail: e.target.value })}
            />
          </Field>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-3">
            <div className="text-xs font-semibold text-slate-900 dark:text-white">
              Optional: Link to College Student Library Membership
            </div>
            <Field label="Institution">
              <Select
                value={form.linkedOrganizationId}
                onChange={(e) =>
                  setForm({ ...form, linkedOrganizationId: e.target.value, linkedStudentId: '' })
                }
              >
                <option value="">Do not link now</option>
                {(orgsData?.organizations || []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.code})
                  </option>
                ))}
              </Select>
            </Field>
            {form.linkedOrganizationId && (
              <>
                <Field label="Registered College Student">
                  <Select
                    value={form.linkedStudentId}
                    onChange={(e) => setForm({ ...form, linkedStudentId: e.target.value })}
                  >
                    <option value="">Select student...</option>
                    {(issueOrgStudents?.students || []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName} — {s.studentIdCode} (Roll {s.collegeRollNumber})
                      </option>
                    ))}
                  </Select>
                </Field>
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.autoApproveCollegeLink}
                    onChange={(e) =>
                      setForm({ ...form, autoApproveCollegeLink: e.target.checked })
                    }
                  />
                  Approve college library link immediately (otherwise College Admin must approve)
                </label>
              </>
            )}
          </div>

          <Field label="Portrait Photograph">
            <FileUploadControl
              bucket="id_assets"
              label="Upload Portrait"
              currentUrl={form.photoUrl}
              onUploaded={(url) => setForm({ ...form, photoUrl: url })}
              allowClear
            />
          </Field>
          <Field label="Creator Statement / Bio">
            <Textarea
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              placeholder="Verified creator statement printed on reverse side"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setIssueOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="gold" loading={submitting}>
              Issue Golden Founder ID
            </Button>
          </div>
        </form>
      </Modal>

      {/* Link College Student Modal */}
      <Modal
        open={Boolean(linkTarget)}
        onOpenChange={(open) => !open && setLinkTarget(null)}
        title="Link Founder ID to College Student Membership"
        description={
          linkTarget
            ? `Connect ${linkTarget.founderNumber} (${linkTarget.fullName}) to an existing college student account so the Founder QR works at circulation & attendance desks.`
            : undefined
        }
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleSaveLink} className="space-y-4">
          <Field label="Institution / College" required>
            <Select
              required
              value={linkOrgId}
              onChange={(e) => {
                setLinkOrgId(e.target.value);
                setLinkStudentId('');
              }}
            >
              <option value="">Select institution...</option>
              {(orgsData?.organizations || []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Official College Student Record" required>
            <Select
              required
              value={linkStudentId}
              onChange={(e) => setLinkStudentId(e.target.value)}
              disabled={!linkOrgId}
            >
              <option value="">
                {linkOrgId ? 'Select registered student...' : 'Select an institution first'}
              </option>
              {(linkOrgStudents?.students || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName} — {s.studentIdCode} · Roll {s.collegeRollNumber} ({s.status})
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={linkAutoApprove}
              onChange={(e) => setLinkAutoApprove(e.target.checked)}
            />
            <span>
              Activate link immediately. If unchecked, the institution&apos;s College Admin must approve
              the link inside their Student Directory before Founder QR circulation scanning works.
            </span>
          </label>
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            {linkTarget?.linkedStudentId ? (
              <Button type="button" variant="danger" size="sm" loading={submitting} onClick={handleUnlink}>
                <Unlink className="h-3.5 w-3.5" />
                Unlink Student
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setLinkTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="gold" loading={submitting}>
                <Link2 className="h-3.5 w-3.5" />
                Save College Link
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(previewFounder)}
        onOpenChange={(open) => !open && setPreviewFounder(null)}
        title="QIVORA — GOLDEN FOUNDER EDITION"
        maxWidth="max-w-md"
      >
        {previewFounder && <FounderIdCardView founder={previewFounder} />}
      </Modal>

      <Modal
        open={Boolean(reviewTarget)}
        onOpenChange={(open) => !open && setReviewTarget(null)}
        title={`${reviewTarget?.decision === 'approved' ? 'Approve' : 'Reject'} Founder Nomination`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleReviewNomination} className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {reviewTarget?.decision === 'approved'
              ? `Approving ${reviewTarget?.nomineeName} issues a verified QIVORA — GOLDEN FOUNDER EDITION credential (identity only, zero admin privileges).`
              : `Provide rejection notes for ${reviewTarget?.nomineeName}'s nomination.`}
          </p>
          <Field label="Review Notes" required>
            <Textarea
              required
              minLength={3}
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="Auditable review remarks..."
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setReviewTarget(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={reviewTarget?.decision === 'approved' ? 'gold' : 'danger'}
              loading={submitting}
            >
              Confirm Decision
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke Founder ID"
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Revoking <strong>{revokeTarget?.founderNumber}</strong> immediately invalidates its QR
            verification token.
          </p>
          <Field label="Revocation Reason" required>
            <Input
              required
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              placeholder="State administrative reason"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleRevoke}>
              Confirm Revoke
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function PlatformSettingsPage() {
  const { user, applySessionUpdate } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['platform-settings'],
    queryFn: () =>
      apiRequest<{
        settings: Array<{ id: string; key: string; value: Record<string, unknown>; description?: string }>;
      }>('/platform/settings'),
  });

  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Super Admin Email Change State
  const [newEmail, setNewEmail] = useState(user?.email || '');
  const [emailCurrentPassword, setEmailCurrentPassword] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  // Super Admin Password Change State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const handleChangeSuperAdminEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingEmail(true);
    try {
      const res = await apiRequest<{
        token: string;
        user: AuthUser;
      }>('/auth/change-email', {
        method: 'POST',
        body: {
          newEmail: newEmail.trim(),
          currentPassword: emailCurrentPassword,
        },
      });
      applySessionUpdate(res.token, res.user);
      setEmailCurrentPassword('');
      toast.success(`Super Admin login email updated to ${res.user.email}.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to update email.');
    } finally {
      setSavingEmail(false);
    }
  };

  const handleChangeSuperAdminPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('New password and confirmation do not match.');
      return;
    }
    setSavingPassword(true);
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: {
          currentPassword,
          newPassword,
        },
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Super Admin password updated securely.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to update password.');
    } finally {
      setSavingPassword(false);
    }
  };

  const toggleFlag = async (setting: { key: string; value: Record<string, unknown>; description?: string }, field: string) => {
    setSavingKey(setting.key);
    try {
      await apiRequest('/platform/settings', {
        method: 'PUT',
        body: {
          key: setting.key,
          value: { ...setting.value, [field]: !setting.value[field] },
          description: setting.description,
        },
      });
      toast.success('Platform setting saved.');
      queryClient.invalidateQueries({ queryKey: ['platform-settings'] });
    } catch {
      toast.error('Failed to update setting.');
    } finally {
      setSavingKey(null);
    }
  };

  if (isLoading) return <SkeletonRows rows={4} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          Global Platform Settings &amp; Super Admin Security
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Manage your Super Admin login credentials and configure platform-wide defaults across QIVORA tenants.
        </p>
      </div>

      {/* Super Admin Account Security: Change Email & Password Anytime */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SurfaceCard className="p-5">
          <form onSubmit={handleChangeSuperAdminEmail} className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-display font-bold text-slate-900 dark:text-white">
              <Mail className="h-4 w-4 text-[#2563EB]" />
              Change Super Admin Login Email
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Current login email: <span className="font-mono font-semibold text-slate-900 dark:text-white">{user?.email}</span>
            </p>
            <Field label="New Login Email" required>
              <Input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="mohammad@shariq.com"
              />
            </Field>
            <Field label="Confirm Current Password" required>
              <Input
                type="password"
                required
                value={emailCurrentPassword}
                onChange={(e) => setEmailCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Button type="submit" loading={savingEmail}>
              <Mail className="h-4 w-4" />
              Update Super Admin Email
            </Button>
          </form>
        </SurfaceCard>

        <SurfaceCard className="p-5">
          <form onSubmit={handleChangeSuperAdminPassword} className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-display font-bold text-slate-900 dark:text-white">
              <KeyRound className="h-4 w-4 text-[#2563EB]" />
              Change Super Admin Password
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Your password is hashed server-side with scrypt and is never stored or returned in plaintext.
            </p>
            <Field label="Current Password" required>
              <Input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="New Password" required>
                <Input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Confirm New Password" required>
                <Input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
            </div>
            <Button type="submit" loading={savingPassword}>
              <KeyRound className="h-4 w-4" />
              Update Super Admin Password
            </Button>
          </form>
        </SurfaceCard>
      </div>

      <div className="grid gap-4">
        {(data?.settings || []).map((s) => (
          <SurfaceCard key={s.id} className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                  {s.key.replace(/_/g, ' ')}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">{s.description}</p>
              </div>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {Object.entries(s.value).map(([k, v]) => (
                <div key={k} className="py-2.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-300">{k}</span>
                  {typeof v === 'boolean' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={savingKey === s.key}
                      onClick={() => toggleFlag(s, k)}
                    >
                      {v ? 'Enabled' : 'Disabled'}
                    </Button>
                  ) : (
                    <span className="font-mono text-slate-600 dark:text-slate-300">{String(v)}</span>
                  )}
                </div>
              ))}
            </div>
          </SurfaceCard>
        ))}
      </div>
    </div>
  );
}

function PlatformAuditLogs() {
  const { data, isLoading } = useQuery({
    queryKey: ['platform-audit-logs'],
    queryFn: () =>
      apiRequest<{
        auditLogs: Array<{
          id: string;
          actorEmail: string;
          actorRole: string;
          action: string;
          entityType: string;
          entityId?: string;
          details?: Record<string, unknown>;
          createdAt: string;
        }>;
      }>('/platform/audit-logs'),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          Platform Audit Logs
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Immutable platform-wide audit record of administrative and operational changes.
        </p>
      </div>
      <SurfaceCard className="overflow-hidden">
        {isLoading ? (
          <div className="p-5">
            <SkeletonRows rows={6} />
          </div>
        ) : !data?.auditLogs?.length ? (
          <div className="p-6">
            <EmptyState
              title="No audit logs recorded"
              description="Platform actions will appear here automatically."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap tabular-nums text-slate-500">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900 dark:text-white">{log.actorEmail}</div>
                      <div className="text-slate-400">{log.actorRole}</div>
                    </td>
                    <td className="px-4 py-2.5 font-medium">{log.action.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-500">{log.entityType}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500 max-w-xs truncate">
                      {JSON.stringify(log.details || {})}
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

function PlatformSystemHealth() {
  const firebaseDiag = getFirebaseConfigDiagnostics();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['platform-health'],
    queryFn: () =>
      apiRequest<{
        status: string;
        timestamp: string;
        database: {
          connected: boolean;
          latencyMs: number;
          projectId?: string;
          authDomain?: string;
          firestoreDatabaseId?: string;
          currentHost?: string;
          configSource?: string;
          error?: string | null;
        };
        totals: { organizations: number; profiles: number; auditLogs: number };
        uptimeSeconds: number;
        integrations: {
          firebaseAuth: boolean;
          cloudFirestore?: boolean;
          smtpEmail: boolean;
          whatsapp: boolean;
          webPush: boolean;
        };
      }>('/platform/health'),
  });

  if (isLoading) return <SkeletonRows rows={4} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            System Health &amp; Firebase Diagnostics
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Live Cloud Firestore connectivity check, Firebase Authentication configuration, and
            multi-tenant metrics.
          </p>
        </div>
        <Button variant="outline" size="sm" loading={isFetching} onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh Check
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricTile
          label="Cloud Firestore"
          value={data?.database.connected ? 'Connected' : 'Error'}
          tone={data?.database.connected ? 'success' : 'danger'}
          subtext={`Ping latency: ${data?.database.latencyMs ?? 0} ms`}
        />
        <MetricTile label="Total Organizations" value={data?.totals.organizations ?? 0} />
        <MetricTile label="Registered Accounts" value={data?.totals.profiles ?? 0} />
        <MetricTile label="Audit Trail Entries" value={data?.totals.auditLogs ?? 0} />
      </div>

      {/* Firebase Project & Firestore Diagnostics */}
      <SurfaceCard className="p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                Firebase Authentication &amp; Cloud Firestore Diagnostics
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Live runtime validation of your Firebase project configuration and Firestore database.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" loading={isFetching} onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Test Firestore Connection
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900 dark:text-white">
                Firebase Project &amp; Auth Domain
              </span>
              <StatusText status={firebaseDiag.isConfigured ? 'active' : 'not_configured'} />
            </div>
            <div className="text-slate-500 dark:text-slate-400 font-mono text-[11px]">
              Project: {firebaseDiag.projectId} · Auth Domain: {firebaseDiag.authDomain}
            </div>
            <div className="text-slate-500 dark:text-slate-400 text-[11px]">
              Active Host: <span className="font-mono">{firebaseDiag.currentHost}</span> (Config source: {firebaseDiag.source})
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900 dark:text-white">
                Cloud Firestore Named Database
              </span>
              <StatusText status={data?.database.connected ? 'active' : 'inactive'} />
            </div>
            <div className="text-slate-500 dark:text-slate-400 font-mono text-[11px] break-all">
              {firebaseDiag.firestoreDatabaseId}
            </div>
            {data?.database.error ? (
              <div className="text-amber-700 dark:text-amber-400">{data.database.error}</div>
            ) : (
              <div className="text-emerald-600 dark:text-emerald-400 font-medium">
                Live Firestore server connection verified ({data?.database.latencyMs ?? 0} ms).
              </div>
            )}
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard className="p-5">
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white mb-3">
          Platform Services Status
        </h2>
        <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
          <div className="py-2.5 flex items-center justify-between">
            <span>Firebase Authentication (Google OAuth &amp; Email/Password)</span>
            <StatusText status={data?.integrations.firebaseAuth ? 'active' : 'inactive'} />
          </div>
          <div className="py-2.5 flex items-center justify-between">
            <span>Cloud Firestore Multi-Tenant Database</span>
            <StatusText status={data?.database.connected ? 'active' : 'inactive'} />
          </div>
          <div className="py-2.5 flex items-center justify-between">
            <span>Open Library &amp; Google Books ISBN Metadata Lookup</span>
            <StatusText status="active" />
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}

export function PlatformWorkspace() {
  return (
    <Routes>
      <Route index element={<PlatformOverview />} />
      <Route path="organizations" element={<PlatformOrganizations />} />
      <Route path="accounts" element={<PlatformAccountsPage />} />
      <Route path="student-tiers" element={<PlatformStudentTiersPage />} />
      <Route path="college-admins" element={<PlatformCollegeAdmins />} />
      <Route path="founder-ids" element={<PlatformFounderIds />} />
      <Route path="integrations" element={<PlatformIntegrationsPage />} />
      <Route path="settings" element={<PlatformSettingsPage />} />
      <Route path="audit-logs" element={<PlatformAuditLogs />} />
      <Route path="health" element={<PlatformSystemHealth />} />
    </Routes>
  );
}
