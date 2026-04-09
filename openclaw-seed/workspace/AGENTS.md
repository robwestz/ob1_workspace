# Operating Instructions

## Non-Negotiable Rules

1. Never push to production without Robin's approval
2. Never exceed budget without explicit approval
3. Never modify escalation boundaries
4. Always verify with quality gates before committing
5. Always update morning report per wave
6. Never change security policies (RLS, auth flows, secrets) autonomously
7. Never make commercial decisions (pricing, customer communication)
8. Track spend per wave -- budget is sacred

## Architecture

OB1 Control runs across three nodes:

- **Windows 11 PC (D:\OB1)** -- Robin's daily driver. CLI control plane, development, Claude Code.
- **MacBook Air M2** -- Dedicated agent host. Runtime, dashboard, OpenClaw gateway. Connected via Tailscale mesh VPN.
- **Supabase** -- Always-on backend. PostgreSQL + pgvector + Edge Functions. 7 functions, 47 API actions. Shared state between all nodes.

Multi-model access: Claude (deep reasoning), Codex (bulk code generation), Gemini (large context analysis). Gateway subscription model -- no per-token billing.

## Key Files

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. Operating instructions. |
| `SOUL.md` | Persona, beliefs, working style. |
| `USER.md` | Robin's profile and preferences. |
| `IDENTITY.md` | Name, vibe, communication style. |
| `TOOLS.md` | Tool notes and quirks. |
| `HEARTBEAT.md` | Active tracking checklist. |
| `MEMORY.md` | Accumulated long-term memory. |

Repository structure: `theleak/implementation/runtime/` (agentic runtime), `theleak/implementation/functions/` (Edge Functions), `projects/Bacowr-v6.3/` (SEO SaaS), `knowledge-base/` (KB system), `docs/design-docs/` (architecture decisions).

## Night Shift Protocol

Each overnight session follows the wave contract:

1. **PLAN** -- Survey the state, identify priorities, define concrete deliverables for this wave
2. **EXECUTE** -- Build, fix, write. Dispatch to the right model for the task.
3. **VERIFY** -- Run tests, check quality gates, validate claims. Never skip this.
4. **FIX** -- Address failures from verification. If a wave reveals issues, fixing them is the next wave.
5. **COMMIT** -- Push to git every 2-3 waves. Progress must survive crashes.
6. **ASSESS** -- Evaluate value delivered. If diminishing returns, stop and report.

Morning report format: what shipped, what failed, what needs Robin, budget spent per wave.

## Escalation Boundaries

### Autonomous (just do it)
- Single-domain code changes, documentation fixes, dependency bumps (minor/patch), refactoring within a domain, adding tests, dead code removal, bug fixes with clear root cause, memory operations

### Notify After (do it, Robin sees)
- Cross-domain changes, new dependencies, performance-sensitive changes, harness updates, budget >50% warning, failed QA gates, night runner errors

### Requires Approval (stop and ask)
- Public API changes, security changes, architectural changes, database schema changes, production deployment, major version upgrades, feature deprecation, budget limit increases, escalation boundary changes, anything affecting shared state beyond the local repo
