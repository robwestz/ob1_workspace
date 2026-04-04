import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

// ---------------------------------------------------------------------------
// StatCard — metric display with icon, value, label, and optional trend
// ---------------------------------------------------------------------------

interface TrendInfo {
  direction: 'up' | 'down' | 'neutral';
  label: string;
}

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subtitle?: string;
  trend?: TrendInfo;
  /** Color theme */
  color?: 'blue' | 'green' | 'amber' | 'red' | 'purple';
  className?: string;
}

const colorConfig = {
  blue: {
    bg: 'bg-blue-500/10',
    ring: 'ring-blue-500/20',
    icon: 'text-blue-400',
    glow: 'hover:shadow-blue-500/5',
  },
  green: {
    bg: 'bg-emerald-500/10',
    ring: 'ring-emerald-500/20',
    icon: 'text-emerald-400',
    glow: 'hover:shadow-emerald-500/5',
  },
  amber: {
    bg: 'bg-amber-500/10',
    ring: 'ring-amber-500/20',
    icon: 'text-amber-400',
    glow: 'hover:shadow-amber-500/5',
  },
  red: {
    bg: 'bg-red-500/10',
    ring: 'ring-red-500/20',
    icon: 'text-red-400',
    glow: 'hover:shadow-red-500/5',
  },
  purple: {
    bg: 'bg-purple-500/10',
    ring: 'ring-purple-500/20',
    icon: 'text-purple-400',
    glow: 'hover:shadow-purple-500/5',
  },
};

const trendColors = {
  up: 'text-emerald-400',
  down: 'text-red-400',
  neutral: 'text-slate-500',
};

const TrendIcons = {
  up: TrendingUp,
  down: TrendingDown,
  neutral: Minus,
};

export function StatCard({
  icon: Icon,
  label,
  value,
  subtitle,
  trend,
  color = 'blue',
  className = '',
}: StatCardProps) {
  const c = colorConfig[color];

  return (
    <div
      className={[
        'group relative rounded-xl border border-slate-800 bg-slate-900/50 p-5',
        'transition-all duration-200 hover:border-slate-700/60 hover:bg-slate-800/40',
        `hover:shadow-lg ${c.glow}`,
        className,
      ].join(' ')}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
          {label}
        </span>
        <div className={`p-2 rounded-lg ${c.bg} ring-1 ${c.ring}`}>
          <Icon className={`w-4 h-4 ${c.icon}`} />
        </div>
      </div>

      <div className="text-2xl font-bold text-slate-100 tracking-tight">
        {value}
      </div>

      {(subtitle || trend) && (
        <div className="flex items-center gap-2 mt-1.5">
          {trend && (
            <span className={`flex items-center gap-1 text-xs ${trendColors[trend.direction]}`}>
              {React.createElement(TrendIcons[trend.direction], { size: 12 })}
              {trend.label}
            </span>
          )}
          {subtitle && !trend && (
            <span className="text-xs text-slate-500">{subtitle}</span>
          )}
        </div>
      )}
    </div>
  );
}
