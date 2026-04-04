-- ============================================================
-- Migration 003: Streaming Events, System Event Logging, Verification Harness
-- Source: Blueprint 03 — Primitives #6, #7, #8
-- Date: 2026-04-03
--
-- Creates:
--   - system_events table (high-throughput, append-only event log)
--   - verification_runs table (verification harness results)
--   - session_event_summary view (aggregation for dashboards)
--   - cleanup_old_system_events() function (retention management)
--   - RLS policies and grants for service_role
--   - Real-time subscription on system_events
--
-- Dependencies: None (independent of migrations 001/002)
-- Runnable in: Supabase SQL Editor
-- ============================================================

-- ============================================================
-- Helper: updated_at trigger function
-- Uses CREATE OR REPLACE so it is safe to run if it already
-- exists from a prior migration.
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- Table: system_events
-- High-throughput, append-only storage for all system events.
-- Separate from thoughts to avoid polluting semantic search
-- with operational noise.
-- ============================================================
CREATE TABLE IF NOT EXISTS system_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id      UUID NOT NULL UNIQUE,
  session_id    TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN (
    'initialization', 'registry', 'tool_selection', 'permission',
    'execution', 'stream', 'turn_complete', 'session',
    'compaction', 'usage', 'error', 'hook', 'verification'
  )),
  severity      TEXT NOT NULL CHECK (severity IN (
    'debug', 'info', 'warn', 'error', 'critical'
  )),
  title         TEXT NOT NULL,
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
  sequence      INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger: auto-update updated_at on system_events
DROP TRIGGER IF EXISTS update_system_events_updated_at ON system_events;
CREATE TRIGGER update_system_events_updated_at
    BEFORE UPDATE ON system_events
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- Indexes: system_events
-- ============================================================

-- Primary access pattern: query events by session in order
CREATE INDEX IF NOT EXISTS idx_system_events_session
  ON system_events (session_id, sequence);

-- Filter by category and severity (operational dashboards)
CREATE INDEX IF NOT EXISTS idx_system_events_category_severity
  ON system_events (category, severity, created_at DESC);

-- Time-range queries (operational dashboards)
CREATE INDEX IF NOT EXISTS idx_system_events_created_at
  ON system_events (created_at DESC);

-- Partial index for high-severity events (alerts, debugging)
CREATE INDEX IF NOT EXISTS idx_system_events_high_severity
  ON system_events (created_at DESC)
  WHERE severity IN ('warn', 'error', 'critical');

-- GIN index on detail JSONB for flexible querying
CREATE INDEX IF NOT EXISTS idx_system_events_detail
  ON system_events USING GIN (detail);


-- ============================================================
-- Table: verification_runs
-- Stores the results of each verification harness execution.
-- ============================================================
CREATE TABLE IF NOT EXISTS verification_runs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        UUID NOT NULL UNIQUE,
  session_id    TEXT NOT NULL,
  trigger       TEXT NOT NULL CHECK (trigger IN (
    'prompt_change', 'model_swap', 'tool_change',
    'routing_change', 'manual', 'post_session', 'scheduled'
  )),
  verdict       TEXT NOT NULL CHECK (verdict IN ('pass', 'fail', 'warn')),
  passed        INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  warnings      INTEGER NOT NULL DEFAULT 0,
  results       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger: auto-update updated_at on verification_runs
DROP TRIGGER IF EXISTS update_verification_runs_updated_at ON verification_runs;
CREATE TRIGGER update_verification_runs_updated_at
    BEFORE UPDATE ON verification_runs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- Indexes: verification_runs
-- ============================================================

-- Query verification runs by session
CREATE INDEX IF NOT EXISTS idx_verification_runs_session
  ON verification_runs (session_id, created_at DESC);

-- Find failures across all sessions (partial index)
CREATE INDEX IF NOT EXISTS idx_verification_runs_verdict
  ON verification_runs (verdict, created_at DESC)
  WHERE verdict IN ('fail', 'warn');


-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE system_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'system_events' AND policyname = 'Service role full access on system_events'
  ) THEN
    CREATE POLICY "Service role full access on system_events"
      ON system_events
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

ALTER TABLE verification_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'verification_runs' AND policyname = 'Service role full access on verification_runs'
  ) THEN
    CREATE POLICY "Service role full access on verification_runs"
      ON verification_runs
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;


-- ============================================================
-- Grants
-- Explicit grants for service_role (required on newer Supabase
-- projects where default privileges may not include DML).
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.system_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.verification_runs TO service_role;


-- ============================================================
-- Real-time subscriptions
-- Enable real-time for system_events so dashboards can
-- subscribe to live event streams.
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE system_events;


-- ============================================================
-- Function: cleanup_old_system_events
-- Purges events older than the retention period.
-- Run via pg_cron or a Supabase scheduled function.
-- Does NOT use unqualified DELETE — always scoped by date.
-- Preserves error and critical events regardless of age.
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_old_system_events(
  retention_days INTEGER DEFAULT 30
)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM system_events
  WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL
    AND severity NOT IN ('error', 'critical');

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- View: session_event_summary
-- Aggregation view useful for dashboards and operational
-- monitoring. Provides per-session event counts, severity
-- breakdown, timing, and category coverage.
-- ============================================================

CREATE OR REPLACE VIEW session_event_summary AS
SELECT
  session_id,
  COUNT(*) AS total_events,
  COUNT(*) FILTER (WHERE severity = 'error') AS error_count,
  COUNT(*) FILTER (WHERE severity = 'critical') AS critical_count,
  COUNT(*) FILTER (WHERE severity = 'warn') AS warn_count,
  COUNT(*) FILTER (WHERE category = 'permission') AS permission_events,
  COUNT(*) FILTER (WHERE category = 'execution') AS execution_events,
  MIN(created_at) AS session_start,
  MAX(created_at) AS session_end,
  MAX(created_at) - MIN(created_at) AS session_duration,
  ARRAY_AGG(DISTINCT category) AS categories_seen
FROM system_events
GROUP BY session_id;

GRANT SELECT ON session_event_summary TO service_role;
