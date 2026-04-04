import React from 'react';

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

export type BadgeVariant =
  | 'running'
  | 'completed'
  | 'failed'
  | 'pending'
  | 'cancelled'
  | 'timeout'
  | 'info'
  | 'warning'
  | 'success'
  | 'error'
  | 'neutral';

const variantStyles: Record<BadgeVariant, string> = {
  running: 'bg-blue-500/15 text-blue-400 ring-blue-500/25',
  completed: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/25',
  success: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/25',
  failed: 'bg-red-500/15 text-red-400 ring-red-500/25',
  error: 'bg-red-500/15 text-red-400 ring-red-500/25',
  pending: 'bg-slate-500/15 text-slate-400 ring-slate-500/25',
  neutral: 'bg-slate-500/15 text-slate-400 ring-slate-500/25',
  cancelled: 'bg-slate-500/15 text-slate-500 ring-slate-500/25',
  timeout: 'bg-amber-500/15 text-amber-400 ring-amber-500/25',
  warning: 'bg-amber-500/15 text-amber-400 ring-amber-500/25',
  info: 'bg-blue-500/10 text-blue-300 ring-blue-500/20',
};

interface BadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  /** Show a pulsing dot before the label */
  pulse?: boolean;
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md';
}

export function Badge({
  variant,
  children,
  pulse = false,
  className = '',
  size = 'sm',
}: BadgeProps) {
  const sizeClasses =
    size === 'sm'
      ? 'px-2 py-0.5 text-[11px]'
      : 'px-2.5 py-1 text-xs';

  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full font-medium ring-1',
        variantStyles[variant] ?? variantStyles.neutral,
        sizeClasses,
        className,
      ].join(' ')}
    >
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-current" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Convenience: map a status string to a Badge
// ---------------------------------------------------------------------------

export function StatusBadge({ status }: { status: string }) {
  const variant = (variantStyles[status as BadgeVariant]
    ? status
    : 'neutral') as BadgeVariant;

  const isRunning = status === 'running';

  return (
    <Badge variant={variant} pulse={isRunning}>
      {status}
    </Badge>
  );
}
