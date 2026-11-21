import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Award,
  Building2,
  Camera,
  CheckCircle2,
  Gem,
  Moon,
  Search,
  ShieldAlert,
  Sun,
} from 'lucide-react';
import { QivoraFooter, QivoraLogo } from '../../components/brand/QivoraLogo.tsx';
import { QrScannerModal } from '../../components/scanner/QrScannerModal.tsx';
import { Button, Input, SurfaceCard } from '../../components/ui/primitives.tsx';
import { useTheme } from '../../contexts/ThemeContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatDate } from '../../lib/utils.ts';
import { getPremiumStudentDesign } from '../../shared/security-and-tiers.ts';
import type {
  FounderBadgeSummary,
  LinkedCollegeMembership,
  PremiumStudentSummary,
} from '../../types/qivora.ts';

interface VerifyResult {
  verified: boolean;
  entityType?: 'student_id' | 'founder_id';
  status?: string;
  reason?: string;
  linkedCollege?: LinkedCollegeMembership | null;
  founderBadge?: FounderBadgeSummary | null;
  premiumStudent?: PremiumStudentSummary | null;
  credential?: Record<string, unknown> & {
    linkedCollege?: LinkedCollegeMembership | null;
    founderBadge?: FounderBadgeSummary | null;
    premiumStudent?: PremiumStudentSummary | null;
    collegeLinkStatus?: string;
  };
}

export function VerifyQrPage() {
  const { token: urlToken } = useParams();
  const navigate = useNavigate();
  const { resolvedTheme, toggleTheme } = useTheme();

  const [inputToken, setInputToken] = useState(urlToken || '');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const verifyToken = async (raw: string) => {
    const clean = raw.includes('/verify/') ? raw.split('/verify/').pop()?.trim() || raw.trim() : raw.trim();
    if (!clean) return;
    setLoading(true);
    try {
      const data = await apiRequest<VerifyResult>(`/verify/qr/${encodeURIComponent(clean)}`, {
        skipAuth: true,
      });
      setResult(data);
    } catch (err: unknown) {
      setResult({
        verified: false,
        reason: err instanceof Error ? err.message : 'Credential could not be verified.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (urlToken) {
      setInputToken(urlToken);
      verifyToken(urlToken);
    }
  }, [urlToken]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = inputToken.includes('/verify/')
      ? inputToken.split('/verify/').pop()?.trim() || inputToken.trim()
      : inputToken.trim();
    if (!clean) return;
    navigate(`/verify/${encodeURIComponent(clean)}`);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1120] py-8 px-4 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <Link to="/login" className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Sign In
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

        <SurfaceCard className="p-6 sm:p-8 space-y-5">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              QIVORA Unified Credential Verification
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Scan an official College Digital ID or Golden Founder ID QR code to verify real-time
              status and linked library membership. Only approved public fields are displayed.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5">
            <Input
              value={inputToken}
              onChange={(e) => setInputToken(e.target.value)}
              placeholder="Paste QR verification token or scan QR code..."
              className="font-mono text-xs"
            />
            <Button type="button" variant="outline" onClick={() => setScannerOpen(true)}>
              <Camera className="h-4 w-4" />
              Scan QR
            </Button>
            <Button type="submit" loading={loading}>
              <Search className="h-4 w-4" />
              Verify
            </Button>
          </form>

          {result && (
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
              {result.verified && result.entityType === 'founder_id' && result.credential ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-[#D4AF37]/60 bg-[#0A0B0F] p-6 text-[#F6DF9C] space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-semibold tracking-wider uppercase text-[#D4AF37]">
                        <Award className="h-4 w-4" />
                        <span>{String(result.credential.editionName)}</span>
                      </div>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-400">
                        Verified Creator
                      </span>
                    </div>
                    <div>
                      <h2 className="font-display text-xl font-bold">
                        {String(result.credential.fullName)}
                      </h2>
                      <p className="text-sm text-[#D4AF37]">
                        {String(result.credential.designation)} · {String(result.credential.organizationLabel)}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 border-t border-[#D4AF37]/25 pt-4 text-xs">
                      <div>
                        <span className="text-[#9A834B]">Founder Number</span>
                        <div className="font-mono font-semibold mt-0.5">
                          {String(result.credential.founderNumber)}
                        </div>
                      </div>
                      <div>
                        <span className="text-[#9A834B]">Issued</span>
                        <div className="font-mono font-semibold mt-0.5">
                          {formatDate(String(result.credential.issuedAt))}
                        </div>
                      </div>
                    </div>

                    {(() => {
                      const linkedCollege =
                        result.linkedCollege || result.credential?.linkedCollege || null;
                      if (!linkedCollege) return null;
                      return (
                        <div className="rounded-xl border border-[#D4AF37]/35 bg-[#141720] p-4 space-y-2.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-[10px] text-[#D4AF37]">
                              <Building2 className="h-3.5 w-3.5" />
                              <span>Verified College Library Membership</span>
                            </div>
                            <span className="font-mono text-[10px] uppercase text-emerald-400">
                              {linkedCollege.membershipStatus}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                            <div>
                              <div className="text-[#9A834B]">College</div>
                              <div className="font-semibold text-[#F6DF9C] mt-0.5">
                                {linkedCollege.collegeName}
                              </div>
                            </div>
                            <div>
                              <div className="text-[#9A834B]">Official Student ID / Roll</div>
                              <div className="font-mono text-[#F6DF9C] mt-0.5 tabular-nums">
                                {linkedCollege.studentIdCode} · Roll {linkedCollege.collegeRollNumber}
                              </div>
                            </div>
                            <div>
                              <div className="text-[#9A834B]">Course &amp; Semester</div>
                              <div className="text-[#F6DF9C] mt-0.5">
                                {[linkedCollege.courseName, linkedCollege.semesterName]
                                  .filter(Boolean)
                                  .join(' · ') || '—'}
                              </div>
                            </div>
                            <div>
                              <div className="text-[#9A834B]">Academic Session</div>
                              <div className="font-mono text-[#F6DF9C] mt-0.5 tabular-nums">
                                {linkedCollege.academicSession || '—'}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    <p className="text-[11px] text-[#A8925C]">
                      Verified QIVORA Creator Identity Credential. Library circulation rules, borrowing
                      limits, fines, and administrative permissions remain strictly governed by institutional
                      policies.
                    </p>
                  </div>
                </div>
              ) : result.verified && result.credential ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2.5 text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="font-display font-semibold text-sm">
                        Official Digital ID Verified Active
                      </span>
                    </div>
                  </div>

                  {(() => {
                    const founderBadge =
                      result.founderBadge || result.credential?.founderBadge || null;
                    if (!founderBadge) return null;
                    return (
                      <div className="rounded-xl border border-[#D4AF37]/60 bg-[#0A0B0F] px-4 py-3 text-[#F6DF9C] flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Award className="h-5 w-5 text-[#D4AF37] shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[#F6DF9C]">
                              Verified QIVORA Founder · {founderBadge.designation}
                            </div>
                            <div className="font-mono text-[11px] text-[#C8A24B]">
                              {founderBadge.founderNumber} · {founderBadge.organizationLabel}
                            </div>
                          </div>
                        </div>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-[#D4AF37] shrink-0">
                          Linked ID
                        </span>
                      </div>
                    );
                  })()}

                  {(() => {
                    const premium =
                      result.premiumStudent || result.credential?.premiumStudent || null;
                    if (!premium?.isPremium) return null;
                    const preset = getPremiumStudentDesign(premium.premiumDesign);
                    return (
                      <div
                        className="rounded-xl px-4 py-3 flex items-center justify-between gap-3"
                        style={{
                          background: preset.cardBgGradient,
                          border: `1px solid ${preset.borderColor}88`,
                          color: preset.textColor,
                        }}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Gem className="h-5 w-5 shrink-0" style={{ color: preset.accentColor }} />
                          <div className="min-w-0">
                            <div className="text-xs font-bold">
                              {premium.premiumBadgeLabel || preset.badgeLabel} · {preset.name}
                            </div>
                            <div className="text-[11px]" style={{ color: preset.mutedTextColor }}>
                              Verified Premium Student Digital ID (Non-Founder Tier)
                            </div>
                          </div>
                        </div>
                        <span
                          className="font-mono text-[10px] uppercase tracking-wider shrink-0"
                          style={{ color: preset.accentColor }}
                        >
                          Premium
                        </span>
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-xs">
                    <div>
                      <div className="text-slate-500">Student Name</div>
                      <div className="mt-0.5 font-semibold text-slate-900 dark:text-white text-sm">
                        {String(result.credential.studentName)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Institution</div>
                      <div className="mt-0.5 font-semibold text-slate-900 dark:text-white">
                        {String(result.credential.collegeName)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Student ID</div>
                      <div className="mt-0.5 font-mono tabular-nums">
                        {String(result.credential.studentIdCode)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">College Roll Number</div>
                      <div className="mt-0.5 font-mono tabular-nums">
                        {String(result.credential.collegeRollNumber)}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Course &amp; Semester</div>
                      <div className="mt-0.5">
                        {[result.credential.courseName, result.credential.semesterName]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Valid Until</div>
                      <div className="mt-0.5 font-mono tabular-nums">
                        {formatDate(String(result.credential.expiresAt))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-900/50 dark:bg-red-950/30">
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-display font-semibold text-sm">
                    <ShieldAlert className="h-5 w-5" />
                    <span>Credential Not Active or Invalid</span>
                  </div>
                  <p className="mt-1.5 text-xs text-red-700/90 dark:text-red-300">
                    {result.reason || 'This credential could not be verified as active.'}
                  </p>
                </div>
              )}
            </div>
          )}
        </SurfaceCard>
        <QivoraFooter className="pt-4" />
      </div>

      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        title="Scan Digital ID QR Code"
        onScan={(scanned) => {
          const clean = scanned.includes('/verify/')
            ? scanned.split('/verify/').pop()?.trim() || scanned
            : scanned;
          setInputToken(clean);
          navigate(`/verify/${encodeURIComponent(clean)}`);
        }}
      />
    </div>
  );
}
