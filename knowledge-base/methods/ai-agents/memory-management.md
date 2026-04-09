---
title: "Memory Management for AI Agents"
format: method-guide
layer: methods
category: "ai-agents"
status: verified
confidence: high
last_verified: 2026-04-05
tags:
  - memory
  - agent-operations
  - knowledge-management
  - retrieval-quality
  - pruning
  - seeding
  - openclaw
prerequisites:
  - knowledge-base/domain/ai-agents/persistent-memory-architecture
outputs:
  - Well-structured, high-retrieval-quality memory corpus
  - Seeded agent instance with months of operational knowledge
  - Memory health monitoring and pruning workflow
quality_gate: ""
---

# Memory Management for AI Agents

> How to structure, seed, maintain, and prune agent memories so that retrieval quality improves over time rather than degrading under growing corpus size.

## Purpose

An agent memory system is only as good as the information it contains and how well it can find that information when needed. Without deliberate memory management, agents accumulate a disorganized pile of daily notes that buries important decisions under trivial observations, creates redundant entries that waste context tokens, and retains stale information that actively misleads.

This method provides the complete lifecycle: structuring memories for maximum retrieval quality, capturing the right information at the right time, pruning and consolidating over time, and seeding new instances with accumulated operational knowledge.

## When to Use

- Setting up a new agent instance that needs to hit the ground running
- Agent's memory search is returning irrelevant or redundant results
- Daily notes have grown past ~50 files and retrieval quality is noticeably degrading
- Migrating an agent to a new deployment or handing off between team members
- Performing periodic maintenance on a long-running agent's knowledge store

## When NOT to Use

- For structured, multi-tenant data storage -- use Supabase with pgvector instead
- For ephemeral task context that only matters during a single session -- use conversation context, not persistent memory
- For component libraries or code templates -- use the Component KB layer with version-controlled files

## Prerequisites

- Agent has a persistent workspace with `memory/` directory structure
- Memory search is configured (at minimum `memorySearch.provider` set)
- Understanding of the three memory layers: MEMORY.md (curated), daily logs (append-only), evergreen references (stable)

## Process

### Step 1: Establish Memory Structure

**Action:** Create the foundational memory file structure with clear separation of concerns.

**Inputs:** Agent's operational domain, key projects, infrastructure, contacts.

**Outputs:** A workspace with organized memory files.

**Structure:**
```
workspace/
  MEMORY.md                    # Curated long-term: decisions, preferences, project history
  memory/
    projects.md                # Evergreen project reference (never decays)
    network.md                 # Infrastructure reference (never decays)
    contacts.md                # Who's who (never decays)
    tools.md                   # Tool conventions and preferences (never decays)
    YYYY-MM-DD.md              # Daily logs (subject to temporal decay)
```

**Rules for each layer:**

| File | Content type | Update frequency | Temporal decay |
|------|-------------|------------------|----------------|
| `MEMORY.md` | Decisions, preferences, lessons learned, project chronology | Updated when major decisions change | Exempt (evergreen) |
| `memory/projects.md` | Active project list, tech stacks, URLs, status | Updated when projects start/finish/change | Exempt (evergreen) |
| `memory/network.md` | IPs, ports, hostnames, VPN config, infrastructure | Updated when infrastructure changes | Exempt (evergreen) |
| `memory/contacts.md` | People, roles, communication preferences | Updated when team changes | Exempt (evergreen) |
| `memory/YYYY-MM-DD.md` | Work done, bugs found, tests run, observations | Append-only within the day | Subject to decay (30-day half-life) |

**Decision point:** If the agent operates across multiple distinct domains (e.g., SEO + web development + infrastructure), create additional evergreen files per domain rather than mixing everything into MEMORY.md.

### Step 2: Define Naming and Tagging Conventions

**Action:** Establish consistent naming patterns that maximize both human readability and search retrieval quality.

**Inputs:** The domains and topics the agent works with.

**Outputs:** A naming convention document (can be stored in MEMORY.md or TOOLS.md).

**Conventions for memory entries:**

1. **Lead with the subject, not the action.** Write "Bacowr pipeline uses 8-phase processing" not "Worked on Bacowr pipeline today."

2. **Include searchable identifiers.** If a memory relates to a specific system, project, or tool, name it: "Omada ER605 router VLAN 10 configuration" not "Updated network settings."

3. **Tag with category when using structured storage.** Categories: `preference`, `fact`, `decision`, `entity`, `other`. Use `decision` for anything the agent or user chose between alternatives.

4. **Keep entries atomic.** One fact, decision, or observation per entry. "Robin prefers TypeScript strict mode" is better than a paragraph mixing preferences, decisions, and project notes.

5. **Use consistent date headers in daily logs.**
```markdown
## 2026-04-05

### Bacowr
- Deployed v6.2 to production. Pipeline throughput improved 15%.
- Decision: Use batch embedding API for cost optimization.

### Infrastructure
- Tailscale mesh latency between Windows PC and Mac: stable at ~3ms.
```

6. **Cross-reference between files.** In a daily log: "See memory/projects.md for Bacowr tech stack." In an evergreen file: "Last updated based on 2026-04-05 deployment."

### Step 3: Configure Capture Strategy

**Action:** Set up the right balance of explicit and automatic memory capture.

**Inputs:** Agent's memory plugin choice, operational tempo.

**Outputs:** Configured capture pipeline.

**Explicit capture (recommended as primary):**

The agent writes to memory when:
- A decision is made ("We will use X instead of Y because Z")
- A preference is expressed ("Robin prefers morning reports at 7am")
- A durable fact is discovered ("The Supabase project URL is X")
- A lesson is learned ("Retry logic is critical for autonomous sessions")
- End of a significant work session (pre-compaction flush handles this automatically)

Enable pre-compaction memory flush (always recommended):
```json5
{
  compaction: {
    memoryFlush: {
      enabled: true,
      softThresholdTokens: 4000
    }
  }
}
```

**Automatic capture (optional, additive):**

If using `memory-lancedb`, enable auto-capture for passive memory building:
```json5
{
  plugins: {
    slots: { memory: "memory-lancedb" },
    entries: {
      "memory-lancedb": {
        enabled: true,
        config: {
          embedding: {
            apiKey: "${OPENAI_API_KEY}",
            model: "text-embedding-3-small"
          },
          autoCapture: true,
          autoRecall: true,
          captureMaxChars: 500
        }
      }
    }
  }
}
```

**When to use each:**

| Approach | Best for | Risk |
|----------|----------|------|
| Explicit only (`memory-core`) | High-signal environments where every memory matters | Agent may forget to write; loss during unexpected shutdowns |
| Auto-capture only (`memory-lancedb`) | Low-friction passive building | Captures noise; 500-char limit misses long-form decisions |
| Both (recommended) | Production agents with long sessions | Potential duplicate entries; mitigated by similarity dedup at 95% |

**Decision point:** If the agent runs overnight autonomous sessions (8+ hours), explicit capture via memory flush is non-negotiable. Auto-capture is a bonus layer.

### Step 4: Tune Retrieval Quality

**Action:** Enable and configure hybrid search, temporal decay, and MMR based on the agent's operational pattern.

**Inputs:** Memory corpus size, age range, content diversity.

**Outputs:** Configured retrieval pipeline.

**Recommended production configuration:**
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
            vectorWeight: 0.7,
            textWeight: 0.3,
            candidateMultiplier: 4,
            mmr: {
              enabled: true,
              lambda: 0.7
            },
            temporalDecay: {
              enabled: true,
              halfLifeDays: 30
            }
          }
        },
        cache: {
          enabled: true,
          maxEntries: 50000
        }
      }
    }
  }
}
```

**Tuning guide:**

| Symptom | Adjustment |
|---------|------------|
| Search misses exact IDs/codes | Increase `textWeight` to 0.4-0.5 |
| Old notes outrank recent corrections | Decrease `halfLifeDays` to 14-21 |
| Agent rarely needs old context | Decrease `halfLifeDays` to 14 |
| Agent works on long-running projects | Increase `halfLifeDays` to 60-90 |
| Too many similar daily entries returned | Decrease MMR `lambda` to 0.5-0.6 |
| Important relevant results being dropped | Increase MMR `lambda` to 0.8-0.9 |
| Search is slow on large corpus | Enable embedding cache, increase `candidateMultiplier` cautiously |

### Step 5: Seed a New Instance

**Action:** Pre-populate memory to give a new agent instance months of operational knowledge from day one.

**Inputs:** Existing knowledge from previous sessions, project documentation, decisions log, infrastructure details.

**Outputs:** A seeded memory directory that passes for a mature agent.

**Seeding strategy for "10 months of experience":**

1. **Create MEMORY.md** with chronological decision journal:
```markdown
# Memory

## Vision & Direction
[One paragraph describing what the agent does and for whom]

## Key Decisions (chronological)
**2025-06 -- Platform choice:** Supabase as backend. Reason: ...
**2025-07 -- Architecture:** Build on OpenClaw, not parallel. Reason: ...
[Continue through present]

## Lessons Learned
- Iterative cycles beat batch dispatch
- Verification is not optional
- Retry logic is critical for autonomous sessions
[Continue with real lessons]

## Preferences
- Lead with results, not intentions
- Production-ready as default, MVP only as fallback
- Swedish as primary language, technical English OK
[Continue with real preferences]
```

2. **Create evergreen reference files:**
   - `memory/projects.md` -- every active and past project with tech stack, URLs, status
   - `memory/network.md` -- all infrastructure (IPs, ports, VPN, DNS)
   - `memory/contacts.md` -- people the agent interacts with, their roles, preferences

3. **Create realistic daily logs** spanning key dates:
   - Do not create one for every day (unnatural). Create 2-4 per month for months with significant activity, fewer for quiet periods.
   - Each log should contain specific, factual entries (commits, deployments, bugs found, decisions made).
   - Use the actual date format: `memory/2025-08-15.md`.

4. **Do NOT create:**
   - `BOOTSTRAP.md` (its absence signals maturity -- it was deleted after first run)
   - Fake checkpoints with fabricated content (checkpoints should reflect real state)
   - Memory entries that contradict each other across files

5. **Verification after seeding:**
   - Run `openclaw memory search "project name"` for each major project -- results should be relevant
   - Run `openclaw memory search "decision about X"` for key decisions -- the correct decision should rank first
   - Check that temporal decay is working: recent entries should outrank old ones for the same topic

### Step 6: Prune and Consolidate Over Time

**Action:** Periodically review and maintain memory health.

**Inputs:** Current memory corpus, retrieval quality observations.

**Outputs:** Cleaner, more focused memory with higher retrieval quality.

**Monthly maintenance checklist:**

1. **Review MEMORY.md** for accuracy:
   - Are decisions still current? Update or add corrections with dates.
   - Are preferences still accurate? Remove outdated ones.
   - Is the chronology complete? Add missing significant events.

2. **Consolidate daily logs:**
   - Logs older than 90 days: extract any durable facts/decisions into MEMORY.md or an evergreen file.
   - Logs older than 180 days: can be archived (moved to `memory/archive/`) or deleted if all important content has been extracted.
   - Do not delete logs that contain unique information not captured elsewhere.

3. **Check evergreen files:**
   - `memory/projects.md` -- remove completed projects to a "Past projects" section, update active ones.
   - `memory/network.md` -- verify IPs, ports, configurations are current.
   - `memory/contacts.md` -- update roles, remove departed people.

4. **Test retrieval quality:**
   - Search for 5 known facts. Did the right entry rank first?
   - Search for a recent decision. Does it outrank the old decision it superseded?
   - Search for a project name. Are the results diverse (not 5 copies of the same daily note)?

**Quarterly maintenance:**

5. **Review embedding cache:** If the cache is approaching `maxEntries`, consider whether the limit needs increasing or whether old session transcript entries can be dropped.

6. **Check session transcript indexing health:** If enabled, verify that recent sessions are being indexed (check logs for `memory-lancedb: auto-captured` or QMD update messages).

## Quality Checks

- [ ] MEMORY.md contains decisions with dates and rationale, not just facts
- [ ] Evergreen files exist for each major operational domain (projects, network, contacts)
- [ ] Daily logs use consistent date headers and subject grouping
- [ ] Memory entries are atomic (one fact/decision per entry, not paragraphs)
- [ ] Hybrid search is enabled with both vector and BM25 weights
- [ ] Temporal decay is enabled with appropriate half-life for the agent's workflow
- [ ] MMR is enabled to prevent redundant results
- [ ] Pre-compaction memory flush is enabled
- [ ] Embedding cache is enabled
- [ ] A search for any major project returns relevant, non-redundant results
- [ ] A search for a recent decision outranks the old version of that decision

## Common Failures

| Failure | Symptom | Prevention |
|---------|---------|-----------|
| Memory corpus becomes a dumping ground | Search returns irrelevant noise; agent ignores memory results | Write atomic, searchable entries. Prune monthly. |
| Stale info outranks corrections | Agent acts on outdated decisions | Enable temporal decay. Update MEMORY.md when decisions change. |
| Redundant daily entries dominate results | Same fact repeated 5 times in results, wasting context tokens | Enable MMR. Consolidate old daily logs into evergreen files. |
| Agent forgets to write memory | Long sessions lose context on compaction | Enable pre-compaction memory flush. Consider auto-capture. |
| Seeded agent feels generic | Memory contains vague, template-like entries | Seed with specific, factual content from real project history. |
| Memory search misses exact identifiers | Agent cannot find entries by error code, IP, or project ID | Increase BM25 weight. Include identifiers verbatim in memory text. |
| Auto-capture creates noise | Irrelevant conversational fragments stored | Tune `captureMaxChars`. Use explicit capture as primary strategy. |
| Cross-session recall fails | Agent cannot remember past conversations | Enable session transcript indexing. Check delta thresholds. |

## Example

### Scenario: Seeding an agent for Robin's development operation

**Context:** Robin runs an autonomous IT department with SEO, web development, and SaaS projects. The agent needs to know about Bacowr, the MacBook agent platform, OpenClaw configuration, quality standards, and 10 months of operational decisions.

**Step 1 -- Structure:**
```
workspace/
  MEMORY.md                     # 5000+ chars, chronological decision journal
  memory/
    projects.md                 # Bacowr, OB1, client projects
    network.md                  # Windows PC, Mac M2, Tailscale mesh, Supabase
    contacts.md                 # Team members, client contacts
    2025-08-15.md               # Wave protocol first success
    2025-09-20.md               # Multi-model strategy defined
    2025-10-10.md               # Mac agent platform provisioned
    ...                         # 2-4 logs per month through present
    2026-04-05.md               # Today's work
```

**Step 2 -- Naming examples:**
- Good: "Bacowr v6 pipeline: 8-phase SEO article generation with 11-step QA grind, 5008 lines Python"
- Bad: "Worked on the pipeline today, made some improvements"
- Good: "Decision 2025-08: Wave protocol replaces batch dispatch for night shifts. Reason: batch produced shallow work, waves iterate with verification."
- Bad: "Changed how we do things at night"

**Step 3 -- Capture config:** Explicit (`memory-core`) with pre-compaction flush enabled. Auto-capture disabled because Robin prefers deliberate, high-signal memory entries.

**Step 4 -- Retrieval tuning:**
- Hybrid: 0.7 vector / 0.3 BM25 (Robin's projects use many specific identifiers)
- Temporal decay: 30-day half-life (daily notes are frequent, recent context matters most)
- MMR: lambda 0.7 (daily notes often repeat infrastructure details)
- Cache: enabled, 50000 entries

**Step 5 -- Verification:**
```bash
openclaw memory search "Bacowr pipeline"
# Expected: projects.md entry first, recent daily log second

openclaw memory search "wave protocol decision"
# Expected: MEMORY.md decision entry, not the old batch-dispatch notes

openclaw memory search "192.168.10.2"
# Expected: network.md entry (BM25 catches the exact IP)
```

## Related

- Domain knowledge: [[persistent-memory-architecture]]
- Raw research: [[memory-openclaw-vs-supabase]]
- Vision: [[knowledge-base/VISION.md]] (three-layer KB model)
- Config reference: [[openclaw-seed/openclaw.json]]
