import React from 'react';

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface CardProps {
  children: React.ReactNode;
  className?: string;
  /** Optional title rendered at the top of the card */
  title?: string;
  /** Badge rendered next to the title */
  badge?: React.ReactNode;
  /** Actions rendered in the top-right corner */
  actions?: React.ReactNode;
  /** Remove default padding (for embedding tables, etc.) */
  noPadding?: boolean;
}

export function Card({
  children,
  className = '',
  title,
  badge,
  actions,
  noPadding = false,
}: CardProps) {
  return (
    <div
      className={[
        'rounded-xl border border-slate-800 bg-slate-900/50',
        'transition-colors duration-200',
        className,
      ].join(' ')}
    >
      {(title || badge || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            {title && (
              <h3 className="text-sm font-semibold text-slate-200 truncate">
                {title}
              </h3>
            )}
            {badge}
          </div>
          {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
        </div>
      )}
      <div className={noPadding ? '' : 'p-5'}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CardHover — interactive variant
// ---------------------------------------------------------------------------

interface CardHoverProps extends CardProps {
  onClick?: () => void;
}

export function CardHover({ onClick, className = '', ...props }: CardHoverProps) {
  return (
    <Card
      {...props}
      className={[
        'cursor-pointer hover:bg-slate-800/60 hover:border-slate-700/60',
        'hover:shadow-lg hover:shadow-blue-500/5',
        className,
      ].join(' ')}
    />
  );
}
