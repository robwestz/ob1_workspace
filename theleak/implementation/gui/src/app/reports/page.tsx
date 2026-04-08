'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  FileText,
  Filter,
  Moon,
  XCircle,
  Zap,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useApiContext } from '../providers';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress-bar';

interface WaveResult {
  name: string;
  passed: boolean;
}

interface ReportEntry {
  id: string;
  date: string;
  sessionName: string;
  wavesCompleted: number;
  wavesTotal: number;
  budgetSpent: number;
  budgetLimit: number;
  durationMinutes: number;
  status: 'completed' | 'aborted' | 'running';
  goalStatus: 'achieved' | 'partial' | 'not_started';
  waves: WaveResult[];
  summary: string;
}

type StatusFilter = 'all' | 'completed' | 'aborted' | 'running';

const formatUSD = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function goalBadgeVariant(g: string) {
  if (g === 'achieved') return 'success' as const;
  if (g === 'partial') return 'warning' as const;
  return 'neutral' as const;
}

const MOCK_REPORTS: ReportEntry[] = [
  { id: 'r1', date: '2026-04-05T06:00:00Z', sessionName: 'Night Session #12', wavesCompleted: 4, wavesTotal: 4, budgetSpent: 3.82, budgetLimit: 5, durationMinutes: 342, status: 'completed', goalStatus: 'achieved',
    waves: [{ name: 'Memory consolidation', passed: true }, { name: 'SEO audit', passed: true }, { name: 'Dashboard build', passed: true }, { name: 'Test harness', passed: true }],
    summary: 'Full sweep completed. All 4 waves passed quality gates.' },
  { id: 'r2', date: '2026-04-04T06:00:00Z', sessionName: 'Night Session #11', wavesCompleted: 3, wavesTotal: 4, budgetSpent: 4.15, budgetLimit: 5, durationMinutes: 410, status: 'completed', goalStatus: 'partial',
    waves: [{ name: 'API refactor', passed: true }, { name: 'Schema migration', passed: true }, { name: 'Integration tests', passed: true }, { name: 'Deploy pipeline', passed: false }],
    summary: 'Deploy wave failed due to Edge Function timeout. 3/4 goals met.' },
  { id: 'r3', date: '2026-04-03T06:00:00Z', sessionName: 'Night Session #10', wavesCompleted: 2, wavesTotal: 5, budgetSpent: 2.10, budgetLimit: 5, durationMinutes: 180, status: 'aborted', goalStatus: 'partial',
    waves: [{ name: 'Codebase scan', passed: true }, { name: 'Skill registration', passed: true }, { name: 'Agent spawning', passed: false }, { name: 'Contract enforcement', passed: false }, { name: 'Report gen', passed: false }],
    summary: 'Aborted at wave 3 — budget pacing exceeded threshold.' },
  { id: 'r4', date: '2026-04-02T06:00:00Z', sessionName: 'Night Session #9', wavesCompleted: 5, wavesTotal: 5, budgetSpent: 4.88, budgetLimit: 5, durationMinutes: 465, status: 'completed', goalStatus: 'achieved',
    waves: [{ name: 'Memory import', passed: true }, { name: 'Bacowr crawler', passed: true }, { name: 'Content pipeline', passed: true }, { name: 'Quality review', passed: true }, { name: 'Publish batch', passed: true }],
    summary: 'Perfect run. All waves passed, budget within 2% of limit.' },
];

function ReportCard({ report }: { report: ReportEntry }) {
  const [expanded, setExpanded] = useState(false);
  const pct = report.wavesTotal > 0
    ? Math.round((report.wavesCompleted / report.wavesTotal) * 100)
    : 0;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 transition-all duration-200 hover:border-slate-700/60">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left"
      >
        <div className="flex-shrink-0">
          <Moon className="w-5 h-5 text-indigo-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-slate-200 truncate">
              {report.sessionName}
            </h3>
            <Badge variant={report.status === 'completed' ? 'completed' : report.status === 'running' ? 'running' : 'failed'}>
              {report.status}
            </Badge>
            <Badge variant={goalBadgeVariant(report.goalStatus)}>
              {report.goalStatus.replace('_', ' ')}
            </Badge>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {format(parseISO(report.date), 'MMM d, yyyy')}
            </span>
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              {report.wavesCompleted}/{report.wavesTotal} waves
            </span>
            <span className="flex items-center gap-1">
              <DollarSign className="w-3 h-3" />
              {formatUSD(report.budgetSpent)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDuration(report.durationMinutes)}
            </span>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
        )}
      </button>

      {/* Expanded Detail */}
      {expanded && (
        <div className="border-t border-slate-800 px-5 py-4 space-y-4">
          <p className="text-sm text-slate-400">{report.summary}</p>

          <ProgressBar
            value={report.wavesCompleted}
            max={report.wavesTotal}
            variant={pct === 100 ? 'green' : pct >= 50 ? 'amber' : 'red'}
            label="Wave Progress"
            showLabel
            size="md"
          />

          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-400">Waves</span>
            {report.waves.map((w, i) => (
              <div key={i} className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-slate-800/40">
                {w.passed
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  : <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                <span className="text-sm text-slate-300">{w.name}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 pt-1">
            Budget: {formatUSD(report.budgetSpent)} / {formatUSD(report.budgetLimit)} &middot; Duration: {formatDuration(report.durationMinutes)}
          </p>
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const api = useApiContext();
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.coordinator.listRuns({ status: 'completed', limit: 20 });
      if (result.runs.length > 0) {
        const mapped: ReportEntry[] = result.runs
          .filter((r) => r.agent_type_name === 'coordinator')
          .slice(0, 10)
          .map((run, i) => ({
            id: run.run_id,
            date: run.completed_at ?? run.created_at,
            sessionName: `Night Session #${10 - i}`,
            wavesCompleted: run.iteration_count ?? 0,
            wavesTotal: run.max_iterations_used || 4,
            budgetSpent: run.total_cost_usd ?? 0,
            budgetLimit: (run.task_context as any)?.config?.total_budget_usd ?? 5,
            durationMinutes: run.duration_ms ? Math.round(run.duration_ms / 60000) : 0,
            status: run.status === 'completed' ? 'completed' : run.status === 'failed' ? 'aborted' : 'running',
            goalStatus: run.status === 'completed' ? 'achieved' : 'partial',
            waves: [],
            summary: run.output_summary ?? 'No summary available.',
          }));
        if (mapped.length > 0) {
          setReports(mapped);
          setLoading(false);
          return;
        }
      }
      setReports(MOCK_REPORTS);
    } catch {
      setReports(MOCK_REPORTS);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const filtered = statusFilter === 'all'
    ? reports
    : reports.filter((r) => r.status === statusFilter);

  const totalCost = reports.reduce((s, r) => s + r.budgetSpent, 0);
  const completedCount = reports.filter((r) => r.status === 'completed').length;
  const avgWaves = reports.length > 0
    ? Math.round(reports.reduce((s, r) => s + r.wavesCompleted, 0) / reports.length)
    : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
          Morning Reports
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Night session history and outcomes
        </p>
      </div>

      {/* Summary row */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={FileText}
          label="Total Reports"
          value={reports.length}
          subtitle={`${completedCount} completed`}
          color="blue"
        />
        <StatCard
          icon={DollarSign}
          label="Total Spend"
          value={formatUSD(totalCost)}
          subtitle={`Avg ${formatUSD(reports.length > 0 ? totalCost / reports.length : 0)}/session`}
          color="amber"
        />
        <StatCard
          icon={Zap}
          label="Avg Waves"
          value={avgWaves}
          subtitle="Per session"
          color="green"
        />
      </section>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Filter className="w-4 h-4 text-slate-500" />
        {(['all', 'completed', 'aborted', 'running'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={[
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              statusFilter === f
                ? 'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/20'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800',
            ].join(' ')}
          >
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Report list */}
      <section className="space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 space-y-3">
              <div className="skeleton h-4 w-40" />
              <div className="skeleton h-3 w-64" />
            </div>
          ))
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No reports found"
            message={statusFilter !== 'all' ? `No ${statusFilter} reports. Try a different filter.` : 'No night session reports yet.'}
          />
        ) : (
          filtered.map((r) => <ReportCard key={r.id} report={r} />)
        )}
      </section>
    </div>
  );
}
