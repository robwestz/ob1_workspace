import React from 'react';

// ---------------------------------------------------------------------------
// Skeleton — animated loading placeholder
// ---------------------------------------------------------------------------

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={[
        'skeleton rounded-md',
        className,
      ].join(' ')}
      aria-hidden="true"
    />
  );
}

// ---------------------------------------------------------------------------
// SkeletonCard — card-shaped loader
// ---------------------------------------------------------------------------

export function SkeletonCard({ className = '' }: SkeletonProps) {
  return (
    <div
      className={[
        'rounded-xl border border-slate-800 bg-slate-900/50 p-5 space-y-3',
        className,
      ].join(' ')}
    >
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-16" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkeletonRow — table row shaped loader
// ---------------------------------------------------------------------------

export function SkeletonRow({ cols = 4, className = '' }: SkeletonProps & { cols?: number }) {
  return (
    <div className={`flex items-center gap-4 py-3 px-4 ${className}`}>
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-4 ${i === 0 ? 'w-1/4' : i === cols - 1 ? 'w-16' : 'flex-1'}`}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FullPageSpinner — centered spinner for page-level loading
// ---------------------------------------------------------------------------

export function FullPageSpinner() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-slate-700 border-t-blue-400 rounded-full animate-spin" />
        <span className="text-xs text-slate-500">Loading...</span>
      </div>
    </div>
  );
}
