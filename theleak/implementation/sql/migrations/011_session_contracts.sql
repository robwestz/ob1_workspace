-- =============================================================================
-- Migration 011: Session Contracts
-- Date: 2026-04-05
--
-- Formalizes the pre-sleep agreement between Robin and the SysAdmin agent.
-- A session contract captures goals, budget, boundaries, stop conditions,
-- and progress tracking for overnight autonomous sessions.
--
-- Phase 5, Plan 1 of the OB1 Control roadmap.
--
-- Creates:
--   1. session_contracts — durable contract records with full lifecycle
--
-- Does NOT modify the core thoughts table (guard rail compliant).
-- Safe to re-run: uses CREATE TABLE IF NOT EXISTS and existence guards.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. session_contracts table
--    Each row is a contract between Robin and an agent identity for a
--    bounded autonomous session. Status tracks the full lifecycle from
--    draft through completion or abort.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS session_contracts (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id           UUID         REFERENCES agent_identities(id),
  name                  TEXT         NOT NULL,
  status                TEXT         NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'completed', 'aborted', 'paused')),

  -- Goals
  primary_goal          TEXT         NOT NULL,
  secondary_goals       TEXT[]       DEFAULT '{}',
  stretch_goals         TEXT[]       DEFAULT '{}',

  -- Limits
  budget_usd            NUMERIC      NOT NULL DEFAULT 25.00,
  duration_hours        NUMERIC      NOT NULL DEFAULT 8,
  max_concurrent_agents INTEGER      DEFAULT 3,
  model                 TEXT         DEFAULT 'sonnet',

  -- Boundaries
  autonomous_actions    TEXT[]       DEFAULT '{}',
  requires_approval     TEXT[]       DEFAULT '{}',

  -- Quality gates
  quality_gates         JSONB        DEFAULT '[]',

  -- Progress tracking
  current_wave          INTEGER      DEFAULT 0,
  waves_completed       INTEGER      DEFAULT 0,
  waves_failed          INTEGER      DEFAULT 0,
  usd_spent             NUMERIC      DEFAULT 0,
  tokens_used           BIGINT       DEFAULT 0,

  -- Checkpointing
  last_heartbeat        TIMESTAMPTZ,
  last_checkpoint       JSONB,
  morning_report_path   TEXT,

  -- Results
  stop_reason           TEXT,
  goals_achieved        JSONB        DEFAULT '{}',

  -- Timestamps
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Auto-update updated_at on row changes
DROP TRIGGER IF EXISTS session_contracts_updated_at ON session_contracts;
CREATE TRIGGER session_contracts_updated_at
  BEFORE UPDATE ON session_contracts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

-- Find contracts for a specific identity by status
CREATE INDEX IF NOT EXISTS idx_session_contracts_identity_status
  ON session_contracts (identity_id, status);

-- Find contracts by status ordered by recency (active lookups, history queries)
CREATE INDEX IF NOT EXISTS idx_session_contracts_status_created
  ON session_contracts (status, created_at DESC);


-- ---------------------------------------------------------------------------
-- 3. RLS + Grants
--    Same pattern as migrations 007-010: RLS enabled, service_role has
--    full access.
-- ---------------------------------------------------------------------------

ALTER TABLE session_contracts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'session_contracts'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON session_contracts
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.session_contracts TO service_role;


-- =============================================================================
-- End of Migration 011
-- =============================================================================
