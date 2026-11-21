import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  BookOpen,
  BookmarkCheck,
  Calendar,
  CreditCard,
  Crown,
  Gem,
  IndianRupee,
  KeyRound,
  Library,
  Lock,
  Mail,
  MapPin,
  Palette,
  Phone,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  User,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatCurrency, formatDate, formatDateTime } from '../../lib/utils.ts';
import { matchesIsbnSearch } from '../../shared/isbn.ts';
import { getPremiumStudentDesign } from '../../shared/security-and-tiers.ts';
import type { PremiumStudentSummary } from '../../types/qivora.ts';
import {
  DigitalIdCardView,
  type DigitalIdRenderData,
  type FounderCardData,
  FounderIdCardView,
  PremiumStudentIdCardView,
} from '../../components/id-cards/DigitalIdCardView.tsx';
import {
  Button,
  EmptyState,
  Field,
  FileUploadControl,
  Input,
  MetricTile,
  QuickActionTile,
  Select,
  SkeletonRows,
  StatusText,
  SurfaceCard,
  WelcomeBanner,
} from '../../components/ui/primitives.tsx';
import { NotificationCenterPage } from '../org/NotificationCenterPage.tsx';
import {
  LOCKED_OFFICIAL_FIELDS,
  type IdTemplateBackConfig,
  type IdTemplateFrontConfig,
} from '../../shared/id-presets.ts';

interface StudentDashboardResponse {
  student: {
    id: string;
    fullName: string;
    fatherName: string;
    studentIdCode: string;
    collegeRollNumber: string;
    email: string;
    phone?: string | null;
    photoUrl?: string | null;
    status: string;
    courseName?: string | null;
    semesterName?: string | null;
    sessionName?: string | null;
  };
  branding: {
    collegeName: string;
    collegeLogoUrl?: string | null;
    universityName?: string | null;
    universityLogoUrl?: string | null;
    address?: string | null;
    contactNumber?: string | null;
    email?: string | null;
    website?: string | null;
    authorizedSignatureUrl?: string | null;
    authorizedSignatoryName?: string | null;
    libraryContactDetails?: string | null;
    idCardInstructions?: string | null;
    allowStudentIdCustomization?: boolean;
    allowStudentBgUpload?: boolean;
  } | null;
  digitalId: {
    id: string;
    cardNumber: string;
    status: string;
    issuedAt: string;
    expiresAt: string;
    qrToken?: string | null;
    customBgUrl?: string | null;
    customBgSettings?: {
      zoom?: number;
      positionX?: number;
      positionY?: number;
      fit?: 'cover' | 'contain' | 'fill';
      overlayOpacity?: number;
    } | null;
    template: {
      name: string;
      frontConfig: IdTemplateFrontConfig;
      backConfig: IdTemplateBackConfig;
      backgroundImageUrl?: string | null;
    };
  } | null;
  summary: {
    currentlyIssuedCount: number;
    maxBooksAllowed?: number;
    overdueCount: number;
    upcomingDueCount: number;
    nextDueDate?: string | null;
    outstandingFines: number;
    activeReservationsCount: number;
  };
  linkedFounderIdentity?: FounderCardData | null;
  premiumStudent?: PremiumStudentSummary | null;
  loans: Array<{
    id: string;
    receiptNumber: string;
    status: string;
    isOverdue: boolean;
    issuedAt: string;
    dueAt: string;
    returnedAt?: string | null;
    renewalCount: number;
    bookTitle: string;
    bookIsbn: string;
    coverImageUrl?: string | null;
    barcode: string;
  }>;
  reservations: Array<{
    id: string;
    bookId: string;
    queuePosition: number;
    status: string;
    expiresAt?: string | null;
    createdAt: string;
    bookTitle: string;
    bookIsbn: string;
  }>;
  fines: Array<{
    id: string;
    amount: string;
    paidAmount: string;
    waivedAmount: string;
    balance: number;
    reason: string;
    status: string;
    createdAt: string;
  }>;
  attendance: Array<{
    id: string;
    checkInAt: string;
    checkOutAt?: string | null;
    method: string;
    notes?: string | null;
  }>;
}

interface CatalogBookItem {
  id: string;
  isbn: string;
  title: string;
  subtitle?: string | null;
  authorName?: string | null;
  publisherName?: string | null;
  categoryName?: string | null;
  courseName?: string | null;
  semesterName?: string | null;
  subject?: string | null;
  edition?: string | null;
  publicationYear?: number | null;
  coverImageUrl?: string | null;
  rackCode?: string | null;
  shelfCode?: string | null;
  sectionName?: string | null;
  inventory: { total: number; available: number; issued: number; reserved: number };
}

function useStudentDashboard() {
  const { activeWorkspace } = useAuth();
  const orgId = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationId : null;
  return useQuery({
    queryKey: ['student-dashboard', orgId],
    queryFn: () => apiRequest<StudentDashboardResponse>('/student/dashboard'),
    enabled: Boolean(orgId),
  });
}

function buildRenderData(data: StudentDashboardResponse): DigitalIdRenderData | null {
  if (!data.digitalId) return null;
  return {
    cardNumber: data.digitalId.cardNumber,
    status: data.digitalId.status,
    issuedAt: data.digitalId.issuedAt,
    expiresAt: data.digitalId.expiresAt,
    qrToken: data.digitalId.qrToken,
    customBgUrl: data.digitalId.customBgUrl,
    customBgSettings: data.digitalId.customBgSettings,
    student: {
      fullName: data.student.fullName,
      fatherName: data.student.fatherName,
      studentIdCode: data.student.studentIdCode,
      collegeRollNumber: data.student.collegeRollNumber,
      courseName: data.student.courseName,
      semesterName: data.student.semesterName,
      sessionName: data.student.sessionName,
      photoUrl: data.student.photoUrl,
    },
    branding: {
      collegeName: data.branding?.collegeName || 'Registered Institution',
      collegeLogoUrl: data.branding?.collegeLogoUrl,
      universityName: data.branding?.universityName,
      universityLogoUrl: data.branding?.universityLogoUrl,
      address: data.branding?.address,
      contactNumber: data.branding?.contactNumber,
      email: data.branding?.email,
      website: data.branding?.website,
      authorizedSignatureUrl: data.branding?.authorizedSignatureUrl,
      authorizedSignatoryName: data.branding?.authorizedSignatoryName,
      idCardInstructions: data.branding?.idCardInstructions,
    },
    template: data.digitalId.template,
  };
}

// 1. STUDENT DASHBOARD
function StudentDashboardPage() {
  const { data, isLoading } = useStudentDashboard();

  if (isLoading) {
    return (
      <SurfaceCard className="p-6">
        <SkeletonRows rows={6} />
      </SurfaceCard>
    );
  }
  if (!data) {
    return (
      <EmptyState
        title="Student record unavailable"
        description="Your student profile is not yet linked to an active institution membership."
      />
    );
  }

  const cardData = buildRenderData(data);
  const activeLoans = data.loans.filter((l) => l.status !== 'returned');
  const maxQuota = Math.max(1, data.summary.maxBooksAllowed ?? 4);
  const borrowUsagePct = Math.min(100, Math.round((data.summary.currentlyIssuedCount / maxQuota) * 100));

  return (
    <div className="space-y-6">
      <WelcomeBanner
        name={data.student.fullName}
        roleLabel={
          data.linkedFounderIdentity
            ? 'Student Member · Official QIVORA Founder'
            : data.premiumStudent?.isPremium
              ? `Student Member · ${data.premiumStudent.premiumBadgeLabel || 'Premium Scholar'}`
              : 'Student Member'
        }
        organizationName={data.branding?.collegeName}
        subtitle={`${data.student.courseName || 'Academic Program'}${
          data.student.semesterName ? ` · ${data.student.semesterName}` : ''
        } · Roll ${data.student.collegeRollNumber} · ID ${data.student.studentIdCode}`}
        avatarUrl={data.student.photoUrl}
        progressLabel="Active Borrowing Quota"
        progressValue={borrowUsagePct}
        progressSubtext={`${data.summary.currentlyIssuedCount} of ${maxQuota} book(s) currently issued · ${
          data.attendance.length
        } recorded visit(s)`}
        actions={
          <>
            <Link
              to="/student/books"
              className="inline-flex items-center gap-2 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 px-3.5 py-2 text-xs font-semibold text-white transition-colors"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Explore Catalog
            </Link>
            <Link
              to="/student/digital-id"
              className="inline-flex items-center gap-2 rounded-xl bg-white text-[#2563EB] hover:bg-blue-50 px-3.5 py-2 text-xs font-semibold shadow-xs transition-colors"
            >
              <CreditCard className="h-3.5 w-3.5" />
              Open Digital ID
            </Link>
          </>
        }
      />

      {/* Exclusive Golden Founder Recognition Strip with Overlaid Photo Badge */}
      {data.linkedFounderIdentity && (
        <div
          className="rounded-2xl border border-[#D4AF37]/70 p-4 sm:p-5 text-[#F6DF9C] shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
          style={{
            backgroundImage:
              'radial-gradient(circle at 12% 20%, rgba(212,175,55,0.22), transparent 55%), linear-gradient(135deg, #0D0F16 0%, #17140D 100%)',
          }}
        >
          <div className="flex items-center gap-4">
            <div className="relative h-14 w-14 shrink-0">
              <div className="h-14 w-14 overflow-hidden rounded-full border-2 border-[#F4D57E] bg-[#141720] flex items-center justify-center">
                {data.student.photoUrl || data.linkedFounderIdentity.photoUrl ? (
                  <img
                    src={data.student.photoUrl || data.linkedFounderIdentity.photoUrl || ''}
                    alt={data.student.fullName}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <User className="h-6 w-6 text-[#D4AF37]" />
                )}
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#0D0F16] bg-gradient-to-br from-[#FFF1B8] via-[#D4AF37] to-[#996515] text-[#0D0F16] shadow">
                <Crown className="h-3.5 w-3.5 stroke-[2.5]" />
              </div>
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[#D4AF37]">
                <Crown className="h-3.5 w-3.5" />
                QIVORA Golden Founder Member · {data.linkedFounderIdentity.founderNumber}
              </div>
              <div className="mt-0.5 font-display text-base font-bold text-[#F6DF9C]">
                {data.linkedFounderIdentity.designation}
              </div>
              <p className="text-xs text-[#C7B482] mt-0.5">
                Your exclusive Golden Premium Founder Digital ID is active and linked to your college library account.
              </p>
            </div>
          </div>
          <Link
            to="/student/digital-id"
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#F4D57E] px-4 py-2 text-xs font-bold text-[#0A0B0F] shadow hover:opacity-95 shrink-0"
          >
            <Crown className="h-3.5 w-3.5" />
            View Golden Founder ID
          </Link>
        </div>
      )}

      {/* Independent Premium Student Recognition Strip (Distinct from Founder) */}
      {!data.linkedFounderIdentity && data.premiumStudent?.isPremium && (() => {
        const preset = getPremiumStudentDesign(data.premiumStudent.premiumDesign);
        return (
          <div
            className="rounded-2xl p-4 sm:p-5 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
            style={{
              background: preset.cardBgGradient,
              border: `1px solid ${preset.borderColor}88`,
              color: preset.textColor,
            }}
          >
            <div className="flex items-center gap-4">
              <div className="relative h-14 w-14 shrink-0">
                <div
                  className="h-14 w-14 overflow-hidden rounded-full flex items-center justify-center bg-black/30"
                  style={{ border: `2px solid ${preset.borderColor}` }}
                >
                  {data.student.photoUrl ? (
                    <img
                      src={data.student.photoUrl}
                      alt={data.student.fullName}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <User className="h-6 w-6" style={{ color: preset.accentColor }} />
                  )}
                </div>
                <div
                  className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full shadow"
                  style={{
                    backgroundColor: preset.secondaryAccent,
                    border: `2px solid ${preset.cardBg}`,
                    color: '#FFFFFF',
                  }}
                >
                  <Gem className="h-3 w-3" />
                </div>
              </div>
              <div>
                <div
                  className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em]"
                  style={{ color: preset.accentColor }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {data.premiumStudent.premiumBadgeLabel || preset.badgeLabel} · {preset.name}
                </div>
                <div className="mt-0.5 font-display text-base font-bold">
                  Premium Student Digital ID Active
                </div>
                <p className="text-xs mt-0.5" style={{ color: preset.mutedTextColor }}>
                  Your account features an exclusive {preset.name} Digital ID design assigned by the QIVORA Platform Administration.
                </p>
              </div>
            </div>
            <Link
              to="/student/digital-id"
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold shadow shrink-0"
              style={{ backgroundColor: preset.accentColor, color: preset.cardBg }}
            >
              <Gem className="h-3.5 w-3.5" />
              View Premium ID
            </Link>
          </div>
        );
      })()}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricTile
          label="Currently Issued"
          value={data.summary.currentlyIssuedCount}
          subtext={
            data.summary.nextDueDate ? `Next due ${formatDate(data.summary.nextDueDate)}` : 'No active loans'
          }
          icon={BookOpen}
          pastel="blue"
          to="/student/loans"
        />
        <MetricTile
          label="Overdue Books"
          value={data.summary.overdueCount}
          subtext={data.summary.overdueCount > 0 ? 'Return promptly' : 'All clear'}
          tone={data.summary.overdueCount > 0 ? 'danger' : 'default'}
          icon={AlertTriangle}
          pastel="rose"
          to="/student/loans"
        />
        <MetricTile
          label="Active Reservations"
          value={data.summary.activeReservationsCount}
          subtext="Queued & ready pickups"
          tone={data.summary.activeReservationsCount > 0 ? 'warning' : 'default'}
          icon={BookmarkCheck}
          pastel="purple"
          to="/student/reservations"
        />
        <MetricTile
          label="Outstanding Fines"
          value={formatCurrency(data.summary.outstandingFines)}
          subtext={data.summary.outstandingFines > 0 ? 'Pay at circulation desk' : 'No dues pending'}
          tone={data.summary.outstandingFines > 0 ? 'danger' : 'success'}
          icon={IndianRupee}
          pastel="emerald"
          to="/student/fines"
        />
      </div>

      {/* Colorful Pastel Quick Action Grid */}
      <div className="space-y-2.5">
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
          Quick Access
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <QuickActionTile label="My Digital ID" description="QR card & PDF" icon={CreditCard} pastel="indigo" to="/student/digital-id" />
          <QuickActionTile label="Explore Books" description="Search & reserve" icon={Search} pastel="blue" to="/student/books" />
          <QuickActionTile label="My Borrowed Books" description="Due dates & history" icon={BookOpen} pastel="purple" to="/student/loans" />
          <QuickActionTile label="Reservations" description="Queue & pickup" icon={BookmarkCheck} pastel="amber" to="/student/reservations" />
          <QuickActionTile label="Attendance" description="Reading room logs" icon={Calendar} pastel="cyan" to="/student/attendance" />
          <QuickActionTile label="Notifications" description="Alerts & preferences" icon={Bell} pastel="emerald" to="/student/notifications" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <SurfaceCard className="lg:col-span-5 p-5 flex flex-col items-center">
          <div className="w-full flex items-center justify-between mb-4">
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
              {data.linkedFounderIdentity ? (
                <>
                  <Crown className="h-4 w-4 text-[#D4AF37]" />
                  Golden Founder Edition ID
                </>
              ) : data.premiumStudent?.isPremium ? (
                <>
                  <Gem className="h-4 w-4 text-blue-500" />
                  Premium Student Digital ID
                </>
              ) : (
                'My Digital Library ID'
              )}
            </h2>
            <Link to="/student/digital-id" className="text-xs font-medium text-[#1E3A8A] dark:text-[#60A5FA]">
              Full View
            </Link>
          </div>
          {data.linkedFounderIdentity ? (
            <FounderIdCardView founder={data.linkedFounderIdentity} showActions={false} />
          ) : data.premiumStudent?.isPremium && cardData ? (
            <PremiumStudentIdCardView
              data={cardData}
              premiumDesign={data.premiumStudent.premiumDesign}
              premiumBadgeLabel={data.premiumStudent.premiumBadgeLabel}
              compact
              showActions={false}
            />
          ) : cardData ? (
            <DigitalIdCardView data={cardData} compact showActions={false} />
          ) : (
            <EmptyState
              title="Digital ID not issued yet"
              description="Once your institution issues your official library credential, it will appear here."
            />
          )}
        </SurfaceCard>

        <SurfaceCard className="lg:col-span-7 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white">
              Currently Issued Books ({activeLoans.length})
            </h2>
            <Link to="/student/loans" className="text-xs font-medium text-[#1E3A8A] dark:text-[#60A5FA]">
              View Full History
            </Link>
          </div>
          {activeLoans.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No books currently checked out"
                description="Browse your college library catalog to find textbooks, reference materials, and reserve titles."
                action={
                  <Link to="/student/books">
                    <Button size="sm" variant="outline">
                      Browse Library Catalog
                    </Button>
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {activeLoans.map((loan) => (
                <div key={loan.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-white truncate">
                      {loan.bookTitle}
                    </div>
                    <div className="text-xs font-mono text-slate-500 mt-0.5">
                      Copy {loan.barcode} · Receipt {loan.receiptNumber}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <StatusText status={loan.isOverdue ? 'overdue' : loan.status} />
                    <div className="text-xs font-mono text-slate-500 mt-0.5 tabular-nums">
                      Due {formatDate(loan.dueAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}

// 2. DIGITAL ID + ADMIN-GATED SAFE BACKGROUND CUSTOMIZATION
function StudentDigitalIdPage() {
  const { data, isLoading } = useStudentDashboard();
  const queryClient = useQueryClient();

  const [customBgUrl, setCustomBgUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [positionX, setPositionX] = useState(50);
  const [positionY, setPositionY] = useState(50);
  const [fit, setFit] = useState<'cover' | 'contain' | 'fill'>('cover');
  const [overlayOpacity, setOverlayOpacity] = useState(0.25);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.digitalId) {
      setCustomBgUrl(data.digitalId.customBgUrl || null);
      const s = data.digitalId.customBgSettings;
      setZoom(s?.zoom ?? 1);
      setPositionX(s?.positionX ?? 50);
      setPositionY(s?.positionY ?? 50);
      setFit(s?.fit ?? 'cover');
      setOverlayOpacity(s?.overlayOpacity ?? 0.25);
    }
  }, [data]);

  if (isLoading) {
    return (
      <SurfaceCard className="p-6">
        <SkeletonRows rows={6} />
      </SurfaceCard>
    );
  }
  if (!data) return null;

  const baseRender = buildRenderData(data);
  const canCustomize = Boolean(data.branding?.allowStudentIdCustomization);
  const canUploadBg = Boolean(data.branding?.allowStudentBgUpload);

  const liveRender: DigitalIdRenderData | null = baseRender
    ? {
        ...baseRender,
        customBgUrl,
        customBgSettings: { zoom, positionX, positionY, fit, overlayOpacity },
      }
    : null;

  const handleSaveCustomization = async () => {
    setSaving(true);
    try {
      await apiRequest('/student/my-id/customize', {
        method: 'PATCH',
        body: {
          customBgUrl,
          customBgSettings: { zoom, positionX, positionY, fit, overlayOpacity },
        },
      });
      toast.success('Digital ID background preference saved.');
      queryClient.invalidateQueries({ queryKey: ['student-dashboard'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to save customization.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setCustomBgUrl(null);
    setZoom(1);
    setPositionX(50);
    setPositionY(50);
    setFit('cover');
    setOverlayOpacity(0.25);
    setSaving(true);
    try {
      await apiRequest('/student/my-id/customize', {
        method: 'PATCH',
        body: {
          customBgUrl: null,
          customBgSettings: { zoom: 1, positionX: 50, positionY: 50, fit: 'cover', overlayOpacity: 0.25 },
        },
      });
      toast.success('Reset to institutional template default background.');
      queryClient.invalidateQueries({ queryKey: ['student-dashboard'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to reset customization.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
          My Official Digital Library ID
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Present this QR-verified credential at the circulation desk, download as PDF, or print for campus use.
        </p>
      </div>

      {data.linkedFounderIdentity && (
        <SurfaceCard className="p-6 border-[#D4AF37]/60 bg-gradient-to-br from-[#0A0B0F] via-[#111520] to-[#0A0B0F] text-[#F6DF9C]">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            <div className="lg:col-span-6 space-y-3">
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#D4AF37]">
                <Crown className="h-4 w-4" />
                <span>Exclusive Super Admin Founder Allocation</span>
              </div>
              <h2 className="font-display text-xl font-bold text-[#F6DF9C]">
                QIVORA — Golden Founder Edition
              </h2>
              <p className="text-xs text-[#C7B482] leading-relaxed">
                Your exclusive Golden Premium Founder Digital ID is automatically activated and
                linked to your official college student membership ({data.student.studentIdCode} · Roll{' '}
                {data.student.collegeRollNumber}). Present it at any circulation or attendance scanner.
              </p>
              <div className="rounded-xl border border-[#D4AF37]/30 bg-black/30 p-3.5 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[#9A834B]">Founder Credential Status</span>
                  <span className="font-mono uppercase font-semibold text-emerald-400">
                    Active &amp; Verified
                  </span>
                </div>
                <p className="text-[11px] text-[#A8925C]">
                  Your Golden Founder QR works seamlessly at your college Circulation Desk and
                  Attendance Gate under your official student borrowing limits and records.
                </p>
              </div>
            </div>
            <div className="lg:col-span-6 flex justify-center">
              <FounderIdCardView founder={data.linkedFounderIdentity} showActions />
            </div>
          </div>
        </SurfaceCard>
      )}

      {data.premiumStudent?.isPremium && liveRender && (() => {
        const preset = getPremiumStudentDesign(data.premiumStudent.premiumDesign);
        return (
          <div
            className="rounded-2xl border p-6 shadow-sm"
            style={{
              background: preset.cardBgGradient,
              borderColor: `${preset.borderColor}77`,
              color: preset.textColor,
            }}
          >
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              <div className="lg:col-span-6 space-y-3">
                <div
                  className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em]"
                  style={{ color: preset.accentColor }}
                >
                  <Gem className="h-4 w-4" />
                  <span>Premium Student Edition · {preset.name}</span>
                </div>
                <h2 className="font-display text-xl font-bold">
                  {data.premiumStudent.premiumBadgeLabel || preset.badgeLabel} Digital ID
                </h2>
                <p className="text-xs leading-relaxed" style={{ color: preset.mutedTextColor }}>
                  Assigned by QIVORA Platform Administration. This Premium Student ID uses your live
                  institutional QR code and verified academic credentials without granting Founder
                  privileges.
                </p>
                {data.premiumStudent.premiumNote && (
                  <div className="rounded-xl border border-white/15 bg-black/25 p-3 text-xs">
                    <div className="text-[10px] uppercase tracking-wider opacity-70">Recognition Note</div>
                    <div className="mt-1">{data.premiumStudent.premiumNote}</div>
                  </div>
                )}
              </div>
              <div className="lg:col-span-6 flex justify-center">
                <PremiumStudentIdCardView
                  data={liveRender}
                  premiumDesign={data.premiumStudent.premiumDesign}
                  premiumBadgeLabel={data.premiumStudent.premiumBadgeLabel}
                  showActions
                />
              </div>
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <SurfaceCard className="lg:col-span-6 p-6 flex flex-col items-center">
          {liveRender ? (
            <DigitalIdCardView data={liveRender} showActions />
          ) : (
            <EmptyState
              title="No active Digital ID card"
              description="Contact your college library desk to issue or reactivate your Digital ID."
            />
          )}
        </SurfaceCard>

        <div className="lg:col-span-6 space-y-5">
          <SurfaceCard className="p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-display font-semibold text-slate-900 dark:text-white">
              <Lock className="h-4 w-4 text-slate-500" />
              Protected Official Identity Fields
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              The following credential attributes are governed by your institution and cannot be altered by students:
            </p>
            <div className="grid grid-cols-2 gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              {LOCKED_OFFICIAL_FIELDS.map((field) => (
                <div key={field} className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400 shrink-0" />
                  <span>{field}</span>
                </div>
              ))}
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-display font-semibold text-slate-900 dark:text-white">
                <Palette className="h-4 w-4 text-[#1E3A8A] dark:text-[#60A5FA]" />
                Personal Background Customization
              </div>
              <StatusText status={canCustomize ? 'active' : 'inactive'} />
            </div>

            {!canCustomize ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Background customization is currently disabled by your College Administrator. Your card uses the official institutional template assigned to your course and semester.
              </p>
            ) : (
              <div className="space-y-4">
                {canUploadBg ? (
                  <Field
                    label="Custom Background Image"
                    hint="PNG, JPG, or WebP up to 3 MB. Official identity text and QR code always stay readable."
                  >
                    <FileUploadControl
                      bucket="id_backgrounds"
                      label="Upload Background"
                      currentUrl={customBgUrl}
                      onUploaded={setCustomBgUrl}
                      allowClear
                    />
                  </Field>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Image upload is restricted by your College Administrator. You may tune overlay clarity below.
                  </p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label={`Zoom (${zoom.toFixed(2)}x)`}>
                    <input
                      type="range"
                      min={0.5}
                      max={2.5}
                      step={0.05}
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                      className="w-full"
                    />
                  </Field>
                  <Field label={`Readability Overlay (${Math.round(overlayOpacity * 100)}%)`}>
                    <input
                      type="range"
                      min={0}
                      max={0.85}
                      step={0.05}
                      value={overlayOpacity}
                      onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                      className="w-full"
                    />
                  </Field>
                  <Field label={`Horizontal Position (${positionX}%)`}>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={positionX}
                      onChange={(e) => setPositionX(Number(e.target.value))}
                      className="w-full"
                    />
                  </Field>
                  <Field label={`Vertical Position (${positionY}%)`}>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={positionY}
                      onChange={(e) => setPositionY(Number(e.target.value))}
                      className="w-full"
                    />
                  </Field>
                </div>

                <Field label="Background Fit">
                  <Select
                    value={fit}
                    onChange={(e) => setFit(e.target.value as 'cover' | 'contain' | 'fill')}
                  >
                    <option value="cover">Cover (Recommended)</option>
                    <option value="contain">Contain</option>
                    <option value="fill">Fill</option>
                  </Select>
                </Field>

                <div className="flex flex-wrap justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleReset} disabled={saving}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset Default
                  </Button>
                  <Button type="button" size="sm" loading={saving} onClick={handleSaveCustomization}>
                    <Save className="h-3.5 w-3.5" />
                    Save Background
                  </Button>
                </div>
              </div>
            )}
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
}

// 3. EXPLORE BOOKS & RESERVE
function StudentExploreBooksPage() {
  const { activeWorkspace } = useAuth();
  const orgId = activeWorkspace?.type === 'organization' ? activeWorkspace.membership.organizationId : null;
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [availabilityOnly, setAvailabilityOnly] = useState(false);
  const [reservingId, setReservingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['student-catalog', orgId],
    queryFn: () => apiRequest<{ books: CatalogBookItem[] }>('/student/books'),
    enabled: Boolean(orgId),
  });

  const booksList = data?.books || [];
  const categories = useMemo(
    () => Array.from(new Set(booksList.map((b) => b.categoryName).filter(Boolean))) as string[],
    [booksList]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return booksList.filter((b) => {
      if (categoryFilter !== 'all' && b.categoryName !== categoryFilter) return false;
      if (availabilityOnly && b.inventory.available <= 0) return false;
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) ||
        b.isbn.toLowerCase().includes(q) ||
        matchesIsbnSearch(b.isbn, q) ||
        (b.authorName || '').toLowerCase().includes(q) ||
        (b.subject || '').toLowerCase().includes(q) ||
        (b.courseName || '').toLowerCase().includes(q)
      );
    });
  }, [booksList, search, categoryFilter, availabilityOnly]);

  const handleReserve = async (book: CatalogBookItem) => {
    setReservingId(book.id);
    try {
      await apiRequest('/org/reservations', {
        method: 'POST',
        body: { bookId: book.id },
      });
      toast.success(`Reservation placed for "${book.title}".`);
      queryClient.invalidateQueries({ queryKey: ['student-dashboard'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to place reservation.');
    } finally {
      setReservingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
          Explore Library Catalog
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Search textbooks, reference volumes, shelf locations, and real-time physical copy availability.
        </p>
      </div>

      <SurfaceCard className="p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, author, ISBN, subject, or course..."
            className="pl-9"
          />
        </div>
        <Select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="sm:w-48"
        >
          <option value="all">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 px-2 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={availabilityOnly}
            onChange={(e) => setAvailabilityOnly(e.target.checked)}
          />
          Available now
        </label>
      </SurfaceCard>

      {isLoading ? (
        <SurfaceCard className="p-6">
          <SkeletonRows rows={6} />
        </SurfaceCard>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No books match your filter"
          description="Try clearing your search or ask your library desk about upcoming book acquisitions."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((book) => (
            <SurfaceCard key={book.id} className="p-4 flex flex-col justify-between gap-4">
              <div className="flex gap-3.5">
                <img
                  src={book.coverImageUrl || '/src/assets/images/book_cover_computing_1795150811735.jpg'}
                  alt={book.title}
                  className="h-24 w-16 rounded-md object-cover border border-slate-200 dark:border-slate-800 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-white line-clamp-2">
                    {book.title}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {book.authorName || 'Institutional Author'}
                  </p>
                  <div className="mt-2 space-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <div className="font-mono">ISBN {book.isbn}</div>
                    {book.categoryName && <div>{book.categoryName}</div>}
                    {(book.rackCode || book.shelfCode) && (
                      <div>
                        Shelf: {book.rackCode}-{book.shelfCode} {book.sectionName ? `(${book.sectionName})` : ''}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="text-xs">
                  <span
                    className={`font-semibold tabular-nums ${
                      book.inventory.available > 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {book.inventory.available} / {book.inventory.total} available
                  </span>
                </div>
                <Button
                  size="sm"
                  variant={book.inventory.available > 0 ? 'outline' : 'primary'}
                  loading={reservingId === book.id}
                  onClick={() => handleReserve(book)}
                >
                  <Library className="h-3.5 w-3.5" />
                  Reserve
                </Button>
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}
    </div>
  );
}

// 4. MY BOOKS & ISSUE HISTORY
function StudentLoansPage() {
  const { data, isLoading } = useStudentDashboard();
  if (isLoading) {
    return (
      <SurfaceCard className="p-6">
        <SkeletonRows rows={5} />
      </SurfaceCard>
    );
  }
  const loansList = data?.loans || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
          My Books & Issue History
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Track active loans, due dates, renewals, and returned circulation receipts.
        </p>
      </div>

      <SurfaceCard className="overflow-hidden">
        {loansList.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No borrowing history yet"
              description="Books issued to your Digital ID at the circulation desk will appear here."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-xs font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-3">Book & Copy</th>
                  <th className="px-4 py-3">Receipt No.</th>
                  <th className="px-4 py-3">Issued</th>
                  <th className="px-4 py-3">Due / Returned</th>
                  <th className="px-4 py-3">Renewals</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {loansList.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">{l.bookTitle}</div>
                      <div className="font-mono text-slate-500">
                        Copy {l.barcode} · ISBN {l.bookIsbn}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono">{l.receiptNumber}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">{formatDate(l.issuedAt)}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      {l.returnedAt ? `Returned ${formatDate(l.returnedAt)}` : `Due ${formatDate(l.dueAt)}`}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">{l.renewalCount}</td>
                    <td className="px-4 py-3">
                      <StatusText status={l.isOverdue ? 'overdue' : l.status} />
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

// 5. RESERVATIONS
function StudentReservationsPage() {
  const { data, isLoading } = useStudentDashboard();
  const queryClient = useQueryClient();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const handleCancel = async (id: string) => {
    setCancellingId(id);
    try {
      await apiRequest(`/org/reservations/${id}/status`, {
        method: 'PATCH',
        body: { status: 'cancelled' },
      });
      toast.success('Reservation cancelled.');
      queryClient.invalidateQueries({ queryKey: ['student-dashboard'] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to cancel reservation.');
    } finally {
      setCancellingId(null);
    }
  };

  if (isLoading) {
    return (
      <SurfaceCard className="p-6">
        <SkeletonRows rows={5} />
      </SurfaceCard>
    );
  }
  const items = data?.reservations || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
            My Reservations
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Track your queue position and pickup deadlines for reserved titles.
          </p>
        </div>
        <Link to="/student/books">
          <Button variant="outline" size="sm">
            Reserve Another Book
          </Button>
        </Link>
      </div>

      <SurfaceCard className="overflow-hidden">
        {items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No active or past reservations"
              description="Reserve books directly from the Explore Catalog page to hold the next available copy."
            />
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{r.bookTitle}</div>
                  <div className="text-xs font-mono text-slate-500 mt-0.5">
                    Queue #{r.queuePosition} · ISBN {r.bookIsbn} · Requested {formatDate(r.createdAt)}
                  </div>
                  {r.expiresAt && r.status === 'ready' && (
                    <div className="text-xs text-blue-700 dark:text-blue-400 mt-1">
                      Ready at library desk — collect before {formatDate(r.expiresAt)}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <StatusText status={r.status} />
                  {(r.status === 'queued' || r.status === 'ready') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={cancellingId === r.id}
                      onClick={() => handleCancel(r.id)}
                      className="text-red-600 dark:text-red-400"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}

// 6. FINE HISTORY
function StudentFinesPage() {
  const { data, isLoading } = useStudentDashboard();
  if (isLoading) {
    return (
      <SurfaceCard className="p-6">
        <SkeletonRows rows={5} />
      </SurfaceCard>
    );
  }
  const items = data?.fines || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
          Fine History
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          View assessed library fines, counter payments, and waivers. Settle open balances at the library circulation desk.
        </p>
      </div>

      <SurfaceCard className="overflow-hidden">
        {items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Clean fine record"
              description="You have no overdue or damage fines on your library account."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Paid / Waived</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((f) => (
                  <tr key={f.id}>
                    <td className="px-4 py-3 font-mono text-slate-500 tabular-nums">
                      {formatDate(f.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-slate-900 dark:text-white">{f.reason}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{formatCurrency(f.amount)}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-500 tabular-nums">
                      {formatCurrency(Number(f.paidAmount) + Number(f.waivedAmount))}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                      {formatCurrency(f.balance)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={f.status} />
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

// 7. ATTENDANCE HISTORY
function StudentAttendancePage() {
  const { data, isLoading } = useStudentDashboard();
  if (isLoading) {
    return (
      <SurfaceCard className="p-6">
        <SkeletonRows rows={5} />
      </SurfaceCard>
    );
  }
  const visits = data?.attendance || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
          Library Attendance & Visit History
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Your recorded reading room and library desk check-ins.
        </p>
      </div>

      <SurfaceCard className="overflow-hidden">
        {visits.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No library visits logged yet"
              description="When your Digital ID QR is scanned at the library desk, your visit log appears here."
            />
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {visits.map((v) => (
              <div key={v.id} className="flex items-center justify-between px-5 py-3.5 text-xs">
                <div className="flex items-center gap-2.5">
                  <Calendar className="h-4 w-4 text-slate-400" />
                  <div>
                    <div className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                      {formatDateTime(v.checkInAt)}
                    </div>
                    {v.notes && <div className="text-slate-500 mt-0.5">{v.notes}</div>}
                  </div>
                </div>
                <span className="font-mono uppercase text-slate-500">{v.method}</span>
              </div>
            ))}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}

// 8. PROFILE & SUPPORT
function StudentProfilePage() {
  const { user, refreshSession } = useAuth();
  const { data } = useStudentDashboard();
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (user) {
      setFullName(user.fullName || '');
      setPhone(user.phone || '');
    }
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest('/auth/profile', {
        method: 'PATCH',
        body: { fullName: fullName.trim(), phone: phone.trim() || null },
      });
      await refreshSession();
      toast.success('Account contact details updated.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to update profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('New password and confirmation do not match.');
      return;
    }
    setChangingPassword(true);
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      toast.success('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Unable to change password.');
    } finally {
      setChangingPassword(false);
    }
  };

  const isFounder = Boolean(data?.linkedFounderIdentity);
  const isPremium = Boolean(data?.premiumStudent?.isPremium);
  const premiumPreset = isPremium ? getPremiumStudentDesign(data?.premiumStudent?.premiumDesign) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
          Profile &amp; Library Support
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Manage your account preferences, security, and official library helpdesk information.
        </p>
      </div>

      {/* Student Identity Header with Overlaid Founder / Premium Photo Badge */}
      {data && (
        <SurfaceCard className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="relative h-16 w-16 shrink-0">
              <div
                className={`h-16 w-16 overflow-hidden rounded-full flex items-center justify-center bg-slate-100 dark:bg-slate-800 ${
                  isFounder
                    ? 'border-2 border-[#D4AF37] ring-2 ring-[#D4AF37]/30'
                    : isPremium
                      ? 'border-2 border-blue-500'
                      : 'border border-slate-200 dark:border-slate-700'
                }`}
              >
                {data.student.photoUrl ? (
                  <img
                    src={data.student.photoUrl}
                    alt={data.student.fullName}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <User className="h-7 w-7 text-slate-400" />
                )}
              </div>
              {isFounder && (
                <div
                  title="Official QIVORA Golden Founder"
                  className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white dark:border-slate-900 bg-gradient-to-br from-[#FFF1B8] via-[#D4AF37] to-[#996515] text-[#0A0B0F] shadow-md"
                >
                  <Crown className="h-3.5 w-3.5 stroke-[2.5]" />
                </div>
              )}
              {!isFounder && isPremium && premiumPreset && (
                <div
                  title={`${premiumPreset.name} Premium Student`}
                  className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white dark:border-slate-900 text-white shadow-md"
                  style={{ backgroundColor: premiumPreset.secondaryAccent }}
                >
                  <Gem className="h-3.5 w-3.5" />
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                  {data.student.fullName}
                </h2>
                {isFounder && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#D4AF37]/70 bg-[#0A0B0F] px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase text-[#F6DF9C]">
                    <Crown className="h-3 w-3 text-[#D4AF37]" />
                    Official Founder
                  </span>
                )}
                {isPremium && premiumPreset && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase"
                    style={{
                      backgroundColor: `${premiumPreset.secondaryAccent}22`,
                      border: `1px solid ${premiumPreset.borderColor}`,
                      color: premiumPreset.secondaryAccent,
                    }}
                  >
                    <Gem className="h-3 w-3" />
                    {data.premiumStudent?.premiumBadgeLabel || premiumPreset.badgeLabel}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {data.branding?.collegeName} · ID <span className="font-mono">{data.student.studentIdCode}</span> · Roll{' '}
                <span className="font-mono">{data.student.collegeRollNumber}</span>
              </p>
              {data.student.courseName && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {[data.student.courseName, data.student.semesterName, data.student.sessionName]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </div>
          </div>
          <Link to="/student/digital-id">
            <Button variant="outline" size="sm">
              <CreditCard className="h-3.5 w-3.5" />
              Open Digital ID
            </Button>
          </Link>
        </SurfaceCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SurfaceCard className="p-5">
          <form onSubmit={handleSave} className="space-y-4">
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
              Account Contact Information
            </h2>
            <Field label="Display Name" required>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </Field>
            <Field label="Email Address" hint="Institutional email is managed by your library office.">
              <Input value={user?.email || ''} disabled />
            </Field>
            <Field label="Phone Number">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91..." />
            </Field>
            <Button type="submit" loading={saving}>
              <Save className="h-4 w-4" />
              Save Changes
            </Button>
          </form>
        </SurfaceCard>

        <SurfaceCard className="p-5">
          <form onSubmit={handleChangePassword} className="space-y-4">
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[#1E3A8A] dark:text-[#60A5FA]" />
              Change Account Password
            </h2>
            <Field label="Current Password" required>
              <Input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Field label="New Password" required hint="Must satisfy the platform security password policy.">
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
            <Button type="submit" loading={changingPassword}>
              <KeyRound className="h-4 w-4" />
              Update Password
            </Button>
          </form>
        </SurfaceCard>

        <SurfaceCard className="p-5 space-y-4 lg:col-span-2">
          <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
            Institution Library Helpdesk
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-slate-600 dark:text-slate-300">
            <div>
              <div className="font-semibold text-slate-900 dark:text-white">
                {data?.branding?.collegeName || 'Institutional Library'}
              </div>
              {data?.branding?.libraryContactDetails && (
                <p className="text-xs leading-relaxed mt-1">{data.branding.libraryContactDetails}</p>
              )}
            </div>
            <div className="space-y-2">
              {data?.branding?.address && (
                <div className="flex items-start gap-2 text-xs">
                  <MapPin className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                  <span>{data.branding.address}</span>
                </div>
              )}
              {data?.branding?.email && (
                <div className="flex items-center gap-2 text-xs">
                  <Mail className="h-4 w-4 text-slate-400 shrink-0" />
                  <span>{data.branding.email}</span>
                </div>
              )}
              {data?.branding?.contactNumber && (
                <div className="flex items-center gap-2 text-xs">
                  <Phone className="h-4 w-4 text-slate-400 shrink-0" />
                  <span>{data.branding.contactNumber}</span>
                </div>
              )}
            </div>
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}

export function StudentWorkspace() {
  return (
    <Routes>
      <Route index element={<StudentDashboardPage />} />
      <Route path="digital-id" element={<StudentDigitalIdPage />} />
      <Route path="books" element={<StudentExploreBooksPage />} />
      <Route path="loans" element={<StudentLoansPage />} />
      <Route path="reservations" element={<StudentReservationsPage />} />
      <Route path="fines" element={<StudentFinesPage />} />
      <Route path="attendance" element={<StudentAttendancePage />} />
      <Route path="notifications" element={<NotificationCenterPage />} />
      <Route path="profile" element={<StudentProfilePage />} />
      <Route path="*" element={<Navigate to="/student" replace />} />
    </Routes>
  );
}
