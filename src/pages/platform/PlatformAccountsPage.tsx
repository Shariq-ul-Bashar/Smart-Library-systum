import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Copy,
  KeyRound,
  Lock,
  RefreshCw,
  Save,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react';
import { toast } from 'sonner';
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
} from '../../components/ui/primitives.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/utils.ts';
import {
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicyConfig,
} from '../../shared/security-and-tiers.ts';

interface ManagedAccountRow {
  membershipId: string;
  organizationId: string;
  organizationName: string;
  organizationCode: string;
  roleSlug: string;
  roleName: string;
  membershipStatus: string;
  profileId: string;
  fullName: string;
  email: string;
  phone?: string | null;
  profileStatus: string;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  hasPassword: boolean;
  passwordChangedAt?: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
}

interface OrganizationSummary {
  id: string;
  name: string;
  code: string;
  status: string;
}

interface OneTimePasswordPayload {
  title: string;
  fullName: string;
  email: string;
  roleLabel: string;
  temporaryPassword: string;
  mustChangePassword: boolean;
}

export function PlatformAccountsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'accounts' | 'policy'>('accounts');

  // Filters
  const [roleFilter, setRoleFilter] = useState<'all' | 'college_admin' | 'librarian' | 'student'>('all');
  const [orgFilter, setOrgFilter] = useState('');
  const [search, setSearch] = useState('');

  // Create account modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    organizationId: '',
    roleSlug: 'college_admin' as 'college_admin' | 'librarian' | 'student',
    fullName: '',
    email: '',
    phone: '',
    collegeRollNumber: '',
    fatherName: '',
    useAutoPassword: true,
    customPassword: '',
    mustChangePassword: true,
  });

  // Reset password modal
  const [resetTarget, setResetTarget] = useState<ManagedAccountRow | null>(null);
  const [resetAuto, setResetAuto] = useState(true);
  const [resetCustomPassword, setResetCustomPassword] = useState('');
  const [resetForceChange, setResetForceChange] = useState(true);

  // One-time temporary password reveal modal (never persisted in plaintext)
  const [oneTimeSecret, setOneTimeSecret] = useState<OneTimePasswordPayload | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  // Password policy form
  const [policyForm, setPolicyForm] = useState<PasswordPolicyConfig>(DEFAULT_PASSWORD_POLICY);
  const [savingPolicy, setSavingPolicy] = useState(false);

  const { data: orgsData } = useQuery({
    queryKey: ['platform-organizations'],
    queryFn: () => apiRequest<{ organizations: OrganizationSummary[] }>('/platform/organizations'),
  });

  const { data: accountsData, isLoading: accountsLoading } = useQuery({
    queryKey: ['platform-accounts', roleFilter, orgFilter, search],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (roleFilter !== 'all') qs.set('role', roleFilter);
      if (orgFilter) qs.set('organizationId', orgFilter);
      if (search.trim()) qs.set('search', search.trim());
      return apiRequest<{ accounts: ManagedAccountRow[] }>(`/platform/accounts?${qs.toString()}`);
    },
  });

  const { data: policyData } = useQuery({
    queryKey: ['platform-password-policy'],
    queryFn: () => apiRequest<{ policy: PasswordPolicyConfig }>('/platform/password-policy'),
  });

  useEffect(() => {
    if (policyData?.policy) {
      setPolicyForm(policyData.policy);
      setCreateForm((prev) => ({
        ...prev,
        mustChangePassword: policyData.policy.forceChangeOnFirstLogin,
      }));
      setResetForceChange(policyData.policy.forceChangeOnFirstLogin);
    }
  }, [policyData]);

  const accounts = accountsData?.accounts || [];
  const organizations = orgsData?.organizations || [];

  const totalPendingChange = accounts.filter((a) => a.mustChangePassword).length;
  const totalSuspended = accounts.filter((a) => a.profileStatus !== 'active').length;

  const handleCopySecret = async () => {
    if (!oneTimeSecret) return;
    try {
      await navigator.clipboard.writeText(
        `Account: ${oneTimeSecret.fullName}\nLogin Email: ${oneTimeSecret.email}\nTemporary Password: ${oneTimeSecret.temporaryPassword}\nNote: Password change required on first login.`
      );
      setCopied(true);
      toast.success('Credentials copied to clipboard.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Clipboard permission denied — copy the temporary password manually.');
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.organizationId) {
      toast.error('Select a college / organization.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiRequest<{
        account: {
          profileId: string;
          fullName: string;
          email: string;
          roleSlug: string;
          mustChangePassword: boolean;
        };
        temporaryPasswordOnce: string;
      }>('/platform/accounts', {
        method: 'POST',
        body: {
          organizationId: createForm.organizationId,
          roleSlug: createForm.roleSlug,
          fullName: createForm.fullName.trim(),
          email: createForm.email.trim(),
          phone: createForm.phone.trim() || undefined,
          collegeRollNumber:
            createForm.roleSlug === 'student' ? createForm.collegeRollNumber.trim() || undefined : undefined,
          fatherName:
            createForm.roleSlug === 'student' ? createForm.fatherName.trim() || undefined : undefined,
          password: createForm.useAutoPassword ? undefined : createForm.customPassword,
          autoGeneratePassword: createForm.useAutoPassword,
          requirePasswordChange: createForm.mustChangePassword,
        },
      });
      setCreateOpen(false);
      setCreateForm((prev) => ({
        ...prev,
        fullName: '',
        email: '',
        phone: '',
        collegeRollNumber: '',
        fatherName: '',
        customPassword: '',
      }));
      setOneTimeSecret({
        title: 'Account Created Successfully',
        fullName: res.account.fullName,
        email: res.account.email,
        roleLabel: res.account.roleSlug.replace(/_/g, ' '),
        temporaryPassword: res.temporaryPasswordOnce,
        mustChangePassword: res.account.mustChangePassword,
      });
      queryClient.invalidateQueries({ queryKey: ['platform-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['platform-college-admins'] });
      queryClient.invalidateQueries({ queryKey: ['platform-students-directory'] });
      toast.success('Account created with encrypted password hash.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to create account.');
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setBusy(true);
    try {
      const res = await apiRequest<{
        email: string;
        fullName: string;
        mustChangePassword: boolean;
        temporaryPasswordOnce: string;
      }>(`/platform/accounts/${resetTarget.profileId}/reset-password`, {
        method: 'POST',
        body: {
          customPassword: resetAuto ? null : resetCustomPassword,
          requirePasswordChange: resetForceChange,
        },
      });
      const roleLabel = resetTarget.roleName || resetTarget.roleSlug.replace(/_/g, ' ');
      setResetTarget(null);
      setResetCustomPassword('');
      setOneTimeSecret({
        title: 'Password Reset Complete',
        fullName: res.fullName,
        email: res.email,
        roleLabel,
        temporaryPassword: res.temporaryPasswordOnce,
        mustChangePassword: res.mustChangePassword,
      });
      queryClient.invalidateQueries({ queryKey: ['platform-accounts'] });
      toast.success('Temporary password generated and hashed securely.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to reset password.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleAccountStatus = async (account: ManagedAccountRow) => {
    const nextStatus = account.profileStatus === 'active' ? 'suspended' : 'active';
    setStatusBusyId(account.profileId);
    try {
      await apiRequest(`/platform/accounts/${account.profileId}/status`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
      toast.success(`Account ${nextStatus === 'active' ? 'reactivated' : 'suspended'}.`);
      queryClient.invalidateQueries({ queryKey: ['platform-accounts'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to update account status.');
    } finally {
      setStatusBusyId(null);
    }
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPolicy(true);
    try {
      const res = await apiRequest<{ policy: PasswordPolicyConfig }>('/platform/password-policy', {
        method: 'PUT',
        body: policyForm,
      });
      setPolicyForm(res.policy);
      queryClient.invalidateQueries({ queryKey: ['platform-password-policy'] });
      toast.success('Platform password policy updated.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to save password policy.');
    } finally {
      setSavingPolicy(false);
    }
  };

  const previewPattern = `${policyForm.prefix ? `${policyForm.prefix}-` : ''}${'•'.repeat(
    Math.max(4, policyForm.minLength - (policyForm.prefix ? policyForm.prefix.length + 1 : 0))
  )}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Centralized Accounts &amp; Password Control
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Create, reset, and manage College Admin, Librarian, and Student accounts across all
            registered colleges. Passwords are always cryptographically hashed and never stored or
            displayed in plaintext.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus className="h-4 w-4" />
          Create Account
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricTile
          label="Managed Accounts"
          value={accounts.length}
          subtext="Across filtered institutions"
          icon={Users}
          pastel="blue"
        />
        <MetricTile
          label="Pending First-Login Reset"
          value={totalPendingChange}
          subtext="Mandatory password change active"
          icon={KeyRound}
          pastel="amber"
        />
        <MetricTile
          label="Suspended Accounts"
          value={totalSuspended}
          subtext="Access temporarily revoked"
          icon={ShieldAlert}
          pastel="rose"
        />
      </div>

      {/* Sub-tabs */}
      <div className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800/80">
        <button
          type="button"
          onClick={() => setActiveTab('accounts')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
            activeTab === 'accounts'
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          Account Directory &amp; Resets
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('policy')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
            activeTab === 'policy'
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          Default Password Policy &amp; Template
        </button>
      </div>

      {activeTab === 'accounts' ? (
        <>
          <SurfaceCard className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, email, or phone..."
                  className="pl-9"
                />
              </div>
              <Select
                value={roleFilter}
                onChange={(e) =>
                  setRoleFilter(e.target.value as 'all' | 'college_admin' | 'librarian' | 'student')
                }
              >
                <option value="all">All Roles (Admins, Librarians, Students)</option>
                <option value="college_admin">College Admins</option>
                <option value="librarian">Librarians</option>
                <option value="student">Students</option>
              </Select>
              <Select value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
                <option value="">All Registered Colleges</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name} ({org.code})
                  </option>
                ))}
              </Select>
            </div>
          </SurfaceCard>

          <SurfaceCard className="overflow-hidden">
            {accountsLoading ? (
              <div className="p-5">
                <SkeletonRows rows={6} />
              </div>
            ) : accounts.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No matching accounts found"
                  description="Adjust your role or college filter, or create a new College Admin, Librarian, or Student account."
                  action={<Button onClick={() => setCreateOpen(true)}>Create Account</Button>}
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                    <tr>
                      <th className="px-4 py-3">User Account</th>
                      <th className="px-4 py-3">College &amp; Role</th>
                      <th className="px-4 py-3">Password Security</th>
                      <th className="px-4 py-3">Account Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {accounts.map((acc) => (
                      <tr key={acc.membershipId} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {acc.fullName}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500">{acc.email}</div>
                          {acc.phone && <div className="text-[11px] text-slate-400">{acc.phone}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-slate-800 dark:text-slate-200">
                              {acc.organizationName}
                            </span>
                            <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-600 dark:text-slate-300">
                              {acc.roleSlug.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <div className="text-[10.5px] font-mono text-slate-400 mt-0.5">
                            {acc.organizationCode}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {acc.mustChangePassword ? (
                            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
                              <KeyRound className="h-3.5 w-3.5" />
                              Must change on next login
                            </span>
                          ) : acc.hasPassword ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                              <ShieldCheck className="h-3.5 w-3.5" />
                              Encrypted hash active
                            </span>
                          ) : (
                            <span className="text-slate-400">OAuth / No password set</span>
                          )}
                          {acc.lastLoginAt && (
                            <div className="text-[10.5px] text-slate-400 mt-0.5 font-mono">
                              Last login {formatDateTime(acc.lastLoginAt)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusText status={acc.profileStatus} />
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setResetTarget(acc);
                              setResetAuto(true);
                              setResetCustomPassword('');
                              setResetForceChange(policyForm.forceChangeOnFirstLogin);
                            }}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Reset Password
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={statusBusyId === acc.profileId}
                            onClick={() => handleToggleAccountStatus(acc)}
                          >
                            {acc.profileStatus === 'active' ? (
                              <>
                                <UserX className="h-3.5 w-3.5 text-red-500" />
                                Suspend
                              </>
                            ) : (
                              <>
                                <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                                Activate
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
        </>
      ) : (
        <SurfaceCard className="p-6 max-w-2xl">
          <form onSubmit={handleSavePolicy} className="space-y-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#2563EB] dark:bg-blue-950/50 dark:text-blue-400">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  Default Password Policy &amp; Temporary Password Template
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Controls automatic cryptographically unique temporary password generation and
                  mandatory first-login password rotation across all institutions.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field
                label="Minimum Password Length"
                hint="Between 8 and 32 characters (10+ recommended)."
              >
                <Input
                  type="number"
                  min={8}
                  max={32}
                  value={policyForm.minLength}
                  onChange={(e) =>
                    setPolicyForm((prev) => ({
                      ...prev,
                      minLength: Math.min(32, Math.max(8, Number(e.target.value) || 8)),
                    }))
                  }
                />
              </Field>
              <Field
                label="Optional Template Prefix"
                hint="Alphanumeric prefix (max 8 chars, e.g. Qiv). Random unique suffix is always appended."
              >
                <Input
                  maxLength={8}
                  value={policyForm.prefix}
                  onChange={(e) =>
                    setPolicyForm((prev) => ({
                      ...prev,
                      prefix: e.target.value.replace(/[^A-Za-z0-9]/g, ''),
                    }))
                  }
                  placeholder="Qiv"
                  className="font-mono"
                />
              </Field>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-2.5 text-xs">
              <div className="font-semibold text-slate-900 dark:text-white">
                Complexity &amp; Security Rules
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={policyForm.enabled}
                  onChange={(e) => setPolicyForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                />
                Enforce complexity rules on all new and changed passwords
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={policyForm.requireUppercase}
                    onChange={(e) =>
                      setPolicyForm((prev) => ({ ...prev, requireUppercase: e.target.checked }))
                    }
                  />
                  Require uppercase letter (A–Z)
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={policyForm.requireLowercase}
                    onChange={(e) =>
                      setPolicyForm((prev) => ({ ...prev, requireLowercase: e.target.checked }))
                    }
                  />
                  Require lowercase letter (a–z)
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={policyForm.requireNumber}
                    onChange={(e) =>
                      setPolicyForm((prev) => ({ ...prev, requireNumber: e.target.checked }))
                    }
                  />
                  Require numeric digit (0–9)
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={policyForm.requireSpecial}
                    onChange={(e) =>
                      setPolicyForm((prev) => ({ ...prev, requireSpecial: e.target.checked }))
                    }
                  />
                  Require special symbol (@, #, !, $)
                </label>
              </div>
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                <label className="flex items-center gap-2 font-medium text-slate-900 dark:text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={policyForm.forceChangeOnFirstLogin}
                    onChange={(e) =>
                      setPolicyForm((prev) => ({
                        ...prev,
                        forceChangeOnFirstLogin: e.target.checked,
                      }))
                    }
                  />
                  Require mandatory password change on first login (Recommended)
                </label>
              </div>
            </div>

            <div className="rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-950/20 px-4 py-3 text-xs flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300">
                Generated Temporary Password Format
              </span>
              <span className="font-mono font-semibold text-[#1E3A8A] dark:text-[#60A5FA]">
                {previewPattern} (unique per user)
              </span>
            </div>

            <div className="flex justify-end">
              <Button type="submit" loading={savingPolicy}>
                <Save className="h-4 w-4" />
                Save Password Policy
              </Button>
            </div>
          </form>
        </SurfaceCard>
      )}

      {/* Create Account Modal */}
      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create Managed User Account"
        description="Provision a College Admin, Librarian, or Student account in any registered institution with a unique secure password."
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleCreateAccount} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Field label="Target College / Institution" required>
              <Select
                required
                value={createForm.organizationId}
                onChange={(e) => setCreateForm({ ...createForm, organizationId: e.target.value })}
              >
                <option value="">Select college...</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name} ({org.code})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Account Role" required>
              <Select
                required
                value={createForm.roleSlug}
                onChange={(e) =>
                  setCreateForm({
                    ...createForm,
                    roleSlug: e.target.value as 'college_admin' | 'librarian' | 'student',
                  })
                }
              >
                <option value="college_admin">College Admin</option>
                <option value="librarian">Librarian</option>
                <option value="student">Student</option>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Field label="Full Name" required>
              <Input
                required
                value={createForm.fullName}
                onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })}
                placeholder="Dr. Ayesha Khan"
              />
            </Field>
            <Field label="Login Email" required>
              <Input
                type="email"
                required
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                placeholder="user@college.edu"
              />
            </Field>
          </div>

          <Field label="Phone Number">
            <Input
              value={createForm.phone}
              onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
              placeholder="+91 98..."
            />
          </Field>

          {createForm.roleSlug === 'student' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 bg-slate-50/60 dark:bg-slate-900/40">
              <Field label="College Roll Number" hint="Auto-generated if left blank.">
                <Input
                  value={createForm.collegeRollNumber}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, collegeRollNumber: e.target.value })
                  }
                  placeholder="BCA-2026-042"
                />
              </Field>
              <Field label="Father's Name">
                <Input
                  value={createForm.fatherName}
                  onChange={(e) => setCreateForm({ ...createForm, fatherName: e.target.value })}
                  placeholder="Guardian full name"
                />
              </Field>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-3 text-xs">
            <label className="flex items-center gap-2 font-medium text-slate-900 dark:text-white cursor-pointer">
              <input
                type="checkbox"
                checked={createForm.useAutoPassword}
                onChange={(e) =>
                  setCreateForm({ ...createForm, useAutoPassword: e.target.checked })
                }
              />
              Auto-generate unique policy-compliant temporary password (Recommended)
            </label>

            {!createForm.useAutoPassword && (
              <Field label="Custom Initial Password" required>
                <Input
                  type="password"
                  required
                  minLength={8}
                  value={createForm.customPassword}
                  onChange={(e) => setCreateForm({ ...createForm, customPassword: e.target.value })}
                  placeholder="Enter strong password"
                />
              </Field>
            )}

            <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={createForm.mustChangePassword}
                onChange={(e) =>
                  setCreateForm({ ...createForm, mustChangePassword: e.target.checked })
                }
              />
              Force password change on user&apos;s first login
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              <UserPlus className="h-4 w-4" />
              Create Account
            </Button>
          </div>
        </form>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        open={Boolean(resetTarget)}
        onOpenChange={(o) => !o && setResetTarget(null)}
        title="Reset User Password"
        description={resetTarget ? `${resetTarget.fullName} (${resetTarget.email})` : undefined}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleResetPassword} className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-3 text-xs">
            <label className="flex items-center gap-2 font-medium text-slate-900 dark:text-white cursor-pointer">
              <input
                type="checkbox"
                checked={resetAuto}
                onChange={(e) => setResetAuto(e.target.checked)}
              />
              Auto-generate unique policy-compliant temporary password
            </label>
            {!resetAuto && (
              <Field label="New Temporary Password" required>
                <Input
                  type="password"
                  required
                  minLength={8}
                  value={resetCustomPassword}
                  onChange={(e) => setResetCustomPassword(e.target.value)}
                  placeholder="Min 8 characters"
                />
              </Field>
            )}
            <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={resetForceChange}
                onChange={(e) => setResetForceChange(e.target.checked)}
              />
              Require mandatory password change on next login
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setResetTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              <KeyRound className="h-4 w-4" />
              Confirm Password Reset
            </Button>
          </div>
        </form>
      </Modal>

      {/* One-Time Temporary Password Handoff Modal */}
      <Modal
        open={Boolean(oneTimeSecret)}
        onOpenChange={(o) => {
          if (!o) {
            setOneTimeSecret(null);
            setCopied(false);
          }
        }}
        title={oneTimeSecret?.title || 'Temporary Credentials'}
        description="Copy and share securely now. Plaintext passwords are NEVER stored in the database and cannot be viewed again after closing this window."
        maxWidth="max-w-md"
      >
        {oneTimeSecret && (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800/70 dark:bg-amber-950/30 space-y-2.5 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
                <Lock className="h-3.5 w-3.5" />
                One-Time Credential Display
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span className="text-slate-500">Name</span>
                <span className="col-span-2 font-semibold text-slate-900 dark:text-white">
                  {oneTimeSecret.fullName}
                </span>
                <span className="text-slate-500">Role</span>
                <span className="col-span-2 capitalize font-medium text-slate-800 dark:text-slate-200">
                  {oneTimeSecret.roleLabel}
                </span>
                <span className="text-slate-500">Login Email</span>
                <span className="col-span-2 font-mono text-slate-900 dark:text-white">
                  {oneTimeSecret.email}
                </span>
              </div>
              <div className="pt-2 border-t border-amber-200 dark:border-amber-800/50">
                <div className="text-[10px] uppercase tracking-wider text-amber-800 dark:text-amber-300 font-semibold">
                  Temporary Password (Shown Once)
                </div>
                <div className="mt-1 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 px-3 py-2 font-mono text-sm font-bold text-slate-900 dark:text-white select-all">
                  {oneTimeSecret.temporaryPassword}
                </div>
              </div>
              {oneTimeSecret.mustChangePassword && (
                <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90">
                  Mandatory password change is enabled: this user will be required to set a private
                  password immediately after signing in.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleCopySecret}>
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy Credentials'}
              </Button>
              <Button onClick={() => setOneTimeSecret(null)}>Done</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
