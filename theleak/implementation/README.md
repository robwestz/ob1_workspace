# OB1 Agentic Architecture -- Quick Start

A persistent AI agent runtime with memory, tool permissions, budgets, multi-agent coordination, and auto-compaction. Runs locally on Node.js, persists everything to Supabase.

## Architecture

```
Local (Node.js 20+)                       Supabase (remote)
+-------------------------+               +----------------------------+
|  CLI (cli.ts)           |               |  PostgreSQL + pgvector     |
|  BootSequence           |--REST/HTTPS-->|  20 tables, 3 SQL funcs    |
|  ConversationRuntime    |               |  4 expression indexes      |
|  SessionManager         |               +----------------------------+
|  BudgetTracker          |               |  7 Edge Functions          |
|  ToolPool + Permissions |               |  52 API actions            |
|  HookRunner             |               +----------------------------+
|  TranscriptCompactor    |
|  ContextAssembler       |               Anthropic API
|  AnthropicApiClient     |--REST/HTTPS-->|  Messages API (streaming)  |
|  AgentCoordinator       |               +----------------------------+
+-------------------------+
```

## Prerequisites

- **Node.js 20+** (for built-in fetch and parseArgs)
- **A Supabase project** with the OB1 core `thoughts` table set up (see `docs/01-getting-started.md`)
- **Anthropic API key** (for Claude models -- haiku/sonnet/opus)
- **OpenAI API key** (for embeddings in the memory system)

## Setup

### 1. Run SQL Migrations

Open the Supabase SQL Editor and run the eight migration files in order:

```
sql/migrations/001_tool_registry_and_permissions.sql
sql/migrations/002_state_and_budget.sql
sql/migrations/003_streaming_logging_verification.sql
sql/migrations/004_compaction_stops_provenance.sql
sql/migrations/005_doctor_and_boot.sql
sql/migrations/006_agent_type_system.sql
sql/migrations/007_memory_system.sql
sql/migrations/008_skills_and_extensibility.sql
```

These create 20 tables including `tool_registry`, `permission_policies`, `agent_sessions`, `budget_ledger`, `system_events`, `boot_runs`, `agent_types`, `agent_runs`, `agent_messages`, `hook_configurations`, `skill_definitions`, `installed_plugins`, and more.

### 2. Deploy Edge Functions

Deploy all seven Edge Functions to your Supabase project:

```bash
cd functions

supabase functions deploy agent-tools
supabase functions deploy agent-state
supabase functions deploy agent-stream
supabase functions deploy agent-doctor
supabase functions deploy agent-memory
supabase functions deploy agent-skills
supabase functions deploy agent-coordinator
```

Each function handles a subset of the 52 API actions. The runtime communicates with them through the unified `OB1Client` HTTP client.

### 3. Configure Environment

```bash
cd runtime
cp .env.example .env
```

Edit `.env` with your actual values:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-key
ANTHROPIC_API_KEY=sk-ant-...your-key
OPENAI_API_KEY=sk-...your-key
```

### 4. Install and Build

```bash
cd runtime
npm install
npm run build
```

### 5. Boot and Verify

Run the boot sequence to validate everything is connected:

```bash
node dist/cli.js boot
```

This runs the 10-phase boot sequence:

1. **Prefetch** -- warm credential cache
2. **Environment** -- check Node version, platform, dependencies
3. **Config Loading** -- merge user/project/local config tiers
4. **Trust Gate** -- establish trust mode
5. **Registry Init** -- load tool registry from Supabase
6. **Workspace Init** -- validate workspace structure
7. **Deferred Loading** -- initialize plugins, skills, MCP servers
8. **Mode Routing** -- determine agent mode (interactive/coordinator/etc.)
9. **Doctor Check** -- run 6-category health validation
10. **Main Loop** -- ready to accept input

Then run the doctor to see detailed health check results:

```bash
node dist/cli.js doctor
```

### 6. Start an Interactive Session

```bash
node dist/cli.js run
```

This creates a new session, assembles the tool pool, and starts an interactive loop where you type messages and the agent responds with streaming output.

Options:

```bash
# Use a specific model
node dist/cli.js run --model opus

# Set budget limits
node dist/cli.js run --max-usd 5.00 --max-turns 20

# Simple mode (limited tools -- read_file, edit_file, bash only)
node dist/cli.js run --simple
```

Interactive commands while running:

- `/budget` -- show current budget usage
- `/status` -- show session info
- `/quit` -- end the session

### 7. Resume a Previous Session

```bash
node dist/cli.js resume --session <session-id>
```

This loads the session from Supabase, rehydrates the budget tracker from persisted messages, and continues where you left off.

## CLI Reference

```
Usage: ob1-agent <command> [options]

Commands:
  boot        Run boot sequence and validate system
  doctor      Run health checks (6 categories, auto-repair)
  run         Start the agentic loop (interactive mode)
  status      Show session status, usage, and budget
  sessions    List recent sessions
  resume      Resume a previous session
  budget      Show budget breakdown (turns, tokens, USD)
  tools       List available tools in the pool
  agents      List registered agent types
  memory      Query memory (recall, store, stats)
  version     Show version

Options:
  --config <path>      Config file path
  --session <id>       Session ID (for resume/status/budget)
  --model <name>       Model: haiku, sonnet, opus (default: sonnet)
  --max-turns <n>      Max turns per session (default: 50)
  --max-tokens <n>     Max budget tokens (default: 1000000)
  --max-usd <n>        Max budget USD (default: 10.00)
  --simple             Simple mode (limited tools)
  --verbose            Verbose logging
  --json               JSON output (for scripting)
```

### Memory Commands

```bash
# Semantic search across all stored memories
node dist/cli.js memory recall "project architecture decisions"

# Store a new memory
node dist/cli.js memory store "The API uses REST endpoints, not GraphQL"

# Check memory system status
node dist/cli.js memory stats
```

## Runtime Source Layout

```
runtime/src/
  cli.ts                  -- CLI entry point (this guide)
  anthropic-client.ts     -- Anthropic Messages API client (streaming)
  ob1-client.ts           -- Unified HTTP client for 7 Edge Functions
  config.ts               -- 3-tier scoped configuration with provenance
  session-manager.ts      -- Session lifecycle and persistence
  budget-tracker.ts       -- Token, turn, and USD budget enforcement
  tool-pool.ts            -- Tool assembly, filtering, permissions
  hook-runner.ts          -- Pre/post tool hooks (shell scripts)
  transcript-compactor.ts -- Auto-compaction with LLM summarization
  context-assembler.ts    -- Provenance-aware context assembly
  boot.ts                 -- 10-phase staged boot sequence
  doctor.ts               -- 6-category health checks with auto-repair
  conversation-runtime.ts -- The core agentic loop
  coordinator.ts          -- Multi-agent coordination (DAG scheduling)
  types.ts                -- All shared type definitions
  index.ts                -- Public API exports
```

## Configuration

The runtime loads configuration from three tiers (later overrides earlier):

1. **User** -- `~/.ob1/config.json` (global preferences)
2. **Project** -- `.ob1/config.json` (project-specific settings)
3. **Local** -- `.ob1/config.local.json` (machine-specific, gitignored)

Every config value is tracked with provenance so you can answer "where did this setting come from?" at any time.

## Pricing Reference

| Model  | Input (/1M) | Output (/1M) | Cache Write (/1M) | Cache Read (/1M) |
|--------|-------------|--------------|--------------------|--------------------|
| Haiku  | $1.00       | $5.00        | $1.25              | $0.10              |
| Sonnet | $3.00       | $15.00       | $3.75              | $0.30              |
| Opus   | $15.00      | $75.00       | $18.75             | $1.50              |

## License

FSL-1.1-MIT. See `LICENSE.md` in the repository root.
