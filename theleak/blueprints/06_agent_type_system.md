# Blueprint 06: Agent Type System, Coordinator & Inter-Agent Communication

> Primitive #16 (Agent Type System) -- the coordination layer for OB1's multi-agent architecture.
>
> Status: IMPLEMENTATION BLUEPRINT
> Date: 2026-04-03
> Depends on:
>   - Blueprint 01 (Tool Registry & Permissions) -- tool pool scoping per agent type, permission policies
>   - Blueprint 02 (State & Budget) -- `agent_sessions` for per-agent session persistence, `budget_ledger` for cost isolation
>   - Blueprint 03 (Streaming, Logging, Verification) -- `system_events` for agent lifecycle events
>   - Blueprint 05 (Doctor & Boot) -- boot pipeline loads agent registry, doctor checks agent health

---

## Table of Contents

1. [Design Thesis](#1-design-thesis)
2. [Database Schema](#2-database-schema)
3. [Agent Type Definitions](#3-agent-type-definitions)
4. [Agent Registry](#4-agent-registry)
5. [Agent Lifecycle & Fork Mechanism](#5-agent-lifecycle--fork-mechanism)
6. [Coordinator Layer](#6-coordinator-layer)
7. [Inter-Agent Communication](#7-inter-agent-communication)
8. [OB1 Integration](#8-ob1-integration)
9. [Edge Function Endpoints](#9-edge-function-endpoints)
10. [Build Order](#10-build-order)
11. [File Map](#11-file-map)
12. [Verification Checklist](#12-verification-checklist)

---

## 1. Design Thesis

Claude Code spawns sub-agents as isolated `ConversationRuntime<C, T>` instances -- each with its own Session, PermissionPolicy, UsageTracker, HookRunner, and max_iterations. This gives per-agent context isolation at the type level. But the system has critical gaps:

- **No inter-agent communication.** Agents are fire-and-forget. No message passing, no shared state, no result aggregation.
- **No agent dependency graph.** You cannot express "run verification after explore completes."
- **No coordinator state persistence.** Coordinator state is ephemeral -- lost on crash.
- **No dynamic agent type registration.** Built-in types are compiled into `builtInAgents.ts`.
- **No audit trail for agent runs.** No durable record of what agents ran, what they found, what they cost.

OB1 fills every one of these gaps. The `agent_types` table replaces hardcoded definitions. The `agent_runs` table provides durable lifecycle tracking and links to `agent_sessions` and `budget_ledger`. The `thoughts` table becomes the inter-agent communication bus -- agents read and write thoughts to share findings. Supabase Edge Functions expose the full coordinator API over MCP.

### Architecture Overview

```
+---------------------------------------------------------------+
|                     Agent Runtime (TS/Edge)                     |
|                                                                |
|  AgentRegistry ---------> agent_types table (Supabase)         |
|  Coordinator -----------> agent_runs table (Supabase)          |
|  AgentRuntime ----------> agent_sessions table (BP02)          |
|  BudgetTracker ---------> budget_ledger table (BP02)           |
|  ToolPool --------------> tool_registry + permission_policies  |
|  InterAgentBus ---------> thoughts table (OB1 core)            |
|  EventLogger -----------> system_events table (BP03)           |
+---------------------------------------------------------------+

Coordinator spawns sub-agents:
  +-- Agent A (explore): own Session, own Policy, own Budget
  |     writes findings -> thoughts table
  |
  +-- Agent B (plan): own Session, own Policy, own Budget
  |     reads Agent A findings <- thoughts table
  |     writes plan -> thoughts table
  |
  +-- Agent C (verification): own Session, own Policy, own Budget
        reads Agent B plan <- thoughts table
        runs tests, writes results -> thoughts table

Inter-agent dependencies expressed as DAG:
  explore --> plan --> verification
                  \--> guide (parallel with verification)
```

---

## 2. Database Schema

Run these migrations after blueprints 01-05 schemas exist.

### 2.1 Agent Types Table

```sql
-- ============================================================
-- Agent Type Definitions
-- Stores both built-in and custom agent type configurations.
-- Each row is a complete agent blueprint: what tools it can use,
-- what prompt it gets, how many iterations it can run, etc.
-- ============================================================

CREATE TABLE agent_types (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  description     TEXT,

  -- Source: where this type was defined
  source          TEXT NOT NULL DEFAULT 'built_in'
    CHECK (source IN ('built_in', 'custom', 'skill_pack')),

  -- Permission and tool configuration
  permission_mode TEXT NOT NULL DEFAULT 'read_only'
    CHECK (permission_mode IN ('read_only', 'workspace_write', 'danger_full_access')),

  -- Tools this agent type is allowed to use (empty = all tools at permission level)
  allowed_tools   TEXT[] NOT NULL DEFAULT '{}',
  -- Tools explicitly denied regardless of permission level
  denied_tools    TEXT[] NOT NULL DEFAULT '{}',
  -- Deny prefix patterns (e.g., 'mcp__dangerous_')
  denied_prefixes TEXT[] NOT NULL DEFAULT '{}',

  -- Behavioral configuration
  system_prompt   TEXT NOT NULL,
  constraints     TEXT[] NOT NULL DEFAULT '{}',

  -- Safety limits
  max_iterations  INTEGER NOT NULL DEFAULT 50,

  -- Output format expected from this agent type
  output_format   TEXT NOT NULL DEFAULT 'markdown'
    CHECK (output_format IN ('markdown', 'json', 'structured_facts', 'plan', 'status', 'free')),

  -- Handler type for permission decisions (from BP01)
  handler_type    TEXT NOT NULL DEFAULT 'coordinator'
    CHECK (handler_type IN ('interactive', 'coordinator', 'swarm_worker')),

  -- Visual differentiation
  color           TEXT,  -- hex color code for display, e.g. '#3B82F6'
  icon            TEXT,  -- emoji or icon name, e.g. 'magnifying_glass'

  -- Whether this type can spawn its own sub-agents
  can_spawn       BOOLEAN NOT NULL DEFAULT false,

  -- Metadata for extensibility
  metadata        JSONB DEFAULT '{}'::jsonb,

  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Fast lookup by name (most common path)
CREATE INDEX idx_agent_types_name ON agent_types (name);

-- Filter by source
CREATE INDEX idx_agent_types_source ON agent_types (source);

-- Only enabled types
CREATE INDEX idx_agent_types_enabled ON agent_types (enabled) WHERE enabled = true;

-- Auto-update timestamp
CREATE TRIGGER agent_types_updated_at
  BEFORE UPDATE ON agent_types
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE agent_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on agent_types"
  ON agent_types
  FOR ALL
  USING (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_types TO service_role;
```

### 2.2 Agent Runs Table

```sql
-- ============================================================
-- Agent Run History
-- Every sub-agent spawn is tracked here. Links to agent_sessions
-- and budget_ledger for full observability. This is the durable
-- replacement for the ephemeral SubAgentManifest.
-- ============================================================

CREATE TABLE agent_runs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id          TEXT NOT NULL UNIQUE,  -- human-readable run identifier

  -- What type of agent
  agent_type_id   UUID NOT NULL REFERENCES agent_types(id),
  agent_type_name TEXT NOT NULL,  -- denormalized for fast reads

  -- Coordinator relationship
  coordinator_run_id UUID REFERENCES agent_runs(id),  -- NULL for top-level agents
  parent_run_id   UUID REFERENCES agent_runs(id),      -- immediate parent (may differ from coordinator)

  -- Task description
  task_prompt     TEXT NOT NULL,
  task_context    JSONB DEFAULT '{}'::jsonb,  -- additional structured context passed at spawn

  -- Lifecycle
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'timeout')),

  -- Timing
  queued_at       TIMESTAMPTZ DEFAULT now(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  duration_ms     INTEGER,

  -- Results
  output_summary  TEXT,                        -- short summary of what the agent produced
  output_data     JSONB DEFAULT '{}'::jsonb,   -- structured output (format depends on agent type)
  error_message   TEXT,                        -- populated on failure

  -- Cross-references to other BP tables
  session_id      TEXT,                        -- FK to agent_sessions.session_id (BP02)
  thought_ids     UUID[] DEFAULT '{}',         -- thoughts created by this agent run

  -- Resource consumption (denormalized from budget_ledger for fast reads)
  total_input_tokens    BIGINT DEFAULT 0,
  total_output_tokens   BIGINT DEFAULT 0,
  total_cost_usd        NUMERIC(12,6) DEFAULT 0,
  iteration_count       INTEGER DEFAULT 0,
  max_iterations_used   INTEGER,  -- the limit that was set

  -- Dependency tracking (DAG edges)
  depends_on      UUID[] DEFAULT '{}',  -- run_ids that must complete before this agent starts
  blocks          UUID[] DEFAULT '{}',  -- run_ids that are waiting on this agent

  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Find runs by coordinator
CREATE INDEX idx_agent_runs_coordinator ON agent_runs (coordinator_run_id);

-- Find runs by parent
CREATE INDEX idx_agent_runs_parent ON agent_runs (parent_run_id);

-- Find runs by status (for coordinator polling)
CREATE INDEX idx_agent_runs_status ON agent_runs (status, created_at DESC);

-- Find runs by agent type
CREATE INDEX idx_agent_runs_type ON agent_runs (agent_type_name);

-- Temporal queries
CREATE INDEX idx_agent_runs_created ON agent_runs (created_at DESC);

-- Auto-update timestamp
CREATE TRIGGER agent_runs_updated_at
  BEFORE UPDATE ON agent_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on agent_runs"
  ON agent_runs
  FOR ALL
  USING (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE ON TABLE public.agent_runs TO service_role;
```

### 2.3 Agent Messages Table (Inter-Agent Communication)

```sql
-- ============================================================
-- Agent Messages
-- Point-to-point and broadcast messages between agents within
-- a coordinator session. This is the communication bus that
-- Claude Code lacks entirely.
-- ============================================================

CREATE TABLE agent_messages (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Routing
  coordinator_run_id UUID NOT NULL REFERENCES agent_runs(id),
  from_run_id     UUID NOT NULL REFERENCES agent_runs(id),
  to_run_id       UUID REFERENCES agent_runs(id),  -- NULL = broadcast to all agents in coordinator
  channel         TEXT NOT NULL DEFAULT 'default',  -- named channel for topic-based routing

  -- Content
  message_type    TEXT NOT NULL DEFAULT 'data'
    CHECK (message_type IN (
      'data',          -- structured data payload
      'finding',       -- a discovery or result to share
      'request',       -- ask another agent to do something
      'status_update', -- progress update
      'error',         -- error notification
      'completion'     -- agent is done, here are final results
    )),
  content         JSONB NOT NULL,
  summary         TEXT,  -- human-readable one-liner

  -- Optional link to a thought (if this message was persisted as a thought)
  thought_id      UUID REFERENCES thoughts(id),

  -- Delivery tracking
  delivered       BOOLEAN NOT NULL DEFAULT false,
  delivered_at    TIMESTAMPTZ,
  acknowledged    BOOLEAN NOT NULL DEFAULT false,
  acknowledged_at TIMESTAMPTZ,

  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Fast: get all messages for a coordinator session
CREATE INDEX idx_agent_messages_coordinator ON agent_messages (coordinator_run_id, created_at);

-- Fast: get undelivered messages for a specific agent
CREATE INDEX idx_agent_messages_undelivered
  ON agent_messages (to_run_id, delivered, created_at)
  WHERE delivered = false;

-- Fast: get messages by channel
CREATE INDEX idx_agent_messages_channel ON agent_messages (coordinator_run_id, channel, created_at);

-- RLS
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on agent_messages"
  ON agent_messages
  FOR ALL
  USING (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE ON TABLE public.agent_messages TO service_role;
```

### 2.4 Extend system_events Categories

```sql
-- Add agent-related categories to the system_events CHECK constraint.
-- Preserves all existing categories from BP03 and BP05.
ALTER TABLE system_events DROP CONSTRAINT IF EXISTS system_events_category_check;
ALTER TABLE system_events ADD CONSTRAINT system_events_category_check
  CHECK (category IN (
    -- Existing from BP03
    'initialization', 'registry', 'tool_selection', 'permission',
    'execution', 'stream', 'turn_complete', 'session',
    'compaction', 'usage', 'error', 'hook', 'verification',
    -- From BP05
    'boot', 'doctor', 'config',
    -- New for BP06
    'agent_spawn',       -- agent was created
    'agent_complete',    -- agent finished successfully
    'agent_fail',        -- agent failed
    'agent_cancel',      -- agent was cancelled
    'agent_message',     -- inter-agent message sent
    'coordinator'        -- coordinator-level events (dag resolution, wave starts)
  ));
```

---

## 3. Agent Type Definitions

### 3.1 Built-In Agent Types

Six agent types ship out of the box. Each defines the full behavioral contract.

```typescript
// agents/types.ts

export interface AgentTypeDefinition {
  name: string;
  display_name: string;
  description: string;
  source: 'built_in' | 'custom' | 'skill_pack';
  permission_mode: 'read_only' | 'workspace_write' | 'danger_full_access';
  allowed_tools: string[];
  denied_tools: string[];
  denied_prefixes: string[];
  system_prompt: string;
  constraints: string[];
  max_iterations: number;
  output_format: 'markdown' | 'json' | 'structured_facts' | 'plan' | 'status' | 'free';
  handler_type: 'interactive' | 'coordinator' | 'swarm_worker';
  color: string;
  icon: string;
  can_spawn: boolean;
  metadata: Record<string, unknown>;
}

export type AgentTypeName =
  | 'explore'
  | 'plan'
  | 'verification'
  | 'guide'
  | 'general_purpose'
  | 'statusline'
  | string;  // custom agent types
```

### 3.2 The Six Built-In Types

```typescript
// agents/built-in-types.ts

import { AgentTypeDefinition } from './types';

export const BUILT_IN_AGENT_TYPES: Record<string, AgentTypeDefinition> = {

  // ─────────────────────────────────────────────
  // EXPLORE: Read-only codebase exploration
  // ─────────────────────────────────────────────
  explore: {
    name: 'explore',
    display_name: 'Explorer',
    description: 'Read-only codebase exploration and information gathering. Cannot modify files.',
    source: 'built_in',
    permission_mode: 'read_only',
    allowed_tools: [
      'read_file', 'glob_search', 'grep_search', 'web_fetch', 'web_search',
    ],
    denied_tools: [
      'bash', 'write_file', 'edit_file',
    ],
    denied_prefixes: ['mcp__dangerous_'],
    system_prompt: `You are an Explorer agent. Your job is to thoroughly investigate codebases, documentation, and external sources to gather information.

## Rules
- You may ONLY read files, search code, and fetch web content.
- You may NOT modify any files, run commands, or make changes.
- Report your findings in structured form with file paths, line numbers, and relevance scores.
- When you find something important, include the exact text -- do not paraphrase code.

## Output
Produce a structured report with sections:
1. Summary of findings
2. Key files discovered (with paths)
3. Patterns and architecture notes
4. Open questions / areas needing deeper investigation`,
    constraints: [
      'Do not modify any files',
      'Do not run shell commands',
      'Report findings without taking action',
      'Include exact file paths and line numbers',
    ],
    max_iterations: 50,
    output_format: 'structured_facts',
    handler_type: 'coordinator',
    color: '#3B82F6',  // blue
    icon: 'magnifying_glass',
    can_spawn: false,
    metadata: {},
  },

  // ─────────────────────────────────────────────
  // PLAN: Architecture and strategy formulation
  // ─────────────────────────────────────────────
  plan: {
    name: 'plan',
    display_name: 'Planner',
    description: 'Architecture planning and strategy formulation. Can read code and produce plans.',
    source: 'built_in',
    permission_mode: 'read_only',
    allowed_tools: [
      'read_file', 'glob_search', 'grep_search',
    ],
    denied_tools: [
      'bash', 'write_file', 'edit_file',
    ],
    denied_prefixes: ['mcp__'],
    system_prompt: `You are a Planner agent. Your job is to analyze requirements, explore existing code, and produce detailed implementation plans.

## Rules
- You may read files and search code to understand the codebase.
- You may NOT modify files or run commands.
- Produce a step-by-step implementation plan with specific file paths and code changes.
- Each step must be small enough for a single agent to execute.
- Identify dependencies between steps.
- Flag risks and unknowns.

## Output Format
Produce a plan as a numbered list of steps. Each step includes:
- Description of the change
- Target file(s)
- Dependencies (which steps must complete first)
- Estimated complexity (low/medium/high)
- Risk flags if any`,
    constraints: [
      'Do not modify any files',
      'Do not run shell commands',
      'Each plan step must be independently executable',
      'Identify all cross-step dependencies',
    ],
    max_iterations: 40,
    output_format: 'plan',
    handler_type: 'coordinator',
    color: '#8B5CF6',  // purple
    icon: 'clipboard',
    can_spawn: false,
    metadata: {},
  },

  // ─────────────────────────────────────────────
  // VERIFICATION: Testing and validation
  // ─────────────────────────────────────────────
  verification: {
    name: 'verification',
    display_name: 'Verifier',
    description: 'Run tests, type checks, linters, and validate changes. Can execute read-only bash commands.',
    source: 'built_in',
    permission_mode: 'workspace_write',
    allowed_tools: [
      'read_file', 'glob_search', 'grep_search', 'bash',
    ],
    denied_tools: [
      'write_file', 'edit_file',
    ],
    denied_prefixes: ['mcp__'],
    system_prompt: `You are a Verification agent. Your job is to validate that code changes work correctly.

## Rules
- You may read files and run bash commands for testing.
- You may run: test suites, type checkers, linters, formatters (check mode), build commands.
- You may NOT modify source files. You are a validator, not a fixer.
- If tests fail, report the failures clearly but do not attempt fixes.

## Bash Restrictions
Only run commands that are observational:
- npm test, cargo test, pytest, go test
- tsc --noEmit, mypy, eslint (without --fix)
- cargo clippy, cargo fmt --check
- build commands (npm run build, cargo build)

Do NOT run: rm, mv, cp, git push, git commit, npm publish, or any destructive commands.

## Output
Produce a verification report:
1. Tests run and results (pass/fail counts)
2. Type check results
3. Lint findings
4. Build status
5. Overall verdict: PASS / FAIL / PARTIAL`,
    constraints: [
      'Do not modify source files',
      'Only run observational bash commands',
      'Never run destructive commands (rm, mv, git push, etc.)',
      'Report failures clearly without attempting fixes',
    ],
    max_iterations: 30,
    output_format: 'structured_facts',
    handler_type: 'coordinator',
    color: '#10B981',  // green
    icon: 'check_circle',
    can_spawn: false,
    metadata: {},
  },

  // ─────────────────────────────────────────────
  // GUIDE: User assistance and documentation
  // ─────────────────────────────────────────────
  guide: {
    name: 'guide',
    display_name: 'Guide',
    description: 'User assistance, documentation, and how-to guidance. Read-only with web access.',
    source: 'built_in',
    permission_mode: 'read_only',
    allowed_tools: [
      'read_file', 'glob_search', 'grep_search', 'web_fetch', 'web_search',
    ],
    denied_tools: [
      'bash', 'write_file', 'edit_file',
    ],
    denied_prefixes: ['mcp__dangerous_'],
    system_prompt: `You are a Guide agent. Your job is to help users understand codebases, tools, and workflows.

## Rules
- You may read files, search code, and fetch web documentation.
- You may NOT modify files or run commands.
- Explain concepts clearly with examples.
- Reference specific files and line numbers when discussing code.
- Link to relevant documentation when available.

## Output
Produce clear, structured guidance:
1. Direct answer to the user's question
2. Relevant code examples (from the actual codebase)
3. Links to documentation
4. Related topics the user might want to explore`,
    constraints: [
      'Do not modify any files',
      'Do not run shell commands',
      'Reference actual code, not hypothetical examples',
      'Be concise but thorough',
    ],
    max_iterations: 30,
    output_format: 'markdown',
    handler_type: 'coordinator',
    color: '#F59E0B',  // amber
    icon: 'book_open',
    can_spawn: false,
    metadata: {},
  },

  // ─────────────────────────────────────────────
  // GENERAL PURPOSE: Full-capability coding agent
  // ─────────────────────────────────────────────
  general_purpose: {
    name: 'general_purpose',
    display_name: 'Worker',
    description: 'General-purpose coding agent with read and write access. Can modify files and run commands.',
    source: 'built_in',
    permission_mode: 'workspace_write',
    allowed_tools: [
      'read_file', 'write_file', 'edit_file', 'glob_search', 'grep_search',
      'bash', 'web_fetch', 'web_search',
    ],
    denied_tools: [],
    denied_prefixes: ['mcp__dangerous_'],
    system_prompt: `You are a Worker agent. Your job is to implement code changes based on a specific task.

## Rules
- You may read, write, and edit files.
- You may run bash commands for building, testing, and validation.
- Stay focused on your assigned task. Do not refactor unrelated code.
- Make minimal, targeted changes. Do not gold-plate.
- Test your changes before reporting completion.

## Process
1. Read and understand the task and relevant code.
2. Plan the minimal set of changes needed.
3. Implement the changes.
4. Verify the changes work (run tests, type check, etc.).
5. Report what was changed and any remaining concerns.`,
    constraints: [
      'Stay focused on the assigned task',
      'Make minimal, targeted changes',
      'Test changes before reporting completion',
      'Do not refactor unrelated code',
    ],
    max_iterations: 100,
    output_format: 'markdown',
    handler_type: 'coordinator',
    color: '#EF4444',  // red
    icon: 'wrench',
    can_spawn: false,
    metadata: {},
  },

  // ─────────────────────────────────────────────
  // STATUSLINE: Progress tracking and display
  // ─────────────────────────────────────────────
  statusline: {
    name: 'statusline',
    display_name: 'Status',
    description: 'Monitors and displays progress of other agents. Minimal tool access.',
    source: 'built_in',
    permission_mode: 'read_only',
    allowed_tools: [
      'read_file',
    ],
    denied_tools: [
      'bash', 'write_file', 'edit_file', 'glob_search', 'grep_search',
    ],
    denied_prefixes: ['mcp__'],
    system_prompt: `You are a Status agent. Your job is to track and display the progress of a multi-agent operation.

## Rules
- You receive status updates from the coordinator.
- Produce concise status displays showing: which agents are running, what they are doing, completion percentage.
- Use the status format specified in your task.

## Output
A compact status display suitable for terminal or dashboard rendering.`,
    constraints: [
      'Only produce status output',
      'Do not take any actions',
      'Keep output compact',
    ],
    max_iterations: 200,  // high limit: status runs for the duration of the operation
    output_format: 'status',
    handler_type: 'swarm_worker',
    color: '#6B7280',  // gray
    icon: 'bar_chart',
    can_spawn: false,
    metadata: {},
  },
};
```

### 3.3 Agent Type Summary Table

| Type | Permission | Allowed Tools | Max Iter | Output | Handler | Spawns? |
|------|-----------|---------------|----------|--------|---------|---------|
| explore | read_only | read_file, glob_search, grep_search, web_fetch, web_search | 50 | structured_facts | coordinator | No |
| plan | read_only | read_file, glob_search, grep_search | 40 | plan | coordinator | No |
| verification | workspace_write | read_file, glob_search, grep_search, bash | 30 | structured_facts | coordinator | No |
| guide | read_only | read_file, glob_search, grep_search, web_fetch, web_search | 30 | markdown | coordinator | No |
| general_purpose | workspace_write | read_file, write_file, edit_file, glob_search, grep_search, bash, web_fetch, web_search | 100 | markdown | coordinator | No |
| statusline | read_only | read_file | 200 | status | swarm_worker | No |

### 3.4 Custom Agent Type Definition

Custom agents are defined as markdown files in a project directory (e.g., `.claude/agents/`) and loaded into the `agent_types` table with `source = 'custom'`.

```markdown
<!-- .claude/agents/deep-analyst.md -->
---
name: deep_analyst
display_name: Deep Analyst
permission_mode: read_only
allowed_tools: [read_file, glob_search, grep_search, web_fetch]
max_iterations: 32
output_format: json
handler_type: coordinator
color: '#06B6D4'
icon: microscope
can_spawn: false
---

You are a Deep Code Analyst. Your job is to explore codebases and extract structured knowledge.

For each file you read, identify: public traits, key structs, design patterns, and architectural decisions.

Score each finding by impact: Gamechanger (5), High (3), Medium (2), Low (1).

Output structured facts as JSON with: category, title, description, source, impact, tags.

## Constraints
- Do not modify any files
- Report findings as structured JSON only
- Score every finding by impact
```

Custom agent loader:

```typescript
// agents/load-custom-agents.ts

import matter from 'gray-matter';
import { AgentTypeDefinition } from './types';

const CUSTOM_AGENT_DEFAULTS: Partial<AgentTypeDefinition> = {
  source: 'custom',
  permission_mode: 'read_only',
  denied_tools: ['bash', 'write_file', 'edit_file'],
  denied_prefixes: ['mcp__dangerous_'],
  constraints: [],
  max_iterations: 50,
  output_format: 'markdown',
  handler_type: 'coordinator',
  can_spawn: false,
  metadata: {},
};

export function parseCustomAgentFile(
  markdownContent: string,
): AgentTypeDefinition {
  const { data: frontmatter, content } = matter(markdownContent);

  if (!frontmatter.name) {
    throw new Error('Custom agent file missing required "name" in frontmatter');
  }

  // Extract constraints from markdown ## Constraints section
  const constraintsMatch = content.match(/## Constraints\n([\s\S]*?)(?=\n## |$)/);
  const constraints: string[] = [];
  if (constraintsMatch) {
    const lines = constraintsMatch[1].trim().split('\n');
    for (const line of lines) {
      const cleaned = line.replace(/^[-*]\s*/, '').trim();
      if (cleaned) constraints.push(cleaned);
    }
  }

  // Everything before ## Constraints is the system prompt
  const systemPrompt = content
    .replace(/## Constraints[\s\S]*$/, '')
    .trim();

  return {
    ...CUSTOM_AGENT_DEFAULTS,
    name: frontmatter.name,
    display_name: frontmatter.display_name ?? frontmatter.name,
    description: frontmatter.description ?? '',
    source: 'custom',
    permission_mode: frontmatter.permission_mode ?? 'read_only',
    allowed_tools: frontmatter.allowed_tools ?? [],
    denied_tools: frontmatter.denied_tools ?? CUSTOM_AGENT_DEFAULTS.denied_tools!,
    denied_prefixes: frontmatter.denied_prefixes ?? CUSTOM_AGENT_DEFAULTS.denied_prefixes!,
    system_prompt: systemPrompt,
    constraints,
    max_iterations: frontmatter.max_iterations ?? 50,
    output_format: frontmatter.output_format ?? 'markdown',
    handler_type: frontmatter.handler_type ?? 'coordinator',
    color: frontmatter.color ?? null,
    icon: frontmatter.icon ?? null,
    can_spawn: frontmatter.can_spawn ?? false,
    metadata: frontmatter.metadata ?? {},
  } as AgentTypeDefinition;
}

/**
 * Load all custom agent definitions from a directory.
 * Files must be .md with valid frontmatter.
 */
export async function loadCustomAgentsFromDirectory(
  dirPath: string,
): Promise<AgentTypeDefinition[]> {
  const { readdir, readFile } = await import('node:fs/promises');
  const path = await import('node:path');

  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    // Directory does not exist -- no custom agents
    return [];
  }

  const agents: AgentTypeDefinition[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;

    const filePath = path.join(dirPath, entry);
    const content = await readFile(filePath, 'utf-8');

    try {
      const agentDef = parseCustomAgentFile(content);
      agents.push(agentDef);
    } catch (err) {
      console.warn(`Skipping invalid agent file ${filePath}: ${(err as Error).message}`);
    }
  }

  return agents;
}
```

---

## 4. Agent Registry

The agent registry manages the catalog of available agent types. It mirrors the tool registry pattern from BP01 -- a Supabase-backed registry with in-memory cache, supporting both built-in and custom types.

### 4.1 Registry Implementation

```typescript
// agents/agent-registry.ts

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AgentTypeDefinition, AgentTypeName } from './types';
import { BUILT_IN_AGENT_TYPES } from './built-in-types';
import { loadCustomAgentsFromDirectory } from './load-custom-agents';

export class AgentRegistry {
  private types: Map<string, AgentTypeDefinition> = new Map();
  private supabase: SupabaseClient;
  private initialized: boolean = false;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Initialize the registry: load built-in types, sync to Supabase,
   * then load custom types from Supabase.
   * Called during boot (BP05 Phase 5: Registry Init).
   */
  async initialize(customAgentsDir?: string): Promise<void> {
    // 1. Register all built-in types
    for (const [name, def] of Object.entries(BUILT_IN_AGENT_TYPES)) {
      this.types.set(name, def);
    }

    // 2. Upsert built-in types to Supabase (source of truth sync)
    await this.syncBuiltInsToSupabase();

    // 3. Load custom agents from directory if provided
    if (customAgentsDir) {
      const customAgents = await loadCustomAgentsFromDirectory(customAgentsDir);
      for (const agent of customAgents) {
        this.types.set(agent.name, agent);
        await this.upsertAgentType(agent);
      }
    }

    // 4. Load any custom/skill_pack types from Supabase that are not in local files
    await this.loadRemoteCustomTypes();

    this.initialized = true;
  }

  /** Get an agent type definition by name. Throws if not found. */
  get(name: AgentTypeName): AgentTypeDefinition {
    const def = this.types.get(name);
    if (!def) {
      throw new Error(`Unknown agent type: "${name}". Available: ${this.listNames().join(', ')}`);
    }
    return def;
  }

  /** Try to get an agent type, returning undefined if not found. */
  tryGet(name: string): AgentTypeDefinition | undefined {
    return this.types.get(name);
  }

  /** List all registered agent type names. */
  listNames(): string[] {
    return Array.from(this.types.keys());
  }

  /** List all agent type definitions. */
  listAll(): AgentTypeDefinition[] {
    return Array.from(this.types.values());
  }

  /** List by source. */
  listBySource(source: 'built_in' | 'custom' | 'skill_pack'): AgentTypeDefinition[] {
    return this.listAll().filter(t => t.source === source);
  }

  /** Register a new agent type at runtime (e.g., from a skill pack). */
  async register(definition: AgentTypeDefinition): Promise<void> {
    // Validate: name must not collide with a built-in
    if (BUILT_IN_AGENT_TYPES[definition.name] && definition.source !== 'built_in') {
      throw new Error(`Cannot register custom type with built-in name: "${definition.name}"`);
    }

    this.types.set(definition.name, definition);
    await this.upsertAgentType(definition);
  }

  /** Remove a custom agent type. Cannot remove built-in types. */
  async unregister(name: string): Promise<void> {
    const existing = this.types.get(name);
    if (!existing) return;
    if (existing.source === 'built_in') {
      throw new Error(`Cannot unregister built-in agent type: "${name}"`);
    }

    this.types.delete(name);
    await this.supabase
      .from('agent_types')
      .update({ enabled: false })
      .eq('name', name);
  }

  // ── Private ──────────────────────────────────────────────

  private async syncBuiltInsToSupabase(): Promise<void> {
    for (const def of Object.values(BUILT_IN_AGENT_TYPES)) {
      await this.upsertAgentType(def);
    }
  }

  private async upsertAgentType(def: AgentTypeDefinition): Promise<void> {
    const { error } = await this.supabase
      .from('agent_types')
      .upsert(
        {
          name: def.name,
          display_name: def.display_name,
          description: def.description,
          source: def.source,
          permission_mode: def.permission_mode,
          allowed_tools: def.allowed_tools,
          denied_tools: def.denied_tools,
          denied_prefixes: def.denied_prefixes,
          system_prompt: def.system_prompt,
          constraints: def.constraints,
          max_iterations: def.max_iterations,
          output_format: def.output_format,
          handler_type: def.handler_type,
          color: def.color,
          icon: def.icon,
          can_spawn: def.can_spawn,
          metadata: def.metadata,
          enabled: true,
        },
        { onConflict: 'name' },
      );

    if (error) {
      console.error(`Failed to upsert agent type "${def.name}":`, error.message);
    }
  }

  private async loadRemoteCustomTypes(): Promise<void> {
    const { data, error } = await this.supabase
      .from('agent_types')
      .select('*')
      .eq('enabled', true)
      .in('source', ['custom', 'skill_pack']);

    if (error) {
      console.warn('Failed to load remote custom agent types:', error.message);
      return;
    }

    for (const row of data ?? []) {
      // Don't overwrite locally loaded types
      if (!this.types.has(row.name)) {
        this.types.set(row.name, this.rowToDefinition(row));
      }
    }
  }

  private rowToDefinition(row: Record<string, unknown>): AgentTypeDefinition {
    return {
      name: row.name as string,
      display_name: row.display_name as string,
      description: (row.description as string) ?? '',
      source: row.source as 'built_in' | 'custom' | 'skill_pack',
      permission_mode: row.permission_mode as AgentTypeDefinition['permission_mode'],
      allowed_tools: (row.allowed_tools as string[]) ?? [],
      denied_tools: (row.denied_tools as string[]) ?? [],
      denied_prefixes: (row.denied_prefixes as string[]) ?? [],
      system_prompt: row.system_prompt as string,
      constraints: (row.constraints as string[]) ?? [],
      max_iterations: (row.max_iterations as number) ?? 50,
      output_format: (row.output_format as AgentTypeDefinition['output_format']) ?? 'markdown',
      handler_type: (row.handler_type as AgentTypeDefinition['handler_type']) ?? 'coordinator',
      color: (row.color as string) ?? null,
      icon: (row.icon as string) ?? null,
      can_spawn: (row.can_spawn as boolean) ?? false,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    } as AgentTypeDefinition;
  }
}
```

### 4.2 Boot Integration (BP05 Phase 5 Extension)

The agent registry initializes during boot Phase 5 (Registry Init), alongside the tool registry.

```typescript
// boot/phase-registry-init.ts (extend existing from BP05)

import { AgentRegistry } from '../agents/agent-registry';
import { BootPhaseResult } from './types';

export async function phaseRegistryInit(
  config: MergedConfig,
): Promise<BootPhaseResult> {
  // ... existing tool registry init from BP05 ...

  // Agent registry init (parallel with tool registry)
  const agentRegistry = new AgentRegistry(
    config.get('supabase_url'),
    config.get('supabase_service_key'),
  );

  const customAgentsDir = config.get('custom_agents_dir')
    ?? '.claude/agents';

  await agentRegistry.initialize(customAgentsDir);

  return {
    status: 'ok',
    artifacts: {
      // ... existing tool registry ...
      agentRegistry,
    },
    metadata: {
      agent_types_loaded: agentRegistry.listNames().length,
      built_in_count: agentRegistry.listBySource('built_in').length,
      custom_count: agentRegistry.listBySource('custom').length,
    },
  };
}
```

---

## 5. Agent Lifecycle & Fork Mechanism

### 5.1 Core Types

```typescript
// agents/lifecycle.ts

export type AgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';

export interface AgentRunManifest {
  run_id: string;
  agent_type_name: string;
  agent_type: AgentTypeDefinition;
  status: AgentStatus;
  task_prompt: string;
  task_context: Record<string, unknown>;

  // Coordinator relationship
  coordinator_run_id: string | null;
  parent_run_id: string | null;

  // Timing
  queued_at: Date;
  started_at: Date | null;
  completed_at: Date | null;

  // Dependencies
  depends_on: string[];   // run_ids that must complete first
  blocks: string[];       // run_ids waiting on this agent

  // Results (populated on completion)
  output_summary: string | null;
  output_data: Record<string, unknown> | null;
  error_message: string | null;

  // Cross-references
  session_id: string | null;
  thought_ids: string[];
}

export interface AgentResult {
  run_id: string;
  agent_type_name: string;
  status: 'completed' | 'failed' | 'cancelled' | 'timeout';
  output_summary: string;
  output_data: Record<string, unknown>;
  error_message: string | null;
  duration_ms: number;
  total_cost_usd: number;
  thought_ids: string[];
}
```

### 5.2 Fork Mechanism

The fork creates a fully isolated agent runtime. Each sub-agent gets its own Session (BP02), ToolPool (BP01), BudgetTracker (BP02), and PermissionPolicy (BP01). The parent shares nothing except the API client connection and the Supabase client.

```typescript
// agents/fork.ts

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ToolPool, ToolPoolConfig } from '../pool/tool-pool';
import { PermissionPolicy } from '../permissions/permission-policy';
import { SessionManager } from '../sessions/session-manager';
import { BudgetTracker, BudgetConfig } from '../budget/budget-tracker';
import { EventLogger } from '../events/event-logger';
import { AgentTypeDefinition } from './types';
import { AgentRunManifest, AgentStatus } from './lifecycle';

/** Configuration for spawning a sub-agent */
export interface ForkConfig {
  agent_type: AgentTypeDefinition;
  task_prompt: string;
  task_context?: Record<string, unknown>;
  coordinator_run_id?: string;
  parent_run_id?: string;
  depends_on?: string[];
  budget_config?: Partial<BudgetConfig>;
  model?: string;
}

/** The isolated runtime context for a sub-agent */
export interface AgentRuntime {
  manifest: AgentRunManifest;
  session: SessionManager;
  toolPool: ToolPool;
  permissionPolicy: PermissionPolicy;
  budgetTracker: BudgetTracker;
  eventLogger: EventLogger;
  systemPrompt: string;
}

/**
 * Fork a new sub-agent with full context isolation.
 *
 * This is the OB1 equivalent of Claude Code's `forkSubagent.ts`.
 * Key differences:
 * - Session persists to Supabase (agent_sessions table), not a JSON file
 * - Budget tracks to budget_ledger table, not in-memory only
 * - Agent run is recorded in agent_runs table for lifecycle tracking
 * - Tool pool is assembled from Supabase tool_registry, scoped by agent type
 */
export async function forkSubAgent(
  supabase: SupabaseClient,
  allTools: ToolSpec[],
  config: ForkConfig,
): Promise<AgentRuntime> {
  const runId = `agent_${config.agent_type.name}_${Date.now()}_${randomSuffix()}`;
  const sessionId = `session_${runId}`;

  // 1. Create isolated session (BP02)
  const session = await SessionManager.create(sessionId);

  // 2. Build restricted tool pool (BP01)
  const toolPool = ToolPool.assemble(allTools, {
    simple_mode: false,
    include_mcp: false,  // sub-agents never get MCP tools by default
    permission_config: {
      active_mode: config.agent_type.permission_mode,
      allow_tools: config.agent_type.allowed_tools,
      deny_tools: config.agent_type.denied_tools,
      deny_prefixes: config.agent_type.denied_prefixes,
      handler_type: config.agent_type.handler_type,
    },
  });

  // 3. Build agent-specific permission policy (BP01)
  const permissionPolicy = PermissionPolicy.subAgent(
    config.agent_type.allowed_tools,
  );

  // 4. Create isolated budget tracker (BP02)
  const budgetConfig: BudgetConfig = {
    max_turns: config.budget_config?.max_turns ?? config.agent_type.max_iterations,
    max_budget_tokens: config.budget_config?.max_budget_tokens ?? 500_000,
    max_budget_usd: config.budget_config?.max_budget_usd ?? 2.00,
    auto_compact_threshold: config.budget_config?.auto_compact_threshold ?? 200_000,
    warn_threshold_pct: 0.8,
  };
  const budgetTracker = new BudgetTracker(sessionId, budgetConfig, config.model ?? 'default');

  // 5. Create event logger scoped to this agent run
  const eventLogger = new EventLogger(supabase, sessionId);

  // 6. Build system prompt from agent type definition + task
  const systemPrompt = buildAgentSystemPrompt(config.agent_type, config.task_prompt);

  // 7. Create the run manifest
  const manifest: AgentRunManifest = {
    run_id: runId,
    agent_type_name: config.agent_type.name,
    agent_type: config.agent_type,
    status: 'pending',
    task_prompt: config.task_prompt,
    task_context: config.task_context ?? {},
    coordinator_run_id: config.coordinator_run_id ?? null,
    parent_run_id: config.parent_run_id ?? null,
    queued_at: new Date(),
    started_at: null,
    completed_at: null,
    depends_on: config.depends_on ?? [],
    blocks: [],
    output_summary: null,
    output_data: null,
    error_message: null,
    session_id: sessionId,
    thought_ids: [],
  };

  // 8. Persist the run to agent_runs table
  await persistRunManifest(supabase, manifest);

  // 9. Log spawn event
  await eventLogger.log({
    category: 'agent_spawn',
    event_type: 'agent_spawned',
    data: {
      run_id: runId,
      agent_type: config.agent_type.name,
      task_prompt: config.task_prompt.substring(0, 500),
      tool_count: toolPool.tools.length,
      max_iterations: config.agent_type.max_iterations,
    },
  });

  return {
    manifest,
    session,
    toolPool,
    permissionPolicy,
    budgetTracker,
    eventLogger,
    systemPrompt,
  };
}

function buildAgentSystemPrompt(
  agentType: AgentTypeDefinition,
  taskPrompt: string,
): string {
  const sections: string[] = [];

  // Identity
  sections.push(`# ${agentType.display_name} Agent`);
  sections.push('');
  sections.push(agentType.system_prompt);

  // Constraints
  if (agentType.constraints.length > 0) {
    sections.push('');
    sections.push('## Hard Constraints');
    for (const c of agentType.constraints) {
      sections.push(`- ${c}`);
    }
  }

  // Available tools
  sections.push('');
  sections.push('## Available Tools');
  if (agentType.allowed_tools.length > 0) {
    sections.push(`You may only use: ${agentType.allowed_tools.join(', ')}`);
  } else {
    sections.push('All tools at your permission level are available.');
  }

  // Task
  sections.push('');
  sections.push('## Your Task');
  sections.push(taskPrompt);

  return sections.join('\n');
}

async function persistRunManifest(
  supabase: SupabaseClient,
  manifest: AgentRunManifest,
): Promise<void> {
  const { error } = await supabase
    .from('agent_runs')
    .insert({
      run_id: manifest.run_id,
      agent_type_name: manifest.agent_type_name,
      agent_type_id: null,  // will be resolved by FK lookup in a trigger or separate call
      task_prompt: manifest.task_prompt,
      task_context: manifest.task_context,
      status: manifest.status,
      coordinator_run_id: manifest.coordinator_run_id,
      parent_run_id: manifest.parent_run_id,
      depends_on: manifest.depends_on,
      queued_at: manifest.queued_at.toISOString(),
      session_id: manifest.session_id,
      max_iterations_used: manifest.agent_type.max_iterations,
    });

  if (error) {
    console.error(`Failed to persist agent run "${manifest.run_id}":`, error.message);
  }
}

function randomSuffix(): string {
  return Math.random().toString(36).substring(2, 8);
}
```

### 5.3 Agent Execution Loop

```typescript
// agents/run-agent.ts

import { AgentRuntime, AgentResult, AgentStatus } from './lifecycle';
import { performAutoCompaction } from '../budget/auto-compaction';

export interface AgentExecutionConfig {
  supabase: SupabaseClient;
  apiClient: AnthropicClient;
  onStatusChange?: (runId: string, status: AgentStatus) => void;
  onIterationComplete?: (runId: string, iteration: number) => void;
}

/**
 * Execute an agent to completion within its isolated runtime.
 *
 * This is the core agent execution loop. It:
 * 1. Sets status to 'running'
 * 2. Runs conversation turns until the agent signals completion or hits limits
 * 3. Records results and sets final status
 * 4. Updates the agent_runs table throughout
 */
export async function runAgent(
  runtime: AgentRuntime,
  execConfig: AgentExecutionConfig,
): Promise<AgentResult> {
  const { manifest, session, toolPool, budgetTracker, eventLogger, systemPrompt } = runtime;
  const startTime = Date.now();

  // Transition: pending -> running
  manifest.status = 'running';
  manifest.started_at = new Date();
  await updateRunStatus(execConfig.supabase, manifest);
  execConfig.onStatusChange?.(manifest.run_id, 'running');

  let iteration = 0;
  let lastAssistantOutput = '';
  let finalStatus: AgentStatus = 'completed';
  let errorMessage: string | null = null;

  try {
    // Seed the conversation with the system prompt + task
    session.appendMessage({
      role: 'system',
      content: systemPrompt,
    });
    session.appendMessage({
      role: 'user',
      content: manifest.task_prompt,
    });

    // Main agent loop
    while (iteration < manifest.agent_type.max_iterations) {
      iteration++;

      // Pre-turn budget check (BP02)
      const budgetCheck = budgetTracker.preTurnCheck();
      if (budgetCheck.stop_reason) {
        if (budgetCheck.stop_reason === 'budget_exceeded') {
          finalStatus = 'timeout';
          errorMessage = `Budget exhausted after ${iteration} iterations`;
        }
        break;
      }

      // Call the LLM with the tool pool
      const turnResult = await execConfig.apiClient.createMessage({
        model: manifest.agent_type.metadata.model ?? 'claude-sonnet-4-20250514',
        system: systemPrompt,
        messages: session.getMessages(),
        tools: toolPool.toMCPToolDefinitions(),
        max_tokens: 8192,
      });

      // Record usage (BP02)
      await budgetTracker.recordTurn(turnResult.usage);

      // Append assistant response to session
      session.appendMessage({
        role: 'assistant',
        content: turnResult.content,
      });

      // Process tool calls if any
      if (turnResult.stop_reason === 'tool_use') {
        for (const toolUse of turnResult.tool_calls) {
          // Permission check (BP01)
          if (!toolPool.has(toolUse.name)) {
            session.appendMessage({
              role: 'tool_result',
              tool_use_id: toolUse.id,
              content: `Error: tool "${toolUse.name}" is not available to this agent type (${manifest.agent_type_name}).`,
              is_error: true,
            });
            continue;
          }

          // Execute the tool
          const toolResult = await executeToolInContext(
            toolUse,
            runtime.permissionPolicy,
            eventLogger,
          );

          session.appendMessage({
            role: 'tool_result',
            tool_use_id: toolUse.id,
            content: toolResult.output,
            is_error: toolResult.is_error,
          });
        }
      } else if (turnResult.stop_reason === 'end_turn') {
        // Agent finished naturally
        lastAssistantOutput = extractTextContent(turnResult.content);
        break;
      }

      // Auto-compaction check (BP02)
      await performAutoCompaction(session, budgetTracker);

      // Persist session periodically (BP02)
      await session.flush();

      // Notify iteration complete
      execConfig.onIterationComplete?.(manifest.run_id, iteration);
    }

    // Check if we hit max_iterations (infinite loop guard)
    if (iteration >= manifest.agent_type.max_iterations) {
      finalStatus = 'timeout';
      errorMessage = `Hit max_iterations limit (${manifest.agent_type.max_iterations})`;
    }

  } catch (err) {
    finalStatus = 'failed';
    errorMessage = (err as Error).message;

    await eventLogger.log({
      category: 'agent_fail',
      event_type: 'agent_execution_error',
      data: {
        run_id: manifest.run_id,
        error: errorMessage,
        iteration,
      },
    });
  }

  // Finalize
  const endTime = Date.now();
  manifest.status = finalStatus;
  manifest.completed_at = new Date();
  manifest.output_summary = lastAssistantOutput.substring(0, 2000);
  manifest.error_message = errorMessage;

  // Final session flush
  await session.flush();

  // Update agent_runs table with final state
  await finalizeRunRecord(execConfig.supabase, manifest, {
    duration_ms: endTime - startTime,
    iteration_count: iteration,
    total_input_tokens: budgetTracker.getStatus().cumulative_input_tokens,
    total_output_tokens: budgetTracker.getStatus().cumulative_output_tokens,
    total_cost_usd: budgetTracker.getStatus().cumulative_cost_usd,
  });

  // Log completion event
  await eventLogger.log({
    category: finalStatus === 'completed' ? 'agent_complete' : 'agent_fail',
    event_type: `agent_${finalStatus}`,
    data: {
      run_id: manifest.run_id,
      duration_ms: endTime - startTime,
      iterations: iteration,
      cost_usd: budgetTracker.getStatus().cumulative_cost_usd,
    },
  });

  execConfig.onStatusChange?.(manifest.run_id, finalStatus);

  return {
    run_id: manifest.run_id,
    agent_type_name: manifest.agent_type_name,
    status: finalStatus as AgentResult['status'],
    output_summary: lastAssistantOutput,
    output_data: manifest.output_data ?? {},
    error_message: errorMessage,
    duration_ms: endTime - startTime,
    total_cost_usd: budgetTracker.getStatus().cumulative_cost_usd,
    thought_ids: manifest.thought_ids,
  };
}

async function updateRunStatus(
  supabase: SupabaseClient,
  manifest: AgentRunManifest,
): Promise<void> {
  await supabase
    .from('agent_runs')
    .update({
      status: manifest.status,
      started_at: manifest.started_at?.toISOString(),
    })
    .eq('run_id', manifest.run_id);
}

async function finalizeRunRecord(
  supabase: SupabaseClient,
  manifest: AgentRunManifest,
  stats: {
    duration_ms: number;
    iteration_count: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_usd: number;
  },
): Promise<void> {
  await supabase
    .from('agent_runs')
    .update({
      status: manifest.status,
      completed_at: manifest.completed_at?.toISOString(),
      duration_ms: stats.duration_ms,
      iteration_count: stats.iteration_count,
      total_input_tokens: stats.total_input_tokens,
      total_output_tokens: stats.total_output_tokens,
      total_cost_usd: stats.total_cost_usd,
      output_summary: manifest.output_summary,
      output_data: manifest.output_data,
      error_message: manifest.error_message,
      thought_ids: manifest.thought_ids,
    })
    .eq('run_id', manifest.run_id);
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: { type: string }) => c.type === 'text')
      .map((c: { text: string }) => c.text)
      .join('\n');
  }
  return JSON.stringify(content);
}
```

### 5.4 Agent Resume from Saved State

```typescript
// agents/resume-agent.ts

import { AgentRuntime, AgentRunManifest } from './lifecycle';

/**
 * Resume an agent from its persisted state.
 * This handles the case where an agent was interrupted (crash, timeout, etc.)
 * and needs to continue from where it left off.
 */
export async function resumeAgent(
  supabase: SupabaseClient,
  runId: string,
  allTools: ToolSpec[],
  agentRegistry: AgentRegistry,
): Promise<AgentRuntime | null> {
  // 1. Load the run record
  const { data: runRecord, error } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('run_id', runId)
    .single();

  if (error || !runRecord) {
    console.warn(`Cannot resume agent run "${runId}": not found`);
    return null;
  }

  // Only resume runs that are in a resumable state
  if (!['running', 'pending'].includes(runRecord.status)) {
    console.warn(`Agent run "${runId}" is in status "${runRecord.status}", cannot resume`);
    return null;
  }

  // 2. Restore the agent type definition
  const agentType = agentRegistry.get(runRecord.agent_type_name);

  // 3. Restore the session (BP02)
  const session = await SessionManager.resume(runRecord.session_id);
  if (!session) {
    console.warn(`Cannot resume session for agent run "${runId}"`);
    return null;
  }

  // 4. Rebuild the tool pool
  const toolPool = ToolPool.assemble(allTools, {
    simple_mode: false,
    include_mcp: false,
    permission_config: {
      active_mode: agentType.permission_mode,
      allow_tools: agentType.allowed_tools,
      deny_tools: agentType.denied_tools,
      deny_prefixes: agentType.denied_prefixes,
      handler_type: agentType.handler_type,
    },
  });

  // 5. Rebuild the permission policy
  const permissionPolicy = PermissionPolicy.subAgent(agentType.allowed_tools);

  // 6. Restore the budget tracker from session state (BP02)
  const budgetTracker = BudgetTracker.fromSession(
    runRecord.session_id,
    {
      max_turns: agentType.max_iterations - (runRecord.iteration_count ?? 0),
      max_budget_tokens: 500_000 - (runRecord.total_input_tokens ?? 0),
      max_budget_usd: 2.00 - Number(runRecord.total_cost_usd ?? 0),
      auto_compact_threshold: 200_000,
      warn_threshold_pct: 0.8,
    },
    runRecord.metadata?.model ?? 'default',
    session.getMessages(),
  );

  // 7. Create event logger
  const eventLogger = new EventLogger(supabase, runRecord.session_id);

  // 8. Rebuild the manifest
  const manifest: AgentRunManifest = {
    run_id: runRecord.run_id,
    agent_type_name: runRecord.agent_type_name,
    agent_type: agentType,
    status: 'running',
    task_prompt: runRecord.task_prompt,
    task_context: runRecord.task_context ?? {},
    coordinator_run_id: runRecord.coordinator_run_id,
    parent_run_id: runRecord.parent_run_id,
    queued_at: new Date(runRecord.queued_at),
    started_at: runRecord.started_at ? new Date(runRecord.started_at) : new Date(),
    completed_at: null,
    depends_on: runRecord.depends_on ?? [],
    blocks: runRecord.blocks ?? [],
    output_summary: null,
    output_data: null,
    error_message: null,
    session_id: runRecord.session_id,
    thought_ids: runRecord.thought_ids ?? [],
  };

  const systemPrompt = buildAgentSystemPrompt(agentType, runRecord.task_prompt);

  await eventLogger.log({
    category: 'agent_spawn',
    event_type: 'agent_resumed',
    data: {
      run_id: runId,
      agent_type: agentType.name,
      iteration_count_before_resume: runRecord.iteration_count,
    },
  });

  return {
    manifest,
    session,
    toolPool,
    permissionPolicy,
    budgetTracker,
    eventLogger,
    systemPrompt,
  };
}
```

---

## 6. Coordinator Layer

### 6.1 Coordinator Architecture

The coordinator is itself an agent (typically `general_purpose` with `can_spawn: true`) that manages multiple sub-agents. It resolves dependency graphs, dispatches agents in parallel waves, collects results, and aggregates them.

```
Coordinator Agent (general_purpose, can_spawn=true)
  |
  +-- DependencyGraph
  |     |-- resolveReadyAgents() -> agents with all deps satisfied
  |     |-- markComplete(runId) -> unblock dependent agents
  |     |-- detectCycles() -> prevent deadlocks
  |
  +-- WaveScheduler
  |     |-- Wave 0: [explore_a, explore_b]  (no deps)
  |     |-- Wave 1: [plan_a]                (depends on explore_a, explore_b)
  |     |-- Wave 2: [worker_a, worker_b]    (depends on plan_a)
  |     |-- Wave 3: [verification_a]        (depends on worker_a, worker_b)
  |
  +-- ResultAggregator
  |     |-- collectResults() -> merge outputs from completed agents
  |     |-- generateSummary() -> produce coordinator-level summary
  |
  +-- StatusTracker
        |-- getStatus() -> current state of all managed agents
        |-- getTimeline() -> ordered event history
```

### 6.2 Permission Handlers

Three handler types from BP01, now fully specified for the agent system.

```typescript
// permissions/handlers.ts

import { PermissionRequest, PermissionDecision } from './types';

/**
 * Interactive handler: prompts the human user.
 * Used for top-level user-facing sessions.
 */
export class InteractivePermissionHandler {
  async decide(request: PermissionRequest): Promise<PermissionDecision> {
    // Display prompt to user via CLI/UI
    // Wait for user input: allow / deny / allow-always
    // Return decision
    return await promptUser(request);
  }
}

/**
 * Coordinator handler: policy-only decisions, never prompts.
 * Used for sub-agents spawned by a coordinator.
 * The coordinator has already decided what tools the sub-agent gets.
 */
export class CoordinatorPermissionHandler {
  private allowedTools: Set<string>;

  constructor(allowedTools: string[]) {
    this.allowedTools = new Set(allowedTools.map(t => t.toLowerCase()));
  }

  decide(request: PermissionRequest): PermissionDecision {
    // Pure policy: no user interaction
    if (this.allowedTools.size === 0) {
      // Empty allow list = all tools at the agent's permission level
      return { allowed: true };
    }

    if (this.allowedTools.has(request.tool_name.toLowerCase())) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Agent type does not have access to tool "${request.tool_name}"`,
    };
  }
}

/**
 * Swarm worker handler: most restrictive, for background workers.
 * Only allows explicitly listed tools, with no escalation path.
 */
export class SwarmWorkerPermissionHandler {
  private allowedTools: Set<string>;

  constructor(allowedTools: string[]) {
    this.allowedTools = new Set(allowedTools.map(t => t.toLowerCase()));
  }

  decide(request: PermissionRequest): PermissionDecision {
    if (this.allowedTools.has(request.tool_name.toLowerCase())) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Swarm worker restricted: "${request.tool_name}" not in allowlist`,
    };
  }
}

/** Factory: select handler based on agent type configuration */
export function createPermissionHandler(
  agentType: AgentTypeDefinition,
): InteractivePermissionHandler | CoordinatorPermissionHandler | SwarmWorkerPermissionHandler {
  switch (agentType.handler_type) {
    case 'interactive':
      return new InteractivePermissionHandler();
    case 'coordinator':
      return new CoordinatorPermissionHandler(agentType.allowed_tools);
    case 'swarm_worker':
      return new SwarmWorkerPermissionHandler(agentType.allowed_tools);
  }
}
```

### 6.3 Dependency Graph

This is what Claude Code **lacks** -- we add the ability to express and resolve agent dependencies.

```typescript
// coordinator/dependency-graph.ts

export interface DagNode {
  run_id: string;
  agent_type: string;
  depends_on: string[];    // run_ids this node waits for
  status: AgentStatus;
}

export class DependencyGraph {
  private nodes: Map<string, DagNode> = new Map();

  /** Add an agent to the graph */
  addNode(node: DagNode): void {
    // Validate: all dependencies must exist (or will be added later)
    this.nodes.set(node.run_id, node);
  }

  /** Get agents that are ready to run (all dependencies satisfied) */
  getReady(): DagNode[] {
    const ready: DagNode[] = [];

    for (const node of this.nodes.values()) {
      if (node.status !== 'pending') continue;

      const allDepsSatisfied = node.depends_on.every(depId => {
        const dep = this.nodes.get(depId);
        return dep && dep.status === 'completed';
      });

      if (allDepsSatisfied) {
        ready.push(node);
      }
    }

    return ready;
  }

  /** Mark an agent as complete and check what it unblocks */
  markComplete(runId: string): DagNode[] {
    const node = this.nodes.get(runId);
    if (!node) return [];

    node.status = 'completed';

    // Return newly unblocked nodes
    return this.getReady();
  }

  /** Mark an agent as failed. Check if this blocks anything that cannot proceed. */
  markFailed(runId: string): DagNode[] {
    const node = this.nodes.get(runId);
    if (!node) return [];

    node.status = 'failed';

    // Find all nodes that transitively depend on this failed node
    const blocked: DagNode[] = [];
    for (const n of this.nodes.values()) {
      if (n.status !== 'pending') continue;
      if (this.transitivelyDependsOn(n.run_id, runId)) {
        blocked.push(n);
      }
    }

    return blocked;
  }

  /** Detect cycles in the dependency graph (prevents deadlocks) */
  detectCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (nodeId: string, path: string[]): void => {
      if (inStack.has(nodeId)) {
        // Found a cycle
        const cycleStart = path.indexOf(nodeId);
        cycles.push(path.slice(cycleStart));
        return;
      }
      if (visited.has(nodeId)) return;

      visited.add(nodeId);
      inStack.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        for (const depId of node.depends_on) {
          dfs(depId, [...path, nodeId]);
        }
      }

      inStack.delete(nodeId);
    };

    for (const nodeId of this.nodes.keys()) {
      dfs(nodeId, []);
    }

    return cycles;
  }

  /** Group nodes into execution waves (parallel batches) */
  toWaves(): DagNode[][] {
    const waves: DagNode[][] = [];
    const completed = new Set<string>();
    const remaining = new Set(this.nodes.keys());

    while (remaining.size > 0) {
      const wave: DagNode[] = [];

      for (const nodeId of remaining) {
        const node = this.nodes.get(nodeId)!;
        const allDepsDone = node.depends_on.every(d => completed.has(d));
        if (allDepsDone) {
          wave.push(node);
        }
      }

      if (wave.length === 0 && remaining.size > 0) {
        // Deadlock: remaining nodes have unresolvable dependencies
        throw new Error(
          `Dependency deadlock: ${remaining.size} nodes cannot be scheduled. ` +
          `Stuck: ${[...remaining].join(', ')}`
        );
      }

      for (const node of wave) {
        remaining.delete(node.run_id);
        completed.add(node.run_id);
      }

      waves.push(wave);
    }

    return waves;
  }

  /** Get a summary of the graph state */
  getSummary(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    wave_count: number;
  } {
    let pending = 0, running = 0, completed = 0, failed = 0;
    for (const node of this.nodes.values()) {
      switch (node.status) {
        case 'pending': pending++; break;
        case 'running': running++; break;
        case 'completed': completed++; break;
        case 'failed':
        case 'cancelled':
        case 'timeout': failed++; break;
      }
    }

    let waveCount = 0;
    try { waveCount = this.toWaves().length; } catch { /* cycle */ }

    return { total: this.nodes.size, pending, running, completed, failed, wave_count: waveCount };
  }

  private transitivelyDependsOn(nodeId: string, targetId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    for (const depId of node.depends_on) {
      if (depId === targetId) return true;
      if (this.transitivelyDependsOn(depId, targetId)) return true;
    }

    return false;
  }
}
```

### 6.4 Coordinator Implementation

```typescript
// coordinator/coordinator.ts

import { DependencyGraph, DagNode } from './dependency-graph';
import { AgentRegistry } from '../agents/agent-registry';
import { forkSubAgent, ForkConfig } from '../agents/fork';
import { runAgent, AgentExecutionConfig } from '../agents/run-agent';
import { AgentResult, AgentRunManifest } from '../agents/lifecycle';
import { InterAgentBus } from './inter-agent-bus';

export interface CoordinatorConfig {
  coordinator_run_id: string;
  supabase: SupabaseClient;
  apiClient: AnthropicClient;
  agentRegistry: AgentRegistry;
  allTools: ToolSpec[];
  model?: string;

  // Execution mode
  mode: 'sequential' | 'parallel_waves' | 'fire_and_forget';

  // Concurrency limits
  max_concurrent_agents: number;  // default: 5
}

export interface AgentSpawnRequest {
  agent_type: string;
  task_prompt: string;
  task_context?: Record<string, unknown>;
  depends_on?: string[];    // run_ids of agents that must complete first
  budget_override?: Partial<BudgetConfig>;
}

/**
 * Coordinator: manages multi-agent execution with dependency resolution.
 *
 * This is the OB1 implementation of what Claude Code's coordinatorMode.ts
 * does, but with three major additions:
 * 1. Dependency graph with wave-based scheduling
 * 2. Inter-agent communication via thoughts table
 * 3. Durable state persistence (survives crashes)
 */
export class Coordinator {
  private config: CoordinatorConfig;
  private dag: DependencyGraph;
  private bus: InterAgentBus;
  private activeRuntimes: Map<string, Promise<AgentResult>> = new Map();
  private results: Map<string, AgentResult> = new Map();
  private manifests: Map<string, AgentRunManifest> = new Map();

  constructor(config: CoordinatorConfig) {
    this.config = config;
    this.dag = new DependencyGraph();
    this.bus = new InterAgentBus(config.supabase, config.coordinator_run_id);
  }

  /**
   * Add an agent to the execution plan.
   * Does not start execution -- call execute() or fireAndForget() for that.
   */
  async plan(request: AgentSpawnRequest): Promise<string> {
    const agentType = this.config.agentRegistry.get(request.agent_type);

    const runtime = await forkSubAgent(this.config.supabase, this.config.allTools, {
      agent_type: agentType,
      task_prompt: request.task_prompt,
      task_context: request.task_context,
      coordinator_run_id: this.config.coordinator_run_id,
      depends_on: request.depends_on,
      budget_config: request.budget_override,
      model: this.config.model,
    });

    const runId = runtime.manifest.run_id;
    this.manifests.set(runId, runtime.manifest);

    // Add to dependency graph
    this.dag.addNode({
      run_id: runId,
      agent_type: request.agent_type,
      depends_on: request.depends_on ?? [],
      status: 'pending',
    });

    return runId;
  }

  /**
   * Execute all planned agents respecting the dependency graph.
   * Runs agents in parallel waves: each wave starts only when all
   * dependencies from previous waves are satisfied.
   */
  async execute(): Promise<Map<string, AgentResult>> {
    // Validate: no cycles
    const cycles = this.dag.detectCycles();
    if (cycles.length > 0) {
      throw new Error(
        `Dependency cycle detected: ${cycles.map(c => c.join(' -> ')).join('; ')}`
      );
    }

    // Get execution waves
    const waves = this.dag.toWaves();

    for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
      const wave = waves[waveIdx];

      await this.config.supabase.from('system_events').insert({
        session_id: this.config.coordinator_run_id,
        category: 'coordinator',
        event_type: 'wave_started',
        data: {
          wave_index: waveIdx,
          wave_size: wave.length,
          agents: wave.map(n => ({ run_id: n.run_id, type: n.agent_type })),
        },
      });

      // Execute wave: run all agents in this wave concurrently
      const wavePromises: Promise<AgentResult>[] = [];

      for (const node of wave) {
        // Re-fork the runtime (the manifest was created during plan())
        const agentType = this.config.agentRegistry.get(node.agent_type);
        const runtime = await forkSubAgent(this.config.supabase, this.config.allTools, {
          agent_type: agentType,
          task_prompt: this.manifests.get(node.run_id)!.task_prompt,
          task_context: this.manifests.get(node.run_id)!.task_context,
          coordinator_run_id: this.config.coordinator_run_id,
          depends_on: node.depends_on,
          model: this.config.model,
        });

        // Inject results from completed dependencies into the task context
        const depResults = this.gatherDependencyResults(node.depends_on);
        if (Object.keys(depResults).length > 0) {
          runtime.session.appendMessage({
            role: 'user',
            content: `## Results from prior agents\n\n${JSON.stringify(depResults, null, 2)}`,
          });
        }

        const promise = runAgent(runtime, {
          supabase: this.config.supabase,
          apiClient: this.config.apiClient,
          onStatusChange: (runId, status) => {
            if (status === 'completed') {
              this.dag.markComplete(runId);
            } else if (status === 'failed') {
              this.dag.markFailed(runId);
            }
          },
        });

        wavePromises.push(promise);
        this.activeRuntimes.set(node.run_id, promise);
      }

      // Await all agents in this wave
      const waveResults = await Promise.allSettled(wavePromises);

      for (let i = 0; i < wave.length; i++) {
        const result = waveResults[i];
        const runId = wave[i].run_id;

        if (result.status === 'fulfilled') {
          this.results.set(runId, result.value);
        } else {
          this.results.set(runId, {
            run_id: runId,
            agent_type_name: wave[i].agent_type,
            status: 'failed',
            output_summary: '',
            output_data: {},
            error_message: result.reason?.message ?? 'Unknown error',
            duration_ms: 0,
            total_cost_usd: 0,
            thought_ids: [],
          });
        }

        this.activeRuntimes.delete(runId);
      }
    }

    return this.results;
  }

  /**
   * Fire-and-forget: spawn an agent without waiting for completion.
   * The caller can poll status via getStatus().
   */
  async fireAndForget(request: AgentSpawnRequest): Promise<string> {
    const agentType = this.config.agentRegistry.get(request.agent_type);

    const runtime = await forkSubAgent(this.config.supabase, this.config.allTools, {
      agent_type: agentType,
      task_prompt: request.task_prompt,
      task_context: request.task_context,
      coordinator_run_id: this.config.coordinator_run_id,
      model: this.config.model,
    });

    const runId = runtime.manifest.run_id;

    // Start execution without awaiting
    const promise = runAgent(runtime, {
      supabase: this.config.supabase,
      apiClient: this.config.apiClient,
      onStatusChange: (id, status) => {
        if (status === 'completed') this.dag.markComplete(id);
        else if (status === 'failed') this.dag.markFailed(id);
      },
    });

    this.activeRuntimes.set(runId, promise);

    // Catch errors to prevent unhandled rejections
    promise
      .then(result => {
        this.results.set(runId, result);
        this.activeRuntimes.delete(runId);
      })
      .catch(err => {
        this.results.set(runId, {
          run_id: runId,
          agent_type_name: agentType.name,
          status: 'failed',
          output_summary: '',
          output_data: {},
          error_message: (err as Error).message,
          duration_ms: 0,
          total_cost_usd: 0,
          thought_ids: [],
        });
        this.activeRuntimes.delete(runId);
      });

    return runId;
  }

  /** Get the current status of all agents managed by this coordinator. */
  getStatus(): {
    agents: Array<{
      run_id: string;
      agent_type: string;
      status: AgentStatus;
      duration_ms?: number;
    }>;
    dag_summary: ReturnType<DependencyGraph['getSummary']>;
    active_count: number;
    completed_count: number;
  } {
    const agents = [];
    for (const [runId, manifest] of this.manifests) {
      const result = this.results.get(runId);
      agents.push({
        run_id: runId,
        agent_type: manifest.agent_type_name,
        status: result?.status ?? manifest.status,
        duration_ms: result?.duration_ms,
      });
    }

    return {
      agents,
      dag_summary: this.dag.getSummary(),
      active_count: this.activeRuntimes.size,
      completed_count: this.results.size,
    };
  }

  /** Collect all completed results. */
  getResults(): Map<string, AgentResult> {
    return new Map(this.results);
  }

  /** Wait for all active agents to complete. */
  async awaitAll(): Promise<void> {
    await Promise.allSettled(Array.from(this.activeRuntimes.values()));
  }

  /** Cancel a specific agent run. */
  async cancel(runId: string): Promise<void> {
    // Set status to cancelled in database
    await this.config.supabase
      .from('agent_runs')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('run_id', runId);

    // Mark in DAG
    this.dag.markFailed(runId);

    // Note: the actual execution Promise cannot be cancelled in JS.
    // The agent will continue running but its results will be discarded.
    // A more sophisticated implementation would use AbortController.
  }

  // ── Private ──────────────────────────────────────────────

  private gatherDependencyResults(depRunIds: string[]): Record<string, unknown> {
    const results: Record<string, unknown> = {};
    for (const depId of depRunIds) {
      const result = this.results.get(depId);
      if (result && result.status === 'completed') {
        results[depId] = {
          agent_type: result.agent_type_name,
          summary: result.output_summary,
          data: result.output_data,
        };
      }
    }
    return results;
  }
}
```

---

## 7. Inter-Agent Communication

This is entirely new -- Claude Code has no inter-agent communication beyond result collection. OB1 adds three communication mechanisms.

### 7.1 Message Passing via agent_messages Table

Direct message passing between agents within a coordinator session.

```typescript
// coordinator/inter-agent-bus.ts

import { SupabaseClient } from '@supabase/supabase-js';

export interface AgentMessage {
  from_run_id: string;
  to_run_id: string | null;  // null = broadcast
  channel: string;
  message_type: 'data' | 'finding' | 'request' | 'status_update' | 'error' | 'completion';
  content: Record<string, unknown>;
  summary: string;
}

/**
 * Inter-agent communication bus backed by Supabase.
 *
 * Agents use this to send messages to each other within a coordinator session.
 * Messages are persisted in the agent_messages table and can optionally be
 * materialized as thoughts for cross-session persistence.
 */
export class InterAgentBus {
  private supabase: SupabaseClient;
  private coordinatorRunId: string;

  constructor(supabase: SupabaseClient, coordinatorRunId: string) {
    this.supabase = supabase;
    this.coordinatorRunId = coordinatorRunId;
  }

  /** Send a message from one agent to another (or broadcast). */
  async send(message: AgentMessage): Promise<string> {
    const { data, error } = await this.supabase
      .from('agent_messages')
      .insert({
        coordinator_run_id: this.coordinatorRunId,
        from_run_id: message.from_run_id,
        to_run_id: message.to_run_id,
        channel: message.channel,
        message_type: message.message_type,
        content: message.content,
        summary: message.summary,
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to send agent message: ${error.message}`);
    }

    // Log the event
    await this.supabase.from('system_events').insert({
      session_id: this.coordinatorRunId,
      category: 'agent_message',
      event_type: 'message_sent',
      data: {
        message_id: data.id,
        from: message.from_run_id,
        to: message.to_run_id ?? 'broadcast',
        channel: message.channel,
        type: message.message_type,
      },
    });

    return data.id;
  }

  /** Receive undelivered messages for a specific agent. */
  async receive(
    runId: string,
    options?: { channel?: string; limit?: number },
  ): Promise<Array<AgentMessage & { id: string; created_at: string }>> {
    let query = this.supabase
      .from('agent_messages')
      .select('*')
      .eq('coordinator_run_id', this.coordinatorRunId)
      .eq('delivered', false)
      .or(`to_run_id.eq.${runId},to_run_id.is.null`)  // direct + broadcast
      .order('created_at', { ascending: true });

    if (options?.channel) {
      query = query.eq('channel', options.channel);
    }
    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to receive agent messages: ${error.message}`);
    }

    // Mark as delivered
    if (data && data.length > 0) {
      const ids = data.map((m: { id: string }) => m.id);
      await this.supabase
        .from('agent_messages')
        .update({ delivered: true, delivered_at: new Date().toISOString() })
        .in('id', ids);
    }

    return data ?? [];
  }

  /** Acknowledge receipt of a message. */
  async acknowledge(messageId: string): Promise<void> {
    await this.supabase
      .from('agent_messages')
      .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
      .eq('id', messageId);
  }

  /** Get all messages for a channel (for debugging / aggregation). */
  async getChannelHistory(
    channel: string,
  ): Promise<Array<AgentMessage & { id: string; created_at: string }>> {
    const { data, error } = await this.supabase
      .from('agent_messages')
      .select('*')
      .eq('coordinator_run_id', this.coordinatorRunId)
      .eq('channel', channel)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to get channel history: ${error.message}`);
    }

    return data ?? [];
  }
}
```

### 7.2 Shared Context via OB1 Thoughts Table

Agents persist their findings as thoughts. Other agents (or future sessions) can query these thoughts for context. This is the durable, cross-session version of inter-agent communication.

```typescript
// coordinator/shared-context.ts

import { SupabaseClient } from '@supabase/supabase-js';

export interface AgentThought {
  content: string;
  metadata: {
    source_agent_run_id: string;
    source_agent_type: string;
    coordinator_run_id: string;
    thought_type: 'finding' | 'plan' | 'verification_result' | 'decision' | 'summary';
    tags: string[];
    relevance_score?: number;
  };
}

/**
 * Shared context layer: agents publish findings as thoughts
 * and query previous agents' thoughts for context.
 *
 * This uses the OB1 core thoughts table (not modified -- only inserted into).
 * The metadata JSONB field carries agent-specific context.
 */
export class SharedAgentContext {
  private supabase: SupabaseClient;
  private coordinatorRunId: string;

  constructor(supabase: SupabaseClient, coordinatorRunId: string) {
    this.supabase = supabase;
    this.coordinatorRunId = coordinatorRunId;
  }

  /**
   * Publish a finding as a thought.
   * Returns the thought ID for cross-referencing.
   */
  async publish(thought: AgentThought): Promise<string> {
    const { data, error } = await this.supabase
      .from('thoughts')
      .insert({
        content: thought.content,
        metadata: {
          ...thought.metadata,
          coordinator_run_id: this.coordinatorRunId,
        },
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to publish agent thought: ${error.message}`);
    }

    // Also update the agent_runs record with this thought_id
    await this.supabase.rpc('array_append_unique', {
      table_name: 'agent_runs',
      column_name: 'thought_ids',
      filter_column: 'run_id',
      filter_value: thought.metadata.source_agent_run_id,
      append_value: data.id,
    });

    return data.id;
  }

  /**
   * Query thoughts from agents in this coordinator session.
   * Useful for a downstream agent to get findings from upstream agents.
   */
  async queryByCoordinator(options?: {
    agent_type?: string;
    thought_type?: string;
    tags?: string[];
    limit?: number;
  }): Promise<Array<{ id: string; content: string; metadata: Record<string, unknown>; created_at: string }>> {
    let query = this.supabase
      .from('thoughts')
      .select('id, content, metadata, created_at')
      .contains('metadata', { coordinator_run_id: this.coordinatorRunId })
      .order('created_at', { ascending: true });

    if (options?.agent_type) {
      query = query.contains('metadata', { source_agent_type: options.agent_type });
    }
    if (options?.thought_type) {
      query = query.contains('metadata', { thought_type: options.thought_type });
    }
    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to query agent thoughts: ${error.message}`);
    }

    return data ?? [];
  }

  /**
   * Query thoughts by specific agent run.
   */
  async queryByAgentRun(
    runId: string,
  ): Promise<Array<{ id: string; content: string; metadata: Record<string, unknown> }>> {
    const { data, error } = await this.supabase
      .from('thoughts')
      .select('id, content, metadata')
      .contains('metadata', { source_agent_run_id: runId })
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to query agent run thoughts: ${error.message}`);
    }

    return data ?? [];
  }

  /**
   * Semantic search across agent thoughts using pgvector.
   * Requires that the thoughts table has an embedding column (OB1 core feature).
   */
  async semanticSearch(
    queryText: string,
    options?: { limit?: number; similarity_threshold?: number },
  ): Promise<Array<{ id: string; content: string; metadata: Record<string, unknown>; similarity: number }>> {
    // This calls the OB1 core match_thoughts function (or equivalent)
    const { data, error } = await this.supabase.rpc('match_thoughts', {
      query_text: queryText,
      match_count: options?.limit ?? 10,
      filter_metadata: { coordinator_run_id: this.coordinatorRunId },
    });

    if (error) {
      throw new Error(`Failed to semantic search agent thoughts: ${error.message}`);
    }

    return (data ?? []).filter(
      (t: { similarity: number }) => t.similarity >= (options?.similarity_threshold ?? 0.5)
    );
  }
}
```

### 7.3 Result Aggregation

```typescript
// coordinator/result-aggregator.ts

import { AgentResult } from '../agents/lifecycle';

export interface AggregatedResults {
  total_agents: number;
  completed: number;
  failed: number;
  total_duration_ms: number;
  total_cost_usd: number;
  total_thought_ids: string[];

  // Per-type summaries
  by_type: Record<string, {
    count: number;
    completed: number;
    failed: number;
    summaries: string[];
    cost_usd: number;
  }>;

  // Combined output (concatenated summaries)
  combined_summary: string;

  // Structured findings (from structured_facts output agents)
  findings: Record<string, unknown>[];
}

export function aggregateResults(results: Map<string, AgentResult>): AggregatedResults {
  const byType: AggregatedResults['by_type'] = {};
  let totalDuration = 0;
  let totalCost = 0;
  const allThoughtIds: string[] = [];
  const allFindings: Record<string, unknown>[] = [];

  for (const result of results.values()) {
    totalDuration += result.duration_ms;
    totalCost += result.total_cost_usd;
    allThoughtIds.push(...result.thought_ids);

    // Accumulate by type
    if (!byType[result.agent_type_name]) {
      byType[result.agent_type_name] = {
        count: 0, completed: 0, failed: 0, summaries: [], cost_usd: 0,
      };
    }
    const typeGroup = byType[result.agent_type_name];
    typeGroup.count++;
    typeGroup.cost_usd += result.total_cost_usd;

    if (result.status === 'completed') {
      typeGroup.completed++;
      typeGroup.summaries.push(result.output_summary);

      // Extract structured findings if output_data has them
      if (result.output_data?.findings) {
        allFindings.push(...(result.output_data.findings as Record<string, unknown>[]));
      }
    } else {
      typeGroup.failed++;
    }
  }

  const completed = Array.from(results.values()).filter(r => r.status === 'completed').length;
  const failed = results.size - completed;

  const combinedSummary = Array.from(results.values())
    .filter(r => r.status === 'completed')
    .map(r => `### ${r.agent_type_name} (${r.run_id})\n${r.output_summary}`)
    .join('\n\n---\n\n');

  return {
    total_agents: results.size,
    completed,
    failed,
    total_duration_ms: totalDuration,
    total_cost_usd: totalCost,
    total_thought_ids: allThoughtIds,
    by_type: byType,
    combined_summary: combinedSummary,
    findings: allFindings,
  };
}
```

### 7.4 Agent Status Display

```typescript
// coordinator/status-display.ts

import { AgentStatus } from '../agents/lifecycle';

export interface AgentStatusEntry {
  run_id: string;
  agent_type: string;
  display_name: string;
  status: AgentStatus;
  color: string;
  started_at: Date | null;
  elapsed_ms: number;
  iteration_count: number;
  cost_usd: number;
}

/**
 * Format agent status for terminal or dashboard display.
 */
export function formatAgentStatus(
  entries: AgentStatusEntry[],
  format: 'terminal' | 'json' = 'terminal',
): string {
  if (format === 'json') {
    return JSON.stringify(entries, null, 2);
  }

  const STATUS_ICONS: Record<AgentStatus, string> = {
    pending:   '[ ]',
    running:   '[>]',
    completed: '[+]',
    failed:    '[x]',
    cancelled: '[-]',
    timeout:   '[!]',
  };

  const lines: string[] = [];
  lines.push('--- Agent Status ---');
  lines.push('');

  for (const entry of entries) {
    const icon = STATUS_ICONS[entry.status] ?? '[?]';
    const elapsed = entry.elapsed_ms > 0
      ? `${(entry.elapsed_ms / 1000).toFixed(1)}s`
      : '--';
    const cost = entry.cost_usd > 0
      ? `$${entry.cost_usd.toFixed(4)}`
      : '--';

    lines.push(
      `${icon} ${entry.display_name} (${entry.agent_type}) ` +
      `| ${elapsed} | ${entry.iteration_count} iter | ${cost}`
    );
  }

  lines.push('');

  const completed = entries.filter(e => e.status === 'completed').length;
  const running = entries.filter(e => e.status === 'running').length;
  const failed = entries.filter(e => ['failed', 'timeout', 'cancelled'].includes(e.status)).length;
  const totalCost = entries.reduce((sum, e) => sum + e.cost_usd, 0);

  lines.push(`Total: ${entries.length} agents | ${completed} done | ${running} active | ${failed} failed | $${totalCost.toFixed(4)}`);

  return lines.join('\n');
}
```

---

## 8. OB1 Integration

### 8.1 Agent Run History as Thoughts

Every completed agent run produces a summary thought. This makes agent work discoverable by future sessions via the standard OB1 thought retrieval and semantic search.

```typescript
// integration/agent-thoughts.ts

import { SupabaseClient } from '@supabase/supabase-js';
import { AgentResult } from '../agents/lifecycle';

/**
 * Persist an agent's completed run as an OB1 thought.
 * The thought content is the agent's summary, and metadata links
 * back to the full run record for detailed inspection.
 */
export async function persistAgentRunAsThought(
  supabase: SupabaseClient,
  result: AgentResult,
  coordinatorRunId: string,
): Promise<string | null> {
  if (!result.output_summary || result.status !== 'completed') {
    return null;
  }

  const content = [
    `## Agent Run: ${result.agent_type_name}`,
    '',
    result.output_summary,
    '',
    `---`,
    `Run ID: ${result.run_id}`,
    `Duration: ${(result.duration_ms / 1000).toFixed(1)}s`,
    `Cost: $${result.total_cost_usd.toFixed(4)}`,
  ].join('\n');

  const { data, error } = await supabase
    .from('thoughts')
    .insert({
      content,
      metadata: {
        type: 'agent_run_summary',
        source_agent_run_id: result.run_id,
        source_agent_type: result.agent_type_name,
        coordinator_run_id: coordinatorRunId,
        status: result.status,
        duration_ms: result.duration_ms,
        cost_usd: result.total_cost_usd,
        thought_type: 'summary',
        tags: ['agent', result.agent_type_name, 'auto-generated'],
      },
    })
    .select('id')
    .single();

  if (error) {
    console.error('Failed to persist agent run as thought:', error.message);
    return null;
  }

  return data.id;
}
```

### 8.2 Team-Architect Skill Mapping

The `team-architect` skill (available as a Claude Code skill pack) maps directly to this system. The skill's agent team planning translates to coordinator configuration.

```typescript
// integration/team-architect-adapter.ts

import { Coordinator, AgentSpawnRequest } from '../coordinator/coordinator';

/**
 * Adapter that translates team-architect skill output
 * into Coordinator spawn requests.
 *
 * The team-architect skill produces a team plan like:
 * {
 *   agents: [
 *     { role: "explore", task: "...", depends_on: [] },
 *     { role: "plan", task: "...", depends_on: ["explore_1"] },
 *     { role: "worker", task: "...", depends_on: ["plan_1"] },
 *   ]
 * }
 *
 * This adapter converts that into Coordinator spawn requests.
 */
export interface TeamArchitectPlan {
  agents: Array<{
    id: string;
    role: string;       // maps to agent_type_name
    task: string;
    depends_on: string[];
    context?: Record<string, unknown>;
  }>;
}

const ROLE_TO_AGENT_TYPE: Record<string, string> = {
  explore: 'explore',
  explorer: 'explore',
  research: 'explore',
  plan: 'plan',
  planner: 'plan',
  architect: 'plan',
  verify: 'verification',
  verifier: 'verification',
  test: 'verification',
  tester: 'verification',
  guide: 'guide',
  helper: 'guide',
  worker: 'general_purpose',
  implement: 'general_purpose',
  coder: 'general_purpose',
  status: 'statusline',
};

export async function executeTeamArchitectPlan(
  coordinator: Coordinator,
  plan: TeamArchitectPlan,
): Promise<void> {
  // First pass: create all agents and map plan IDs to run IDs
  const planIdToRunId = new Map<string, string>();

  for (const agent of plan.agents) {
    const agentType = ROLE_TO_AGENT_TYPE[agent.role.toLowerCase()] ?? 'general_purpose';

    // Resolve dependencies from plan IDs to run IDs
    const resolvedDeps = agent.depends_on
      .map(depId => planIdToRunId.get(depId))
      .filter((id): id is string => id !== undefined);

    const runId = await coordinator.plan({
      agent_type: agentType,
      task_prompt: agent.task,
      task_context: agent.context,
      depends_on: resolvedDeps,
    });

    planIdToRunId.set(agent.id, runId);
  }

  // Second pass: execute the plan
  await coordinator.execute();
}
```

---

## 9. Edge Function Endpoints

### 9.1 Agent Management MCP Server

```typescript
// supabase/functions/ob1-agent-manager/index.ts

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // MCP protocol handler
  const body = await req.json();
  const { method, params } = body;

  switch (method) {
    // ── Agent Type Management ────────────────────────────

    case 'agent_types/list':
      return await handleListAgentTypes(supabase, params);

    case 'agent_types/get':
      return await handleGetAgentType(supabase, params);

    case 'agent_types/register':
      return await handleRegisterAgentType(supabase, params);

    // ── Agent Run Management ─────────────────────────────

    case 'agent_runs/spawn':
      return await handleSpawnAgent(supabase, params);

    case 'agent_runs/status':
      return await handleGetRunStatus(supabase, params);

    case 'agent_runs/list':
      return await handleListRuns(supabase, params);

    case 'agent_runs/cancel':
      return await handleCancelRun(supabase, params);

    case 'agent_runs/results':
      return await handleGetResults(supabase, params);

    // ── Coordinator ──────────────────────────────────────

    case 'coordinator/plan':
      return await handleCoordinatorPlan(supabase, params);

    case 'coordinator/execute':
      return await handleCoordinatorExecute(supabase, params);

    case 'coordinator/status':
      return await handleCoordinatorStatus(supabase, params);

    // ── Inter-Agent Communication ────────────────────────

    case 'agent_messages/send':
      return await handleSendMessage(supabase, params);

    case 'agent_messages/receive':
      return await handleReceiveMessages(supabase, params);

    case 'agent_messages/history':
      return await handleMessageHistory(supabase, params);

    default:
      return jsonResponse({ error: `Unknown method: ${method}` }, 400);
  }
});

// ── Handler Implementations ──────────────────────────────

async function handleListAgentTypes(
  supabase: SupabaseClient,
  params: { source?: string; enabled_only?: boolean },
) {
  let query = supabase.from('agent_types').select('*');

  if (params.enabled_only !== false) {
    query = query.eq('enabled', true);
  }
  if (params.source) {
    query = query.eq('source', params.source);
  }

  const { data, error } = await query.order('name');

  if (error) return jsonResponse({ error: error.message }, 500);
  return jsonResponse({ agent_types: data });
}

async function handleGetAgentType(
  supabase: SupabaseClient,
  params: { name: string },
) {
  const { data, error } = await supabase
    .from('agent_types')
    .select('*')
    .eq('name', params.name)
    .single();

  if (error) return jsonResponse({ error: error.message }, 404);
  return jsonResponse({ agent_type: data });
}

async function handleRegisterAgentType(
  supabase: SupabaseClient,
  params: AgentTypeDefinition,
) {
  const { data, error } = await supabase
    .from('agent_types')
    .upsert(
      {
        name: params.name,
        display_name: params.display_name,
        description: params.description,
        source: params.source ?? 'custom',
        permission_mode: params.permission_mode,
        allowed_tools: params.allowed_tools,
        denied_tools: params.denied_tools,
        denied_prefixes: params.denied_prefixes ?? [],
        system_prompt: params.system_prompt,
        constraints: params.constraints,
        max_iterations: params.max_iterations,
        output_format: params.output_format,
        handler_type: params.handler_type,
        color: params.color,
        icon: params.icon,
        can_spawn: params.can_spawn ?? false,
        metadata: params.metadata ?? {},
        enabled: true,
      },
      { onConflict: 'name' },
    )
    .select()
    .single();

  if (error) return jsonResponse({ error: error.message }, 500);
  return jsonResponse({ agent_type: data, created: true });
}

async function handleSpawnAgent(
  supabase: SupabaseClient,
  params: {
    agent_type: string;
    task_prompt: string;
    task_context?: Record<string, unknown>;
    coordinator_run_id?: string;
    depends_on?: string[];
  },
) {
  // Look up the agent type
  const { data: agentType, error: typeError } = await supabase
    .from('agent_types')
    .select('*')
    .eq('name', params.agent_type)
    .eq('enabled', true)
    .single();

  if (typeError || !agentType) {
    return jsonResponse({ error: `Unknown agent type: ${params.agent_type}` }, 404);
  }

  // Create the run record
  const runId = `agent_${params.agent_type}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      run_id: runId,
      agent_type_id: agentType.id,
      agent_type_name: params.agent_type,
      task_prompt: params.task_prompt,
      task_context: params.task_context ?? {},
      status: 'pending',
      coordinator_run_id: params.coordinator_run_id,
      depends_on: params.depends_on ?? [],
      max_iterations_used: agentType.max_iterations,
    })
    .select()
    .single();

  if (error) return jsonResponse({ error: error.message }, 500);

  return jsonResponse({
    run_id: runId,
    agent_type: params.agent_type,
    status: 'pending',
    message: 'Agent spawned. Poll agent_runs/status for updates.',
  });
}

async function handleGetRunStatus(
  supabase: SupabaseClient,
  params: { run_id: string },
) {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('run_id', params.run_id)
    .single();

  if (error) return jsonResponse({ error: error.message }, 404);
  return jsonResponse({ run: data });
}

async function handleListRuns(
  supabase: SupabaseClient,
  params: {
    coordinator_run_id?: string;
    status?: string;
    agent_type?: string;
    limit?: number;
  },
) {
  let query = supabase
    .from('agent_runs')
    .select('*')
    .order('created_at', { ascending: false });

  if (params.coordinator_run_id) {
    query = query.eq('coordinator_run_id', params.coordinator_run_id);
  }
  if (params.status) {
    query = query.eq('status', params.status);
  }
  if (params.agent_type) {
    query = query.eq('agent_type_name', params.agent_type);
  }
  if (params.limit) {
    query = query.limit(params.limit);
  }

  const { data, error } = await query;

  if (error) return jsonResponse({ error: error.message }, 500);
  return jsonResponse({ runs: data });
}

async function handleCancelRun(
  supabase: SupabaseClient,
  params: { run_id: string },
) {
  const { error } = await supabase
    .from('agent_runs')
    .update({
      status: 'cancelled',
      completed_at: new Date().toISOString(),
      error_message: 'Cancelled by coordinator',
    })
    .eq('run_id', params.run_id)
    .in('status', ['pending', 'running']);

  if (error) return jsonResponse({ error: error.message }, 500);
  return jsonResponse({ cancelled: true });
}

async function handleGetResults(
  supabase: SupabaseClient,
  params: { run_id?: string; coordinator_run_id?: string },
) {
  let query = supabase
    .from('agent_runs')
    .select('run_id, agent_type_name, status, output_summary, output_data, error_message, duration_ms, total_cost_usd, thought_ids')
    .in('status', ['completed', 'failed', 'timeout']);

  if (params.run_id) {
    query = query.eq('run_id', params.run_id);
  } else if (params.coordinator_run_id) {
    query = query.eq('coordinator_run_id', params.coordinator_run_id);
  }

  const { data, error } = await query;

  if (error) return jsonResponse({ error: error.message }, 500);
  return jsonResponse({ results: data });
}

async function handleCoordinatorPlan(
  supabase: SupabaseClient,
  params: {
    agents: Array<{
      id: string;
      agent_type: string;
      task: string;
      depends_on: string[];
      context?: Record<string, unknown>;
    }>;
  },
) {
  // Create a coordinator run
  const coordinatorRunId = `coord_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // Create run records for all agents
  const runIds: Record<string, string> = {};

  for (const agent of params.agents) {
    const runId = `agent_${agent.agent_type}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    runIds[agent.id] = runId;
  }

  // Resolve dependencies and insert
  for (const agent of params.agents) {
    const resolvedDeps = agent.depends_on
      .map(depId => runIds[depId])
      .filter(Boolean);

    // Look up agent type
    const { data: agentType } = await supabase
      .from('agent_types')
      .select('id')
      .eq('name', agent.agent_type)
      .single();

    await supabase.from('agent_runs').insert({
      run_id: runIds[agent.id],
      agent_type_id: agentType?.id,
      agent_type_name: agent.agent_type,
      task_prompt: agent.task,
      task_context: agent.context ?? {},
      status: 'pending',
      coordinator_run_id: coordinatorRunId,
      depends_on: resolvedDeps,
    });
  }

  return jsonResponse({
    coordinator_run_id: coordinatorRunId,
    agents: Object.entries(runIds).map(([planId, runId]) => ({ plan_id: planId, run_id: runId })),
    status: 'planned',
    message: 'Plan created. Call coordinator/execute to start.',
  });
}

async function handleCoordinatorExecute(
  supabase: SupabaseClient,
  params: { coordinator_run_id: string },
) {
  // This is a long-running operation -- in production, this would
  // trigger a background worker (Supabase pg_cron or Edge Function invocation).
  // For the blueprint, we return immediately and let the client poll.

  // Mark all pending agents as "queued for execution"
  await supabase
    .from('agent_runs')
    .update({ status: 'pending' })
    .eq('coordinator_run_id', params.coordinator_run_id)
    .eq('status', 'pending');

  return jsonResponse({
    coordinator_run_id: params.coordinator_run_id,
    status: 'executing',
    message: 'Execution started. Poll coordinator/status for progress.',
  });
}

async function handleCoordinatorStatus(
  supabase: SupabaseClient,
  params: { coordinator_run_id: string },
) {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('run_id, agent_type_name, status, started_at, completed_at, duration_ms, total_cost_usd, error_message')
    .eq('coordinator_run_id', params.coordinator_run_id)
    .order('created_at');

  if (error) return jsonResponse({ error: error.message }, 500);

  const agents = data ?? [];
  const summary = {
    total: agents.length,
    pending: agents.filter(a => a.status === 'pending').length,
    running: agents.filter(a => a.status === 'running').length,
    completed: agents.filter(a => a.status === 'completed').length,
    failed: agents.filter(a => ['failed', 'timeout', 'cancelled'].includes(a.status)).length,
    total_cost_usd: agents.reduce((sum, a) => sum + Number(a.total_cost_usd ?? 0), 0),
  };

  return jsonResponse({ coordinator_run_id: params.coordinator_run_id, agents, summary });
}

async function handleSendMessage(
  supabase: SupabaseClient,
  params: {
    coordinator_run_id: string;
    from_run_id: string;
    to_run_id?: string;
    channel?: string;
    message_type: string;
    content: Record<string, unknown>;
    summary?: string;
  },
) {
  const { data, error } = await supabase
    .from('agent_messages')
    .insert({
      coordinator_run_id: params.coordinator_run_id,
      from_run_id: params.from_run_id,
      to_run_id: params.to_run_id ?? null,
      channel: params.channel ?? 'default',
      message_type: params.message_type,
      content: params.content,
      summary: params.summary,
    })
    .select('id')
    .single();

  if (error) return jsonResponse({ error: error.message }, 500);
  return jsonResponse({ message_id: data.id, sent: true });
}

async function handleReceiveMessages(
  supabase: SupabaseClient,
  params: {
    coordinator_run_id: string;
    run_id: string;
    channel?: string;
    limit?: number;
  },
) {
  let query = supabase
    .from('agent_messages')
    .select('*')
    .eq('coordinator_run_id', params.coordinator_run_id)
    .eq('delivered', false)
    .or(`to_run_id.eq.${params.run_id},to_run_id.is.null`)
    .order('created_at');

  if (params.channel) query = query.eq('channel', params.channel);
  if (params.limit) query = query.limit(params.limit);

  const { data, error } = await query;

  if (error) return jsonResponse({ error: error.message }, 500);

  // Mark as delivered
  if (data && data.length > 0) {
    await supabase
      .from('agent_messages')
      .update({ delivered: true, delivered_at: new Date().toISOString() })
      .in('id', data.map((m: { id: string }) => m.id));
  }

  return jsonResponse({ messages: data ?? [] });
}

async function handleMessageHistory(
  supabase: SupabaseClient,
  params: { coordinator_run_id: string; channel?: string },
) {
  let query = supabase
    .from('agent_messages')
    .select('*')
    .eq('coordinator_run_id', params.coordinator_run_id)
    .order('created_at');

  if (params.channel) query = query.eq('channel', params.channel);

  const { data, error } = await query;

  if (error) return jsonResponse({ error: error.message }, 500);
  return jsonResponse({ messages: data ?? [] });
}

// ── Utility ──────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

### 9.2 REST Endpoint Summary

```
Agent Types:
  POST agent_types/list       -- List all registered agent types
  POST agent_types/get        -- Get a specific agent type by name
  POST agent_types/register   -- Register or update a custom agent type

Agent Runs:
  POST agent_runs/spawn       -- Spawn a new agent run
  POST agent_runs/status      -- Get status of a specific run
  POST agent_runs/list        -- List runs (filter by coordinator, status, type)
  POST agent_runs/cancel      -- Cancel a pending or running agent
  POST agent_runs/results     -- Get results from completed runs

Coordinator:
  POST coordinator/plan       -- Create a multi-agent execution plan with dependencies
  POST coordinator/execute    -- Start executing a planned coordination
  POST coordinator/status     -- Get status of all agents in a coordination

Messages:
  POST agent_messages/send    -- Send a message between agents
  POST agent_messages/receive -- Receive undelivered messages for an agent
  POST agent_messages/history -- Get full message history for a coordination
```

---

## 10. Build Order

### Phase 1: Schema (30 min)

1. Run the SQL migrations from Section 2 in order: `agent_types`, `agent_runs`, `agent_messages`, system_events extension
2. Verify tables created with correct constraints
3. Verify indexes exist
4. Verify RLS policies active

### Phase 2: Agent Type Definitions (1 hr)

5. Create `agents/types.ts` with the `AgentTypeDefinition` interface (Section 3.1)
6. Create `agents/built-in-types.ts` with the 6 built-in types (Section 3.2)
7. Create `agents/load-custom-agents.ts` with custom agent file parser (Section 3.4)
8. Test: parse a custom agent markdown file, verify all fields populated
9. Test: parse invalid file, verify graceful error handling

### Phase 3: Agent Registry (1 hr)

10. Create `agents/agent-registry.ts` (Section 4.1)
11. Test: `initialize()` registers all 6 built-in types
12. Test: `get('explore')` returns correct definition
13. Test: `register()` adds custom type, persists to Supabase
14. Test: `unregister()` disables custom type, cannot unregister built-in
15. Test: `listBySource('built_in')` returns exactly 6

### Phase 4: Fork & Lifecycle (1.5 hr)

16. Create `agents/lifecycle.ts` with types (Section 5.1)
17. Create `agents/fork.ts` with `forkSubAgent()` (Section 5.2)
18. Test: fork creates isolated session (no shared messages with parent)
19. Test: fork creates restricted tool pool (only allowed_tools available)
20. Test: fork creates independent budget tracker
21. Test: manifest persisted to `agent_runs` table with correct status

### Phase 5: Agent Execution (1.5 hr)

22. Create `agents/run-agent.ts` with `runAgent()` (Section 5.3)
23. Test: agent runs to completion, status transitions pending -> running -> completed
24. Test: max_iterations prevents infinite loop, status = 'timeout'
25. Test: agent failure caught, status = 'failed', error_message populated
26. Test: budget exhaustion stops agent, status = 'timeout'
27. Test: session persisted after each iteration
28. Create `agents/resume-agent.ts` (Section 5.4)
29. Test: resume reconstructs runtime from Supabase state

### Phase 6: Permission Handlers (45 min)

30. Create `permissions/handlers.ts` with three handler types (Section 6.2)
31. Test: `CoordinatorPermissionHandler` allows listed tools, denies unlisted
32. Test: `SwarmWorkerPermissionHandler` allows listed tools only
33. Test: `InteractivePermissionHandler` would prompt (mock test)
34. Test: `createPermissionHandler()` returns correct handler for each type

### Phase 7: Dependency Graph (1 hr)

35. Create `coordinator/dependency-graph.ts` (Section 6.3)
36. Test: linear chain A -> B -> C resolves to 3 waves
37. Test: parallel siblings [A, B] -> C resolves to 2 waves
38. Test: cycle detection finds A -> B -> A
39. Test: `markComplete()` unblocks dependent nodes
40. Test: `markFailed()` identifies transitively blocked nodes
41. Test: deadlock detection on unresolvable graph

### Phase 8: Coordinator (1.5 hr)

42. Create `coordinator/coordinator.ts` (Section 6.4)
43. Test: `plan()` + `execute()` runs agents in dependency order
44. Test: parallel agents in same wave run concurrently
45. Test: `fireAndForget()` returns immediately, result collectible later
46. Test: `getStatus()` returns correct counts during execution
47. Test: `cancel()` sets status to cancelled
48. Test: dependency results injected into downstream agent context

### Phase 9: Inter-Agent Communication (1.5 hr)

49. Create `coordinator/inter-agent-bus.ts` (Section 7.1)
50. Test: `send()` persists message to `agent_messages` table
51. Test: `receive()` returns undelivered messages, marks as delivered
52. Test: broadcast message (to_run_id = null) received by all agents
53. Test: channel-scoped message only received when channel matches
54. Create `coordinator/shared-context.ts` (Section 7.2)
55. Test: `publish()` creates thought with correct metadata
56. Test: `queryByCoordinator()` returns thoughts from same coordinator
57. Test: `semanticSearch()` finds relevant thoughts via pgvector
58. Create `coordinator/result-aggregator.ts` (Section 7.3)
59. Test: aggregation produces correct totals across multiple results

### Phase 10: Edge Function (1 hr)

60. Create `supabase/functions/ob1-agent-manager/index.ts` (Section 9.1)
61. Test: `agent_types/list` returns all 6 built-in types
62. Test: `agent_runs/spawn` creates run record with correct status
63. Test: `coordinator/plan` creates all run records with resolved dependencies
64. Test: `agent_messages/send` + `agent_messages/receive` round-trip
65. Test: all endpoints return 400/404 for invalid inputs

### Phase 11: Integration (1 hr)

66. Create `integration/agent-thoughts.ts` (Section 8.1)
67. Create `integration/team-architect-adapter.ts` (Section 8.2)
68. Create `coordinator/status-display.ts` (Section 7.4)
69. Test: `persistAgentRunAsThought()` creates thought with correct metadata
70. Test: `executeTeamArchitectPlan()` translates plan to coordinator operations
71. Test: `formatAgentStatus()` produces readable terminal output
72. Wire agent registry initialization into BP05 boot Phase 5

---

## 11. File Map

```
agents/
  types.ts                    -- AgentTypeDefinition interface
  built-in-types.ts           -- 6 built-in agent type definitions
  agent-registry.ts           -- Agent registry (Supabase-backed)
  load-custom-agents.ts       -- Custom agent loader from markdown files
  lifecycle.ts                -- AgentRunManifest, AgentResult types
  fork.ts                     -- forkSubAgent() context isolation
  run-agent.ts                -- runAgent() execution loop
  resume-agent.ts             -- resumeAgent() from persisted state

coordinator/
  coordinator.ts              -- Coordinator orchestration
  dependency-graph.ts         -- DAG with wave scheduling
  inter-agent-bus.ts          -- Message passing between agents
  shared-context.ts           -- Thoughts-based shared context
  result-aggregator.ts        -- Multi-agent result aggregation
  status-display.ts           -- Agent status formatting

permissions/
  handlers.ts                 -- Interactive, Coordinator, SwarmWorker handlers

integration/
  agent-thoughts.ts           -- Persist agent runs as OB1 thoughts
  team-architect-adapter.ts   -- team-architect skill -> coordinator adapter

supabase/functions/
  ob1-agent-manager/
    index.ts                  -- Edge Function for agent management MCP
```

---

## 12. Verification Checklist

### Agent Type System
- [ ] 6 built-in agent types registered in `agent_types` table
- [ ] Each type has correct `allowed_tools`, `denied_tools`, `permission_mode`
- [ ] Custom agents loadable from `.claude/agents/*.md` files
- [ ] Custom agent name collision with built-in blocked
- [ ] Agent registry syncs built-in types to Supabase on initialization
- [ ] Disabled types excluded from registry queries

### Agent Lifecycle
- [ ] `forkSubAgent()` creates isolated Session (no shared messages with parent)
- [ ] `forkSubAgent()` creates restricted ToolPool (only allowed_tools)
- [ ] `forkSubAgent()` creates independent BudgetTracker
- [ ] Sub-agent conversation history is isolated from parent
- [ ] `max_iterations` prevents infinite loops
- [ ] Agent status transitions: pending -> running -> completed/failed/timeout/cancelled
- [ ] Agent run persisted to `agent_runs` table at each status change
- [ ] `resumeAgent()` restores full runtime from Supabase

### Coordinator
- [ ] Coordinator permission handler never prompts the user
- [ ] Swarm worker handler strictly enforces allowlist
- [ ] Dependency graph detects cycles before execution
- [ ] Dependency graph resolves to correct wave order
- [ ] `markFailed()` identifies transitively blocked agents
- [ ] Parallel agents in same wave execute concurrently
- [ ] Fire-and-forget mode returns immediately
- [ ] Dependency results injected into downstream agent context
- [ ] `cancel()` sets status and prevents future execution

### Inter-Agent Communication
- [ ] Messages persist to `agent_messages` table
- [ ] Direct messages delivered only to target agent
- [ ] Broadcast messages delivered to all agents in coordinator
- [ ] Channel-scoped messaging filters correctly
- [ ] Messages marked as delivered after `receive()`
- [ ] Agent findings persisted as thoughts in OB1 `thoughts` table
- [ ] Semantic search via pgvector finds relevant agent thoughts
- [ ] Result aggregation produces correct totals

### OB1 Integration
- [ ] Agent run summaries stored as thoughts with `type: agent_run_summary`
- [ ] Thought metadata includes `source_agent_run_id`, `coordinator_run_id`
- [ ] team-architect skill plan translatable to coordinator operations
- [ ] Agent registry loads during boot Phase 5 (BP05)
- [ ] All Edge Function endpoints return correct responses
- [ ] No modifications to core `thoughts` table structure

### Cross-Blueprint References
- [ ] Tool pool scoping uses BP01 `ToolPool.assemble()` with agent type config
- [ ] Permission policies use BP01 `PermissionPolicy.subAgent()`
- [ ] Session persistence uses BP02 `SessionManager.create()` and `.resume()`
- [ ] Budget tracking uses BP02 `BudgetTracker` with per-agent isolation
- [ ] Lifecycle events logged to BP03 `system_events` table
- [ ] Agent registry initialized during BP05 boot Phase 5
- [ ] Doctor checks (BP05) can verify agent_types table health
