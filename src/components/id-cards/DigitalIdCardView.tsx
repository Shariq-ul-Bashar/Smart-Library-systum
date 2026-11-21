import { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import { Crown, Download, ExternalLink, Gem, Printer, RotateCw, ShieldCheck, Sparkles, User } from 'lucide-react';
import QRCode from 'qrcode';
import type { IdTemplateBackConfig, IdTemplateFrontConfig } from '../../shared/id-presets.ts';
import { getPremiumStudentDesign } from '../../shared/security-and-tiers.ts';
import type { LinkedCollegeMembership } from '../../types/qivora.ts';
import { cn, formatDate } from '../../lib/utils.ts';
import { QivoraLogo } from '../brand/QivoraLogo.tsx';
import { Button } from '../ui/primitives.tsx';

export interface DigitalIdRenderData {
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
  student: {
    fullName: string;
    fatherName: string;
    studentIdCode: string;
    collegeRollNumber: string;
    courseName?: string | null;
    semesterName?: string | null;
    sessionName?: string | null;
    photoUrl?: string | null;
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
    idCardInstructions?: string | null;
  };
  template: {
    name: string;
    frontConfig: IdTemplateFrontConfig;
    backConfig: IdTemplateBackConfig;
    backgroundImageUrl?: string | null;
  };
}

export function DigitalIdCardView({
  data,
  showActions = true,
  initialSide = 'front',
  compact = false,
}: {
  data: DigitalIdRenderData;
  showActions?: boolean;
  initialSide?: 'front' | 'back';
  compact?: boolean;
}) {
  const [side, setSide] = useState<'front' | 'back'>(initialSide);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  const verifyUrl = data.qrToken
    ? `${window.location.origin}/verify/${data.qrToken}`
    : `${window.location.origin}/verify`;

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(verifyUrl, {
      width: 180,
      margin: 1,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [verifyUrl]);

  const fc = data.template.frontConfig;
  const bc = data.template.backConfig;

  const activeBgUrl = data.customBgUrl || data.template.backgroundImageUrl || null;
  const bgFit = data.customBgUrl ? data.customBgSettings?.fit || 'cover' : fc.bgFit || 'cover';
  const bgZoom = data.customBgUrl ? data.customBgSettings?.zoom || 1 : fc.bgZoom || 1;
  const bgX = data.customBgUrl ? data.customBgSettings?.positionX ?? 50 : fc.bgPositionX ?? 50;
  const bgY = data.customBgUrl ? data.customBgSettings?.positionY ?? 50 : fc.bgPositionY ?? 50;
  const overlayOpacity = data.customBgUrl
    ? data.customBgSettings?.overlayOpacity ?? 0.25
    : fc.bgOverlayOpacity ?? 0;

  const isDarkCard =
    fc.backgroundColor.toLowerCase().startsWith('#0') ||
    fc.backgroundColor.toLowerCase().startsWith('#1');

  const handleDownloadPdf = () => {
    const doc = new jsPDF({ unit: 'mm', format: [85.6, 134] });
    // Front page
    doc.setFillColor(fc.backgroundColor || '#FFFFFF');
    doc.rect(0, 0, 85.6, 134, 'F');
    doc.setFillColor(fc.secondaryColor || '#1E3A8A');
    doc.rect(0, 0, 85.6, 26, 'F');

    doc.setTextColor('#FFFFFF');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(data.branding.collegeName || 'QIVORA Institution', 42.8, 12, {
      align: 'center',
      maxWidth: 74,
    });
    if (data.branding.universityName) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.text(data.branding.universityName, 42.8, 19, { align: 'center', maxWidth: 74 });
    }

    doc.setTextColor(fc.textColor || '#0F172A');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(data.student.fullName, 42.8, 42, { align: 'center', maxWidth: 76 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(`S/O / D/O: ${data.student.fatherName}`, 42.8, 48, { align: 'center' });

    const fields = [
      ['Student ID', data.student.studentIdCode],
      ['College Roll No.', data.student.collegeRollNumber],
      ['Course', data.student.courseName || '—'],
      ['Semester', data.student.semesterName || '—'],
      ['Academic Session', data.student.sessionName || '—'],
      ['Card No.', data.cardNumber],
    ];
    let y = 58;
    fields.forEach(([k, v]) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(fc.mutedTextColor || '#475569');
      doc.text(k, 8, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(fc.textColor || '#0F172A');
      doc.text(String(v), 36, y, { maxWidth: 44 });
      y += 6.5;
    });

    if (qrDataUrl) {
      doc.addImage(qrDataUrl, 'PNG', 55, 98, 22, 22);
    }
    doc.setFontSize(6.5);
    doc.setTextColor(fc.mutedTextColor || '#475569');
    doc.text('QIVORA VERIFIED ID', 8, 114);
    doc.text(`Status: ${data.status.toUpperCase()}`, 8, 119);

    // Back page
    doc.addPage([85.6, 134]);
    doc.setFillColor(bc.backgroundColor || '#FFFFFF');
    doc.rect(0, 0, 85.6, 134, 'F');
    doc.setFillColor(bc.accentColor || '#1E3A8A');
    doc.rect(0, 0, 85.6, 14, 'F');
    doc.setTextColor('#FFFFFF');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(bc.customHeaderText || 'OFFICIAL LIBRARY IDENTITY', 42.8, 9, { align: 'center' });

    doc.setTextColor(bc.textColor || '#0F172A');
    doc.setFontSize(7.5);
    let by = 24;
    if (data.branding.address) {
      doc.setFont('helvetica', 'bold');
      doc.text('Institution Address:', 8, by);
      by += 4.5;
      doc.setFont('helvetica', 'normal');
      doc.text(data.branding.address, 8, by, { maxWidth: 70 });
      by += 12;
    }
    doc.setFont('helvetica', 'bold');
    doc.text('Contact:', 8, by);
    doc.setFont('helvetica', 'normal');
    doc.text(
      [data.branding.contactNumber, data.branding.email].filter(Boolean).join(' · ') || '—',
      8,
      by + 4.5,
      { maxWidth: 70 }
    );
    by += 14;
    doc.setFont('helvetica', 'bold');
    doc.text(`Issued: ${formatDate(data.issuedAt)}`, 8, by);
    doc.text(`Valid Until: ${formatDate(data.expiresAt)}`, 8, by + 5);
    by += 14;
    if (data.branding.idCardInstructions) {
      doc.setFont('helvetica', 'bold');
      doc.text('Instructions:', 8, by);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.text(data.branding.idCardInstructions, 8, by + 4.5, { maxWidth: 70 });
    }
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(data.branding.authorizedSignatoryName || 'Authorized Signatory', 8, 118);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    doc.text(bc.customFooterText || 'QIVORA · Intelligence for Every Library.', 8, 127);

    doc.save(`${data.cardNumber}-${data.student.collegeRollNumber}.pdf`);
  };

  const photoRadius =
    fc.photoShape === 'circle'
      ? 'rounded-full'
      : fc.photoShape === 'square'
        ? 'rounded-sm'
        : 'rounded-xl';

  const headerBgStyle =
    fc.headerStyle === 'gradient'
      ? { background: `linear-gradient(135deg, ${fc.secondaryColor}, ${fc.accentColor})` }
      : fc.headerStyle === 'minimal'
        ? { backgroundColor: 'transparent', borderBottom: `1px solid ${fc.accentColor}30` }
        : { backgroundColor: fc.secondaryColor };

  const headerIsLight = fc.headerStyle === 'minimal' && !isDarkCard;

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className={cn(
          'print-area relative overflow-hidden rounded-2xl shadow-lg transition-all select-none',
          compact ? 'w-[300px]' : 'w-[336px] sm:w-[356px]',
          fc.borderStyle === 'double'
            ? 'ring-2 ring-offset-2 ring-slate-300 dark:ring-slate-700'
            : 'border border-slate-300/80 dark:border-slate-700'
        )}
        style={{
          fontFamily: fc.fontFamily,
          backgroundColor: side === 'front' ? fc.backgroundColor : bc.backgroundColor,
          color: side === 'front' ? fc.textColor : bc.textColor,
          minHeight: compact ? '470px' : '520px',
        }}
      >
        {side === 'front' ? (
          <div className="relative flex h-full min-h-[520px] flex-col justify-between">
            {/* Background image layer (custom or template) */}
            {activeBgUrl && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <img
                  src={activeBgUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-full w-full"
                  style={{
                    objectFit: bgFit === 'fill' ? 'fill' : bgFit,
                    objectPosition: `${bgX}% ${bgY}%`,
                    transform: `scale(${bgZoom})`,
                  }}
                />
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundColor: isDarkCard ? '#000000' : '#FFFFFF',
                    opacity: overlayOpacity,
                  }}
                />
              </div>
            )}

            {/* Header Band */}
            <div
              className="relative z-10 px-4 py-3.5"
              style={headerBgStyle}
            >
              <div
                className={cn(
                  'flex items-center gap-2.5',
                  fc.logoPosition === 'center'
                    ? 'flex-col text-center'
                    : fc.logoPosition === 'split'
                      ? 'justify-between'
                      : 'justify-start'
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {data.branding.collegeLogoUrl ? (
                    <img
                      src={data.branding.collegeLogoUrl}
                      alt={data.branding.collegeName}
                      referrerPolicy="no-referrer"
                      className="h-9 w-9 rounded-lg object-contain bg-white/95 p-0.5 shrink-0"
                    />
                  ) : (
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-display text-xs font-bold"
                      style={{
                        backgroundColor: headerIsLight ? fc.accentColor : 'rgba(255,255,255,0.16)',
                        color: '#FFFFFF',
                      }}
                    >
                      {(data.branding.collegeName || 'CL').slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div
                      className="text-xs font-bold leading-tight truncate"
                      style={{ color: headerIsLight ? fc.textColor : '#FFFFFF' }}
                    >
                      {data.branding.collegeName}
                    </div>
                    {data.branding.universityName && (
                      <div
                        className="text-[10px] leading-tight truncate mt-0.5"
                        style={{
                          color: headerIsLight ? fc.mutedTextColor : 'rgba(255,255,255,0.82)',
                        }}
                      >
                        {data.branding.universityName}
                      </div>
                    )}
                  </div>
                </div>

                {fc.showUniversityLogo && data.branding.universityLogoUrl && (
                  <img
                    src={data.branding.universityLogoUrl}
                    alt={data.branding.universityName || 'University'}
                    referrerPolicy="no-referrer"
                    className="h-8 w-8 rounded-md object-contain bg-white/95 p-0.5 shrink-0"
                  />
                )}
              </div>
            </div>

            {/* Body: Student Photo + Official Identity Details */}
            <div className="relative z-10 flex flex-1 flex-col items-center px-5 pt-4 pb-3">
              <div
                className={cn(
                  'h-24 w-24 overflow-hidden border-2 bg-slate-100 flex items-center justify-center shrink-0',
                  photoRadius
                )}
                style={{ borderColor: fc.accentColor }}
              >
                {data.student.photoUrl ? (
                  <img
                    src={data.student.photoUrl}
                    alt={data.student.fullName}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <User className="h-10 w-10 text-slate-400" />
                )}
              </div>

              <h3 className="mt-3 text-center text-base font-bold leading-snug">
                {data.student.fullName}
              </h3>
              {fc.showFatherName && (
                <p
                  className="text-[11px] text-center mt-0.5"
                  style={{ color: fc.mutedTextColor }}
                >
                  S/O · D/O {data.student.fatherName}
                </p>
              )}

              <div className="mt-4 w-full space-y-1.5 text-xs">
                <div className="flex justify-between gap-2 border-b border-current/10 pb-1">
                  <span style={{ color: fc.mutedTextColor }}>Student ID</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {data.student.studentIdCode}
                  </span>
                </div>
                <div className="flex justify-between gap-2 border-b border-current/10 pb-1">
                  <span style={{ color: fc.mutedTextColor }}>College Roll No.</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {data.student.collegeRollNumber}
                  </span>
                </div>
                <div className="flex justify-between gap-2 border-b border-current/10 pb-1">
                  <span style={{ color: fc.mutedTextColor }}>Course</span>
                  <span className="font-medium text-right truncate max-w-[180px]">
                    {data.student.courseName || '—'}
                  </span>
                </div>
                <div className="flex justify-between gap-2 border-b border-current/10 pb-1">
                  <span style={{ color: fc.mutedTextColor }}>Semester</span>
                  <span className="font-medium">{data.student.semesterName || '—'}</span>
                </div>
                {fc.showSession && (
                  <div className="flex justify-between gap-2">
                    <span style={{ color: fc.mutedTextColor }}>Academic Session</span>
                    <span className="font-mono tabular-nums">
                      {data.student.sessionName || '—'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Footer with Scannable QR Token */}
            <div
              className="relative z-10 flex items-center justify-between gap-3 px-4 py-3 border-t border-current/10"
              style={{ backgroundColor: isDarkCard ? 'rgba(0,0,0,0.28)' : 'rgba(15,23,42,0.03)' }}
            >
              <div className="min-w-0">
                <div className="text-[10px] font-mono font-semibold tracking-wider uppercase opacity-80">
                  {data.cardNumber}
                </div>
                <div className="mt-1 flex items-center gap-1 text-[11px] font-semibold">
                  <ShieldCheck className="h-3.5 w-3.5" style={{ color: fc.accentColor }} />
                  <span className="capitalize">{data.status}</span>
                </div>
                <div className="mt-0.5 text-[10px] opacity-65">QIVORA Digital Identity</div>
              </div>
              <div className="rounded-lg bg-white p-1.5 shadow-sm shrink-0">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="Verification QR" className="h-16 w-16" />
                ) : (
                  <div className="h-16 w-16 bg-slate-100" />
                )}
              </div>
            </div>
          </div>
        ) : (
          /* BACK SIDE */
          <div className="flex h-full min-h-[520px] flex-col justify-between">
            <div
              className="px-4 py-3 text-center text-[11px] font-bold tracking-wider uppercase text-white"
              style={{ backgroundColor: bc.accentColor }}
            >
              {bc.customHeaderText || 'OFFICIAL LIBRARY & CAMPUS IDENTITY'}
            </div>

            <div className="flex-1 space-y-4 px-5 py-5 text-xs">
              {bc.showAddress && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider opacity-60">
                    Institution Address
                  </div>
                  <p className="mt-1 leading-relaxed">
                    {data.branding.address || 'Registered Campus Address'}
                  </p>
                </div>
              )}

              {bc.showContact && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider opacity-60">
                    Library & Contact Details
                  </div>
                  <p className="mt-1">
                    {[data.branding.contactNumber, data.branding.email, data.branding.website]
                      .filter(Boolean)
                      .join(' · ') || 'Contact Library Office'}
                  </p>
                </div>
              )}

              {bc.showIssueExpiry && (
                <div className="grid grid-cols-2 gap-3 rounded-lg border border-current/15 p-3">
                  <div>
                    <div className="text-[10px] opacity-60">Issue Date</div>
                    <div className="mt-0.5 font-mono font-semibold tabular-nums">
                      {formatDate(data.issuedAt)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] opacity-60">Expiry Date</div>
                    <div className="mt-0.5 font-mono font-semibold tabular-nums">
                      {formatDate(data.expiresAt)}
                    </div>
                  </div>
                </div>
              )}

              {bc.showInstructions && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider opacity-60">
                    Important Instructions
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed opacity-85">
                    {data.branding.idCardInstructions ||
                      'This official digital ID card is non-transferable and remains the property of the institution.'}
                  </p>
                </div>
              )}

              {bc.showVerificationNote && (
                <div className="rounded-lg border border-current/10 p-2.5 text-[11px] opacity-80">
                  Scan the front QR code to verify real-time credential validity in the QIVORA registry.
                </div>
              )}
            </div>

            <div className="border-t border-current/10 px-5 py-4">
              {bc.showSignature && (
                <div className="flex items-end justify-between gap-3">
                  <div>
                    {data.branding.authorizedSignatureUrl ? (
                      <img
                        src={data.branding.authorizedSignatureUrl}
                        alt="Authorized signature"
                        referrerPolicy="no-referrer"
                        className="h-8 object-contain"
                      />
                    ) : (
                      <div className="h-7 w-28 border-b border-current/40" />
                    )}
                    <div className="mt-1 text-[10px] font-semibold">
                      {data.branding.authorizedSignatoryName || 'Authorized Signatory'}
                    </div>
                  </div>
                  <div className="text-right text-[10px] opacity-70">
                    <div className="font-semibold">QIVORA</div>
                    <div>Intelligence for Every Library.</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showActions && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSide(side === 'front' ? 'back' : 'front')}>
            <RotateCw className="h-3.5 w-3.5" />
            {side === 'front' ? 'View Back' : 'View Front'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadPdf}>
            <Download className="h-3.5 w-3.5" />
            Download PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" />
            Print
          </Button>
          {data.qrToken && (
            <a
              href={`/verify/${data.qrToken}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Verify QR
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// QIVORA — GOLDEN FOUNDER EDITION CARD (Linked Creator + College Identity)
// ============================================================================

export interface FounderCardData {
  id: string;
  founderNumber: string;
  fullName: string;
  designation: string;
  organizationLabel: string;
  photoUrl?: string | null;
  editionName: string;
  bio?: string | null;
  status: string;
  issuedAt: string;
  qrToken?: string | null;
  linkedOrganizationId?: string | null;
  linkedStudentId?: string | null;
  collegeLinkStatus?: 'unlinked' | 'pending_college_approval' | 'approved' | 'revoked' | string;
  linkedCollege?: LinkedCollegeMembership | null;
}

export function FounderIdCardView({
  founder,
  showActions = true,
}: {
  founder: FounderCardData;
  showActions?: boolean;
}) {
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [qrUrl, setQrUrl] = useState('');

  const verifyUrl = founder.qrToken
    ? `${window.location.origin}/verify/${founder.qrToken}`
    : `${window.location.origin}/verify`;

  const linkedCollege = founder.linkedCollege;
  const isCollegeApproved =
    founder.collegeLinkStatus === 'approved' && Boolean(linkedCollege);

  useEffect(() => {
    QRCode.toDataURL(verifyUrl, {
      width: 180,
      margin: 1,
      color: { dark: '#0B0D12', light: '#F4D57E' },
    })
      .then(setQrUrl)
      .catch(() => {});
  }, [verifyUrl]);

  const downloadFounderPdf = () => {
    const doc = new jsPDF({ unit: 'mm', format: [85.6, 134] });
    // Front Side
    doc.setFillColor(10, 11, 15);
    doc.rect(0, 0, 85.6, 134, 'F');
    doc.setDrawColor(212, 175, 55);
    doc.setLineWidth(0.6);
    doc.rect(3.5, 3.5, 78.6, 127, 'S');
    doc.setTextColor(232, 196, 104);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('QIVORA', 42.8, 15, { align: 'center' });
    doc.setFontSize(6.2);
    doc.text(founder.editionName.replace(/SHARIXA/gi, 'QIVORA'), 42.8, 21, { align: 'center' });
    doc.setFontSize(12.5);
    doc.text(founder.fullName, 42.8, 39, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(founder.designation, 42.8, 45.5, { align: 'center' });
    doc.setFontSize(7.2);
    doc.text(founder.organizationLabel, 42.8, 51, { align: 'center' });
    doc.text(`ID: ${founder.founderNumber}`, 42.8, 60, { align: 'center' });
    doc.text(`Status: ${founder.status.toUpperCase()}`, 42.8, 65.5, { align: 'center' });

    if (isCollegeApproved && linkedCollege) {
      doc.setDrawColor(212, 175, 55);
      doc.setLineWidth(0.25);
      doc.roundedRect(9, 70, 67.6, 18, 1.5, 1.5, 'S');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.2);
      doc.text('LINKED COLLEGE LIBRARY MEMBERSHIP', 42.8, 74.8, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.text(linkedCollege.collegeName, 42.8, 79.5, { align: 'center', maxWidth: 63 });
      doc.setFontSize(6.2);
      doc.text(
        `${linkedCollege.studentIdCode} · Roll ${linkedCollege.collegeRollNumber}`,
        42.8,
        84.5,
        { align: 'center' }
      );
    }

    if (qrUrl) {
      doc.addImage(qrUrl, 'PNG', 31.3, 92, 23, 23);
    }
    doc.setFontSize(5.8);
    doc.text('VERIFIED CREATOR CREDENTIAL · UNIFIED QR', 42.8, 121.5, { align: 'center' });
    doc.setFontSize(5.2);
    doc.text('Designed & Developed by MOHAMMAD SHARIQ', 42.8, 126.5, { align: 'center' });

    // Back Side
    doc.addPage([85.6, 134]);
    doc.setFillColor(10, 11, 15);
    doc.rect(0, 0, 85.6, 134, 'F');
    doc.setDrawColor(212, 175, 55);
    doc.setLineWidth(0.6);
    doc.rect(3.5, 3.5, 78.6, 127, 'S');
    doc.setTextColor(232, 196, 104);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('OFFICIAL CREATOR & LIBRARY VERIFICATION', 42.8, 16, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.text(
      founder.bio ||
        'This Golden Founder Edition credential certifies the verified creator identity in the QIVORA registry.',
      10,
      25,
      { maxWidth: 65.6 }
    );

    let y = 46;
    const backRows: Array<[string, string]> = [
      ['Founder No.', founder.founderNumber],
      ['Issued On', formatDate(founder.issuedAt)],
      ['College Link', (founder.collegeLinkStatus || 'unlinked').replace(/_/g, ' ').toUpperCase()],
    ];
    if (linkedCollege) {
      backRows.push(
        ['College', linkedCollege.collegeName],
        ['Student ID', linkedCollege.studentIdCode],
        ['Roll Number', linkedCollege.collegeRollNumber],
        ['Course', linkedCollege.courseName || '—'],
        ['Semester', linkedCollege.semesterName || '—'],
        ['Session', linkedCollege.academicSession || '—'],
        ['Membership', linkedCollege.membershipStatus.toUpperCase()]
      );
    }
    backRows.forEach(([label, val]) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.3);
      doc.text(label, 10, y);
      doc.setFont('helvetica', 'normal');
      doc.text(String(val), 34, y, { maxWidth: 42 });
      y += 6;
    });

    doc.setFontSize(5.5);
    doc.text(
      'Security Policy: Founder status never bypasses college library borrowing limits, fines, or tenant isolation.',
      10,
      116,
      { maxWidth: 65.6 }
    );
    doc.text('QIVORA · BCA 1st Year | 2026–2027 Batch', 42.8, 126.5, { align: 'center' });
    doc.save(`${founder.founderNumber}.pdf`);
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="print-area relative w-[352px] min-h-[544px] overflow-hidden rounded-2xl border-2 border-[#D4AF37]/80 bg-[#0A0B0F] text-[#F3D98B] shadow-2xl"
        style={{
          backgroundImage:
            'radial-gradient(circle at 18% 12%, rgba(212,175,55,0.22), transparent 46%), radial-gradient(circle at 86% 88%, rgba(244,213,126,0.16), transparent 44%), linear-gradient(155deg, #12141D 0%, #090A0E 55%, #17130B 100%)',
        }}
      >
        {/* Ornate metallic gold double inner frame */}
        <div className="pointer-events-none absolute inset-2.5 rounded-xl border border-[#D4AF37]/45" />
        <div className="pointer-events-none absolute inset-x-6 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#F6DF9C] to-transparent opacity-80" />

        {side === 'front' ? (
          <div className="relative z-10 flex min-h-[544px] flex-col justify-between p-6">
            <div className="flex items-start justify-between">
              <QivoraLogo size="sm" variant="gold" />
              <span className="inline-flex items-center gap-1 rounded-full border border-[#D4AF37]/50 bg-[#D4AF37]/15 px-2 py-0.5 font-mono text-[9.5px] font-semibold tracking-[0.16em] text-[#F6DF9C] uppercase">
                <Crown className="h-2.5 w-2.5 text-[#F4D57E]" />
                {founder.status}
              </span>
            </div>

            <div className="mt-3 text-center">
              <div className="text-[10px] font-semibold tracking-[0.24em] text-[#D4AF37] uppercase">
                {founder.editionName.replace(/SHARIXA/gi, 'QIVORA')}
              </div>

              {/* Portrait with Overlaid Golden Founder Crown Seal Badge */}
              <div className="relative mx-auto mt-3.5 h-24 w-24">
                <div className="h-24 w-24 overflow-hidden rounded-full border-[2.5px] border-[#F4D57E] bg-[#141720] shadow-[0_0_24px_rgba(212,175,55,0.35)] ring-2 ring-[#D4AF37]/40 ring-offset-2 ring-offset-[#0A0B0F] flex items-center justify-center">
                  {founder.photoUrl || linkedCollege?.photoUrl ? (
                    <img
                      src={founder.photoUrl || linkedCollege?.photoUrl || ''}
                      alt={founder.fullName}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <User className="h-9 w-9 text-[#C8A24B]" />
                  )}
                </div>
                <div
                  title="Verified QIVORA Founder"
                  className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#0A0B0F] bg-gradient-to-br from-[#FFF1B8] via-[#D4AF37] to-[#996515] text-[#0A0B0F] shadow-lg"
                >
                  <Crown className="h-4 w-4 stroke-[2.4]" />
                </div>
              </div>

              <div className="mt-2.5 inline-flex items-center gap-1 rounded-full border border-[#D4AF37]/60 bg-gradient-to-r from-[#D4AF37]/25 via-[#F6DF9C]/20 to-[#D4AF37]/25 px-2.5 py-0.5 text-[9.5px] font-bold tracking-[0.2em] text-[#F6DF9C] uppercase">
                <Sparkles className="h-2.5 w-2.5 text-[#F4D57E]" />
                OFFICIAL FOUNDER
              </div>

              <h3 className="mt-2.5 font-display text-xl font-bold tracking-wide text-[#F6DF9C]">
                {founder.fullName}
              </h3>
              <p className="mt-0.5 text-xs font-medium text-[#D4AF37]">{founder.designation}</p>
              <p className="mt-0.5 text-[11px] text-[#A8925C]">{founder.organizationLabel}</p>

              {isCollegeApproved && linkedCollege && (
                <div className="mt-3 rounded-xl border border-[#D4AF37]/35 bg-[#151822]/90 px-3 py-2 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#D4AF37]">
                      College Library Linked
                    </span>
                    <span className="font-mono text-[9px] uppercase text-emerald-400">
                      {linkedCollege.membershipStatus}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] font-semibold text-[#F6DF9C] truncate">
                    {linkedCollege.collegeName}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-[#C7B482] tabular-nums">
                    {linkedCollege.studentIdCode} · Roll {linkedCollege.collegeRollNumber}
                  </div>
                  {(linkedCollege.courseName || linkedCollege.semesterName) && (
                    <div className="text-[10px] text-[#A8925C] truncate">
                      {[linkedCollege.courseName, linkedCollege.semesterName, linkedCollege.academicSession]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-4 flex items-end justify-between border-t border-[#D4AF37]/25 pt-3.5">
              <div>
                <div className="text-[9px] uppercase tracking-[0.2em] text-[#9A834B]">
                  Founder Registry No.
                </div>
                <div className="mt-0.5 font-mono text-xs font-semibold text-[#F6DF9C] tabular-nums">
                  {founder.founderNumber}
                </div>
                <div className="mt-1.5 text-[10px] text-[#C8A24B]">
                  {isCollegeApproved
                    ? 'Unified Creator & College QR'
                    : 'Verified Creator Designation'}
                </div>
              </div>
              <div className="rounded-lg border border-[#D4AF37]/60 bg-[#F4D57E] p-1">
                {qrUrl ? (
                  <img src={qrUrl} alt="Founder QR" className="h-16 w-16" />
                ) : (
                  <div className="h-16 w-16" />
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="relative z-10 flex min-h-[536px] flex-col justify-between p-6">
            <div>
              <div className="text-[10px] font-semibold tracking-[0.22em] text-[#C8A24B] uppercase">
                {founder.editionName.replace(/SHARIXA/gi, 'QIVORA')}
              </div>
              <h4 className="mt-1.5 font-display text-base font-semibold text-[#F6DF9C]">
                Official Creator &amp; Library Identity
              </h4>
              <p className="mt-2 text-xs leading-relaxed text-[#C7B482]">
                {founder.bio ||
                  'This Golden Founder Edition credential certifies the verified creator identity in the QIVORA registry.'}
              </p>
            </div>

            <div className="space-y-2 border-y border-[#D4AF37]/25 py-3.5 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-[#9A834B]">Registry Number</span>
                <span className="font-mono text-[#F6DF9C]">{founder.founderNumber}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#9A834B]">Issued On</span>
                <span className="font-mono text-[#F6DF9C]">{formatDate(founder.issuedAt)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#9A834B]">College Link</span>
                <span className="font-mono capitalize text-[#F6DF9C]">
                  {(founder.collegeLinkStatus || 'unlinked').replace(/_/g, ' ')}
                </span>
              </div>
              {linkedCollege && (
                <>
                  <div className="pt-2 mt-2 border-t border-[#D4AF37]/20 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#D4AF37]">
                    Linked College Student Record
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#9A834B]">College</span>
                    <span className="text-right text-[#F6DF9C] truncate max-w-[190px]">
                      {linkedCollege.collegeName}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#9A834B]">Student ID / Roll</span>
                    <span className="font-mono text-[#F6DF9C]">
                      {linkedCollege.studentIdCode} · {linkedCollege.collegeRollNumber}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#9A834B]">Program</span>
                    <span className="text-right text-[#F6DF9C] truncate max-w-[190px]">
                      {[linkedCollege.courseName, linkedCollege.semesterName].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#9A834B]">Session</span>
                    <span className="font-mono text-[#F6DF9C]">{linkedCollege.academicSession || '—'}</span>
                  </div>
                </>
              )}
            </div>

            <div className="text-[10.5px] leading-relaxed text-[#9A834B]">
              Security Notice: Founder designation is a verified identity credential. When linked to a
              college student record, all borrowing limits, overdue rules, fines, and tenant boundaries
              remain strictly enforced.
            </div>
          </div>
        )}
      </div>

      {showActions && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSide(side === 'front' ? 'back' : 'front')}>
            <RotateCw className="h-3.5 w-3.5" />
            {side === 'front' ? 'Back Side' : 'Front Side'}
          </Button>
          <Button variant="gold" size="sm" onClick={downloadFounderPdf}>
            <Download className="h-3.5 w-3.5" />
            Download PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" />
            Print
          </Button>
          {founder.qrToken && (
            <a
              href={`/verify/${founder.qrToken}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Verify QR
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// QIVORA — PREMIUM STUDENT EDITION ID (Independent of Founder Status)
// ============================================================================

export function PremiumStudentIdCardView({
  data,
  premiumDesign,
  premiumBadgeLabel,
  showActions = true,
  compact = false,
}: {
  data: DigitalIdRenderData;
  premiumDesign?: string | null;
  premiumBadgeLabel?: string | null;
  showActions?: boolean;
  compact?: boolean;
}) {
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [qrUrl, setQrUrl] = useState('');
  const preset = getPremiumStudentDesign(premiumDesign);
  const badgeText = (premiumBadgeLabel || preset.badgeLabel).toUpperCase();

  const verifyUrl = data.qrToken
    ? `${window.location.origin}/verify/${data.qrToken}`
    : `${window.location.origin}/verify`;

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(verifyUrl, {
      width: 180,
      margin: 1,
      color: { dark: preset.qrDark, light: preset.qrLight },
    })
      .then((url) => {
        if (active) setQrUrl(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [verifyUrl, preset.qrDark, preset.qrLight]);

  const handleDownloadPdf = () => {
    const doc = new jsPDF({ unit: 'mm', format: [85.6, 134] });
    // Front
    doc.setFillColor(preset.cardBg);
    doc.rect(0, 0, 85.6, 134, 'F');
    doc.setDrawColor(preset.borderColor);
    doc.setLineWidth(0.55);
    doc.rect(3.2, 3.2, 79.2, 127.6, 'S');

    doc.setTextColor(preset.accentColor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(data.branding.collegeName || 'QIVORA Institution', 42.8, 12.5, {
      align: 'center',
      maxWidth: 74,
    });
    doc.setFontSize(6.2);
    doc.text(`QIVORA PREMIUM EDITION · ${badgeText}`, 42.8, 18.5, { align: 'center' });

    doc.setTextColor(preset.textColor);
    doc.setFontSize(11.5);
    doc.text(data.student.fullName, 42.8, 36, { align: 'center', maxWidth: 76 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(preset.mutedTextColor);
    doc.text(`S/O · D/O ${data.student.fatherName}`, 42.8, 42, { align: 'center' });

    const rows: Array<[string, string]> = [
      ['Student ID', data.student.studentIdCode],
      ['College Roll No.', data.student.collegeRollNumber],
      ['Course', data.student.courseName || '—'],
      ['Semester', data.student.semesterName || '—'],
      ['Session', data.student.sessionName || '—'],
      ['Card No.', data.cardNumber],
    ];
    let y = 52;
    rows.forEach(([k, v]) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(preset.mutedTextColor);
      doc.text(k, 8.5, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(preset.textColor);
      doc.text(String(v), 36, y, { maxWidth: 42 });
      y += 6.5;
    });

    if (qrUrl) {
      doc.addImage(qrUrl, 'PNG', 55, 96, 22, 22);
    }
    doc.setFontSize(6.2);
    doc.setTextColor(preset.accentColor);
    doc.text(preset.name.toUpperCase(), 8.5, 110);
    doc.setTextColor(preset.mutedTextColor);
    doc.text(`Status: ${data.status.toUpperCase()}`, 8.5, 115.5);

    // Back
    doc.addPage([85.6, 134]);
    doc.setFillColor(preset.cardBg);
    doc.rect(0, 0, 85.6, 134, 'F');
    doc.setDrawColor(preset.borderColor);
    doc.setLineWidth(0.55);
    doc.rect(3.2, 3.2, 79.2, 127.6, 'S');
    doc.setTextColor(preset.accentColor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('PREMIUM STUDENT LIBRARY CREDENTIAL', 42.8, 15, { align: 'center' });
    doc.setTextColor(preset.textColor);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`Institution: ${data.branding.collegeName}`, 9, 27, { maxWidth: 68 });
    doc.text(`Issued: ${formatDate(data.issuedAt)}`, 9, 38);
    doc.text(`Valid Until: ${formatDate(data.expiresAt)}`, 9, 44);
    if (data.branding.address) {
      doc.text(`Address: ${data.branding.address}`, 9, 54, { maxWidth: 68 });
    }
    doc.setTextColor(preset.mutedTextColor);
    doc.setFontSize(6);
    doc.text(
      'Premium Student Edition — Distinct from Founder designation. All college library borrowing policies apply.',
      9,
      110,
      { maxWidth: 68 }
    );
    doc.text('QIVORA · Intelligence for Every Library.', 42.8, 125, { align: 'center' });
    doc.save(`${data.cardNumber}-premium.pdf`);
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className={cn(
          'print-area relative overflow-hidden rounded-2xl shadow-2xl transition-all select-none',
          compact ? 'w-[308px]' : 'w-[348px] sm:w-[356px]'
        )}
        style={{
          background: preset.cardBgGradient,
          border: `1.5px solid ${preset.borderColor}`,
          color: preset.textColor,
          minHeight: compact ? '492px' : '540px',
        }}
      >
        <div
          className="pointer-events-none absolute inset-2.5 rounded-xl"
          style={{ border: `1px solid ${preset.borderColor}40` }}
        />
        <div
          className="pointer-events-none absolute inset-x-8 top-0 h-[2px] opacity-85"
          style={{
            background: `linear-gradient(90deg, transparent, ${preset.accentColor}, transparent)`,
          }}
        />

        {side === 'front' ? (
          <div className="relative z-10 flex h-full min-h-[540px] flex-col justify-between p-5">
            {/* Institution & Premium Tier Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {data.branding.collegeLogoUrl ? (
                  <img
                    src={data.branding.collegeLogoUrl}
                    alt={data.branding.collegeName}
                    referrerPolicy="no-referrer"
                    className="h-9 w-9 rounded-lg object-contain bg-white/95 p-0.5 shrink-0"
                  />
                ) : (
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-display text-xs font-bold"
                    style={{
                      backgroundColor: `${preset.secondaryAccent}33`,
                      border: `1px solid ${preset.borderColor}55`,
                      color: preset.textColor,
                    }}
                  >
                    {(data.branding.collegeName || 'CL').slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs font-bold leading-tight truncate">
                    {data.branding.collegeName}
                  </div>
                  <div
                    className="text-[10px] leading-tight truncate mt-0.5"
                    style={{ color: preset.mutedTextColor }}
                  >
                    {data.branding.universityName || preset.name}
                  </div>
                </div>
              </div>
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider uppercase shrink-0"
                style={{
                  backgroundColor: `${preset.secondaryAccent}28`,
                  border: `1px solid ${preset.borderColor}60`,
                  color: preset.accentColor,
                }}
              >
                <Gem className="h-2.5 w-2.5" />
                PREMIUM
              </span>
            </div>

            {/* Portrait + Overlaid Premium Gem Badge */}
            <div className="flex flex-col items-center mt-3">
              <div className="relative h-24 w-24">
                <div
                  className="h-24 w-24 overflow-hidden rounded-full flex items-center justify-center bg-black/30"
                  style={{
                    border: `2.5px solid ${preset.borderColor}`,
                    boxShadow: `0 0 20px ${preset.secondaryAccent}44`,
                  }}
                >
                  {data.student.photoUrl ? (
                    <img
                      src={data.student.photoUrl}
                      alt={data.student.fullName}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <User className="h-10 w-10" style={{ color: preset.accentColor }} />
                  )}
                </div>
                <div
                  title={`${preset.name} — ${badgeText}`}
                  className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full shadow-lg"
                  style={{
                    backgroundColor: preset.secondaryAccent,
                    border: `2px solid ${preset.cardBg}`,
                    color: '#FFFFFF',
                  }}
                >
                  <Gem className="h-3.5 w-3.5" />
                </div>
              </div>

              <div
                className="mt-2.5 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[9.5px] font-bold tracking-[0.18em] uppercase"
                style={{
                  backgroundColor: `${preset.secondaryAccent}25`,
                  border: `1px solid ${preset.borderColor}55`,
                  color: preset.accentColor,
                }}
              >
                <Sparkles className="h-2.5 w-2.5" />
                {badgeText}
              </div>

              <h3 className="mt-2 text-center font-display text-lg font-bold leading-snug">
                {data.student.fullName}
              </h3>
              <p className="text-[11px] text-center" style={{ color: preset.mutedTextColor }}>
                S/O · D/O {data.student.fatherName}
              </p>

              <div className="mt-4 w-full space-y-1.5 text-xs">
                <div className="flex justify-between gap-2 border-b border-white/10 pb-1">
                  <span style={{ color: preset.mutedTextColor }}>Student ID</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {data.student.studentIdCode}
                  </span>
                </div>
                <div className="flex justify-between gap-2 border-b border-white/10 pb-1">
                  <span style={{ color: preset.mutedTextColor }}>College Roll No.</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {data.student.collegeRollNumber}
                  </span>
                </div>
                <div className="flex justify-between gap-2 border-b border-white/10 pb-1">
                  <span style={{ color: preset.mutedTextColor }}>Course</span>
                  <span className="font-medium text-right truncate max-w-[180px]">
                    {data.student.courseName || '—'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span style={{ color: preset.mutedTextColor }}>Semester · Session</span>
                  <span className="font-medium text-right truncate max-w-[180px]">
                    {[data.student.semesterName, data.student.sessionName].filter(Boolean).join(' · ') || '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Footer with Scannable QR */}
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/15 pt-3">
              <div className="min-w-0">
                <div
                  className="text-[10px] font-mono font-semibold tracking-wider uppercase"
                  style={{ color: preset.accentColor }}
                >
                  {data.cardNumber}
                </div>
                <div className="mt-1 flex items-center gap-1 text-[11px] font-semibold">
                  <ShieldCheck className="h-3.5 w-3.5" style={{ color: preset.accentColor }} />
                  <span className="capitalize">{data.status}</span>
                </div>
                <div className="mt-0.5 text-[10px] opacity-75">
                  QIVORA · {preset.name}
                </div>
              </div>
              <div
                className="rounded-lg p-1.5 shadow-sm shrink-0"
                style={{ backgroundColor: preset.qrLight, border: `1px solid ${preset.borderColor}88` }}
              >
                {qrUrl ? (
                  <img src={qrUrl} alt="Premium Verification QR" className="h-16 w-16" />
                ) : (
                  <div className="h-16 w-16" />
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="relative z-10 flex h-full min-h-[540px] flex-col justify-between p-6 text-xs">
            <div>
              <div
                className="text-[10px] font-semibold uppercase tracking-[0.2em]"
                style={{ color: preset.accentColor }}
              >
                QIVORA PREMIUM EDITION · {preset.name}
              </div>
              <h4 className="mt-1.5 font-display text-base font-bold">
                Official Premium Library Identity
              </h4>
              <p className="mt-2 text-[11px] leading-relaxed" style={{ color: preset.mutedTextColor }}>
                Issued to verified library members under the QIVORA {preset.name} tier. This is a
                distinct Premium Student Edition credential and does not confer Founder or
                administrative privileges.
              </p>
            </div>

            <div className="space-y-2 border-y border-white/15 py-3.5">
              <div className="flex justify-between gap-2">
                <span style={{ color: preset.mutedTextColor }}>Card Number</span>
                <span className="font-mono font-semibold">{data.cardNumber}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span style={{ color: preset.mutedTextColor }}>Issue Date</span>
                <span className="font-mono">{formatDate(data.issuedAt)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span style={{ color: preset.mutedTextColor }}>Valid Until</span>
                <span className="font-mono">{formatDate(data.expiresAt)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span style={{ color: preset.mutedTextColor }}>Institution</span>
                <span className="text-right truncate max-w-[180px]">{data.branding.collegeName}</span>
              </div>
              {data.branding.address && (
                <div className="pt-1.5 text-[11px]" style={{ color: preset.mutedTextColor }}>
                  {data.branding.address}
                </div>
              )}
            </div>

            <div className="flex items-end justify-between gap-3">
              <div>
                {data.branding.authorizedSignatureUrl ? (
                  <img
                    src={data.branding.authorizedSignatureUrl}
                    alt="Authorized signature"
                    referrerPolicy="no-referrer"
                    className="h-7 object-contain brightness-200"
                  />
                ) : (
                  <div className="h-6 w-24 border-b border-white/30" />
                )}
                <div className="mt-1 text-[10px] font-semibold">
                  {data.branding.authorizedSignatoryName || 'Authorized Signatory'}
                </div>
              </div>
              <div className="text-right text-[10px]" style={{ color: preset.mutedTextColor }}>
                <div className="font-semibold" style={{ color: preset.textColor }}>QIVORA</div>
                <div>Intelligence for Every Library.</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {showActions && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSide(side === 'front' ? 'back' : 'front')}>
            <RotateCw className="h-3.5 w-3.5" />
            {side === 'front' ? 'View Back' : 'View Front'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadPdf}>
            <Download className="h-3.5 w-3.5" />
            Download PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" />
            Print
          </Button>
          {data.qrToken && (
            <a
              href={`/verify/${data.qrToken}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Verify QR
            </a>
          )}
        </div>
      )}
    </div>
  );
}
