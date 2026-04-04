import React from 'react';
import { Inbox } from 'lucide-react';

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

interface EmptyStateProps {
  icon?: React.ElementType;
  title?: string;
  message: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  message,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center py-16 px-6 text-center',
        className,
      ].join(' ')}
    >
      <div className="p-3 rounded-xl bg-slate-800/60 ring-1 ring-slate-700/50 mb-4">
        <Icon className="w-6 h-6 text-slate-500" />
      </div>
      {title && (
        <h3 className="text-sm font-semibold text-slate-300 mb-1">{title}</h3>
      )}
      <p className="text-sm text-slate-500 max-w-sm">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
