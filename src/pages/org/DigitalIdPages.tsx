import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Copy,
  Eye,
  IdCard,
  Layers,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DigitalIdCardView,
  type DigitalIdRenderData,
} from '../../components/id-cards/DigitalIdCardView.tsx';
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
} from '../../components/ui/primitives.tsx';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatDate, formatDateTime } from '../../lib/utils.ts';
import {
  type IdTemplateBackConfig,
  type IdTemplateFrontConfig,
  LOCKED_OFFICIAL_FIELDS,
  STARTER_ID_TEMPLATES,
} from '../../shared/id-presets.ts';

interface IdTemplateRecord {
  id: string;
  name: string;
  slug: string;
  presetKey: string;
  description?: string | null;
  status: string;
  currentVersion: number;
  frontConfig: IdTemplateFrontConfig;
  backConfig: IdTemplateBackConfig;
  backgroundImageUrl?: string | null;
}

// ============================================================================
// 1. DIGITAL ID CARDS REGISTRY
// ============================================================================

export function DigitalIdRegistryPage() {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useAuth();
  const orgId = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationId : null;

  const [previewCard, setPreviewCard] = useState<DigitalIdRenderData | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [issuing, setIssuing] = useState(false);

  const [statusModal, setStatusModal] = useState<{ id: string; cardNumber: string; status: string } | null>(null);
  const [nextStatus, setNextStatus] = useState('suspended');
  const [statusReason, setStatusReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['org-id-cards', orgId],
    queryFn: () =>
      apiRequest<{
        branding: DigitalIdRenderData['branding'];
        idCards: Array<{
          id: string;
          cardNumber: string;
          status: string;
          statusReason?: string;
          issuedAt: string;
          expiresAt: string;
          qrToken?: string;
          customBgUrl?: string | null;
          customBgSettings?: DigitalIdRenderData['customBgSettings'];
          student: DigitalIdRenderData['student'] & { id: string };
          template: IdTemplateRecord;
        }>;
      }>('/org/id-cards'),
    enabled: Boolean(orgId),
  });

  const { data: studentsData } = useQuery({
    queryKey: ['org-students', orgId],
    queryFn: () => apiRequest<{ students: Array<{ id: string; fullName: string; collegeRollNumber: string }> }>('/org/students'),
    enabled: issueOpen && Boolean(orgId),
  });

  const { data: templatesData } = useQuery({
    queryKey: ['org-id-templates', orgId],
    queryFn: () => apiRequest<{ templates: IdTemplateRecord[] }>('/org/id-templates'),
    enabled: issueOpen && Boolean(orgId),
  });

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudentId) return;
    setIssuing(true);
    try {
      await apiRequest('/org/id-cards/generate', {
        method: 'POST',
        body: { studentId: selectedStudentId, templateId: selectedTemplateId || undefined },
      });
      toast.success('Official Digital ID generated with secure QR token.');
      setIssueOpen(false);
      setSelectedStudentId('');
      setSelectedTemplateId('');
      queryClient.invalidateQueries({ queryKey: ['org-id-cards'] });
      queryClient.invalidateQueries({ queryKey: ['org-students'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to generate ID.');
    } finally {
      setIssuing(false);
    }
  };

  const handleStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusModal) return;
    try {
      await apiRequest(`/org/id-cards/${statusModal.id}/status`, {
        method: 'PATCH',
        body: { status: nextStatus, reason: statusReason },
      });
      toast.success(`ID card status updated to ${nextStatus}.`);
      setStatusModal(null);
      setStatusReason('');
      queryClient.invalidateQueries({ queryKey: ['org-id-cards'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to update ID status.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Digital ID Card Registry
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Issue, preview, download PDF, regenerate, or revoke official student Digital IDs with
            cryptographic QR tokens.
          </p>
        </div>
        <Button onClick={() => setIssueOpen(true)}>
          <IdCard className="h-4 w-4" />
          Generate / Regenerate ID
        </Button>
      </div>

      <SurfaceCard className="overflow-hidden">
        {isLoading ? (
          <div className="p-5"><SkeletonRows rows={5} /></div>
        ) : !data?.idCards?.length ? (
          <div className="p-6">
            <EmptyState
              title="No Digital ID cards issued yet"
              description="Register or approve a student to automatically issue an ID card, or generate one directly."
              action={<Button onClick={() => setIssueOpen(true)}>Generate Digital ID</Button>}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3">Card Number</th>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Assigned Template</th>
                  <th className="px-4 py-3">Validity</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.idCards.map((card) => (
                  <tr key={card.id}>
                    <td className="px-4 py-3 font-mono font-semibold tabular-nums">
                      {card.cardNumber}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">
                        {card.student.fullName}
                      </div>
                      <div className="font-mono text-slate-500">
                        {card.student.studentIdCode} · Roll {card.student.collegeRollNumber}
                      </div>
                    </td>
                    <td className="px-4 py-3">{card.template.name}</td>
                    <td className="px-4 py-3 font-mono text-slate-500 tabular-nums">
                      {formatDate(card.issuedAt)} — {formatDate(card.expiresAt)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={card.status} />
                      {card.statusReason && (
                        <div className="text-[11px] text-slate-400 truncate max-w-[160px]">
                          {card.statusReason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setPreviewCard({
                            cardNumber: card.cardNumber,
                            status: card.status,
                            issuedAt: card.issuedAt,
                            expiresAt: card.expiresAt,
                            qrToken: card.qrToken,
                            customBgUrl: card.customBgUrl,
                            customBgSettings: card.customBgSettings,
                            student: card.student,
                            branding: data.branding || { collegeName: 'QIVORA Institution' },
                            template: card.template,
                          })
                        }
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Card & PDF
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setStatusModal({ id: card.id, cardNumber: card.cardNumber, status: card.status });
                          setNextStatus(card.status === 'active' ? 'revoked' : 'active');
                        }}
                      >
                        Change Status
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      <Modal open={issueOpen} onOpenChange={setIssueOpen} title="Generate Student Digital ID" maxWidth="max-w-md">
        <form onSubmit={handleGenerate} className="space-y-4">
          <Field label="Select Student" required>
            <Select required value={selectedStudentId} onChange={(e) => setSelectedStudentId(e.target.value)}>
              <option value="">Choose student...</option>
              {(studentsData?.students || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName} ({s.collegeRollNumber})
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Template Override (Optional)"
            hint="Leave blank to automatically apply the official course/semester assigned template."
          >
            <Select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
              <option value="">Use Official Assigned Template</option>
              {(templatesData?.templates || [])
                .filter((t) => t.status === 'published')
                .map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setIssueOpen(false)}>Cancel</Button>
            <Button type="submit" loading={issuing}>Generate ID</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(previewCard)}
        onOpenChange={(o) => !o && setPreviewCard(null)}
        title="Official Student Digital ID"
        maxWidth="max-w-md"
      >
        {previewCard && <DigitalIdCardView data={previewCard} />}
      </Modal>

      <Modal
        open={Boolean(statusModal)}
        onOpenChange={(o) => !o && setStatusModal(null)}
        title={`Update Status · ${statusModal?.cardNumber || ''}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleStatusSubmit} className="space-y-4">
          <Field label="New Status" required>
            <Select value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="suspended">Suspended</option>
              <option value="blocked">Blocked</option>
              <option value="expired">Expired</option>
              <option value="revoked">Revoked</option>
            </Select>
          </Field>
          <Field label="Audit Reason" required hint="Required for every ID lifecycle change.">
            <Input
              required
              minLength={3}
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              placeholder="e.g. Reported lost / graduation / restored after verification"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setStatusModal(null)}>Cancel</Button>
            <Button type="submit" variant={nextStatus === 'revoked' || nextStatus === 'blocked' ? 'danger' : 'primary'}>
              Update ID Status
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ============================================================================
// 2. ID TEMPLATE STUDIO (College Admin — 9 Starter Templates + Visual Editor)
// ============================================================================

export function IdTemplateStudioPage() {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useAuth();
  const orgId = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationId : null;

  const { data: tplData, isLoading } = useQuery({
    queryKey: ['org-id-templates', orgId],
    queryFn: () => apiRequest<{ templates: IdTemplateRecord[] }>('/org/id-templates'),
    enabled: Boolean(orgId),
  });

  const { data: brandingData } = useQuery({
    queryKey: ['org-branding', orgId],
    queryFn: () => apiRequest<{ branding: DigitalIdRenderData['branding'] }>('/org/branding'),
    enabled: Boolean(orgId),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorSide, setEditorSide] = useState<'front' | 'back'>('front');
  const [saving, setSaving] = useState(false);

  const activeTemplate = useMemo(() => {
    const list = tplData?.templates || [];
    return list.find((t) => t.id === selectedId) || list[0] || null;
  }, [tplData?.templates, selectedId]);

  const [draftName, setDraftName] = useState('');
  const [draftStatus, setDraftStatus] = useState('published');
  const [draftBg, setDraftBg] = useState<string | null>(null);
  const [frontCfg, setFrontCfg] = useState<IdTemplateFrontConfig>(STARTER_ID_TEMPLATES[1].frontConfig);
  const [backCfg, setBackCfg] = useState<IdTemplateBackConfig>(STARTER_ID_TEMPLATES[1].backConfig);
  const [loadedTemplateId, setLoadedTemplateId] = useState<string | null>(null);

  if (activeTemplate && loadedTemplateId !== activeTemplate.id) {
    setLoadedTemplateId(activeTemplate.id);
    setDraftName(activeTemplate.name);
    setDraftStatus(activeTemplate.status);
    setDraftBg(activeTemplate.backgroundImageUrl || null);
    setFrontCfg(activeTemplate.frontConfig);
    setBackCfg(activeTemplate.backConfig);
  }

  const handleSave = async () => {
    if (!activeTemplate) return;
    setSaving(true);
    try {
      await apiRequest(`/org/id-templates/${activeTemplate.id}`, {
        method: 'PATCH',
        body: {
          name: draftName,
          status: draftStatus,
          backgroundImageUrl: draftBg,
          frontConfig: frontCfg,
          backConfig: backCfg,
          changeNote: 'Saved from ID Template Studio',
        },
      });
      toast.success('Template version saved.');
      queryClient.invalidateQueries({ queryKey: ['org-id-templates'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to save template.');
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async () => {
    if (!activeTemplate) return;
    try {
      const res = await apiRequest<{ template: IdTemplateRecord }>(
        `/org/id-templates/${activeTemplate.id}/duplicate`,
        { method: 'POST' }
      );
      toast.success(`Duplicated as "${res.template.name}".`);
      setSelectedId(res.template.id);
      queryClient.invalidateQueries({ queryKey: ['org-id-templates'] });
    } catch {
      toast.error('Unable to duplicate template.');
    }
  };

  const handleCreateNew = async () => {
    try {
      const res = await apiRequest<{ template: IdTemplateRecord }>('/org/id-templates', {
        method: 'POST',
        body: {
          name: `Custom Institutional Card ${(tplData?.templates.length || 0) + 1}`,
          presetKey: 'custom_uploaded',
          frontConfig: STARTER_ID_TEMPLATES[8].frontConfig,
          backConfig: STARTER_ID_TEMPLATES[8].backConfig,
          status: 'draft',
        },
      });
      toast.success('New template created.');
      setSelectedId(res.template.id);
      queryClient.invalidateQueries({ queryKey: ['org-id-templates'] });
    } catch {
      toast.error('Unable to create template.');
    }
  };

  if (isLoading) return <SkeletonRows rows={6} />;

  const previewData: DigitalIdRenderData = {
    cardNumber: 'QIV-2026-849201',
    status: 'active',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
    qrToken: 'preview-verification-token',
    student: {
      fullName: 'Aarav Sharma',
      fatherName: 'Rajesh Sharma',
      studentIdCode: 'STU-2026-10482',
      collegeRollNumber: 'BCA-2026-042',
      courseName: 'Bachelor of Computer Applications (BCA)',
      semesterName: 'Semester 2',
      sessionName: '2026-2027',
      photoUrl: null,
    },
    branding: brandingData?.branding || {
      collegeName: 'QIVORA Reference College',
      universityName: 'State University',
      address: 'University Road, Academic Enclave',
      contactNumber: '+91 11 2345 6789',
      authorizedSignatoryName: 'Chief Librarian',
    },
    template: {
      name: draftName || 'Preview',
      frontConfig: frontCfg,
      backConfig: backCfg,
      backgroundImageUrl: draftBg,
    },
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            ID Template Studio
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Design front & back layouts across all 9 starter presets or custom uploaded artwork.
            Official identity fields remain strictly locked.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCreateNew}>
            <Plus className="h-3.5 w-3.5" />
            New Template
          </Button>
          <Button variant="outline" size="sm" onClick={handleDuplicate} disabled={!activeTemplate}>
            <Copy className="h-3.5 w-3.5" />
            Duplicate
          </Button>
          <Button size="sm" loading={saving} onClick={handleSave} disabled={!activeTemplate}>
            <Save className="h-3.5 w-3.5" />
            Save Version
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Template Selector List */}
        <SurfaceCard className="xl:col-span-3 p-3 space-y-1.5 max-h-[680px] overflow-y-auto">
          <div className="px-2 py-1 text-xs font-semibold text-slate-500">
            Templates ({tplData?.templates.length || 0})
          </div>
          {(tplData?.templates || []).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedId(t.id)}
              className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors cursor-pointer ${
                activeTemplate?.id === t.id
                  ? 'bg-[#1E3A8A] text-white dark:bg-[#2563EB]'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800/80'
              }`}
            >
              <div className="text-xs font-semibold truncate">{t.name}</div>
              <div
                className={`mt-0.5 text-[11px] flex items-center justify-between ${
                  activeTemplate?.id === t.id ? 'text-blue-100' : 'text-slate-500'
                }`}
              >
                <span className="capitalize">{t.status}</span>
                <span className="font-mono">v{t.currentVersion}</span>
              </div>
            </button>
          ))}
        </SurfaceCard>

        {/* Middle: Visual Controls */}
        <SurfaceCard className="xl:col-span-5 p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Template Name">
              <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
            </Field>
            <Field label="Publication Status">
              <Select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)}>
                <option value="published">Published (Assignable)</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </Select>
            </Field>
          </div>

          <div className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setEditorSide('front')}
              className={`px-4 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                editorSide === 'front'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Front Side Design
            </button>
            <button
              type="button"
              onClick={() => setEditorSide('back')}
              className={`px-4 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                editorSide === 'back'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Back Side Design
            </button>
          </div>

          {editorSide === 'front' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Field label="Surface Color">
                  <Input
                    type="color"
                    value={frontCfg.backgroundColor}
                    onChange={(e) => setFrontCfg({ ...frontCfg, backgroundColor: e.target.value })}
                    className="h-10 p-1 cursor-pointer"
                  />
                </Field>
                <Field label="Header Color">
                  <Input
                    type="color"
                    value={frontCfg.secondaryColor}
                    onChange={(e) => setFrontCfg({ ...frontCfg, secondaryColor: e.target.value })}
                    className="h-10 p-1 cursor-pointer"
                  />
                </Field>
                <Field label="Accent Color">
                  <Input
                    type="color"
                    value={frontCfg.accentColor}
                    onChange={(e) => setFrontCfg({ ...frontCfg, accentColor: e.target.value })}
                    className="h-10 p-1 cursor-pointer"
                  />
                </Field>
                <Field label="Text Color">
                  <Input
                    type="color"
                    value={frontCfg.textColor}
                    onChange={(e) => setFrontCfg({ ...frontCfg, textColor: e.target.value })}
                    className="h-10 p-1 cursor-pointer"
                  />
                </Field>
                <Field label="Typography">
                  <Select
                    value={frontCfg.fontFamily}
                    onChange={(e) =>
                      setFrontCfg({
                        ...frontCfg,
                        fontFamily: e.target.value as IdTemplateFrontConfig['fontFamily'],
                      })
                    }
                  >
                    <option value="Plus Jakarta Sans">Plus Jakarta Sans</option>
                    <option value="DM Sans">DM Sans</option>
                    <option value="Georgia">Academic Serif (Georgia)</option>
                    <option value="JetBrains Mono">Technical Mono</option>
                  </Select>
                </Field>
                <Field label="Header Style">
                  <Select
                    value={frontCfg.headerStyle}
                    onChange={(e) =>
                      setFrontCfg({
                        ...frontCfg,
                        headerStyle: e.target.value as IdTemplateFrontConfig['headerStyle'],
                      })
                    }
                  >
                    <option value="solid">Solid Band</option>
                    <option value="gradient">Subtle Gradient</option>
                    <option value="minimal">Minimal Hairline</option>
                    <option value="classic_border">Classic Border</option>
                    <option value="split">Split Executive</option>
                  </Select>
                </Field>
                <Field label="Logo Alignment">
                  <Select
                    value={frontCfg.logoPosition}
                    onChange={(e) =>
                      setFrontCfg({
                        ...frontCfg,
                        logoPosition: e.target.value as IdTemplateFrontConfig['logoPosition'],
                      })
                    }
                  >
                    <option value="split">College Left · Univ Right</option>
                    <option value="left">Left Aligned</option>
                    <option value="center">Centered Crest</option>
                  </Select>
                </Field>
                <Field label="Photo Shape">
                  <Select
                    value={frontCfg.photoShape}
                    onChange={(e) =>
                      setFrontCfg({
                        ...frontCfg,
                        photoShape: e.target.value as IdTemplateFrontConfig['photoShape'],
                      })
                    }
                  >
                    <option value="rounded">Rounded</option>
                    <option value="square">Classic Square</option>
                    <option value="circle">Circle</option>
                  </Select>
                </Field>
                <Field label="Border Style">
                  <Select
                    value={frontCfg.borderStyle}
                    onChange={(e) =>
                      setFrontCfg({
                        ...frontCfg,
                        borderStyle: e.target.value as IdTemplateFrontConfig['borderStyle'],
                      })
                    }
                  >
                    <option value="thin">Hairline</option>
                    <option value="double">Double Academic Frame</option>
                    <option value="none">Borderless</option>
                  </Select>
                </Field>
              </div>

              {/* Background Image Upload + Crop / Zoom / Position / Fit */}
              <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-3">
                <Field
                  label="Custom Background Image (PNG, JPG, JPEG, WebP)"
                  hint="Optional artwork layer rendered behind locked official fields."
                >
                  <FileUploadControl
                    bucket="id_backgrounds"
                    label="Upload Background Image"
                    accept="image/png,image/jpeg,image/webp"
                    currentUrl={draftBg}
                    onUploaded={setDraftBg}
                    allowClear
                  />
                </Field>

                {draftBg && (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <Field label="Image Fit">
                      <Select
                        value={frontCfg.bgFit}
                        onChange={(e) =>
                          setFrontCfg({
                            ...frontCfg,
                            bgFit: e.target.value as 'cover' | 'contain' | 'fill',
                          })
                        }
                      >
                        <option value="cover">Cover (Crop)</option>
                        <option value="contain">Contain (Fit)</option>
                        <option value="fill">Fill</option>
                      </Select>
                    </Field>
                    <Field label={`Zoom (${frontCfg.bgZoom.toFixed(1)}x)`}>
                      <input
                        type="range"
                        min={1}
                        max={2.4}
                        step={0.1}
                        value={frontCfg.bgZoom}
                        onChange={(e) =>
                          setFrontCfg({ ...frontCfg, bgZoom: Number(e.target.value) })
                        }
                        className="w-full"
                      />
                    </Field>
                    <Field label={`Horizontal Position (${frontCfg.bgPositionX}%)`}>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={frontCfg.bgPositionX}
                        onChange={(e) =>
                          setFrontCfg({ ...frontCfg, bgPositionX: Number(e.target.value) })
                        }
                        className="w-full"
                      />
                    </Field>
                    <Field label={`Overlay Veil (${Math.round(frontCfg.bgOverlayOpacity * 100)}%)`}>
                      <input
                        type="range"
                        min={0}
                        max={0.85}
                        step={0.05}
                        value={frontCfg.bgOverlayOpacity}
                        onChange={(e) =>
                          setFrontCfg({ ...frontCfg, bgOverlayOpacity: Number(e.target.value) })
                        }
                        className="w-full"
                      />
                    </Field>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Back Surface">
                  <Input
                    type="color"
                    value={backCfg.backgroundColor}
                    onChange={(e) => setBackCfg({ ...backCfg, backgroundColor: e.target.value })}
                    className="h-10 p-1"
                  />
                </Field>
                <Field label="Back Text">
                  <Input
                    type="color"
                    value={backCfg.textColor}
                    onChange={(e) => setBackCfg({ ...backCfg, textColor: e.target.value })}
                    className="h-10 p-1"
                  />
                </Field>
                <Field label="Header Accent">
                  <Input
                    type="color"
                    value={backCfg.accentColor}
                    onChange={(e) => setBackCfg({ ...backCfg, accentColor: e.target.value })}
                    className="h-10 p-1"
                  />
                </Field>
              </div>
              <Field label="Back Header Title">
                <Input
                  value={backCfg.customHeaderText}
                  onChange={(e) => setBackCfg({ ...backCfg, customHeaderText: e.target.value })}
                />
              </Field>
              <Field label="Footer Verification Notice">
                <Input
                  value={backCfg.customFooterText}
                  onChange={(e) => setBackCfg({ ...backCfg, customFooterText: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  ['showAddress', 'Show College Address'],
                  ['showContact', 'Show Contact Details'],
                  ['showInstructions', 'Show Official Instructions'],
                  ['showSignature', 'Show Authorized Signature'],
                  ['showIssueExpiry', 'Show Issue & Expiry Dates'],
                  ['showVerificationNote', 'Show QR Verification Info'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={Boolean(backCfg[key as keyof IdTemplateBackConfig])}
                      onChange={(e) =>
                        setBackCfg({ ...backCfg, [key]: e.target.checked })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Locked Official Fields Protection Panel */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3.5 dark:border-slate-800 dark:bg-slate-900/60">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <Lock className="h-3.5 w-3.5 text-[#1E3A8A] dark:text-[#60A5FA]" />
              Locked Official Fields (Immutable by Students)
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              {LOCKED_OFFICIAL_FIELDS.map((f) => f.replace(/_/g, ' ')).join(' · ')}
            </p>
          </div>
        </SurfaceCard>

        {/* Right: Live Interactive Front/Back Preview */}
        <div className="xl:col-span-4 flex flex-col items-center">
          <div className="mb-3 text-xs font-medium text-slate-500 dark:text-slate-400">
            Live Preview · {editorSide === 'front' ? 'Front Side' : 'Back Side'}
          </div>
          <DigitalIdCardView
            key={`${activeTemplate?.id}-${editorSide}`}
            data={previewData}
            initialSide={editorSide}
            showActions={false}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 3. COURSE-WISE, SEMESTER-WISE & APPLY TO ALL ID TEMPLATE ASSIGNMENT
// ============================================================================

export function IdAssignmentsPage() {
  const queryClient = useQueryClient();
  const { activeWorkspace } = useAuth();
  const orgId = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationId : null;

  const [scopeType, setScopeType] = useState<string>('course');
  const [templateId, setTemplateId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const [academicSessionId, setAcademicSessionId] = useState('');
  const [studentCategoryId, setStudentCategoryId] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [applyToNewStudents, setApplyToNewStudents] = useState(true);
  const [updateExistingCards, setUpdateExistingCards] = useState(true);

  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [previewResult, setPreviewResult] = useState<{
    targetTemplate: { id: string; name: string };
    affectedCount: number;
    existingCardsChanging: number;
    applyToNewStudents: boolean;
    priority: number;
    previewStudents: Array<{
      id: string;
      fullName: string;
      collegeRollNumber: string;
      courseName?: string;
      semesterName?: string;
      currentTemplateName: string;
      willReplaceExisting: boolean;
    }>;
  } | null>(null);

  const { data: tplData } = useQuery({
    queryKey: ['org-id-templates', orgId],
    queryFn: () => apiRequest<{ templates: IdTemplateRecord[] }>('/org/id-templates'),
    enabled: Boolean(orgId),
  });

  const { data: academics } = useQuery({
    queryKey: ['org-academics', orgId],
    queryFn: () =>
      apiRequest<{
        courses: Array<{ id: string; name: string; code: string }>;
        semesters: Array<{ id: string; courseId: string; name: string }>;
        academicSessions: Array<{ id: string; name: string }>;
        studentCategories: Array<{ id: string; name: string }>;
      }>('/org/academics'),
    enabled: Boolean(orgId),
  });

  const { data: studentsData } = useQuery({
    queryKey: ['org-students', orgId],
    queryFn: () =>
      apiRequest<{ students: Array<{ id: string; fullName: string; collegeRollNumber: string }> }>(
        '/org/students'
      ),
    enabled: Boolean(orgId),
  });

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['org-id-assignments', orgId],
    queryFn: () =>
      apiRequest<{
        assignments: Array<{
          id: string;
          scopeType: string;
          templateName: string;
          courseName?: string;
          semesterName?: string;
          sessionName?: string;
          categoryName?: string;
          studentName?: string;
          priority: number;
          affectedCount: number;
          applyToNewStudents: boolean;
          status: string;
          createdAt: string;
        }>;
      }>('/org/id-assignments'),
    enabled: Boolean(orgId),
  });

  const buildPayload = () => ({
    templateId,
    scopeType,
    courseId: courseId || null,
    semesterId: semesterId || null,
    academicSessionId: academicSessionId || null,
    studentCategoryId: studentCategoryId || null,
    studentIds: scopeType === 'individual_student' ? selectedStudentIds : undefined,
    applyToNewStudents,
    updateExistingCards: scopeType !== 'all_new' && updateExistingCards,
  });

  const handlePreview = async () => {
    if (!templateId) {
      toast.error('Select an official ID template first.');
      return;
    }
    setPreviewing(true);
    try {
      const res = await apiRequest<NonNullable<typeof previewResult>>('/org/id-assignments/preview', {
        method: 'POST',
        body: buildPayload(),
      });
      setPreviewResult(res);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to preview assignment.');
    } finally {
      setPreviewing(false);
    }
  };

  const handleApplyConfirmed = async () => {
    setApplying(true);
    try {
      const res = await apiRequest<{ message: string }>('/org/id-assignments/apply', {
        method: 'POST',
        body: buildPayload(),
      });
      toast.success(res.message);
      setPreviewResult(null);
      queryClient.invalidateQueries({ queryKey: ['org-id-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['org-id-cards'] });
      queryClient.invalidateQueries({ queryKey: ['org-students'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to apply template assignment.');
    } finally {
      setApplying(false);
    }
  };

  const handleReverse = async (id: string) => {
    try {
      const res = await apiRequest<{ message: string }>(`/org/id-assignments/${id}/reverse`, {
        method: 'POST',
      });
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ['org-id-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['org-id-cards'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to reverse assignment.');
    }
  };

  const publishedTemplates = (tplData?.templates || []).filter((t) => t.status === 'published');
  const filteredSemesters = (academics?.semesters || []).filter(
    (s) => !courseId || s.courseId === courseId
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          ID Template Assignments & Apply to All
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Assign official ID card templates by Course, Semester, Academic Session, Student Category,
          Individual Students, or Apply to All. Specific student rules take priority over broader
          course defaults.
        </p>
      </div>

      {/* Assignment Builder */}
      <SurfaceCard className="p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Target Official Template" required>
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Choose published template...</option>
              {publishedTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (v{t.currentVersion})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Assignment Scope" required>
            <Select value={scopeType} onChange={(e) => setScopeType(e.target.value)}>
              <option value="course">Entire Course (Priority 30)</option>
              <option value="semester">Specific Course & Semester (Priority 50)</option>
              <option value="combined">Combined Conditions (Priority 70)</option>
              <option value="academic_session">Academic Session (Priority 20)</option>
              <option value="student_category">Student Category (Priority 25)</option>
              <option value="individual_student">Selected Individual Students (Priority 100)</option>
              <option value="all_existing">Apply to All Existing Students (Priority 10)</option>
              <option value="all_new">Apply to All New Students Default (Priority 10)</option>
            </Select>
          </Field>

          {['course', 'semester', 'combined'].includes(scopeType) && (
            <Field label="Course">
              <Select value={courseId} onChange={(e) => { setCourseId(e.target.value); setSemesterId(''); }}>
                <option value="">Any Course</option>
                {(academics?.courses || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
          )}

          {['semester', 'combined'].includes(scopeType) && (
            <Field label="Semester">
              <Select value={semesterId} onChange={(e) => setSemesterId(e.target.value)}>
                <option value="">Any Semester</option>
                {filteredSemesters.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
          )}

          {['academic_session', 'combined'].includes(scopeType) && (
            <Field label="Academic Session">
              <Select value={academicSessionId} onChange={(e) => setAcademicSessionId(e.target.value)}>
                <option value="">Any Session</option>
                {(academics?.academicSessions || []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
          )}

          {['student_category', 'combined'].includes(scopeType) && (
            <Field label="Student Category">
              <Select value={studentCategoryId} onChange={(e) => setStudentCategoryId(e.target.value)}>
                <option value="">Any Category</option>
                {(academics?.studentCategories || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        {scopeType === 'individual_student' && (
          <Field label="Select Students" hint="Select one or more students to receive this highest-priority assignment.">
            <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 p-2 space-y-1">
              {(studentsData?.students || []).map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-xs px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedStudentIds.includes(s.id)}
                    onChange={(e) => {
                      setSelectedStudentIds((prev) =>
                        e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                      );
                    }}
                  />
                  <span className="font-medium">{s.fullName}</span>
                  <span className="font-mono text-slate-500">({s.collegeRollNumber})</span>
                </label>
              ))}
            </div>
          </Field>
        )}

        <div className="flex flex-wrap items-center gap-6 text-xs text-slate-700 dark:text-slate-300">
          {scopeType !== 'all_new' && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={updateExistingCards}
                onChange={(e) => setUpdateExistingCards(e.target.checked)}
              />
              Update existing active student ID cards in batch
            </label>
          )}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={applyToNewStudents}
              onChange={(e) => setApplyToNewStudents(e.target.checked)}
            />
            Apply automatically to future students matching this rule
          </label>
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-200 dark:border-slate-800">
          <Button onClick={handlePreview} loading={previewing}>
            <Layers className="h-4 w-4" />
            Calculate Affected Students & Preview
          </Button>
        </div>
      </SurfaceCard>

      {/* Assignment History with Reverse */}
      <SurfaceCard className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Assignment History & Reversal Log
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['org-id-assignments'] })}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
        {historyLoading ? (
          <div className="p-5"><SkeletonRows rows={4} /></div>
        ) : !historyData?.assignments?.length ? (
          <div className="p-6">
            <EmptyState
              title="No template assignments recorded yet"
              description="Configure a course, semester, or Apply to All assignment above and confirm after previewing affected students."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3">Applied On</th>
                  <th className="px-4 py-3">Template</th>
                  <th className="px-4 py-3">Scope & Rule</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Affected</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {historyData.assignments.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-3 font-mono text-slate-500 tabular-nums whitespace-nowrap">
                      {formatDateTime(a.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                      {a.templateName}
                    </td>
                    <td className="px-4 py-3">
                      <div className="capitalize">{a.scopeType.replace(/_/g, ' ')}</div>
                      <div className="text-slate-500">
                        {[a.courseName, a.semesterName, a.sessionName, a.categoryName, a.studentName]
                          .filter(Boolean)
                          .join(' · ') || 'All Matching Students'}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">{a.priority}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">{a.affectedCount}</td>
                    <td className="px-4 py-3"><StatusText status={a.status} /></td>
                    <td className="px-4 py-3 text-right">
                      {a.status === 'active' && (
                        <Button size="sm" variant="outline" onClick={() => handleReverse(a.id)}>
                          <RotateCcw className="h-3.5 w-3.5" />
                          Reverse
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

      {/* Mandatory Preview & Confirmation Modal */}
      <Modal
        open={Boolean(previewResult)}
        onOpenChange={(o) => !o && setPreviewResult(null)}
        title="Confirm Official ID Template Assignment"
        description="Review the affected student count and template transition before applying."
        maxWidth="max-w-2xl"
      >
        {previewResult && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                <div className="text-slate-500">New Official Template</div>
                <div className="mt-1 font-semibold text-slate-900 dark:text-white">
                  {previewResult.targetTemplate.name}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                <div className="text-slate-500">Affected Students</div>
                <div className="mt-1 font-mono text-lg font-bold tabular-nums">
                  {previewResult.affectedCount}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                <div className="text-slate-500">Existing IDs Changing</div>
                <div className="mt-1 font-mono text-lg font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                  {previewResult.existingCardsChanging}
                </div>
              </div>
            </div>

            {previewResult.existingCardsChanging > 0 && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Warning: {previewResult.existingCardsChanging} existing active Digital ID card(s)
                  will immediately switch to "{previewResult.targetTemplate.name}". A snapshot will
                  be saved so you can reverse this assignment if needed.
                </span>
              </div>
            )}

            {previewResult.previewStudents.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                    <tr>
                      <th className="px-3 py-2">Student</th>
                      <th className="px-3 py-2">Course / Sem</th>
                      <th className="px-3 py-2">Current Template</th>
                      <th className="px-3 py-2">New Template</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {previewResult.previewStudents.map((s) => (
                      <tr key={s.id}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{s.fullName}</div>
                          <div className="font-mono text-slate-400">{s.collegeRollNumber}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {[s.courseName, s.semesterName].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-500">{s.currentTemplateName}</td>
                        <td className="px-3 py-2 font-semibold text-[#1E3A8A] dark:text-[#60A5FA]">
                          {previewResult.targetTemplate.name}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <Button variant="outline" onClick={() => setPreviewResult(null)}>
                Cancel
              </Button>
              <Button loading={applying} onClick={handleApplyConfirmed}>
                Confirm & Apply Assignment
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
