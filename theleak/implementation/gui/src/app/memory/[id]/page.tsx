'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Brain,
  Pencil,
  Trash2,
  Clock,
  Tag,
  Star,
  Loader2,
  AlertCircle,
  History,
  GitBranch,
  Info,
  X,
  Shield,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { useApiContext } from '@/app/providers';
import type {
  Memory,
  MemoryVersion,
  MemoryScope,
  MemoryType,
} from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCOPE_COLORS: Record<MemoryScope, string> = {
  personal: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  team: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  project: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  session: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  agent: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
};

const TYPE_COLORS: Record<MemoryType, string> = {
  fact: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  preference: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  decision: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  instruction: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  observation: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
  context: 'bg-slate-400/20 text-slate-300 border-slate-400/30',
};

const SOURCE_LABELS: Record<string, string> = {
  'user-stated': 'User stated',
  'user_stated': 'User stated',
  'model-inferred': 'Model inferred',
  'model_inferred': 'Model inferred',
  'compaction-derived': 'Compaction derived',
  'compaction_derived': 'Compaction derived',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border ${className}`}>
      {children}
    </span>
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
            size={16}
            className={i < level ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}
          />
        </button>
      ))}
    </div>
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

function MetadataRow({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-700/50 last:border-0">
      <div className="text-slate-500 mt-0.5">{icon}</div>
      <div className="flex-1">
        <p className="text-xs text-slate-500 mb-0.5">{label}</p>
        <div className="text-sm text-slate-200">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Modal
// ---------------------------------------------------------------------------

function EditModal({
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || content.trim() === memory.content) {
      onClose();
      return;
    }
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
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 resize-none"
              required
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

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

  const handleConfirm = () => {
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

        <p className="text-sm text-slate-400 mb-4">
          This will soft-delete this memory. It can be recovered later if needed.
        </p>

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
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
          >
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
// Version History Card
// ---------------------------------------------------------------------------

function VersionCard({ version }: { version: MemoryVersion }) {
  const [expanded, setExpanded] = useState(false);
  const preview =
    version.content.length > 200
      ? version.content.slice(0, 200) + '...'
      : version.content;

  return (
    <div className="relative pl-6 pb-6 last:pb-0">
      {/* Timeline line */}
      <div className="absolute left-[7px] top-2 bottom-0 w-px bg-slate-700 last:hidden" />
      {/* Timeline dot */}
      <div className="absolute left-0 top-1.5 w-[15px] h-[15px] rounded-full bg-slate-800 border-2 border-slate-600" />

      <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/50">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-slate-400">
            {format(new Date(version.changed_at), 'MMM d, yyyy HH:mm')}
          </span>
          {version.changed_by && (
            <span className="text-xs text-slate-500">by {version.changed_by}</span>
          )}
        </div>
        {version.change_reason && (
          <p className="text-xs text-slate-500 italic mb-2">
            Reason: {version.change_reason}
          </p>
        )}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-left w-full"
        >
          <p className="text-sm text-slate-300 whitespace-pre-wrap">
            {expanded ? version.content : preview}
          </p>
          {version.content.length > 200 && (
            <span className="text-xs text-blue-400 mt-1 inline-block">
              {expanded ? 'Show less' : 'Show more'}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Related Memory Card
// ---------------------------------------------------------------------------

function RelatedMemoryCard({ memory }: { memory: Memory }) {
  const preview =
    memory.content.length > 120
      ? memory.content.slice(0, 120) + '...'
      : memory.content;

  return (
    <Link
      href={`/memory/${memory.id}`}
      className="block glass-panel-hover p-3 space-y-2"
    >
      <div className="flex items-center gap-2">
        <Badge className={SCOPE_COLORS[memory.scope]}>{memory.scope}</Badge>
        <Badge className={TYPE_COLORS[memory.type]}>{memory.type}</Badge>
      </div>
      <p className="text-sm text-slate-300 leading-relaxed">{preview}</p>
      {memory.similarity != null && memory.similarity > 0 && (
        <SimilarityBar score={memory.similarity} />
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function MemoryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const client = useApiContext();
  const memoryId = params.id as string;

  const [memory, setMemory] = useState<Memory | null>(null);
  const [versions, setVersions] = useState<MemoryVersion[]>([]);
  const [related, setRelated] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modals
  const [showEdit, setShowEdit] = useState(false);
  const [showForget, setShowForget] = useState(false);

  // --- Load memory data ---
  const loadMemory = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Fetch the memory by recalling with its ID
      // The API recall can accept an ID-based lookup
      const results = await client.memory.recall(memoryId, {
        max_results: 1,
        min_similarity: 0.0,
      });
      if (results && results.length > 0) {
        setMemory(results[0]);

        // Load related memories using the memory content as query
        try {
          const relatedResults = await client.memory.recall(results[0].content, {
            max_results: 5,
          });
          // Filter out the current memory from related
          setRelated(relatedResults.filter((r: Memory) => r.id !== memoryId));
        } catch {
          // Related memories are non-critical
        }
      } else {
        setError('Memory not found');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memory');
    } finally {
      setLoading(false);
    }
  }, [client, memoryId]);

  useEffect(() => {
    if (memoryId) loadMemory();
  }, [memoryId, loadMemory]);

  // --- Handlers ---
  const handleForget = async (reason: string) => {
    if (!memory) return;
    try {
      await client.memory.forget(memory.id, reason);
      setShowForget(false);
      router.push('/memory');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to forget memory');
      setShowForget(false);
    }
  };

  const handleUpdated = () => {
    loadMemory();
  };

  // --- Loading state ---
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-blue-400" />
      </div>
    );
  }

  // --- Error state ---
  if (error && !memory) {
    return (
      <div className="min-h-screen p-6 max-w-4xl mx-auto">
        <Link
          href="/memory"
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors mb-6"
        >
          <ArrowLeft size={16} />
          Back to Memory Explorer
        </Link>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle size={48} className="text-red-400 mb-4" />
          <h2 className="text-lg font-medium text-slate-300 mb-2">Memory not found</h2>
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!memory) return null;

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto space-y-6">
      {/* Back link */}
      <Link
        href="/memory"
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
      >
        <ArrowLeft size={16} />
        Back to Memory Explorer
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-blue-500/10 mt-0.5">
            <Brain size={24} className="text-blue-400" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Badge className={SCOPE_COLORS[memory.scope]}>{memory.scope}</Badge>
              <Badge className={TYPE_COLORS[memory.type]}>{memory.type}</Badge>
              <TrustStars level={memory.trust_level} />
            </div>
            <p className="text-xs text-slate-500">
              Created {formatDistanceToNow(new Date(memory.created_at), { addSuffix: true })}
              {memory.updated_at && memory.updated_at !== memory.created_at && (
                <> &middot; Updated {formatDistanceToNow(new Date(memory.updated_at), { addSuffix: true })}</>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowEdit(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 transition-colors"
          >
            <Pencil size={14} />
            Edit
          </button>
          <button
            type="button"
            onClick={() => setShowForget(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/30 transition-colors"
          >
            <Trash2 size={14} />
            Forget
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Main content + sidebar layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Content + Version History */}
        <div className="lg:col-span-2 space-y-6">
          {/* Full content */}
          <div className="glass-panel p-5">
            <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">Content</h2>
            <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
              {memory.content}
            </p>
          </div>

          {/* Version History */}
          <div className="glass-panel p-5">
            <div className="flex items-center gap-2 mb-4">
              <History size={16} className="text-slate-400" />
              <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
                Version History
              </h2>
            </div>

            {versions.length === 0 ? (
              <p className="text-sm text-slate-500">No previous versions recorded.</p>
            ) : (
              <div className="relative">
                {versions.map((v) => (
                  <VersionCard key={v.id} version={v} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar: Metadata + Related */}
        <div className="space-y-6">
          {/* Metadata */}
          <div className="glass-panel p-5">
            <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
              Metadata
            </h2>

            <div className="divide-y divide-slate-700/50">
              <MetadataRow label="ID" icon={<Info size={14} />}>
                <code className="text-xs font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded">
                  {memory.id}
                </code>
              </MetadataRow>

              <MetadataRow label="Scope" icon={<GitBranch size={14} />}>
                <Badge className={SCOPE_COLORS[memory.scope]}>{memory.scope}</Badge>
              </MetadataRow>

              <MetadataRow label="Type" icon={<Tag size={14} />}>
                <Badge className={TYPE_COLORS[memory.type]}>{memory.type}</Badge>
              </MetadataRow>

              <MetadataRow label="Trust Level" icon={<Shield size={14} />}>
                <div className="flex items-center gap-2">
                  <TrustStars level={memory.trust_level} />
                  <span className="text-xs text-slate-500">{memory.trust_level}/5</span>
                </div>
              </MetadataRow>

              {memory.source && (
                <MetadataRow label="Source" icon={<Info size={14} />}>
                  {SOURCE_LABELS[memory.source] ?? memory.source}
                </MetadataRow>
              )}

              <MetadataRow label="Created" icon={<Clock size={14} />}>
                {format(new Date(memory.created_at), 'MMM d, yyyy HH:mm:ss')}
              </MetadataRow>

              {memory.updated_at && memory.updated_at !== memory.created_at && (
                <MetadataRow label="Updated" icon={<Clock size={14} />}>
                  {format(new Date(memory.updated_at), 'MMM d, yyyy HH:mm:ss')}
                </MetadataRow>
              )}

              {memory.tags && memory.tags.length > 0 && (
                <MetadataRow label="Tags" icon={<Tag size={14} />}>
                  <div className="flex flex-wrap gap-1">
                    {memory.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-slate-700/50 text-slate-300"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </MetadataRow>
              )}

              {memory.similarity != null && memory.similarity > 0 && (
                <MetadataRow label="Similarity Score" icon={<Brain size={14} />}>
                  <SimilarityBar score={memory.similarity} />
                </MetadataRow>
              )}
            </div>

            {/* Raw metadata (if present) */}
            {memory.metadata && Object.keys(memory.metadata).length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-700/50">
                <p className="text-xs text-slate-500 mb-2">Additional Metadata</p>
                <pre className="text-xs text-slate-400 bg-slate-900 rounded-lg p-3 overflow-x-auto">
                  {JSON.stringify(memory.metadata, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {/* Related Memories */}
          <div className="glass-panel p-5">
            <div className="flex items-center gap-2 mb-4">
              <GitBranch size={16} className="text-slate-400" />
              <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
                Related Memories
              </h2>
            </div>

            {related.length === 0 ? (
              <p className="text-sm text-slate-500">No related memories found.</p>
            ) : (
              <div className="space-y-3">
                {related.map((rel) => (
                  <RelatedMemoryCard key={rel.id} memory={rel} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showEdit && (
        <EditModal
          memory={memory}
          onClose={() => setShowEdit(false)}
          onUpdated={handleUpdated}
        />
      )}
      {showForget && (
        <ForgetModal
          memory={memory}
          onClose={() => setShowForget(false)}
          onConfirm={handleForget}
        />
      )}
    </div>
  );
}
