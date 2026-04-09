# Memory System Configuration Notes

## Architecture

Our memory system uses OpenClaw's `memory-core` plugin as the primary backend with the built-in SQLite vector indexer. Memory is stored as plain Markdown in the workspace -- files are the source of truth, the vector index is a derived search layer built on top.

### Storage layers

| Layer | File(s) | Purpose | Temporal decay |
|-------|---------|---------|----------------|
| Curated long-term | `MEMORY.md` | Decisions, preferences, lessons, project chronology | Exempt (evergreen) |
| Daily logs | `memory/YYYY-MM-DD.md` | Running notes, bugs, deployments, observations | 30-day half-life |
| Evergreen references | `memory/projects.md`, `memory/network.md`, `memory/contacts.md` | Stable reference data | Exempt (evergreen) |
| Session transcripts | `sessions/*.jsonl` | Past conversation recall | File mtime-based decay |

### Search pipeline

```
Query → Embedding (OpenAI text-embedding-3-small)
  ├── Vector search (cosine similarity, weight: 0.7)
  └── BM25 keyword search (FTS5, weight: 0.3)
        ↓
  Weighted merge → Temporal decay (halfLife: 30d) → Sort → MMR (lambda: 0.7) → Top-K
```

### Why these choices

- **memory-core over memory-lancedb:** We prefer explicit memory writes over auto-capture. Robin's workflow produces high-signal, deliberate memory entries. Auto-capture introduces noise for our use case. memory-lancedb is configured but disabled -- ready to enable if we find the agent is consistently forgetting to write.

- **Hybrid search:** Enabled because our memories contain both natural language descriptions and exact identifiers (IPs, project names, error codes, API endpoints). BM25 at 0.3 weight catches exact tokens that vector search misses.

- **Temporal decay at 30 days:** Robin works in fast iteration cycles (wave protocol). A note from 3 months ago about a configuration is likely superseded by a more recent one. The 30-day half-life ensures recent corrections outrank stale entries while still keeping old context discoverable at reduced weight.

- **MMR at lambda 0.7:** Daily notes frequently mention the same infrastructure (Tailscale mesh, Supabase URLs, OpenClaw gateway port). Without MMR, searching for "gateway configuration" returns 5 nearly identical entries from different days. Lambda 0.7 keeps relevance primary but penalizes near-duplicates enough to surface diverse results.

- **Session memory indexing:** Enabled (experimental). We run long sessions (8+ hour night shifts) where significant decisions happen in conversation that may not be written to memory files. Session indexing provides a safety net for cross-session recall.

- **Pre-compaction memory flush:** Enabled. This is non-negotiable for long autonomous sessions. Before context compaction, the agent gets a silent turn to write durable notes. This has prevented information loss multiple times during overnight sessions.

- **Backend: builtin (not QMD yet):** QMD requires WSL2 on Windows. Once the Mac agent node is running as the primary execution host, we can switch to `memory.backend = "qmd"` on that machine for superior BM25 + vector + reranking. The QMD config block is pre-written in openclaw.json, ready to activate by changing `backend: "qmd"`.

- **Embedding cache:** Enabled with 50,000 entry limit. Prevents redundant embedding API calls during reindexing. At our current write rate (~10 chunks/day from daily notes + session updates), this limit will last years.

- **Extra paths:** The KB domain and methods directories are included in memorySearch.extraPaths. This means the agent can semantically search the entire Knowledge Base via memory_search without a separate retrieval system.

## Tuning History

### 2026-04-05 -- Initial production configuration
- Set hybrid search: 0.7 vector / 0.3 BM25
- Enabled temporal decay: 30-day half-life
- Enabled MMR: lambda 0.7
- Enabled session memory indexing (experimental)
- Enabled embedding cache: 50,000 entries
- Enabled pre-compaction memory flush
- Added KB extraPaths for domain + methods articles
- Configured QMD block (inactive, backend still "builtin")
- Configured memory-lancedb plugin (disabled, ready for comparison testing)
- Set embedding batch indexing enabled with concurrency 2

### Planned adjustments
- [ ] Test QMD backend on Mac agent node when WSL2 is not a constraint
- [ ] Evaluate if half-life should increase to 60 days once project history grows beyond 6 months
- [ ] Compare retrieval quality between memory-core hybrid and memory-lancedb auto-recall
- [ ] Monitor embedding cache hit rate -- if consistently >90%, cache is working well
- [ ] Test increasing BM25 weight to 0.4 if exact-match queries remain weak

## Best Practices Discovered

### Writing memories

- **Short, tagged memories retrieve better than long narratives.** "Decision 2026-04: Use wave protocol for night shifts (replaces batch dispatch)" retrieves on both "wave protocol" and "night shift decision". A paragraph about the same topic buries the signal in noise.

- **Cross-referencing between memories improves relevance.** In a daily log: "Deployed Bacowr v6.2 (see memory/projects.md for tech stack)." The cross-reference means both files are touched when either topic is searched.

- **Temporal decay keeps the system from drowning in old context.** Before enabling decay, a 6-month-old note about router configuration consistently outranked yesterday's correction. After decay, the correction ranks first within a day.

- **Evergreen files are the backbone.** MEMORY.md and memory/projects.md are loaded at session start and never decay. They should contain the most stable, high-value information. Daily logs are for ephemeral context.

- **One fact per entry, not a paragraph.** "Robin prefers production-grade as default" is one retrievable unit. "Robin has many preferences including production-grade work, Swedish language, morning reports with coffee, and parallel execution" is a retrieval-hostile blob.

### Search behavior

- **Hybrid search is strictly better than vector-only for our use case.** Before hybrid, searching for "port 18789" returned semantic matches about "gateway configuration" but missed the exact port number. With BM25 at 0.3, the exact match surfaces.

- **MMR prevents the "5 copies of the same note" problem.** Daily logs about infrastructure often repeat the same Tailscale mesh details. Without MMR, top-5 results were near-identical. With lambda 0.7, the results cover 5 distinct aspects.

- **candidateMultiplier: 4 is the sweet spot.** Lower values (2x) miss relevant results in the merge phase. Higher values (8x) waste compute without improving result quality.

### Maintenance

- **Monthly MEMORY.md review catches drift.** Decisions change. Preferences evolve. A decision from October may have been superseded in February without anyone updating the evergreen file. Monthly review fixes this.

- **Consolidate daily logs older than 90 days.** Extract any durable facts into evergreen files, then the daily log can age out naturally via temporal decay. Do not delete -- let decay handle ranking.

- **Test retrieval after any configuration change.** After changing weights, half-life, or lambda: search for 5 known facts and verify the right entry ranks first. This takes 2 minutes and prevents subtle retrieval regressions.

## Integration with OB1 Knowledge Base

The memory system serves as Layer 1 (Domain KB) runtime access for OpenClaw agents. The `extraPaths` configuration indexes the entire `knowledge-base/domain/` and `knowledge-base/methods/` directories, making all KB articles searchable via `memory_search`.

This means:
1. An agent working on SEO can search memory for "technical SEO audit checklist" and get both the KB article and any relevant daily notes or decisions.
2. Method guides (Layer 2) are indexed and retrievable when the agent encounters a matching situation.
3. The same hybrid search + temporal decay + MMR pipeline applies to KB articles, but KB articles in non-dated files are exempt from decay (evergreen).

The Supabase pgvector setup (knowledge-base.ts) remains the structured data store for versioned, categorized knowledge entries with SQL-queryable metadata. The two systems are complementary:
- **OpenClaw memory:** Agent-facing recall during conversation (fast, context-aware, decay-aware)
- **Supabase KB:** Structured storage with versioning, categories, RLS, API access (durable, queryable, multi-tenant)
