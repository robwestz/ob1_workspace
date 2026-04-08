-- =============================================================================
-- Migration 012: Agent Initiative System
-- Date: 2026-04-05
--
-- Agents stop being purely reactive and start discovering improvements
-- autonomously. The SysAdmin notices patterns, identifies opportunities,
-- and proposes changes through a structured propose-test-report cycle.
--
-- Phase 8 of the OB1 Control roadmap (all 4 plans combined):
--   1. Opportunity Discovery
--   2. Propose-Test-Report Cycle
--   3. Initiative Backlog
--   4. Initiative Quality Metrics
--
-- Dependencies: Migration 009 (agent_identities)
--
-- Creates:
--   1. agent_initiatives — full lifecycle from discovery to verified value
--
-- Does NOT modify the core thoughts table (guard rail compliant).
-- Safe to re-run: uses CREATE TABLE IF NOT EXISTS and existence guards.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. agent_initiatives table
--    Each row is an agent-discovered improvement opportunity that travels
--    through the lifecycle: discovered -> proposed -> approved -> executing
--    -> completed -> verified.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_initiatives (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id           UUID         REFERENCES agent_identities(id),

  -- Discovery
  title                 TEXT         NOT NULL,
  description           TEXT         NOT NULL,
  category              TEXT         NOT NULL
    CHECK (category IN (
      'test_gap', 'dead_code', 'security', 'performance',
      'dependency', 'documentation', 'refactor', 'feature'
    )),
  project               TEXT,                      -- which project this applies to
  file_paths            TEXT[]       DEFAULT '{}',  -- affected files

  -- Scoring
  impact                TEXT         NOT NULL DEFAULT 'medium'
    CHECK (impact IN ('low', 'medium', 'high', 'critical')),
  effort_hours          NUMERIC,
  risk                  TEXT         NOT NULL DEFAULT 'safe'
    CHECK (risk IN ('safe', 'low_risk', 'medium_risk', 'risky')),
  priority_score        NUMERIC      DEFAULT 0.5
    CHECK (priority_score >= 0 AND priority_score <= 1),

  -- Lifecycle
  status                TEXT         NOT NULL DEFAULT 'discovered'
    CHECK (status IN (
      'discovered', 'proposed', 'approved', 'rejected',
      'deferred', 'executing', 'completed', 'verified', 'failed'
    )),

  -- Proposal
  proposal              TEXT,                      -- proposed fix/improvement
  expected_outcome      TEXT,
  risk_assessment       TEXT,
  test_branch           TEXT,                      -- branch where fix was tested
  test_results          JSONB,                     -- quality gate results from isolated test

  -- Review
  reviewed_by           TEXT,                      -- 'robin' or 'auto'
  review_notes          TEXT,
  reviewed_at           TIMESTAMPTZ,

  -- Execution
  executed_in_session   TEXT,                      -- session ID where this was executed
  execution_results     JSONB,

  -- Metrics
  value_delivered       TEXT,                      -- assessment after completion

  -- Discovery source
  discovered_by         TEXT         DEFAULT 'sysadmin',
  discovered_in_session TEXT,
  discovery_source      TEXT,                      -- 'scanner', 'wave_assess', 'manual'

  -- Timestamps
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Auto-update updated_at on row changes
DROP TRIGGER IF EXISTS agent_initiatives_updated_at ON agent_initiatives;
CREATE TRIGGER agent_initiatives_updated_at
  BEFORE UPDATE ON agent_initiatives
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

-- Primary backlog query: filter by status, sort by priority descending
CREATE INDEX IF NOT EXISTS idx_initiatives_status_priority
  ON agent_initiatives (status, priority_score DESC);

-- Filter by identity and status (per-agent backlog views)
CREATE INDEX IF NOT EXISTS idx_initiatives_identity_status
  ON agent_initiatives (identity_id, status);

-- Filter by project (project-scoped backlog)
CREATE INDEX IF NOT EXISTS idx_initiatives_project
  ON agent_initiatives (project);


-- ---------------------------------------------------------------------------
-- 3. RLS + Grants
--    Same pattern as migrations 009-011: RLS enabled, service_role has
--    full access.
-- ---------------------------------------------------------------------------

ALTER TABLE agent_initiatives ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_initiatives'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON agent_initiatives
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_initiatives TO service_role;


-- =============================================================================
-- End of Migration 012
-- =============================================================================
