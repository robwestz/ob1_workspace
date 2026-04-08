'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  DollarSign,
  Filter,
  GitCommit,
  Lightbulb,
  Play,
  RefreshCw,
  Send,
  Shield,
  XCircle,
  Zap,
} from 'lucide-react';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { useApiContext } from '../providers';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import type { SystemEvent } from '@/lib/api-client';

type EventCategory =
  | 'wave'
  | 'task'
  | 'quality_gate'
  | 'commit'
  | 'decision'
  | 'initiative';

interface ActivityEvent {
  id: string;
  timestamp: string;
  category: EventCategory;
  title: string;
  description: string;
  costUsd: number | null;
  model: string | null;
}

type CategoryFilter = 'all' | EventCategory;

function formatUSD(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(n);
}

function relativeTime(ts: string): string {
  try {
    return formatDistanceToNow(new Date(ts), { addSuffix: true });
  } catch {
    return ts;
  }
}

function categoryIcon(cat: EventCategory) {
  switch (cat) {
    case 'wave': return Zap;
    case 'task': return Send;
    case 'quality_gate': return Shield;
    case 'commit': return GitCommit;
    case 'decision': return CheckCircle2;
    case 'initiative': return Lightbulb;
  }
}

function categoryColor(cat: EventCategory): string {
  switch (cat) {
    case 'wave': return 'text-blue-400 bg-blue-500/10 ring-blue-500/20';
    case 'task': return 'text-emerald-400 bg-emerald-500/10 ring-emerald-500/20';
    case 'quality_gate': return 'text-amber-400 bg-amber-500/10 ring-amber-500/20';
    case 'commit': return 'text-purple-400 bg-purple-500/10 ring-purple-500/20';
    case 'decision': return 'text-cyan-400 bg-cyan-500/10 ring-cyan-500/20';
    case 'initiative': return 'text-yellow-400 bg-yellow-500/10 ring-yellow-500/20';
  }
}

function categoryLabel(cat: EventCategory): string {
  switch (cat) {
    case 'wave': return 'Wave';
    case 'task': return 'Task';
    case 'quality_gate': return 'Quality Gate';
    case 'commit': return 'Commit';
    case 'decision': return 'Decision';
    case 'initiative': return 'Initiative';
  }
}

function mockEvents(): ActivityEvent[] {
  const now = new Date();
  const offset = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
  return [
    { id: 'e1', timestamp: offset(5), category: 'wave', title: 'Wave 4 completed', description: 'Test harness wave finished. All quality gates passed.', costUsd: 0.82, model: 'sonnet' },
    { id: 'e2', timestamp: offset(12), category: 'quality_gate', title: 'Quality gate: test coverage', description: 'Coverage at 87%. Threshold: 80%. PASS', costUsd: null, model: null },
    { id: 'e3', timestamp: offset(18), category: 'commit', title: 'Committed: "Add monitoring page"', description: 'Auto-commit by agent after wave 3 completion.', costUsd: null, model: 'sonnet' },
    { id: 'e4', timestamp: offset(25), category: 'task', title: 'Task dispatched: Schema migration', description: 'Assigned to specialist agent. Model: opus. Budget: $1.50', costUsd: 1.12, model: 'opus' },
    { id: 'e5', timestamp: offset(40), category: 'wave', title: 'Wave 3 started', description: 'Dashboard build wave initiated with 3 tasks.', costUsd: null, model: null },
    { id: 'e6', timestamp: offset(55), category: 'decision', title: 'Model selection: opus for migration', description: 'Complexity score 0.87 exceeded threshold. Upgraded from sonnet to opus.', costUsd: null, model: null },
    { id: 'e7', timestamp: offset(70), category: 'quality_gate', title: 'Quality gate: type check', description: 'tsc --noEmit passed with 0 errors.', costUsd: null, model: null },
    { id: 'e8', timestamp: offset(90), category: 'initiative', title: 'Discovered: unused API endpoints', description: 'Agent found 3 unused Edge Function actions during codebase scan.', costUsd: 0.04, model: 'haiku' },
    { id: 'e9', timestamp: offset(120), category: 'task', title: 'Task dispatched: API client types', description: 'Generated TypeScript types for all 52 actions.', costUsd: 0.31, model: 'sonnet' },
    { id: 'e10', timestamp: offset(150), category: 'wave', title: 'Wave 2 completed', description: 'SEO audit sweep finished. 12 pages analyzed.', costUsd: 0.95, model: 'sonnet' },
    { id: 'e11', timestamp: offset(200), category: 'commit', title: 'Committed: "Fix Bacowr crawler retry"', description: 'Bug fix committed after failed quality gate retry.', costUsd: null, model: 'sonnet' },
    { id: 'e12', timestamp: offset(240), category: 'wave', title: 'Wave 1 completed', description: 'Memory consolidation. 47 thoughts processed.', costUsd: 0.65, model: 'haiku' },
  ];
}

function CostBar({ events }: { events: ActivityEvent[] }) {
  const totalCost = events.reduce((s, e) => s + (e.costUsd ?? 0), 0);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
      <DollarSign className="w-4 h-4 text-amber-400 flex-shrink-0" />
      <span className="text-xs text-slate-500">Running total:</span>
      <span className="text-sm font-mono font-semibold text-amber-400">
        {formatUSD(totalCost)}
      </span>
      <span className="text-xs text-slate-600">
        across {events.filter((e) => e.costUsd != null).length} billable events
      </span>
    </div>
  );
}

function EventRow({ event }: { event: ActivityEvent }) {
  const Icon = categoryIcon(event.category);
  const colorClasses = categoryColor(event.category);

  return (
    <div className="flex items-start gap-3 py-3.5 px-3 rounded-xl transition-colors duration-150 hover:bg-slate-800/40 group">
      {/* Icon */}
      <div className={`p-2 rounded-lg ring-1 flex-shrink-0 ${colorClasses}`}>
        <Icon className="w-4 h-4" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-200">{event.title}</span>
          <Badge variant="neutral" size="sm">{categoryLabel(event.category)}</Badge>
          {event.model && (
            <Badge variant="info" size="sm">{event.model}</Badge>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5">{event.description}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs text-slate-600">
            {relativeTime(event.timestamp)}
          </span>
          {event.costUsd != null && (
            <span className="text-xs font-mono text-amber-400/80">
              {formatUSD(event.costUsd)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ActivityPage() {
  const api = useApiContext();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  const fetchActivity = useCallback(async () => {
    setLoading(true);
    try {
      const systemEvents = await api.events.query({ limit: 50 });
      if (systemEvents.length > 0) {
        const mapped: ActivityEvent[] = systemEvents.map((ev: SystemEvent) => {
          let category: EventCategory = 'task';
          const t = (ev.title ?? '').toLowerCase();
          if (t.includes('wave')) category = 'wave';
          else if (t.includes('gate') || t.includes('quality')) category = 'quality_gate';
          else if (t.includes('commit')) category = 'commit';
          else if (t.includes('decision') || t.includes('select')) category = 'decision';
          else if (t.includes('discover') || t.includes('initiative')) category = 'initiative';

          return {
            id: ev.id,
            timestamp: ev.timestamp,
            category,
            title: ev.title,
            description: ev.description ?? '',
            costUsd: null,
            model: null,
          };
        });
        if (mapped.length > 0) {
          setEvents(mapped);
          setLoading(false);
          return;
        }
      }
      setEvents(mockEvents());
    } catch {
      setEvents(mockEvents());
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  const filtered = categoryFilter === 'all'
    ? events
    : events.filter((e) => e.category === categoryFilter);

  const categories: CategoryFilter[] = [
    'all', 'wave', 'task', 'quality_gate', 'commit', 'decision', 'initiative',
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
            Agent Activity
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Chronological feed of agent actions and decisions
          </p>
        </div>
        <button
          onClick={fetchActivity}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Cost overlay */}
      <CostBar events={events} />

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-slate-500" />
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategoryFilter(c)}
            className={[
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              categoryFilter === c
                ? 'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/20'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800',
            ].join(' ')}
          >
            {c === 'all' ? 'All' : categoryLabel(c as EventCategory)}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <section className="space-y-0.5">
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 py-3.5 px-3">
              <div className="skeleton h-8 w-8 rounded-lg flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-4 w-3/4" />
                <div className="skeleton h-3 w-1/2" />
                <div className="skeleton h-3 w-1/4" />
              </div>
            </div>
          ))
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No activity"
            message={categoryFilter !== 'all' ? `No ${categoryLabel(categoryFilter as EventCategory).toLowerCase()} events found.` : 'No agent activity recorded yet.'}
          />
        ) : (
          filtered.map((ev) => <EventRow key={ev.id} event={ev} />)
        )}
      </section>
    </div>
  );
}
