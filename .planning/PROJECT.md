# OB1 Control — Autonomous IT Department Platform

## What This Is

An autonomous platform that turns Robin's Windows PC + MacBook Air M2 into a self-improving IT department. One SysAdmin agent identity with persistent memory, vision alignment, and the ability to orchestrate multi-model agent teams (Claude, Codex, Gemini) across 7.5+ hour overnight sessions. CLI for speed, web dashboard for oversight. Not a tool — a partner that problem-solves, delegates, evaluates, and improves its own systems.

## Core Value

The SysAdmin agent — a persistent identity that understands the vision, takes initiative, and runs purposeful 7.5-hour overnight sessions where every action traces back to a clear "why." Robin wakes up to work that makes him say "completely incredible that this is possible."

## Requirements

### Validated

- ✓ OB1 persistent memory via Supabase + pgvector — existing
- ✓ Wave-runner protocol (plan-execute-verify-fix-commit-assess) — existing
- ✓ Night runner with budget/time enforcement — existing
- ✓ 7 Edge Functions (47 API actions) — existing
- ✓ Agent-first harness with quality gates — existing
- ✓ Mac deployment workspace (7 waves, 28 AC) — existing
- ✓ Bacowr SaaS pipeline + worker — existing

### Active

- [ ] **SysAdmin agent identity** — persistent persona with memory, goals, vision context, and self-awareness of its own capabilities and gaps
- [ ] **Knowledge base system** — structured knowledge that agents consult: vision docs, architectural decisions, project states, customer context
- [ ] **Multi-model orchestration** — dispatch to Claude, Codex, Gemini based on task characteristics, token budgets, and provider capabilities
- [ ] **True 7.5h overnight sessions** — wave-runner integrated with multi-model dispatch, quality gates, and incremental morning reports
- [ ] **CLI (`ob1`)** — `ob1 status`, `ob1 night start`, `ob1 deploy`, `ob1 logs`, `ob1 projects list`, `ob1 report`
- [ ] **Web dashboard (localhost:4000)** — service health, agent monitoring, project overview, morning report viewer, budget tracking
- [ ] **Deploy pipeline** — push code from Windows, Mac auto-pulls + builds + restarts services
- [ ] **Agent initiative system** — agents identify improvements, test ideas, propose changes, not just execute assigned tasks
- [ ] **Self-improvement loop** — SysAdmin continuously improves its own tooling, harness, and operational baseline

### Out of Scope

- Multi-customer project management (15 parallel projects) — scale phase, not v1
- Stripe billing / customer-facing SaaS features for ob1-control itself — this is internal tooling
- GUI drag-and-drop project builder — v1 is CLI + monitoring dashboard
- Mobile app — desktop only
- Windows-native services (everything runs via SSH to Mac or via Supabase) — except the CLI + web dashboard

## Context

**Infrastructure:**
- Windows 11 PC (D:\OB1) — Robin's daily driver, development, Claude Code CLI
- MacBook Air M2 — dedicated agent host, connected via Tailscale mesh VPN
- Supabase — shared backend (PostgreSQL + pgvector + Edge Functions)
- OpenClaw — multi-channel AI gateway on Mac (WhatsApp, Telegram, Slack, Discord)
- Possibility of VM deployment instead of / in addition to Mac

**Existing code:**
- `theleak/implementation/runtime/` — agentic runtime with night-runner, wave-runner, coordinator, budget-tracker (TypeScript, 15 modules)
- `theleak/implementation/gui/` — Next.js dashboard already running on Mac :3000
- `theleak/implementation/functions/` — 7 Edge Functions, security-reviewed
- `projects/Bacowr-v6.3/` — SEO article SaaS, independent repo that lives within the platform
- `.harness/` — engineering harness at Level 2.0

**LLM access:**
- Claude via Anthropic account (CLI login — no extra token cost)
- Codex via OpenAI account (same model — gateway access)
- Gemini via Google account (same model)
- No per-token API billing — gateway subscription model

**Prior art:**
- Wave-runner protocol designed and implemented (`wave-runner.ts`, `long-session-protocol.md`)
- Night shift tested: 5 waves, 247 tests, 16 security fixes in one session
- Key learning: batch-and-done fails, iterative waves succeed

## Constraints

- **Multi-model**: Must support Claude, Codex, Gemini from start — different models for different tasks
- **Security**: Agents never push to production, change auth, or modify escalation boundaries without Robin's approval
- **Budget**: Runtime cost tracking per session — configurable limits, not hardcoded
- **Persistence**: All agent state, memory, and decisions must survive context resets and session boundaries
- **License**: FSL-1.1-MIT inherited from OB1 — no commercial derivative works
- **Platform**: Windows (CLI + dashboard) + Mac (agent execution) + Supabase (state) — must work across all three

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| CLI + web hybrid interface | CLI for speed (daily), web for oversight (monitoring) | — Pending |
| SysAdmin as primary agent identity | Single persistent partner > swarm of anonymous agents | — Pending |
| Multi-model from day one | Different models have different strengths; avoid vendor lock-in | — Pending |
| Wave protocol for overnight sessions | Proven in practice (5 waves, iterative, verified) > batch dispatch | ✓ Good |
| Mac as agent host, Windows as control plane | Separation of concerns: work where Robin is, execute where it's dedicated | — Pending |
| VM as potential alternative to Mac | Simpler local-disk access, but Mac already provisioned | — Pending |

---
*Last updated: 2026-04-08 after initialization*
