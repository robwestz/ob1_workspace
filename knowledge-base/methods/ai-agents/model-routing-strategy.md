# Model Routing Strategy — Method Guide

> Category: AI Agent Methods
> Last updated: 2026-04-05
> Applies to: OpenClaw Conductor, wave-runner, custom routing

---

## Purpose

This guide defines when to use which model, how to configure OpenClaw's Conductor for our workloads, and how to balance quality against cost. It covers both Conductor's built-in routing and our custom routing intelligence.

---

## When to Use Which Model

### Claude Opus 4.6 — The Architect

**Use for:**
- Architecture decisions (system design, module decomposition, API surface design)
- Security-critical code (auth, crypto, access control, input validation)
- Complex multi-step reasoning (debugging production issues, root cause analysis)
- Code review where correctness matters more than speed
- Planning and strategic decisions
- Anything where getting it wrong costs more than the model cost

**Avoid for:**
- Boilerplate generation
- Documentation formatting
- Simple CRUD operations
- Tasks where the output template is already defined

**Cost profile:** $15 input / $75 output per million tokens. A typical architecture session (100K input, 30K output) costs ~$3.75.

### Claude Sonnet 4.6 — The Workhorse

**Use for:**
- General code generation and modification
- Code review (non-security)
- Adapter and integration code
- Test writing
- Refactoring (when patterns are clear)
- API client generation
- Build configuration and CI/CD work

**Avoid for:**
- Architecture from scratch
- Security-sensitive modules
- Tasks requiring >200K context

**Cost profile:** $3 input / $15 output per million tokens. A typical coding session (50K input, 15K output) costs ~$0.38.

### Claude Haiku 4.5 — The Sprinter

**Use for:**
- Documentation generation and formatting
- Template application
- Config file generation
- Simple validation and linting tasks
- Status checks and summaries
- Commit message generation
- Changelog compilation

**Avoid for:**
- Anything requiring reasoning about code architecture
- Security analysis
- Complex refactoring

**Cost profile:** $0.80 input / $4 output per million tokens. A typical doc task (20K input, 8K output) costs ~$0.048.

### OpenAI Codex 5.3 — The Code Machine

**Use for:**
- Bulk code generation from specs
- Code completion and infill
- Repetitive code patterns across many files
- Test generation from function signatures
- Code translation between languages

**Avoid for:**
- Reasoning-heavy tasks
- Architecture decisions
- Tasks requiring deep context understanding

**Best pairing:** Use Opus to design the architecture and contracts, then Codex to implement the modules.

### Gemini 3 Pro — The Context Monster

**Use for:**
- Analyzing entire codebases (1M+ token context)
- Cross-file refactoring analysis
- Large document summarization
- Research tasks requiring broad context
- Comparing multiple large files

**Avoid for:**
- Precision coding (tool use less reliable than Claude)
- Security-critical analysis
- Tasks where smaller context suffices

**Cost profile:** Competitive pricing for the context window size. Most cost-effective for tasks that genuinely need >200K tokens of context.

---

## Configuring Conductor for Our Workloads

### Basic Configuration

Add to `openclaw.json` under a conductor key or use routing rules via the config system:

```json5
{
  // Conductor routing is configured via model routing rules
  // These integrate with agents.defaults.model and per-agent overrides
  agents: {
    defaults: {
      model: {
        primary: "anthropic/claude-sonnet-4-6",
        fallbacks: ["anthropic/claude-haiku-4-5"]
      }
    }
  }
}
```

### Recommended Routing Rules for Our Stack

```typescript
// Priority 30: Domain-specific overrides (highest)
{ match: { type: "domain", tags: ["security", "auth", "crypto"] }, assign: "anthropic/claude-opus-4-6", priority: 30 },
{ match: { type: "domain", tags: ["seo", "content", "crawl"] }, assign: "openai/codex-5-3", priority: 30 },

// Priority 25: Module-name pattern overrides
{ match: { type: "name", pattern: "*architecture*" }, assign: "anthropic/claude-opus-4-6", priority: 25 },
{ match: { type: "name", pattern: "*test*" }, assign: "anthropic/claude-sonnet-4-6", priority: 25 },
{ match: { type: "name", pattern: "*doc*" }, assign: "anthropic/claude-haiku-4-5", priority: 25 },
{ match: { type: "name", pattern: "*format*" }, assign: "anthropic/claude-haiku-4-5", priority: 25 },

// Priority 20: Domain complexity groups
{ match: { type: "domain", tags: ["orchestration", "conductor", "architecture", "pipeline"] }, assign: "anthropic/claude-opus-4-6", priority: 20 },
{ match: { type: "domain", tags: ["adapter", "handler", "builder"] }, assign: "anthropic/claude-sonnet-4-6", priority: 20 },

// Priority 10: Complexity-based defaults (lowest)
{ match: { type: "complexity", level: "high" }, assign: "anthropic/claude-opus-4-6", priority: 10 },
{ match: { type: "complexity", level: "medium" }, assign: "anthropic/claude-sonnet-4-6", priority: 10 },
{ match: { type: "complexity", level: "low" }, assign: "anthropic/claude-haiku-4-5", priority: 10 },
```

### Per-Module Overrides

For modules where automatic routing gets it wrong:

```typescript
overrides: {
  "payment-processor": "anthropic/claude-opus-4-6",    // Always Opus for payments
  "email-template-gen": "anthropic/claude-haiku-4-5",  // Always Haiku for templates
  "seo-content-engine": "openai/codex-5-3",            // Codex for bulk SEO content
}
```

---

## Budget Optimization Strategies

### Strategy 1: Tiered Budget Allocation

Allocate budget by task category:
- Architecture & Security: 30% of budget (Opus)
- Core Implementation: 50% of budget (Sonnet)
- Documentation & Formatting: 10% of budget (Haiku)
- Research & Analysis: 10% of budget (Gemini/Sonnet)

### Strategy 2: Wave-Based Budget Management

For wave-runner execution:
- **Wave 1** (infrastructure): Budget $5-10. Use Sonnet/Haiku. Foundation modules are well-defined.
- **Wave 2** (core logic): Budget $15-25. Use Opus for complex modules, Sonnet for medium. This is where quality matters most.
- **Wave 3** (integration): Budget $5-10. Use Sonnet. Integration code follows patterns established in Wave 2.
- **Wave 4** (testing/docs): Budget $3-5. Use Haiku for docs, Sonnet for test logic.

### Strategy 3: Cost Caps with Fallback

Our Dispatcher supports per-call and per-session budget caps. Configure:
```typescript
{
  budgetUsd: 50,                    // Session budget cap
  onBudgetAlert: (level) => {       // Alert at 50%, 75%, 90%, 100%
    if (level >= 90) {
      // Switch remaining tasks to cheaper models
    }
  }
}
```

When budget runs low, the Dispatcher automatically finds cheaper models that can still handle the task.

### Strategy 4: Caching and Deduplication

Reduce costs without reducing quality:
- Enable prompt caching (`contextPruning.mode: "cache-ttl"`)
- Use memory search to avoid re-researching known topics
- Batch similar operations into single model calls
- Use Haiku for pre-filtering before sending to Opus

---

## Quality vs Cost Tradeoffs

### The Real Cost of Cheap Models on Complex Tasks

Using Haiku for architecture decisions saves ~$3 per decision but risks:
- Incorrect module boundaries (cost to fix: 2-4 hours of rework = $30-60 of Opus time)
- Missing security implications (cost: potential vulnerability = priceless)
- Shallow reasoning (cost: downstream bugs caught late = 5-10x fix cost)

**Rule of thumb:** If the task output will be consumed by 3+ downstream tasks, use Opus. The cost is amortized.

### The Real Cost of Expensive Models on Simple Tasks

Using Opus for documentation generation wastes ~$3 per doc but:
- Quality difference is minimal for templated content
- Opus is slower (longer thinking time), delaying the pipeline
- Context window consumption is the same regardless of model

**Rule of thumb:** If the task has a clear template and well-defined input, use Haiku.

### Decision Matrix

| Task Characteristic | Model | Reasoning |
|---------------------|-------|-----------|
| Ambiguous requirements | Opus | Needs reasoning to clarify |
| Well-defined spec | Sonnet | Spec does the thinking |
| Template-based output | Haiku | Template does the thinking |
| Cross-module implications | Opus | Needs broad understanding |
| Single-file changes | Sonnet | Bounded scope |
| Bulk generation | Codex | Optimized for throughput |
| Large context analysis | Gemini | Context window advantage |
| User-facing quality | Opus | Worth the premium |
| Internal tooling | Sonnet | Good enough quality |
| Throwaway/experimental | Haiku | Minimize cost of exploration |

---

## Integration with Wave-Runner Per-Wave Model Selection

Wave-runner executes plans in waves (parallel groups). Model selection integrates at two levels:

### Level 1: Per-Plan Model Selection

Each PLAN.md can specify a model hint:
```markdown
## Model Hint
complexity: high
domain: architecture
```

Wave-runner passes this to Conductor, which applies routing rules.

### Level 2: Per-Wave Budget Control

Wave-runner can set a budget cap per wave:
- Wave starts with allocated budget
- Dispatcher tracks spending within the wave
- If budget is exceeded, remaining modules in the wave fall back to cheaper models
- Critical modules (marked with overrides) are exempt from fallback

### Level 3: Adaptive Routing

Based on results from earlier waves:
1. If Wave 1 modules all succeed with Sonnet, keep Sonnet for similar Wave 2 modules
2. If Wave 1 modules fail with Haiku, escalate similar Wave 2 modules to Sonnet
3. Track quality signals (acceptance criteria pass rate) to adjust future routing

### Implementation Pattern

```typescript
// In wave-runner's execution loop:
for (const wave of waves) {
  const assignments = routeAllModules(wave.modules, conductorConfig);
  
  for (const assignment of assignments) {
    const paket = buildUppdragspaket(
      assignment.manifest,
      assignment,
      handoffFromPreviousWave,
      relevantContracts,
    );
    
    const result = await adapter.launch(paket);
    // ... poll, collect, extract handoffs
  }
  
  // Checkpoint at wave boundary
  await adapter.checkpoint(wave.number, results);
}
```

---

## Configuration Checklist

1. Set default model to Sonnet (best cost/quality balance for general work)
2. Add domain routing rules for your specific workload categories
3. Set explicit overrides for security-critical and architecture modules
4. Configure budget caps at the session level
5. Enable prompt caching for context reuse
6. Configure model fallbacks for provider failures
7. Enable Continuum checkpoints for crash recovery during multi-wave execution
8. Set up the `before_model_resolve` hook if you need dynamic routing logic beyond rules
