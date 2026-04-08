# OB1 Control — Roadmap

## Vision

OB1 Control is an autonomous platform that turns Robin's Windows PC and MacBook Air M2 into a self-improving IT department. A single SysAdmin agent identity with persistent memory, vision alignment, and multi-model orchestration (Claude, Codex, Gemini) runs purposeful 7.5+ hour overnight sessions using the proven wave protocol. CLI for speed, web dashboard for oversight. Not a tool — a partner that problem-solves, delegates, evaluates, and continuously improves its own systems.

---

## Phases

### Phase 1: Foundation — SysAdmin Identity & Knowledge Base

The SysAdmin is the core agent persona that persists across all sessions. This phase establishes who the agent is, what it knows, and how it remembers. Without identity persistence, every session starts from zero. Without a knowledge base, every decision is uninformed.

**Dependencies:** None (foundation phase)

#### Plans:

1. **SysAdmin Persona Definition** — Create the system prompt, personality traits, communication style, and vision context document that defines the SysAdmin agent identity. Includes role boundaries (what it owns vs. what Robin owns) and self-awareness of its own capabilities and gaps.
   - Task 1: Draft `SysAdmin.persona.md` covering identity, goals, communication style, and decision heuristics
   - Task 2: Create the system prompt template that loads persona + session context into any model
   - Task 3: Write integration tests that verify persona loading and consistency across model providers

2. **Persistent Memory Schema** — Design and deploy the Supabase tables that store agent identity state: goals, decisions, learnings, session history, and self-assessments. Builds on existing OB1 `thoughts` table without modifying it.
   - Task 1: Design schema for `agent_identity`, `agent_decisions`, and `agent_learnings` tables with proper RLS policies
   - Task 2: Create migration SQL and deploy to Supabase
   - Task 3: Build TypeScript read/write functions for identity persistence (store/recall/update)

3. **Knowledge Base System** — Build the structured document store that agents consult before making decisions: vision docs, architectural decisions, project states, customer context, and operational runbooks.
   - Task 1: Define knowledge base schema (categories, versioning, relevance scoring) and Supabase table
   - Task 2: Seed initial knowledge base with PROJECT.md, ARCHITECTURE.md, escalation boundaries, and existing design docs
   - Task 3: Create query API that retrieves relevant knowledge by topic, with embedding-based similarity search

4. **Identity Continuity Protocol** — Ensure the SysAdmin identity survives context resets, session boundaries, and model switches. When a new session starts, the agent loads its identity, recent decisions, and current priorities.
   - Task 1: Build session-start bootstrap that loads persona + recent memory + active goals
   - Task 2: Build session-end snapshot that persists decisions, learnings, and state
   - Task 3: Write end-to-end test: start session, make decisions, end session, start new session, verify continuity

**Acceptance Criteria:**
- SysAdmin persona loads consistently across Claude, Codex, and Gemini prompts
- Agent state survives a full context reset and restores within 5 seconds
- Knowledge base returns relevant docs for architecture, vision, and operational queries

**Estimated Execution Time:** 6-8 Claude agent hours

---

### Phase 2: Multi-Model Gateway

Different models excel at different tasks. Claude is strong at reasoning and architecture, Codex at code generation, Gemini at large-context analysis. This phase builds the abstraction layer that routes tasks to the right model with unified input/output regardless of provider.

**Dependencies:** Phase 1 (persona must load into any model)

#### Plans:

1. **Model Registry** — Create a configuration-driven registry of available models with their capabilities, cost profiles, context limits, and rate limits. Supports Claude (Anthropic), Codex (OpenAI), and Gemini (Google).
   - Task 1: Define `ModelProvider` type and `ModelCapability` enum (reasoning, code_generation, large_context, vision, etc.)
   - Task 2: Build registry with CRUD operations, stored in Supabase for dynamic updates
   - Task 3: Implement health check per provider (ping endpoint, verify auth, report latency)

2. **Task-to-Model Router** — Build the routing logic that selects the optimal model for a given task based on task type, required capabilities, budget constraints, and current provider health.
   - Task 1: Define `TaskProfile` interface (type, complexity, context_size, budget, required_capabilities)
   - Task 2: Implement scoring algorithm: match task profile against model capabilities with cost weighting
   - Task 3: Add fallback logic: if primary model is unavailable or over-budget, route to next-best

3. **Provider Abstraction Layer** — Unified API that wraps Claude, Codex, and Gemini behind a single interface. Callers send a prompt and get a response without knowing which model handled it.
   - Task 1: Define `UnifiedLLMRequest` and `UnifiedLLMResponse` interfaces with common fields
   - Task 2: Implement provider adapters for Claude API, OpenAI API, and Gemini API
   - Task 3: Add request/response logging, token counting, and cost tracking per call

4. **Budget-Aware Dispatch** — Integrate the existing budget-tracker with multi-model dispatch so every LLM call is tracked against session and task budgets, with auto-stop on threshold.
   - Task 1: Connect provider abstraction to `budget-tracker.ts` for per-call cost recording
   - Task 2: Implement pre-call budget check (reject if remaining budget < estimated cost)
   - Task 3: Add budget alerts at 50%, 75%, 90% thresholds with configurable actions (warn, throttle, stop)

**Acceptance Criteria:**
- A task can be dispatched to any of 3 models via a single API call
- Router correctly selects cheaper models for simple tasks and stronger models for complex ones
- Budget tracking reports accurate cost per model, per task, per session

**Estimated Execution Time:** 8-10 Claude agent hours

---

### Phase 3: CLI Foundation (`ob1`)

The CLI is Robin's daily interface — fast, scriptable, and always available from the Windows terminal. This phase builds the scaffold and the first essential commands: checking service health and streaming logs.

**Dependencies:** Phase 1 (identity for `ob1 status` persona context), Phase 2 (model registry for health checks)

#### Plans:

1. **CLI Scaffold** — Set up the `ob1` CLI with commander.js, TypeScript compilation, global install via npm link, and a plugin architecture for adding commands.
   - Task 1: Initialize npm package with commander.js, TypeScript config, and build pipeline
   - Task 2: Create command registration pattern (each command is a self-contained module)
   - Task 3: Add global configuration file (`~/.ob1/config.json`) for Supabase URL, Tailscale IP, SSH key path

2. **`ob1 status` — Service Health Check** — Single command that reports the health of all OB1 services: Supabase (API + DB), Mac agent host (SSH + services), Edge Functions, and dashboard.
   - Task 1: Implement Supabase health check (ping API, verify auth, check Edge Function endpoints)
   - Task 2: Implement Mac health check via Tailscale SSH (ping, check launchd services, disk space, memory)
   - Task 3: Format output as a clean table with green/red status indicators and response times

3. **`ob1 logs` — Stream Logs from Mac** — Real-time log streaming from the Mac agent host via Tailscale SSH, with filtering by service, log level, and time range.
   - Task 1: Implement SSH connection to Mac via Tailscale with persistent session
   - Task 2: Add log source selection (night-runner, wave-runner, dashboard, OpenClaw, system)
   - Task 3: Add filtering flags: `--service`, `--level`, `--since`, `--follow`, and formatted output

4. **`ob1 projects list` — Project Overview** — List all active projects with their current status, last activity, and health metrics pulled from Supabase.
   - Task 1: Query Supabase for active projects with status, last session, and key metrics
   - Task 2: Format as table with project name, status, last activity, health score
   - Task 3: Add `--verbose` flag for detailed view with recent agent decisions and blockers

**Acceptance Criteria:**
- `ob1 status` returns health for all services in under 5 seconds
- `ob1 logs --follow` streams real-time logs from the Mac without disconnecting
- CLI installs globally and is callable from any Windows terminal path

**Estimated Execution Time:** 6-8 Claude agent hours

---

### Phase 4: Wave Runner Integration

The wave-runner protocol is proven but currently human-orchestrated. This phase wires it into the multi-model dispatch layer so waves execute autonomously with real quality gates and incremental morning reports.

**Dependencies:** Phase 2 (multi-model dispatch for task execution), Phase 3 (CLI for `ob1 night start`)

#### Plans:

1. **Multi-Model Wave Execution** — Connect `wave-runner.ts` to the provider abstraction layer so each wave task can be dispatched to the optimal model based on task type.
   - Task 1: Refactor `WaveTask` execution to use the task-to-model router instead of hardcoded provider
   - Task 2: Add model selection metadata to wave results (which model, why, cost, latency)
   - Task 3: Test a 3-wave session where different tasks route to different models

2. **Quality Gates That Run** — Replace placeholder quality gates with real verification commands: `tsc --noEmit`, `npm test`, `next build`, lint checks, and file size limits.
   - Task 1: Implement `QualityGateRunner` class that executes gate commands via child_process with timeout
   - Task 2: Wire gates into the wave verify step: all required gates must pass before commit
   - Task 3: Add gate result reporting (pass/fail/skip with output capture) to wave results

3. **Incremental Morning Report** — Morning report file is updated after every wave, not just at session end. If the session crashes at wave 4, Robin has waves 1-3 documented.
   - Task 1: Define morning report markdown template with per-wave sections
   - Task 2: Implement `updateMorningReport()` that appends the latest wave results to the report file
   - Task 3: Add summary section that auto-updates with totals (waves completed, tests added, budget spent, open items)

4. **`ob1 night start` Command** — CLI command that initiates an overnight session with a session contract, starts the wave runner, and returns immediately (background process on Mac).
   - Task 1: Implement session contract YAML parser and validator
   - Task 2: Build SSH-based remote execution: push contract to Mac, start wave-runner as background process
   - Task 3: Add `ob1 night status` to check running session progress and `ob1 night stop` for graceful shutdown

**Acceptance Criteria:**
- A 3-wave overnight session completes autonomously with verified quality gates
- Morning report is readable and accurate after any wave, even if session crashes
- `ob1 night start` launches a session and `ob1 night status` reports progress

**Estimated Execution Time:** 10-12 Claude agent hours

---

### Phase 5: True Overnight Sessions

The leap from "runs a few waves" to "runs 7.5 hours reliably." This phase adds session contracts, crash recovery, budget enforcement across long durations, and the self-direction intelligence that makes ASSESS meaningful.

**Dependencies:** Phase 4 (wave runner must work end-to-end first)

#### Plans:

1. **Session Contract System** — Formalize the pre-sleep agreement between Robin and the SysAdmin: goals, budget, boundaries, stop conditions, and approval queues. Stored in Supabase for durability.
   - Task 1: Define `SessionContract` Supabase schema with status tracking (draft, active, completed, aborted)
   - Task 2: Build contract negotiation flow: Robin specifies goals, agent proposes wave plan, Robin approves
   - Task 3: Implement contract enforcement: goals checked per wave, boundaries enforced, stop conditions monitored

2. **Crash Recovery & Checkpoint Resume** — If the Mac reboots, the process dies, or the network drops, the session resumes from the last committed wave. No work is lost, no wave is repeated.
   - Task 1: Implement session state persistence to Supabase after every wave (current wave, completed waves, remaining budget)
   - Task 2: Build resume logic: on startup, check for interrupted sessions, load state, continue from last checkpoint
   - Task 3: Add crash detection (heartbeat to Supabase every 60s, stale heartbeat = crashed) and auto-restart via launchd

3. **Self-Direction Engine** — The ASSESS step becomes intelligent: the agent analyzes wave results, applies heuristics from `long-session-protocol.md`, and selects the highest-value next wave autonomously.
   - Task 1: Implement the 6 self-direction heuristics as scorable rules (fix broken, deepen before broaden, etc.)
   - Task 2: Build wave proposal generator: given completed waves + remaining goals, propose and rank next waves
   - Task 3: Add diminishing returns detection: if 3 consecutive waves score below threshold, stop gracefully

4. **7.5-Hour Stress Test** — Run a real overnight session with production goals and verify reliability, budget accuracy, and output quality.
   - Task 1: Design a 7.5h session contract with realistic goals (test coverage, security review, documentation)
   - Task 2: Execute the session, monitoring for hangs, crashes, budget drift, and quality gate failures
   - Task 3: Post-mortem analysis: compare expected vs. actual output, identify failure modes, fix top 3 issues

**Acceptance Criteria:**
- A session runs for 7.5 hours across 8+ waves without human intervention
- Crash recovery resumes within 2 minutes of restart with zero repeated work
- Self-direction engine selects waves that are demonstrably higher-value than random ordering

**Estimated Execution Time:** 12-15 Claude agent hours

---

### Phase 6: Deploy Pipeline

Code written on Windows must reach the Mac execution environment reliably. This phase automates the full deploy cycle: push, pull, build, restart, verify, and rollback on failure.

**Dependencies:** Phase 3 (CLI foundation for `ob1 deploy`), Phase 4 (quality gates for pre-deploy checks)

#### Plans:

1. **`ob1 deploy` Command** — Git push from Windows triggers the Mac to pull, build, and restart affected services. Single command, full deploy.
   - Task 1: Implement `ob1 deploy` that pushes current branch to remote and triggers Mac-side pull via SSH
   - Task 2: Add pre-deploy checks: all quality gates must pass locally before push is allowed
   - Task 3: Add deploy confirmation with diff summary and affected services list

2. **Service Restart Automation** — After code is pulled on the Mac, identify which services are affected and restart them via launchd. Only restart what changed.
   - Task 1: Build service-to-directory mapping (which launchd service watches which code paths)
   - Task 2: Implement selective restart: diff changed files against service map, restart only affected services
   - Task 3: Add post-restart health check: verify each restarted service responds correctly within 30 seconds

3. **Rollback on Failed Deploy** — If the build fails or services don't start after deploy, automatically roll back to the previous working commit and restore services.
   - Task 1: Before deploy, snapshot the current commit SHA and service states
   - Task 2: If post-deploy health checks fail, git reset to snapshot SHA and restart services
   - Task 3: Send failure report to Robin (via OB1 thought with "deploy-failure" tag) with error details and rollback confirmation

**Acceptance Criteria:**
- `ob1 deploy` completes a full cycle (push, pull, build, restart, verify) in under 2 minutes
- Failed deploys automatically roll back with zero downtime
- Deploy history is queryable via `ob1 deploy history`

**Estimated Execution Time:** 6-8 Claude agent hours

---

### Phase 7: Web Dashboard

The dashboard provides visual oversight that the CLI cannot: timelines, charts, live monitoring, and the morning report in a readable format. Built on the existing Next.js dashboard at `theleak/implementation/gui/`.

**Dependencies:** Phase 3 (CLI provides the data APIs), Phase 4 (wave data for timeline), Phase 5 (session data for monitoring)

#### Plans:

1. **Service Monitoring Panel** — Real-time health status of all OB1 services with uptime history, response times, and alert indicators. The visual equivalent of `ob1 status`.
   - Task 1: Create `/monitoring` page with service cards showing status, uptime percentage, and latency graph
   - Task 2: Add WebSocket connection for real-time status updates (no polling)
   - Task 3: Implement alert history timeline showing when services went up/down

2. **Morning Report Viewer** — Rich rendering of overnight session reports with wave-by-wave details, verification results, and actionable next steps. Robin's first screen with coffee.
   - Task 1: Create `/reports` page that lists all morning reports by date with summary cards
   - Task 2: Build report detail view with expandable wave sections, code diffs, and test results
   - Task 3: Add "approve" / "flag" / "discuss" actions on each wave so Robin can respond inline

3. **Agent Activity Timeline** — Chronological view of all agent actions: wave starts, task dispatches, model selections, quality gate results, commits, and decisions.
   - Task 1: Create `/activity` page with filterable timeline (by agent, model, action type, date range)
   - Task 2: Add cost overlay: show cumulative spend as a line chart alongside activity events
   - Task 3: Implement drill-down: clicking an activity event shows full context (prompt, response, duration, cost)

4. **Project Overview Page** — Dashboard landing page showing all active projects, their health, recent activity, and current priorities. The command center view.
   - Task 1: Create `/` landing page with project cards showing status, health score, and last activity
   - Task 2: Add quick-action buttons: start night session, view latest report, check deploy status
   - Task 3: Implement project detail view with sessions history, agent decisions, and backlog items

**Acceptance Criteria:**
- Dashboard loads at `localhost:4000` with real data from Supabase
- Morning report is readable and actionable within 30 seconds of opening
- Activity timeline shows all agent actions with accurate cost data

**Estimated Execution Time:** 10-12 Claude agent hours

---

### Phase 8: Agent Initiative System

Agents stop being purely reactive and start discovering improvements autonomously. The SysAdmin notices patterns, identifies opportunities, and proposes changes through a structured propose-test-report cycle.

**Dependencies:** Phase 5 (self-direction engine provides the assessment framework), Phase 1 (knowledge base stores discoveries)

#### Plans:

1. **Opportunity Discovery** — Agents scan codebases, logs, test results, and performance data to identify improvement opportunities: missing tests, dead code, performance bottlenecks, security gaps.
   - Task 1: Build scanner modules: test coverage gaps, unused exports, slow queries, outdated dependencies
   - Task 2: Implement opportunity scoring: impact (high/medium/low) x effort (hours) x risk (safe/risky)
   - Task 3: Store discovered opportunities in Supabase with deduplication and priority ranking

2. **Propose-Test-Report Cycle** — When an agent finds an opportunity, it proposes a fix, tests it in isolation, and reports results for Robin's review. Never ships without approval.
   - Task 1: Build proposal generator: given an opportunity, create a plan with expected outcome and risk assessment
   - Task 2: Implement isolated testing: branch, apply fix, run quality gates, report results without merging
   - Task 3: Create proposal review queue in Supabase with approve/reject/defer actions

3. **Initiative Backlog** — Maintain a living backlog of agent-discovered opportunities, organized by project, priority, and status. Feeds into overnight session planning.
   - Task 1: Build backlog data model with status lifecycle (discovered, proposed, approved, executed, verified)
   - Task 2: Create `ob1 backlog` CLI command to list, filter, and prioritize backlog items
   - Task 3: Wire backlog into session contract: approved backlog items become candidate goals for overnight sessions

4. **Initiative Quality Metrics** — Track which agent-initiated improvements actually ship and deliver value. Feedback loop that improves future initiative quality.
   - Task 1: Track proposal acceptance rate, execution success rate, and value delivered per initiative
   - Task 2: Use metrics to tune opportunity scoring (down-rank patterns that get rejected)
   - Task 3: Monthly initiative summary in morning report format

**Acceptance Criteria:**
- Agent discovers at least 5 real improvement opportunities per overnight session
- Propose-test-report cycle completes without human intervention (human only reviews results)
- Backlog items integrate into overnight session planning

**Estimated Execution Time:** 8-10 Claude agent hours

---

### Phase 9: Self-Improvement Loop

The SysAdmin doesn't just run tasks — it improves the system it runs on. Better harness rules, smarter quality gates, cleaner GC sweeps, and continuously refined tooling. The platform gets better every night.

**Dependencies:** Phase 8 (initiative system provides the discovery-and-propose mechanism), Phase 5 (overnight sessions provide execution time)

#### Plans:

1. **Tooling Self-Improvement** — The SysAdmin identifies gaps in its own tooling and writes improvements: new CLI commands, better error messages, faster health checks, smarter defaults.
   - Task 1: Build self-assessment module: after each session, score tooling friction points (slow commands, missing features, confusing output)
   - Task 2: Implement auto-proposal for tooling fixes (follows propose-test-report cycle from Phase 8)
   - Task 3: Track tooling improvement velocity: how many self-proposed improvements ship per week

2. **Harness Quality Auto-Update** — Quality gate configurations, lint rules, and test thresholds evolve based on project maturity. As code stabilizes, standards tighten automatically.
   - Task 1: Build maturity detector: analyze test coverage trends, error rates, and code churn to assess project maturity
   - Task 2: Implement graduated quality profiles (bootstrap, developing, stable, hardened) with appropriate gate configs
   - Task 3: Auto-propose quality level upgrades when metrics meet thresholds (requires Robin's approval per escalation boundaries)

3. **Automated GC Sweeps** — Dead code removal, duplicate detection, stale branch cleanup, and dependency pruning run automatically during low-priority overnight waves.
   - Task 1: Build GC scanner: unused exports, unreferenced files, stale git branches, unused dependencies
   - Task 2: Implement safe removal with rollback: delete in a branch, run all tests, report what was cleaned
   - Task 3: Schedule GC as a low-priority wave type that runs when higher-value work is exhausted

4. **Learning Accumulation** — Every session's ASSESS step feeds back into the knowledge base. The agent gets smarter about what works, what fails, and what to try next.
   - Task 1: Build learning extractor: parse wave results for reusable patterns (what worked, what failed, why)
   - Task 2: Store learnings as searchable knowledge base entries tagged by domain, project, and technique
   - Task 3: Surface relevant past learnings during PLAN step of future waves

**Acceptance Criteria:**
- At least one self-proposed improvement ships per week without Robin's prompting
- Quality gates auto-adjust based on project maturity with proper approval flow
- GC sweeps remove measurable dead code without breaking any tests

**Estimated Execution Time:** 10-12 Claude agent hours

---

### Phase 10: Integration & Hardening

Everything works individually — now make it work together reliably. End-to-end testing across the full stack (Windows CLI, Mac execution, Supabase state), security review, and performance benchmarking.

**Dependencies:** All previous phases (this is the integration phase)

#### Plans:

1. **End-to-End Test Suite** — Tests that exercise the full path: CLI command on Windows triggers execution on Mac, results stored in Supabase, rendered on dashboard.
   - Task 1: Build E2E test harness that automates CLI commands and verifies Supabase state changes
   - Task 2: Write critical path tests: deploy, night session start/stop, report generation, status check
   - Task 3: Add network failure simulation: Tailscale disconnect, Supabase timeout, Mac reboot mid-session

2. **Security Review** — Audit multi-model dispatch for prompt injection, credential leakage, and escalation boundary violations. Verify RLS policies on all new tables.
   - Task 1: Review all LLM prompts for injection vulnerabilities (user content in system prompts, etc.)
   - Task 2: Audit credential handling: verify no secrets in logs, Supabase responses, or morning reports
   - Task 3: Test escalation boundaries: verify agents cannot perform "requires_approval" actions without Robin's OK

3. **Performance Benchmarking** — Measure and optimize: session startup time, wave transition latency, quality gate execution time, dashboard load time, and CLI response time.
   - Task 1: Build benchmark suite with reproducible measurements for all critical paths
   - Task 2: Establish baseline metrics and set performance budgets (e.g., CLI < 2s, dashboard < 3s, wave transition < 30s)
   - Task 3: Optimize top 3 bottlenecks identified by benchmarks

4. **Operational Runbook** — Document the procedures for common operational scenarios: service recovery, budget overrun, stuck sessions, failed deploys, and new model onboarding.
   - Task 1: Write runbook entries for the 10 most likely operational incidents
   - Task 2: Add runbook to knowledge base so the SysAdmin can self-serve during overnight sessions
   - Task 3: Test each runbook entry by simulating the incident and following the procedure

**Acceptance Criteria:**
- E2E tests pass for all critical paths across Windows, Mac, and Supabase
- Security audit finds zero high-severity issues in multi-model dispatch
- All performance metrics meet established budgets

**Estimated Execution Time:** 10-14 Claude agent hours

---

## Summary

| Phase | Name | Plans | Dependencies | Est. Hours |
|-------|------|-------|-------------|-----------|
| 1 | SysAdmin Identity & Knowledge Base | 4 | None | 6-8 |
| 2 | Multi-Model Gateway | 4 | Phase 1 | 8-10 |
| 3 | CLI Foundation (`ob1`) | 4 | Phases 1, 2 | 6-8 |
| 4 | Wave Runner Integration | 4 | Phases 2, 3 | 10-12 |
| 5 | True Overnight Sessions | 4 | Phase 4 | 12-15 |
| 6 | Deploy Pipeline | 3 | Phases 3, 4 | 6-8 |
| 7 | Web Dashboard | 4 | Phases 3, 4, 5 | 10-12 |
| 8 | Agent Initiative System | 4 | Phases 1, 5 | 8-10 |
| 9 | Self-Improvement Loop | 4 | Phases 5, 8 | 10-12 |
| 10 | Integration & Hardening | 4 | All previous | 10-14 |
| | **Total** | **39** | | **87-109** |

## Execution Order

Phases can overlap where dependencies allow. The critical path is:

```
Phase 1 ──> Phase 2 ──> Phase 3 ──> Phase 4 ──> Phase 5 ──> Phase 10
                                 \─> Phase 6 ─────────────/
                                         Phase 5 ──> Phase 7
                                         Phase 5 ──> Phase 8 ──> Phase 9
```

Phases 6, 7, 8, and 9 can execute in parallel once their dependencies are met. Phase 10 is the integration gate that requires everything else to be complete.

---

*Generated: 2026-04-05 | Source: PROJECT.md, ARCHITECTURE.md, long-session-protocol.md, escalation-boundaries.md*
