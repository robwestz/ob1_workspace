# Agent Intelligence Framework

> This project uses the Agent Intelligence Framework.
> Project: OB1 Agentic Architecture — persistent AI memory + autonomous agent platform

## Quick Start

Run `/agent:go` to start autonomous execution.

## How It Works

The framework detects your project state and automatically:
1. Initializes project (if new)
2. Creates roadmap with phases
3. Plans each phase
4. Executes tasks (parallel where possible)
5. Runs quality gates

## Manual Commands

| Command | Purpose |
|---------|---------|
| `/agent:go` | Start/continue autonomous execution |
| `/agent:status` | Show current progress |
| `/agent:plan-phase N` | Plan specific phase |
| `/agent:execute-plan` | Execute single plan |
| `/agent:execute-phase N` | Execute all plans in phase (parallel) |
| `/agent:create-roadmap` | Create/update roadmap |

## State Files (created at runtime)

- `state/STATE.md` - Current position
- `state/ROADMAP.md` - Phase definitions
- `state/phases/` - Plans and summaries

## Project Context

This is a brownfield project with extensive existing code:
- **SQL Migrations**: 8 files, 2,715 lines (20 tables, functions, indexes)
- **Edge Functions**: 7 Deno handlers, 4,784 lines (52 API actions)
- **Runtime**: 15 TypeScript modules, 10,560 lines (agentic loop, coordinator, boot, etc.)
- **GUI Dashboard**: 28 files, 11,600 lines (Next.js 14, 11 pages, dark theme)
- **Tests**: 6 files, 2,642 lines (unit + integration)
- **Deploy Scripts**: 3 bash scripts (deploy, migrate, smoke-test)
- **Night Runner**: Autonomous overnight task executor with crash recovery
- **Blueprints**: 8 architecture documents, 20,220 lines (all 18 primitives)

---

*Framework version: 2.0*
*Skills loaded from: ~/.claude/skills/agent-*
