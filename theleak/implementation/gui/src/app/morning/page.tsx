'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { format, parseISO, differenceInMinutes } from 'date-fns';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  SkipForward,
  Clock,
  DollarSign,
  Zap,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Moon,
  Sun,
  ExternalLink,
  Printer,
  ListChecks,
  TrendingUp,
  Loader2,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskResult {
  task_id: string;
  title: string;
  status: 'completed' | 'failed' | 'skipped';
  duration_minutes: number;
  usd_spent: number;
  tokens_used: number;
  result_summary?: string;
  error?: string;
}

interface NightRunReport {
  started_at: string;
  completed_at: string;
  duration_minutes: number;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  skipped_tasks: number;
  total_usd_spent: number;
  total_tokens_used: number;
  task_results: TaskResult[];
  errors: string[];
}

interface ReportThought {
  id: string;
  body: NightRunReport;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Intersection-observer fade-in hook
// ---------------------------------------------------------------------------

function useFadeIn<T extends HTMLElement>(): React.RefObject<T> {
  const ref = useRef<T | null>(null) as React.RefObject<T>;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    el.style.opacity = '0';
    el.style.transform = 'translateY(16px)';
    el.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
          observer.unobserve(el);
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return ref;
}

// ---------------------------------------------------------------------------
// Staggered fade-in for children
// ---------------------------------------------------------------------------

function useStaggerFadeIn<T extends HTMLElement>(
  count: number,
  baseDelay = 80,
): React.MutableRefObject<(T | null)[]> {
  const refs = useRef<(T | null)[]>([]);

  useEffect(() => {
    refs.current.forEach((el, i) => {
      if (!el) return;
      el.style.opacity = '0';
      el.style.transform = 'translateY(12px)';
      el.style.transition = `opacity 0.5s ease-out ${i * baseDelay}ms, transform 0.5s ease-out ${i * baseDelay}ms`;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
            observer.unobserve(el);
          }
        },
        { threshold: 0.1 },
      );
      observer.observe(el);
    });
  }, [count, baseDelay]);

  return refs;
}

// ---------------------------------------------------------------------------
// Demo data for preview (replaced by real API in production)
// ---------------------------------------------------------------------------

function makeDemoReport(): NightRunReport {
  return {
    started_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    duration_minutes: 312,
    total_tasks: 7,
    completed_tasks: 5,
    failed_tasks: 1,
    skipped_tasks: 1,
    total_usd_spent: 1.47,
    total_tokens_used: 284_500,
    task_results: [
      {
        task_id: 'task-001',
        title: 'Process daily email digest',
        status: 'completed',
        duration_minutes: 45,
        usd_spent: 0.23,
        tokens_used: 42_000,
        result_summary: 'Processed 34 emails. 8 flagged for follow-up, 3 archived, 23 summarized into daily brief.',
      },
      {
        task_id: 'task-002',
        title: 'Update project roadmap from GitHub issues',
        status: 'completed',
        duration_minutes: 38,
        usd_spent: 0.19,
        tokens_used: 36_800,
        result_summary: 'Synced 12 new issues, closed 4 completed items, updated milestone progress to 67%.',
      },
      {
        task_id: 'task-003',
        title: 'Generate weekly analytics report',
        status: 'completed',
        duration_minutes: 62,
        usd_spent: 0.31,
        tokens_used: 58_200,
        result_summary: 'Weekly report generated with 14 charts. Traffic up 12% WoW. Engagement metrics stable.',
      },
      {
        task_id: 'task-004',
        title: 'Sync CRM contacts with newsletter',
        status: 'failed',
        duration_minutes: 28,
        usd_spent: 0.12,
        tokens_used: 22_400,
        error: 'CRM API rate limit exceeded after 200 contacts. 340 remaining. Retry recommended at off-peak hours.',
      },
      {
        task_id: 'task-005',
        title: 'Review and categorize saved articles',
        status: 'completed',
        duration_minutes: 55,
        usd_spent: 0.28,
        tokens_used: 51_600,
        result_summary: 'Categorized 28 articles: 9 AI/ML, 7 business, 6 engineering, 4 design, 2 misc.',
      },
      {
        task_id: 'task-006',
        title: 'Clean up stale database records',
        status: 'skipped',
        duration_minutes: 0,
        usd_spent: 0,
        tokens_used: 0,
        result_summary: 'Skipped: prerequisite task (CRM sync) failed.',
      },
      {
        task_id: 'task-007',
        title: 'Generate social media content queue',
        status: 'completed',
        duration_minutes: 84,
        usd_spent: 0.34,
        tokens_used: 73_500,
        result_summary: 'Created 15 posts across 3 platforms. Scheduled for next 5 days. Topics: product updates, industry insights.',
      },
    ],
    errors: [
      'CRM API rate limit exceeded — task-004 failed after processing 200/540 contacts.',
    ],
  };
}

const DEMO_REPORTS: ReportThought[] = [
  {
    id: 'demo-1',
    body: makeDemoReport(),
    created_at: new Date().toISOString(),
  },
];

// ---------------------------------------------------------------------------
// Data fetching hook
// ---------------------------------------------------------------------------

function useNightReports() {
  const [reports, setReports] = useState<ReportThought[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchReports() {
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseKey) {
          // Fall back to demo data when no Supabase config
          if (!cancelled) {
            setReports(DEMO_REPORTS);
            setLoading(false);
          }
          return;
        }

        const res = await fetch(`${supabaseUrl}/rest/v1/thoughts?metadata->>type=eq.night_run_report&order=created_at.desc&limit=50`, {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        });

        if (!res.ok) throw new Error(`Failed to fetch reports: ${res.status}`);

        const rows = await res.json();
        if (!cancelled) {
          setReports(
            rows.map((r: any) => ({
              id: r.id,
              body: typeof r.body === 'string' ? JSON.parse(r.body) : r.body,
              created_at: r.created_at,
            })),
          );
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          // Fall back to demo data on error
          setReports(DEMO_REPORTS);
          setLoading(false);
        }
      }
    }

    fetchReports();
    return () => { cancelled = true; };
  }, []);

  return { reports, loading, error };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

function getOverallStatus(report: NightRunReport): 'success' | 'warning' | 'error' {
  if (report.failed_tasks === 0 && report.skipped_tasks === 0) return 'success';
  if (report.failed_tasks > report.completed_tasks) return 'error';
  return 'warning';
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const DONUT_COLORS = {
  completed: '#10b981',
  failed: '#ef4444',
  skipped: '#64748b',
};

// ---------------------------------------------------------------------------
// Status Icon Component
// ---------------------------------------------------------------------------

function StatusIcon({ status, size = 20 }: { status: 'completed' | 'failed' | 'skipped'; size?: number }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={size} className="text-emerald-400 flex-shrink-0" />;
    case 'failed':
      return <XCircle size={size} className="text-red-400 flex-shrink-0" />;
    case 'skipped':
      return <SkipForward size={size} className="text-slate-500 flex-shrink-0" />;
  }
}

function OverallStatusIcon({ status }: { status: 'success' | 'warning' | 'error' }) {
  const baseClasses = 'rounded-full p-3';
  switch (status) {
    case 'success':
      return (
        <div className={`${baseClasses} bg-emerald-500/20 ring-1 ring-emerald-500/30`}>
          <CheckCircle2 size={32} className="text-emerald-400" />
        </div>
      );
    case 'warning':
      return (
        <div className={`${baseClasses} bg-amber-500/20 ring-1 ring-amber-500/30`}>
          <AlertTriangle size={32} className="text-amber-400" />
        </div>
      );
    case 'error':
      return (
        <div className={`${baseClasses} bg-red-500/20 ring-1 ring-red-500/30`}>
          <XCircle size={32} className="text-red-400" />
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Custom Recharts Tooltip
// ---------------------------------------------------------------------------

function CustomBarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 shadow-xl text-sm">
      <p className="text-slate-300 font-medium mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-slate-400">
          <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: entry.color }} />
          {entry.name}: {entry.name === 'Cost' ? formatCost(entry.value) : formatTokens(entry.value)}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero Section
// ---------------------------------------------------------------------------

function HeroSection({ report }: { report: NightRunReport }) {
  const overallStatus = getOverallStatus(report);
  const ref = useFadeIn<HTMLDivElement>();

  const statusText = {
    success: 'All tasks completed successfully',
    warning: 'Some tasks need attention',
    error: 'Multiple tasks failed overnight',
  };

  return (
    <div
      ref={ref}
      className="relative overflow-hidden rounded-2xl mb-8"
    >
      {/* Gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-900 via-blue-950 to-slate-950" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(59,130,246,0.15),_transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_rgba(99,102,241,0.1),_transparent_60%)]" />

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="relative px-8 py-12 sm:px-12 sm:py-16">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex-1">
            {/* Greeting */}
            <div className="flex items-center gap-2 text-blue-300/80 text-sm font-medium mb-2">
              <Sun size={14} />
              <span>{getGreeting()}</span>
              <span className="text-blue-400/40 mx-1">&middot;</span>
              <span>{format(new Date(), 'EEEE, MMMM d, yyyy')}</span>
            </div>

            {/* Headline */}
            <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-3">
              <span className="text-gradient">{report.completed_tasks} of {report.total_tasks}</span>
              {' '}tasks completed overnight
            </h1>

            {/* Subtitle */}
            <p className="text-slate-400 text-base flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="flex items-center gap-1.5">
                <Clock size={14} className="text-slate-500" />
                {formatDuration(report.duration_minutes)} runtime
              </span>
              <span className="flex items-center gap-1.5">
                <DollarSign size={14} className="text-slate-500" />
                {formatCost(report.total_usd_spent)} total cost
              </span>
              <span className="flex items-center gap-1.5">
                <Zap size={14} className="text-slate-500" />
                {formatTokens(report.total_tokens_used)} tokens
              </span>
            </p>

            {/* Status label */}
            <div className="mt-4">
              <span
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
                  overallStatus === 'success'
                    ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20'
                    : overallStatus === 'warning'
                    ? 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20'
                    : 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
                }`}
              >
                <StatusIcon status={overallStatus === 'success' ? 'completed' : overallStatus === 'error' ? 'failed' : 'skipped'} size={14} />
                {statusText[overallStatus]}
              </span>
            </div>
          </div>

          {/* Overall status icon */}
          <div className="hidden sm:block">
            <OverallStatusIcon status={overallStatus} />
          </div>
        </div>

        {/* Run time range */}
        <div className="mt-6 pt-6 border-t border-white/5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <Moon size={12} />
            Started {format(parseISO(report.started_at), 'h:mm a')}
          </span>
          <span className="flex items-center gap-1.5">
            <Sun size={12} />
            Finished {format(parseISO(report.completed_at), 'h:mm a')}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary Cards
// ---------------------------------------------------------------------------

function SummaryCards({ report }: { report: NightRunReport }) {
  const refs = useStaggerFadeIn<HTMLDivElement>(4, 100);

  const budgetLimit = report.total_usd_spent * 1.5; // Estimated budget if not provided
  const budgetPct = Math.min((report.total_usd_spent / budgetLimit) * 100, 100);
  const budgetColor = budgetPct > 80 ? 'bg-amber-500' : 'bg-emerald-500';
  const avgCostPerTask = report.completed_tasks > 0
    ? report.total_usd_spent / report.completed_tasks
    : 0;

  // Donut data
  const donutData = [
    { name: 'Completed', value: report.completed_tasks, color: DONUT_COLORS.completed },
    { name: 'Failed', value: report.failed_tasks, color: DONUT_COLORS.failed },
    { name: 'Skipped', value: report.skipped_tasks, color: DONUT_COLORS.skipped },
  ].filter((d) => d.value > 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {/* Tasks Card */}
      <div
        ref={(el) => { refs.current[0] = el; }}
        className="glass-panel p-5"
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="stat-label mb-1">Tasks</p>
            <p className="stat-value">
              {report.completed_tasks}
              <span className="text-base font-normal text-slate-500">/{report.total_tasks}</span>
            </p>
          </div>
          <div className="w-16 h-16">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={18}
                  outerRadius={28}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {donutData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {report.completed_tasks > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              {report.completed_tasks} passed
            </span>
          )}
          {report.failed_tasks > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              {report.failed_tasks} failed
            </span>
          )}
          {report.skipped_tasks > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-slate-600" />
              {report.skipped_tasks} skipped
            </span>
          )}
        </div>
      </div>

      {/* Budget Card */}
      <div
        ref={(el) => { refs.current[1] = el; }}
        className="glass-panel p-5"
      >
        <p className="stat-label mb-1">Budget Used</p>
        <p className="stat-value mb-3">{formatCost(report.total_usd_spent)}</p>
        <div className="w-full h-2 rounded-full bg-slate-700/50 overflow-hidden">
          <div
            className={`h-full rounded-full ${budgetColor} transition-all duration-1000 ease-out`}
            style={{ width: `${budgetPct}%` }}
          />
        </div>
        <p className="text-xs text-slate-500 mt-2">
          {formatTokens(report.total_tokens_used)} tokens consumed
        </p>
      </div>

      {/* Duration Card */}
      <div
        ref={(el) => { refs.current[2] = el; }}
        className="glass-panel p-5"
      >
        <p className="stat-label mb-1">Duration</p>
        <p className="stat-value mb-1">{formatDuration(report.duration_minutes)}</p>
        <p className="text-xs text-slate-500">
          {format(parseISO(report.started_at), 'h:mm a')} &mdash; {format(parseISO(report.completed_at), 'h:mm a')}
        </p>
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <Clock size={12} />
          <span>
            ~{report.total_tasks > 0 ? formatDuration(report.duration_minutes / report.total_tasks) : '0m'} avg/task
          </span>
        </div>
      </div>

      {/* Efficiency Card */}
      <div
        ref={(el) => { refs.current[3] = el; }}
        className="glass-panel p-5"
      >
        <p className="stat-label mb-1">Efficiency</p>
        <p className="stat-value mb-1">{formatCost(avgCostPerTask)}</p>
        <p className="text-xs text-slate-500">average cost per task</p>
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <TrendingUp size={12} />
          <span>
            {report.completed_tasks > 0
              ? formatTokens(Math.round(report.total_tokens_used / report.completed_tasks))
              : '0'}{' '}
            tokens/task
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task Results Section
// ---------------------------------------------------------------------------

function TaskCard({ task, index }: { task: TaskResult; index: number }) {
  const [expanded, setExpanded] = useState(task.status === 'failed');

  return (
    <div
      className={`glass-panel overflow-hidden transition-all duration-200 ${
        task.status === 'failed' ? 'ring-1 ring-red-500/20' : ''
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-slate-800/40 transition-colors"
      >
        <StatusIcon status={task.status} size={22} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-200 truncate">{task.title}</p>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
            {task.duration_minutes > 0 && (
              <span className="flex items-center gap-1">
                <Clock size={10} />
                {formatDuration(task.duration_minutes)}
              </span>
            )}
            {task.usd_spent > 0 && (
              <span className="flex items-center gap-1">
                <DollarSign size={10} />
                {formatCost(task.usd_spent)}
              </span>
            )}
            {task.tokens_used > 0 && (
              <span className="flex items-center gap-1">
                <Zap size={10} />
                {formatTokens(task.tokens_used)}
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          size={16}
          className={`text-slate-500 transition-transform duration-200 flex-shrink-0 ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {expanded && (
        <div className="px-5 pb-4 pt-0 border-t border-slate-700/30">
          {task.result_summary && (
            <p className="text-sm text-slate-400 mt-3 leading-relaxed">
              {task.result_summary}
            </p>
          )}
          {task.error && (
            <div className="mt-3 p-3 rounded-lg bg-red-500/5 border border-red-500/15">
              <p className="text-sm text-red-400 font-mono leading-relaxed">
                {task.error}
              </p>
            </div>
          )}
          <div className="mt-3 flex items-center gap-3">
            <a
              href={`/runs/${task.task_id}`}
              className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              <ExternalLink size={12} />
              View Details
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskResultsSection({ report }: { report: NightRunReport }) {
  const ref = useFadeIn<HTMLDivElement>();
  const sorted = useMemo(() => {
    const order = { failed: 0, completed: 1, skipped: 2 };
    return [...report.task_results].sort((a, b) => order[a.status] - order[b.status]);
  }, [report.task_results]);

  return (
    <div ref={ref} className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <ListChecks size={18} className="text-slate-400" />
        <h2 className="text-lg font-semibold text-slate-200">Task Results</h2>
        <span className="text-xs text-slate-500 ml-auto">
          {report.task_results.length} tasks
        </span>
      </div>
      <div className="space-y-3">
        {sorted.map((task, i) => (
          <TaskCard key={task.task_id} task={task} index={i} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Needs Attention Section
// ---------------------------------------------------------------------------

function NeedsAttentionSection({ report }: { report: NightRunReport }) {
  const ref = useFadeIn<HTMLDivElement>();
  const attentionItems = report.task_results.filter(
    (t) => t.status === 'failed',
  );

  if (attentionItems.length === 0) return null;

  // Suggest actions based on error messages
  function suggestAction(task: TaskResult): string {
    const err = (task.error ?? '').toLowerCase();
    if (err.includes('rate limit')) return 'Retry during off-peak hours or increase API rate limits';
    if (err.includes('timeout')) return 'Increase timeout duration or break into smaller tasks';
    if (err.includes('auth') || err.includes('permission')) return 'Check API credentials and permissions';
    if (err.includes('not found')) return 'Verify resource exists and path is correct';
    return 'Review error details and retry manually';
  }

  return (
    <div ref={ref} className="mb-8">
      <div
        className={`rounded-xl border overflow-hidden ${
          attentionItems.length > 1
            ? 'border-red-500/25 bg-red-500/[0.03]'
            : 'border-amber-500/25 bg-amber-500/[0.03]'
        }`}
      >
        <div className="px-5 py-4 border-b border-red-500/10">
          <div className="flex items-center gap-2">
            <AlertTriangle
              size={18}
              className={attentionItems.length > 1 ? 'text-red-400' : 'text-amber-400'}
            />
            <h2 className="text-lg font-semibold text-slate-200">
              Needs Attention
            </h2>
            <span className="ml-auto text-xs text-slate-500">
              {attentionItems.length} {attentionItems.length === 1 ? 'issue' : 'issues'}
            </span>
          </div>
        </div>
        <div className="divide-y divide-slate-700/20">
          {attentionItems.map((task) => (
            <div key={task.task_id} className="px-5 py-4">
              <div className="flex items-start gap-3">
                <XCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200">{task.title}</p>
                  {task.error && (
                    <p className="text-xs text-red-400/80 mt-1 font-mono">{task.error}</p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700/50">
                      Suggested: {suggestAction(task)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Budget Breakdown Chart
// ---------------------------------------------------------------------------

function BudgetBreakdownSection({ report }: { report: NightRunReport }) {
  const ref = useFadeIn<HTMLDivElement>();

  const costData = report.task_results
    .filter((t) => t.usd_spent > 0)
    .map((t) => ({
      name: t.title.length > 30 ? t.title.substring(0, 30) + '...' : t.title,
      Cost: t.usd_spent,
      Tokens: t.tokens_used,
      status: t.status,
    }))
    .sort((a, b) => b.Cost - a.Cost);

  if (costData.length === 0) return null;

  return (
    <div ref={ref} className="mb-8">
      <div className="glass-panel p-6">
        <div className="flex items-center gap-2 mb-6">
          <DollarSign size={18} className="text-slate-400" />
          <h2 className="text-lg font-semibold text-slate-200">Budget Breakdown</h2>
        </div>

        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={costData} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
              <XAxis
                type="number"
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={(v) => `$${v.toFixed(2)}`}
                axisLine={{ stroke: '#334155' }}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={180}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                axisLine={{ stroke: '#334155' }}
              />
              <Tooltip content={<CustomBarTooltip />} cursor={{ fill: 'rgba(59,130,246,0.05)' }} />
              <Bar
                dataKey="Cost"
                radius={[0, 4, 4, 0]}
                maxBarSize={28}
              >
                {costData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={
                      entry.status === 'completed'
                        ? '#3b82f6'
                        : entry.status === 'failed'
                        ? '#ef4444'
                        : '#64748b'
                    }
                    fillOpacity={0.8}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Token summary */}
        <div className="mt-6 pt-4 border-t border-slate-700/30 grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-xs text-slate-500 mb-1">Total Tokens</p>
            <p className="text-sm font-semibold text-slate-300">
              {formatTokens(report.total_tokens_used)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Avg / Task</p>
            <p className="text-sm font-semibold text-slate-300">
              {report.completed_tasks > 0
                ? formatTokens(Math.round(report.total_tokens_used / report.completed_tasks))
                : '0'}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Cost / 1k Tokens</p>
            <p className="text-sm font-semibold text-slate-300">
              {report.total_tokens_used > 0
                ? formatCost((report.total_usd_spent / report.total_tokens_used) * 1000)
                : '$0.00'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline Section
// ---------------------------------------------------------------------------

function TimelineSection({ report }: { report: NightRunReport }) {
  const ref = useFadeIn<HTMLDivElement>();
  const tasks = report.task_results.filter((t) => t.duration_minutes > 0);

  if (tasks.length === 0) return null;

  const runStart = parseISO(report.started_at).getTime();
  const runEnd = parseISO(report.completed_at).getTime();
  const totalDuration = runEnd - runStart;

  // Lay out tasks sequentially (approximate since we don't have exact start times)
  let cursor = 0;
  const taskBars = tasks.map((t) => {
    const widthPct = (t.duration_minutes / report.duration_minutes) * 100;
    const leftPct = (cursor / report.duration_minutes) * 100;
    cursor += t.duration_minutes;
    return { ...t, widthPct: Math.max(widthPct, 2), leftPct };
  });

  const timeMarkers = useMemo(() => {
    const markers: string[] = [];
    const start = parseISO(report.started_at);
    const end = parseISO(report.completed_at);
    const totalMin = differenceInMinutes(end, start);
    const step = totalMin > 300 ? 60 : totalMin > 120 ? 30 : 15;
    for (let m = 0; m <= totalMin; m += step) {
      const d = new Date(start.getTime() + m * 60 * 1000);
      markers.push(format(d, 'h:mm a'));
    }
    return markers;
  }, [report.started_at, report.completed_at]);

  return (
    <div ref={ref} className="mb-8">
      <div className="glass-panel p-6">
        <div className="flex items-center gap-2 mb-6">
          <Clock size={18} className="text-slate-400" />
          <h2 className="text-lg font-semibold text-slate-200">Timeline</h2>
        </div>

        {/* Time axis */}
        <div className="relative mb-2">
          <div className="flex justify-between text-[10px] text-slate-600 px-1">
            {timeMarkers.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
        </div>

        {/* Task bars */}
        <div className="space-y-2">
          {taskBars.map((task) => {
            const bg =
              task.status === 'completed'
                ? 'bg-blue-500/70 hover:bg-blue-500/90'
                : task.status === 'failed'
                ? 'bg-red-500/70 hover:bg-red-500/90'
                : 'bg-slate-600/70 hover:bg-slate-600/90';

            return (
              <div key={task.task_id} className="relative h-8 group">
                <div
                  className={`absolute top-0 h-full rounded-md ${bg} transition-colors duration-150 flex items-center px-2 overflow-hidden`}
                  style={{
                    left: `${task.leftPct}%`,
                    width: `${task.widthPct}%`,
                    minWidth: '24px',
                  }}
                >
                  <span className="text-[10px] font-medium text-white/90 truncate">
                    {task.title}
                  </span>
                </div>
                {/* Tooltip on hover */}
                <div
                  className="absolute -top-10 left-1/2 -translate-x-1/2 hidden group-hover:block bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-300 whitespace-nowrap shadow-lg z-10"
                  style={{ left: `${task.leftPct + task.widthPct / 2}%` }}
                >
                  {task.title} &middot; {formatDuration(task.duration_minutes)} &middot; {formatCost(task.usd_spent)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-4 text-[10px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-2 rounded-sm bg-blue-500/70" />
            Completed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-2 rounded-sm bg-red-500/70" />
            Failed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-2 rounded-sm bg-slate-600/70" />
            Skipped
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report Navigation
// ---------------------------------------------------------------------------

function ReportNavigation({
  reports,
  currentIndex,
  onSelect,
}: {
  reports: ReportThought[];
  currentIndex: number;
  onSelect: (i: number) => void;
}) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const hasPrev = currentIndex < reports.length - 1;
  const hasNext = currentIndex > 0;

  return (
    <div className="flex items-center justify-between gap-4 mb-8">
      <button
        onClick={() => hasPrev && onSelect(currentIndex + 1)}
        disabled={!hasPrev}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium
                   bg-slate-800/60 border border-slate-700/50 text-slate-400
                   hover:bg-slate-800 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed
                   transition-all duration-150"
      >
        <ChevronLeft size={16} />
        Previous Report
      </button>

      <div className="relative">
        <button
          onClick={() => setShowDatePicker(!showDatePicker)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                     bg-slate-800/60 border border-slate-700/50 text-slate-400
                     hover:bg-slate-800 hover:text-slate-200 transition-all duration-150"
        >
          <Calendar size={14} />
          {format(parseISO(reports[currentIndex].created_at), 'MMM d, yyyy')}
        </button>

        {showDatePicker && (
          <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-4 z-20 min-w-[200px]">
            <p className="text-xs text-slate-500 mb-3 font-medium">Recent Reports</p>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {reports.map((r, i) => (
                <button
                  key={r.id}
                  onClick={() => {
                    onSelect(i);
                    setShowDatePicker(false);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    i === currentIndex
                      ? 'bg-blue-500/15 text-blue-400'
                      : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                  }`}
                >
                  {format(parseISO(r.created_at), 'MMM d, yyyy - h:mm a')}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <button
        onClick={() => hasNext && onSelect(currentIndex - 1)}
        disabled={!hasNext}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium
                   bg-slate-800/60 border border-slate-700/50 text-slate-400
                   hover:bg-slate-800 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed
                   transition-all duration-150"
      >
        Next Report
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------

function EmptyState() {
  const ref = useFadeIn<HTMLDivElement>();

  return (
    <div ref={ref} className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      {/* Decorative gradient orb */}
      <div className="relative mb-8">
        <div className="w-32 h-32 rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/10 flex items-center justify-center">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500/30 to-indigo-500/20 flex items-center justify-center animate-pulse-slow">
            <Moon size={32} className="text-blue-400/60" />
          </div>
        </div>
        <div className="absolute inset-0 bg-blue-500/5 rounded-full blur-3xl" />
      </div>

      <h2 className="text-2xl font-bold text-slate-200 mb-3">
        No overnight reports yet
      </h2>
      <p className="text-slate-500 max-w-md text-sm leading-relaxed mb-8">
        Configure your first night run in{' '}
        <a href="/tasks" className="text-blue-400 hover:text-blue-300 underline underline-offset-2">
          Tasks
        </a>
        , and wake up to results here. Your agent will work while you sleep and
        prepare a detailed report for your morning review.
      </p>

      <a
        href="/tasks"
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium
                   bg-blue-600 text-white hover:bg-blue-500
                   shadow-lg shadow-blue-500/20 transition-all duration-200"
      >
        <ListChecks size={16} />
        Configure Night Run
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Print Button
// ---------------------------------------------------------------------------

function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                 text-slate-500 hover:text-slate-300 hover:bg-slate-800/60
                 border border-transparent hover:border-slate-700/50
                 transition-all duration-150 print:hidden"
      title="Print this report"
    >
      <Printer size={14} />
      Print
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function MorningReportPage() {
  const { reports, loading, error } = useNightReports();
  const [currentIndex, setCurrentIndex] = useState(0);

  const report = reports.length > 0 ? reports[currentIndex]?.body : null;

  // Close date picker on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-datepicker]')) {
        // Let the datepicker component handle its own state
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={32} className="text-blue-400 animate-spin" />
          <p className="text-sm text-slate-500">Loading your morning report...</p>
        </div>
      </div>
    );
  }

  if (!report || reports.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <EmptyState />
      </div>
    );
  }

  return (
    <>
      {/* Print styles */}
      <style jsx global>{`
        @media print {
          body {
            background: white !important;
            color: #1a1a1a !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .glass-panel {
            background: #f8f9fa !important;
            border: 1px solid #dee2e6 !important;
            box-shadow: none !important;
            backdrop-filter: none !important;
          }

          .print\\:hidden {
            display: none !important;
          }

          /* Force gradient hero to print nicely */
          .bg-gradient-to-br {
            background: #1e3a5f !important;
          }

          /* Ensure charts are visible */
          .recharts-wrapper {
            page-break-inside: avoid;
          }

          /* Remove hover effects */
          button,
          a {
            pointer-events: none;
          }

          /* Page margins */
          @page {
            margin: 1cm;
          }

          /* Force white text on dark backgrounds to remain legible */
          .text-slate-200,
          .text-slate-100,
          .text-white,
          .stat-value {
            color: #1a1a1a !important;
          }

          .text-slate-400,
          .text-slate-500,
          .stat-label {
            color: #555 !important;
          }

          .text-gradient {
            background: none !important;
            -webkit-text-fill-color: #2563eb !important;
            color: #2563eb !important;
          }
        }
      `}</style>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6 print:hidden">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Moon size={12} />
            <span>NightRunner Report</span>
          </div>
          <PrintButton />
        </div>

        {/* Hero */}
        <HeroSection report={report} />

        {/* Summary Cards */}
        <SummaryCards report={report} />

        {/* Needs Attention (prominent placement) */}
        <NeedsAttentionSection report={report} />

        {/* Task Results */}
        <TaskResultsSection report={report} />

        {/* Budget Breakdown */}
        <BudgetBreakdownSection report={report} />

        {/* Timeline */}
        <TimelineSection report={report} />

        {/* Report Navigation */}
        {reports.length > 0 && (
          <ReportNavigation
            reports={reports}
            currentIndex={currentIndex}
            onSelect={setCurrentIndex}
          />
        )}

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-slate-800 text-center text-xs text-slate-600 print:hidden">
          <p>
            Report generated at{' '}
            {format(parseISO(report.completed_at), 'h:mm a, MMMM d, yyyy')}
            {' '}&middot;{' '}
            OB1 Agentic Architecture
          </p>
        </div>
      </div>
    </>
  );
}
