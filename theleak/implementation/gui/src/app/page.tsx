'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock,
  DollarSign,
  Info,
  Moon,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Stethoscope,
  XCircle,
  Zap,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { formatDistanceToNow } from 'date-fns';
import {
  type AgentSummary,
  type DoctorResult,
  type SystemEvent,
  type HealthStatus,
  type NightRunConfig,
} from '@/lib/api-client';
import { useApiContext } from './providers';
import { StatCard } from '@/components/ui/stat-card';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayISOString(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function relativeTime(ts: string): string {
  try {
    return formatDistanceToNow(new Date(ts), { addSuffix: true });
  } catch {
    return ts;
  }
}

function formatUSD(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDurationMs(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// Skeleton Components
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <div className="rounded-2xl bg-ob1-card border border-ob1-border p-6 animate-fade-in">
      <div className="skeleton h-4 w-24 mb-4" />
      <div className="skeleton h-8 w-16 mb-2" />
      <div className="skeleton h-3 w-32" />
    </div>
  );
}

function SkeletonEventRow() {
  return (
    <div className="flex items-start gap-3 py-3 animate-fade-in">
      <div className="skeleton h-8 w-8 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-4 w-3/4" />
        <div className="skeleton h-3 w-1/3" />
      </div>
    </div>
  );
}

function SkeletonNightRun() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="skeleton h-4 w-40 mb-4" />
      <div className="skeleton h-3 w-full rounded-full" />
      <div className="flex justify-center">
        <div className="skeleton h-40 w-40 rounded-full" />
      </div>
      <div className="skeleton h-4 w-24" />
    </div>
  );
}

type CardColor = 'blue' | 'green' | 'amber' | 'red';

// ---------------------------------------------------------------------------
// Health Status Badge
// ---------------------------------------------------------------------------

function healthColor(status: HealthStatus): CardColor {
  if (status === 'pass') return 'green';
  if (status === 'warn') return 'amber';
  return 'red';
}

function healthLabel(status: HealthStatus): string {
  if (status === 'pass') return 'Healthy';
  if (status === 'warn') return 'Warning';
  return 'Failing';
}

function HealthIcon({ status }: { status: HealthStatus }) {
  if (status === 'pass') return <ShieldCheck className="w-4 h-4" />;
  if (status === 'warn') return <AlertTriangle className="w-4 h-4" />;
  return <XCircle className="w-4 h-4" />;
}

// ---------------------------------------------------------------------------
// Severity Badge
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    info: 'bg-slate-500/15 text-slate-400 ring-slate-500/20',
    warn: 'bg-amber-500/15 text-amber-400 ring-amber-500/20',
    error: 'bg-red-500/15 text-red-400 ring-red-500/20',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium
        ring-1 ${styles[severity] ?? styles.info}`}
    >
      {severity}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Event Icon
// ---------------------------------------------------------------------------

function EventIcon({ severity }: { severity: string }) {
  const base = 'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0';
  if (severity === 'error')
    return (
      <div className={`${base} bg-red-500/15`}>
        <XCircle className="w-4 h-4 text-red-400" />
      </div>
    );
  if (severity === 'warn')
    return (
      <div className={`${base} bg-amber-500/15`}>
        <AlertTriangle className="w-4 h-4 text-amber-400" />
      </div>
    );
  return (
    <div className={`${base} bg-slate-500/15`}>
      <Info className="w-4 h-4 text-slate-400" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity Feed
// ---------------------------------------------------------------------------

function ActivityFeed({
  events,
  loading,
}: {
  events: SystemEvent[];
  loading: boolean;
}) {
  return (
    <div
      className="rounded-2xl bg-ob1-card border border-ob1-border p-6
        animate-slide-in flex flex-col"
    >
      <div className="flex items-center gap-2 mb-5">
        <Activity className="w-5 h-5 text-ob1-primary-light" />
        <h2 className="text-lg font-semibold text-ob1-text">Recent Activity</h2>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-ob1-text-dim">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          Live
        </div>
      </div>

      <div className="flex-1 overflow-y-auto max-h-[400px] -mx-2 px-2 space-y-0.5">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonEventRow key={i} />)
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-ob1-text-dim">
            <Activity className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">No recent events</p>
          </div>
        ) : (
          events.map((ev) => (
            <div
              key={ev.id}
              className="flex items-start gap-3 py-3 px-2 rounded-xl
                transition-colors duration-150 hover:bg-slate-800/50 group cursor-default"
            >
              <EventIcon severity={ev.severity} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-ob1-text truncate">
                    {ev.title}
                  </p>
                  <SeverityBadge severity={ev.severity} />
                </div>
                <p className="text-xs text-ob1-text-dim mt-0.5">
                  {relativeTime(ev.timestamp)}
                  {ev.source && (
                    <span className="ml-2 text-ob1-text-dim/60">
                      via {ev.source}
                    </span>
                  )}
                </p>
              </div>
              <ChevronRight
                className="w-4 h-4 text-ob1-text-dim opacity-0 group-hover:opacity-100
                  transition-opacity mt-1 flex-shrink-0"
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Night Run Panel
// ---------------------------------------------------------------------------

/** Shape we derive for the Night Run panel from AgentSummary + coordinator run */
interface NightRunData {
  id: string;
  status: string;
  tasksCompleted: number;
  tasksTotal: number;
  budgetUsed: number;
  budgetLimit: number;
  durationMs: number | null;
}

function NightRunPanel({
  nightRun,
  loading,
}: {
  nightRun: NightRunData | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-2xl bg-ob1-card border border-ob1-border p-6 animate-slide-in">
        <SkeletonNightRun />
      </div>
    );
  }

  if (!nightRun) {
    return (
      <div className="rounded-2xl bg-ob1-card border border-ob1-border p-6 animate-slide-in">
        <div className="flex items-center gap-2 mb-5">
          <Moon className="w-5 h-5 text-indigo-400" />
          <h2 className="text-lg font-semibold text-ob1-text">Night Run</h2>
        </div>
        <div className="flex flex-col items-center justify-center py-10 text-ob1-text-dim">
          <Moon className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm font-medium">No recent night run</p>
          <p className="text-xs mt-1 text-ob1-text-dim/70">
            Schedule one from Quick Actions below
          </p>
        </div>
      </div>
    );
  }

  const taskPct =
    nightRun.tasksTotal > 0
      ? Math.round((nightRun.tasksCompleted / nightRun.tasksTotal) * 100)
      : 0;

  const budgetPct =
    nightRun.budgetLimit > 0
      ? Math.round((nightRun.budgetUsed / nightRun.budgetLimit) * 100)
      : 0;
  const budgetRemaining = Math.max(0, nightRun.budgetLimit - nightRun.budgetUsed);

  const donutData = [
    { name: 'Used', value: nightRun.budgetUsed },
    { name: 'Remaining', value: budgetRemaining },
  ];

  const donutColors = ['#f59e0b', '#1e293b'];

  const isRunning = nightRun.status === 'running';
  const isCompleted = nightRun.status === 'completed';
  const isFailed = nightRun.status === 'failed';

  return (
    <div className="rounded-2xl bg-ob1-card border border-ob1-border p-6 animate-slide-in">
      <div className="flex items-center gap-2 mb-5">
        <Moon className="w-5 h-5 text-indigo-400" />
        <h2 className="text-lg font-semibold text-ob1-text">Night Run</h2>
        {isRunning && (
          <span className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-400 text-xs font-medium ring-1 ring-blue-500/20">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-400" />
            </span>
            Running
          </span>
        )}
        {isCompleted && (
          <span className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-medium ring-1 ring-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" />
            Completed
          </span>
        )}
        {isFailed && (
          <span className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/15 text-red-400 text-xs font-medium ring-1 ring-red-500/20">
            <XCircle className="w-3 h-3" />
            Failed
          </span>
        )}
      </div>

      {/* Task Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-ob1-text-muted">Tasks</span>
          <span className="text-sm font-mono text-ob1-text">
            {nightRun.tasksCompleted} / {nightRun.tasksTotal}
          </span>
        </div>
        <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${
              isFailed
                ? 'bg-gradient-to-r from-red-500 to-red-400'
                : 'bg-gradient-to-r from-blue-600 to-blue-400'
            }`}
            style={{ width: `${taskPct}%` }}
          />
        </div>
        <p className="text-xs text-ob1-text-dim mt-1.5">{taskPct}% complete</p>
      </div>

      {/* Budget Donut */}
      <div className="flex items-center gap-6 mb-6">
        <div className="w-32 h-32 flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={donutData}
                innerRadius={38}
                outerRadius={55}
                paddingAngle={3}
                dataKey="value"
                startAngle={90}
                endAngle={-270}
                stroke="none"
              >
                {donutData.map((_, i) => (
                  <Cell key={i} fill={donutColors[i]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div>
          <p className="text-sm text-ob1-text-muted mb-1">Budget</p>
          <p className="text-2xl font-bold text-ob1-text">
            {formatUSD(nightRun.budgetUsed)}
          </p>
          <p className="text-xs text-ob1-text-dim">
            of {formatUSD(nightRun.budgetLimit)} ({budgetPct}%)
          </p>
        </div>
      </div>

      {/* Duration */}
      {nightRun.durationMs != null && (
        <div className="flex items-center gap-2 mb-4 text-sm text-ob1-text-muted">
          <Clock className="w-4 h-4" />
          <span>Duration: {formatDurationMs(nightRun.durationMs)}</span>
        </div>
      )}

      {/* Link to full report */}
      <a
        href={`/runs/${nightRun.id}`}
        className="inline-flex items-center gap-1.5 text-sm text-ob1-primary-light
          hover:text-blue-300 transition-colors font-medium mt-2"
      >
        View full morning report
        <ChevronRight className="w-4 h-4" />
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick Action Button
// ---------------------------------------------------------------------------

function QuickAction({
  label,
  icon: Icon,
  onClick,
  variant = 'default',
}: {
  label: string;
  icon: React.ElementType;
  onClick?: () => void;
  variant?: 'primary' | 'default';
}) {
  const base = `flex items-center gap-3 px-5 py-3.5 rounded-xl font-medium text-sm
    transition-all duration-200 cursor-pointer border`;

  const styles =
    variant === 'primary'
      ? `${base} bg-blue-600 hover:bg-blue-500 text-white border-blue-500/30
         shadow-lg shadow-blue-600/20 hover:shadow-blue-500/30`
      : `${base} bg-ob1-card hover:bg-ob1-card-hover text-ob1-text border-ob1-border
         hover:border-ob1-border-light`;

  return (
    <button onClick={onClick} className={styles}>
      <Icon className="w-5 h-5" />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Error Banner
// ---------------------------------------------------------------------------

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 px-5 py-4 rounded-2xl
        bg-red-500/10 border border-red-500/20 text-red-300 animate-fade-in"
    >
      <AlertTriangle className="w-5 h-5 flex-shrink-0" />
      <p className="flex-1 text-sm">{message}</p>
      <button
        onClick={onRetry}
        className="text-sm font-medium text-red-300 hover:text-red-200
          underline underline-offset-2 transition-colors"
      >
        Retry
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Night Run Config Modal
// ---------------------------------------------------------------------------

function NightRunModal({
  open,
  onClose,
  onStart,
}: {
  open: boolean;
  onClose: () => void;
  onStart: (tasks: string[]) => void;
}) {
  const [taskInput, setTaskInput] = useState('');
  const [starting, setStarting] = useState(false);

  if (!open) return null;

  const handleStart = async () => {
    setStarting(true);
    const tasks = taskInput
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    onStart(tasks);
    setStarting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Modal */}
      <div
        className="relative z-10 w-full max-w-lg mx-4 rounded-2xl bg-slate-900
          border border-ob1-border shadow-2xl animate-slide-in"
      >
        <div className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-xl bg-indigo-500/15 ring-1 ring-indigo-500/20">
              <Moon className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-ob1-text">
                Start Night Run
              </h3>
              <p className="text-sm text-ob1-text-dim">
                Configure tasks for overnight execution
              </p>
            </div>
          </div>

          <label className="block mb-2 text-sm font-medium text-ob1-text-muted">
            Tasks (one per line)
          </label>
          <textarea
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            rows={6}
            placeholder={"Review and categorize today's thoughts\nGenerate weekly summary report\nRun memory consolidation"}
            className="w-full rounded-xl bg-slate-800 border border-ob1-border px-4 py-3
              text-sm text-ob1-text placeholder:text-ob1-text-dim/50
              focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40
              resize-none font-mono"
          />

          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-ob1-text-muted
                hover:text-ob1-text transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleStart}
              disabled={starting}
              className="px-5 py-2 rounded-xl text-sm font-medium bg-blue-600
                hover:bg-blue-500 text-white transition-colors shadow-lg shadow-blue-600/20
                disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {starting ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Launch
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Dashboard Page
// ===========================================================================

export default function DashboardPage() {
  const api = useApiContext();

  // ---- State ----
  const [activeAgents, setActiveAgents] = useState<number | null>(null);
  const [tasksToday, setTasksToday] = useState<number | null>(null);
  const [budgetUsed, setBudgetUsed] = useState<number | null>(null);
  const [budgetLimit, setBudgetLimit] = useState<number | null>(null);
  const [health, setHealth] = useState<DoctorResult | null>(null);
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [nightRun, setNightRun] = useState<NightRunData | null>(null);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nightRunModalOpen, setNightRunModalOpen] = useState(false);

  // ---- Data Fetch ----
  const fetchDashboard = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);

    try {
      const [
        runningRuns,
        completedRuns,
        sessions,
        doctorResult,
        recentEvents,
      ] = await Promise.allSettled([
        api.coordinator.listRuns({ status: 'running' }),
        api.coordinator.listRuns({ status: 'completed' }),
        api.state.listSessions({ limit: 1 }),
        api.doctor.run(),
        api.events.query({ limit: 20 }),
      ]);

      // Active agents — count from running runs
      if (runningRuns.status === 'fulfilled') {
        const { runs, count } = runningRuns.value;
        setActiveAgents(count ?? runs.length);
      }

      // Tasks completed today — filter by today's date on the client
      if (completedRuns.status === 'fulfilled') {
        const todayStr = todayISOString();
        const todayRuns = completedRuns.value.runs.filter(
          (r) => r.completed_at && r.completed_at >= todayStr,
        );
        setTasksToday(todayRuns.length);

        // Look for a coordinator-type run (night run) among all runs
        const allRuns = [
          ...(runningRuns.status === 'fulfilled' ? runningRuns.value.runs : []),
          ...completedRuns.value.runs,
        ];
        const coordinatorRun = allRuns.find(
          (r) => r.agent_type_name === 'coordinator',
        );

        if (coordinatorRun) {
          // Build NightRunData from the AgentRun + optional summary
          let summary: AgentSummary | null = null;
          if (coordinatorRun.coordinator_run_id) {
            try {
              summary = await api.coordinator.getSummary(
                coordinatorRun.coordinator_run_id,
              );
            } catch {
              // summary fetch failed — that's fine, use what we have
            }
          }

          const completedCount = summary
            ? summary.by_status['completed'] ?? 0
            : coordinatorRun.status === 'completed' ? 1 : 0;
          const totalCount = summary?.total_agents ?? 1;

          setNightRun({
            id: coordinatorRun.run_id,
            status: summary?.overall_status ?? coordinatorRun.status,
            tasksCompleted: completedCount,
            tasksTotal: totalCount,
            budgetUsed: summary?.totals.cost_usd ?? coordinatorRun.total_cost_usd ?? 0,
            budgetLimit:
              (coordinatorRun.task_context as any)?.config?.total_budget_usd ?? 10,
            durationMs: summary?.totals.duration_ms ?? coordinatorRun.duration_ms,
          });
        } else {
          setNightRun(null);
        }
      }

      // Budget from latest session
      if (sessions.status === 'fulfilled' && sessions.value.length > 0) {
        const s = sessions.value[0];
        setBudgetUsed(s.budget_used_usd);
        setBudgetLimit(s.budget_limit_usd);
      }

      // Doctor health
      if (doctorResult.status === 'fulfilled') {
        setHealth(doctorResult.value);
      }

      // Events
      if (recentEvents.status === 'fulfilled') {
        setEvents(recentEvents.value);
      }

      // Check if all critical calls failed
      const allFailed = [
        runningRuns,
        completedRuns,
        sessions,
        doctorResult,
        recentEvents,
      ].every((r) => r.status === 'rejected');
      if (allFailed) {
        setError(
          'Unable to reach OB1 services. Check your connection and API configuration.',
        );
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError('Failed to load dashboard data. Please try again.');
      }
    } finally {
      setLoading(false);
      setEventsLoading(false);
    }
  }, [api]);

  // Initial load
  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Auto-refresh every 10s
  useEffect(() => {
    const interval = setInterval(() => {
      fetchDashboard(true);
    }, 10_000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  // ---- Handlers ----
  const handleStartNightRun = async (tasks: string[]) => {
    try {
      const config: NightRunConfig = {
        total_budget_usd: 5,
        max_duration_hours: 8,
        max_concurrent_agents: 3,
        model: 'sonnet',
      };
      await api.tasks.startNightRun(config, tasks);
      fetchDashboard();
    } catch {
      setError('Failed to start night run.');
    }
  };

  const handleRunDoctor = async () => {
    try {
      setHealth(null);
      const result = await api.doctor.run();
      setHealth(result);
    } catch {
      setError('Doctor check failed.');
    }
  };

  // ---- Derived values ----
  const budgetPct =
    budgetUsed != null && budgetLimit != null && budgetLimit > 0
      ? Math.round((budgetUsed / budgetLimit) * 100)
      : null;

  const healthStatus: HealthStatus = health?.overall ?? 'pass';
  const hColor = healthColor(healthStatus);

  // ---- Render ----
  return (
    <>
      <div className="space-y-8">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
              Dashboard
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              System overview &mdash;{' '}
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
              })}
            </p>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <ErrorBanner message={error} onRetry={() => fetchDashboard()} />
        )}

        {/* Row 1: Stat Cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              <StatCard
                label="Active Agents"
                value={activeAgents ?? 0}
                subtitle={
                  activeAgents === 1
                    ? '1 agent running'
                    : `${activeAgents ?? 0} agents running`
                }
                color="blue"
                icon={Bot}
              />
              <StatCard
                label="Completed Today"
                value={tasksToday ?? 0}
                subtitle="Tasks finished since midnight"
                color="green"
                icon={CheckCircle2}
              />
              <StatCard
                label="Budget Used"
                value={budgetUsed != null ? formatUSD(budgetUsed) : '--'}
                subtitle={
                  budgetPct != null
                    ? `${budgetPct}% of ${formatUSD(budgetLimit ?? 0)} limit`
                    : 'No session data'
                }
                color="amber"
                icon={DollarSign}
              />
              <StatCard
                label="System Health"
                value={healthLabel(healthStatus)}
                subtitle={
                  health
                    ? `${health.checks.filter((c) => c.status === 'pass').length}/${health.checks.length} checks passed`
                    : 'Run a health check'
                }
                color={hColor}
                icon={() => <HealthIcon status={healthStatus} />}
              />
            </>
          )}
        </section>

        {/* Row 2: Two Columns */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ActivityFeed events={events} loading={eventsLoading} />
          <NightRunPanel nightRun={nightRun} loading={loading} />
        </section>

        {/* Row 3: Project Cards */}
        <section className="animate-slide-in">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-semibold text-slate-100">Projects</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { name: 'OB1 Runtime', desc: 'Agentic coordinator + agents', href: '/sessions', color: 'text-blue-400', bg: 'bg-blue-500/10 ring-blue-500/20' },
              { name: 'Dashboard', desc: 'Next.js control plane', href: '/', color: 'text-emerald-400', bg: 'bg-emerald-500/10 ring-emerald-500/20' },
              { name: 'Bacowr', desc: 'SEO engine SaaS', href: '/tools', color: 'text-purple-400', bg: 'bg-purple-500/10 ring-purple-500/20' },
              { name: 'OB1 Control', desc: 'CLI + monitoring', href: '/monitoring', color: 'text-amber-400', bg: 'bg-amber-500/10 ring-amber-500/20' },
            ].map((p) => (
              <a
                key={p.name}
                href={p.href}
                className="group rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition-all duration-200 hover:border-slate-700/60 hover:bg-slate-800/40 hover:shadow-lg"
              >
                <div className={`inline-flex p-2 rounded-lg ring-1 ${p.bg} mb-3`}>
                  <Zap className={`w-4 h-4 ${p.color}`} />
                </div>
                <h3 className="text-sm font-semibold text-slate-200 mb-0.5">{p.name}</h3>
                <p className="text-xs text-slate-500">{p.desc}</p>
              </a>
            ))}
          </div>
        </section>

        {/* Row 4: Active Session Indicator + Last Night Summary */}
        {nightRun && nightRun.status === 'running' && (
          <section className="animate-fade-in">
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-5 py-4 flex items-center gap-4">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
              </span>
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-300">Night session active</p>
                <p className="text-xs text-blue-400/70">
                  {nightRun.tasksCompleted}/{nightRun.tasksTotal} tasks completed &mdash; {formatUSD(nightRun.budgetUsed)} spent
                </p>
              </div>
              <a
                href={`/runs/${nightRun.id}`}
                className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
              >
                View <ChevronRight className="w-3 h-3" />
              </a>
            </div>
          </section>
        )}

        {nightRun && nightRun.status !== 'running' && (
          <section className="animate-slide-in">
            <div className="flex items-center gap-2 mb-3">
              <Moon className="w-5 h-5 text-indigo-400" />
              <h2 className="text-lg font-semibold text-slate-100">Last Night Run</h2>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-5 py-4 flex items-center gap-6 text-sm">
              <span className="text-slate-400">
                {nightRun.tasksCompleted}/{nightRun.tasksTotal} tasks
              </span>
              <span className="text-slate-400">
                {formatUSD(nightRun.budgetUsed)} / {formatUSD(nightRun.budgetLimit)}
              </span>
              {nightRun.durationMs != null && (
                <span className="text-slate-400">
                  {formatDurationMs(nightRun.durationMs)}
                </span>
              )}
              <span className={`ml-auto text-xs font-medium ${nightRun.status === 'completed' ? 'text-emerald-400' : 'text-red-400'}`}>
                {nightRun.status}
              </span>
            </div>
          </section>
        )}

        {/* Row 5: Quick Actions */}
        <section className="animate-slide-in">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-slate-100">
              Quick Actions
            </h2>
          </div>
          <div className="flex flex-wrap gap-3">
            <QuickAction
              label="Start Night Session"
              icon={Moon}
              variant="primary"
              onClick={() => setNightRunModalOpen(true)}
            />
            <a href="/reports">
              <QuickAction
                label="View Latest Report"
                icon={Activity}
              />
            </a>
            <a href="/monitoring">
              <QuickAction
                label="Check Deploy Status"
                icon={Stethoscope}
              />
            </a>
            <QuickAction
              label="Run Doctor"
              icon={Stethoscope}
              onClick={handleRunDoctor}
            />
            <QuickAction
              label="New Task"
              icon={Plus}
              onClick={() => {
                /* TODO: open task modal */
              }}
            />
            <QuickAction
              label="Search Memory"
              icon={Search}
              onClick={() => {
                /* TODO: open memory search */
              }}
            />
          </div>
        </section>
      </div>

      {/* Night Run Modal */}
      <NightRunModal
        open={nightRunModalOpen}
        onClose={() => setNightRunModalOpen(false)}
        onStart={handleStartNightRun}
      />
    </>
  );
}
