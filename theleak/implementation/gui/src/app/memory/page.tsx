'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import {
  Search,
  Brain,
  Plus,
  X,
  Trash2,
  Pencil,
  ChevronDown,
  Tag,
  Filter,
  BarChart3,
  Star,
  Loader2,
  AlertCircle,
  Info,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useApiContext } from '@/app/providers';
import type {
  Memory,
  MemoryStats,
  MemoryScope,
  MemoryType,
  MemorySearchFilters,
} from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCOPES: MemoryScope[] = ['personal', 'team', 'project', 'session', 'agent'];
const TYPES: MemoryType[] = ['fact', 'preference', 'decision', 'instruction', 'observation', 'context'];

const SCOPE_COLORS: Record<MemoryScope, string> = {
  personal: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  team: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  project: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  session: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  agent: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
};

const SCOPE_BAR_COLORS: Record<MemoryScope, string> = {
  personal: 'bg-purple-500',
  team: 'bg-blue-500',
  project: 'bg-emerald-500',
  session: 'bg-slate-500',
  agent: 'bg-amber-500',
};

const TYPE_COLORS: Record<MemoryType, string> = {
  fact: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  preference: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  decision: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  instruction: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  observation: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
  context: 'bg-slate-400/20 text-slate-300 border-slate-400/30',
};

const TYPE_BAR_COLORS: Record<string, string> = {
  fact: 'bg-cyan-500',
  preference: 'bg-pink-500',
  decision: 'bg-orange-500',
  instruction: 'bg-indigo-500',
  observation: 'bg-teal-500',
  context: 'bg-slate-400',
};

const SOURCE_LABELS: Record<string, string> = {
  'user-stated': 'User stated',
  'model-inferred': 'Model inferred',
  'compaction-derived': 'Compaction derived',
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TrustDots({ level }: { level: number }) {
  return (
    <div className="flex items-center gap-0.5" title={`Trust level: ${level}/5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className={`w-1.5 h-1.5 rounded-full transition-colors ${
            i < level ? 'bg-amber-400' : 'bg-slate-700'
          }`}
        />
      ))}
    </div>
  );
}

function TrustStars({
  level,
  interactive = false,
  onChange,
}: {
  level: number;
  interactive?: boolean;
  onChange?: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <button
          key={i}
          type="button"
          disabled={!interactive}
          onClick={() => onChange?.(i + 1)}
          className={interactive ? 'cursor-pointer hover:scale-110 transition-transform' : 'cursor-default'}
        >
          <Star
            size={14}
            className={i < level ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}
          />
        </button>
      ))}
    </div>
  );
}

function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${className}`}>
      {children}
    </span>
  );
}

function SimilarityBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-400 tabular-nums w-9 text-right">{pct}%</span>
    </div>
  );
}

function Dropdown({
  label,
  value,
  options,
  onChange,
  allLabel = 'All',
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-300 hover:bg-slate-700 hover:border-slate-600 transition-colors"
      >
        <span className="text-slate-500 text-xs">{label}:</span>
        <span className="capitalize">{value || allLabel}</span>
        <ChevronDown size={14} className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[140px] py-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl animate-fade-in">
          <button
            type="button"
            onClick={() => { onChange(''); setOpen(false); }}
            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-slate-700 transition-colors ${
              !value ? 'text-blue-400' : 'text-slate-300'
            }`}
          >
            {allLabel}
          </button>
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => { onChange(opt); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-sm capitalize hover:bg-slate-700 transition-colors ${
                value === opt ? 'text-blue-400' : 'text-slate-300'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniBarChart({ data, colorMap }: { data: Record<string, number>; colorMap: Record<string, string> }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  if (total === 0) return <span className="text-xs text-slate-500">No data</span>;

  return (
    <div className="space-y-1.5">
      {Object.entries(data).map(([key, count]) => {
        const pct = Math.round((count / total) * 100);
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="text-xs text-slate-400 capitalize w-20 truncate">{key}</span>
            <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${colorMap[key] ?? 'bg-slate-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-slate-500 tabular-nums w-7 text-right">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

function StatCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-panel p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="text-slate-400">{icon}</div>
        <h3 className="stat-label">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memory Card
// ---------------------------------------------------------------------------

function MemoryCard({
  memory,
  onForget,
  onEdit,
}: {
  memory: Memory;
  onForget: (m: Memory) => void;
  onEdit: (m: Memory) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = memory.content.length > 200 ? memory.content.slice(0, 200) + '...' : memory.content;

  return (
    <div className="glass-panel-hover p-4 flex flex-col gap-3 group">
      {/* Top row: badges */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={SCOPE_COLORS[memory.scope]}>{memory.scope}</Badge>
        <Badge className={TYPE_COLORS[memory.type]}>{memory.type}</Badge>
        <TrustDots level={memory.trust_level} />
        <span className="ml-auto text-xs text-slate-500">
          {formatDistanceToNow(new Date(memory.created_at), { addSuffix: true })}
        </span>
      </div>

      {/* Content */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-left w-full"
      >
        <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
          {expanded ? memory.content : preview}
        </p>
        {memory.content.length > 200 && (
          <span className="text-xs text-blue-400 mt-1 inline-block">
            {expanded ? 'Show less' : 'Show more'}
          </span>
        )}
      </button>

      {/* Similarity bar (search results only) */}
      {memory.similarity != null && memory.similarity > 0 && (
        <div className="mt-1">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-xs text-slate-500">Relevance</span>
          </div>
          <SimilarityBar score={memory.similarity} />
        </div>
      )}

      {/* Bottom row: source, tags, actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-slate-700/50">
        {memory.source && (
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <Info size={10} />
            {SOURCE_LABELS[memory.source] ?? memory.source}
          </span>
        )}

        {memory.tags && memory.tags.length > 0 && (
          <div className="flex items-center gap-1 ml-1">
            <Tag size={10} className="text-slate-500" />
            {memory.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-xs text-slate-500">#{tag}</span>
            ))}
            {memory.tags.length > 3 && (
              <span className="text-xs text-slate-600">+{memory.tags.length - 3}</span>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Link
            href={`/memory/${memory.id}`}
            className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            title="View details"
          >
            <Search size={14} />
          </Link>
          <button
            type="button"
            onClick={() => onEdit(memory)}
            className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            title="Edit memory"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={() => onForget(memory)}
            className="p-1.5 rounded-md hover:bg-red-900/30 text-slate-400 hover:text-red-400 transition-colors"
            title="Forget memory"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Memory Modal
// ---------------------------------------------------------------------------

function CreateMemoryModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const client = useApiContext();
  const [content, setContent] = useState('');
  const [scope, setScope] = useState<MemoryScope>('personal');
  const [type, setType] = useState<MemoryType>('fact');
  const [trustLevel, setTrustLevel] = useState(3);
  const [tagsInput, setTagsInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    setSaving(true);
    setError('');
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      await client.memory.store(content.trim(), {
        memory_scope: scope,
        memory_type: type,
        tags: tags.length > 0 ? tags : undefined,
        trust_level: trustLevel,
        source_type: 'user_stated',
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to store memory');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg mx-4 glass-panel p-6 shadow-2xl animate-slide-in">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Plus size={18} className="text-blue-400" />
            Create Memory
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Content */}
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              placeholder="What should the AI remember?"
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 resize-none"
              required
            />
          </div>

          {/* Scope + Type row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-400 mb-1.5">Scope</label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as MemoryScope)}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 capitalize"
              >
                {SCOPES.map((s) => (
                  <option key={s} value={s} className="capitalize">{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1.5">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as MemoryType)}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 capitalize"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t} className="capitalize">{t}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Trust level */}
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Trust Level</label>
            <div className="flex items-center gap-3">
              <TrustStars level={trustLevel} interactive onChange={setTrustLevel} />
              <span className="text-xs text-slate-500">{trustLevel}/5</span>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Tags (comma-separated)</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. coding, preferences, tools"
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !content.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Store Memory
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Memory Modal
// ---------------------------------------------------------------------------

function EditMemoryModal({
  memory,
  onClose,
  onUpdated,
}: {
  memory: Memory;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const client = useApiContext();
  const [content, setContent] = useState(memory.content);
  const [scope, setScope] = useState<MemoryScope>(memory.scope);
  const [type, setType] = useState<MemoryType>(memory.type);
  const [trustLevel, setTrustLevel] = useState(memory.trust_level);
  const [tagsInput, setTagsInput] = useState((memory.tags ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await client.memory.update(memory.id, {
        new_content: content.trim(),
        reason: 'Updated via Memory Explorer',
      });
      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update memory');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg mx-4 glass-panel p-6 shadow-2xl animate-slide-in">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Pencil size={18} className="text-blue-400" />
            Edit Memory
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 resize-none"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-400 mb-1.5">Scope</label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as MemoryScope)}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 capitalize"
              >
                {SCOPES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1.5">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as MemoryType)}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 capitalize"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Trust Level</label>
            <div className="flex items-center gap-3">
              <TrustStars level={trustLevel} interactive onChange={setTrustLevel} />
              <span className="text-xs text-slate-500">{trustLevel}/5</span>
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Tags (comma-separated)</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forget Confirmation Modal
// ---------------------------------------------------------------------------

function ForgetModal({
  memory,
  onClose,
  onConfirm,
}: {
  memory: Memory;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (!reason.trim()) return;
    setSubmitting(true);
    onConfirm(reason.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md mx-4 glass-panel p-6 shadow-2xl animate-slide-in">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-lg bg-red-500/10">
            <Trash2 size={18} className="text-red-400" />
          </div>
          <h2 className="text-lg font-semibold text-slate-100">Forget Memory</h2>
        </div>

        <p className="text-sm text-slate-400 mb-2">
          This will soft-delete the following memory. It can be recovered later if needed.
        </p>
        <div className="bg-slate-900 rounded-lg p-3 mb-4 text-sm text-slate-300 max-h-24 overflow-y-auto">
          {memory.content.length > 150 ? memory.content.slice(0, 150) + '...' : memory.content}
        </div>

        <label className="block text-sm text-slate-400 mb-1.5">Reason for forgetting</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Outdated, incorrect, duplicate..."
          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-red-500/50 mb-4"
          autoFocus
        />

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!reason.trim() || submitting}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Forget
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function MemoryExplorerPage() {
  const client = useApiContext();

  // --- State ---
  const [query, setQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [trustFilter, setTrustFilter] = useState(0); // 0 = no filter
  const [memories, setMemories] = useState<Memory[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<Memory | null>(null);
  const [forgetTarget, setForgetTarget] = useState<Memory | null>(null);

  const debouncedQuery = useDebounce(query, 300);

  // --- Load stats ---
  const loadStats = useCallback(async () => {
    try {
      const s = await client.memory.stats();
      setStats(s);
    } catch {
      // Stats are non-critical; silently ignore
    }
  }, [client]);

  // --- Load / search memories ---
  const loadMemories = useCallback(async (searchQuery: string, filters: MemorySearchFilters) => {
    const isSearch = searchQuery.trim().length > 0;
    if (isSearch) setSearching(true);
    else setLoading(true);

    setError('');

    try {
      let results: Memory[];
      if (isSearch) {
        // Semantic search via pgvector embeddings
        results = await client.memory.recall(searchQuery, {
          ...(filters.scope ? { memory_scope: filters.scope } : {}),
          ...(filters.type ? { memory_type: filters.type } : {}),
          ...(filters.min_trust ? { min_trust: filters.min_trust } : {}),
          max_results: 50,
        });
      } else {
        // Browse: use recall with a broad query and low similarity threshold
        results = await client.memory.recall('*', {
          ...(filters.scope ? { memory_scope: filters.scope } : {}),
          ...(filters.type ? { memory_type: filters.type } : {}),
          ...(filters.min_trust ? { min_trust: filters.min_trust } : {}),
          max_results: 50,
          min_similarity: 0.0,
        });
      }
      setMemories(results);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to load memories');
    } finally {
      setLoading(false);
      setSearching(false);
    }
  }, [client]);

  // --- Build active filters ---
  const filters = useMemo<MemorySearchFilters>(() => {
    const f: MemorySearchFilters = {};
    if (scopeFilter) f.scope = scopeFilter as MemoryScope;
    if (typeFilter) f.type = typeFilter as MemoryType;
    if (trustFilter > 0) f.min_trust = trustFilter;
    return f;
  }, [scopeFilter, typeFilter, trustFilter]);

  // --- Effect: search / browse when query or filters change ---
  useEffect(() => {
    loadMemories(debouncedQuery, filters);
  }, [debouncedQuery, filters, loadMemories]);

  // --- Effect: load stats on mount ---
  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // --- Handlers ---
  const handleForget = async (reason: string) => {
    if (!forgetTarget) return;
    try {
      await client.memory.forget(forgetTarget.id, reason);
      setForgetTarget(null);
      loadMemories(debouncedQuery, filters);
      loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to forget memory');
      setForgetTarget(null);
    }
  };

  const handleCreated = () => {
    loadMemories(debouncedQuery, filters);
    loadStats();
  };

  const handleUpdated = () => {
    loadMemories(debouncedQuery, filters);
  };

  const hasActiveFilters = scopeFilter || typeFilter || trustFilter > 0;
  const isSearching = debouncedQuery.trim().length > 0;

  return (
    <div className="min-h-screen p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-500/10">
            <Brain size={24} className="text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Memory Explorer</h1>
            <p className="text-sm text-slate-500">Browse, search, and manage stored knowledge</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          New Memory
        </button>
      </div>

      {/* Search Bar */}
      <div className="glass-panel p-4 space-y-3">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          {searching && (
            <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 animate-spin" />
          )}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memories..."
            className="w-full pl-10 pr-10 py-3 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-base placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-colors"
          />
        </div>

        {/* Filter pills */}
        <div className="flex flex-wrap items-center gap-2">
          <Filter size={14} className="text-slate-500" />
          <Dropdown label="Scope" value={scopeFilter} options={SCOPES} onChange={setScopeFilter} />
          <Dropdown label="Type" value={typeFilter} options={TYPES} onChange={setTypeFilter} />

          {/* Trust level slider */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700">
            <span className="text-xs text-slate-500">Min trust:</span>
            <input
              type="range"
              min={0}
              max={5}
              value={trustFilter}
              onChange={(e) => setTrustFilter(Number(e.target.value))}
              className="w-20 h-1 accent-amber-400 bg-slate-700 rounded-full cursor-pointer"
            />
            <span className="text-sm text-slate-300 tabular-nums w-4 text-center">
              {trustFilter || '-'}
            </span>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => { setScopeFilter(''); setTypeFilter(''); setTrustFilter(0); }}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
            >
              <X size={12} />
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Memories" icon={<Brain size={16} />}>
            <p className="stat-value">{stats.total_thoughts.toLocaleString()}</p>
            <p className="text-xs text-slate-500 mt-1">{stats.thoughts_today} added today</p>
          </StatCard>

          <StatCard title="By Scope" icon={<BarChart3 size={16} />}>
            <MiniBarChart data={stats.by_scope ?? {}} colorMap={SCOPE_BAR_COLORS} />
          </StatCard>

          <StatCard title="By Type" icon={<BarChart3 size={16} />}>
            <MiniBarChart data={stats.by_type ?? {}} colorMap={TYPE_BAR_COLORS} />
          </StatCard>

          <StatCard title="Average Trust" icon={<Star size={16} />}>
            <p className="stat-value">{(stats.average_trust ?? 0).toFixed(1)}</p>
            <TrustDots level={Math.round(stats.average_trust ?? 0)} />
          </StatCard>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Memory Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-blue-400" />
        </div>
      ) : memories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Brain size={48} className="text-slate-700 mb-4" />
          {isSearching || hasActiveFilters ? (
            <>
              <h3 className="text-lg font-medium text-slate-400 mb-1">No matching memories</h3>
              <p className="text-sm text-slate-500">
                Try adjusting your search query or filters.
              </p>
            </>
          ) : (
            <>
              <h3 className="text-lg font-medium text-slate-400 mb-1">No memories yet</h3>
              <p className="text-sm text-slate-500 max-w-md">
                Start storing knowledge to build your brain. Click &quot;New Memory&quot; to create your first entry.
              </p>
            </>
          )}
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-slate-500">
              {isSearching ? 'Search results' : 'All memories'} ({memories.length})
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {memories.map((mem) => (
              <MemoryCard
                key={mem.id}
                memory={mem}
                onForget={setForgetTarget}
                onEdit={setEditTarget}
              />
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <CreateMemoryModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      )}
      {editTarget && (
        <EditMemoryModal memory={editTarget} onClose={() => setEditTarget(null)} onUpdated={handleUpdated} />
      )}
      {forgetTarget && (
        <ForgetModal memory={forgetTarget} onClose={() => setForgetTarget(null)} onConfirm={handleForget} />
      )}
    </div>
  );
}
