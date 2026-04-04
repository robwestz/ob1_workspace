'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Bot,
  DollarSign,
  Hash,
  GitBranch,
  Shield,
  ShieldOff,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  StopCircle,
  PlayCircle,
  Copy,
  Check,
  FileText,
  Target,
} from 'lucide-react';
import { useApiContext } from '@/app/providers';
import type { AgentRun, AgentMessage } from '@/lib/api-client';

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

function formatTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// ---------------------------------------------------------------------------
// Status Badge (large variant)
// ---------------------------------------------------------------------------

function StatusBadgeLarge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold ${cfg.bgClass} ${cfg.textClass}`}
    >
      <span
        className={`w-2.5 h-2.5 rounded-full ${cfg.dotClass} ${cfg.animate ? 'animate-pulse' : ''}`}
        style={cfg.animate ? { boxShadow: `0 0 12px ${cfg.color}` } : undefined}
      />
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Live Timer
// ---------------------------------------------------------------------------

function LiveTimer({ startedAt, durationMs }: { startedAt: string | null; durationMs: number | null }) {
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

  return <span className="font-mono">{formatMs(elapsed)}</span>;
}

// ---------------------------------------------------------------------------
// Copy Button
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded text-slate-500 hover:text-slate-300 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Section Component
// ---------------------------------------------------------------------------

function Section({
  title,
  icon: Icon,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="glass-panel overflow-hidden">
      <button
        onClick={collapsible ? () => setOpen(!open) : undefined}
        className={`w-full flex items-center gap-2 px-5 py-4 text-left ${
          collapsible ? 'cursor-pointer hover:bg-slate-800/40' : 'cursor-default'
        } transition-colors`}
      >
        <Icon className="w-4 h-4 text-slate-400" />
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 flex-1">
          {title}
        </h3>
        {collapsible && (
          open ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />
        )}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message Type Badge
// ---------------------------------------------------------------------------

function MessageTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    data: 'text-blue-400 bg-blue-500/10',
    finding: 'text-emerald-400 bg-emerald-500/10',
    request: 'text-violet-400 bg-violet-500/10',
    status_update: 'text-amber-400 bg-amber-500/10',
    error: 'text-red-400 bg-red-500/10',
    completion: 'text-emerald-400 bg-emerald-500/10',
  };
  const cls = colors[type] ?? 'text-slate-400 bg-slate-500/10';

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{type}</span>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AgentDetailPage() {
  const params = useParams();
  const api = useApiContext();
  const runId = params.runId as string;

  const [run, setRun] = useState<AgentRun | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [resuming, setResuming] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRun = useCallback(
    async () => {
      try {
        const res = await api.coordinator.getRun(runId);
        setRun(res.run);
        setError(null);

        // Also fetch messages if has coordinator
        if (res.run.coordinator_run_id) {
          const msgRes = await api.coordinator.getMessages(
            runId,
            res.run.coordinator_run_id,
          );
          setMessages(msgRes.messages);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to fetch agent details');
      } finally {
        setLoading(false);
      }
    },
    [api, runId],
  );

  // Initial load
  useEffect(() => {
    fetchRun();
  }, [fetchRun]);

  // Poll if running
  useEffect(() => {
    const isActive = run?.status === 'running' || run?.status === 'pending';
    if (isActive) {
      pollRef.current = setInterval(() => fetchRun(), POLL_INTERVAL);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [run?.status, fetchRun]);

  const handleCancel = async () => {
    if (!run) return;
    setCancelling(true);
    try {
      await api.coordinator.updateStatus(run.run_id, 'cancelled');
      await fetchRun();
    } catch {
      // Will show in next refresh
    } finally {
      setCancelling(false);
    }
  };

  const handleResume = async () => {
    if (!run) return;
    setResuming(true);
    try {
      await api.coordinator.updateStatus(run.run_id, 'running');
      await fetchRun();
    } catch {
      // Will show in next refresh
    } finally {
      setResuming(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400 mb-4" />
        <p className="text-sm text-slate-500">Loading agent details...</p>
      </div>
    );
  }

  // Error state
  if (error || !run) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <AlertTriangle className="w-10 h-10 text-red-400 mb-4" />
        <p className="text-lg font-medium text-slate-300 mb-2">Failed to load agent</p>
        <p className="text-sm text-slate-500 mb-6">{error ?? 'Agent not found'}</p>
        <Link
          href="/agents"
          className="inline-flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Agent Monitor
        </Link>
      </div>
    );
  }

  const isRunning = run.status === 'running';
  const isFailed = run.status === 'failed' || run.status === 'timeout';
  const typeColor = TYPE_COLORS[run.agent_type_name] ?? '#6366F1';

  const budgetPct =
    run.max_iterations_used > 0 && run.iteration_count != null
      ? Math.min((run.iteration_count / run.max_iterations_used) * 100, 100)
      : 0;

  const allowedTools = (run.metadata?.allowed_tools as string[] | undefined) ?? [];
  const deniedTools = (run.metadata?.denied_tools as string[] | undefined) ?? [];
  const systemPrompt = (run.metadata?.system_prompt as string | undefined) ?? null;

  return (
    <div className="min-h-screen p-6 md:p-8 max-w-5xl mx-auto space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/agents" className="text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" />
          Agent Monitor
        </Link>
        <span className="text-slate-700">/</span>
        <span className="text-slate-400 font-mono text-xs truncate max-w-[300px]">{run.run_id}</span>
      </div>

      {/* Header */}
      <div
        className={`glass-panel p-6 ${isRunning ? 'border-blue-500/30 glow-blue' : ''} ${
          isFailed ? 'border-red-500/20' : ''
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className="p-3 rounded-xl"
              style={{ backgroundColor: `${typeColor}15` }}
            >
              <Bot className="w-6 h-6" style={{ color: typeColor }} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl font-bold text-slate-100">{run.agent_type_name}</h1>
                <span
                  className="px-2 py-0.5 rounded text-xs font-mono font-medium"
                  style={{ backgroundColor: `${typeColor}20`, color: typeColor }}
                >
                  {run.agent_type_name}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
                <span>{run.run_id}</span>
                <CopyButton text={run.run_id} />
              </div>
              <p className="text-sm text-slate-400 mt-2">{formatTimestamp(run.created_at)}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <StatusBadgeLarge status={run.status} />

            {isRunning && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {cancelling ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <StopCircle className="w-4 h-4" />
                )}
                Cancel Agent
              </button>
            )}

            {isFailed && (
              <button
                onClick={handleResume}
                disabled={resuming}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {resuming ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <PlayCircle className="w-4 h-4" />
                )}
                Resume
              </button>
            )}
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-5 border-t border-slate-700/30">
          <div>
            <div className="stat-label mb-1">Duration</div>
            <div className="text-lg font-semibold text-slate-200">
              <LiveTimer
                startedAt={run.started_at}
                durationMs={!isRunning ? run.duration_ms : null}
              />
            </div>
          </div>
          <div>
            <div className="stat-label mb-1">Cost</div>
            <div className="text-lg font-semibold text-slate-200 font-mono">
              {formatCost(run.total_cost_usd)}
            </div>
          </div>
          <div>
            <div className="stat-label mb-1">Turns</div>
            <div className="text-lg font-semibold text-slate-200">
              {run.iteration_count ?? 0} / {run.max_iterations_used}
            </div>
          </div>
          <div>
            <div className="stat-label mb-1">Tokens</div>
            <div className="text-lg font-semibold text-slate-200">
              {((run.total_input_tokens ?? 0) + (run.total_output_tokens ?? 0)).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Task prompt */}
      <Section title="Task" icon={Target}>
        <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">{run.task_prompt}</p>
        {Object.keys(run.task_context).length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-700/30">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Context
            </h4>
            <pre className="text-xs text-slate-400 font-mono bg-slate-800/40 p-3 rounded-lg overflow-x-auto">
              {JSON.stringify(run.task_context, null, 2)}
            </pre>
          </div>
        )}
      </Section>

      {/* System prompt */}
      {systemPrompt && (
        <Section title="System Prompt" icon={FileText} collapsible defaultOpen={false}>
          <pre className="text-sm text-slate-300 font-mono whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
            {systemPrompt}
          </pre>
        </Section>
      )}

      {/* Tool permissions */}
      {(allowedTools.length > 0 || deniedTools.length > 0) && (
        <Section title="Tool Permissions" icon={Shield}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {allowedTools.length > 0 && (
              <div>
                <h4 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-emerald-500 mb-3">
                  <Shield className="w-3 h-3" /> Allowed ({allowedTools.length})
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {allowedTools.map((t) => (
                    <span
                      key={t}
                      className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 rounded-md text-xs font-mono"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {deniedTools.length > 0 && (
              <div>
                <h4 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-red-500 mb-3">
                  <ShieldOff className="w-3 h-3" /> Denied ({deniedTools.length})
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {deniedTools.map((t) => (
                    <span
                      key={t}
                      className="px-2.5 py-1 bg-red-500/10 text-red-400 rounded-md text-xs font-mono"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Budget usage */}
      <Section title="Budget Usage" icon={DollarSign}>
        <div className="space-y-4">
          {/* Turn budget */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-slate-400">Turn Usage</span>
              <span className="text-sm font-mono text-slate-300">
                {run.iteration_count ?? 0} / {run.max_iterations_used}
              </span>
            </div>
            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${budgetPct}%`,
                  backgroundColor:
                    budgetPct > 80 ? '#ef4444' : budgetPct > 50 ? '#f59e0b' : '#3b82f6',
                }}
              />
            </div>
          </div>

          {/* Token breakdown */}
          <div className="grid grid-cols-3 gap-4 pt-3 border-t border-slate-700/30">
            <div>
              <div className="stat-label mb-1">Input Tokens</div>
              <div className="text-sm font-semibold text-slate-300 font-mono">
                {(run.total_input_tokens ?? 0).toLocaleString()}
              </div>
            </div>
            <div>
              <div className="stat-label mb-1">Output Tokens</div>
              <div className="text-sm font-semibold text-slate-300 font-mono">
                {(run.total_output_tokens ?? 0).toLocaleString()}
              </div>
            </div>
            <div>
              <div className="stat-label mb-1">Total Cost</div>
              <div className="text-sm font-semibold text-slate-300 font-mono">
                {formatCost(run.total_cost_usd)}
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Output */}
      {run.output_summary && (
        <Section title="Output" icon={CheckCircle2}>
          <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
            {run.output_summary}
          </p>
          {run.output_data && Object.keys(run.output_data).length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-700/30">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Structured Output
              </h4>
              <pre className="text-xs text-slate-400 font-mono bg-slate-800/40 p-3 rounded-lg overflow-x-auto max-h-64 overflow-y-auto">
                {JSON.stringify(run.output_data, null, 2)}
              </pre>
            </div>
          )}
        </Section>
      )}

      {/* Error details */}
      {run.error_message && (
        <Section title="Error Details" icon={AlertTriangle}>
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
            <pre className="text-sm text-red-300 font-mono whitespace-pre-wrap">
              {run.error_message}
            </pre>
          </div>
        </Section>
      )}

      {/* Inter-agent messages */}
      <Section title={`Inter-Agent Messages (${messages.length})`} icon={MessageSquare}>
        {messages.length === 0 ? (
          <p className="text-sm text-slate-600">No inter-agent messages for this run.</p>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className="p-4 bg-slate-800/40 rounded-lg border border-slate-700/30"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <MessageTypeBadge type={msg.message_type} />
                    <span className="text-xs text-slate-500">ch: {msg.channel}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{formatTimestamp(msg.created_at)}</span>
                    {msg.delivered && (
                      <span className="flex items-center gap-1 text-emerald-500">
                        <Check className="w-3 h-3" /> delivered
                      </span>
                    )}
                  </div>
                </div>

                {msg.summary && (
                  <p className="text-sm text-slate-300 mb-2">{msg.summary}</p>
                )}

                <pre className="text-xs text-slate-400 font-mono bg-slate-900/50 p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">
                  {JSON.stringify(msg.content, null, 2)}
                </pre>

                <div className="flex items-center gap-3 mt-2 text-xs text-slate-600">
                  <span>from: {msg.from_run_id}</span>
                  <span>to: {msg.to_run_id ?? 'broadcast'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Dependencies / parent */}
      {(run.parent_run_id || run.coordinator_run_id || run.depends_on.length > 0) && (
        <Section title="Agent Relationships" icon={GitBranch}>
          <div className="space-y-3">
            {run.parent_run_id && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500 w-24">Parent:</span>
                <Link
                  href={`/agents/${run.parent_run_id}`}
                  className="text-sm text-blue-400 hover:text-blue-300 font-mono transition-colors"
                >
                  {run.parent_run_id}
                </Link>
              </div>
            )}
            {run.coordinator_run_id && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500 w-24">Coordinator:</span>
                <span className="text-sm text-slate-300 font-mono">{run.coordinator_run_id}</span>
              </div>
            )}
            {run.depends_on.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="text-sm text-slate-500 w-24 pt-0.5">Depends on:</span>
                <div className="flex flex-wrap gap-1">
                  {run.depends_on.map((dep) => (
                    <span key={dep} className="px-2 py-0.5 bg-slate-800 rounded text-xs font-mono text-slate-400">
                      {dep}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Metadata */}
      {Object.keys(run.metadata).length > 0 && (
        <Section title="Metadata" icon={Hash} collapsible defaultOpen={false}>
          <pre className="text-xs text-slate-400 font-mono bg-slate-800/40 p-3 rounded-lg overflow-x-auto max-h-64 overflow-y-auto">
            {JSON.stringify(run.metadata, null, 2)}
          </pre>
        </Section>
      )}

      {/* Polling indicator */}
      {(run.status === 'running' || run.status === 'pending') && (
        <div className="fixed bottom-6 right-6 flex items-center gap-2 px-3 py-2 bg-blue-600/20 border border-blue-500/30 rounded-full text-xs text-blue-300 backdrop-blur-sm">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          Live -- updating every 5s
        </div>
      )}
    </div>
  );
}
