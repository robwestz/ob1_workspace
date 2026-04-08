-- =============================================================================
-- Migration 009: Agent Identity Persistence
-- Date: 2026-04-05
--
-- Creates the persistent identity layer for OB1 Control's agent personas.
-- Enables agents (starting with SysAdmin) to accumulate goals, decisions,
-- learnings, and session history across context resets and session boundaries.
--
-- Creates:
--   1. agent_identities   — persistent agent personas with goals and state
--   2. agent_decisions     — decisions made across sessions with outcomes
--   3. agent_learnings     — insights accumulated over time with confidence
--   4. agent_session_snapshots — end-of-session state captures
--
-- Does NOT modify the core thoughts table (guard rail compliant).
-- Safe to re-run: uses CREATE TABLE IF NOT EXISTS and existence guards.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. agent_identities table
--    Persistent agent personas. Each named identity (e.g. 'sysadmin')
--    survives across all sessions and context resets.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_identities (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT         NOT NULL UNIQUE,
  persona_hash          TEXT,
  active_goals          JSONB        NOT NULL DEFAULT '[]',
  current_priorities    JSONB        NOT NULL DEFAULT '[]',
  capabilities          JSONB        NOT NULL DEFAULT '{}',
  self_assessment       TEXT,
  session_count         INTEGER      NOT NULL DEFAULT 0,
  total_runtime_minutes NUMERIC      NOT NULL DEFAULT 0,
  last_session_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Auto-update updated_at on row changes
DROP TRIGGER IF EXISTS agent_identities_updated_at ON agent_identities;
CREATE TRIGGER agent_identities_updated_at
  BEFORE UPDATE ON agent_identities
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 2. agent_decisions table
--    Decisions made across sessions. Outcome can be filled in later to
--    build a feedback loop on decision quality.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_decisions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id     UUID         NOT NULL REFERENCES agent_identities(id),
  session_id      TEXT,
  decision        TEXT         NOT NULL,
  rationale       TEXT,
  context         TEXT,
  outcome         TEXT,
  outcome_status  TEXT         DEFAULT 'pending'
    CHECK (outcome_status IN ('pending', 'good', 'revisit', 'reversed')),
  tags            TEXT[]       DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Common query: recent decisions for an identity
CREATE INDEX IF NOT EXISTS idx_agent_decisions_identity_recent
  ON agent_decisions (identity_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- 3. agent_learnings table
--    Insights accumulated over time. Confidence decays and learnings
--    can be superseded by newer ones.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_learnings (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id     UUID         NOT NULL REFERENCES agent_identities(id),
  session_id      TEXT,
  learning        TEXT         NOT NULL,
  category        TEXT         NOT NULL
    CHECK (category IN (
      'technical', 'process', 'architecture', 'debugging',
      'robin_preference', 'performance', 'security'
    )),
  confidence      NUMERIC      DEFAULT 0.8
    CHECK (confidence >= 0 AND confidence <= 1),
  source          TEXT,
  superseded_by   UUID         REFERENCES agent_learnings(id),
  tags            TEXT[]       DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Common query: learnings by identity and category
CREATE INDEX IF NOT EXISTS idx_agent_learnings_identity_category
  ON agent_learnings (identity_id, category);


-- ---------------------------------------------------------------------------
-- 4. agent_session_snapshots table
--    End-of-session state captures. Provides continuity data for the
--    session-start bootstrap.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_session_snapshots (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id         UUID         NOT NULL REFERENCES agent_identities(id),
  session_id          TEXT         NOT NULL,
  session_type        TEXT         NOT NULL
    CHECK (session_type IN ('interactive', 'night_shift', 'task')),
  started_at          TIMESTAMPTZ  NOT NULL,
  ended_at            TIMESTAMPTZ  NOT NULL,
  duration_minutes    NUMERIC      NOT NULL,
  waves_completed     INTEGER      DEFAULT 0,
  tasks_completed     INTEGER      DEFAULT 0,
  tasks_failed        INTEGER      DEFAULT 0,
  usd_spent           NUMERIC      DEFAULT 0,
  tokens_used         BIGINT       DEFAULT 0,
  goals_at_start      JSONB        DEFAULT '[]',
  goals_at_end        JSONB        DEFAULT '[]',
  decisions_made      INTEGER      DEFAULT 0,
  learnings_captured  INTEGER      DEFAULT 0,
  morning_report_path TEXT,
  summary             TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Common query: recent sessions for an identity
CREATE INDEX IF NOT EXISTS idx_agent_session_snapshots_identity_recent
  ON agent_session_snapshots (identity_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- 5. RLS + Grants
--    All four tables use the same pattern: RLS enabled, service_role
--    has full access. Matches the convention from migrations 007/008.
-- ---------------------------------------------------------------------------

ALTER TABLE agent_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_learnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_session_snapshots ENABLE ROW LEVEL SECURITY;

-- agent_identities
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_identities'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON agent_identities
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_identities TO service_role;

-- agent_decisions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_decisions'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON agent_decisions
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_decisions TO service_role;

-- agent_learnings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_learnings'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON agent_learnings
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_learnings TO service_role;

-- agent_session_snapshots
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_session_snapshots'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON agent_session_snapshots
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_session_snapshots TO service_role;


-- =============================================================================
-- End of Migration 009
-- =============================================================================
