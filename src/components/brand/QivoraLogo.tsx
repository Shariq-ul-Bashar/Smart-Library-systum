import { cn } from '../../lib/utils.ts';

interface QivoraLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  collapsed?: boolean;
  variant?: 'default' | 'inverted' | 'gold';
  className?: string;
}

export function QivoraLogo({
  size = 'md',
  showTagline = false,
  collapsed = false,
  variant = 'default',
  className,
}: QivoraLogoProps) {
  const iconSize = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-11 w-11' : 'h-9 w-9';
  const titleClass =
    size === 'sm'
      ? 'text-base tracking-[0.12em]'
      : size === 'lg'
        ? 'text-2xl tracking-[0.14em]'
        : 'text-lg tracking-[0.13em]';

  const markBg =
    variant === 'gold'
      ? 'bg-gradient-to-br from-[#F6DC8C] via-[#D4AF37] to-[#9A711A] text-[#0A0B0F] shadow-sm'
      : variant === 'inverted'
        ? 'bg-white text-[#2563EB] shadow-sm'
        : 'bg-gradient-to-br from-[#2563EB] via-[#4F46E5] to-[#7C3AED] text-white shadow-sm';

  const textCol =
    variant === 'gold'
      ? 'text-[#F3D98B]'
      : variant === 'inverted'
        ? 'text-white'
        : 'text-[#0F172A] dark:text-[#F8FAFC]';

  const subCol =
    variant === 'gold'
      ? 'text-[#C6A85A]'
      : variant === 'inverted'
        ? 'text-blue-100/90'
        : 'text-slate-500 dark:text-slate-400';

  return (
    <div className={cn('inline-flex items-center gap-2.5 select-none', className)}>
      {/* Minimal Abstract Geometric Q Emblem */}
      <div
        className={cn(
          'flex items-center justify-center rounded-xl shrink-0',
          iconSize,
          markBg
        )}
        aria-hidden="true"
      >
        <svg viewBox="0 0 28 28" className="h-5 w-5" fill="none">
          <path
            d="M14 4.25C8.61522 4.25 4.25 8.61522 4.25 14C4.25 19.3848 8.61522 23.75 14 23.75C16.21 23.75 18.248 23.014 19.883 21.773"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <path
            d="M23.75 14C23.75 9.93 21.258 6.44 17.72 4.98"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeOpacity="0.65"
          />
          <path
            d="M15.8 15.8L23.25 23.25"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <circle cx="14" cy="14" r="2.2" fill="currentColor" />
        </svg>
      </div>

      {!collapsed && (
        <div className="flex flex-col leading-none min-w-0">
          <span className={cn('font-display font-extrabold whitespace-nowrap', titleClass, textCol)}>
            QIVORA
          </span>
          {showTagline && (
            <span className={cn('text-[10.5px] font-medium tracking-wide mt-1 truncate', subCol)}>
              Intelligence for Every Library.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function QivoraFooter({
  compact = false,
  className,
  onAboutClick,
}: {
  compact?: boolean;
  className?: string;
  onAboutClick?: () => void;
}) {
  return (
    <div
      className={cn(
        'text-[11px] text-slate-500 dark:text-slate-400 leading-snug',
        compact ? 'text-center space-y-0.5' : 'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5',
        className
      )}
    >
      <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5', compact && 'justify-center')}>
        <span className="font-medium text-slate-600 dark:text-slate-300">
          QIVORA — Smart Library Management System
        </span>
        <span className="text-slate-400 dark:text-slate-500">· Intelligence for Every Library.</span>
        {onAboutClick && (
          <button
            type="button"
            onClick={onAboutClick}
            className="text-[#4F46E5] hover:underline dark:text-indigo-400 font-medium cursor-pointer"
          >
            About QIVORA
          </button>
        )}
      </div>
      <div className={cn('flex flex-col sm:flex-row sm:items-center sm:gap-1.5 text-slate-500 dark:text-slate-400', compact && 'items-center')}>
        <span className="font-medium text-slate-700 dark:text-slate-300">
          Designed &amp; Developed by MOHAMMAD SHARIQ
        </span>
        <span className="hidden sm:inline text-slate-300 dark:text-slate-600">·</span>
        <span className="text-slate-400 dark:text-slate-500">BCA 1st Year | 2026–2027 Batch</span>
      </div>
    </div>
  );
}

