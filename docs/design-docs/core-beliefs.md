# Core Beliefs — Agent-First Operating Principles for OB1

These principles govern how code is written, reviewed, and shipped in OB1. They are not aspirational — they are constraints that agents and humans must follow.

---

## 1. Persistence Over Performance

**Everything persists to Supabase.** The local runtime is stateless. If it crashes, all state survives in the database. Session progress, agent memory, budget counters, task queues — none of it lives only in local memory.

**Rationale:** Agents get interrupted. Processes crash. Machines reboot. A system that loses state on failure is a system that cannot run autonomously overnight. Supabase is the single source of truth; the runtime is a disposable executor.

---

## 2. Repository-Local Is the Only Real

**If it is not in the repo, agents cannot see it.** Conventions, decisions, architecture, constraints — all must be encoded as files. Verbal agreements, Slack threads, and mental models do not exist to an agent.

**Rationale:** Every agent session starts fresh. There is no institutional memory except what is written down. CLAUDE.md, AGENTS.md, ARCHITECTURE.md, and docs/ are the agent's onboarding. If a rule is not in a file, it will be violated.

---

## 3. Prefer Boring Technology

**Supabase, PostgreSQL, pgvector, Deno, Node.js, Next.js, Python.** Technologies with broad training data that agents can work with reliably. No bleeding-edge frameworks. No clever abstractions that require human context to debug.

**Rationale:** Agent effectiveness is proportional to training data coverage. A well-documented, widely-used technology produces better agent output than a novel one. Boring technology also means more Stack Overflow answers, more examples, and fewer edge cases that confuse models.

---

## 4. Constraints Enable Speed

**Guard rails — no DROP TABLE, no local MCP, metadata.json required, no secrets in files — let agents ship faster than undefined boundaries.** An agent that knows exactly what it cannot do spends zero tokens deliberating about it.

**Rationale:** Undefined boundaries cause agents to ask clarifying questions, hedge their output, or make unsafe choices. Explicit constraints in CLAUDE.md and the automated review workflow eliminate entire categories of errors before they happen. The narrower the corridor, the faster the agent moves through it.

---

## 5. Budget Before Every Call

**Every LLM invocation must check budget — tokens, USD, turns.** Runaway agents are the number one operational risk. No call proceeds without confirming remaining budget.

**Rationale:** An unbudgeted agent loop can burn hundreds of dollars in minutes. Budget checks are not optional safety theater — they are the circuit breaker that makes autonomous operation possible. The agentic runtime enforces this at the SDK level: no budget, no call.

---

## 6. Contributions Are Self-Contained

**Each recipe, skill, extension, and integration is a standalone folder.** No cross-imports between community contributions. Copy-paste from the repo to a user's setup must work without resolving dependency chains.

**Rationale:** Community contributions come from different authors at different times. Cross-dependencies create fragile coupling that breaks when one contribution updates and another does not. Self-contained folders mean each contribution can be evaluated, installed, and removed independently.

---

## 7. Remote MCP, Always

**MCP servers are deployed as Supabase Edge Functions. Never local processes.** No `claude_desktop_config.json`, no `StdioServerTransport`, no local Node.js servers. Clients connect via URL.

**Rationale:** Local MCP servers tie the memory system to one machine. Remote Edge Functions mean the same memory is accessible from any device, any AI client, anywhere. This is the architectural decision that makes OB1 a platform instead of a local tool.

---

## 8. Verify, Then Ship

**Compiles? Tests pass? QA gate clears? Ship it.** Do not block on perfection. The automated review workflow in `.github/workflows/ob1-review.yml` defines the quality bar. If the PR passes automated checks and human review, it ships.

**Rationale:** Agents optimize for completeness and can over-polish indefinitely. A clear "done" definition — compiles, tests pass, review approved — prevents infinite refinement loops. Iteration after shipping is cheaper than perfection before shipping.
