# Conductor vs Custom Router — Honest Comparison

> Analysis date: 2026-04-05
> Compared systems:
> - OpenClaw Conductor (`src/conductor/`) — built-in multi-model orchestration
> - OB1 Custom Router (`theleak/implementation/runtime/src/`) — model-registry.ts, task-router.ts, dispatch.ts

---

## System Summaries

### OpenClaw Conductor

A module-oriented orchestration engine. Takes a set of modules (from a plan), scores each module's complexity using weighted factors, applies routing rules to assign models, then generates complete "Uppdragspaket" (assignment packages) with persona, skills, contracts, constraints, and handoff context. Integrates with OpenClaw's sub-agent system for execution and Continuum for checkpoint/recovery.

**Architecture:** Types -> Model Router (complexity + rules) -> Workspace Builder (uppdragspaket) -> Handoff (extraction + routing) -> Context Stream (discoveries) -> Runtime Adapter (OpenClaw native or Agent Teams)

### OB1 Custom Router

A capability-oriented routing engine. Maintains a model registry with specs (capabilities, costs, context windows, rate limits), routes tasks based on a multi-dimensional scoring algorithm (capability match, tier alignment, cost optimization, context fit, latency), and dispatches calls through a budget-aware layer with automatic fallback to cheaper models when budget runs low.

**Architecture:** ModelRegistry (specs + health) -> TaskRouter (scoring + routing) -> Dispatcher (budget + execution + logging)

---

## What Conductor Does That Our Custom Router Does Not

### 1. Module-Level Orchestration

Conductor operates at the module level, not the individual call level. It takes a plan with multiple modules, their dependencies (contracts), and execution order (waves), then orchestrates the entire pipeline.

Our router operates at the individual API call level. It answers "which model for this call?" not "which model for this module in this plan?"

**Impact:** Conductor can reason about the relationship between modules. If Module A produces data that Module B consumes, Conductor routes both with awareness of their contract. Our router has no concept of inter-task relationships.

### 2. Uppdragspaket (Assignment Packages)

Conductor generates complete work packages for each module with:
- Auto-resolved persona (Core Systems Engineer, Runtime Engineer, Quality Engineer)
- Domain-specific knowledge injection (orchestration patterns, parsing patterns, etc.)
- Interface contracts (TypeScript definitions of module boundaries)
- Acceptance criteria
- Constraints (file boundaries, import rules)
- Structured completion report format
- Handoff context from upstream modules

Our router provides none of this. It selects a model and dispatches the call. The prompt engineering is left to the caller.

**Impact:** Conductor's agents get significantly richer context. Each agent knows its role, domain, constraints, and what upstream modules discovered. Our router leaves this to whatever calls it.

### 3. Cross-Module Handoff

After a module completes, Conductor extracts handoff items from its completion report (`## Handoff` section), detects priority levels (CRITICAL/IMPORTANT/informational), and routes items to downstream modules via the contract graph. Broadcast items (`@ALL`) fan out to all consumers.

Our router has no handoff mechanism. Each task is independent.

**Impact:** In a multi-wave execution, Conductor preserves critical context between waves. Our router would require the caller to manually thread context between calls.

### 4. Context Stream (Discovery Log)

Conductor maintains an append-only JSONL log of cross-module discoveries with relevance scoring. Downstream modules receive a filtered, relevance-ranked briefing of what upstream modules learned.

Our router has call logs but no semantic discovery tracking.

**Impact:** Over a multi-module project, Conductor accumulates and distributes institutional knowledge. Each downstream module starts better-informed.

### 5. Continuum Integration (Checkpoints)

Conductor creates checkpoints at wave boundaries via its bridge to Continuum. If the system crashes mid-execution, it can resume from the last completed wave. The bridge converts between conductor's handoff format and Continuum's checkpoint format.

Our router has no state persistence. If it crashes, all context is lost.

### 6. Dual Runtime Adapters

Conductor can execute via:
- OpenClaw native (sub-agent spawn with real model selection)
- Agent Teams (Claude Code CLI with model mapping)

Our router executes via a single Dispatcher that calls provider APIs directly.

### 7. Swedish-Language Persona Templates

Small detail, but: Conductor renders uppdragspaket with Swedish section headers (Din roll, Domankusnkap, Kontrakt, etc.). This is a design choice that gives the agent a distinct identity and cultural context.

---

## What Our Custom Router Does That Conductor Does Not

### 1. Capability-Based Model Selection

Our ModelRegistry tracks 8 distinct capabilities per model: reasoning, code_generation, large_context, vision, fast_output, tool_use, structured_output, multilingual. The TaskRouter matches required capabilities to model capabilities and scores the fit.

Conductor's routing is domain-tag based ("does the module name contain 'orchestration'?") and complexity-score based. It does not reason about specific model capabilities.

**Impact:** Our router can answer "find me the cheapest model with vision AND structured_output AND >1M context." Conductor cannot — it maps complexity levels to models and domain tags to models, but doesn't reason about capability intersection.

### 2. Multi-Dimensional Scoring Algorithm

Our TaskRouter uses a 5-factor weighted scoring algorithm:
- Capability match (0.30) — required vs available
- Tier alignment (0.25) — task complexity vs model tier
- Cost optimization (0.25) — cheaper is better within the candidate set
- Context fit (0.10) — context window vs estimated tokens
- Latency score (0.10) — measured provider latency

Conductor's scoring is simpler: 4-factor complexity score, then first-matching-rule wins. No multi-dimensional candidate ranking.

**Impact:** Our router produces nuanced rankings with reasoning strings. Conductor assigns deterministically based on rule priority — the first matching rule wins with no comparison against alternatives.

### 3. Budget Management

Our Dispatcher has production-grade budget management:
- Pre-call cost estimation
- Running budget tracking (USD and tokens)
- Automatic fallback to cheaper models when budget runs low
- Budget alerts at 50%, 75%, 90%, 100% thresholds
- Per-session budget caps
- Usage aggregation by model

Conductor has no concept of budget. It assigns models based on complexity and rules, with no awareness of cost accumulation.

**Impact:** For sustained operations (8-hour night shifts), budget management prevents runaway costs. Conductor would happily assign Opus to every high-complexity module regardless of cumulative spend.

### 4. Provider Health Monitoring

Our ModelRegistry actively health-checks providers (latency measurement via HEAD requests, 5s timeout). Unhealthy providers are excluded from routing candidates. The latency measurement feeds into the scoring algorithm.

Conductor does not check provider health. It delegates to OpenClaw's auth profile rotation and model failover system, but those operate after Conductor has already chosen the model.

**Impact:** Our router proactively avoids degraded providers. Conductor would assign a model to a provider that's experiencing latency issues, then rely on OpenClaw's failover to recover (reactive, not proactive).

### 5. Quick-Route Defaults

Our TaskRouter has pre-defined task profiles for 11 task types (code_write, code_review, architecture, security, documentation, etc.) with sensible defaults for complexity, capabilities, tokens, and priority. `quickRoute("architecture")` immediately returns the best model without requiring a full task profile.

Conductor requires a complete ModuleManifest with responsibility text, inputs/outputs, acceptance criteria, etc.

**Impact:** For ad-hoc routing ("what model should I use for this code review?"), our router is immediately useful. Conductor requires upstream plan decomposition.

### 6. Cost Estimation

Our Dispatcher provides per-call cost estimation before execution and actual cost tracking after. The `estimateCost()` method calculates exact USD amounts based on model pricing and token counts.

Conductor does not estimate or track costs.

### 7. Multi-Provider Model Registry

Our ModelRegistry tracks models across Anthropic, OpenAI, and Google with per-model specs (context window, max output, pricing, rate limits, API endpoints). It supports dynamic registration and enable/disable per model.

Conductor knows about `anthropic/claude-opus-4-6`, `anthropic/claude-sonnet-4-6`, `anthropic/claude-haiku-4-5`, and `openai/codex-5-3` as strings, but has no structured knowledge of their capabilities, pricing, or limits.

---

## What Both Systems Do (Overlap)

| Capability | Conductor | Custom Router |
|------------|-----------|---------------|
| Complexity-to-model mapping | Yes (4-factor score -> high/medium/low -> model) | Yes (tier alignment score) |
| Rule-based overrides | Yes (per-module overrides map) | Yes (explicit model ID override) |
| Fallback mechanism | Via OpenClaw model failover (external) | Via Dispatcher budget fallback (internal) |
| Model identification | Provider/model string | Provider + model ID |
| Deterministic routing | Yes (same manifest -> same model) | Yes (same task profile -> same model) |

---

## Recommendation: Replace, Complement, or Keep Both?

### Recommendation: COMPLEMENT

Neither system replaces the other. They operate at different abstraction levels and solve different problems.

**Conductor** is an orchestration-level system: it takes a plan, decomposes it, assigns models, generates rich work packages, tracks cross-module context, and integrates with OpenClaw's execution infrastructure.

**Our custom router** is a call-level system: it takes a task description, scores models across multiple dimensions, respects budget constraints, monitors provider health, and provides cost tracking.

### The Integration Architecture

```
                    PLAN (modules, contracts, waves)
                              |
                    [Conductor] — orchestration-level routing
                    |  assigns model per module
                    |  generates uppdragspaket
                    |  manages handoffs
                    |  creates checkpoints
                              |
                    UPPDRAGSPAKET (per-module work package)
                              |
                    [Our Router] — call-level routing
                    |  scores candidates with capabilities
                    |  applies budget constraints
                    |  monitors provider health
                    |  tracks cumulative cost
                    |  falls back when budget runs low
                              |
                    [Provider API] — actual model call
```

### How to Feed Our Intelligence INTO Conductor

1. **Inject capability awareness into Conductor's rules:**
   Use our ModelRegistry's capability data to generate Conductor routing rules. Instead of hardcoded domain tags, derive rules from model capabilities:
   ```typescript
   const rules = registry.list({ capability: "reasoning" })
     .map(model => ({
       match: { type: "domain", tags: ["architecture", "security"] },
       assign: `${model.provider}/${model.id}`,
       priority: 20,
     }));
   ```

2. **Use our scoring algorithm as a `before_model_resolve` hook:**
   OpenClaw's hook system includes `before_model_resolve`. Our TaskRouter's scoring algorithm can override Conductor's assignment when it finds a better candidate:
   ```typescript
   // Hook: before_model_resolve
   const conductorAssignment = event.model;
   const ourDecision = taskRouter.route(taskProfile);
   if (ourDecision.score > 0.8) {
     event.model = ourDecision.model.id;
   }
   ```

3. **Feed budget tracking into Conductor's routing:**
   Our Dispatcher's budget status can influence Conductor's model assignments. When budget is >75% consumed, downgrade Conductor's complexity thresholds to favor cheaper models.

4. **Provide health data to Conductor:**
   Our ModelRegistry's health monitoring can filter out unhealthy providers before Conductor assigns models. Use health data to dynamically disable providers in the routing config overrides.

### Migration Path

**Phase 1 (Now): Use Conductor as the orchestration layer**
- Configure Conductor's routing rules based on our domain knowledge
- Let Conductor handle module-level orchestration (uppdragspaket, handoffs, checkpoints)
- Keep our router for standalone, non-orchestrated calls (ad-hoc tasks, one-off completions)

**Phase 2 (Next): Bridge the systems**
- Create a `before_model_resolve` hook that applies our scoring algorithm as a secondary check
- Feed our budget tracking into Conductor's wave execution loop
- Use our health monitoring to dynamically update Conductor's provider availability

**Phase 3 (Future): Unified system**
- Extend Conductor's `ModelRoutingConfig` to include capability-based matching (contribute upstream?)
- Add budget-awareness to Conductor's rule evaluation
- Add provider health to Conductor's routing decisions
- Retire our standalone TaskRouter (keep ModelRegistry and Dispatcher for direct API access)

### What to Retire Now

- **task-router.ts quick-route defaults**: Replace with Conductor's domain-based routing rules. Conductor's approach (module manifest analysis) is superior to our static task-type defaults.
- **Model selection logic in wave-runner**: Replace with `routeAllModules()` from Conductor. Let Conductor handle the module-to-model mapping.

### What to Keep

- **model-registry.ts**: Conductor has no equivalent. Keep for capability tracking, health monitoring, and cost data.
- **dispatch.ts**: Conductor delegates actual API calls to the runtime adapter. Keep our Dispatcher for budget management, cost tracking, and the provider abstraction layer.
- **Scoring algorithm**: The multi-dimensional scoring is more sophisticated than Conductor's rule matching. Keep as a quality-improvement overlay via hooks.

---

## Summary Table

| Dimension | Conductor | Our Router | Winner |
|-----------|-----------|------------|--------|
| Orchestration scope | Module-level with waves | Per-call | Conductor |
| Context richness | Persona + skills + contracts + handoffs | None (caller responsibility) | Conductor |
| Cross-module context | Handoff extraction + discovery stream | None | Conductor |
| Crash recovery | Continuum checkpoints | None | Conductor |
| Model capability awareness | Domain tags only | 8-dimension capability model | Our Router |
| Scoring sophistication | Rule priority (first match) | 5-factor weighted scoring | Our Router |
| Budget management | None | Full (caps, alerts, fallback) | Our Router |
| Provider health | Delegated to OpenClaw | Active monitoring + scoring | Our Router |
| Cost tracking | None | Per-call and cumulative | Our Router |
| Quick ad-hoc routing | Requires full manifest | `quickRoute("architecture")` | Our Router |
| Runtime integration | OpenClaw native + Agent Teams | Provider abstraction layer | Tied |
| Production maturity | Tested, integrated into OpenClaw | Tested, standalone | Tied |

**Bottom line:** Use Conductor for orchestration, feed our intelligence into it via hooks and config, keep our router for direct API access and budget management. They are complementary, not competing.
