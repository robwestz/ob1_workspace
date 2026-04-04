# ARCHITECTURE.md — Domain Map & Dependency Rules

## Philosophy

OB1 separates persistent state (Supabase) from stateless compute (Deno, Edge Functions, CLI). Community contributions are self-contained folders with no cross-imports. The agentic runtime and platform API form the execution layer; everything else is content that plugs into it.

## Domain Map

| # | Domain | Path | Description | Key Dependencies |
|---|--------|------|-------------|------------------|
| 1 | core-memory | `server/`, `docs/01-*`, `schemas/` | MCP server and database extensions | Supabase, pgvector, Deno |
| 2 | curriculum | `extensions/`, `primitives/` | Curated 6-build learning path + reusable concept guides | core-memory (Supabase) |
| 3 | community | `recipes/`, `skills/`, `dashboards/`, `integrations/` | Open community contributions (22 recipes, 11 skills, 3 dashboards, 4 integrations) | core-memory (Supabase) |
| 4 | agentic-runtime | `theleak/implementation/runtime/` | CLI runtime: boot, doctor, run, resume, status, sessions, budget, tools, agents, memory | platform-api, core-memory |
| 5 | platform-api | `theleak/implementation/functions/`, `theleak/implementation/sql/` | 7 Edge Functions (52 API actions), 20 database tables | Supabase, OpenAI API |
| 6 | dashboard | `theleak/implementation/gui/` | Next.js dashboard (12 pages) | platform-api, Supabase auth |
| 7 | bacowr | `projects/Bacowr-v6.3/` | SEO article SaaS: Python pipeline, FastAPI worker, landing page | Own Supabase schema, OpenAI API |

## Dependency Rules

### Within a Domain (Forward-Only)

```
Types -> Config -> Repository -> Service -> Runtime -> UI
```

No backward dependencies. A Service never imports from Runtime. Types never import from anything.

### Cross-Domain Rules

- **Community content is independent.** No imports between recipes, skills, dashboards, or integrations. Each is a standalone folder.
- **agentic-runtime depends on platform-api.** The CLI calls Edge Functions for all persistence and AI operations.
- **dashboard depends on platform-api.** The GUI reads/writes through the same Edge Function API.
- **Both agentic-runtime and dashboard depend on core-memory** (Supabase) for auth and data.
- **curriculum and community depend on core-memory** for the underlying `thoughts` table and MCP protocol.
- **Bacowr is standalone.** Own Supabase schema, own runtime, own deployment. No imports to/from other domains.

## Cross-Cutting Concerns

| Concern | Mechanism | Used By |
|---------|-----------|---------|
| Authentication | Supabase auth + `x-access-key` header | platform-api, dashboard, agentic-runtime |
| Persistence | Supabase PostgreSQL | All platform domains |
| Embeddings | OpenAI API via pgvector | core-memory, agentic-runtime |
| MCP Protocol | Model Context Protocol over remote Edge Functions | core-memory, curriculum, community |
| Budget Control | Token/USD/turn limits checked before every LLM call | agentic-runtime |

## Where New Code Goes

| I want to... | Put it in... |
|--------------|-------------|
| Add a new community capability | `recipes/<my-recipe>/` |
| Add a new skill pack | `skills/<my-skill>/` |
| Add a new database extension | `schemas/<my-schema>/` |
| Add a new frontend template | `dashboards/<my-dashboard>/` |
| Add an MCP extension or webhook | `integrations/<my-integration>/` |
| Add a new Edge Function action | `theleak/implementation/functions/` |
| Add a new CLI command | `theleak/implementation/runtime/` |
| Add a new GUI page | `theleak/implementation/gui/src/app/` |
| Add a new Bacowr feature | `projects/Bacowr-v6.3/` |
| Add a new database migration | `theleak/implementation/sql/migrations/` |
| Propose a new curated extension | Open an issue first, then `extensions/` |
| Propose a new primitive | Open an issue first, then `primitives/` |

All community contributions (`recipes/`, `skills/`, `dashboards/`, `integrations/`, `schemas/`) require `README.md` + `metadata.json`. See `CONTRIBUTING.md`.

## Key Interfaces

1. **Edge Function Action Format** — Each Edge Function handles multiple actions via an `action` field in the request body. Actions are routed internally. Auth via `x-access-key` header.
2. **metadata.json Schema** — Validated against `.github/metadata.schema.json`. Required fields: `name`, `description`, `category`, `author`, `version`, `requires.open_brain`, `tags`, `difficulty`, `estimated_time`.
3. **MCP Tool Protocol** — Remote MCP servers deployed as Supabase Edge Functions. Clients connect via URL (Settings > Connectors > Add custom connector). Never local stdio.
4. **CLI Command Structure** — Commands in `theleak/implementation/runtime/` follow the pattern: parse args, check budget, call Edge Function, format output. Subcommands: boot, doctor, run, resume, status, sessions, budget, tools, agents, memory.
5. **Night Runner Task Format** — Autonomous agent tasks defined with goal, budget (tokens + USD + turns), tools whitelist, and success criteria. Tasks persist to Supabase; the local runtime is stateless.

## Dependency Diagram

```
                    +------------------+
                    |   core-memory    |
                    | server/ schemas/ |
                    +--------+---------+
                             |
              +--------------+--------------+
              |              |              |
     +--------v---+  +-------v------+  +----v-----------+
     | curriculum  |  |  community   |  |  platform-api  |
     | extensions/ |  | recipes/     |  | functions/     |
     | primitives/ |  | skills/      |  | sql/migrations |
     +-------------+  | dashboards/  |  +----+------+----+
                       | integrations/|       |      |
                       +--------------+       |      |
                                        +-----v--+ +-v---------+
                                        |dashboard| |agentic-  |
                                        |  gui/   | |runtime/  |
                                        +---------+ +----------+

                    +------------------+
                    |     bacowr       |  (standalone)
                    | projects/        |
                    | Bacowr-v6.3/     |
                    +------------------+
```
