import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { ArrowUpRight, Loader2, Upload, User, X } from 'lucide-react';
import { uploadAssetFile } from '../../lib/api.ts';
import { cn, getTimeGreeting } from '../../lib/utils.ts';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4F46E5] disabled:opacity-50 disabled:pointer-events-none cursor-pointer',
  {
    variants: {
      variant: {
        primary:
          'bg-gradient-to-r from-[#2563EB] to-[#6D28D9] text-white shadow-xs hover:brightness-105',
        secondary:
          'bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
        outline:
          'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
        ghost:
          'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
        danger:
          'bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500',
        gold:
          'bg-gradient-to-r from-[#D4AF37] to-[#A67C23] text-[#0B0D12] font-semibold hover:brightness-105',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-11 px-5 text-sm',
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  loading,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-[#4F46E5] focus:outline-none dark:border-slate-700 dark:bg-[#0F172A] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-[#6366F1] disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full min-h-[84px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-[#4F46E5] focus:outline-none dark:border-slate-700 dark:bg-[#0F172A] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-[#6366F1]',
        className
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 transition-colors focus:border-[#4F46E5] focus:outline-none dark:border-slate-700 dark:bg-[#0F172A] dark:text-slate-100 dark:focus:border-[#6366F1] disabled:opacity-50',
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export function SurfaceCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827]',
        className
      )}
    >
      {children}
    </div>
  );
}

export type PastelTone = 'blue' | 'purple' | 'emerald' | 'amber' | 'rose' | 'cyan' | 'indigo';

const PASTEL_STYLES: Record<PastelTone, string> = {
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400',
  purple: 'bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400',
  cyan: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-950/60 dark:text-cyan-400',
  indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400',
};

export function MetricTile({
  label,
  value,
  subtext,
  tone = 'default',
  icon: Icon,
  pastel = 'blue',
  to,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  icon?: React.ComponentType<{ className?: string }>;
  pastel?: PastelTone;
  to?: string;
}) {
  const valueTone =
    tone === 'danger'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'warning'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'success'
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-slate-900 dark:text-slate-50';

  const inner = (
    <div
      className={cn(
        'rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-[#111827] transition-all h-full',
        to && 'hover:border-[#4F46E5]/40 hover:shadow-sm group'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
            {label}
          </div>
          <div className={cn('mt-2 text-2xl font-display font-bold tabular-nums', valueTone)}>
            {value}
          </div>
        </div>
        {Icon && (
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
              PASTEL_STYLES[pastel]
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
      {subtext && (
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="truncate">{subtext}</span>
          {to && (
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-100 text-[#4F46E5] transition-opacity" />
          )}
        </div>
      )}
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="block focus-visible:outline-none">
        {inner}
      </Link>
    );
  }
  return inner;
}

// Reference Blue-to-Purple Gradient Welcome Banner across all 4 panels
export function WelcomeBanner({
  name,
  roleLabel,
  organizationName,
  subtitle,
  avatarUrl,
  progressLabel,
  progressValue,
  progressSubtext,
  actions,
}: {
  name: string;
  roleLabel: string;
  organizationName?: string | null;
  subtitle?: string;
  avatarUrl?: string | null;
  progressLabel?: string;
  progressValue?: number; // 0..100
  progressSubtext?: string;
  actions?: React.ReactNode;
}) {
  const greeting = getTimeGreeting();
  const clamped = typeof progressValue === 'number' ? Math.max(0, Math.min(100, Math.round(progressValue))) : null;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#2563EB] via-[#4F46E5] to-[#7C3AED] p-5 sm:p-6 text-white shadow-sm">
      <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-16 right-28 h-40 w-40 rounded-full bg-purple-300/15 blur-2xl" />

      <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="flex items-center gap-4 min-w-0">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border-2 border-white/30 bg-white/15 flex items-center justify-center">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={name}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <User className="h-7 w-7 text-white/90" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-blue-100/90">
              {greeting} · {roleLabel}
              {organizationName ? ` · ${organizationName}` : ''}
            </div>
            <h1 className="mt-0.5 font-display text-xl sm:text-2xl font-bold tracking-tight text-white truncate">
              {name}
            </h1>
            {subtitle && (
              <p className="mt-1 text-xs sm:text-sm text-blue-100/85 line-clamp-2">{subtitle}</p>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-4 shrink-0">
          {clamped !== null && progressLabel && (
            <div className="min-w-[200px] rounded-xl bg-white/12 backdrop-blur-xs border border-white/15 px-4 py-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-blue-100">{progressLabel}</span>
                <span className="font-mono font-semibold text-white tabular-nums">{clamped}%</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-white transition-all duration-300"
                  style={{ width: `${clamped}%` }}
                />
              </div>
              {progressSubtext && (
                <div className="mt-1 text-[11px] text-blue-100/80">{progressSubtext}</div>
              )}
            </div>
          )}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

// Colorful Pastel Quick Action Tile (Reference Dashboard Section E)
export function QuickActionTile({
  label,
  description,
  icon: Icon,
  pastel = 'blue',
  to,
  onClick,
}: {
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  pastel?: PastelTone;
  to?: string;
  onClick?: () => void;
}) {
  const content = (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] hover:border-[#4F46E5]/40 hover:shadow-sm transition-all dark:border-slate-800 dark:bg-[#111827] dark:hover:border-[#6366F1]/50 text-left w-full">
      <div
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
          PASTEL_STYLES[pastel]
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">{label}</div>
        {description && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
            {description}
          </div>
        )}
      </div>
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="block">
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className="w-full cursor-pointer">
      {content}
    </button>
  );
}

export function StatusText({ status }: { status?: string | null }) {
  const s = (status || 'unknown').toLowerCase();
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: 'Active', cls: 'text-emerald-700 dark:text-emerald-400' },
    available: { label: 'Available', cls: 'text-emerald-700 dark:text-emerald-400' },
    approved: { label: 'Approved', cls: 'text-emerald-700 dark:text-emerald-400' },
    paid: { label: 'Paid', cls: 'text-emerald-700 dark:text-emerald-400' },
    published: { label: 'Published', cls: 'text-emerald-700 dark:text-emerald-400' },
    completed: { label: 'Completed', cls: 'text-emerald-700 dark:text-emerald-400' },
    delivered: { label: 'Delivered', cls: 'text-emerald-700 dark:text-emerald-400' },
    success: { label: 'Success', cls: 'text-emerald-700 dark:text-emerald-400' },
    configured_enabled: { label: 'Configured & Active', cls: 'text-emerald-700 dark:text-emerald-400' },
    public_api_ready: { label: 'Public API Ready', cls: 'text-blue-700 dark:text-blue-400' },
    configured_disabled: { label: 'Configured (Off)', cls: 'text-amber-700 dark:text-amber-400' },
    not_configured: { label: 'Not Configured', cls: 'text-slate-500 dark:text-slate-400' },
    returned: { label: 'Returned', cls: 'text-slate-600 dark:text-slate-300' },
    fulfilled: { label: 'Fulfilled', cls: 'text-emerald-700 dark:text-emerald-400' },
    ready: { label: 'Ready for Pickup', cls: 'text-blue-700 dark:text-blue-400' },
    issued: { label: 'Issued', cls: 'text-blue-700 dark:text-blue-400' },
    queued: { label: 'Queued', cls: 'text-amber-700 dark:text-amber-400' },
    pending: { label: 'Pending', cls: 'text-amber-700 dark:text-amber-400' },
    partial: { label: 'Partial', cls: 'text-amber-700 dark:text-amber-400' },
    waiver_requested: { label: 'Waiver Requested', cls: 'text-amber-700 dark:text-amber-400' },
    reserved: { label: 'Reserved', cls: 'text-indigo-700 dark:text-indigo-400' },
    draft: { label: 'Draft', cls: 'text-slate-500 dark:text-slate-400' },
    idle: { label: 'Ready', cls: 'text-slate-500 dark:text-slate-400' },
    waived: { label: 'Waived', cls: 'text-slate-500 dark:text-slate-400' },
    suspended: { label: 'Suspended', cls: 'text-red-700 dark:text-red-400' },
    revoked: { label: 'Revoked', cls: 'text-red-700 dark:text-red-400' },
    blocked: { label: 'Blocked', cls: 'text-red-700 dark:text-red-400' },
    rejected: { label: 'Rejected', cls: 'text-red-700 dark:text-red-400' },
    failed: { label: 'Failed', cls: 'text-red-700 dark:text-red-400' },
    overdue: { label: 'Overdue', cls: 'text-red-700 dark:text-red-400' },
    unpaid: { label: 'Unpaid', cls: 'text-red-700 dark:text-red-400' },
    damaged: { label: 'Damaged', cls: 'text-red-700 dark:text-red-400' },
    lost: { label: 'Lost', cls: 'text-red-700 dark:text-red-400' },
    expired: { label: 'Expired', cls: 'text-slate-500 dark:text-slate-400' },
    cancelled: { label: 'Cancelled', cls: 'text-slate-500 dark:text-slate-400' },
    archived: { label: 'Archived', cls: 'text-slate-500 dark:text-slate-400' },
    reversed: { label: 'Reversed', cls: 'text-slate-500 dark:text-slate-400' },
    inactive: { label: 'Inactive', cls: 'text-slate-500 dark:text-slate-400' },
    graduated: { label: 'Graduated', cls: 'text-indigo-700 dark:text-indigo-400' },
    under_maintenance: { label: 'Maintenance', cls: 'text-amber-700 dark:text-amber-400' },
  };
  const info = map[s] || { label: status || 'Unknown', cls: 'text-slate-600 dark:text-slate-300' };
  return <span className={cn('text-xs font-semibold whitespace-nowrap', info.cls)}>{info.label}</span>;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  maxWidth = 'max-w-xl',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-[#111827] dark:text-slate-100',
            maxWidth
          )}
        >
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <Dialog.Title className="text-lg font-display font-semibold text-slate-900 dark:text-white">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close dialog"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="mt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  danger = false,
  loading = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} maxWidth="max-w-md">
      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{description}</p>
      <div className="mt-6 flex items-center justify-end gap-3">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
          Cancel
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 px-6 py-12 text-center">
      <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </h3>
      <p className="mt-1.5 max-w-md text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 py-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-10 w-full animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/80"
        />
      ))}
    </div>
  );
}

export function FileUploadControl({
  bucket,
  label,
  accept = 'image/png,image/jpeg,image/webp',
  currentUrl,
  onUploaded,
  allowClear = false,
}: {
  bucket: string;
  label: string;
  accept?: string;
  currentUrl?: string | null;
  onUploaded: (url: string | null) => void;
  allowClear?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const asset = await uploadAssetFile(file, bucket);
      onUploaded(asset.url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3">
        <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          <span>{uploading ? 'Uploading...' : label}</span>
          <input type="file" accept={accept} onChange={handleChange} className="hidden" disabled={uploading} />
        </label>
        {currentUrl && (
          <span className="text-xs text-emerald-700 dark:text-emerald-400 truncate max-w-[160px]">
            Uploaded
          </span>
        )}
        {allowClear && currentUrl && (
          <button
            type="button"
            onClick={() => onUploaded(null)}
            className="text-xs text-slate-500 hover:text-red-600 cursor-pointer"
          >
            Remove
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
