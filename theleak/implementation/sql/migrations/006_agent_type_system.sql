-- ============================================================
-- Migration 006: Agent Type System, Coordinator & Inter-Agent Communication
-- Blueprint: 06_agent_type_system.md
--
-- Tables:  agent_types, agent_runs, agent_messages
-- Seed:    6 built-in agent type definitions
--
-- Depends on:
--   - Migration 000 (prerequisites)
--   - Migration 001 (Tool Registry & Permissions)
--   - Migration 002 (State & Budget)
--   - Migration 003 (Streaming, Logging, Verification)
--   - Migration 005 (Doctor & Boot)
--   - The thoughts table (core OB1 table, referenced by agent_messages)
--
-- Run this in Supabase SQL Editor after migrations 000-005.
-- ============================================================

-- Ensure trigger function exists (safe if already created by 000 or prior migrations)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 1. Agent Type Definitions Table
-- Stores both built-in and custom agent type configurations.
-- Each row is a complete agent blueprint: what tools it can use,
-- what prompt it gets, how many iterations it can run, etc.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_types (
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
CREATE INDEX IF NOT EXISTS idx_agent_types_name ON agent_types (name);

-- Filter by source
CREATE INDEX IF NOT EXISTS idx_agent_types_source ON agent_types (source);

-- Only enabled types
CREATE INDEX IF NOT EXISTS idx_agent_types_enabled ON agent_types (enabled) WHERE enabled = true;

-- Auto-update timestamp
DROP TRIGGER IF EXISTS agent_types_updated_at ON agent_types;
CREATE TRIGGER agent_types_updated_at
  BEFORE UPDATE ON agent_types
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE agent_types ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_types' AND policyname = 'Service role full access on agent_types'
  ) THEN
    CREATE POLICY "Service role full access on agent_types"
      ON agent_types
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_types TO service_role;


-- ============================================================
-- 2. Agent Run History Table
-- Every sub-agent spawn is tracked here. Links to agent_sessions
-- and budget_ledger for full observability. This is the durable
-- replacement for the ephemeral SubAgentManifest.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_runs (
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
CREATE INDEX IF NOT EXISTS idx_agent_runs_coordinator ON agent_runs (coordinator_run_id);

-- Find runs by parent
CREATE INDEX IF NOT EXISTS idx_agent_runs_parent ON agent_runs (parent_run_id);

-- Find runs by status (for coordinator polling)
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs (status, created_at DESC);

-- Find runs by agent type
CREATE INDEX IF NOT EXISTS idx_agent_runs_type ON agent_runs (agent_type_name);

-- Temporal queries
CREATE INDEX IF NOT EXISTS idx_agent_runs_created ON agent_runs (created_at DESC);

-- Auto-update timestamp
DROP TRIGGER IF EXISTS agent_runs_updated_at ON agent_runs;
CREATE TRIGGER agent_runs_updated_at
  BEFORE UPDATE ON agent_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_runs' AND policyname = 'Service role full access on agent_runs'
  ) THEN
    CREATE POLICY "Service role full access on agent_runs"
      ON agent_runs
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON TABLE public.agent_runs TO service_role;


-- ============================================================
-- 3. Agent Messages Table (Inter-Agent Communication)
-- Point-to-point and broadcast messages between agents within
-- a coordinator session. This is the communication bus that
-- Claude Code lacks entirely.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_messages (
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

  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Fast: get all messages for a coordinator session
CREATE INDEX IF NOT EXISTS idx_agent_messages_coordinator
  ON agent_messages (coordinator_run_id, created_at);

-- Fast: get undelivered messages for a specific agent
CREATE INDEX IF NOT EXISTS idx_agent_messages_undelivered
  ON agent_messages (to_run_id, delivered, created_at)
  WHERE delivered = false;

-- Fast: get messages by channel
CREATE INDEX IF NOT EXISTS idx_agent_messages_channel
  ON agent_messages (coordinator_run_id, channel, created_at);

-- Auto-update timestamp
DROP TRIGGER IF EXISTS agent_messages_updated_at ON agent_messages;
CREATE TRIGGER agent_messages_updated_at
  BEFORE UPDATE ON agent_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_messages' AND policyname = 'Service role full access on agent_messages'
  ) THEN
    CREATE POLICY "Service role full access on agent_messages"
      ON agent_messages
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON TABLE public.agent_messages TO service_role;


-- ============================================================
-- 4. Extend system_events Categories
-- Add agent-related categories to the system_events CHECK
-- constraint. Preserves all existing categories from BP03 and BP05.
-- ============================================================

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


-- ============================================================
-- 5. Seed Data: 6 Built-In Agent Types
-- These are the core agent types that ship with OB1.
-- Uses ON CONFLICT to allow re-running without duplicates.
-- ============================================================

-- 5.1 Explorer: Read-only codebase exploration
INSERT INTO agent_types (
  name, display_name, description, source,
  permission_mode, allowed_tools, denied_tools, denied_prefixes,
  system_prompt, constraints, max_iterations,
  output_format, handler_type, color, icon, can_spawn, metadata
) VALUES (
  'explore',
  'Explorer',
  'Read-only codebase exploration and information gathering. Cannot modify files.',
  'built_in',
  'read_only',
  ARRAY['read_file', 'glob_search', 'grep_search', 'web_fetch', 'web_search'],
  ARRAY['bash', 'write_file', 'edit_file'],
  ARRAY['mcp__dangerous_'],
  'You are an Explorer agent. Your job is to thoroughly investigate codebases, documentation, and external sources to gather information.

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
4. Open questions / areas needing deeper investigation',
  ARRAY[
    'Do not modify any files',
    'Do not run shell commands',
    'Report findings without taking action',
    'Include exact file paths and line numbers'
  ],
  50,
  'structured_facts',
  'coordinator',
  '#3B82F6',
  'magnifying_glass',
  false,
  '{}'::jsonb
)
ON CONFLICT (name) DO UPDATE SET
  display_name    = EXCLUDED.display_name,
  description     = EXCLUDED.description,
  permission_mode = EXCLUDED.permission_mode,
  allowed_tools   = EXCLUDED.allowed_tools,
  denied_tools    = EXCLUDED.denied_tools,
  denied_prefixes = EXCLUDED.denied_prefixes,
  system_prompt   = EXCLUDED.system_prompt,
  constraints     = EXCLUDED.constraints,
  max_iterations  = EXCLUDED.max_iterations,
  output_format   = EXCLUDED.output_format,
  handler_type    = EXCLUDED.handler_type,
  color           = EXCLUDED.color,
  icon            = EXCLUDED.icon,
  can_spawn       = EXCLUDED.can_spawn,
  metadata        = EXCLUDED.metadata,
  updated_at      = now();

-- 5.2 Planner: Architecture and strategy formulation
INSERT INTO agent_types (
  name, display_name, description, source,
  permission_mode, allowed_tools, denied_tools, denied_prefixes,
  system_prompt, constraints, max_iterations,
  output_format, handler_type, color, icon, can_spawn, metadata
) VALUES (
  'plan',
  'Planner',
  'Architecture planning and strategy formulation. Can read code and produce plans.',
  'built_in',
  'read_only',
  ARRAY['read_file', 'glob_search', 'grep_search'],
  ARRAY['bash', 'write_file', 'edit_file'],
  ARRAY['mcp__'],
  'You are a Planner agent. Your job is to analyze requirements, explore existing code, and produce detailed implementation plans.

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
- Risk flags if any',
  ARRAY[
    'Do not modify any files',
    'Do not run shell commands',
    'Each plan step must be independently executable',
    'Identify all cross-step dependencies'
  ],
  40,
  'plan',
  'coordinator',
  '#8B5CF6',
  'clipboard',
  false,
  '{}'::jsonb
)
ON CONFLICT (name) DO UPDATE SET
  display_name    = EXCLUDED.display_name,
  description     = EXCLUDED.description,
  permission_mode = EXCLUDED.permission_mode,
  allowed_tools   = EXCLUDED.allowed_tools,
  denied_tools    = EXCLUDED.denied_tools,
  denied_prefixes = EXCLUDED.denied_prefixes,
  system_prompt   = EXCLUDED.system_prompt,
  constraints     = EXCLUDED.constraints,
  max_iterations  = EXCLUDED.max_iterations,
  output_format   = EXCLUDED.output_format,
  handler_type    = EXCLUDED.handler_type,
  color           = EXCLUDED.color,
  icon            = EXCLUDED.icon,
  can_spawn       = EXCLUDED.can_spawn,
  metadata        = EXCLUDED.metadata,
  updated_at      = now();

-- 5.3 Verifier: Testing and validation
INSERT INTO agent_types (
  name, display_name, description, source,
  permission_mode, allowed_tools, denied_tools, denied_prefixes,
  system_prompt, constraints, max_iterations,
  output_format, handler_type, color, icon, can_spawn, metadata
) VALUES (
  'verification',
  'Verifier',
  'Run tests, type checks, linters, and validate changes. Can execute read-only bash commands.',
  'built_in',
  'workspace_write',
  ARRAY['read_file', 'glob_search', 'grep_search', 'bash'],
  ARRAY['write_file', 'edit_file'],
  ARRAY['mcp__'],
  'You are a Verification agent. Your job is to validate that code changes work correctly.

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
5. Overall verdict: PASS / FAIL / PARTIAL',
  ARRAY[
    'Do not modify source files',
    'Only run observational bash commands',
    'Never run destructive commands (rm, mv, git push, etc.)',
    'Report failures clearly without attempting fixes'
  ],
  30,
  'structured_facts',
  'coordinator',
  '#10B981',
  'check_circle',
  false,
  '{}'::jsonb
)
ON CONFLICT (name) DO UPDATE SET
  display_name    = EXCLUDED.display_name,
  description     = EXCLUDED.description,
  permission_mode = EXCLUDED.permission_mode,
  allowed_tools   = EXCLUDED.allowed_tools,
  denied_tools    = EXCLUDED.denied_tools,
  denied_prefixes = EXCLUDED.denied_prefixes,
  system_prompt   = EXCLUDED.system_prompt,
  constraints     = EXCLUDED.constraints,
  max_iterations  = EXCLUDED.max_iterations,
  output_format   = EXCLUDED.output_format,
  handler_type    = EXCLUDED.handler_type,
  color           = EXCLUDED.color,
  icon            = EXCLUDED.icon,
  can_spawn       = EXCLUDED.can_spawn,
  metadata        = EXCLUDED.metadata,
  updated_at      = now();

-- 5.4 Guide: User assistance and documentation
INSERT INTO agent_types (
  name, display_name, description, source,
  permission_mode, allowed_tools, denied_tools, denied_prefixes,
  system_prompt, constraints, max_iterations,
  output_format, handler_type, color, icon, can_spawn, metadata
) VALUES (
  'guide',
  'Guide',
  'User assistance, documentation, and how-to guidance. Read-only with web access.',
  'built_in',
  'read_only',
  ARRAY['read_file', 'glob_search', 'grep_search', 'web_fetch', 'web_search'],
  ARRAY['bash', 'write_file', 'edit_file'],
  ARRAY['mcp__dangerous_'],
  'You are a Guide agent. Your job is to help users understand codebases, tools, and workflows.

## Rules
- You may read files, search code, and fetch web documentation.
- You may NOT modify files or run commands.
- Explain concepts clearly with examples.
- Reference specific files and line numbers when discussing code.
- Link to relevant documentation when available.

## Output
Produce clear, structured guidance:
1. Direct answer to the user''s question
2. Relevant code examples (from the actual codebase)
3. Links to documentation
4. Related topics the user might want to explore',
  ARRAY[
    'Do not modify any files',
    'Do not run shell commands',
    'Reference actual code, not hypothetical examples',
    'Be concise but thorough'
  ],
  30,
  'markdown',
  'coordinator',
  '#F59E0B',
  'book_open',
  false,
  '{}'::jsonb
)
ON CONFLICT (name) DO UPDATE SET
  display_name    = EXCLUDED.display_name,
  description     = EXCLUDED.description,
  permission_mode = EXCLUDED.permission_mode,
  allowed_tools   = EXCLUDED.allowed_tools,
  denied_tools    = EXCLUDED.denied_tools,
  denied_prefixes = EXCLUDED.denied_prefixes,
  system_prompt   = EXCLUDED.system_prompt,
  constraints     = EXCLUDED.constraints,
  max_iterations  = EXCLUDED.max_iterations,
  output_format   = EXCLUDED.output_format,
  handler_type    = EXCLUDED.handler_type,
  color           = EXCLUDED.color,
  icon            = EXCLUDED.icon,
  can_spawn       = EXCLUDED.can_spawn,
  metadata        = EXCLUDED.metadata,
  updated_at      = now();

-- 5.5 Worker: Full-capability general-purpose coding agent
INSERT INTO agent_types (
  name, display_name, description, source,
  permission_mode, allowed_tools, denied_tools, denied_prefixes,
  system_prompt, constraints, max_iterations,
  output_format, handler_type, color, icon, can_spawn, metadata
) VALUES (
  'general_purpose',
  'Worker',
  'General-purpose coding agent with read and write access. Can modify files and run commands.',
  'built_in',
  'workspace_write',
  ARRAY['read_file', 'write_file', 'edit_file', 'glob_search', 'grep_search', 'bash', 'web_fetch', 'web_search'],
  ARRAY[]::TEXT[],
  ARRAY['mcp__dangerous_'],
  'You are a Worker agent. Your job is to implement code changes based on a specific task.

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
5. Report what was changed and any remaining concerns.',
  ARRAY[
    'Stay focused on the assigned task',
    'Make minimal, targeted changes',
    'Test changes before reporting completion',
    'Do not refactor unrelated code'
  ],
  100,
  'markdown',
  'coordinator',
  '#EF4444',
  'wrench',
  false,
  '{}'::jsonb
)
ON CONFLICT (name) DO UPDATE SET
  display_name    = EXCLUDED.display_name,
  description     = EXCLUDED.description,
  permission_mode = EXCLUDED.permission_mode,
  allowed_tools   = EXCLUDED.allowed_tools,
  denied_tools    = EXCLUDED.denied_tools,
  denied_prefixes = EXCLUDED.denied_prefixes,
  system_prompt   = EXCLUDED.system_prompt,
  constraints     = EXCLUDED.constraints,
  max_iterations  = EXCLUDED.max_iterations,
  output_format   = EXCLUDED.output_format,
  handler_type    = EXCLUDED.handler_type,
  color           = EXCLUDED.color,
  icon            = EXCLUDED.icon,
  can_spawn       = EXCLUDED.can_spawn,
  metadata        = EXCLUDED.metadata,
  updated_at      = now();

-- 5.6 Status: Progress tracking and display
INSERT INTO agent_types (
  name, display_name, description, source,
  permission_mode, allowed_tools, denied_tools, denied_prefixes,
  system_prompt, constraints, max_iterations,
  output_format, handler_type, color, icon, can_spawn, metadata
) VALUES (
  'statusline',
  'Status',
  'Monitors and displays progress of other agents. Minimal tool access.',
  'built_in',
  'read_only',
  ARRAY['read_file'],
  ARRAY['bash', 'write_file', 'edit_file', 'glob_search', 'grep_search'],
  ARRAY['mcp__'],
  'You are a Status agent. Your job is to track and display the progress of a multi-agent operation.

## Rules
- You receive status updates from the coordinator.
- Produce concise status displays showing: which agents are running, what they are doing, completion percentage.
- Use the status format specified in your task.

## Output
A compact status display suitable for terminal or dashboard rendering.',
  ARRAY[
    'Only produce status output',
    'Do not take any actions',
    'Keep output compact'
  ],
  200,
  'status',
  'swarm_worker',
  '#6B7280',
  'bar_chart',
  false,
  '{}'::jsonb
)
ON CONFLICT (name) DO UPDATE SET
  display_name    = EXCLUDED.display_name,
  description     = EXCLUDED.description,
  permission_mode = EXCLUDED.permission_mode,
  allowed_tools   = EXCLUDED.allowed_tools,
  denied_tools    = EXCLUDED.denied_tools,
  denied_prefixes = EXCLUDED.denied_prefixes,
  system_prompt   = EXCLUDED.system_prompt,
  constraints     = EXCLUDED.constraints,
  max_iterations  = EXCLUDED.max_iterations,
  output_format   = EXCLUDED.output_format,
  handler_type    = EXCLUDED.handler_type,
  color           = EXCLUDED.color,
  icon            = EXCLUDED.icon,
  can_spawn       = EXCLUDED.can_spawn,
  metadata        = EXCLUDED.metadata,
  updated_at      = now();
