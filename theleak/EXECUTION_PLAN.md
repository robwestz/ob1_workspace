# Agentic Architecture — Execution Plan

> Mapping Nate's 12 Primitives × Extracted Knowledge × Installed Skills × OB1 Infra

## Inventory Status

### Already Installed Skills (34)
| Category | Skills |
|----------|--------|
| **Agent Framework** | agent-framework, agent-create-roadmap, agent-execute-phase, agent-execute-plan, agent-go, agent-install, agent-new-project, agent-plan-phase, agent-plugin, agent-status |
| **Buildr System** | buildr-executor, buildr-operator, buildr-rescue, buildr-scout, buildr-smith |
| **Context Engineering** | context-engineering-collection, context-fundamentals, context-optimization, context-compression, context-degradation, filesystem-context |
| **Team & Multi-Agent** | team-architect, multi-agent-patterns, workspace-planner |
| **Evaluation** | evaluation, advanced-evaluation |
| **Other** | tool-design, memory-systems, project-development, hosted-agents, bdi-mental-states, asyncreview, last30days, find-skills |

### Extracted Knowledge (from claw-code-main)
- 176 facts, 17 gamechangers, 15 skills, 5 agent blueprints
- Source: `theleak/claw-code-main/extraction/`

### Unexplored Source (claw-code-main/src/)
60+ Python modules — the actual Claude Code implementation. Key unexplored modules:
- `query_engine.py`, `QueryEngine.py` — core agentic loop
- `permissions.py` — full permission pipeline
- `tool_pool.py` — dynamic tool assembly
- `session_store.py` — session persistence
- `transcript.py` — compaction logic
- `cost_tracker.py`, `costHook.py` — token budget
- `history.py` — system event logging
- `system_init.py`, `prefetch.py`, `deferred_init.py` — staged boot
- `state/` — workflow state management
- `coordinator/` — multi-agent coordination
- `skills/` — skill extensibility system
- `hooks/` — hook architecture
- `memdir/` — memory directory system

---

## Primitive → Resource Mapping

### DAG 1: Non-Negotiables

| # | Primitiv | Extraherad Skill | Gamechanger | Claw Src | Installerad Skill | GAP |
|---|----------|-----------------|-------------|----------|-------------------|-----|
| 1 | **Tool Registry** | `skill_build_agentic_loop.md` | Generic Trait-Based Runtime | `tools.py`, `Tool.py`, `execution_registry.py` | `tool-design` | — |
| 2 | **Permission System** | `skill_tool_permission_system.md` | Permission Escalation Hierarchy | `permissions.py` | `tool-design` | — |
| 3 | **Session Persistence** | `skill_session_management.md` | Session Snapshot w/ Embedded Usage | `session_store.py` | `memory-systems` | OB1 = persistence layer |
| 4 | **Workflow State & Idempotency** | ❌ INTE EXTRAHERAD | — | `state/`, `tasks.py`, `task.py` | — | **CRITICAL GAP** |
| 5 | **Token Budget Tracking** | Partial (i agentic loop) | Auto-Compaction | `cost_tracker.py`, `costHook.py` | — | Behöver djupare extraktion |
| 6 | **Streaming Events** | `skill_streaming_renderer.md` | SSE Incremental, Event-Driven Streaming | `query_engine.py` | — | — |
| 7 | **System Event Logging** | ❌ INTE EXTRAHERAD | — | `history.py` | — | **GAP** |
| 8 | **Verification Harness** | — | — | `tests/` | `evaluation`, `advanced-evaluation` | — |

### VECKA 1: Operational Maturity

| # | Primitiv | Extraherad Skill | Gamechanger | Claw Src | Installerad Skill | GAP |
|---|----------|-----------------|-------------|----------|-------------------|-----|
| 9 | **Tool Pool Assembly** | — | — | `tool_pool.py` | `tool-design` | Behöver extraktion |
| 10 | **Transcript Compaction** | Auto-Compaction pattern | Auto-Compaction | `transcript.py` | `context-compression` | — |
| 11 | **Permission Audit Trail** | Partial | Permission Escalation | `permissions.py` | — | Behöver djupare extraktion |
| 12 | **Doctor Pattern** | ❌ INTE EXTRAHERAD | — | `cli/` | — | **GAP** |
| 13 | **Staged Boot Sequence** | ❌ INTE EXTRAHERAD | — | `system_init.py`, `prefetch.py`, `deferred_init.py` | — | **GAP** |
| 14 | **Stop Reason Taxonomy** | Partial (i agentic loop) | — | `query_engine.py` | — | — |
| 15 | **Provenance-Aware Context** | — | — | `context.py` | `context-*` (5 skills) | — |

### MÅNAD 1: Scale & Sophistication

| # | Primitiv | Extraherad Skill | Gamechanger | Claw Src | Installerad Skill | GAP |
|---|----------|-----------------|-------------|----------|-------------------|-----|
| 16 | **Agent Type System** | 5 agent blueprints | Sub-Agent Spawning | `coordinator/`, `assistant/` | `multi-agent-patterns`, `team-architect` | — |
| 17 | **Memory System** | — | — | `memdir/` | `memory-systems` | **OB1 ÄR memory-systemet** |
| 18 | **Skills & Extensibility** | 15 skills genererade | Shell-Based Hooks | `skills/`, `hooks/`, `plugins/` | `buildr-smith` | — |

---

## Identifierade Gap (prioritetsordning)

### KRITISKA (blockerar Dag 1)
1. **Workflow State & Idempotency** — Ingen extraktion gjord. Källa: `state/`, `tasks.py`, `task.py`
2. **System Event Logging** — Ingen extraktion gjord. Källa: `history.py`

### VIKTIGA (blockerar Vecka 1)
3. **Doctor Pattern** — Hälsokontroll-system. Källa: `cli/` (sök efter health/doctor)
4. **Staged Boot Sequence** — 7-stegs pipeline. Källa: `system_init.py`, `prefetch.py`, `deferred_init.py`
5. **Token Budget (djupare)** — Full cost-tracking. Källa: `cost_tracker.py`, `costHook.py`
6. **Tool Pool Assembly** — Dynamisk verktygsfiltrering. Källa: `tool_pool.py`
7. **Permission Audit Trail (djupare)** — Fullständig audit. Källa: `permissions.py`

### ENRICHMENT (Vecka 1+)
8. **Coordinator-systemet** — Multi-agent orchestration. Källa: `coordinator/`
9. **Memory Directory** — Filbaserat minne. Källa: `memdir/`
10. **Hooks-arkitektur** — 104 hook-moduler. Källa: `hooks/`

---

## Exekveringsfaser

### FAS 0: Gap-Extraktion (PARALLELISERAS)
Kör snowball-agenten eller manuella Explore-agenter mot de 10 gap-källorna ovan.
Producerar: nya skills, gamechangers, fakta för varje gap.

**Team-setup: 4 parallella agenter**
| Agent | Uppdrag | Filer att skanna |
|-------|---------|-----------------|
| **State-Analyst** | Workflow state, idempotency, tasks | `state/`, `tasks.py`, `task.py` |
| **Ops-Analyst** | Boot sequence, doctor pattern, event logging | `system_init.py`, `prefetch.py`, `deferred_init.py`, `history.py`, `cli/` |
| **Budget-Analyst** | Token budget, cost tracking, tool pool | `cost_tracker.py`, `costHook.py`, `tool_pool.py` |
| **Coord-Analyst** | Coordinator, permissions audit, hooks, memdir | `coordinator/`, `permissions.py`, `hooks/`, `memdir/` |

### FAS 1: Dag 1-Primitiver (PARALLELISERAS)
Med gap-extraktionen klar, bygg de 8 Dag 1-primitiverna.

**Team-setup: 3 parallella agenter**
| Agent | Uppdrag | Input |
|-------|---------|-------|
| **Registry-Builder** | Tool registry + permission system | Extraherade skills 1-2 + `tool-design` skill |
| **State-Builder** | Session persistence + workflow state + token budget | Extraherade skills 3-5 + OB1 Supabase schema |
| **Stream-Builder** | Streaming events + system logging + verification harness | Extraherade skills 6-8 + `evaluation` skill |

### FAS 2: Vecka 1-Primitiver (PARALLELISERAS)
**Team-setup: 2 parallella agenter**
| Agent | Uppdrag | Input |
|-------|---------|-------|
| **Assembly-Builder** | Tool pool + compaction + stop reasons + provenance | Context-skills + extraktioner |
| **Ops-Builder** | Permission audit + doctor + staged boot | Ops-extraktioner |

### FAS 3: Månad 1 (PARALLELISERAS)
**Team-setup: 3 parallella agenter**
| Agent | Uppdrag | Input |
|-------|---------|-------|
| **Agent-Architect** | Agent type system med OB1-integration | `multi-agent-patterns` + blueprints |
| **Memory-Architect** | Memory system = OB1 thoughts + pgvector | `memory-systems` + OB1 schema |
| **Skill-Architect** | Skills & extensibility framework | `buildr-smith` + hooks-extraktion |

---

## OB1 Integration Points

| OB1 Component | Primitiv den tjänar | Hur |
|---------------|--------------------|----|
| **Supabase (thoughts table)** | Session Persistence (#3) | Sessioner sparas som thoughts med type='session' |
| **Supabase (thoughts table)** | System Event Logging (#7) | Events sparas med type='system_event' |
| **Supabase (thoughts table)** | Permission Audit Trail (#11) | Audit entries som thoughts med type='permission_audit' |
| **pgvector** | Memory System (#17) | Semantisk sökning över alla minnen |
| **pgvector** | Provenance-Aware Context (#15) | Embedding-baserad kontext-assembly med metadata |
| **MCP Server** | Tool Registry (#1) | MCP tools = agentens verktygsregister |
| **MCP Server** | Skills & Extensibility (#18) | Nya skills exponeras som MCP endpoints |
| **Edge Functions** | Doctor Pattern (#12) | Health-check endpoint |
| **Edge Functions** | Staged Boot (#13) | Init-pipeline som Edge Function |

---

## Recommended Skill Installs

Saknas men värdefullt:
1. `pproenca/dot-skills@harness-engineering` (26 installs) — Harness engineering patterns
2. `hack23/homepage@agentic-workflow-orchestration` (38 installs) — Workflow orchestration
3. `sickn33/antigravity-awesome-skills@agent-evaluation` (425 installs) — Agent evaluation

Redan installerat som täcker behoven: 34 skills (se inventering ovan).

---

## Nästa Steg

1. **GODKÄNN PLANEN** — Review denna fil
2. **INSTALLERA SAKNADE SKILLS** — 3 rekommenderade ovan
3. **KÖR FAS 0** — Team av 4 parallella Explore-agenter mot gap-källorna
4. **KÖR FAS 1-3** — Builder-teams sekventiellt men med intern parallellism
