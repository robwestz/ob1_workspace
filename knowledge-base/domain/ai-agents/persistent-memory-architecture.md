---
title: "Persistent Memory Architecture for AI Agents"
format: reference-article
layer: domain
category: "ai-agents"
status: verified
confidence: high
last_verified: 2026-04-05
tags:
  - memory
  - vector-search
  - BM25
  - hybrid-search
  - temporal-decay
  - MMR
  - agent-persistence
  - openclaw
  - pgvector
  - supabase
cross_refs:
  - knowledge-base/methods/ai-agents/memory-management
  - knowledge-base/raw/memory-openclaw-vs-supabase
  - knowledge-base/VISION.md
sources:
  - url: "file://C:/Users/robin/Downloads/openclaw/docs/concepts/memory.md"
    title: "OpenClaw Memory Documentation"
    date: 2026-04-05
    reliability: high
  - url: "file://C:/Users/robin/Downloads/openclaw/extensions/memory-lancedb/index.ts"
    title: "OpenClaw memory-lancedb Plugin Source"
    date: 2026-04-05
    reliability: high
  - url: "file://C:/Users/robin/Downloads/openclaw/extensions/memory-core/index.ts"
    title: "OpenClaw memory-core Plugin Source"
    date: 2026-04-05
    reliability: high
  - url: "https://docs.openclaw.ai/concepts/memory"
    title: "OpenClaw Memory Concepts"
    date: 2026-04-05
    reliability: high
---

# Persistent Memory Architecture for AI Agents

> A production-grade memory system for long-running AI agents requires more than vector search. Hybrid BM25+vector retrieval, temporal decay, MMR diversity re-ranking, session transcript indexing, and pre-compaction memory flush together form a complete architecture that lets agents accumulate and recall months of operational knowledge without drowning in stale or redundant context.

## Core Concept

AI agents without persistent memory are expensive amnesiacs. Every session starts from zero, every decision is re-derived, every preference is re-asked. The fundamental challenge is not just *storing* information -- any database can do that -- but *retrieving the right information at the right time* from a growing corpus of agent memories that spans months or years.

A naive approach uses pure vector search (embed the query, find the nearest neighbors). This works for semantic similarity but fails on exact-match queries ("find the entry about error code ENOENT-3847") and degrades as the corpus grows: six-month-old notes about a topic can outrank yesterday's correction, and five near-identical daily log entries can crowd out diverse results.

The production-grade approach combines multiple retrieval signals, post-processing stages, and lifecycle-aware capture to produce memory systems that improve with use rather than degrading under their own weight.

## Key Principles

1. **Hybrid search beats single-signal retrieval.** Vector search handles semantic paraphrases ("the machine running the gateway" matches "Mac Studio gateway host"). BM25 keyword search handles exact tokens (IDs, error strings, environment variables, code symbols). Neither alone is sufficient. Combining them with configurable weights (typically 70/30 vector/keyword) covers both natural language and needle-in-a-haystack queries.

2. **Recency matters more than semantic perfection.** An agent with six months of daily notes will have the best semantic match on a topic from an old, well-worded entry -- but that entry may describe a configuration that was changed last week. Temporal decay applies an exponential multiplier based on age so recent memories naturally outrank stale ones, while evergreen reference documents (like a curated MEMORY.md) are exempted from decay entirely.

3. **Diversity prevents context pollution.** When five daily log entries all mention the same router configuration, returning all five wastes context window tokens on redundant information. MMR (Maximal Marginal Relevance) re-ranking iteratively selects results that balance relevance against similarity to already-selected results, ensuring the agent gets distinct pieces of information rather than echoes of the same fact.

4. **Memory capture must be a lifecycle event, not an afterthought.** The most critical moment for memory is right before context compaction, when the agent's working memory is about to be summarized and old messages discarded. A pre-compaction memory flush gives the agent a silent turn to write durable notes to disk before anything is lost.

## Architecture Overview

### The Complete Retrieval Pipeline

```
Query → Embedding → [Vector candidates] ──┐
                                           ├── Weighted Merge → Temporal Decay → Sort → MMR → Top-K Results
Query → BM25 Tokenize → [Keyword candidates] ┘
```

Each stage is independently configurable:

| Stage | Purpose | Default |
|-------|---------|---------|
| Vector search | Semantic similarity (cosine) | Enabled |
| BM25 search | Exact keyword relevance (FTS5) | Enabled with hybrid |
| Weighted merge | Combine signals: `vectorWeight * vectorScore + textWeight * textScore` | 0.7 / 0.3 |
| Temporal decay | Exponential age penalty: `score * e^(-lambda * ageDays)` | Off (opt-in) |
| MMR re-ranking | Diversity via Jaccard-based similarity penalty | Off (opt-in) |

### Memory Storage Layers

The architecture uses plain Markdown as the source of truth, with vector indices built on top:

| Layer | File | Purpose | Loaded When |
|-------|------|---------|-------------|
| Curated long-term | `MEMORY.md` | Decisions, preferences, durable facts | Main session only |
| Daily logs | `memory/YYYY-MM-DD.md` | Running context, day-to-day notes | Today + yesterday at session start |
| Evergreen references | `memory/projects.md`, `memory/network.md`, etc. | Stable reference data | Via memory_search |
| Session transcripts | `sessions/*.jsonl` | Past conversation recall | Via memory_search (experimental) |

### Plugin Architecture

OpenClaw's memory is pluggable via the `plugins.slots.memory` config key:

| Plugin | Storage | Search | Auto-capture | Auto-recall |
|--------|---------|--------|-------------|-------------|
| `memory-core` | Markdown files + SQLite vector index | Vector + optional hybrid | No (agent must write explicitly) | No (agent must call memory_search) |
| `memory-lancedb` | LanceDB vector store | Vector only (L2 distance) | Yes (rule-based trigger detection) | Yes (before_agent_start hook) |
| QMD backend | Markdown files + QMD sidecar | BM25 + vector + reranking | No | No |

## Patterns

### Pattern: Hybrid BM25 + Vector Search

**When:** Any agent with more than a handful of memory entries, especially when memories contain identifiers, code symbols, or technical terms alongside natural language descriptions.

**How:** Enable hybrid search and configure the weight split. The candidate multiplier determines how many results each subsystem retrieves before merging.

**Configuration:**
```json5
{
  agents: {
    defaults: {
      memorySearch: {
        provider: "openai",
        model: "text-embedding-3-small",
        query: {
          hybrid: {
            enabled: true,
            vectorWeight: 0.7,       // semantic similarity weight
            textWeight: 0.3,         // BM25 keyword weight
            candidateMultiplier: 4   // retrieve 4x more candidates for merging
          }
        }
      }
    }
  }
}
```

**How the merge works:**
1. Vector retrieves top `maxResults * 4` by cosine similarity (0-1 range).
2. BM25 retrieves top `maxResults * 4` by FTS5 rank (converted to 0-1: `1 / (1 + max(0, rank))`).
3. Union by chunk ID, compute `finalScore = 0.7 * vectorScore + 0.3 * textScore`.
4. Sort by final score descending, take top K.

**Pitfalls:**
- If embeddings are unavailable (API key missing, provider down), the system falls back to BM25-only -- keyword matches still work.
- If FTS5 cannot be created (platform limitation), vector-only search is used.
- Weights are normalized to sum to 1.0 in config resolution, so `0.7 / 0.3` and `7 / 3` produce identical behavior.

### Pattern: Temporal Decay

**When:** Agent has months of daily notes and stale information consistently outranks recent corrections or updates to the same topic.

**How:** Enable temporal decay with a half-life parameter. The score multiplier follows exponential decay: `decayedScore = score * e^(-ln(2)/halfLifeDays * ageInDays)`.

**Configuration:**
```json5
{
  memorySearch: {
    query: {
      hybrid: {
        temporalDecay: {
          enabled: true,
          halfLifeDays: 30   // score halves every 30 days
        }
      }
    }
  }
}
```

**Decay curve with 30-day half-life:**

| Age | Score multiplier |
|-----|-----------------|
| Today | 100% |
| 7 days | ~84% |
| 30 days | 50% |
| 90 days | 12.5% |
| 180 days | ~1.6% |

**Exempt from decay (evergreen files):**
- `MEMORY.md` (root curated memory)
- Non-dated files in `memory/` (e.g., `memory/projects.md`, `memory/network.md`)
- These contain durable reference information that should always rank at full strength.

**Date extraction:**
- Dated files (`memory/YYYY-MM-DD.md`): date from filename.
- Other sources (session transcripts): fall back to file modification time.

**Pitfalls:**
- Setting the half-life too short (< 14 days) can make even recent-ish memories decay too fast, losing useful context from last week.
- Setting it too long (> 120 days) makes the feature nearly invisible. Start with 30 days for daily-note-heavy workflows.
- Increase to 90 days if the agent frequently references older project notes that remain accurate.

### Pattern: MMR Re-Ranking

**When:** Memory search returns redundant or near-duplicate snippets, especially from daily notes that repeat similar information across days.

**How:** After scoring and temporal decay, MMR iteratively selects results that maximize `lambda * relevance - (1-lambda) * max_similarity_to_already_selected`. Similarity between results is measured using Jaccard text similarity on tokenized content.

**Configuration:**
```json5
{
  memorySearch: {
    query: {
      hybrid: {
        mmr: {
          enabled: true,
          lambda: 0.7   // 0 = max diversity, 1 = pure relevance
        }
      }
    }
  }
}
```

**Concrete example -- query: "home network setup"**

Without MMR (top 3):
```
1. memory/2026-02-10.md  (0.92) — "Configured Omada router, set VLAN 10 for IoT"
2. memory/2026-02-08.md  (0.89) — "Configured Omada router, moved IoT to VLAN 10" (near-duplicate)
3. memory/network.md     (0.85) — "Router: Omada ER605, VLAN 10: IoT"
```

With MMR (lambda=0.7, top 3):
```
1. memory/2026-02-10.md  (0.92) — router + VLAN (best match)
2. memory/network.md     (0.85) — reference doc (diverse, different content)
3. memory/2026-02-05.md  (0.78) — AdGuard DNS setup (diverse, new info)
```

The near-duplicate from Feb 8 is suppressed; the agent gets three distinct pieces of information.

**Pitfalls:**
- Lambda too low (< 0.3) aggressively penalizes similar results, potentially dropping highly relevant entries.
- Lambda too high (> 0.9) effectively disables diversity. Default 0.7 is a proven balance.

### Pattern: Pre-Compaction Memory Flush

**When:** Always. Any agent running long sessions that trigger auto-compaction should have this enabled.

**How:** When the session token estimate crosses `contextWindow - reserveTokensFloor - softThresholdTokens`, OpenClaw fires a silent agent turn with a system prompt reminding the model to write durable notes to disk. The agent writes memories, then replies with `NO_REPLY` so the user never sees this turn. Then compaction proceeds normally.

**Configuration:**
```json5
{
  agents: {
    defaults: {
      compaction: {
        reserveTokensFloor: 20000,
        memoryFlush: {
          enabled: true,
          softThresholdTokens: 4000,
          systemPrompt: "Session nearing compaction. Store durable memories now.",
          prompt: "Write any lasting notes to memory/YYYY-MM-DD.md; reply with NO_REPLY if nothing to store."
        }
      }
    }
  }
}
```

**Pitfalls:**
- Only fires once per compaction cycle (tracked in sessions.json).
- Skipped if workspace is read-only (`workspaceAccess: "ro"` or `"none"`).
- Flush is silent (`NO_REPLY`), so the user never sees it. But it does consume a model turn and tokens.

### Pattern: Auto-Capture and Auto-Recall (memory-lancedb)

**When:** You want the agent to passively build memory without requiring explicit "remember this" commands.

**How:** The `memory-lancedb` plugin uses lifecycle hooks:
- `before_agent_start`: embeds the incoming prompt, searches LanceDB for relevant memories, injects them as `<relevant-memories>` context with an untrusted-data warning.
- `agent_end`: scans user messages for trigger patterns (preferences, decisions, contact info, explicit "remember" requests), detects category, checks for duplicates (>95% similarity), and stores up to 3 new memories per conversation.

**Trigger patterns:**
- Explicit: "remember", "zapamatuj si"
- Preferences: "I prefer", "I like", "I hate", "I want"
- Decisions: "we decided", "will use"
- Entities: phone numbers, email addresses, "my X is"
- Importance markers: "always", "never", "important"

**Security:**
- Prompt injection detection rejects payloads containing "ignore instructions", "system prompt", XML-like tags, or tool invocation patterns.
- Recalled memories are wrapped in `<relevant-memories>` with explicit instructions to treat them as untrusted historical data.
- Only user messages are captured (never model output), preventing self-poisoning loops.

**Categories:** `preference`, `fact`, `decision`, `entity`, `other`.

### Pattern: Session Transcript Indexing

**When:** The agent needs to recall past conversations semantically -- "what did we discuss about the auth module last week?"

**How:** Enable experimental session memory indexing. Session JSONL transcripts are chunked, embedded, and indexed asynchronously. Results appear in `memory_search` alongside regular memory file results.

**Configuration:**
```json5
{
  agents: {
    defaults: {
      memorySearch: {
        experimental: { sessionMemory: true },
        sources: ["memory", "sessions"]
      }
    }
  }
}
```

**Pitfalls:**
- Session indexing is per-agent (isolation boundary).
- Updates are debounced and async; results may be slightly stale.
- Session transcripts on disk are the trust boundary -- any process with filesystem access can read them.
- Delta thresholds control when background sync fires: default 100KB or 50 messages.

### Pattern: QMD Sidecar Backend

**When:** You want full BM25 + vector + reranking from a local sidecar process, without relying on the built-in SQLite indexer.

**How:** QMD is a local-first search sidecar that combines BM25, vector search, and reranking. Markdown stays the source of truth; OpenClaw shells out to QMD for retrieval.

**Configuration:**
```json5
{
  memory: {
    backend: "qmd",
    citations: "auto",
    qmd: {
      includeDefaultMemory: true,
      searchMode: "search",         // search | vsearch | query
      update: { interval: "5m" },
      limits: { maxResults: 6 },
      sessions: {
        enabled: true,
        retentionDays: 30
      },
      paths: [
        { name: "docs", path: "~/notes", pattern: "**/*.md" }
      ]
    }
  }
}
```

**Key facts:**
- QMD runs via Bun + node-llama-cpp, downloads GGUF models on first use.
- Boot refresh runs in background by default (non-blocking).
- Automatic fallback to built-in SQLite if QMD fails or is missing.
- OS support: macOS and Linux native; Windows via WSL2.

### Pattern: Embedding Cache

**When:** Any deployment with active memory search. Especially important when session transcripts are indexed, as they change frequently.

**How:** OpenClaw caches chunk embeddings in SQLite so reindexing unchanged text does not re-embed.

**Configuration:**
```json5
{
  memorySearch: {
    cache: {
      enabled: true,
      maxEntries: 50000
    }
  }
}
```

**Pitfalls:**
- If the embedding model or provider changes, the cache is automatically invalidated and reindexed.
- The 50,000 entry default is generous for most deployments. A daily-note agent producing ~10 chunks/day would take over 13 years to fill it.

## Decision Framework

| If you need... | Use... | Because... | Trade-off |
|---------------|--------|------------|-----------|
| Basic memory with explicit read/write | `memory-core` plugin | Simple, no external dependencies, agent controls what is stored | Agent must remember to write; nothing is captured automatically |
| Automatic capture + recall | `memory-lancedb` plugin | Passive memory building, no explicit commands needed | Requires OpenAI API key for embeddings; rule-based triggers may miss nuanced information |
| Advanced retrieval (BM25 + reranking) | QMD backend | Best retrieval quality; local-first | Requires Bun + SQLite; macOS/Linux native, Windows needs WSL2 |
| Semantic + exact keyword search | Hybrid search | Covers both natural language and exact token queries | Slightly more compute per search; negligible latency impact |
| Agents with long history | Temporal decay | Prevents stale information from dominating results | Old but still-accurate information may be penalized; mitigate with evergreen files |
| Agents with repetitive daily notes | MMR re-ranking | Eliminates redundant results, maximizes information per context token | May drop a highly relevant result if it is too similar to an already-selected one |
| Cross-session recall | Session transcript indexing | Agent can recall past conversations semantically | Async indexing means slight staleness; disk-level trust boundary |
| Structured multi-tenant data | Supabase + pgvector | SQL queries, RLS, versioning, category-based retrieval | No BM25, no temporal decay, no MMR -- pure vector + text fallback |

## Integration with the Three-Layer KB Model

The persistent memory architecture maps to the OB1 knowledge base's three-layer model:

### Layer 1: Domain KB ("What we know")

OpenClaw's memory system can serve as the runtime index for Layer 1 domain knowledge. Memory files in `memory/` can contain domain-specific reference articles, and the hybrid search + temporal decay + MMR pipeline ensures high-quality retrieval. The `extraPaths` config allows indexing external documentation directories, making it possible to point the memory search at the entire `knowledge-base/domain/` tree.

### Layer 2: Method KB ("How we work")

Method guides can be stored as evergreen memory files (exempt from temporal decay) and retrieved when the agent encounters a situation matching the method's "when to use" criteria. Session memory indexing means past applications of a method are also searchable, building experiential knowledge over time.

### Layer 3: Component KB ("Build with")

Component specs and templates are better served by the Supabase structured store (versioning, category queries, RLS) than by the flat-file memory system. The two systems are complementary: OpenClaw memory for agent-facing recall, Supabase for structured data with API access.

## Open Questions

- [ ] Can QMD run natively on Windows without WSL2? Current docs say WSL2 required.
- [ ] What is the optimal half-life for a multi-project agent that needs both recency and historical reference?
- [ ] How does memory-lancedb's auto-capture interact with the pre-compaction memory flush? Could they create duplicate entries?
- [ ] Is there a path to using Supabase pgvector as a QMD-compatible backend, unifying the two storage layers?
- [ ] What is the embedding cost profile for session transcript indexing at scale (thousands of sessions)?

## Sources & Evidence

All sources listed in frontmatter. Architecture details verified against OpenClaw source code (extensions/memory-core, extensions/memory-lancedb) and official documentation (docs/concepts/memory.md). Configuration examples tested against the JSON5 config schema. Temporal decay and MMR algorithms documented with concrete examples from the official docs.
