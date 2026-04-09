# Multi-Model Orchestration — OpenClaw Conductor

> Domain: AI Agent Architecture
> Last updated: 2026-04-05
> Source: OpenClaw src/conductor/ (full source analysis)

---

## What Conductor Is

Conductor is OpenClaw's built-in multi-model orchestration engine. It routes different tasks to different LLMs based on complexity scoring, domain tags, and configurable routing rules. The system decomposes work into modules, scores each module's complexity, assigns the optimal model, then packages everything into an "Uppdragspaket" (Swedish for "assignment package") that contains the module's persona, domain knowledge, constraints, contracts, and handoff context.

Conductor is not a simple model switcher. It is a full orchestration pipeline with four subsystems:

1. **Model Router** — Complexity scoring and rule-based model assignment
2. **Workspace Builder** — Uppdragspaket generation (persona, skills, contracts, constraints)
3. **Handoff System** — Cross-module context flow with priority tagging
4. **Context Stream** — Append-only discovery log with relevance scoring

## How Conductor Works Internally

### Stage 1: Complexity Scoring

Every module (unit of work) has a `ModuleManifest` describing its responsibility, inputs/outputs, acceptance criteria, internal requirements, and files to create. Conductor scores complexity using four weighted factors:

| Factor | Weight | Measurement |
|--------|--------|-------------|
| Acceptance criteria count | 0.25 | Normalized: count / 10, capped at 1.0 |
| Contract dependency count | 0.25 | (inputs + outputs) / 8, capped at 1.0 |
| Domain complexity | 0.30 | Tag-based: high-domain words = 1.0, medium = 0.5, low = 0.15 |
| Scope (requirements + files) | 0.20 | (requirements + files) / 15, capped at 1.0 |

The weighted sum determines the complexity level:
- **High** (score >= 0.6): Architecture, orchestration, security, integration
- **Medium** (score 0.3 - 0.6): Adapters, builders, generators, handlers
- **Low** (score < 0.3): Validators, formatters, templates, configs, utilities

### Domain Tag Extraction

Conductor extracts domain tags from the module's name and responsibility text. These tags drive both complexity scoring and routing rules:

**High-complexity domains:** orchestration, conductor, integration, architecture, pipeline, coordinator, engine, scheduler

**Medium-complexity domains:** adapter, builder, generator, parser, collector, handler, router, monitor, resolver

**Low-complexity domains:** validator, formatter, template, config, util, helper, constant, schema, type

### Stage 2: Rule-Based Routing

After complexity scoring, Conductor evaluates routing rules in priority order. Rules match on four dimensions:

```typescript
type RoutingMatch =
  | { type: "complexity"; level: "low" | "medium" | "high" }
  | { type: "domain"; tags: string[] }
  | { type: "module"; moduleId: string }
  | { type: "name"; pattern: string };  // supports wildcards
```

**Default rules (from source):**

| Priority | Match | Assignment |
|----------|-------|------------|
| 20 | Domain: orchestration, conductor, architecture | claude-opus-4-6 |
| 20 | Domain: adapter, formatter, template | claude-sonnet-4-6 |
| 10 | Complexity: high | claude-opus-4-6 |
| 10 | Complexity: medium | claude-sonnet-4-6 |
| 10 | Complexity: low | claude-haiku-4-5 |

Domain rules have higher priority (20) than complexity rules (10), so a module tagged "architecture" always gets Opus regardless of its computed complexity score.

**Explicit overrides** bypass rules entirely:
```typescript
overrides: { "auth-module": "anthropic/claude-opus-4-6" }
```

### Stage 3: Uppdragspaket Generation

"Uppdragspaket" (literally "assignment package") is the complete work package sent to a sub-agent. It contains:

1. **Persona** — Role, expertise list, priorities, and style (auto-resolved from domain tags)
2. **Skills** — Domain knowledge, recommended patterns, and test strategy
3. **Contracts** — TypeScript interface definitions for module boundaries
4. **Acceptance Criteria** — Specific, testable success conditions
5. **Constraints** — Boundary enforcement (file paths, import rules, module isolation)
6. **Handoff Context** — Upstream discoveries, decisions, and directed messages
7. **Report Format** — Structured template for completion reporting

**Persona archetypes** (auto-selected):
- **Core Systems Engineer** — For orchestration, engines, pipelines. Prioritizes correctness, composability.
- **Runtime Systems Engineer** — For adapters, handlers, monitors. Prioritizes reliability, edge cases.
- **Quality & Validation Engineer** — For validators, checkers, reports. Prioritizes completeness, zero false positives.
- **Module Builder** — Generic fallback. Focused implementation.

**Skills profiles** (auto-selected):
- Orchestration, Parsing, Runtime, Validation, Reporting, Model-routing, General

The rendered Uppdragspaket is a markdown document with Swedish section headers (Din roll, Domankusnkap, Kontrakt, Acceptanskriterier, Begransningar, Rapportformat), giving each agent a complete, self-contained brief.

### Stage 4: Handoff Extraction and Routing

After an agent completes work, Conductor parses its completion report for handoff items. The report follows a structured format:

```markdown
## Handoff
- @M-02: CRITICAL -- timestamps in IngestedPlan are always UTC
- @M-04: Schema validation throws ExecutorError with code enum
- @ALL: Parser returns empty array, never null for missing sections
```

Handoff routing uses the contract graph:
- **Direct items** (`@M-02`) go to the specified module
- **Broadcast items** (`@ALL` -> `*`) go to every module that consumes a contract produced by the source

Priority detection is bilingual: `CRITICAL`/`VIKTIGT` = critical, `IMPORTANT`/`OBS` = important, everything else = informational.

### Stage 5: Context Stream

An append-only JSONL file (`discoveries.jsonl`) captures cross-module learnings with relevance scoring:

- Tagged with target module: +0.5 relevance
- From a contract-linked module: +0.3
- Topic matches target domain: +0.2
- Recent (last hour): +0.1

The reader sorts by relevance and renders a "Cross-Module Discoveries" briefing injected into downstream modules' context.

## Runtime Adapters

Conductor supports two runtime backends:

### OpenClaw Native Adapter
- Spawns sub-agents via `sessions_spawn`
- Uses real model selection via `toModelRef()`
- Creates Continuum checkpoints at wave boundaries
- Bridges conductor handoffs to Continuum's checkpoint system
- Supports agent abort and teardown

### Agent Teams Adapter (Claude Code CLI)
- Maps conductor models to Agent Teams model strings
- Simpler: no checkpoints, no handoff bridge
- Fallback for non-OpenClaw environments

### Continuum Bridge

Conductor integrates with OpenClaw's Continuum checkpoint system. The bridge converts between:
- Conductor's `ConductorHandoffContext` (directed items with priorities between modules)
- Continuum's `HandoffContext` (session-level context for agent-to-agent handoffs)

This means conductor progress survives crashes. After a crash, the system can restore from the last wave-boundary checkpoint and resume the next wave.

## Available Models and Routing Criteria

From the source code and provider docs, Conductor can route to:

| Model | Provider String | Typical Role | Input Cost | Output Cost |
|-------|----------------|--------------|------------|-------------|
| Claude Opus 4.6 | `anthropic/claude-opus-4-6` | Architecture, security, complex reasoning | $15/MTok | $75/MTok |
| Claude Sonnet 4.6 | `anthropic/claude-sonnet-4-6` | General coding, adapters, medium tasks | $3/MTok | $15/MTok |
| Claude Haiku 4.5 | `anthropic/claude-haiku-4-5` | Formatting, templates, simple tasks | $0.80/MTok | $4/MTok |
| Codex 5.3 | `openai/codex-5-3` | Bulk code generation, code completion | Varies | Varies |
| Gemini 3 Pro | `google/gemini-3-pro-preview` | Large context research, 1M+ token tasks | Varies | Varies |
| GPT-5.1 Codex | `openai/gpt-5.1-codex` | Alternative code generation | Varies | Varies |

Plus any custom provider via `models.providers` config (LiteLLM, Ollama, vLLM, OpenRouter, etc.).

## Cost Implications of Routing Strategies

### Strategy A: Opus-Only
- Monthly estimate (heavy use): ~$800-1200
- Quality: Maximum
- Risk: Overspend on simple tasks

### Strategy B: Conductor Default (complexity-based)
- Monthly estimate: ~$200-400
- Quality: High where it matters, acceptable elsewhere
- Risk: Some medium tasks may benefit from Opus

### Strategy C: Aggressive Cost Optimization
- Override Sonnet as default, Opus only for architecture/security
- Monthly estimate: ~$100-200
- Risk: Quality degradation on complex non-architecture tasks

### Strategy D: Mixed Provider
- Codex for code generation, Opus for reasoning, Gemini for large context
- Monthly estimate: ~$150-300
- Best balance when tasks genuinely span different domains

## Tuning Conductor for Specific Use Cases

### Adding Custom Routing Rules

```typescript
const config: Partial<ModelRoutingConfig> = {
  defaultProvider: "anthropic/claude-sonnet-4-6",
  rules: [
    // Security always gets Opus
    { match: { type: "domain", tags: ["security", "auth", "crypto"] }, assign: "anthropic/claude-opus-4-6", priority: 30 },
    // SEO content generation uses Codex
    { match: { type: "name", pattern: "*seo*" }, assign: "openai/codex-5-3", priority: 25 },
    // Keep defaults for everything else
    ...DEFAULT_RULES,
  ],
  overrides: {
    "critical-module": "anthropic/claude-opus-4-6",
  },
};
```

### Adjusting Complexity Thresholds

The thresholds are hardcoded (high >= 0.6, medium >= 0.3) but can be overridden by using domain rules at higher priority. For finer control, create explicit module overrides.

### Per-Wave Model Selection

Conductor routes per-module, not per-wave. But since wave structure determines execution order, you can influence cost by designing wave boundaries:
- Wave 1: Infrastructure modules (lower complexity, use Sonnet/Haiku)
- Wave 2: Core logic modules (higher complexity, Opus kicks in automatically)
- Wave 3: Integration and testing (medium complexity, Sonnet)

## Integration with OpenClaw Features

- **Sub-agents**: Conductor launches via `sessions_spawn`, respecting `subagents.maxConcurrent` and `maxSpawnDepth`
- **Continuum**: Wave-boundary checkpoints via the bridge layer
- **Hooks**: `before_model_resolve` hook can override Conductor's model selection at runtime
- **Model Failover**: Conductor picks the model; OpenClaw's auth profile rotation and model fallback handle provider failures
- **Memory**: Context stream discoveries persist to disk and can be recalled in future sessions
