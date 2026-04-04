import React from 'react';

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------

interface ProgressBarProps {
  /** Current value (0-100 or raw) */
  value: number;
  /** Max value (default 100) */
  max?: number;
  /** Color variant */
  variant?: 'blue' | 'green' | 'amber' | 'red' | 'auto';
  /** Show percentage label */
  showLabel?: boolean;
  /** Size */
  size?: 'sm' | 'md' | 'lg';
  /** Optional label text */
  label?: string;
  /** Optional subtitle under the bar */
  subtitle?: string;
  className?: string;
}

const colorClasses = {
  blue: 'bg-gradient-to-r from-blue-600 to-blue-400',
  green: 'bg-gradient-to-r from-emerald-600 to-emerald-400',
  amber: 'bg-gradient-to-r from-amber-600 to-amber-400',
  red: 'bg-gradient-to-r from-red-600 to-red-400',
};

const sizeClasses = {
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-3.5',
};

function autoColor(pct: number): keyof typeof colorClasses {
  if (pct >= 90) return 'red';
  if (pct >= 70) return 'amber';
  return 'blue';
}

export function ProgressBar({
  value,
  max = 100,
  variant = 'blue',
  showLabel = false,
  size = 'md',
  label,
  subtitle,
  className = '',
}: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = variant === 'auto' ? autoColor(pct) : variant;

  return (
    <div className={className}>
      {(label || showLabel) && (
        <div className="flex items-center justify-between mb-1.5">
          {label && (
            <span className="text-xs font-medium text-slate-400">{label}</span>
          )}
          {showLabel && (
            <span className="text-xs font-mono text-slate-400">{pct}%</span>
          )}
        </div>
      )}
      <div
        className={`w-full bg-slate-800 rounded-full overflow-hidden ${sizeClasses[size]}`}
      >
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${colorClasses[color]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {subtitle && (
        <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
      )}
    </div>
  );
}
