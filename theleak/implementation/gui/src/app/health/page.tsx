'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Download,
  Search,
  Shield,
  Wrench,
  Activity,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import type { HealthStatus, EventSeverity } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Extended types (the backend may return richer data than the base types)
// ---------------------------------------------------------------------------

interface DoctorCheckDetail {
  name: string;
  status: HealthStatus;
  message: string;
  category: string;
  duration_ms?: number;
  auto_repaired?: boolean;
}

interface DoctorResultExtended {
  overall: HealthStatus;
  checks: DoctorCheckDetail[];
  timestamp: string;
}

interface BootPhase {
  phase: string;
  duration_ms: number;
}

interface BootRun {
  id: string;
  timestamp: string;
  phases: BootPhase[];
  total_ms: number;
}

interface EventRow {
  id: string;
  title: string;
  description?: string;
  severity: EventSeverity;
  timestamp: string;
  source?: string;
  category?: string;
}

interface VerificationRun {
  id: string;
  timestamp: string;
  verdict: HealthStatus;
  pass_count: number;
  fail_count: number;
  warn_count: number;
  details?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES = [
  'Workspace',
  'Configuration',
  'Credentials',
  'Connections',
  'Tools',
  'Sessions',
] as const;

type Category = (typeof CATEGORIES)[number];

const CATEGORY_ICONS: Record<Category, React.ReactNode> = {
  Workspace: <Activity className="w-4 h-4" />,
  Configuration: <Wrench className="w-4 h-4" />,
  Credentials: <Shield className="w-4 h-4" />,
  Connections: <Activity className="w-4 h-4" />,
  Tools: <Wrench className="w-4 h-4" />,
  Sessions: <Activity className="w-4 h-4" />,
};

const SEVERITY_COLORS: Record<EventSeverity, string> = {
  info: 'text-blue-400 bg-blue-400/10',
  warn: 'text-amber-400 bg-amber-400/10',
  error: 'text-red-400 bg-red-400/10',
};

const SLOW_THRESHOLD_MS = 500;
const EVENTS_PER_PAGE = 20;

// ---------------------------------------------------------------------------
// Status icon helper
// ---------------------------------------------------------------------------

function StatusIcon({ status, size = 16 }: { status: HealthStatus; size?: number }) {
  switch (status) {
    case 'pass':
      return <CheckCircle2 className="text-emerald-400" style={{ width: size, height: size }} />;
    case 'warn':
      return <AlertTriangle className="text-amber-400" style={{ width: size, height: size }} />;
    case 'fail':
      return <XCircle className="text-red-400" style={{ width: size, height: size }} />;
  }
}

function VerdictBadge({ verdict }: { verdict: HealthStatus }) {
  const styles: Record<HealthStatus, string> = {
    pass: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
    warn: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
    fail: 'bg-red-400/10 text-red-400 border-red-400/20',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${styles[verdict]}`}>
      {verdict.toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-700/50 rounded ${className}`} />;
}

function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="glass-panel border-red-500/30 p-4 flex items-center gap-3">
      <XCircle className="text-red-400 w-5 h-5 shrink-0" />
      <span className="text-red-300 text-sm flex-1">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs text-slate-400 hover:text-slate-200 underline"
        >
          Retry
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass-panel p-6 space-y-4">
      <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Doctor Results Section
// ---------------------------------------------------------------------------

function DoctorResults({
  result,
  loading,
  error,
  onRun,
  running,
}: {
  result: DoctorResultExtended | null;
  loading: boolean;
  error: string | null;
  onRun: () => void;
  running: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<Category>>(new Set());

  const grouped = useMemo(() => {
    if (!result) return new Map<Category, DoctorCheckDetail[]>();
    const map = new Map<Category, DoctorCheckDetail[]>();
    for (const cat of CATEGORIES) map.set(cat, []);
    for (const check of result.checks) {
      const cat = (CATEGORIES.includes(check.category as Category)
        ? check.category
        : 'Configuration') as Category;
      map.get(cat)!.push(check);
    }
    return map;
  }, [result]);

  const toggle = (cat: Category) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  const categoryStatus = useCallback(
    (cat: Category): HealthStatus => {
      const checks = grouped.get(cat) ?? [];
      if (checks.length === 0) return 'pass';
      if (checks.some((c) => c.status === 'fail')) return 'fail';
      if (checks.some((c) => c.status === 'warn')) return 'warn';
      return 'pass';
    },
    [grouped],
  );

  return (
    <Section title="Doctor Results">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {result && <StatusIcon status={result.overall} size={24} />}
          {result && (
            <span className="text-sm text-slate-400">
              Last run: {new Date(result.timestamp).toLocaleString()}
            </span>
          )}
        </div>
        <button
          onClick={onRun}
          disabled={running}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500
                     disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} />
          Run Doctor
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={onRun} />}

      {loading && !result ? (
        <SkeletonRows count={6} />
      ) : (
        <div className="space-y-1">
          {CATEGORIES.map((cat) => {
            const isOpen = expanded.has(cat);
            const checks = grouped.get(cat) ?? [];
            const status = categoryStatus(cat);
            return (
              <div key={cat}>
                <button
                  onClick={() => toggle(cat)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg
                             hover:bg-slate-700/40 transition-colors text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-500" />
                  )}
                  <span className="text-slate-400">{CATEGORY_ICONS[cat]}</span>
                  <span className="flex-1 text-sm font-medium text-slate-200">{cat}</span>
                  <StatusIcon status={status} />
                  <span className="text-xs text-slate-500">{checks.length} checks</span>
                </button>

                {isOpen && checks.length > 0 && (
                  <div className="ml-11 border-l border-slate-700/50 pl-4 pb-2 space-y-1 slide-in">
                    {checks.map((check, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-3 px-3 py-2 rounded-md
                                   hover:bg-slate-700/20 transition-colors"
                      >
                        <StatusIcon status={check.status} size={14} />
                        <span className="text-sm text-slate-300 flex-1">{check.name}</span>
                        {check.auto_repaired && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold
                                           bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">
                            Repaired
                          </span>
                        )}
                        <span className="text-xs text-slate-500 max-w-[300px] truncate">
                          {check.message}
                        </span>
                        {check.duration_ms != null && (
                          <span
                            className={`text-xs tabular-nums ${
                              check.duration_ms > SLOW_THRESHOLD_MS
                                ? 'text-amber-400'
                                : 'text-slate-600'
                            }`}
                          >
                            {check.duration_ms}ms
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {isOpen && checks.length === 0 && (
                  <div className="ml-11 pl-4 py-2 text-xs text-slate-600">No checks in this category.</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Boot Performance Chart
// ---------------------------------------------------------------------------

function BootPerformanceChart({
  runs,
  loading,
}: {
  runs: BootRun[];
  loading: boolean;
}) {
  const chartData = useMemo(() => {
    return runs.slice(-10).map((run) => {
      const entry: Record<string, string | number> = {
        label: new Date(run.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        total: run.total_ms,
      };
      for (const p of run.phases) {
        entry[p.phase] = p.duration_ms;
      }
      return entry;
    });
  }, [runs]);

  const phaseNames = useMemo(() => {
    const set = new Set<string>();
    for (const run of runs) {
      for (const p of run.phases) set.add(p.phase);
    }
    return Array.from(set);
  }, [runs]);

  const COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#ec4899', '#84cc16',
  ];

  if (loading) {
    return (
      <Section title="Boot Performance">
        <Skeleton className="h-64 w-full" />
      </Section>
    );
  }

  if (chartData.length === 0) {
    return (
      <Section title="Boot Performance">
        <p className="text-sm text-slate-500">No boot data available.</p>
      </Section>
    );
  }

  return (
    <Section title="Boot Performance">
      <p className="text-xs text-slate-500">
        Last {chartData.length} boot runs. Phases exceeding {SLOW_THRESHOLD_MS}ms highlighted.
      </p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              label={{
                value: 'ms',
                angle: -90,
                position: 'insideLeft',
                fill: '#64748b',
                fontSize: 11,
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: '#e2e8f0' }}
            />
            {phaseNames.map((phase, i) => (
              <Bar
                key={phase}
                dataKey={phase}
                stackId="boot"
                fill={COLORS[i % COLORS.length]}
                radius={i === phaseNames.length - 1 ? [4, 4, 0, 0] : undefined}
              >
                {chartData.map((entry, idx) => (
                  <Cell
                    key={idx}
                    fillOpacity={
                      typeof entry[phase] === 'number' && (entry[phase] as number) > SLOW_THRESHOLD_MS
                        ? 1
                        : 0.7
                    }
                  />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Event Log Section
// ---------------------------------------------------------------------------

function EventLog({
  events,
  loading,
  error,
}: {
  events: EventRow[];
  loading: boolean;
  error: string | null;
}) {
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<EventSeverity | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [page, setPage] = useState(0);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) if (e.category) set.add(e.category);
    return Array.from(set).sort();
  }, [events]);

  const filtered = useMemo(() => {
    let list = events;
    if (severityFilter !== 'all') list = list.filter((e) => e.severity === severityFilter);
    if (categoryFilter !== 'all') list = list.filter((e) => e.category === categoryFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.description?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [events, severityFilter, categoryFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / EVENTS_PER_PAGE));
  const paginated = filtered.slice(page * EVENTS_PER_PAGE, (page + 1) * EVENTS_PER_PAGE);

  // Reset page on filter change
  useEffect(() => setPage(0), [severityFilter, categoryFilter, search]);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ob1-events-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Section title="Event Log">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search events..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50
                       text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none
                       focus:ring-1 focus:ring-blue-500/50"
          />
        </div>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value as EventSeverity | 'all')}
          className="px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50
                     text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
        >
          <option value="all">All severities</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>
        {categories.length > 0 && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50
                       text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-3 py-2 rounded-lg
                     bg-slate-700/40 hover:bg-slate-700/60 text-sm text-slate-300 transition-colors"
        >
          <Download className="w-4 h-4" />
          Export
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Table */}
      {loading ? (
        <SkeletonRows count={5} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wider">
                  <th className="pb-2 pr-4">Severity</th>
                  <th className="pb-2 pr-4">Title</th>
                  <th className="pb-2 pr-4">Source</th>
                  <th className="pb-2">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {paginated.map((evt) => (
                  <tr key={evt.id} className="hover:bg-slate-700/20 transition-colors">
                    <td className="py-2.5 pr-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${SEVERITY_COLORS[evt.severity]}`}
                      >
                        {evt.severity}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-slate-200">{evt.title}</td>
                    <td className="py-2.5 pr-4 text-slate-500">{evt.source ?? '-'}</td>
                    <td className="py-2.5 text-slate-500 tabular-nums whitespace-nowrap">
                      {new Date(evt.timestamp).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {paginated.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-600">
                      No events match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-500">
                {filtered.length} event{filtered.length !== 1 ? 's' : ''} total
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-2 py-1 rounded text-xs text-slate-400 hover:text-slate-200
                             disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                <span className="text-xs text-slate-500 px-2">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-2 py-1 rounded text-xs text-slate-400 hover:text-slate-200
                             disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Verification History Section
// ---------------------------------------------------------------------------

function VerificationHistory({
  runs,
  loading,
}: {
  runs: VerificationRun[];
  loading: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) {
    return (
      <Section title="Verification History">
        <SkeletonRows count={4} />
      </Section>
    );
  }

  if (runs.length === 0) {
    return (
      <Section title="Verification History">
        <p className="text-sm text-slate-500">No verification runs recorded.</p>
      </Section>
    );
  }

  return (
    <Section title="Verification History">
      <div className="space-y-1">
        {runs.map((run) => (
          <div key={run.id}>
            <button
              onClick={() => setExpandedId(expandedId === run.id ? null : run.id)}
              className="w-full flex items-center gap-4 px-4 py-3 rounded-lg
                         hover:bg-slate-700/40 transition-colors text-left"
            >
              {expandedId === run.id ? (
                <ChevronDown className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-500" />
              )}
              <span className="text-sm text-slate-300 tabular-nums whitespace-nowrap">
                {new Date(run.timestamp).toLocaleString()}
              </span>
              <VerdictBadge verdict={run.verdict} />
              <span className="flex-1" />
              <span className="text-xs text-emerald-400">{run.pass_count} pass</span>
              <span className="text-xs text-amber-400">{run.warn_count} warn</span>
              <span className="text-xs text-red-400">{run.fail_count} fail</span>
            </button>
            {expandedId === run.id && run.details && (
              <div className="ml-11 pl-4 pb-3 text-xs text-slate-400 whitespace-pre-wrap slide-in">
                {run.details}
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function HealthPage() {
  // Doctor state
  const [doctorResult, setDoctorResult] = useState<DoctorResultExtended | null>(null);
  const [doctorLoading, setDoctorLoading] = useState(true);
  const [doctorError, setDoctorError] = useState<string | null>(null);
  const [doctorRunning, setDoctorRunning] = useState(false);

  // Boot perf state
  const [bootRuns, setBootRuns] = useState<BootRun[]>([]);
  const [bootLoading, setBootLoading] = useState(true);

  // Events state
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);

  // Verification history state
  const [verifications, setVerifications] = useState<VerificationRun[]>([]);
  const [verificationsLoading, setVerificationsLoading] = useState(true);

  // ---- Fetch Doctor ----
  const runDoctor = useCallback(async () => {
    setDoctorRunning(true);
    setDoctorError(null);
    try {
      const result = await api.doctor.run();
      // Map basic checks to extended format (category is inferred if not present)
      const extended: DoctorResultExtended = {
        overall: result.overall,
        timestamp: result.timestamp,
        checks: result.checks.map((c: any) => ({
          name: c.name,
          status: c.status,
          message: c.message,
          category: c.category ?? inferCategory(c.name),
          duration_ms: c.duration_ms,
          auto_repaired: c.auto_repaired ?? false,
        })),
      };
      setDoctorResult(extended);
    } catch (err) {
      setDoctorError(err instanceof Error ? err.message : String(err));
    } finally {
      setDoctorLoading(false);
      setDoctorRunning(false);
    }
  }, []);

  // ---- Fetch Events ----
  const fetchEvents = useCallback(async () => {
    try {
      const data = await api.events.query({ limit: 200 });
      setEvents(
        data.map((e: any) => ({
          id: e.id,
          title: e.title,
          description: e.description,
          severity: e.severity,
          timestamp: e.timestamp,
          source: e.source,
          category: e.type ?? e.category,
        })),
      );
    } catch (err) {
      setEventsError(err instanceof Error ? err.message : String(err));
    } finally {
      setEventsLoading(false);
    }
  }, []);

  // ---- Fetch Boot Performance ----
  const fetchBootPerf = useCallback(async () => {
    try {
      // Boot performance data is typically served from a dedicated endpoint.
      // Fall back gracefully if the endpoint doesn't exist yet.
      const data: any = await api.doctor.run().catch(() => null);
      if (data && Array.isArray((data as any).boot_runs)) {
        setBootRuns((data as any).boot_runs);
      }
    } catch {
      // non-critical - chart will show empty state
    } finally {
      setBootLoading(false);
    }
  }, []);

  // ---- Fetch Verification History ----
  const fetchVerifications = useCallback(async () => {
    try {
      // Verification history may be embedded in doctor response or a separate endpoint
      const data: any = await api.doctor.run().catch(() => null);
      if (data && Array.isArray((data as any).verification_history)) {
        setVerifications((data as any).verification_history);
      }
    } catch {
      // non-critical
    } finally {
      setVerificationsLoading(false);
    }
  }, []);

  // ---- Initial load ----
  useEffect(() => {
    runDoctor();
    fetchEvents();
    fetchBootPerf();
    fetchVerifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 p-6 lg:p-10 space-y-6 fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">System Health</h1>
          <p className="text-sm text-slate-500 mt-1">
            Doctor diagnostics, boot performance, event log, and verification history.
          </p>
        </div>
      </div>

      <DoctorResults
        result={doctorResult}
        loading={doctorLoading}
        error={doctorError}
        onRun={runDoctor}
        running={doctorRunning}
      />

      <BootPerformanceChart runs={bootRuns} loading={bootLoading} />

      <EventLog events={events} loading={eventsLoading} error={eventsError} />

      <VerificationHistory runs={verifications} loading={verificationsLoading} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Infer a category from a check name when the backend doesn't provide one. */
function inferCategory(name: string): Category {
  const lower = name.toLowerCase();
  if (lower.includes('workspace') || lower.includes('project')) return 'Workspace';
  if (lower.includes('config') || lower.includes('setting')) return 'Configuration';
  if (lower.includes('cred') || lower.includes('key') || lower.includes('token') || lower.includes('auth'))
    return 'Credentials';
  if (lower.includes('connect') || lower.includes('network') || lower.includes('supabase'))
    return 'Connections';
  if (lower.includes('tool') || lower.includes('mcp') || lower.includes('plugin')) return 'Tools';
  if (lower.includes('session') || lower.includes('budget')) return 'Sessions';
  return 'Configuration';
}
