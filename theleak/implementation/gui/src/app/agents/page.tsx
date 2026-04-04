'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Filter,
  LayoutGrid,
  LayoutList,
  Plus,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  Activity,
  Zap,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Bot,
  ArrowUpRight,
  RefreshCw,
  Loader2,
  Shield,
  ShieldOff,
  MessageSquare,
  Hash,
  GitBranch,
} from 'lucide-react';
import { useApiContext } from '@/app/providers';
import type { AgentRun, AgentType, AgentMessage, RunStatus } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL = 5000;

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bgClass: string; textClass: string; dotClass: string; animate?: boolean }
> = {
  pending: {
    label: 'Pending',
    color: '#94a3b8',
    bgClass: 'bg-slate-500/15',
    textClass: 'text-slate-400',
    dotClass: 'bg-slate-400',
  },
  running: {
    label: 'Running',
    color: '#3b82f6',
    bgClass: 'bg-blue-500/15',
    textClass: 'text-blue-400',
    dotClass: 'bg-blue-400',
    animate: true,
  },
  completed: {
    label: 'Completed',
    color: '#10b981',
    bgClass: 'bg-emerald-500/15',
    textClass: 'text-emerald-400',
    dotClass: 'bg-emerald-400',
  },
  failed: {
    label: 'Failed',
    color: '#ef4444',
    bgClass: 'bg-red-500/15',
    textClass: 'text-red-400',
    dotClass: 'bg-red-400',
  },
  cancelled: {
    label: 'Cancelled',
    color: '#f59e0b',
    bgClass: 'bg-amber-500/15',
    textClass: 'text-amber-400',
    dotClass: 'bg-amber-400',
  },
  timeout: {
    label: 'Timeout',
    color: '#f59e0b',
    bgClass: 'bg-amber-500/15',
    textClass: 'text-amber-400',
    dotClass: 'bg-amber-400',
  },
};

const TYPE_COLORS: Record<string, string> = {
  explore: '#3B82F6',
  plan: '#8B5CF6',
  verification: '#10B981',
  guide: '#F59E0B',
  general_purpose: '#EF4444',
  statusline: '#6366F1',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number | null, startedAt: string | null, isRunning: boolean): string {
  if (ms != null) {
    return formatMs(ms);
  }
  if (isRunning && startedAt) {
    const elapsed = Date.now() - new Date(startedAt).getTime();
    return formatMs(elapsed);
  }
  return '--';
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours}h ${remainMinutes}m`;
}

function formatCost(usd: number | null): string {
  if (usd == null) return '$0.00';
  return `$${usd.toFixed(4)}`;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bgClass} ${cfg.textClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass} ${cfg.animate ? 'animate-pulse' : ''}`} />
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Type Badge
// ---------------------------------------------------------------------------

function TypeBadge({ typeName }: { typeName: string }) {
  const color = TYPE_COLORS[typeName] ?? '#6366F1';
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium"
      style={{ backgroundColor: `${color}20`, color }}
    >
      {typeName}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  glowClass,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  glowClass?: string;
}) {
  return (
    <div className={`glass-panel p-5 ${glowClass ?? ''}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="stat-label">{label}</span>
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Running Timer (live updating)
// ---------------------------------------------------------------------------

function RunningTimer({ startedAt, durationMs }: { startedAt: string | null; durationMs: number | null }) {
  const [elapsed, setElapsed] = useState<number>(durationMs ?? 0);

  useEffect(() => {
    if (durationMs != null) {
      setElapsed(durationMs);
      return;
    }
    if (!startedAt) return;

    const start = new Date(startedAt).getTime();
    setElapsed(Date.now() - start);

    const timer = setInterval(() => {
      setElapsed(Date.now() - start);
    }, 1000);

    return () => clearInterval(timer);
  }, [startedAt, durationMs]);

  return <span className="font-mono text-sm text-slate-300">{formatMs(elapsed)}</span>;
}

// ---------------------------------------------------------------------------
// Detail Panel (expandable)
// ---------------------------------------------------------------------------

function DetailPanel({ run, onClose }: { run: AgentRun; onClose: () => void }) {
  const api = useApiContext();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (!run.coordinator_run_id) return;
    setLoadingMessages(true);
    api.coordinator
      .getMessages(run.run_id, run.coordinator_run_id)
      .then((res) => setMessages(res.messages))
      .catch(() => {})
      .finally(() => setLoadingMessages(false));
  }, [api, run.coordinator_run_id, run.run_id]);

  const budgetPct =
    run.max_iterations_used > 0 && run.iteration_count != null
      ? Math.min((run.iteration_count / run.max_iterations_used) * 100, 100)
      : 0;

  const allowedTools = (run.metadata?.allowed_tools as string[] | undefined) ?? [];
  const deniedTools = (run.metadata?.denied_tools as string[] | undefined) ?? [];

  return (
    <div className="border-t border-slate-700/50 bg-slate-900/50 animate-fade-in">
      <div className="p-5 space-y-5">
        {/* Task prompt */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Task</h4>
          <p className="text-sm text-slate-300 whitespace-pre-wrap">{run.task_prompt}</p>
        </div>

        {/* System prompt (collapsible) */}
        {run.metadata?.system_prompt != null && (
          <div>
            <button
              onClick={() => setShowPrompt(!showPrompt)}
              className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors"
            >
              {showPrompt ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              System Prompt
            </button>
            {showPrompt && (
              <pre className="mt-2 p-3 bg-slate-800/60 rounded-lg text-xs text-slate-400 overflow-x-auto max-h-48 overflow-y-auto font-mono whitespace-pre-wrap">
                {run.metadata.system_prompt as string}
              </pre>
            )}
          </div>
        )}

        {/* Tool permissions */}
        {(allowedTools.length > 0 || deniedTools.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {allowedTools.length > 0 && (
              <div>
                <h4 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-emerald-500 mb-2">
                  <Shield className="w-3 h-3" /> Allowed Tools
                </h4>
                <div className="flex flex-wrap gap-1">
                  {allowedTools.map((t) => (
                    <span key={t} className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded text-xs font-mono">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {deniedTools.length > 0 && (
              <div>
                <h4 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-red-500 mb-2">
                  <ShieldOff className="w-3 h-3" /> Denied Tools
                </h4>
                <div className="flex flex-wrap gap-1">
                  {deniedTools.map((t) => (
                    <span key={t} className="px-2 py-0.5 bg-red-500/10 text-red-400 rounded text-xs font-mono">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Budget usage */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Budget Usage
            </h4>
            <span className="text-xs text-slate-400">
              {run.iteration_count ?? 0} / {run.max_iterations_used} turns
            </span>
          </div>
          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${budgetPct}%`,
                backgroundColor: budgetPct > 80 ? '#ef4444' : budgetPct > 50 ? '#f59e0b' : '#3b82f6',
              }}
            />
          </div>
          <div className="flex justify-between mt-1 text-xs text-slate-500">
            <span>Cost: {formatCost(run.total_cost_usd)}</span>
            <span>
              Tokens: {((run.total_input_tokens ?? 0) + (run.total_output_tokens ?? 0)).toLocaleString()}
            </span>
          </div>
        </div>

        {/* Output summary */}
        {run.output_summary && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Output</h4>
            <p className="text-sm text-slate-300 whitespace-pre-wrap">{run.output_summary}</p>
          </div>
        )}

        {/* Error details */}
        {run.error_message && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <h4 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-red-400 mb-1">
              <AlertTriangle className="w-3 h-3" /> Error
            </h4>
            <p className="text-sm text-red-300 font-mono whitespace-pre-wrap">{run.error_message}</p>
          </div>
        )}

        {/* Inter-agent messages */}
        <div>
          <h4 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            <MessageSquare className="w-3 h-3" /> Inter-Agent Messages ({messages.length})
          </h4>
          {loadingMessages ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading messages...
            </div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-slate-600">No messages</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {messages.map((msg) => (
                <div key={msg.id} className="p-2 bg-slate-800/40 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-400">
                      {msg.message_type}
                    </span>
                    <span className="text-xs text-slate-600">
                      {formatRelativeTime(msg.created_at)}
                    </span>
                  </div>
                  {msg.summary && (
                    <p className="text-xs text-slate-300">{msg.summary}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* View full detail link */}
        <div className="pt-2 border-t border-slate-700/30">
          <Link
            href={`/agents/${run.run_id}`}
            className="inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            View Full Details <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Card (grid view)
// ---------------------------------------------------------------------------

function AgentCard({
  run,
  expanded,
  onToggle,
}: {
  run: AgentRun;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isRunning = run.status === 'running';
  const statusCfg = STATUS_CONFIG[run.status] ?? STATUS_CONFIG.pending;

  return (
    <div
      className={`glass-panel-hover overflow-hidden transition-all duration-300 ${
        isRunning ? 'border-blue-500/30 glow-blue' : ''
      } ${run.status === 'failed' ? 'border-red-500/20' : ''}`}
    >
      <button
        onClick={onToggle}
        className="w-full text-left p-4 focus:outline-none focus:ring-1 focus:ring-blue-500/30 rounded-t-xl"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <Bot
              className="w-5 h-5 flex-shrink-0"
              style={{ color: TYPE_COLORS[run.agent_type_name] ?? '#6366F1' }}
            />
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-200 truncate">
                {run.run_id}
              </div>
              <TypeBadge typeName={run.agent_type_name} />
            </div>
          </div>
          <StatusBadge status={run.status} />
        </div>

        <p className="text-xs text-slate-400 line-clamp-2 mb-3">{run.task_prompt}</p>

        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <RunningTimer
              startedAt={run.started_at}
              durationMs={!isRunning ? run.duration_ms : null}
            />
          </span>
          <span className="flex items-center gap-1">
            <DollarSign className="w-3 h-3" />
            {formatCost(run.total_cost_usd)}
          </span>
          <span className="flex items-center gap-1">
            <Hash className="w-3 h-3" />
            {run.iteration_count ?? 0} turns
          </span>
          {run.parent_run_id && (
            <span className="flex items-center gap-1 text-violet-400">
              <GitBranch className="w-3 h-3" />
              sub-agent
            </span>
          )}
        </div>
      </button>

      {expanded && <DetailPanel run={run} onClose={onToggle} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Row (table view)
// ---------------------------------------------------------------------------

function AgentRow({
  run,
  expanded,
  onToggle,
}: {
  run: AgentRun;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isRunning = run.status === 'running';

  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-slate-800/50 transition-colors hover:bg-slate-800/40 ${
          isRunning ? 'bg-blue-500/5' : ''
        } ${expanded ? 'bg-slate-800/30' : ''}`}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot
              className="w-4 h-4 flex-shrink-0"
              style={{ color: TYPE_COLORS[run.agent_type_name] ?? '#6366F1' }}
            />
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-200 truncate max-w-[200px]">
                {run.run_id}
              </div>
              <TypeBadge typeName={run.agent_type_name} />
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={run.status} />
        </td>
        <td className="px-4 py-3">
          <RunningTimer
            startedAt={run.started_at}
            durationMs={!isRunning ? run.duration_ms : null}
          />
        </td>
        <td className="px-4 py-3 font-mono text-sm text-slate-300">
          {formatCost(run.total_cost_usd)}
        </td>
        <td className="px-4 py-3 text-sm text-slate-400">
          {run.iteration_count ?? 0}
        </td>
        <td className="px-4 py-3">
          {run.parent_run_id ? (
            <span className="inline-flex items-center gap-1 text-xs text-violet-400">
              <GitBranch className="w-3 h-3" /> sub-agent
            </span>
          ) : (
            <span className="text-xs text-slate-600">--</span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-slate-500">
          {formatRelativeTime(run.created_at)}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="p-0">
            <DetailPanel run={run} onClose={onToggle} />
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AgentMonitorPage() {
  const api = useApiContext();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [types, setTypes] = useState<AgentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('table');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Counts
  const running = runs.filter((r) => r.status === 'running').length;
  const completed = runs.filter((r) => r.status === 'completed').length;
  const failed = runs.filter((r) => r.status === 'failed').length;
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayTotal = runs.filter((r) => r.created_at.startsWith(todayStr)).length;

  const fetchRuns = useCallback(async () => {
    try {
      const params: Record<string, unknown> = { limit: 100 };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (typeFilter !== 'all') params.agent_type = typeFilter;

      const res = await api.coordinator.listRuns(params);
      setRuns(res.runs);
      setError(null);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to fetch agent runs');
    } finally {
      setLoading(false);
    }
  }, [api, statusFilter, typeFilter]);

  const fetchTypes = useCallback(async () => {
    try {
      const res = await api.coordinator.listTypes();
      setTypes(res.agent_types);
    } catch {
      // Non-critical
    }
  }, [api]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    fetchRuns();
    fetchTypes();
  }, [fetchRuns, fetchTypes]);

  // Auto-refresh when any agent is running
  useEffect(() => {
    const hasRunning = runs.some((r) => r.status === 'running' || r.status === 'pending');
    if (hasRunning) {
      pollRef.current = setInterval(() => fetchRuns(), POLL_INTERVAL);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [runs, fetchRuns]);

  const handleToggle = (runId: string) => {
    setExpandedId((prev) => (prev === runId ? null : runId));
  };

  const handleRefresh = () => {
    setLoading(true);
    fetchRuns();
  };

  return (
    <div className="min-h-screen p-6 md:p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-400" />
            Agent Monitor
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Track, inspect, and manage running agents
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            className="p-2 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 text-slate-400 hover:text-slate-200 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <Link
            href="/agents/spawn"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-blue-600/20"
          >
            <Plus className="w-4 h-4" />
            Spawn Agent
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-500" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
            <option value="timeout">Timeout</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
          >
            <option value="all">All Types</option>
            {types.map((t) => (
              <option key={t.name} value={t.name}>
                {t.display_name}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex items-center border border-slate-700/50 rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode('table')}
            className={`p-2 transition-colors ${
              viewMode === 'table'
                ? 'bg-slate-700/60 text-slate-200'
                : 'bg-slate-800/40 text-slate-500 hover:text-slate-300'
            }`}
            title="Table view"
          >
            <LayoutList className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 transition-colors ${
              viewMode === 'grid'
                ? 'bg-slate-700/60 text-slate-200'
                : 'bg-slate-800/40 text-slate-500 hover:text-slate-300'
            }`}
            title="Grid view"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Running"
          value={running}
          icon={Zap}
          color="#3b82f6"
          glowClass={running > 0 ? 'glow-blue border-glow' : undefined}
        />
        <StatCard label="Completed" value={completed} icon={CheckCircle2} color="#10b981" />
        <StatCard
          label="Failed"
          value={failed}
          icon={XCircle}
          color="#ef4444"
          glowClass={failed > 0 ? 'glow-red' : undefined}
        />
        <StatCard label="Today" value={todayTotal} icon={Activity} color="#8b5cf6" />
      </div>

      {/* Error banner */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-sm text-red-300">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          {error}
          <button
            onClick={handleRefresh}
            className="ml-auto text-red-400 hover:text-red-300 underline text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && runs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin mb-4 text-blue-400" />
          <p className="text-sm">Loading agents...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && runs.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <Bot className="w-12 h-12 mb-4 text-slate-700" />
          <p className="text-lg font-medium text-slate-400 mb-2">No agents found</p>
          <p className="text-sm text-slate-600 mb-6">
            {statusFilter !== 'all' || typeFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'Spawn a new agent to get started'}
          </p>
          <Link
            href="/agents/spawn"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Spawn Agent
          </Link>
        </div>
      )}

      {/* Grid view */}
      {!loading && runs.length > 0 && viewMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {runs.map((run) => (
            <AgentCard
              key={run.id}
              run={run}
              expanded={expandedId === run.run_id}
              onToggle={() => handleToggle(run.run_id)}
            />
          ))}
        </div>
      )}

      {/* Table view */}
      {!loading && runs.length > 0 && viewMode === 'table' && (
        <div className="glass-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700/50 text-left">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Agent
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Status
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Duration
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Cost
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Turns
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Parent
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <AgentRow
                    key={run.id}
                    run={run}
                    expanded={expandedId === run.run_id}
                    onToggle={() => handleToggle(run.run_id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Polling indicator */}
      {runs.some((r) => r.status === 'running' || r.status === 'pending') && (
        <div className="fixed bottom-6 right-6 flex items-center gap-2 px-3 py-2 bg-blue-600/20 border border-blue-500/30 rounded-full text-xs text-blue-300 backdrop-blur-sm">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          Auto-refreshing every 5s
        </div>
      )}
    </div>
  );
}
