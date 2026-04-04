-- ============================================================
-- Migration 002: Agent State, Workflow & Budget Primitives
-- ============================================================
--
-- Creates:
--   Tables:
--     - agent_sessions         — complete session state snapshots
--     - workflow_checkpoints   — WAL-style workflow state machine
--                                with idempotency keys
--     - budget_ledger          — append-only token/cost tracking
--
-- Prerequisites:
--   - Core OB1 `thoughts` table must already exist
--     (agent_sessions.thought_id references it)
--   - Migration 000 (prerequisites) should have run first
--
-- Safe to re-run: all CREATE statements use IF NOT EXISTS.
-- ============================================================


-- -------------------------------------------------------
-- 0. Verify prerequisites
-- -------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'thoughts'
  ) THEN
    RAISE EXCEPTION 'thoughts table must exist before running this migration';
  END IF;
END $$;

-- Ensure trigger function exists (safe if already created by 000 or core OB1)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- -------------------------------------------------------
-- 1. agent_sessions
--    Stores complete session state. Each row is a
--    point-in-time snapshot of one agent session.
--    Includes denormalized usage totals for fast reads,
--    compaction tracking, and an optional FK to thoughts
--    for cross-referencing session summaries.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_sessions (
  id                       UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id               TEXT          NOT NULL UNIQUE,
  version                  INT           NOT NULL DEFAULT 1,
  status                   TEXT          NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'completed', 'crashed')),

  -- Core session payload
  messages                 JSONB         NOT NULL DEFAULT '[]'::jsonb,
  config_snapshot          JSONB         NOT NULL DEFAULT '{}'::jsonb,
  permission_decisions     JSONB         NOT NULL DEFAULT '[]'::jsonb,

  -- Denormalized usage summary
  total_input_tokens       BIGINT        NOT NULL DEFAULT 0,
  total_output_tokens      BIGINT        NOT NULL DEFAULT 0,
  total_cache_write_tokens BIGINT        NOT NULL DEFAULT 0,
  total_cache_read_tokens  BIGINT        NOT NULL DEFAULT 0,
  total_cost_usd           NUMERIC(12,6) NOT NULL DEFAULT 0,
  turn_count               INT           NOT NULL DEFAULT 0,

  -- Compaction tracking
  compaction_count         INT           NOT NULL DEFAULT 0,
  last_compaction_at       TIMESTAMPTZ,

  -- Lifecycle timestamps
  created_at               TIMESTAMPTZ   DEFAULT now(),
  updated_at               TIMESTAMPTZ   DEFAULT now(),
  completed_at             TIMESTAMPTZ,

  -- Optional link to a thought (session summary cross-reference)
  thought_id               UUID          REFERENCES thoughts(id)
);

-- Fast lookup by session_id (most common query path)
CREATE INDEX IF NOT EXISTS idx_agent_sessions_session_id
  ON agent_sessions (session_id);

-- Find active or crashed sessions for resume
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status
  ON agent_sessions (status) WHERE status IN ('active', 'crashed');

-- Temporal queries (newest first)
CREATE INDEX IF NOT EXISTS idx_agent_sessions_created
  ON agent_sessions (created_at DESC);

-- Auto-update timestamp
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'agent_sessions_updated_at'
  ) THEN
    CREATE TRIGGER agent_sessions_updated_at
      BEFORE UPDATE ON agent_sessions
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- RLS
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_sessions' AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON agent_sessions FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_sessions TO service_role;


-- -------------------------------------------------------
-- 2. workflow_checkpoints
--    Write-ahead log for side-effecting workflow steps.
--    Every step writes a checkpoint BEFORE execution.
--    On crash recovery, incomplete checkpoints tell us
--    exactly where to resume.
--
--    State machine:
--      planned -> awaiting_approval -> executing
--      executing -> completed | failed | waiting_on_external
--      failed -> planned (retry) | skipped (abandon)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_checkpoints (
  id                UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id        TEXT          NOT NULL,
  workflow_id       TEXT          NOT NULL,
  step_index        INT           NOT NULL,

  -- State machine
  state             TEXT          NOT NULL DEFAULT 'planned'
    CHECK (state IN (
      'planned',
      'awaiting_approval',
      'executing',
      'waiting_on_external',
      'completed',
      'failed',
      'skipped'
    )),

  -- Step details
  step_type         TEXT          NOT NULL,
  step_description  TEXT,
  step_input        JSONB         NOT NULL DEFAULT '{}'::jsonb,
  step_output       JSONB,
  error_detail      TEXT,

  -- Idempotency
  idempotency_key   TEXT          NOT NULL,
  execution_count   INT           NOT NULL DEFAULT 0,

  -- Token cost for this step
  input_tokens      INT           DEFAULT 0,
  output_tokens     INT           DEFAULT 0,
  cost_usd          NUMERIC(10,6) DEFAULT 0,

  -- Lifecycle timestamps
  created_at        TIMESTAMPTZ   DEFAULT now(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ   DEFAULT now(),

  -- Prevent double-fire: unique on idempotency_key
  CONSTRAINT uq_idempotency_key UNIQUE (idempotency_key)
);

-- Primary query path: all checkpoints for a workflow, in order
CREATE INDEX IF NOT EXISTS idx_wf_checkpoints_workflow
  ON workflow_checkpoints (workflow_id, step_index);

-- Find incomplete steps for crash recovery
CREATE INDEX IF NOT EXISTS idx_wf_checkpoints_incomplete
  ON workflow_checkpoints (session_id, state)
  WHERE state IN ('executing', 'awaiting_approval', 'waiting_on_external');

-- Temporal queries (newest first)
CREATE INDEX IF NOT EXISTS idx_wf_checkpoints_created
  ON workflow_checkpoints (created_at DESC);

-- Auto-update timestamp
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'wf_checkpoints_updated_at'
  ) THEN
    CREATE TRIGGER wf_checkpoints_updated_at
      BEFORE UPDATE ON workflow_checkpoints
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- RLS
ALTER TABLE workflow_checkpoints ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'workflow_checkpoints' AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON workflow_checkpoints FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workflow_checkpoints TO service_role;


-- -------------------------------------------------------
-- 3. budget_ledger
--    Append-only ledger of token consumption events.
--    Enables both real-time budget enforcement (via
--    denormalized cumulative columns) and historical
--    cost analysis. Each row records one turn's usage.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS budget_ledger (
  id                              UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id                      TEXT          NOT NULL,
  turn_number                     INT           NOT NULL,

  -- Per-turn token counts
  input_tokens                    INT           NOT NULL DEFAULT 0,
  output_tokens                   INT           NOT NULL DEFAULT 0,
  cache_write_tokens              INT           NOT NULL DEFAULT 0,
  cache_read_tokens               INT           NOT NULL DEFAULT 0,

  -- USD cost for this turn
  cost_usd                        NUMERIC(10,6) NOT NULL DEFAULT 0,
  model                           TEXT,

  -- Budget config snapshot at time of entry
  max_turns                       INT,
  max_budget_tokens               BIGINT,
  max_budget_usd                  NUMERIC(10,4),

  -- Running totals (denormalized for O(1) budget checks)
  cumulative_input_tokens         BIGINT        NOT NULL DEFAULT 0,
  cumulative_output_tokens        BIGINT        NOT NULL DEFAULT 0,
  cumulative_cost_usd             NUMERIC(12,6) NOT NULL DEFAULT 0,
  cumulative_turns                INT           NOT NULL DEFAULT 0,

  -- Stop reason if this turn triggered a budget/session stop
  stop_reason                     TEXT
    CHECK (stop_reason IS NULL OR stop_reason IN (
      'completed',
      'max_turns_reached',
      'max_budget_tokens_reached',
      'max_budget_usd_reached',
      'auto_compacted',
      'user_stopped',
      'error'
    )),

  -- Compaction events
  compaction_triggered            BOOLEAN       NOT NULL DEFAULT false,
  compaction_messages_removed     INT           DEFAULT 0,
  consecutive_compaction_failures INT           NOT NULL DEFAULT 0,

  -- Lifecycle (append-only: no updated_at needed)
  created_at                      TIMESTAMPTZ   DEFAULT now()
);

-- Primary query: latest entry for a session (for cumulative reads)
CREATE INDEX IF NOT EXISTS idx_budget_ledger_session
  ON budget_ledger (session_id, turn_number DESC);

-- Cost analysis queries (newest first)
CREATE INDEX IF NOT EXISTS idx_budget_ledger_created
  ON budget_ledger (created_at DESC);

-- RLS
ALTER TABLE budget_ledger ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'budget_ledger' AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON budget_ledger FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.budget_ledger TO service_role;


-- ============================================================
-- Done. Verify with:
--   SELECT session_id, status, turn_count, total_cost_usd
--     FROM agent_sessions ORDER BY created_at DESC LIMIT 5;
--   SELECT workflow_id, step_index, state
--     FROM workflow_checkpoints ORDER BY created_at DESC LIMIT 10;
--   SELECT session_id, turn_number, cumulative_cost_usd
--     FROM budget_ledger ORDER BY created_at DESC LIMIT 10;
-- ============================================================
