'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Plus,
  Play,
  GripVertical,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
  Link2,
  Moon,
} from 'lucide-react';
import NightRunConfigPanel from './night-config';
import type { Task, TaskStatus, NightRunConfig } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Default agent types (fallback if API unavailable)
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_TYPES = [
  'coordinator',
  'researcher',
  'coder',
  'reviewer',
  'writer',
  'analyst',
  'debugger',
  'architect',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskFormData {
  title: string;
  description: string;
  agent_type: string;
  max_turns: number;
  max_usd: number;
  priority: number;
  depends_on: string[];
}

const EMPTY_FORM: TaskFormData = {
  title: '',
  description: '',
  agent_type: 'coder',
  max_turns: 25,
  max_usd: 5.0,
  priority: 1,
  depends_on: [],
};

// ---------------------------------------------------------------------------
// Status utilities
// ---------------------------------------------------------------------------

function statusColor(status: TaskStatus): string {
  switch (status) {
    case 'pending':
      return 'bg-slate-700 border-slate-600';
    case 'running':
      return 'border-blue-500/50 glow-blue';
    case 'completed':
      return 'border-emerald-500/50 glow-green';
    case 'failed':
      return 'border-red-500/50 glow-red';
    default:
      return 'bg-slate-700';
  }
}

function statusBadge(status: TaskStatus) {
  const base = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium';
  switch (status) {
    case 'pending':
      return (
        <span className={`${base} bg-slate-600/50 text-slate-300`}>
          <Clock className="w-3 h-3" /> Pending
        </span>
      );
    case 'running':
      return (
        <span className={`${base} bg-blue-500/20 text-blue-400`}>
          <Loader2 className="w-3 h-3 animate-spin" /> Running
        </span>
      );
    case 'completed':
      return (
        <span className={`${base} bg-emerald-500/20 text-emerald-400`}>
          <CheckCircle2 className="w-3 h-3" /> Completed
        </span>
      );
    case 'failed':
      return (
        <span className={`${base} bg-red-500/20 text-red-400`}>
          <XCircle className="w-3 h-3" /> Failed
        </span>
      );
  }
}

function agentTypeBadge(agentType: string) {
  const colors: Record<string, string> = {
    coordinator: 'bg-purple-500/20 text-purple-400',
    researcher: 'bg-cyan-500/20 text-cyan-400',
    coder: 'bg-blue-500/20 text-blue-400',
    reviewer: 'bg-amber-500/20 text-amber-400',
    writer: 'bg-emerald-500/20 text-emerald-400',
    analyst: 'bg-pink-500/20 text-pink-400',
    debugger: 'bg-red-500/20 text-red-400',
    architect: 'bg-indigo-500/20 text-indigo-400',
  };
  const color = colors[agentType] ?? 'bg-slate-500/20 text-slate-400';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {agentType}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Confirmation Dialog
// ---------------------------------------------------------------------------

function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  loading,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-md mx-4 p-6 space-y-4 animate-fade-in">
        <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
        <div className="text-sm text-slate-300">{children}</div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-lg bg-slate-700 hover:bg-slate-600
                       text-slate-300 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500
                       text-white font-medium transition-colors disabled:opacity-50
                       shadow-[0_0_15px_rgba(59,130,246,0.3)]"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Starting...
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task Modal (Add/Edit)
// ---------------------------------------------------------------------------

function TaskModal({
  open,
  editingTask,
  existingTasks,
  agentTypes,
  onSave,
  onClose,
}: {
  open: boolean;
  editingTask: Task | null;
  existingTasks: Task[];
  agentTypes: string[];
  onSave: (data: TaskFormData, existingId?: string) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<TaskFormData>(EMPTY_FORM);

  useEffect(() => {
    if (editingTask) {
      setForm({
        title: editingTask.metadata.title,
        description: editingTask.metadata.description,
        agent_type: editingTask.metadata.agent_type,
        max_turns: editingTask.metadata.max_turns,
        max_usd: editingTask.metadata.max_usd,
        priority: editingTask.metadata.priority,
        depends_on: editingTask.metadata.depends_on ?? [],
      });
    } else {
      setForm({
        ...EMPTY_FORM,
        priority: existingTasks.length + 1,
      });
    }
  }, [editingTask, existingTasks.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    onSave(form, editingTask?.id);
  };

  const toggleDependency = (taskId: string) => {
    setForm((prev) => ({
      ...prev,
      depends_on: prev.depends_on.includes(taskId)
        ? prev.depends_on.filter((id) => id !== taskId)
        : [...prev.depends_on, taskId],
    }));
  };

  if (!open) return null;

  // Tasks that can be dependencies (exclude self)
  const dependencyCandidates = existingTasks.filter((t) => t.id !== editingTask?.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto animate-fade-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
          <h3 className="text-lg font-semibold text-slate-100">
            {editingTask ? 'Edit Task' : 'Add Task'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300">Title</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Implement auth module"
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700
                         text-slate-100 placeholder:text-slate-600
                         focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40
                         transition-colors text-sm"
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-300">
              Description{' '}
              <span className="text-slate-500 font-normal">(agent instructions)</span>
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Detailed instructions for the agent. Be specific about expected output, constraints, and success criteria..."
              rows={8}
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700
                         text-slate-100 placeholder:text-slate-600
                         focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40
                         transition-colors text-sm font-mono resize-y"
            />
          </div>

          {/* Agent type + Priority row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-300">Agent Type</label>
              <select
                value={form.agent_type}
                onChange={(e) => setForm({ ...form, agent_type: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700
                           text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40
                           focus:border-blue-500/40 transition-colors text-sm"
              >
                {agentTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-300">Priority</label>
              <input
                type="number"
                min={1}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Math.max(1, Number(e.target.value)) })}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700
                           text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40
                           focus:border-blue-500/40 transition-colors text-sm"
              />
            </div>
          </div>

          {/* Max turns + Max USD row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-300">Max Turns</label>
              <input
                type="number"
                min={1}
                max={200}
                value={form.max_turns}
                onChange={(e) =>
                  setForm({ ...form, max_turns: Math.max(1, Math.min(200, Number(e.target.value))) })
                }
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700
                           text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40
                           focus:border-blue-500/40 transition-colors text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-300">Max Budget (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>
                <input
                  type="number"
                  min={0.01}
                  max={50}
                  step={0.01}
                  value={form.max_usd}
                  onChange={(e) =>
                    setForm({ ...form, max_usd: Math.max(0.01, Number(e.target.value)) })
                  }
                  className="w-full pl-7 pr-3 py-2 rounded-lg bg-slate-800 border border-slate-700
                             text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40
                             focus:border-blue-500/40 transition-colors text-sm"
                />
              </div>
            </div>
          </div>

          {/* Dependencies */}
          {dependencyCandidates.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-300">
                Dependencies{' '}
                <span className="text-slate-500 font-normal">(tasks that must complete first)</span>
              </label>
              <div className="space-y-1 max-h-40 overflow-y-auto rounded-lg bg-slate-800/50 border border-slate-700 p-2">
                {dependencyCandidates.map((t) => (
                  <label
                    key={t.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-700/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={form.depends_on.includes(t.id)}
                      onChange={() => toggleDependency(t.id)}
                      className="rounded border-slate-600 bg-slate-700 text-blue-500
                                 focus:ring-blue-500/40 focus:ring-offset-0"
                    />
                    <span className="text-sm text-slate-300">
                      #{t.metadata.priority} {t.metadata.title}
                    </span>
                    {agentTypeBadge(t.metadata.agent_type)}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-3 border-t border-slate-700/50">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-slate-700 hover:bg-slate-600
                         text-slate-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!form.title.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500
                         text-white font-medium transition-colors disabled:opacity-50
                         disabled:cursor-not-allowed"
            >
              {editingTask ? 'Save Changes' : 'Add Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task Card
// ---------------------------------------------------------------------------

function TaskCard({
  task,
  index,
  tasks,
  dragIndex,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onEditTitle,
  onEdit,
  onDelete,
}: {
  task: Task;
  index: number;
  tasks: Task[];
  dragIndex: number | null;
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
  onDrop: (index: number) => void;
  onEditTitle: (id: string, title: string) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(task.metadata.title);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTitle && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [editingTitle]);

  const commitTitle = () => {
    setEditingTitle(false);
    if (titleValue.trim() && titleValue !== task.metadata.title) {
      onEditTitle(task.id, titleValue.trim());
    } else {
      setTitleValue(task.metadata.title);
    }
  };

  const isDragging = dragIndex === index;
  const depTasks = (task.metadata.depends_on ?? [])
    .map((depId) => tasks.find((t) => t.id === depId))
    .filter(Boolean) as Task[];

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDragEnd={onDragEnd}
      onDrop={() => onDrop(index)}
      className={`
        glass-panel border transition-all duration-200
        ${statusColor(task.metadata.status)}
        ${isDragging ? 'opacity-40 scale-95' : 'opacity-100'}
        group
      `}
    >
      <div className="flex items-start gap-3 p-4">
        {/* Drag handle + priority */}
        <div
          className="flex flex-col items-center gap-1 pt-0.5 cursor-grab active:cursor-grabbing
                     text-slate-500 hover:text-slate-300 transition-colors shrink-0"
        >
          <GripVertical className="w-4 h-4" />
          <span className="text-xs font-mono font-bold text-slate-400">
            #{task.metadata.priority}
          </span>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Title row */}
          <div className="flex items-center gap-2">
            {editingTitle ? (
              <input
                ref={titleRef}
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitTitle();
                  if (e.key === 'Escape') {
                    setTitleValue(task.metadata.title);
                    setEditingTitle(false);
                  }
                }}
                className="flex-1 px-2 py-0.5 rounded bg-slate-800 border border-blue-500/40
                           text-slate-100 text-sm focus:outline-none"
              />
            ) : (
              <span
                className="text-sm font-medium text-slate-100 cursor-pointer
                           hover:text-blue-400 transition-colors truncate"
                onDoubleClick={() => setEditingTitle(true)}
                title="Double-click to edit"
              >
                {task.metadata.title}
              </span>
            )}
          </div>

          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-2">
            {agentTypeBadge(task.metadata.agent_type)}
            <span className="text-xs text-slate-500 font-mono">
              ${task.metadata.max_usd.toFixed(2)}
            </span>
            <span className="text-xs text-slate-500">
              {task.metadata.max_turns} turns
            </span>
            {statusBadge(task.metadata.status)}
          </div>

          {/* Dependencies */}
          {depTasks.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <Link2 className="w-3 h-3 text-slate-500" />
              {depTasks.map((dep) => (
                <span
                  key={dep.id}
                  className="text-xs px-1.5 py-0.5 rounded bg-slate-700/70 text-slate-400"
                >
                  #{dep.metadata.priority} {dep.metadata.title}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => onEdit(task)}
            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
            title="Edit task"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(task.id)}
            className="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors"
            title="Delete task"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dependency Graph (SVG visualization)
// ---------------------------------------------------------------------------

function DependencyGraph({ tasks }: { tasks: Task[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Build dependency edges
  const edges = useMemo(() => {
    const result: Array<{ from: number; to: number }> = [];
    for (let i = 0; i < tasks.length; i++) {
      const deps = tasks[i].metadata.depends_on ?? [];
      for (const depId of deps) {
        const depIndex = tasks.findIndex((t) => t.id === depId);
        if (depIndex !== -1) {
          result.push({ from: depIndex, to: i });
        }
      }
    }
    return result;
  }, [tasks]);

  // Identify critical path (longest chain)
  const criticalPath = useMemo(() => {
    if (tasks.length === 0) return new Set<number>();

    // Build adjacency list
    const adj = new Map<number, number[]>();
    for (const { from, to } of edges) {
      if (!adj.has(from)) adj.set(from, []);
      adj.get(from)!.push(to);
    }

    // Find longest path using DFS + memoization
    const memo = new Map<number, number[]>();

    function longestFrom(node: number): number[] {
      if (memo.has(node)) return memo.get(node)!;
      const children = adj.get(node) ?? [];
      if (children.length === 0) {
        memo.set(node, [node]);
        return [node];
      }
      let best: number[] = [];
      for (const child of children) {
        const path = longestFrom(child);
        if (path.length > best.length) best = path;
      }
      const result = [node, ...best];
      memo.set(node, result);
      return result;
    }

    let longest: number[] = [];
    for (let i = 0; i < tasks.length; i++) {
      const path = longestFrom(i);
      if (path.length > longest.length) longest = path;
    }

    return new Set(longest);
  }, [tasks, edges]);

  if (tasks.length === 0 || edges.length === 0) {
    return (
      <div ref={containerRef} className="h-full flex items-center justify-center">
        <p className="text-sm text-slate-500">
          {tasks.length === 0
            ? 'Add tasks to see the dependency graph.'
            : 'No dependencies defined between tasks.'}
        </p>
      </div>
    );
  }

  // Layout: horizontal lane per task, sorted by priority
  const nodeCount = tasks.length;
  const padding = 40;
  const nodeW = 140;
  const nodeH = 36;
  const gapX = Math.max(60, (dimensions.width - 2 * padding - nodeW) / Math.max(nodeCount - 1, 1));
  const graphHeight = Math.max(200, nodeH + 120);

  // Position nodes in a horizontal line
  const nodePositions = tasks.map((_, i) => ({
    x: padding + i * gapX,
    y: graphHeight / 2 - nodeH / 2,
  }));

  const statusFill: Record<TaskStatus, string> = {
    pending: '#334155',
    running: '#1e3a5f',
    completed: '#064e3b',
    failed: '#7f1d1d',
  };

  const statusStroke: Record<TaskStatus, string> = {
    pending: '#475569',
    running: '#3b82f6',
    completed: '#10b981',
    failed: '#ef4444',
  };

  return (
    <div ref={containerRef} className="h-full w-full overflow-x-auto">
      <svg
        width={Math.max(dimensions.width, padding * 2 + nodeCount * gapX)}
        height={graphHeight}
        className="select-none"
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="#64748b" />
          </marker>
          <marker
            id="arrowhead-critical"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="#3b82f6" />
          </marker>
        </defs>

        {/* Draw edges */}
        {edges.map(({ from, to }, i) => {
          const x1 = nodePositions[from].x + nodeW;
          const y1 = nodePositions[from].y + nodeH / 2;
          const x2 = nodePositions[to].x;
          const y2 = nodePositions[to].y + nodeH / 2;

          const isCritical = criticalPath.has(from) && criticalPath.has(to);
          const midX = (x1 + x2) / 2;

          // Curved path for better visibility
          const d =
            x1 < x2
              ? `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`
              : `M ${x1} ${y1} C ${x1 + 40} ${y1 - 50}, ${x2 - 40} ${y2 - 50}, ${x2} ${y2}`;

          return (
            <path
              key={`edge-${i}`}
              d={d}
              fill="none"
              stroke={isCritical ? '#3b82f6' : '#475569'}
              strokeWidth={isCritical ? 2 : 1}
              strokeDasharray={isCritical ? undefined : '4 4'}
              markerEnd={`url(#arrowhead${isCritical ? '-critical' : ''})`}
              opacity={isCritical ? 1 : 0.6}
            />
          );
        })}

        {/* Draw nodes */}
        {tasks.map((task, i) => {
          const pos = nodePositions[i];
          const isCritical = criticalPath.has(i);

          return (
            <g key={task.id} transform={`translate(${pos.x}, ${pos.y})`}>
              <rect
                width={nodeW}
                height={nodeH}
                rx={8}
                fill={statusFill[task.metadata.status]}
                stroke={
                  isCritical
                    ? '#3b82f6'
                    : statusStroke[task.metadata.status]
                }
                strokeWidth={isCritical ? 2 : 1}
              />
              {/* Priority badge */}
              <text
                x={10}
                y={nodeH / 2 + 1}
                dominantBaseline="middle"
                fill="#94a3b8"
                fontSize="10"
                fontFamily="monospace"
              >
                #{task.metadata.priority}
              </text>
              {/* Title (truncated) */}
              <text
                x={30}
                y={nodeH / 2 + 1}
                dominantBaseline="middle"
                fill="#e2e8f0"
                fontSize="11"
                fontWeight="500"
              >
                {task.metadata.title.length > 12
                  ? task.metadata.title.substring(0, 12) + '...'
                  : task.metadata.title}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function TasksPage() {
  // ---- State ----
  const [tasks, setTasks] = useState<Task[]>([]);
  const [nightConfig, setNightConfig] = useState<NightRunConfig>({
    total_budget_usd: 20,
    max_duration_hours: 8,
    max_concurrent_agents: 3,
    model: 'sonnet',
  });
  const [agentTypes] = useState<string[]>(DEFAULT_AGENT_TYPES);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  // Confirmation dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [nightRunStarting, setNightRunStarting] = useState(false);

  // Config save state
  const [configSaving, setConfigSaving] = useState(false);

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  // ---- Callbacks ----

  const addTask = useCallback(
    (data: TaskFormData) => {
      const newTask: Task = {
        id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        content: `[Task] ${data.title}: ${data.description}`,
        metadata: {
          type: 'task',
          status: 'pending',
          priority: data.priority,
          agent_type: data.agent_type,
          depends_on: data.depends_on,
          max_turns: data.max_turns,
          max_usd: data.max_usd,
          title: data.title,
          description: data.description,
        },
        created_at: new Date().toISOString(),
      };
      setTasks((prev) => [...prev, newTask]);
      setModalOpen(false);
    },
    [],
  );

  const updateTask = useCallback(
    (data: TaskFormData, existingId: string) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === existingId
            ? {
                ...t,
                content: `[Task] ${data.title}: ${data.description}`,
                metadata: {
                  ...t.metadata,
                  title: data.title,
                  description: data.description,
                  agent_type: data.agent_type,
                  max_turns: data.max_turns,
                  max_usd: data.max_usd,
                  priority: data.priority,
                  depends_on: data.depends_on,
                },
              }
            : t,
        ),
      );
      setEditingTask(null);
      setModalOpen(false);
    },
    [],
  );

  const handleSaveTask = useCallback(
    (data: TaskFormData, existingId?: string) => {
      if (existingId) {
        updateTask(data, existingId);
      } else {
        addTask(data);
      }
    },
    [addTask, updateTask],
  );

  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      // Also remove from dependencies
      return remaining.map((t) => ({
        ...t,
        metadata: {
          ...t.metadata,
          depends_on: t.metadata.depends_on.filter((depId) => depId !== id),
        },
      }));
    });
  }, []);

  const editTitle = useCallback((id: string, title: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              content: `[Task] ${title}: ${t.metadata.description}`,
              metadata: { ...t.metadata, title },
            }
          : t,
      ),
    );
  }, []);

  const openEditModal = useCallback((task: Task) => {
    setEditingTask(task);
    setModalOpen(true);
  }, []);

  const openAddModal = useCallback(() => {
    setEditingTask(null);
    setModalOpen(true);
  }, []);

  // ---- Drag and Drop ----

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDropTarget(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(
    (toIndex: number) => {
      if (dragIndex === null || dragIndex === toIndex) {
        setDragIndex(null);
        setDropTarget(null);
        return;
      }

      setTasks((prev) => {
        const newTasks = [...prev];
        const [moved] = newTasks.splice(dragIndex, 1);
        newTasks.splice(toIndex, 0, moved);
        // Re-assign priorities based on new order
        return newTasks.map((t, i) => ({
          ...t,
          metadata: { ...t.metadata, priority: i + 1 },
        }));
      });

      setDragIndex(null);
      setDropTarget(null);
    },
    [dragIndex],
  );

  // ---- Night Run ----

  const handleSaveConfig = useCallback(async (config: NightRunConfig) => {
    setConfigSaving(true);
    // Simulate save (in production, this persists to OB1 memory)
    await new Promise((r) => setTimeout(r, 400));
    setConfigSaving(false);
  }, []);

  const estimatedCost = useMemo(() => {
    const totalTaskBudget = tasks.reduce((sum, t) => sum + t.metadata.max_usd, 0);
    return Math.min(totalTaskBudget, nightConfig.total_budget_usd);
  }, [tasks, nightConfig.total_budget_usd]);

  const handleStartNightRun = useCallback(async () => {
    setNightRunStarting(true);
    try {
      // In production: api.tasks.startNightRun(nightConfig, tasks.map(t => t.id))
      await new Promise((r) => setTimeout(r, 1000));
      // Mark all pending tasks as running
      setTasks((prev) =>
        prev.map((t) =>
          t.metadata.status === 'pending'
            ? { ...t, metadata: { ...t.metadata, status: 'running' as TaskStatus } }
            : t,
        ),
      );
    } finally {
      setNightRunStarting(false);
      setConfirmOpen(false);
    }
  }, [nightConfig, tasks]);

  // ---- Derived ----

  const pendingCount = tasks.filter((t) => t.metadata.status === 'pending').length;
  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => a.metadata.priority - b.metadata.priority),
    [tasks],
  );

  // ---- Render ----

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Moon className="w-6 h-6 text-blue-400" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-100">
              Night Run Tasks
            </h1>
            {tasks.length > 0 && (
              <span className="text-sm px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400">
                {tasks.length} task{tasks.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={openAddModal}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg
                         bg-slate-800 hover:bg-slate-700 text-slate-200
                         border border-slate-700 hover:border-slate-600
                         transition-all duration-150"
            >
              <Plus className="w-4 h-4" />
              Add Task
            </button>

            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={pendingCount === 0}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg
                         bg-blue-600 hover:bg-blue-500 text-white
                         disabled:opacity-40 disabled:cursor-not-allowed
                         shadow-[0_0_20px_rgba(59,130,246,0.3)]
                         hover:shadow-[0_0_30px_rgba(59,130,246,0.4)]
                         transition-all duration-200"
            >
              <Play className="w-4 h-4" />
              Start Night Run
            </button>
          </div>
        </div>

        {/* Night Run Config */}
        <NightRunConfigPanel
          config={nightConfig}
          onChange={setNightConfig}
          onSave={handleSaveConfig}
          saving={configSaving}
        />

        {/* Task List */}
        <div className="space-y-2">
          {sortedTasks.length === 0 ? (
            <div className="glass-panel flex flex-col items-center justify-center py-16 space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center">
                <Moon className="w-6 h-6 text-slate-600" />
              </div>
              <p className="text-sm text-slate-500">No tasks planned yet.</p>
              <button
                type="button"
                onClick={openAddModal}
                className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                Add your first task
              </button>
            </div>
          ) : (
            sortedTasks.map((task, index) => (
              <div key={task.id} className="relative">
                {/* Drop indicator line */}
                {dropTarget === index && dragIndex !== null && dragIndex !== index && (
                  <div className="absolute -top-1 left-0 right-0 h-0.5 bg-blue-500 rounded-full z-10" />
                )}
                <TaskCard
                  task={task}
                  index={index}
                  tasks={sortedTasks}
                  dragIndex={dragIndex}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragEnd={handleDragEnd}
                  onDrop={handleDrop}
                  onEditTitle={editTitle}
                  onEdit={openEditModal}
                  onDelete={deleteTask}
                />
              </div>
            ))
          )}
        </div>

        {/* Dependency Visualization */}
        {sortedTasks.length > 1 && (
          <div className="glass-panel overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-700/50">
              <h2 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-slate-500" />
                Dependency Graph
                {sortedTasks.some((t) => (t.metadata.depends_on ?? []).length > 0) && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                    Critical path highlighted
                  </span>
                )}
              </h2>
            </div>
            <div className="h-48 p-4">
              <DependencyGraph tasks={sortedTasks} />
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <TaskModal
        open={modalOpen}
        editingTask={editingTask}
        existingTasks={tasks}
        agentTypes={agentTypes}
        onSave={handleSaveTask}
        onClose={() => {
          setModalOpen(false);
          setEditingTask(null);
        }}
      />

      {/* Start Night Run Confirmation */}
      <ConfirmDialog
        open={confirmOpen}
        title="Start Night Run"
        confirmLabel="Start Night Run"
        onConfirm={handleStartNightRun}
        onCancel={() => setConfirmOpen(false)}
        loading={nightRunStarting}
      >
        <div className="space-y-3">
          <p>
            You are about to start a night run with{' '}
            <span className="font-medium text-slate-100">{pendingCount} pending task{pendingCount !== 1 ? 's' : ''}</span>.
          </p>

          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
            <div>
              <span className="text-xs text-slate-500 block">Total Budget</span>
              <span className="text-sm font-medium text-slate-200">
                ${nightConfig.total_budget_usd.toFixed(0)}
              </span>
            </div>
            <div>
              <span className="text-xs text-slate-500 block">Estimated Cost</span>
              <span className="text-sm font-medium text-emerald-400">
                ~${estimatedCost.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-xs text-slate-500 block">Max Duration</span>
              <span className="text-sm font-medium text-slate-200">
                {nightConfig.max_duration_hours}h
              </span>
            </div>
            <div>
              <span className="text-xs text-slate-500 block">Model</span>
              <span className="text-sm font-medium text-slate-200 capitalize">
                {nightConfig.model}
              </span>
            </div>
          </div>

          {estimatedCost >= nightConfig.total_budget_usd * 0.8 && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span className="text-xs text-amber-300">
                Task budgets are close to the total night run budget. Some tasks may not
                complete if earlier tasks consume their full allocation.
              </span>
            </div>
          )}
        </div>
      </ConfirmDialog>
    </div>
  );
}
