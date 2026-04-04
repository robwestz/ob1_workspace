# AGENTS.md — Agent Routing Table

Open Brain (OB1) is a persistent AI memory system: one Supabase database with pgvector, one MCP protocol, any AI client. This repo contains the community ecosystem (extensions, recipes, skills) and the agentic runtime platform.

## Non-Negotiable Rules

1. **Never modify the core `thoughts` table structure.** Adding columns is fine; altering or dropping existing ones is not.
2. **No credentials, API keys, or secrets in any file.** Use environment variables.
3. **MCP servers must be remote (Supabase Edge Functions), not local.** No `claude_desktop_config.json`, no `StdioServerTransport`, no local Node.js servers.
4. **Every contribution must include `README.md` + `metadata.json`** in its own subfolder.
5. **No `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, or unqualified `DELETE FROM`** in SQL files.

## Repository Map

| What | Where |
|------|-------|
| Architecture & domain map | `ARCHITECTURE.md` |
| Setup guide | `docs/01-getting-started.md` |
| Contribution rules | `CONTRIBUTING.md` |
| Agent harness files | `.harness/` (if present) |
| Agentic runtime blueprints | `theleak/blueprints/` |
| Design principles | `docs/design-docs/core-beliefs.md` |
| Automated PR review | `.github/workflows/ob1-gate.yml` |
| Metadata schema | `.github/metadata.schema.json` |
| License | `LICENSE.md` (FSL-1.1-MIT) |

## Tech Stack

Supabase (PostgreSQL + pgvector) for persistence and auth. Deno for the MCP server (`server/index.ts`). TypeScript for the agentic runtime (`theleak/implementation/runtime/`) and Edge Functions (`theleak/implementation/functions/`). Python for Bacowr SEO pipeline (`projects/Bacowr-v6.3/`). Next.js for the dashboard GUI (`theleak/implementation/gui/`).

## Verification Commands

```bash
# Runtime compiles
cd theleak/implementation/runtime && npx tsc --noEmit

# GUI builds
cd theleak/implementation/gui && npx next build

# Bacowr tests
cd projects/Bacowr-v6.3 && python -m pytest tests/
```

## Code Organization (7 Domains)

| Domain | Path | Purpose |
|--------|------|---------|
| core-memory | `server/`, `docs/01-*`, `schemas/` | MCP server, setup guides, database extensions |
| curriculum | `extensions/`, `primitives/` | Curated learning path (6 builds) and reusable concept guides |
| community | `recipes/`, `skills/`, `dashboards/`, `integrations/` | Open community contributions |
| agentic-runtime | `theleak/implementation/runtime/` | CLI: boot, doctor, run, resume, status, sessions, budget, tools, agents, memory |
| platform-api | `theleak/implementation/functions/`, `theleak/implementation/sql/` | 7 Edge Functions (52 API actions), 20 database tables |
| dashboard | `theleak/implementation/gui/` | Next.js dashboard (12 pages) |
| bacowr | `projects/Bacowr-v6.3/` | SEO article SaaS (Python pipeline + FastAPI worker) |

See `ARCHITECTURE.md` for domain dependencies, cross-cutting concerns, and where new code goes.
