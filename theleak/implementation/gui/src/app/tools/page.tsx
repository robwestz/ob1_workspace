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
} from 'recharts';
import {
  Search,
  LayoutGrid,
  List,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Edit3,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import { api } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SourceType = 'built_in' | 'plugin' | 'skill' | 'mcp';
type PermissionLevel = 'allow' | 'deny' | 'ask' | 'escalate';

interface ToolEntry {
  id: string;
  name: string;
  description?: string;
  source_type: SourceType;
  permission_level: PermissionLevel;
  enabled: boolean;
  side_effects?: string;
}

interface PermissionPolicy {
  id: string;
  name: string;
  rules: PolicyRule[];
  active: boolean;
}

interface PolicyRule {
  tool_pattern: string;
  permission: PermissionLevel;
}

interface AuditEntry {
  id: string;
  tool: string;
  decision: 'allow' | 'deny' | 'escalate';
  reason?: string;
  timestamp: string;
  session_id?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_STYLES: Record<SourceType, string> = {
  built_in: 'bg-blue-400/10 text-blue-400 border-blue-400/20',
  plugin: 'bg-purple-400/10 text-purple-400 border-purple-400/20',
  skill: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
  mcp: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
};

const SOURCE_LABELS: Record<SourceType, string> = {
  built_in: 'Built-in',
  plugin: 'Plugin',
  skill: 'Skill',
  mcp: 'MCP',
};

const PERMISSION_STYLES: Record<PermissionLevel, string> = {
  allow: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
  deny: 'bg-red-400/10 text-red-400 border-red-400/20',
  ask: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
  escalate: 'bg-purple-400/10 text-purple-400 border-purple-400/20',
};

const PERMISSION_ICONS: Record<PermissionLevel, React.ReactNode> = {
  allow: <ShieldCheck className="w-3.5 h-3.5" />,
  deny: <ShieldX className="w-3.5 h-3.5" />,
  ask: <ShieldAlert className="w-3.5 h-3.5" />,
  escalate: <Shield className="w-3.5 h-3.5" />,
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

function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-36 w-full rounded-xl" />
      ))}
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="glass-panel border-red-500/30 p-4 flex items-center gap-3">
      <XCircle className="text-red-400 w-5 h-5 shrink-0" />
      <span className="text-red-300 text-sm flex-1">{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="text-xs text-slate-400 hover:text-slate-200 underline">
          Retry
        </button>
      )}
    </div>
  );
}

function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="glass-panel p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function SourceBadge({ source }: { source: SourceType }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${SOURCE_STYLES[source]}`}
    >
      {SOURCE_LABELS[source]}
    </span>
  );
}

function PermissionBadge({ level }: { level: PermissionLevel }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${PERMISSION_STYLES[level]}`}
    >
      {PERMISSION_ICONS[level]}
      {level.toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? 'bg-blue-600' : 'bg-slate-700'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tool Card (card view)
// ---------------------------------------------------------------------------

function ToolCard({
  tool,
  onToggle,
}: {
  tool: ToolEntry;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  return (
    <div className="glass-panel-hover p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-200">{tool.name}</span>
          <SourceBadge source={tool.source_type} />
        </div>
        <Toggle checked={tool.enabled} onChange={(val) => onToggle(tool.id, val)} />
      </div>
      {tool.description && (
        <p className="text-xs text-slate-400 line-clamp-2">{tool.description}</p>
      )}
      <div className="flex items-center gap-3">
        <PermissionBadge level={tool.permission_level} />
        {tool.side_effects && (
          <span className="text-[10px] text-slate-500 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-amber-500/60" />
            {tool.side_effects}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool Row (table view)
// ---------------------------------------------------------------------------

function ToolRow({
  tool,
  onToggle,
}: {
  tool: ToolEntry;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  return (
    <tr className="hover:bg-slate-700/20 transition-colors">
      <td className="px-4 py-3 text-sm text-slate-200 font-medium">{tool.name}</td>
      <td className="px-4 py-3">
        <SourceBadge source={tool.source_type} />
      </td>
      <td className="px-4 py-3">
        <PermissionBadge level={tool.permission_level} />
      </td>
      <td className="px-4 py-3">
        <Toggle checked={tool.enabled} onChange={(val) => onToggle(tool.id, val)} />
      </td>
      <td className="px-4 py-3 text-xs text-slate-400 max-w-[250px] truncate">
        {tool.description ?? '-'}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">
        {tool.side_effects ? (
          <span className="flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-amber-500/60" />
            {tool.side_effects}
          </span>
        ) : (
          '-'
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Tool List Section
// ---------------------------------------------------------------------------

function ToolList({
  tools,
  loading,
  error,
  onToggle,
}: {
  tools: ToolEntry[];
  loading: boolean;
  error: string | null;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceType | 'all'>('all');

  const filtered = useMemo(() => {
    let list = tools;
    if (sourceFilter !== 'all') list = list.filter((t) => t.source_type === sourceFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [tools, sourceFilter, search]);

  return (
    <Section
      title="Tool Registry"
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('table')}
            className={`p-1.5 rounded ${
              viewMode === 'table'
                ? 'bg-slate-700/60 text-slate-200'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            title="Table view"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('card')}
            className={`p-1.5 rounded ${
              viewMode === 'card'
                ? 'bg-slate-700/60 text-slate-200'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            title="Card view"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
        </div>
      }
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search tools..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50
                       text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none
                       focus:ring-1 focus:ring-blue-500/50"
          />
        </div>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as SourceType | 'all')}
          className="px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50
                     text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
        >
          <option value="all">All sources</option>
          <option value="built_in">Built-in</option>
          <option value="plugin">Plugin</option>
          <option value="skill">Skill</option>
          <option value="mcp">MCP</option>
        </select>
        <span className="text-xs text-slate-500">
          {filtered.length} tool{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        viewMode === 'card' ? (
          <SkeletonCards />
        ) : (
          <SkeletonRows />
        )
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-600">
          No tools match the current filters.
        </p>
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => (
            <ToolCard key={t.id} tool={t} onToggle={onToggle} />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-700/50">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Permission</th>
                <th className="px-4 py-3">Enabled</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Side Effects</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {filtered.map((t) => (
                <ToolRow key={t.id} tool={t} onToggle={onToggle} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Permission Policies Section
// ---------------------------------------------------------------------------

function PermissionPolicies({
  policies,
  loading,
}: {
  policies: PermissionPolicy[];
  loading: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingRuleIdx, setEditingRuleIdx] = useState<{
    policyId: string;
    idx: number;
  } | null>(null);

  if (loading) {
    return (
      <Section title="Permission Policies">
        <SkeletonRows count={3} />
      </Section>
    );
  }

  if (policies.length === 0) {
    return (
      <Section
        title="Permission Policies"
        actions={
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium transition-colors">
            <Plus className="w-3.5 h-3.5" />
            New Policy
          </button>
        }
      >
        <p className="text-sm text-slate-500">
          No policies configured. Create one to define default tool permissions.
        </p>
      </Section>
    );
  }

  return (
    <Section
      title="Permission Policies"
      actions={
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium transition-colors">
          <Plus className="w-3.5 h-3.5" />
          New Policy
        </button>
      }
    >
      <div className="space-y-1">
        {policies.map((policy) => {
          const isOpen = expandedId === policy.id;
          return (
            <div key={policy.id}>
              <button
                onClick={() => setExpandedId(isOpen ? null : policy.id)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-slate-700/40 transition-colors text-left"
              >
                {isOpen ? (
                  <ChevronDown className="w-4 h-4 text-slate-500" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-500" />
                )}
                <span className="text-sm font-medium text-slate-200 flex-1">{policy.name}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                    policy.active
                      ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20'
                      : 'bg-slate-700/40 text-slate-500 border-slate-600/30'
                  }`}
                >
                  {policy.active ? 'ACTIVE' : 'INACTIVE'}
                </span>
                <span className="text-xs text-slate-500">{policy.rules.length} rules</span>
              </button>

              {isOpen && (
                <div className="ml-11 pl-4 pb-3 border-l border-slate-700/50 space-y-2 slide-in">
                  {policy.rules.map((rule, idx) => {
                    const isEditing =
                      editingRuleIdx?.policyId === policy.id && editingRuleIdx?.idx === idx;
                    return (
                      <div
                        key={idx}
                        className="flex items-center gap-3 px-3 py-2 rounded-md bg-slate-900/40"
                      >
                        <span className="text-xs text-slate-300 font-mono flex-1">
                          {rule.tool_pattern}
                        </span>
                        <PermissionBadge level={rule.permission} />
                        <button
                          onClick={() =>
                            setEditingRuleIdx(isEditing ? null : { policyId: policy.id, idx })
                          }
                          className="p-1 rounded hover:bg-slate-700/40 text-slate-500 hover:text-slate-300 transition-colors"
                          title="Edit rule"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          className="p-1 rounded hover:bg-red-500/10 text-slate-600 hover:text-red-400 transition-colors"
                          title="Remove rule"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-700/30 transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                    Add rule
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Audit Trail Section
// ---------------------------------------------------------------------------

function AuditTrail({
  entries,
  loading,
}: {
  entries: AuditEntry[];
  loading: boolean;
}) {
  // Top denied tools chart data
  const denialData = useMemo(() => {
    const map = new Map<string, { deny: number; total: number }>();
    for (const e of entries) {
      const current = map.get(e.tool) ?? { deny: 0, total: 0 };
      current.total++;
      if (e.decision === 'deny') current.deny++;
      map.set(e.tool, current);
    }
    return Array.from(map.entries())
      .filter(([, v]) => v.deny > 0)
      .sort((a, b) => b[1].deny - a[1].deny)
      .slice(0, 8)
      .map(([tool, v]) => ({
        tool: tool.length > 20 ? tool.slice(0, 18) + '...' : tool,
        denials: v.deny,
        rate: Math.round((v.deny / v.total) * 100),
      }));
  }, [entries]);

  // Overall denial rate
  const overallRate = useMemo(() => {
    if (entries.length === 0) return 0;
    const denied = entries.filter((e) => e.decision === 'deny').length;
    return Math.round((denied / entries.length) * 100);
  }, [entries]);

  const recentDecisions = entries.slice(0, 20);

  if (loading) {
    return (
      <Section title="Audit Trail">
        <SkeletonRows count={4} />
      </Section>
    );
  }

  return (
    <Section title="Audit Trail">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900/40 rounded-lg p-3 text-center">
          <div className="stat-value">{entries.length}</div>
          <div className="stat-label">Total Decisions</div>
        </div>
        <div className="bg-slate-900/40 rounded-lg p-3 text-center">
          <div className="stat-value text-emerald-400">
            {entries.filter((e) => e.decision === 'allow').length}
          </div>
          <div className="stat-label">Allowed</div>
        </div>
        <div className="bg-slate-900/40 rounded-lg p-3 text-center">
          <div className="stat-value text-red-400">
            {entries.filter((e) => e.decision === 'deny').length}
          </div>
          <div className="stat-label">Denied</div>
        </div>
        <div className="bg-slate-900/40 rounded-lg p-3 text-center">
          <div
            className={`stat-value ${
              overallRate > 30
                ? 'text-red-400'
                : overallRate > 10
                  ? 'text-amber-400'
                  : 'text-slate-300'
            }`}
          >
            {overallRate}%
          </div>
          <div className="stat-label">Denial Rate</div>
        </div>
      </div>

      {/* Top denied tools chart */}
      {denialData.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-slate-400 mb-3">Top Denied Tools</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={denialData}
                layout="vertical"
                margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis
                  dataKey="tool"
                  type="category"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  width={140}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: '#e2e8f0' }}
                  formatter={(value: number, name: string) => [
                    value,
                    name === 'denials' ? 'Denials' : 'Rate %',
                  ]}
                />
                <Bar dataKey="denials" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Recent decisions table */}
      <div>
        <h3 className="text-sm font-medium text-slate-400 mb-3">Recent Permission Decisions</h3>
        {recentDecisions.length === 0 ? (
          <p className="text-sm text-slate-600">No audit entries recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-700/50">
                  <th className="px-4 py-2">Decision</th>
                  <th className="px-4 py-2">Tool</th>
                  <th className="px-4 py-2">Reason</th>
                  <th className="px-4 py-2">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {recentDecisions.map((entry) => {
                  const decisionStyle =
                    entry.decision === 'allow'
                      ? 'bg-emerald-400/10 text-emerald-400'
                      : entry.decision === 'deny'
                        ? 'bg-red-400/10 text-red-400'
                        : 'bg-amber-400/10 text-amber-400';
                  return (
                    <tr key={entry.id} className="hover:bg-slate-700/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${decisionStyle}`}
                        >
                          {entry.decision}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-300 font-mono text-xs">
                        {entry.tool}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs max-w-[250px] truncate">
                        {entry.reason ?? '-'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs tabular-nums whitespace-nowrap">
                        {new Date(entry.timestamp).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ToolsPage() {
  // Tool registry state
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [toolsLoading, setToolsLoading] = useState(true);
  const [toolsError, setToolsError] = useState<string | null>(null);

  // Permission policies state
  const [policies, setPolicies] = useState<PermissionPolicy[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(true);

  // Audit trail state
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);

  // ---- Fetch tools ----
  const fetchTools = useCallback(async () => {
    setToolsError(null);
    try {
      const data: unknown = await (api as any).tools?.list?.() ??
        await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/tools/registry`,
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.OB1_ACCESS_KEY ?? ''}`,
            },
          },
        ).then((r) => {
          if (!r.ok) throw new Error(`${r.status}`);
          return r.json();
        });
      if (Array.isArray(data)) {
        setTools(
          data.map((t: any) => ({
            id: t.id ?? t.name,
            name: t.name,
            description: t.description,
            source_type: t.source_type ?? t.source ?? 'built_in',
            permission_level: t.permission_level ?? t.permission ?? 'ask',
            enabled: t.enabled ?? true,
            side_effects: t.side_effects ?? t.side_effect_profile,
          })),
        );
      }
    } catch (err) {
      setToolsError(err instanceof Error ? err.message : String(err));
    } finally {
      setToolsLoading(false);
    }
  }, []);

  // ---- Fetch policies ----
  const fetchPolicies = useCallback(async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/tools/policies`,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OB1_ACCESS_KEY ?? ''}`,
          },
        },
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data: unknown = await res.json();
      if (Array.isArray(data)) {
        setPolicies(
          data.map((p: any) => ({
            id: p.id,
            name: p.name,
            rules: p.rules ?? [],
            active: p.active ?? true,
          })),
        );
      }
    } catch {
      // non-critical — policies section shows empty state
    } finally {
      setPoliciesLoading(false);
    }
  }, []);

  // ---- Fetch audit trail ----
  const fetchAudit = useCallback(async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/tools/audit`,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OB1_ACCESS_KEY ?? ''}`,
          },
        },
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const data: unknown = await res.json();
      if (Array.isArray(data)) {
        setAuditEntries(
          data.map((e: any) => ({
            id: e.id,
            tool: e.tool ?? e.tool_name,
            decision: e.decision,
            reason: e.reason,
            timestamp: e.timestamp ?? e.created_at,
            session_id: e.session_id,
          })),
        );
      }
    } catch {
      // non-critical
    } finally {
      setAuditLoading(false);
    }
  }, []);

  // ---- Toggle tool ----
  const handleToggle = useCallback((id: string, enabled: boolean) => {
    setTools((prev) => prev.map((t) => (t.id === id ? { ...t, enabled } : t)));
    // Fire-and-forget update to backend
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/tools/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OB1_ACCESS_KEY ?? ''}`,
      },
      body: JSON.stringify({ tool_id: id, enabled }),
    }).catch(() => {
      // Revert on failure
      setTools((prev) => prev.map((t) => (t.id === id ? { ...t, enabled: !enabled } : t)));
    });
  }, []);

  // ---- Initial load ----
  useEffect(() => {
    fetchTools();
    fetchPolicies();
    fetchAudit();
  }, [fetchTools, fetchPolicies, fetchAudit]);

  return (
    <div className="min-h-screen bg-slate-950 p-6 lg:p-10 space-y-6 fade-in">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Tool Registry</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage available tools, permission policies, and review the audit trail.
        </p>
      </div>

      <ToolList tools={tools} loading={toolsLoading} error={toolsError} onToggle={handleToggle} />

      <PermissionPolicies policies={policies} loading={policiesLoading} />

      <AuditTrail entries={auditEntries} loading={auditLoading} />
    </div>
  );
}
