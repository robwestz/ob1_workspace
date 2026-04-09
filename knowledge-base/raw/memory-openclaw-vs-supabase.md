# Memory Architecture Comparison: OpenClaw vs Supabase pgvector

> Research date: 2026-04-05
> Purpose: Determine whether OpenClaw's memory system can serve as KB Layer 1, how it compares to our Supabase pgvector setup, and whether they should work together or one should replace the other.

---

## Executive Summary

OpenClaw's memory system and our Supabase pgvector knowledge base solve different problems and should work together. OpenClaw memory is an agent-facing recall system optimized for conversational retrieval with temporal awareness and diversity. Supabase pgvector is a structured data store optimized for programmatic access, versioning, multi-tenant isolation, and API-driven queries. Replacing either with the other would lose critical capabilities.

**Recommendation:** Use OpenClaw memory as the runtime retrieval layer (KB Layer 1 read path) and Supabase as the durable structured store (KB Layer 1 write path + API access). The `extraPaths` configuration bridges them -- OpenClaw indexes the KB markdown files for agent-facing search while Supabase stores the canonical versioned entries.

---

## Feature-by-Feature Comparison

### Retrieval Capabilities

| Feature | OpenClaw Memory (memory-core + builtin) | Supabase pgvector (knowledge-base.ts) |
|---------|----------------------------------------|---------------------------------------|
| **Vector search** | Cosine similarity via SQLite + sqlite-vec | Cosine similarity via pgvector `match_knowledge` RPC |
| **Keyword search (BM25)** | FTS5 full-text search, configurable weight | Text fallback via `ilike` (no BM25) |
| **Hybrid search** | Vector + BM25 weighted merge with configurable weights | Vector only; text search is a fallback, not a scoring signal |
| **Temporal decay** | Exponential decay with configurable half-life, evergreen file exemption | None -- all entries rank equally regardless of age |
| **MMR re-ranking** | Jaccard-based diversity re-ranking with configurable lambda | None -- results are pure relevance-ordered |
| **Embedding provider** | OpenAI, Gemini, Voyage, local GGUF (with auto-download) | OpenAI only (hardcoded in generateEmbedding) |
| **Embedding cache** | SQLite cache, configurable max entries | None -- re-embeds on every store/update |
| **Session transcript search** | Yes (experimental), async indexing | No |
| **Batch indexing** | OpenAI Batch API support for large corpus backfill | No -- synchronous per-entry embedding |

**Verdict:** OpenClaw's retrieval pipeline is significantly more sophisticated. Hybrid search, temporal decay, and MMR together produce measurably better results for agent memory recall. Supabase's retrieval is simpler but adequate for programmatic API access.

### Storage and Data Model

| Feature | OpenClaw Memory | Supabase pgvector |
|---------|----------------|-------------------|
| **Storage format** | Plain Markdown files (source of truth) + derived indices | PostgreSQL rows with structured columns |
| **Schema** | Unstructured text in `.md` files | Typed schema: `id`, `category`, `title`, `content`, `version`, `tags`, `relevance_score`, `source` |
| **Versioning** | Git history on workspace files | Built-in: `version` field, `supersedes` pointer, `filterLatest()` dedup |
| **Categories** | File path convention (`memory/projects.md`) | Enum column: `vision`, `architecture`, `process`, `project`, `customer`, `operational`, `learning` |
| **Tags** | None (inline text only) | Array column with containment queries (`cs.{tag1,tag2}`) |
| **Multi-tenant** | Single-agent (per workspace) | RLS policies for multi-tenant isolation |
| **Verification tracking** | None | `last_verified_at` field, `getStale()` method |
| **API access** | CLI + agent tools only | Full REST API via Supabase PostgREST |

**Verdict:** Supabase provides the structured data model needed for a production knowledge base: versioning, categories, tags, verification tracking, API access. OpenClaw memory is optimized for agent recall, not for programmatic data management.

### Capture and Write Path

| Feature | OpenClaw Memory | Supabase pgvector |
|---------|----------------|-------------------|
| **Agent write** | `memory_search` / `memory_get` tools; direct file write | `store()` method via REST API |
| **Auto-capture** | memory-lancedb plugin: rule-based triggers, category detection | None -- all writes are explicit |
| **Pre-compaction flush** | Silent agent turn before context compaction | Not applicable (no context window) |
| **Deduplication** | memory-lancedb: 95% similarity check before storing | Version chain (`supersedes` pointer) |
| **Bulk seeding** | File creation in workspace directory | `seedFromFiles()` method |

**Verdict:** OpenClaw's capture mechanisms (auto-capture, pre-compaction flush) are designed for agent lifecycle. Supabase's write path is designed for programmatic CRUD operations. Both are needed.

### Operational Characteristics

| Feature | OpenClaw Memory | Supabase pgvector |
|---------|----------------|-------------------|
| **Latency** | Local file + SQLite: sub-millisecond indexing, <100ms search | Network call to Supabase: 50-200ms typical |
| **Offline capability** | Fully local | Requires network |
| **Cost** | Embedding API calls only (cached) | Supabase hosting + embedding API calls |
| **Scalability** | Single machine, single agent | Cloud-hosted, multi-tenant, horizontally scalable |
| **Backup** | Git + Continuum checkpoints + encrypted sync | Supabase automatic backups + point-in-time recovery |
| **Query flexibility** | Semantic search + keyword search | Full SQL: joins, aggregations, window functions, custom RPCs |

**Verdict:** OpenClaw is faster and works offline. Supabase is more scalable and queryable. For agent-facing recall during conversation, speed matters more. For knowledge management dashboards and API consumers, query flexibility matters more.

---

## Can They Work Together?

Yes. The integration model is:

### Architecture: Dual-Layer Memory

```
                    Agent Conversation
                          │
                    ┌─────▼──────┐
                    │  OpenClaw   │  ← Agent-facing recall
                    │   Memory    │     Hybrid search, decay, MMR
                    │  (Layer 1   │     Sub-100ms latency
                    │   read)     │     Session transcript indexing
                    └──────┬─────┘
                           │
              ┌────────────┼────────────────┐
              │            │                │
    ┌─────────▼──┐  ┌──────▼──────┐  ┌──────▼──────┐
    │  Markdown   │  │  Supabase   │  │   Session   │
    │   Files     │  │  pgvector   │  │ Transcripts │
    │ (workspace) │  │  (KB store) │  │   (JSONL)   │
    └─────────────┘  └─────────────┘  └─────────────┘
    Daily logs,       Versioned,       Past
    MEMORY.md,        categorized,     conversations
    evergreen refs    API-accessible
```

### Data Flow

1. **KB articles written to Supabase** via `knowledge-base.ts` for versioned, structured storage with API access.

2. **KB articles also written as Markdown** in `knowledge-base/domain/` and `knowledge-base/methods/` directories (the canonical, human-readable form).

3. **OpenClaw indexes the Markdown** via `memorySearch.extraPaths`, making all KB articles searchable through the agent's `memory_search` tool with full hybrid search + temporal decay + MMR.

4. **Agent memories stay in OpenClaw** (workspace Markdown files). These are agent-specific operational notes, not canonical knowledge base entries.

5. **Supabase serves external consumers:** dashboards, APIs, other agents, CLI tools. OpenClaw serves the conversational agent.

### Configuration (already implemented in openclaw.json)

```json5
{
  agents: {
    defaults: {
      memorySearch: {
        // Index KB articles alongside agent memories
        extraPaths: ["../knowledge-base/domain", "../knowledge-base/methods"],
        // Full hybrid pipeline
        query: {
          hybrid: {
            enabled: true,
            vectorWeight: 0.7,
            textWeight: 0.3,
            mmr: { enabled: true, lambda: 0.7 },
            temporalDecay: { enabled: true, halfLifeDays: 30 }
          }
        }
      }
    }
  }
}
```

---

## Can OpenClaw Memory BECOME KB Layer 1?

### Partial yes -- for the read path.

OpenClaw's memory system is an excellent Layer 1 read path. It provides:

- Hybrid semantic + keyword search (better than pure pgvector)
- Temporal decay (essential for daily-note-heavy agents)
- MMR diversity (prevents redundant context)
- Session transcript indexing (cross-session recall)
- Sub-100ms local search (faster than any cloud call)
- Pre-compaction memory flush (prevents information loss)

By pointing `extraPaths` at the KB directory tree, the agent can search the entire Domain KB and Method KB through `memory_search`. This is already configured.

### No -- for the write path and structured access.

OpenClaw memory cannot replace Supabase for:

- **Versioned entries:** Supabase tracks version chains with `supersedes` pointers. Markdown files in git have history, but it is not queryable by the agent at search time.
- **Categorized queries:** "Give me all `process` category entries" requires structured columns. Markdown file paths approximate this but lack metadata.
- **Tag-based retrieval:** "Entries tagged with both `seo` and `technical`" requires array containment queries. Markdown has no tag index.
- **Verification tracking:** "Which entries haven't been verified in 30 days?" requires `last_verified_at` column. No equivalent in file-based memory.
- **API access:** External dashboards, other agents, CLI tools need REST API access. OpenClaw memory is local-only.
- **Multi-tenant isolation:** If the system ever serves multiple users/agents with access control, RLS on Supabase is the answer. OpenClaw memory is single-workspace.

---

## Recommendation for the Three-Layer KB Model

### Layer 1: Domain KB ("What we know")

**Read path:** OpenClaw memory search with `extraPaths` indexing KB domain articles. Agent uses `memory_search` for retrieval during conversation.

**Write path:** Supabase pgvector via `knowledge-base.ts` for structured storage. Markdown files in `knowledge-base/domain/` as the canonical human-readable form.

**Rationale:** The agent needs fast, context-aware, diversity-optimized retrieval. OpenClaw provides this. The knowledge base needs versioning, categories, and API access. Supabase provides this. Both are indexed over the same Markdown source files.

### Layer 2: Method KB ("How we work")

**Read path:** Same as Layer 1 -- OpenClaw memory search indexes `knowledge-base/methods/` via `extraPaths`. Method guides are evergreen files (no temporal decay).

**Write path:** Markdown files authored by agents or humans, stored in Supabase for versioning.

**Rationale:** Method guides are long-lived, stable documents. Temporal decay exemption ensures they always rank at full strength. They are retrieved when the agent encounters a matching situation.

### Layer 3: Component KB ("Build with")

**Read path:** Supabase API directly (not OpenClaw memory). Component specs need structured queries by category, tag, and compatibility.

**Write path:** Supabase pgvector with full schema.

**Rationale:** Components are structured artifacts (code templates, module specs, configuration blocks) that benefit from SQL-queryable metadata more than semantic search. An agent looking for "Next.js auth module with Stripe integration" needs tag intersection queries, not fuzzy vector search.

---

## Migration Path

### Phase 1: Current State (implemented)

- OpenClaw memory with hybrid search, temporal decay, MMR -- **done**
- `extraPaths` pointing at KB directories -- **done**
- Supabase `knowledge-base.ts` for structured storage -- **exists**
- Pre-compaction memory flush enabled -- **done**
- Session transcript indexing enabled -- **done**
- Embedding cache enabled -- **done**

### Phase 2: QMD Backend (when Mac agent node is primary)

- Switch `memory.backend` from `"builtin"` to `"qmd"` on the Mac node
- QMD adds BM25 + reranking as a local sidecar (Bun + node-llama-cpp)
- Config block is already pre-written in openclaw.json (just change backend value)
- This adds reranking on top of the existing hybrid search
- Windows gateway continues with `builtin` backend until WSL2 QMD is validated

### Phase 3: Memory-LanceDB Evaluation

- Enable `memory-lancedb` plugin (currently configured but disabled)
- Run in parallel with `memory-core` for 2 weeks
- Compare: Does auto-capture add valuable entries or noise?
- Compare: Does auto-recall inject relevant context or distraction?
- Decision: If auto-capture proves valuable, switch plugin slot. If not, stay with explicit writes.

### Phase 4: Supabase Sync Bridge (future)

- Build a sync bridge that watches `knowledge-base/` Markdown files and upserts to Supabase
- Or: Build a Supabase Edge Function that writes Markdown files from API mutations
- Either direction ensures both systems stay in sync with the same source data
- This is a custom integration -- neither OpenClaw nor Supabase provides it out of the box

### Phase 5: Unified Query Layer (future)

- Build a query abstraction that routes searches to the appropriate backend:
  - Conversational recall -> OpenClaw memory search
  - Structured queries -> Supabase REST API
  - Full-text + reranked -> QMD sidecar
- Expose via MCP tool so any AI client can access the unified KB
- This is the vision from the OB1 architecture: one database, one protocol, any client

---

## Key Differences Summary

| Dimension | OpenClaw Memory | Supabase pgvector | Winner for... |
|-----------|----------------|-------------------|---------------|
| Search quality | Hybrid BM25+vector, temporal decay, MMR | Vector-only with text fallback | OpenClaw (agent recall) |
| Data model | Unstructured Markdown | Structured rows with types | Supabase (data management) |
| Speed | Local, sub-100ms | Network, 50-200ms | OpenClaw (conversation flow) |
| Versioning | Git history (not queryable) | Version chains with `supersedes` | Supabase (knowledge evolution) |
| Offline | Full capability | Requires network | OpenClaw (autonomous agents) |
| API access | CLI + agent tools | Full REST | Supabase (external consumers) |
| Multi-tenant | Single workspace | RLS policies | Supabase (scaling) |
| Auto-capture | memory-lancedb plugin | None | OpenClaw (passive memory building) |
| Session recall | Transcript indexing | Not applicable | OpenClaw (cross-session memory) |
| Embeddings | Multi-provider + cache + batch | OpenAI only, no cache | OpenClaw (cost + flexibility) |

---

## Conclusion

OpenClaw's memory system is the best agent-facing retrieval layer available. Its hybrid search, temporal decay, and MMR solve real problems that pure pgvector does not address. But it is not a database -- it is a search layer over files.

Supabase pgvector is the best structured storage layer for versioned, categorized knowledge with API access. But its retrieval is naive compared to OpenClaw's pipeline.

The right answer is both:
- **OpenClaw memory** for agent conversation recall (read path)
- **Supabase pgvector** for structured knowledge management (write path + API)
- **Markdown files** as the shared source of truth that both systems index

This is already configured and operational. The `extraPaths` bridge connects the two worlds. Future phases (QMD, LanceDB evaluation, sync bridge, unified query) are planned but not blocking.
