# Blueprint 07: Memory System -- OB1 as the Agent Memory Backbone

> Primitive #17 (Memory System) for the OB1 agentic architecture.
>
> Status: IMPLEMENTATION BLUEPRINT
> Date: 2026-04-03
> Depends on: OB1 core `thoughts` table (id, content, embedding, metadata, content_fingerprint, created_at, updated_at), Blueprint 02 (agent_sessions, BudgetTracker), Blueprint 04 (context_fragments, provenance, TranscriptCompactor)

---

## 0. Design Thesis

Claude Code's memory system is a file-based directory structure: personal memories in `~/.claude/memory/`, team memories in `.claude/team-memory/`, project memories discovered via ancestor-chain CLAUDE.md walks, session memories in RAM, agent memories per-instance. It has no vector search, no cross-session recall, no contradiction detection, no provenance tracking, and no multi-user sharing.

OB1 already has everything the file system lacks: a `thoughts` table with pgvector embeddings, cosine similarity search via `match_thoughts`, content deduplication via `upsert_thought`, JSONB metadata for arbitrary classification, and an MCP server accessible from any AI client. The file-based memory system becomes a caching layer for what is already in OB1.

**The thesis: OB1 IS the memory system. We do not build a new one. We map the 5-scope memory model (personal, team, project, session, agent) onto OB1's thoughts table using metadata conventions, expose memory operations as MCP tools, and use pgvector for relevance scoring instead of keyword overlap.**

### Architecture Overview

```
+----------------------------------+     +----------------------------------------+
|   Agent Runtime (TS / Edge Fn)   |     |   OB1 Supabase (Postgres + pgvector)   |
|                                  |     |                                        |
|  MemoryManager ------------------|---->|  thoughts (core table)                 |
|    |                             |     |    + memory_scope metadata tag          |
|    +-> ScopeRouter               |     |    + memory_type metadata tag           |
|    +-> RelevanceScorer           |     |    + provenance metadata block          |
|    +-> AgingCalculator           |     |    + version_chain metadata             |
|    +-> PromotionEngine           |     |                                        |
|    +-> ConsolidationEngine       |     |  memory_versions (new table)            |
|    +-> MemoryInjector            |     |    version history for evolving facts   |
|                                  |     |                                        |
|  SessionMemoryBuffer ------------|     |  context_fragments (from BP04)          |
|    (in-memory, ephemeral)        |     |    provenance-tracked injections        |
|                                  |     |                                        |
|  MCP Tools:                      |     |  match_thoughts_scored (new function)   |
|    memory_store                  |     |    pgvector + aging + scope weighting   |
|    memory_recall                 |     |                                        |
|    memory_forget                 |     |  Existing infrastructure:               |
|    memory_update                 |     |    match_thoughts, upsert_thought,      |
|    memory_consolidate            |     |    content_fingerprint, HNSW index      |
+----------------------------------+     +----------------------------------------+
```

### Key Design Decision: No New Core Columns

The `thoughts` table is never structurally modified (per OB1 guard rails). All memory system metadata lives in the existing `metadata` JSONB column. The only new database object is a companion `memory_versions` table for tracking memory evolution, a `match_thoughts_scored` function that wraps `match_thoughts` with aging and scope weighting, and a GIN index path expression for scope-filtered queries.

---

## 1. Memory Architecture: 8-Module System Mapped to OB1

### 1.1 Module Map

The memdir pattern defines 8 modules. Each maps to an OB1 implementation:

| # | Memdir Module | OB1 Implementation | Notes |
|---|---|---|---|
| 1 | `memdir.ts` (core) | `MemoryManager` class | Central orchestrator; talks to Supabase |
| 2 | `memoryTypes.ts` | `metadata.memory_type` enum in JSONB | `fact`, `preference`, `decision`, `instruction`, `observation`, `context` |
| 3 | `findRelevantMemories.ts` | `match_thoughts_scored` SQL function | pgvector cosine similarity + aging + scope weight |
| 4 | `memoryAge.ts` | `AgingCalculator` + SQL `age_factor()` | Half-life decay per memory type |
| 5 | `memoryScan.ts` | Not needed (replaced by pgvector search) | File scanning replaced by database queries |
| 6 | `paths.ts` | `ScopeRouter` maps scopes to metadata filters | No filesystem paths; scope = metadata tag |
| 7 | `teamMemPaths.ts` | `metadata.memory_scope = 'team'` filter | Team memories are thoughts with team scope |
| 8 | `teamMemPrompts.ts` | `MemoryInjector.buildPromptSection()` | Budget-limited injection from scored results |

### 1.2 Memory Scopes as Metadata Tags

Every memory stored in `thoughts` carries a `memory_scope` tag in its metadata. This replaces filesystem path conventions with queryable metadata.

```sql
-- Scope filtering uses the existing GIN index on thoughts.metadata.
-- Add a targeted index path for the most common query pattern:

CREATE INDEX idx_thoughts_memory_scope
  ON thoughts ((metadata->>'memory_scope'))
  WHERE metadata->>'memory_scope' IS NOT NULL;

CREATE INDEX idx_thoughts_memory_type
  ON thoughts ((metadata->>'memory_type'))
  WHERE metadata->>'memory_type' IS NOT NULL;
```

| Scope | metadata.memory_scope | Visibility | Equivalent Memdir Path |
|---|---|---|---|
| Personal | `"personal"` | Single user (filtered by `metadata.owner_id`) | `~/.claude/memory/` |
| Team | `"team"` | All users in a team (filtered by `metadata.team_id`) | `.claude/team-memory/` |
| Project | `"project"` | All sessions in a project (filtered by `metadata.project_id`) | CLAUDE.md chain |
| Session | `"session"` | Single session only (in-memory buffer, not stored) | In-memory messages |
| Agent | `"agent"` | Single agent instance (filtered by `metadata.agent_id`) | Per-agent runtime |

### 1.3 Memory Type Categorization

Each memory is categorized by type, which determines its aging half-life, default trust level, and relevance weight.

```typescript
// types/memory.ts

type MemoryType =
  | 'fact'          // "API endpoint is /v2/users" -- reference information
  | 'preference'    // "User prefers verbose output" -- style/behavior preferences
  | 'decision'      // "We chose PostgreSQL because..." -- architecture/design decisions
  | 'instruction'   // "Always use tabs" -- explicit directives
  | 'observation'   // "The tests take 3 minutes" -- observed behaviors
  | 'context';      // "Currently working on auth refactor" -- situational context

type MemoryScope = 'personal' | 'team' | 'project' | 'session' | 'agent';

interface MemoryMetadata {
  // Classification
  memory_scope: MemoryScope;
  memory_type: MemoryType;
  tags: string[];                    // free-form tags for filtering

  // Ownership
  owner_id?: string;                 // user identifier for personal scope
  team_id?: string;                  // team identifier for team scope
  project_id?: string;               // project identifier for project scope
  agent_id?: string;                 // agent instance for agent scope
  session_id?: string;               // session that created this memory

  // Provenance (connects to Blueprint 04)
  provenance: {
    source_type: 'user_stated' | 'model_inferred' | 'tool_observed' | 'compaction_derived';
    trust_level: number;             // 1-5, where 5 = highest
    created_at: string;              // ISO 8601
    last_validated?: string;         // when this was last confirmed accurate
    contradicted_by?: string[];      // thought IDs that contradict this memory
    source_session_id?: string;      // session where this memory originated
    source_uri?: string;             // file path, URL, etc. of original source
  };

  // Versioning
  version: number;                   // starts at 1, increments on update
  supersedes?: string;               // thought ID of the previous version
  superseded_by?: string;            // thought ID of the newer version (set on old version)

  // Relevance tuning
  relevance_boost?: number;          // manual boost factor (default 1.0)
  pin?: boolean;                     // pinned memories always included (up to budget)

  // Soft delete
  deleted?: boolean;
  deleted_at?: string;
  deleted_reason?: string;
}
```

### 1.4 Metadata Convention for Thoughts

Every memory stored as a thought follows this metadata shape. The content field holds the human-readable memory text. The embedding field holds the pgvector representation for similarity search.

```sql
-- Example: storing a user preference as a personal memory
INSERT INTO thoughts (content, metadata) VALUES (
  'User prefers TypeScript over JavaScript and uses 2-space indentation.',
  '{
    "memory_scope": "personal",
    "memory_type": "preference",
    "tags": ["coding-style", "typescript"],
    "owner_id": "user_abc123",
    "provenance": {
      "source_type": "user_stated",
      "trust_level": 5,
      "created_at": "2026-04-03T10:00:00Z",
      "source_session_id": "ses_xyz789"
    },
    "version": 1,
    "relevance_boost": 1.0
  }'::jsonb
);

-- Example: storing a team architecture decision
INSERT INTO thoughts (content, metadata) VALUES (
  'All API endpoints must use REST conventions. GraphQL was evaluated and rejected due to team unfamiliarity.',
  '{
    "memory_scope": "team",
    "memory_type": "decision",
    "tags": ["api", "architecture"],
    "team_id": "team_eng",
    "provenance": {
      "source_type": "user_stated",
      "trust_level": 5,
      "created_at": "2026-03-15T14:30:00Z",
      "last_validated": "2026-04-01T09:00:00Z"
    },
    "version": 1
  }'::jsonb
);
```

---

## 2. Session Memory vs Persistent Memory

### 2.1 Two-Tier Memory Model

Memory lives in two tiers with a well-defined promotion boundary between them.

```
Tier 1: Session Memory (ephemeral)
+------------------------------------------------+
|  SessionMemoryBuffer (in-memory)               |
|  - Observations from current conversation      |
|  - Tool results, intermediate reasoning        |
|  - Grows every turn                            |
|  - Dies when session ends (unless promoted)    |
|  - Subject to compaction (Blueprint 04)        |
+------------------------------------------------+
           |
           | Promotion (explicit or automatic)
           v
Tier 2: Persistent Memory (durable)
+------------------------------------------------+
|  OB1 thoughts table (Supabase + pgvector)      |
|  - Survives across sessions                    |
|  - Searchable via vector similarity            |
|  - Versioned, provenance-tracked               |
|  - Shared across scopes (personal/team/project)|
|  - Budget-limited injection into new sessions  |
+------------------------------------------------+
```

### 2.2 SessionMemoryBuffer

Session memory is an in-memory buffer that tracks observations, decisions, and facts discovered during the current conversation. It is NOT stored in the `thoughts` table unless promoted.

```typescript
// lib/session-memory-buffer.ts

interface SessionObservation {
  id: string;                        // unique within session
  content: string;
  memory_type: MemoryType;
  observed_at: string;               // ISO 8601
  turn_number: number;
  source: 'user_message' | 'tool_result' | 'model_inference';
  promotion_score: number;           // 0.0-1.0, how worthy of persistence
  promoted: boolean;                 // true once written to thoughts table
}

export class SessionMemoryBuffer {
  private observations: SessionObservation[] = [];
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Record an observation from the current turn.
   * The promotion_score is estimated based on the observation type:
   *   - user_stated instructions/preferences: 0.9 (almost always persist)
   *   - explicit "remember this" requests: 1.0 (always persist)
   *   - model-inferred observations: 0.4 (sometimes persist)
   *   - tool results (raw data): 0.1 (rarely persist, unless remarkable)
   */
  observe(content: string, type: MemoryType, source: SessionObservation['source'], turnNumber: number): void {
    const promotionScore = this.estimatePromotionScore(content, type, source);

    this.observations.push({
      id: crypto.randomUUID(),
      content,
      memory_type: type,
      observed_at: new Date().toISOString(),
      turn_number: turnNumber,
      source,
      promotion_score: promotionScore,
      promoted: false,
    });
  }

  /**
   * Get observations above the promotion threshold.
   * Called at session end or periodically during long sessions.
   */
  getPromotionCandidates(threshold: number = 0.6): SessionObservation[] {
    return this.observations
      .filter(o => !o.promoted && o.promotion_score >= threshold)
      .sort((a, b) => b.promotion_score - a.promotion_score);
  }

  /**
   * Mark observations as promoted after they have been persisted to OB1.
   */
  markPromoted(ids: string[]): void {
    const idSet = new Set(ids);
    for (const obs of this.observations) {
      if (idSet.has(obs.id)) {
        obs.promoted = true;
      }
    }
  }

  /**
   * Estimate how worthy an observation is of persistence.
   */
  private estimatePromotionScore(content: string, type: MemoryType, source: SessionObservation['source']): number {
    let score = 0.3; // base score

    // Source-based scoring
    if (source === 'user_message') score += 0.3;
    if (source === 'model_inference') score += 0.1;
    if (source === 'tool_result') score -= 0.1;

    // Type-based scoring
    if (type === 'instruction') score += 0.3;
    if (type === 'decision') score += 0.25;
    if (type === 'preference') score += 0.2;
    if (type === 'fact') score += 0.15;
    if (type === 'observation') score += 0.05;
    if (type === 'context') score -= 0.1;

    // Content signals
    const lower = content.toLowerCase();
    if (lower.includes('remember') || lower.includes('always') || lower.includes('never')) {
      score += 0.2;
    }
    if (lower.includes('for now') || lower.includes('temporarily') || lower.includes('just this once')) {
      score -= 0.3;
    }

    return Math.max(0, Math.min(1, score));
  }

  /** Total observation count for diagnostics */
  get count(): number {
    return this.observations.length;
  }

  /** How many have been promoted */
  get promotedCount(): number {
    return this.observations.filter(o => o.promoted).length;
  }
}
```

### 2.3 Promotion Engine

The PromotionEngine decides which session observations become persistent memories. It runs at session end and optionally at compaction boundaries.

```typescript
// lib/promotion-engine.ts

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { SessionMemoryBuffer, SessionObservation } from './session-memory-buffer';
import type { MemoryMetadata, MemoryScope, MemoryType } from '../types/memory';

interface PromotionConfig {
  /** Minimum promotion score to auto-persist (default: 0.6) */
  auto_promote_threshold: number;

  /** Maximum memories to promote per session (default: 20) */
  max_promotions_per_session: number;

  /** Default scope for promoted memories (default: 'personal') */
  default_scope: MemoryScope;

  /** Whether to generate embeddings on promotion (default: true) */
  generate_embeddings: boolean;

  /** Whether to check for duplicates before promoting (default: true) */
  deduplicate: boolean;
}

const DEFAULT_PROMOTION_CONFIG: PromotionConfig = {
  auto_promote_threshold: 0.6,
  max_promotions_per_session: 20,
  default_scope: 'personal',
  generate_embeddings: true,
  deduplicate: true,
};

export class PromotionEngine {
  private supabase: SupabaseClient;
  private config: PromotionConfig;

  constructor(
    supabaseUrl: string,
    supabaseKey: string,
    config: PromotionConfig = DEFAULT_PROMOTION_CONFIG,
  ) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.config = config;
  }

  /**
   * Promote session observations to persistent OB1 memories.
   *
   * Flow:
   *   1. Get promotion candidates above threshold
   *   2. Deduplicate against existing thoughts (content fingerprint)
   *   3. Generate embeddings via OpenRouter
   *   4. Insert into thoughts with memory metadata
   *   5. Mark as promoted in the session buffer
   *
   * Returns the IDs of newly created thoughts.
   */
  async promoteFromSession(
    buffer: SessionMemoryBuffer,
    sessionId: string,
    ownerId: string,
    scope?: MemoryScope,
  ): Promise<string[]> {
    const candidates = buffer.getPromotionCandidates(this.config.auto_promote_threshold);

    if (candidates.length === 0) return [];

    // Limit to max_promotions_per_session
    const toPromote = candidates.slice(0, this.config.max_promotions_per_session);
    const promotedIds: string[] = [];

    for (const obs of toPromote) {
      try {
        const thoughtId = await this.promoteOne(obs, sessionId, ownerId, scope ?? this.config.default_scope);
        if (thoughtId) {
          promotedIds.push(thoughtId);
        }
      } catch (err) {
        console.error(`Failed to promote observation ${obs.id}:`, err);
        // Continue with next observation
      }
    }

    // Mark promoted in the buffer
    buffer.markPromoted(toPromote.filter((_, i) => promotedIds[i] != null).map(o => o.id));

    return promotedIds;
  }

  /**
   * Promote a single observation to a persistent thought.
   */
  private async promoteOne(
    obs: SessionObservation,
    sessionId: string,
    ownerId: string,
    scope: MemoryScope,
  ): Promise<string | null> {
    // Deduplication check
    if (this.config.deduplicate) {
      const fingerprint = await this.contentFingerprint(obs.content);
      const { data: existing } = await this.supabase
        .from('thoughts')
        .select('id')
        .eq('content_fingerprint', fingerprint)
        .limit(1);

      if (existing && existing.length > 0) {
        // Duplicate exists -- update its metadata instead
        await this.supabase
          .from('thoughts')
          .update({
            metadata: this.supabase.rpc('jsonb_merge', {
              base: {},
              overlay: { provenance: { last_validated: new Date().toISOString() } },
            }),
          })
          .eq('id', existing[0].id);

        return existing[0].id;
      }
    }

    // Build metadata
    const metadata: MemoryMetadata = {
      memory_scope: scope,
      memory_type: obs.memory_type,
      tags: [],
      owner_id: ownerId,
      session_id: sessionId,
      provenance: {
        source_type: obs.source === 'user_message' ? 'user_stated'
          : obs.source === 'tool_result' ? 'tool_observed'
          : 'model_inferred',
        trust_level: obs.source === 'user_message' ? 5
          : obs.source === 'tool_result' ? 4
          : 3,
        created_at: obs.observed_at,
        source_session_id: sessionId,
      },
      version: 1,
    };

    // Generate embedding if configured
    let embedding: number[] | null = null;
    if (this.config.generate_embeddings) {
      embedding = await this.generateEmbedding(obs.content);
    }

    // Insert into thoughts
    const insertPayload: Record<string, unknown> = {
      content: obs.content,
      metadata,
    };
    if (embedding) {
      insertPayload.embedding = embedding;
    }

    const { data, error } = await this.supabase
      .from('thoughts')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error) {
      console.error('Failed to insert promoted thought:', error.message);
      return null;
    }

    return data?.id ?? null;
  }

  /**
   * Generate a content fingerprint matching OB1's upsert_thought function.
   */
  private async contentFingerprint(content: string): Promise<string> {
    const normalized = content.toLowerCase().trim().replace(/\s+/g, ' ');
    const encoder = new TextEncoder();
    const data = encoder.encode(normalized);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Generate an embedding vector via OpenRouter.
   * Uses text-embedding-3-small (1536 dimensions) to match OB1's vector column.
   */
  private async generateEmbedding(text: string): Promise<number[] | null> {
    const apiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!apiKey) return null;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openai/text-embedding-3-small',
          input: text,
        }),
      });

      if (!response.ok) return null;

      const result = await response.json();
      return result.data?.[0]?.embedding ?? null;
    } catch {
      return null;
    }
  }
}
```

### 2.4 What Merits Persistence vs What Is Ephemeral

| Signal | Persist? | Reasoning |
|---|---|---|
| User says "remember this" | Always | Explicit instruction |
| User states a preference ("I prefer...") | Always | Durable preference |
| Architecture decision made during session | Always | High-value, slow to change |
| Build command discovered by tool | Yes | Factual, reusable |
| Error pattern observed repeatedly | Yes | Diagnostic value |
| Intermediate tool output (file contents) | No | Too large, too specific |
| "For now, let's..." | No | Explicitly temporary |
| Debugging hypothesis that was wrong | No | Negative signal, not reusable |
| Raw git diff output | No | Ephemeral, large |
| Session summary from compaction | Yes | Already handled by Blueprint 04 |

---

## 3. Memory Operations via MCP

Five memory operations exposed as MCP tools, callable from any AI client connected to the OB1 server.

### 3.1 MCP Tool Definitions

```typescript
// supabase/functions/memory-tools/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const TOOLS = {
  memory_store: {
    name: 'memory_store',
    description: 'Store a new memory in OB1 with type, scope, and provenance metadata. Generates an embedding for vector search.',
    inputSchema: {
      type: 'object',
      required: ['content', 'memory_type', 'memory_scope'],
      properties: {
        content: { type: 'string', description: 'The memory content to store.' },
        memory_type: {
          type: 'string',
          enum: ['fact', 'preference', 'decision', 'instruction', 'observation', 'context'],
          description: 'What kind of memory this is.',
        },
        memory_scope: {
          type: 'string',
          enum: ['personal', 'team', 'project', 'agent'],
          description: 'Visibility scope for this memory.',
        },
        source_type: {
          type: 'string',
          enum: ['user_stated', 'model_inferred', 'tool_observed', 'compaction_derived'],
          description: 'How this memory was obtained. Defaults to model_inferred.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for filtering.',
        },
        owner_id: { type: 'string', description: 'User ID for personal scope.' },
        team_id: { type: 'string', description: 'Team ID for team scope.' },
        project_id: { type: 'string', description: 'Project ID for project scope.' },
      },
    },
  },
  memory_recall: {
    name: 'memory_recall',
    description: 'Recall relevant memories from OB1 using semantic search with scope filtering and temporal aging.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Natural language query to search for.' },
        memory_scope: {
          type: 'string',
          enum: ['personal', 'team', 'project', 'agent', 'all'],
          description: 'Scope to search within. "all" searches all accessible scopes. Defaults to "all".',
        },
        memory_type: {
          type: 'string',
          enum: ['fact', 'preference', 'decision', 'instruction', 'observation', 'context'],
          description: 'Filter by memory type. Omit to search all types.',
        },
        max_results: { type: 'number', description: 'Maximum results to return. Defaults to 10.' },
        min_similarity: { type: 'number', description: 'Minimum cosine similarity threshold. Defaults to 0.5.' },
        include_aged_score: { type: 'boolean', description: 'Include age-adjusted score. Defaults to true.' },
        owner_id: { type: 'string', description: 'Filter by owner (for personal scope).' },
        team_id: { type: 'string', description: 'Filter by team (for team scope).' },
        project_id: { type: 'string', description: 'Filter by project (for project scope).' },
      },
    },
  },
  memory_forget: {
    name: 'memory_forget',
    description: 'Soft-delete a memory with a reason. The memory remains in the database but is excluded from recall.',
    inputSchema: {
      type: 'object',
      required: ['thought_id', 'reason'],
      properties: {
        thought_id: { type: 'string', description: 'UUID of the thought to forget.' },
        reason: { type: 'string', description: 'Why this memory is being forgotten.' },
      },
    },
  },
  memory_update: {
    name: 'memory_update',
    description: 'Update a memory by creating a new version. The old version is preserved and linked via version chain.',
    inputSchema: {
      type: 'object',
      required: ['thought_id', 'new_content'],
      properties: {
        thought_id: { type: 'string', description: 'UUID of the thought to update.' },
        new_content: { type: 'string', description: 'The updated memory content.' },
        reason: { type: 'string', description: 'Why this memory is being updated.' },
      },
    },
  },
  memory_consolidate: {
    name: 'memory_consolidate',
    description: 'Merge multiple related memories into a single consolidated memory. Resolves contradictions and removes redundancy.',
    inputSchema: {
      type: 'object',
      required: ['thought_ids', 'consolidated_content'],
      properties: {
        thought_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'UUIDs of thoughts to consolidate.',
        },
        consolidated_content: { type: 'string', description: 'The merged memory content.' },
        resolution_notes: { type: 'string', description: 'How contradictions were resolved.' },
      },
    },
  },
};
```

### 3.2 Store Implementation

```typescript
// Inside the Edge Function handler

async function handleMemoryStore(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const content = params.content as string;
  const memoryType = params.memory_type as string;
  const memoryScope = params.memory_scope as string;
  const sourceType = (params.source_type as string) ?? 'model_inferred';
  const tags = (params.tags as string[]) ?? [];

  // Build provenance-aware metadata
  const metadata: Record<string, unknown> = {
    memory_scope: memoryScope,
    memory_type: memoryType,
    tags,
    provenance: {
      source_type: sourceType,
      trust_level: sourceType === 'user_stated' ? 5
        : sourceType === 'tool_observed' ? 4
        : sourceType === 'model_inferred' ? 3
        : 2,
      created_at: new Date().toISOString(),
    },
    version: 1,
  };

  // Attach scope-specific identifiers
  if (params.owner_id) metadata.owner_id = params.owner_id;
  if (params.team_id) metadata.team_id = params.team_id;
  if (params.project_id) metadata.project_id = params.project_id;

  // Generate embedding
  const embedding = await generateEmbedding(content);

  // Use upsert_thought for deduplication
  // If the exact content already exists, merge metadata
  const { data, error } = await supabase.rpc('upsert_thought', {
    p_content: content,
    p_payload: JSON.stringify({ metadata }),
  });

  if (error) {
    return { error: error.message };
  }

  // If upsert created a new row and we have an embedding, update it
  if (data?.id && embedding) {
    await supabase
      .from('thoughts')
      .update({ embedding })
      .eq('id', data.id);
  }

  return {
    thought_id: data?.id,
    fingerprint: data?.fingerprint,
    memory_scope: memoryScope,
    memory_type: memoryType,
    deduplicated: false, // upsert_thought handles this internally
  };
}
```

### 3.3 Recall Implementation (pgvector + Aging + Scope Weighting)

```typescript
async function handleMemoryRecall(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const query = params.query as string;
  const scope = (params.memory_scope as string) ?? 'all';
  const memoryType = params.memory_type as string | undefined;
  const maxResults = (params.max_results as number) ?? 10;
  const minSimilarity = (params.min_similarity as number) ?? 0.5;
  const includeAgedScore = (params.include_aged_score as boolean) ?? true;

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) {
    return { error: 'Failed to generate query embedding.' };
  }

  // Build metadata filter for scope
  const filter: Record<string, unknown> = {};
  if (scope !== 'all') {
    filter.memory_scope = scope;
  }
  if (memoryType) {
    filter.memory_type = memoryType;
  }
  if (params.owner_id) filter.owner_id = params.owner_id;
  if (params.team_id) filter.team_id = params.team_id;
  if (params.project_id) filter.project_id = params.project_id;

  // Call the scored search function
  const { data, error } = await supabase.rpc('match_thoughts_scored', {
    query_embedding: queryEmbedding,
    match_threshold: minSimilarity,
    match_count: maxResults * 2, // over-fetch to account for soft-deleted
    filter: Object.keys(filter).length > 0 ? filter : {},
    apply_aging: includeAgedScore,
  });

  if (error) {
    return { error: error.message };
  }

  // Filter out soft-deleted memories
  const results = (data ?? [])
    .filter((row: Record<string, unknown>) => {
      const meta = row.metadata as Record<string, unknown> | null;
      return !meta?.deleted;
    })
    .slice(0, maxResults)
    .map((row: Record<string, unknown>) => ({
      thought_id: row.id,
      content: row.content,
      similarity: row.similarity,
      aged_score: row.aged_score,
      memory_scope: (row.metadata as Record<string, unknown>)?.memory_scope,
      memory_type: (row.metadata as Record<string, unknown>)?.memory_type,
      provenance: (row.metadata as Record<string, unknown>)?.provenance,
      created_at: row.created_at,
    }));

  return {
    query,
    results,
    result_count: results.length,
    scope_filter: scope,
    type_filter: memoryType ?? 'all',
  };
}
```

### 3.4 Forget Implementation (Soft Delete)

```typescript
async function handleMemoryForget(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const thoughtId = params.thought_id as string;
  const reason = params.reason as string;

  // Read current metadata
  const { data: existing, error: readErr } = await supabase
    .from('thoughts')
    .select('metadata')
    .eq('id', thoughtId)
    .single();

  if (readErr || !existing) {
    return { error: `Thought not found: ${thoughtId}` };
  }

  const metadata = (existing.metadata ?? {}) as Record<string, unknown>;

  // Check if already deleted
  if (metadata.deleted) {
    return { error: 'Memory is already forgotten.', thought_id: thoughtId };
  }

  // Soft-delete: set deleted flag in metadata
  const updatedMetadata = {
    ...metadata,
    deleted: true,
    deleted_at: new Date().toISOString(),
    deleted_reason: reason,
  };

  const { error: updateErr } = await supabase
    .from('thoughts')
    .update({ metadata: updatedMetadata })
    .eq('id', thoughtId);

  if (updateErr) {
    return { error: updateErr.message };
  }

  return {
    thought_id: thoughtId,
    forgotten: true,
    reason,
  };
}
```

### 3.5 Update Implementation (Version Chain)

Memories are never overwritten. An update creates a new thought and links it to the old one via the version chain.

```typescript
async function handleMemoryUpdate(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const oldThoughtId = params.thought_id as string;
  const newContent = params.new_content as string;
  const reason = (params.reason as string) ?? 'Updated content';

  // Read the existing thought
  const { data: existing, error: readErr } = await supabase
    .from('thoughts')
    .select('*')
    .eq('id', oldThoughtId)
    .single();

  if (readErr || !existing) {
    return { error: `Thought not found: ${oldThoughtId}` };
  }

  const oldMetadata = (existing.metadata ?? {}) as Record<string, unknown>;
  const oldVersion = (oldMetadata.version as number) ?? 1;

  // Create new version
  const newMetadata = {
    ...oldMetadata,
    version: oldVersion + 1,
    supersedes: oldThoughtId,
    provenance: {
      ...(oldMetadata.provenance as Record<string, unknown> ?? {}),
      created_at: new Date().toISOString(),
      source_session_id: undefined, // will be set by caller if needed
    },
  };

  // Generate new embedding
  const embedding = await generateEmbedding(newContent);

  const insertPayload: Record<string, unknown> = {
    content: newContent,
    metadata: newMetadata,
  };
  if (embedding) {
    insertPayload.embedding = embedding;
  }

  const { data: newThought, error: insertErr } = await supabase
    .from('thoughts')
    .insert(insertPayload)
    .select('id')
    .single();

  if (insertErr) {
    return { error: insertErr.message };
  }

  const newThoughtId = newThought?.id;

  // Update old thought metadata to point to new version
  const updatedOldMetadata = {
    ...oldMetadata,
    superseded_by: newThoughtId,
  };

  await supabase
    .from('thoughts')
    .update({ metadata: updatedOldMetadata })
    .eq('id', oldThoughtId);

  // Record in memory_versions table
  await supabase
    .from('memory_versions')
    .insert({
      thought_id: newThoughtId,
      previous_thought_id: oldThoughtId,
      version_number: oldVersion + 1,
      change_reason: reason,
      previous_content: existing.content,
    });

  return {
    new_thought_id: newThoughtId,
    previous_thought_id: oldThoughtId,
    version: oldVersion + 1,
    reason,
  };
}
```

### 3.6 Consolidate Implementation

```typescript
async function handleMemoryConsolidate(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const thoughtIds = params.thought_ids as string[];
  const consolidatedContent = params.consolidated_content as string;
  const resolutionNotes = (params.resolution_notes as string) ?? '';

  if (thoughtIds.length < 2) {
    return { error: 'Consolidation requires at least 2 thoughts.' };
  }

  // Read all source thoughts
  const { data: sources, error: readErr } = await supabase
    .from('thoughts')
    .select('*')
    .in('id', thoughtIds);

  if (readErr || !sources || sources.length === 0) {
    return { error: 'Could not read source thoughts.' };
  }

  // Determine the most authoritative scope and type from sources
  const scopePriority: Record<string, number> = { project: 3, team: 2, personal: 1, agent: 0 };
  const bestScope = sources.reduce((best, s) => {
    const sScope = (s.metadata as Record<string, unknown>)?.memory_scope as string;
    return (scopePriority[sScope] ?? 0) > (scopePriority[best] ?? 0) ? sScope : best;
  }, 'personal');

  // Use the most common type among sources
  const typeCounts = new Map<string, number>();
  for (const s of sources) {
    const t = (s.metadata as Record<string, unknown>)?.memory_type as string ?? 'fact';
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const bestType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // Determine highest trust level
  const maxTrust = Math.max(...sources.map(s => {
    const p = (s.metadata as Record<string, unknown>)?.provenance as Record<string, unknown>;
    return (p?.trust_level as number) ?? 3;
  }));

  // Create consolidated thought
  const metadata: Record<string, unknown> = {
    memory_scope: bestScope,
    memory_type: bestType,
    tags: ['consolidated'],
    provenance: {
      source_type: 'compaction_derived',
      trust_level: maxTrust,
      created_at: new Date().toISOString(),
    },
    version: 1,
    consolidated_from: thoughtIds,
    resolution_notes: resolutionNotes,
  };

  const embedding = await generateEmbedding(consolidatedContent);

  const insertPayload: Record<string, unknown> = {
    content: consolidatedContent,
    metadata,
  };
  if (embedding) {
    insertPayload.embedding = embedding;
  }

  const { data: newThought, error: insertErr } = await supabase
    .from('thoughts')
    .insert(insertPayload)
    .select('id')
    .single();

  if (insertErr) {
    return { error: insertErr.message };
  }

  const newThoughtId = newThought?.id;

  // Soft-delete source thoughts, pointing to the consolidation
  for (const sourceId of thoughtIds) {
    const source = sources.find(s => s.id === sourceId);
    if (!source) continue;

    const sourceMeta = (source.metadata ?? {}) as Record<string, unknown>;
    await supabase
      .from('thoughts')
      .update({
        metadata: {
          ...sourceMeta,
          deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_reason: `Consolidated into ${newThoughtId}`,
          superseded_by: newThoughtId,
        },
      })
      .eq('id', sourceId);
  }

  return {
    consolidated_thought_id: newThoughtId,
    source_count: thoughtIds.length,
    sources_retired: thoughtIds,
    resolution_notes: resolutionNotes,
  };
}
```

---

## 4. Provenance & Trust (Connects to Blueprint 04)

### 4.1 Provenance Model

Every memory in OB1 tracks its origin, trustworthiness, and validation history. This connects directly to the `context_fragments` provenance model from Blueprint 04.

```
Provenance Chain:
  User says "always use tabs" in session ses_001
    -> SessionMemoryBuffer records observation (source: user_message)
    -> PromotionEngine promotes to thought with:
         source_type: "user_stated"
         trust_level: 5
         source_session_id: "ses_001"
    -> Later, model infers "user prefers 4-space indentation" in ses_015
         source_type: "model_inferred"
         trust_level: 3
    -> Contradiction detected: tabs vs 4-space
    -> Resolution: user_stated (trust 5) > model_inferred (trust 3)
    -> Newer model-inferred memory gets contradicted_by = [original thought ID]
```

### 4.2 Trust Hierarchy

Trust is a 1-5 integer scale. Higher trust wins during contradiction resolution.

| Trust Level | Source Type | Examples |
|---|---|---|
| 5 | `user_stated` | User explicitly says something |
| 4 | `tool_observed` | Tool output, API response, file contents |
| 3 | `model_inferred` | Model's interpretation or deduction |
| 2 | `compaction_derived` | Summary from transcript compaction |
| 1 | `external_unverified` | Web search results, third-party data |

### 4.3 Freshness Decay Function

Memories lose relevance weight over time. The decay rate depends on memory type. Instructions decay slowly (they are meant to be long-lived); observations decay quickly (they become stale).

```sql
-- SQL function for age-based decay
-- Returns a multiplier between 0.0 and 1.0

CREATE OR REPLACE FUNCTION memory_age_factor(
  created_at TIMESTAMPTZ,
  memory_type TEXT,
  reference_time TIMESTAMPTZ DEFAULT now()
)
RETURNS FLOAT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  days_old FLOAT;
  half_life FLOAT;
BEGIN
  days_old := EXTRACT(EPOCH FROM (reference_time - created_at)) / 86400.0;

  -- Half-life in days by memory type
  half_life := CASE memory_type
    WHEN 'instruction' THEN 365.0   -- Instructions persist for a year
    WHEN 'decision'    THEN 90.0    -- Decisions are relevant for a quarter
    WHEN 'preference'  THEN 180.0   -- Preferences change slowly
    WHEN 'fact'        THEN 120.0   -- Facts may become outdated
    WHEN 'observation' THEN 30.0    -- Observations go stale quickly
    WHEN 'context'     THEN 7.0     -- Context is highly ephemeral
    ELSE 90.0                        -- Default to 90-day half-life
  END;

  -- Exponential decay: 1.0 / (1.0 + days_old / half_life)
  RETURN 1.0 / (1.0 + days_old / half_life);
END;
$$;
```

### 4.4 Contradiction Resolution

When two memories contradict each other, the resolution follows a strict priority:

1. **Higher trust wins.** `user_stated` (5) beats `model_inferred` (3).
2. **At equal trust, newer wins.** The most recently validated memory takes precedence.
3. **Explicit validation wins.** A memory with `last_validated` set recently beats one that has not been revalidated.
4. **Neither is deleted.** Both memories are preserved, but the losing memory gets a `contradicted_by` reference and a reduced `relevance_boost` of 0.1.

```typescript
// lib/contradiction-resolver.ts

interface ContradictionResult {
  winner_id: string;
  loser_id: string;
  reason: string;
}

export function resolveContradiction(
  memoryA: { id: string; metadata: MemoryMetadata; created_at: string },
  memoryB: { id: string; metadata: MemoryMetadata; created_at: string },
): ContradictionResult {
  const trustA = memoryA.metadata.provenance.trust_level;
  const trustB = memoryB.metadata.provenance.trust_level;

  // Rule 1: Higher trust wins
  if (trustA !== trustB) {
    const winner = trustA > trustB ? memoryA : memoryB;
    const loser = trustA > trustB ? memoryB : memoryA;
    return {
      winner_id: winner.id,
      loser_id: loser.id,
      reason: `Trust level ${Math.max(trustA, trustB)} > ${Math.min(trustA, trustB)}`,
    };
  }

  // Rule 2: At equal trust, check last_validated
  const validatedA = memoryA.metadata.provenance.last_validated ?? memoryA.metadata.provenance.created_at;
  const validatedB = memoryB.metadata.provenance.last_validated ?? memoryB.metadata.provenance.created_at;

  if (validatedA !== validatedB) {
    const winner = validatedA > validatedB ? memoryA : memoryB;
    const loser = validatedA > validatedB ? memoryB : memoryA;
    return {
      winner_id: winner.id,
      loser_id: loser.id,
      reason: `More recently validated (${validatedA > validatedB ? validatedA : validatedB})`,
    };
  }

  // Rule 3: At equal trust and validation, newer created_at wins
  const winner = memoryA.created_at > memoryB.created_at ? memoryA : memoryB;
  const loser = memoryA.created_at > memoryB.created_at ? memoryB : memoryA;
  return {
    winner_id: winner.id,
    loser_id: loser.id,
    reason: `Newer memory (${winner.created_at})`,
  };
}
```

### 4.5 Memory Without Provenance = Accumulated Hallucination

This is a hard rule. Any thought in the `thoughts` table that has `memory_scope` set but NO `provenance` block in its metadata is treated as **untrusted** and receives:
- `trust_level: 1` (lowest)
- `relevance_boost: 0.5` (half weight)
- A warning tag `["missing_provenance"]`

The `match_thoughts_scored` function enforces this automatically.

---

## 5. Budget-Limited Memory Injection

### 5.1 Budget Constants

Adapted from the memdir pattern's file-based budget limits, translated to OB1's context assembly model.

```typescript
// types/memory-budget.ts

interface MemoryInjectionBudget {
  /** Maximum tokens for a single memory entry (default: 1,000 tokens ~= 4,000 chars) */
  max_tokens_per_memory: number;

  /** Maximum total tokens for all injected memories (default: 3,000 tokens ~= 12,000 chars) */
  max_total_tokens: number;

  /** Maximum number of individual memories to inject (default: 15) */
  max_memory_count: number;

  /** Token budget reserved for pinned memories (default: 500 tokens) */
  pinned_budget_tokens: number;
}

const DEFAULT_MEMORY_BUDGET: MemoryInjectionBudget = {
  max_tokens_per_memory: 1_000,   // ~4,000 chars, matching MAX_INSTRUCTION_FILE_CHARS
  max_total_tokens: 3_000,        // ~12,000 chars, matching MAX_TOTAL_INSTRUCTION_CHARS
  max_memory_count: 15,
  pinned_budget_tokens: 500,
};
```

### 5.2 Memory Selection for Prompt Injection

The `MemoryInjector` selects which memories to include in the system prompt. It follows a priority-based selection algorithm.

```typescript
// lib/memory-injector.ts

import type { MemoryInjectionBudget } from '../types/memory-budget';

interface ScoredMemory {
  thought_id: string;
  content: string;
  similarity: number;
  aged_score: number;
  memory_scope: string;
  memory_type: string;
  provenance: Record<string, unknown>;
  token_estimate: number;
  pinned: boolean;
}

export class MemoryInjector {
  private budget: MemoryInjectionBudget;

  constructor(budget: MemoryInjectionBudget = DEFAULT_MEMORY_BUDGET) {
    this.budget = budget;
  }

  /**
   * Select memories for injection into the system prompt.
   *
   * Selection priority:
   *   1. Pinned memories (always included, up to pinned_budget_tokens)
   *   2. Instructions (memory_type = 'instruction', highest aged_score first)
   *   3. Decisions (memory_type = 'decision')
   *   4. Preferences (memory_type = 'preference')
   *   5. Facts, observations, context (by aged_score)
   *
   * Each memory is truncated to max_tokens_per_memory.
   * Total injection is capped at max_total_tokens.
   * Content-hash deduplication prevents redundant injection.
   */
  selectForInjection(memories: ScoredMemory[]): ScoredMemory[] {
    const selected: ScoredMemory[] = [];
    let remainingTokens = this.budget.max_total_tokens;
    const seenHashes = new Set<string>();

    // Phase 1: Pinned memories
    const pinned = memories.filter(m => m.pinned);
    let pinnedBudget = this.budget.pinned_budget_tokens;

    for (const m of pinned) {
      const tokens = Math.min(m.token_estimate, this.budget.max_tokens_per_memory);
      if (tokens <= pinnedBudget && tokens <= remainingTokens) {
        const hash = this.contentHash(m.content);
        if (!seenHashes.has(hash)) {
          selected.push(m);
          remainingTokens -= tokens;
          pinnedBudget -= tokens;
          seenHashes.add(hash);
        }
      }
    }

    // Phase 2: Ranked non-pinned memories by type priority then score
    const typePriority: Record<string, number> = {
      instruction: 4,
      decision: 3,
      preference: 2,
      fact: 1,
      observation: 0,
      context: 0,
    };

    const ranked = memories
      .filter(m => !m.pinned)
      .sort((a, b) => {
        const typeDiff = (typePriority[b.memory_type] ?? 0) - (typePriority[a.memory_type] ?? 0);
        if (typeDiff !== 0) return typeDiff;
        return b.aged_score - a.aged_score;
      });

    for (const m of ranked) {
      if (selected.length >= this.budget.max_memory_count) break;
      if (remainingTokens <= 0) break;

      const tokens = Math.min(m.token_estimate, this.budget.max_tokens_per_memory);
      if (tokens > remainingTokens) continue;

      const hash = this.contentHash(m.content);
      if (seenHashes.has(hash)) continue;

      selected.push(m);
      remainingTokens -= tokens;
      seenHashes.add(hash);
    }

    return selected;
  }

  /**
   * Build the prompt section from selected memories.
   * This is injected into the system prompt alongside instruction files.
   */
  buildPromptSection(memories: ScoredMemory[]): string {
    if (memories.length === 0) return '';

    const sections: string[] = ['# Recalled Memories'];

    for (const m of memories) {
      const truncated = m.content.length > this.budget.max_tokens_per_memory * 4
        ? m.content.slice(0, this.budget.max_tokens_per_memory * 4) + '...'
        : m.content;

      const provenanceLabel = (m.provenance?.source_type as string) ?? 'unknown';
      const trustLabel = (m.provenance?.trust_level as number) ?? 0;

      sections.push(
        `## [${m.memory_type}] (scope: ${m.memory_scope}, trust: ${trustLabel}, source: ${provenanceLabel})`,
        truncated,
        '',
      );
    }

    return sections.join('\n');
  }

  /**
   * Simple content hash for deduplication during injection.
   */
  private contentHash(content: string): string {
    // Use a simple hash for in-memory dedup (not crypto-grade)
    let hash = 0;
    const normalized = content.toLowerCase().trim().replace(/\s+/g, ' ');
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }
}
```

### 5.3 Instruction File Discovery Integration

OB1 memories are injected alongside the existing CLAUDE.md instruction file chain. The injection point is after the dynamic boundary marker (`__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__`), alongside the instruction files discovered via ancestor chain walk.

```
System Prompt Assembly Order:
  1. Static system prompt
  2. __SYSTEM_PROMPT_DYNAMIC_BOUNDARY__
  3. Instruction files (CLAUDE.md chain) -- existing
  4. Recalled OB1 memories              -- NEW (this blueprint)
  5. Session context (git status, etc.)  -- existing
  6. Context fragments (Blueprint 04)    -- existing
```

The total budget for items 3 + 4 combined is 12,000 characters (~3,000 tokens). If instruction files consume 8,000 characters, OB1 memories get the remaining 4,000.

```typescript
// Integration with existing instruction file pipeline

function assembleInstructionContext(
  instructionFiles: ContextFile[],
  recalledMemories: ScoredMemory[],
  totalBudgetChars: number = 12_000,
): string {
  const sections: string[] = [];
  let remainingChars = totalBudgetChars;

  // Phase 1: Instruction files (existing, takes priority)
  for (const file of instructionFiles) {
    const content = file.content.slice(0, Math.min(4_000, remainingChars));
    if (content.length === 0) break;

    sections.push(`# ${file.path} (scope: ${file.scope})`);
    sections.push(content);
    sections.push('');
    remainingChars -= content.length + file.path.length + 20;
  }

  // Phase 2: OB1 memories (use remaining budget)
  if (remainingChars > 200 && recalledMemories.length > 0) {
    const injector = new MemoryInjector({
      ...DEFAULT_MEMORY_BUDGET,
      max_total_tokens: Math.floor(remainingChars / 4), // chars to tokens estimate
    });

    const selected = injector.selectForInjection(recalledMemories);
    const memorySection = injector.buildPromptSection(selected);

    if (memorySection.length <= remainingChars) {
      sections.push(memorySection);
    }
  }

  return sections.join('\n');
}
```

---

## 6. OB1 Integration (The Core)

### 6.1 Existing Thoughts Table Schema (Unchanged)

For reference, the existing `thoughts` table as defined in `docs/01-getting-started.md`:

```sql
-- EXISTING -- DO NOT MODIFY
create table thoughts (
  id uuid default gen_random_uuid() primary key,
  content text not null,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  content_fingerprint text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- EXISTING INDEXES
create index on thoughts using hnsw (embedding vector_cosine_ops);
create index on thoughts using gin (metadata);
create index on thoughts (created_at desc);
create unique index idx_thoughts_fingerprint
  on thoughts (content_fingerprint)
  where content_fingerprint is not null;

-- EXISTING FUNCTIONS
-- match_thoughts(query_embedding, match_threshold, match_count, filter)
-- upsert_thought(p_content, p_payload)
```

### 6.2 New Database Objects

#### 6.2.1 memory_versions Table

Tracks the evolution of memories over time. Each row represents one version change.

```sql
-- Version history for evolving memories
-- Does NOT modify the core thoughts table
CREATE TABLE memory_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  thought_id UUID NOT NULL REFERENCES thoughts(id),       -- the new version
  previous_thought_id UUID REFERENCES thoughts(id),       -- the old version (NULL for v1)
  version_number INT NOT NULL DEFAULT 1,
  change_reason TEXT,                                       -- why this was updated
  previous_content TEXT,                                    -- snapshot of old content
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Primary query: version chain for a thought
CREATE INDEX idx_memory_versions_thought
  ON memory_versions (thought_id);

-- Reverse lookup: what replaced this thought?
CREATE INDEX idx_memory_versions_previous
  ON memory_versions (previous_thought_id)
  WHERE previous_thought_id IS NOT NULL;

-- RLS
ALTER TABLE memory_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
  ON memory_versions
  FOR ALL
  USING (auth.role() = 'service_role');

-- Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.memory_versions TO service_role;
```

#### 6.2.2 match_thoughts_scored Function

Wraps the existing `match_thoughts` with aging decay and scope weighting. This is the primary query function for the memory system.

```sql
-- Scored search: pgvector similarity * age decay * scope weight * trust weight
-- Wraps the existing match_thoughts function with scoring overlays

CREATE OR REPLACE FUNCTION match_thoughts_scored(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 10,
  filter jsonb DEFAULT '{}'::jsonb,
  apply_aging boolean DEFAULT true
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  aged_score float,
  created_at timestamptz
)
LANGUAGE plpgsql
AS $$
DECLARE
  scope_weight float;
  trust_weight float;
  mem_type text;
  mem_scope text;
  trust_level int;
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.content,
    t.metadata,
    (1 - (t.embedding <=> query_embedding))::float AS similarity,
    CASE
      WHEN apply_aging THEN
        (1 - (t.embedding <=> query_embedding))::float
        * memory_age_factor(
            t.created_at,
            COALESCE(t.metadata->>'memory_type', 'observation')
          )
        * CASE COALESCE(t.metadata->>'memory_scope', 'personal')
            WHEN 'project'  THEN 1.0
            WHEN 'team'     THEN 0.9
            WHEN 'personal' THEN 0.8
            WHEN 'agent'    THEN 0.7
            ELSE 0.8
          END
        * CASE
            WHEN (t.metadata->'provenance'->>'trust_level')::int IS NULL THEN 0.5
            ELSE ((t.metadata->'provenance'->>'trust_level')::int / 5.0)::float
          END
        * COALESCE((t.metadata->>'relevance_boost')::float, 1.0)
      ELSE
        (1 - (t.embedding <=> query_embedding))::float
    END AS aged_score,
    t.created_at
  FROM thoughts t
  WHERE
    -- Cosine similarity threshold
    1 - (t.embedding <=> query_embedding) > match_threshold
    -- Metadata filter (existing behavior from match_thoughts)
    AND (filter = '{}'::jsonb OR t.metadata @> filter)
    -- Exclude soft-deleted memories
    AND (t.metadata->>'deleted') IS DISTINCT FROM 'true'
    -- Only include thoughts that have memory metadata (avoid non-memory thoughts)
    AND t.metadata->>'memory_scope' IS NOT NULL
  ORDER BY
    CASE
      WHEN apply_aging THEN
        (1 - (t.embedding <=> query_embedding))::float
        * memory_age_factor(
            t.created_at,
            COALESCE(t.metadata->>'memory_type', 'observation')
          )
        * CASE COALESCE(t.metadata->>'memory_scope', 'personal')
            WHEN 'project'  THEN 1.0
            WHEN 'team'     THEN 0.9
            WHEN 'personal' THEN 0.8
            WHEN 'agent'    THEN 0.7
            ELSE 0.8
          END
        * CASE
            WHEN (t.metadata->'provenance'->>'trust_level')::int IS NULL THEN 0.5
            ELSE ((t.metadata->'provenance'->>'trust_level')::int / 5.0)::float
          END
        * COALESCE((t.metadata->>'relevance_boost')::float, 1.0)
      ELSE
        (1 - (t.embedding <=> query_embedding))::float
    END DESC
  LIMIT match_count;
END;
$$;
```

#### 6.2.3 New Indexes on Thoughts

```sql
-- Targeted indexes for memory system queries.
-- These use expression indexes on the existing metadata JSONB column.
-- The core thoughts table structure is NOT modified.

-- Fast scope-filtered queries
CREATE INDEX IF NOT EXISTS idx_thoughts_memory_scope
  ON thoughts ((metadata->>'memory_scope'))
  WHERE metadata->>'memory_scope' IS NOT NULL;

-- Fast type-filtered queries
CREATE INDEX IF NOT EXISTS idx_thoughts_memory_type
  ON thoughts ((metadata->>'memory_type'))
  WHERE metadata->>'memory_type' IS NOT NULL;

-- Fast owner-filtered queries (personal scope)
CREATE INDEX IF NOT EXISTS idx_thoughts_owner_id
  ON thoughts ((metadata->>'owner_id'))
  WHERE metadata->>'owner_id' IS NOT NULL;

-- Exclude soft-deleted from default queries
CREATE INDEX IF NOT EXISTS idx_thoughts_not_deleted
  ON thoughts ((metadata->>'deleted'))
  WHERE (metadata->>'deleted') IS DISTINCT FROM 'true';
```

### 6.3 Edge Function Endpoint

All five memory operations are served from a single Edge Function with action routing.

```typescript
// supabase/functions/memory/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req: Request) => {
  // Access key authentication (matches OB1 core pattern from docs/01-getting-started.md)
  const accessKey = Deno.env.get('OB1_ACCESS_KEY');
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${accessKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json();
  const action = body.action as string;
  const params = body.params as Record<string, unknown>;

  let result: Record<string, unknown>;

  switch (action) {
    case 'store':
      result = await handleMemoryStore(params);
      break;
    case 'recall':
      result = await handleMemoryRecall(params);
      break;
    case 'forget':
      result = await handleMemoryForget(params);
      break;
    case 'update':
      result = await handleMemoryUpdate(params);
      break;
    case 'consolidate':
      result = await handleMemoryConsolidate(params);
      break;
    default:
      result = { error: `Unknown action: ${action}` };
  }

  return new Response(JSON.stringify(result), {
    status: result.error ? 400 : 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

// --- Helper: Generate embedding via OpenRouter ---

async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) return null;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/text-embedding-3-small',
        input: text.slice(0, 8_000), // Limit input length
      }),
    });

    if (!response.ok) return null;

    const result = await response.json();
    return result.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

// --- Handler implementations (from Sections 3.2-3.6 above) ---
// handleMemoryStore, handleMemoryRecall, handleMemoryForget,
// handleMemoryUpdate, handleMemoryConsolidate
```

### 6.4 MCP Tool Registration

The memory tools are registered alongside OB1's existing MCP tools. They follow the same pattern as the core `capture` and `search` tools.

```typescript
// MCP tool registration for Claude Desktop / AI client connection
// Added to the existing MCP server's tool list

const MEMORY_MCP_TOOLS = [
  {
    name: 'memory_store',
    description: 'Store a persistent memory with type, scope, and provenance tracking.',
    inputSchema: TOOLS.memory_store.inputSchema,
  },
  {
    name: 'memory_recall',
    description: 'Recall relevant memories using semantic search with aging and scope weighting.',
    inputSchema: TOOLS.memory_recall.inputSchema,
  },
  {
    name: 'memory_forget',
    description: 'Soft-delete a memory with a tracked reason.',
    inputSchema: TOOLS.memory_forget.inputSchema,
  },
  {
    name: 'memory_update',
    description: 'Update a memory by creating a new version (old version preserved).',
    inputSchema: TOOLS.memory_update.inputSchema,
  },
  {
    name: 'memory_consolidate',
    description: 'Merge related memories and resolve contradictions.',
    inputSchema: TOOLS.memory_consolidate.inputSchema,
  },
];
```

### 6.5 Integration with Existing OB1 Companion Prompts

The OB1 companion prompts (the system prompts that tell AI clients how to use OB1) are extended to include memory awareness. The key addition: after searching for thoughts, the agent can recognize memory-typed thoughts and treat them with appropriate trust levels.

```
# Addition to OB1 companion prompt

## Memory-Aware Search

When you search OB1 and receive results, check the `metadata` for memory system fields:

- `memory_scope`: Tells you the visibility level (personal, team, project)
- `memory_type`: Tells you the category (instruction, decision, preference, fact, observation)
- `provenance.source_type`: Tells you how reliable this information is
  - `user_stated` (trust: 5) = the user explicitly said this
  - `tool_observed` (trust: 4) = a tool verified this
  - `model_inferred` (trust: 3) = an AI deduced this
  - `compaction_derived` (trust: 2) = summarized from a session
- `provenance.trust_level`: 1-5 scale, higher = more trustworthy
- If `metadata.deleted` is true, ignore this result

When you encounter contradicting memories, prefer:
1. Higher trust level
2. More recently validated (check `provenance.last_validated`)
3. More recently created

You can store new memories using `memory_store` when the user shares preferences,
makes decisions, or asks you to remember something.
```

### 6.6 Memory System in the Agentic Loop

Where memory operations fit into the turn lifecycle, integrating with Blueprints 02, 04, and the existing agentic loop:

```typescript
// Agentic loop integration (extends Blueprint 04, Section 2.4)

async function agenticLoopWithMemory(
  session: SessionManager,
  budget: BudgetTracker,
  logger: EventLogger,
  compactor: TranscriptCompactor,
  stopController: StopReasonController,
  assembler: ContextAssembler,
  memoryManager: MemoryManager,        // NEW
  memoryBuffer: SessionMemoryBuffer,    // NEW
): Promise<{ stop_reason: StopReason }> {

  // --- STARTUP: Recall relevant memories for initial context ---
  const initialContext = await memoryManager.recallForSession(session);
  const memorySection = memoryManager.injector.buildPromptSection(initialContext);
  assembler.addMemoryContext(memorySection);

  while (true) {
    // --- PRE-TURN: Budget + stop checks (Blueprint 02 + 04) ---
    const preCheck = budget.preTurnCheck();
    if (!preCheck.can_proceed) {
      stopController.emit(preCheck.stop_reason!, budget, logger);
      break;
    }

    // --- TURN: Make API call ---
    const result = await callLlmApi(session, assembler.currentContext());

    // --- POST-TURN: Record usage ---
    const postTurn = await budget.recordTurn(result.usage);

    // --- POST-TURN: Extract observations for session memory ---
    const observations = memoryManager.extractObservations(result);
    for (const obs of observations) {
      memoryBuffer.observe(obs.content, obs.type, obs.source, session.turnCount);
    }

    // --- POST-TURN: Check for stop ---
    if (postTurn.stop_reason) {
      stopController.emit(postTurn.stop_reason, budget, logger);
      break;
    }

    // --- POST-TURN: Auto-compaction ---
    if (postTurn.compaction_needed) {
      const outcome = await compactor.maybeCompact(session, budget, logger);

      // On compaction, promote high-value observations to persistent memory
      if (outcome.performed) {
        await memoryManager.promotionEngine.promoteFromSession(
          memoryBuffer,
          session.sessionId,
          session.ownerId,
        );
      }
    }
  }

  // --- SESSION END: Final promotion pass ---
  const promotedIds = await memoryManager.promotionEngine.promoteFromSession(
    memoryBuffer,
    session.sessionId,
    session.ownerId,
  );

  logger.info('memory', 'session_memories_promoted', {
    session_id: session.sessionId,
    total_observations: memoryBuffer.count,
    promoted_count: promotedIds.length,
  });

  return { stop_reason: stopController.lastReason! };
}
```

### 6.7 MemoryManager Orchestrator

The top-level class that wires everything together.

```typescript
// lib/memory-manager.ts

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { MemoryInjector } from './memory-injector';
import { PromotionEngine } from './promotion-engine';
import type { SessionManager } from './session-manager';
import type { ScoredMemory } from './memory-injector';

export class MemoryManager {
  private supabase: SupabaseClient;
  public injector: MemoryInjector;
  public promotionEngine: PromotionEngine;

  constructor(
    supabaseUrl: string,
    supabaseKey: string,
  ) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.injector = new MemoryInjector();
    this.promotionEngine = new PromotionEngine(supabaseUrl, supabaseKey);
  }

  /**
   * Recall memories relevant to the current session context.
   * Uses the session's recent messages to build a query.
   */
  async recallForSession(session: SessionManager): Promise<ScoredMemory[]> {
    // Build a query from the session's recent messages
    const recentMessages = session.messages.slice(-4);
    const queryText = recentMessages
      .filter(m => m.role === 'user')
      .map(m => {
        const textBlocks = m.content.filter(
          (b: { type: string; text?: string }) => b.type === 'text' && b.text,
        );
        return textBlocks.map((b: { text: string }) => b.text).join(' ');
      })
      .join(' ')
      .slice(0, 2_000); // Cap query length

    if (!queryText.trim()) return [];

    const embedding = await this.generateEmbedding(queryText);
    if (!embedding) return [];

    const { data, error } = await this.supabase.rpc('match_thoughts_scored', {
      query_embedding: embedding,
      match_threshold: 0.5,
      match_count: 30,
      filter: {},
      apply_aging: true,
    });

    if (error || !data) return [];

    return data.map((row: Record<string, unknown>) => ({
      thought_id: row.id as string,
      content: row.content as string,
      similarity: row.similarity as number,
      aged_score: row.aged_score as number,
      memory_scope: ((row.metadata as Record<string, unknown>)?.memory_scope as string) ?? 'personal',
      memory_type: ((row.metadata as Record<string, unknown>)?.memory_type as string) ?? 'observation',
      provenance: ((row.metadata as Record<string, unknown>)?.provenance as Record<string, unknown>) ?? {},
      token_estimate: Math.ceil((row.content as string).length / 4),
      pinned: !!((row.metadata as Record<string, unknown>)?.pin),
    }));
  }

  /**
   * Extract memory-worthy observations from a turn result.
   * This is a heuristic pass -- not every turn produces observations.
   */
  extractObservations(turnResult: {
    role: string;
    content: Array<{ type: string; text?: string; tool_name?: string; tool_result?: unknown }>;
  }): Array<{ content: string; type: MemoryType; source: 'user_message' | 'tool_result' | 'model_inference' }> {
    const observations: Array<{ content: string; type: MemoryType; source: 'user_message' | 'tool_result' | 'model_inference' }> = [];

    for (const block of turnResult.content) {
      if (block.type === 'text' && block.text) {
        const lower = block.text.toLowerCase();

        // Detect explicit memory requests
        if (lower.includes('remember') || lower.includes('always ') || lower.includes('never ')) {
          observations.push({
            content: block.text.slice(0, 500),
            type: lower.includes('always') || lower.includes('never') ? 'instruction' : 'preference',
            source: turnResult.role === 'user' ? 'user_message' : 'model_inference',
          });
        }

        // Detect decisions
        if (lower.includes('decided') || lower.includes('chose') || lower.includes('going with')) {
          observations.push({
            content: block.text.slice(0, 500),
            type: 'decision',
            source: turnResult.role === 'user' ? 'user_message' : 'model_inference',
          });
        }

        // Detect preferences
        if (lower.includes('i prefer') || lower.includes('i like') || lower.includes('i want')) {
          observations.push({
            content: block.text.slice(0, 500),
            type: 'preference',
            source: 'user_message',
          });
        }
      }
    }

    return observations;
  }

  private async generateEmbedding(text: string): Promise<number[] | null> {
    const apiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!apiKey) return null;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openai/text-embedding-3-small',
          input: text.slice(0, 8_000),
        }),
      });

      if (!response.ok) return null;
      const result = await response.json();
      return result.data?.[0]?.embedding ?? null;
    } catch {
      return null;
    }
  }
}
```

---

## 7. Cross-Blueprint Integration Map

| Blueprint | Integration Point | Direction |
|---|---|---|
| Blueprint 02 (State & Budget) | `agent_sessions.session_id` links to memory `provenance.source_session_id` | Memory -> Session |
| Blueprint 02 (State & Budget) | `BudgetTracker` controls memory injection token budget | Budget -> Memory |
| Blueprint 04 (Compaction) | Compaction summaries auto-promote to persistent memory | Compaction -> Memory |
| Blueprint 04 (Provenance) | `context_fragments` shares provenance model with memory provenance | Shared schema |
| Blueprint 04 (Context Assembly) | `ContextAssembler` injects recalled memories into prompt | Memory -> Context |
| Blueprint 01 (Tools) | Memory MCP tools registered in tool registry | Tools -> Memory |
| Blueprint 05 (Boot) | `MemoryManager.recallForSession()` called during boot sequence | Boot -> Memory |

---

## 8. Verification Invariants

```typescript
// verification/memory-invariants.ts

/** INVARIANT: Every memory has provenance. */
export const memoryHasProvenance: Invariant = {
  name: 'memory_has_provenance',
  description: 'Every thought with memory_scope must have a provenance block.',
  severity: 'warning',
  check: async (supabase): Promise<InvariantResult> => {
    const { data, error } = await supabase
      .from('thoughts')
      .select('id, metadata')
      .not('metadata->memory_scope', 'is', null)
      .is('metadata->provenance', null);

    return {
      passed: !data || data.length === 0,
      violations: (data ?? []).map(row => ({
        thought_id: row.id,
        message: 'Memory has no provenance block.',
      })),
    };
  },
};

/** INVARIANT: Soft-deleted memories have a reason. */
export const deletedMemoriesHaveReason: Invariant = {
  name: 'deleted_memories_have_reason',
  description: 'Every soft-deleted memory must have a deleted_reason.',
  severity: 'warning',
  check: async (supabase): Promise<InvariantResult> => {
    const { data } = await supabase
      .from('thoughts')
      .select('id, metadata')
      .eq('metadata->>deleted', 'true')
      .is('metadata->deleted_reason', null);

    return {
      passed: !data || data.length === 0,
      violations: (data ?? []).map(row => ({
        thought_id: row.id,
        message: 'Soft-deleted memory has no reason.',
      })),
    };
  },
};

/** INVARIANT: Version chains are consistent. */
export const versionChainsConsistent: Invariant = {
  name: 'version_chains_consistent',
  description: 'If thought A supersedes B, then B.superseded_by = A.',
  severity: 'blocking',
  check: async (supabase): Promise<InvariantResult> => {
    const { data } = await supabase
      .from('thoughts')
      .select('id, metadata')
      .not('metadata->supersedes', 'is', null);

    const violations = [];
    for (const row of data ?? []) {
      const supersedes = (row.metadata as Record<string, unknown>)?.supersedes as string;
      if (!supersedes) continue;

      const { data: old } = await supabase
        .from('thoughts')
        .select('id, metadata')
        .eq('id', supersedes)
        .single();

      if (old && (old.metadata as Record<string, unknown>)?.superseded_by !== row.id) {
        violations.push({
          thought_id: row.id,
          message: `Supersedes ${supersedes} but reverse link not set.`,
        });
      }
    }

    return { passed: violations.length === 0, violations };
  },
};

/** INVARIANT: Consolidated source memories are soft-deleted. */
export const consolidatedSourcesRetired: Invariant = {
  name: 'consolidated_sources_retired',
  description: 'All source thoughts of a consolidation must be soft-deleted.',
  severity: 'warning',
  check: async (supabase): Promise<InvariantResult> => {
    const { data } = await supabase
      .from('thoughts')
      .select('id, metadata')
      .not('metadata->consolidated_from', 'is', null);

    const violations = [];
    for (const row of data ?? []) {
      const sourceIds = (row.metadata as Record<string, unknown>)?.consolidated_from as string[];
      if (!sourceIds) continue;

      for (const sourceId of sourceIds) {
        const { data: source } = await supabase
          .from('thoughts')
          .select('id, metadata')
          .eq('id', sourceId)
          .single();

        if (source && (source.metadata as Record<string, unknown>)?.deleted !== true) {
          violations.push({
            thought_id: row.id,
            message: `Source ${sourceId} not soft-deleted after consolidation.`,
          });
        }
      }
    }

    return { passed: violations.length === 0, violations };
  },
};

/** INVARIANT: Memory injection respects budget limits. */
export const memoryInjectionWithinBudget: Invariant = {
  name: 'memory_injection_within_budget',
  description: 'Total injected memory tokens must not exceed max_total_tokens.',
  severity: 'blocking',
  check: (injectedMemories: ScoredMemory[], budget: MemoryInjectionBudget): InvariantResult => {
    const totalTokens = injectedMemories.reduce((sum, m) => sum + m.token_estimate, 0);
    return {
      passed: totalTokens <= budget.max_total_tokens,
      violations: totalTokens > budget.max_total_tokens
        ? [{ message: `Injected ${totalTokens} tokens, budget is ${budget.max_total_tokens}` }]
        : [],
    };
  },
};
```

---

## 9. Verification Checklist

- [ ] Thoughts table structure NOT modified (all memory data in metadata JSONB).
- [ ] `memory_versions` table created with FK to thoughts.
- [ ] `memory_age_factor` SQL function returns correct decay for all 6 memory types.
- [ ] `match_thoughts_scored` returns results ordered by aged_score (similarity * aging * scope * trust).
- [ ] Expression indexes created for memory_scope, memory_type, owner_id on metadata.
- [ ] SessionMemoryBuffer tracks observations per turn and calculates promotion scores.
- [ ] PromotionEngine promotes observations above threshold with deduplication.
- [ ] Content fingerprint generation matches OB1's `upsert_thought` algorithm.
- [ ] MCP tool `memory_store` creates thoughts with full memory metadata and embeddings.
- [ ] MCP tool `memory_recall` uses `match_thoughts_scored` with scope/type filtering.
- [ ] MCP tool `memory_forget` soft-deletes with reason (does NOT delete row).
- [ ] MCP tool `memory_update` creates new version, links via supersedes/superseded_by.
- [ ] MCP tool `memory_consolidate` merges sources and soft-deletes originals.
- [ ] Contradiction resolution follows trust > validation_date > created_at priority.
- [ ] Memories without provenance receive trust_level 1 and relevance_boost 0.5.
- [ ] Memory injection respects 12,000-char total budget shared with instruction files.
- [ ] Pinned memories are always injected first (within pinned budget).
- [ ] Content-hash deduplication prevents redundant injection.
- [ ] Memory recall at session start populates initial context.
- [ ] Compaction boundary triggers promotion pass for high-value observations.
- [ ] Session end triggers final promotion pass.
- [ ] Edge Function authenticates via OB1_ACCESS_KEY (same as core MCP server).
- [ ] All new tables have RLS enabled with service_role policy.
