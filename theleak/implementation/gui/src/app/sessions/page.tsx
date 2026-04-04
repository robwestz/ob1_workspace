'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Play,
  Calendar,
  Clock,
  DollarSign,
  MessageSquare,
  Zap,
  Filter,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { api } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionStatus = 'active' | 'completed' | 'crashed' | 'suspended';

interface SessionDetail {
  id: string;
  status: SessionStatus;
  created_at: string;
  completed_at?: string;
  duration_seconds?: number;
  turns_used?: number;
  turns_limit?: number;
  tokens_used?: number;
  tokens_limit?: number;
  budget_used_usd: number;
  budget_limit_usd: number;
  stop_reason?: string;
  config_snapshot?: Record<string, unknown>;
  permission_decisions?: PermissionDecision[];
}

interface PermissionDecision {
  tool: string;
  decision: 'allow' | 'deny' | 'escalate';
  reason?: string;
  timestamp: string;
}

type SortField = 'date' | 'cost' | 'duration';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<SessionStatus, string> = {
  active: 'bg-blue-400/10 text-blue-400 border-blue-400/20',
  completed: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
  crashed: 'bg-red-400/10 text-red-400 border-red-400/20',
  suspended: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
};

// ---------------------------------------------------------------------------
// Skeleton / Error
// ---------------------------------------------------------------------------

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-700/50 rounded ${className}`} />;
}

function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="glass-panel border-red-500/30 p-4 flex items-center gap-3">
      <Zap className="text-red-400 w-5 h-5 shrink-0" />
      <span className="text-red-300 text-sm flex-1">{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="text-xs text-slate-400 hover:text-slate-200 underline">
          Retry
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-slate-700/40 transition-colors"
      title="Copy full ID"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-400" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-slate-500" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function ProgressBar({
  used,
  limit,
  label,
  format,
}: {
  used: number;
  limit: number;
  label: string;
  format?: (n: number) => string;
}) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const fmt = format ?? ((n: number) => n.toLocaleString());
  const isHigh = pct > 80;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-300 tabular-nums">
          {fmt(used)} / {fmt(limit)}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-700/60 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isHigh ? 'bg-amber-400' : 'bg-blue-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expanded detail
// ---------------------------------------------------------------------------

function SessionExpandedDetail({ session }: { session: SessionDetail }) {
  return (
    <div className="px-4 pb-5 pt-2 space-y-5 slide-in">
      {/* Budget breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {session.turns_limit != null && (
          <ProgressBar
            used={session.turns_used ?? 0}
            limit={session.turns_limit}
            label="Turns"
          />
        )}
        {session.tokens_limit != null && (
          <ProgressBar
            used={session.tokens_used ?? 0}
            limit={session.tokens_limit}
            label="Tokens"
            format={(n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))}
          />
        )}
        <ProgressBar
          used={session.budget_used_usd}
          limit={session.budget_limit_usd}
          label="USD Cost"
          format={(n) => `$${n.toFixed(4)}`}
        />
      </div>

      {/* Config snapshot */}
      {session.config_snapshot && Object.keys(session.config_snapshot).length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
            Config Snapshot
          </h4>
          <pre className="text-xs text-slate-400 bg-slate-900/60 rounded-lg p-3 overflow-x-auto max-h-40">
            {JSON.stringify(session.config_snapshot, null, 2)}
          </pre>
        </div>
      )}

      {/* Permission decisions */}
      {session.permission_decisions && session.permission_decisions.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
            Permission Decisions
          </h4>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {session.permission_decisions.map((pd, i) => {
              const decisionColor =
                pd.decision === 'allow'
                  ? 'text-emerald-400'
                  : pd.decision === 'deny'
                    ? 'text-red-400'
                    : 'text-amber-400';
              return (
                <div
                  key={i}
                  className="flex items-center gap-3 px-3 py-1.5 rounded-md bg-slate-900/40 text-xs"
                >
                  <span className={`font-semibold uppercase ${decisionColor}`}>{pd.decision}</span>
                  <span className="text-slate-300 font-mono">{pd.tool}</span>
                  {pd.reason && <span className="text-slate-500 truncate flex-1">{pd.reason}</span>}
                  <span className="text-slate-600 tabular-nums whitespace-nowrap">
                    {new Date(pd.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Resume button */}
      {session.status !== 'completed' && (
        <div className="flex justify-end">
          <button
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500
                       text-sm font-medium transition-colors"
          >
            <Play className="w-4 h-4" />
            Resume Session
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds?: number): string {
  if (seconds == null) return '-';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatTokens(n?: number): string {
  if (n == null) return '-';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(n?: number): string {
  if (n == null) return '-';
  return `$${n.toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<SessionStatus | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortField>('date');

  const fetchSessions = useCallback(async () => {
    setError(null);
    try {
      const data = await api.state.listSessions({ limit: 100 });
      const mapped: SessionDetail[] = data.map((s: any) => ({
        id: s.id,
        status: s.status ?? (s.completed_at ? 'completed' : 'active'),
        created_at: s.created_at,
        completed_at: s.completed_at,
        duration_seconds: s.duration_seconds,
        turns_used: s.turns_used,
        turns_limit: s.turns_limit,
        tokens_used: s.tokens_used,
        tokens_limit: s.tokens_limit,
        budget_used_usd: s.budget_used_usd ?? 0,
        budget_limit_usd: s.budget_limit_usd ?? 0,
        stop_reason: s.stop_reason,
        config_snapshot: s.config_snapshot,
        permission_decisions: s.permission_decisions,
      }));
      setSessions(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Filter & sort
  const filtered = useMemo(() => {
    let list = sessions;
    if (statusFilter !== 'all') {
      list = list.filter((s) => s.status === statusFilter);
    }
    list = [...list].sort((a, b) => {
      switch (sortBy) {
        case 'cost':
          return (b.budget_used_usd ?? 0) - (a.budget_used_usd ?? 0);
        case 'duration':
          return (b.duration_seconds ?? 0) - (a.duration_seconds ?? 0);
        case 'date':
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });
    return list;
  }, [sessions, statusFilter, sortBy]);

  return (
    <div className="min-h-screen bg-slate-950 p-6 lg:p-10 space-y-6 fade-in">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Session History</h1>
        <p className="text-sm text-slate-500 mt-1">
          Browse, inspect, and resume agentic sessions.
        </p>
      </div>

      {/* Filters */}
      <div className="glass-panel p-4 flex flex-wrap items-center gap-4">
        <Filter className="w-4 h-4 text-slate-500" />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as SessionStatus | 'all')}
          className="px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50
                     text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="crashed">Crashed</option>
          <option value="suspended">Suspended</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortField)}
          className="px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50
                     text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
        >
          <option value="date">Sort by date</option>
          <option value="cost">Sort by cost</option>
          <option value="duration">Sort by duration</option>
        </select>
        <span className="ml-auto text-xs text-slate-500">
          {filtered.length} session{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchSessions} />}

      {/* Sessions table */}
      <div className="glass-panel overflow-hidden">
        {loading ? (
          <div className="p-6">
            <SkeletonRows count={8} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-600">
            No sessions match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-700/50">
                  <th className="px-4 py-3" />
                  <th className="px-4 py-3">Session ID</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">
                    <Clock className="w-3.5 h-3.5 inline mr-1" />
                    Duration
                  </th>
                  <th className="px-4 py-3">
                    <MessageSquare className="w-3.5 h-3.5 inline mr-1" />
                    Turns
                  </th>
                  <th className="px-4 py-3">
                    <Zap className="w-3.5 h-3.5 inline mr-1" />
                    Tokens
                  </th>
                  <th className="px-4 py-3">
                    <DollarSign className="w-3.5 h-3.5 inline mr-1" />
                    Cost
                  </th>
                  <th className="px-4 py-3">Stop Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {filtered.map((s) => {
                  const isExpanded = expandedId === s.id;
                  return (
                    <React.Fragment key={s.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : s.id)}
                        className="cursor-pointer hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="px-4 py-3">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-slate-500" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-500" />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-slate-300 text-xs">
                              {s.id.slice(0, 8)}...
                            </span>
                            <CopyButton text={s.id} />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={s.status} />
                        </td>
                        <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                          <Calendar className="w-3.5 h-3.5 inline mr-1.5 text-slate-600" />
                          {formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}
                        </td>
                        <td className="px-4 py-3 text-slate-400 tabular-nums">
                          {formatDuration(s.duration_seconds)}
                        </td>
                        <td className="px-4 py-3 text-slate-400 tabular-nums">
                          {s.turns_used ?? '-'}
                        </td>
                        <td className="px-4 py-3 text-slate-400 tabular-nums">
                          {formatTokens(s.tokens_used)}
                        </td>
                        <td className="px-4 py-3 text-slate-300 tabular-nums font-medium">
                          {formatCost(s.budget_used_usd)}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs">
                          {s.stop_reason ?? '-'}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={9} className="bg-slate-900/40">
                            <SessionExpandedDetail session={s} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
