import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Check,
  Crown,
  Gem,
  Search,
  Sparkles,
  Trash2,
  User,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  type FounderCardData,
  FounderIdCardView,
} from '../../components/id-cards/DigitalIdCardView.tsx';
import {
  Button,
  EmptyState,
  Field,
  Input,
  MetricTile,
  Modal,
  Select,
  SkeletonRows,
  SurfaceCard,
  Textarea,
} from '../../components/ui/primitives.tsx';
import { apiRequest } from '../../lib/api.ts';
import {
  PREMIUM_STUDENT_DESIGNS,
  getPremiumStudentDesign,
} from '../../shared/security-and-tiers.ts';

interface DirectoryStudentRow {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationCode: string;
  studentIdCode: string;
  collegeRollNumber: string;
  fullName: string;
  email: string;
  photoUrl?: string | null;
  status: string;
  courseName?: string | null;
  semesterName?: string | null;
  sessionName?: string | null;
  isFounder: boolean;
  founder: {
    id: string;
    founderNumber: string;
    designation: string;
    organizationLabel: string;
    editionName: string;
    status: string;
    collegeLinkStatus: string;
    issuedAt: string;
    qrToken?: string | null;
  } | null;
  isPremium: boolean;
  premiumTier?: string | null;
  premiumDesign?: string | null;
  premiumBadgeLabel?: string | null;
  premiumGrantedAt?: string | null;
  premiumNote?: string | null;
}

interface OrganizationOption {
  id: string;
  name: string;
  code: string;
}

export function PlatformStudentTiersPage() {
  const queryClient = useQueryClient();

  const [orgFilter, setOrgFilter] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | 'founder' | 'premium' | 'standard'>('all');
  const [search, setSearch] = useState('');

  // Founder assignment modal
  const [founderTarget, setFounderTarget] = useState<DirectoryStudentRow | null>(null);
  const [founderForm, setFounderForm] = useState({
    designation: 'QIVORA Golden Founder',
    organizationLabel: 'QIVORA Smart Library Platform',
    bio: '',
  });
  const [generatedFounderPreview, setGeneratedFounderPreview] = useState<FounderCardData | null>(null);

  // Premium Student assignment modal (Independent of Founder)
  const [premiumTarget, setPremiumTarget] = useState<DirectoryStudentRow | null>(null);
  const [premiumDesign, setPremiumDesign] = useState<
    'obsidian_platinum' | 'royal_sapphire' | 'emerald_prestige' | 'crimson_scholar'
  >('royal_sapphire');
  const [premiumBadgeLabel, setPremiumBadgeLabel] = useState('');
  const [premiumNote, setPremiumNote] = useState('');

  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: orgsData } = useQuery({
    queryKey: ['platform-organizations'],
    queryFn: () => apiRequest<{ organizations: OrganizationOption[] }>('/platform/organizations'),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['platform-students-directory', orgFilter, tierFilter, search],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (orgFilter) qs.set('organizationId', orgFilter);
      if (tierFilter !== 'all') qs.set('tier', tierFilter);
      if (search.trim()) qs.set('search', search.trim());
      return apiRequest<{ students: DirectoryStudentRow[] }>(
        `/platform/students/directory?${qs.toString()}`
      );
    },
  });

  const students = data?.students || [];
  const organizations = orgsData?.organizations || [];

  const stats = useMemo(() => {
    const founders = students.filter((s) => s.isFounder).length;
    const premiums = students.filter((s) => s.isPremium).length;
    return { total: students.length, founders, premiums };
  }, [students]);

  const openFounderAssignModal = (s: DirectoryStudentRow) => {
    setFounderTarget(s);
    setFounderForm({
      designation: s.founder?.designation || 'QIVORA Golden Founder',
      organizationLabel: s.founder?.organizationLabel || s.organizationName,
      bio: '',
    });
  };

  const openPremiumAssignModal = (s: DirectoryStudentRow) => {
    setPremiumTarget(s);
    const currentDesign = (s.premiumDesign || 'royal_sapphire') as
      | 'obsidian_platinum'
      | 'royal_sapphire'
      | 'emerald_prestige'
      | 'crimson_scholar';
    setPremiumDesign(currentDesign);
    setPremiumBadgeLabel(s.premiumBadgeLabel || getPremiumStudentDesign(currentDesign).badgeLabel);
    setPremiumNote(s.premiumNote || '');
  };

  const handleAssignFounder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!founderTarget) return;
    setSubmitting(true);
    try {
      const res = await apiRequest<{
        founderId: FounderCardData;
        message: string;
      }>(`/platform/students/${founderTarget.id}/founder`, {
        method: 'POST',
        body: {
          designation: founderForm.designation.trim(),
          organizationLabel: founderForm.organizationLabel.trim(),
          bio: founderForm.bio.trim() || undefined,
        },
      });

      const target = founderTarget;
      setFounderTarget(null);
      setGeneratedFounderPreview({
        ...res.founderId,
        photoUrl: res.founderId.photoUrl || target.photoUrl,
        linkedCollege: res.founderId.linkedCollege || {
          organizationId: target.organizationId,
          collegeName: target.organizationName,
          collegeCode: target.organizationCode,
          studentId: target.id,
          studentIdCode: target.studentIdCode,
          collegeRollNumber: target.collegeRollNumber,
          courseName: target.courseName,
          semesterName: target.semesterName,
          academicSession: target.sessionName,
          membershipStatus: target.status,
          collegeLinkStatus: 'approved',
          photoUrl: target.photoUrl,
        },
      });
      toast.success(`Golden Founder ID ${res.founderId.founderNumber} generated and activated!`);
      queryClient.invalidateQueries({ queryKey: ['platform-students-directory'] });
      queryClient.invalidateQueries({ queryKey: ['platform-founders'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to assign Founder status.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeFounder = async (s: DirectoryStudentRow) => {
    setBusyId(`founder-${s.id}`);
    try {
      await apiRequest(`/platform/students/${s.id}/founder`, { method: 'DELETE' });
      toast.success(`Founder status revoked for ${s.fullName}.`);
      queryClient.invalidateQueries({ queryKey: ['platform-students-directory'] });
      queryClient.invalidateQueries({ queryKey: ['platform-founders'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to revoke Founder status.');
    } finally {
      setBusyId(null);
    }
  };

  const handleAssignPremium = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!premiumTarget) return;
    setSubmitting(true);
    try {
      await apiRequest(`/platform/students/${premiumTarget.id}/premium`, {
        method: 'POST',
        body: {
          premiumDesign,
          premiumBadgeLabel: premiumBadgeLabel.trim() || undefined,
          premiumNote: premiumNote.trim() || undefined,
        },
      });
      toast.success(`Premium Student Digital ID assigned to ${premiumTarget.fullName}.`);
      setPremiumTarget(null);
      queryClient.invalidateQueries({ queryKey: ['platform-students-directory'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to assign Premium Student ID.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokePremium = async (s: DirectoryStudentRow) => {
    setBusyId(`premium-${s.id}`);
    try {
      await apiRequest(`/platform/students/${s.id}/premium`, { method: 'DELETE' });
      toast.success(`Premium Student ID revoked for ${s.fullName}.`);
      queryClient.invalidateQueries({ queryKey: ['platform-students-directory'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to revoke Premium status.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[#B8860B] dark:text-[#F4D57E]">
          <Crown className="h-3.5 w-3.5" />
          Super Admin Exclusive Allocation
        </div>
        <h1 className="mt-1 font-display text-2xl font-bold text-slate-900 dark:text-white">
          Founder Allocation &amp; Premium Student IDs
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Assign or revoke exclusive Golden Premium Founder credentials OR independent Premium
          Student Digital ID designs for students from any registered college. College Admins and
          Librarians have zero access to these privileges.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricTile
          label="Students in Scope"
          value={stats.total}
          subtext="Across all registered colleges"
          icon={Users}
          pastel="blue"
        />
        <MetricTile
          label="Active Golden Founders"
          value={stats.founders}
          subtext="Golden Founder Digital ID + Photo Crown"
          icon={Crown}
          pastel="amber"
        />
        <MetricTile
          label="Premium Student IDs"
          value={stats.premiums}
          subtext="Independent luxury themes (Non-Founder)"
          icon={Gem}
          pastel="purple"
        />
      </div>

      {/* Filters */}
      <SurfaceCard className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search student name, roll, ID, email..."
              className="pl-9"
            />
          </div>
          <Select value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
            <option value="">All Registered Colleges</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name} ({org.code})
              </option>
            ))}
          </Select>
          <Select
            value={tierFilter}
            onChange={(e) =>
              setTierFilter(e.target.value as 'all' | 'founder' | 'premium' | 'standard')
            }
          >
            <option value="all">All Student Tiers</option>
            <option value="founder">Golden Founders Only</option>
            <option value="premium">Premium Student IDs Only</option>
            <option value="standard">Standard Students Only</option>
          </Select>
        </div>
      </SurfaceCard>

      {/* Student Directory Table */}
      <SurfaceCard className="overflow-hidden">
        {isLoading ? (
          <div className="p-5">
            <SkeletonRows rows={6} />
          </div>
        ) : students.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No students match your filter"
              description="Register students inside any college or broaden your filter above."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">College &amp; Academics</th>
                  <th className="px-4 py-3">Golden Founder Status</th>
                  <th className="px-4 py-3">Premium Student ID</th>
                  <th className="px-4 py-3 text-right">Exclusive Allocation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {students.map((s) => {
                  const premPreset = s.isPremium
                    ? getPremiumStudentDesign(s.premiumDesign)
                    : null;
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="relative h-10 w-10 shrink-0">
                            <div
                              className={`h-10 w-10 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center ${
                                s.founder
                                  ? 'border-2 border-[#D4AF37]'
                                  : s.isPremium
                                    ? 'border-2 border-blue-500'
                                    : 'border border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              {s.photoUrl ? (
                                <img
                                  src={s.photoUrl}
                                  alt={s.fullName}
                                  referrerPolicy="no-referrer"
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <User className="h-4 w-4 text-slate-400" />
                              )}
                            </div>
                            {s.founder && (
                              <span
                                title="Official Founder"
                                className="absolute -bottom-0.5 -right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border border-white dark:border-slate-900 bg-gradient-to-br from-[#FFF1B8] to-[#B8860B] text-[#0A0B0F]"
                              >
                                <Crown className="h-2.5 w-2.5 stroke-[2.5]" />
                              </span>
                            )}
                            {!s.founder && s.isPremium && premPreset && (
                              <span
                                title={premPreset.name}
                                className="absolute -bottom-0.5 -right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border border-white dark:border-slate-900 text-white"
                                style={{ backgroundColor: premPreset.secondaryAccent }}
                              >
                                <Gem className="h-2.5 w-2.5" />
                              </span>
                            )}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-white">
                              {s.fullName}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500">
                              {s.studentIdCode} · Roll {s.collegeRollNumber}
                            </div>
                            <div className="text-[10.5px] text-slate-400">{s.email}</div>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 font-medium text-slate-800 dark:text-slate-200">
                          <Building2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span>{s.organizationName}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {[s.courseName, s.semesterName, s.sessionName].filter(Boolean).join(' · ') ||
                            'General Program'}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        {s.founder ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 rounded-full border border-[#D4AF37]/70 bg-[#0A0B0F] px-2.5 py-0.5 text-[10px] font-bold text-[#F6DF9C]">
                              <Crown className="h-3 w-3 text-[#D4AF37]" />
                              {s.founder.founderNumber}
                            </span>
                            <div className="text-[11px] text-slate-500">{s.founder.designation}</div>
                          </div>
                        ) : (
                          <span className="text-slate-400">Not assigned</span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        {s.isPremium && premPreset ? (
                          <div className="space-y-0.5">
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                              style={{
                                backgroundColor: `${premPreset.secondaryAccent}22`,
                                border: `1px solid ${premPreset.borderColor}`,
                                color: premPreset.secondaryAccent,
                              }}
                            >
                              <Gem className="h-3 w-3" />
                              {premPreset.name}
                            </span>
                            <div className="text-[10.5px] text-slate-500">
                              {s.premiumBadgeLabel || premPreset.badgeLabel}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">Standard ID</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {s.founder ? (
                            <Button
                              size="sm"
                              variant="danger"
                              loading={busyId === `founder-${s.id}`}
                              onClick={() => handleRevokeFounder(s)}
                            >
                              <Trash2 className="h-3 w-3" />
                              Revoke Founder
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="gold"
                              onClick={() => openFounderAssignModal(s)}
                            >
                              <Crown className="h-3 w-3" />
                              Assign Founder
                            </Button>
                          )}

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openPremiumAssignModal(s)}
                          >
                            <Gem className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                            {s.isPremium ? 'Change Premium' : 'Assign Premium ID'}
                          </Button>

                          {s.isPremium && (
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={busyId === `premium-${s.id}`}
                              onClick={() => handleRevokePremium(s)}
                              className="text-red-600 dark:text-red-400"
                              title="Revoke Premium Student ID"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      {/* Assign Golden Founder Modal */}
      <Modal
        open={Boolean(founderTarget)}
        onOpenChange={(o) => !o && setFounderTarget(null)}
        title="Assign Exclusive Golden Founder Status"
        description="Immediately generates a Golden Premium Founder Digital ID with overlaid photo Crown badge and active QR verification."
        maxWidth="max-w-md"
      >
        {founderTarget && (
          <form onSubmit={handleAssignFounder} className="space-y-4">
            <div className="rounded-xl border border-[#D4AF37]/40 bg-[#0A0B0F] px-4 py-3 text-[#F6DF9C] text-xs">
              <div className="font-display font-bold text-sm">{founderTarget.fullName}</div>
              <div className="text-[#C7B482] mt-0.5">
                {founderTarget.organizationName} · {founderTarget.studentIdCode} · Roll{' '}
                {founderTarget.collegeRollNumber}
              </div>
            </div>

            <Field label="Founder Designation" required>
              <Input
                required
                value={founderForm.designation}
                onChange={(e) => setFounderForm({ ...founderForm, designation: e.target.value })}
              />
            </Field>
            <Field label="Organization / Recognition Label" required>
              <Input
                required
                value={founderForm.organizationLabel}
                onChange={(e) =>
                  setFounderForm({ ...founderForm, organizationLabel: e.target.value })
                }
              />
            </Field>
            <Field label="Credential Bio (Optional)">
              <Textarea
                value={founderForm.bio}
                onChange={(e) => setFounderForm({ ...founderForm, bio: e.target.value })}
                placeholder="Official recognition note printed on back of Golden Founder ID..."
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <Button type="button" variant="outline" onClick={() => setFounderTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="gold" loading={submitting}>
                <Crown className="h-4 w-4" />
                Generate Golden Founder ID
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Live Preview of Newly Generated Golden Founder ID */}
      <Modal
        open={Boolean(generatedFounderPreview)}
        onOpenChange={(o) => !o && setGeneratedFounderPreview(null)}
        title="Golden Premium Founder ID Activated"
        description="Automatically linked and active in the student's dashboard, profile, and public QR verification."
        maxWidth="max-w-lg"
      >
        {generatedFounderPreview && (
          <div className="flex flex-col items-center py-2">
            <FounderIdCardView founder={generatedFounderPreview} showActions />
          </div>
        )}
      </Modal>

      {/* Assign Independent Premium Student ID Modal */}
      <Modal
        open={Boolean(premiumTarget)}
        onOpenChange={(o) => !o && setPremiumTarget(null)}
        title="Assign Premium Student Digital ID"
        description="Assigns a distinct Premium Student Digital ID design WITHOUT granting Founder status or Founder privileges."
        maxWidth="max-w-xl"
      >
        {premiumTarget && (
          <form onSubmit={handleAssignPremium} className="space-y-4">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900 px-4 py-3 text-xs border border-slate-200 dark:border-slate-800">
              <div className="font-semibold text-slate-900 dark:text-white">
                {premiumTarget.fullName}
              </div>
              <div className="text-slate-500 mt-0.5">
                {premiumTarget.organizationName} · {premiumTarget.studentIdCode} · Roll{' '}
                {premiumTarget.collegeRollNumber}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Select Premium Digital ID Design Theme
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PREMIUM_STUDENT_DESIGNS.map((preset) => {
                  const selected = premiumDesign === preset.key;
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => {
                        setPremiumDesign(preset.key);
                        setPremiumBadgeLabel(preset.badgeLabel);
                      }}
                      className={`text-left rounded-xl p-3.5 transition-all cursor-pointer relative overflow-hidden ${
                        selected
                          ? 'ring-2 ring-[#2563EB] ring-offset-2 dark:ring-offset-slate-900'
                          : 'opacity-85 hover:opacity-100'
                      }`}
                      style={{
                        background: preset.cardBgGradient,
                        border: `1.5px solid ${preset.borderColor}`,
                        color: preset.textColor,
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider"
                          style={{ color: preset.accentColor }}
                        >
                          <Sparkles className="h-3 w-3" />
                          {preset.badgeLabel}
                        </span>
                        {selected && (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-slate-900">
                            <Check className="h-3 w-3 stroke-[3]" />
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 font-display text-sm font-bold">{preset.name}</div>
                      <div className="mt-0.5 text-[11px]" style={{ color: preset.mutedTextColor }}>
                        {preset.tagline}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <Field label="Custom Badge Label">
                <Input
                  value={premiumBadgeLabel}
                  onChange={(e) => setPremiumBadgeLabel(e.target.value)}
                  placeholder="PLATINUM SCHOLAR"
                />
              </Field>
              <Field label="Optional Recognition Note">
                <Input
                  value={premiumNote}
                  onChange={(e) => setPremiumNote(e.target.value)}
                  placeholder="e.g. Dean's List Top Reader"
                />
              </Field>
            </div>

            <div className="rounded-lg border border-blue-200 dark:border-blue-900/50 bg-blue-50/70 dark:bg-blue-950/20 px-3.5 py-2.5 text-[11px] text-blue-900 dark:text-blue-200">
              <strong>Strict Separation:</strong> Assigning a Premium Student ID upgrades the
              student&apos;s Digital ID design and badge only. It never grants Founder status,
              Golden Founder cards, or elevated permissions.
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <Button type="button" variant="outline" onClick={() => setPremiumTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={submitting}>
                <Gem className="h-4 w-4" />
                Save Premium Student ID
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
