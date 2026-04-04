-- ============================================================
-- Migration 005: Doctor Pattern, Staged Boot Sequence & Scoped Configuration
-- Blueprint: 05_doctor_and_boot.md
--
-- Tables:  boot_runs, agent_config
-- Views:   boot_performance_summary
-- Functions: persist_config_snapshot()
--
-- Depends on:
--   - Migration 000 (prerequisites)
--   - Migration 001 (Tool Registry & Permissions)
--   - Migration 002 (State & Budget)
--   - Migration 003 (Streaming, Logging, Verification)
--
-- Run this in Supabase SQL Editor after migrations 000-003.
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
-- 1. Boot Runs Table
-- Records each boot sequence execution with per-phase timing.
-- Used by the doctor pattern and operational dashboards.
-- ============================================================

CREATE TABLE IF NOT EXISTS boot_runs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  session_id    TEXT NOT NULL,

  -- Overall boot outcome
  status        TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'rolled_back')),

  -- Which phase the boot reached (or failed at)
  reached_phase TEXT NOT NULL DEFAULT 'prefetch',
  failed_phase  TEXT,
  failure_reason TEXT,

  -- Per-phase timing (populated incrementally as phases complete)
  -- Example:
  -- {
  --   "prefetch":         {"started_at": "...", "duration_ms": 12, "status": "ok"},
  --   "environment":      {"started_at": "...", "duration_ms": 3,  "status": "ok"},
  --   "config_loading":   {"started_at": "...", "duration_ms": 45, "status": "ok"},
  --   ...
  -- }
  phase_timings JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Fast-path short-circuit (if boot was aborted early for a fast path)
  -- One of: 'version', 'system_prompt', 'mcp_bridge', 'daemon_worker',
  --         'daemon', 'background_session', 'template', 'env_runner',
  --         'health_check', 'config_dump'
  fast_path_used TEXT,

  -- Config snapshot at boot (the merged config that was loaded)
  -- Example: {"model": {"value": "opus-4", "scope": "project", "file": ".claude.json"}}
  config_scope_sources JSONB DEFAULT '{}'::jsonb,

  -- Trust determination
  trust_mode    TEXT CHECK (trust_mode IN ('trusted', 'untrusted', 'prompt')),

  -- Doctor check summary (if phase 9 ran)
  -- Example: {"pass": 14, "warn": 2, "fail": 0, "auto_repaired": 1}
  doctor_summary JSONB DEFAULT '{}'::jsonb,

  -- Total boot duration
  total_duration_ms INTEGER,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Find boots for a session
CREATE INDEX IF NOT EXISTS idx_boot_runs_session
  ON boot_runs (session_id, created_at DESC);

-- Find failed boots for debugging
CREATE INDEX IF NOT EXISTS idx_boot_runs_failed
  ON boot_runs (status, created_at DESC)
  WHERE status IN ('failed', 'rolled_back');

-- Auto-update timestamp
DROP TRIGGER IF EXISTS boot_runs_updated_at ON boot_runs;
CREATE TRIGGER boot_runs_updated_at
  BEFORE UPDATE ON boot_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE boot_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'boot_runs' AND policyname = 'Service role full access on boot_runs'
  ) THEN
    CREATE POLICY "Service role full access on boot_runs"
      ON boot_runs
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON TABLE public.boot_runs TO service_role;


-- ============================================================
-- 2. Agent Configuration Table
-- Stores scoped configuration snapshots with provenance tracking.
-- Each row represents a complete merged configuration as of a
-- point in time, with every setting traced to its source scope.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_config (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  config_id     UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  session_id    TEXT,  -- NULL for "current active config" (no session yet)

  -- The merged configuration object
  merged_config JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Provenance map: which scope provided which setting
  -- Example:
  -- {
  --   "model":       {"value": "opus-4", "scope": "project", "file": ".claude.json"},
  --   "permissions":  {"value": {"allow": []}, "scope": "user", "file": "~/.claude/settings.json"},
  --   "mcpServers.ob1": {"value": {...}, "scope": "local", "file": ".claude/settings.local.json"}
  -- }
  provenance    JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- MCP server list after deduplication
  -- Example:
  -- [
  --   {"name": "ob1", "url": "https://...", "scope": "project", "deduplicated_from": ["user", "project"]},
  --   {"name": "github", "url": "https://...", "scope": "user"}
  -- ]
  mcp_servers   JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Source files that were loaded (for debugging)
  -- Example:
  -- [
  --   {"path": "~/.claude.json", "scope": "user", "exists": true, "loaded": true},
  --   {"path": ".claude/settings.local.json", "scope": "local", "exists": false, "loaded": false}
  -- ]
  source_files  JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Validation status
  valid         BOOLEAN NOT NULL DEFAULT true,
  validation_errors JSONB DEFAULT '[]'::jsonb,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup by session
CREATE INDEX IF NOT EXISTS idx_agent_config_session
  ON agent_config (session_id, created_at DESC);

-- Auto-update timestamp
DROP TRIGGER IF EXISTS agent_config_updated_at ON agent_config;
CREATE TRIGGER agent_config_updated_at
  BEFORE UPDATE ON agent_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE agent_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_config' AND policyname = 'Service role full access on agent_config'
  ) THEN
    CREATE POLICY "Service role full access on agent_config"
      ON agent_config
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

GRANT SELECT, INSERT ON TABLE public.agent_config TO service_role;


-- ============================================================
-- 3. Extend system_events Categories
-- Add boot and doctor categories to the system_events CHECK
-- constraint. Existing categories from BP03 are preserved.
-- ============================================================

ALTER TABLE system_events DROP CONSTRAINT IF EXISTS system_events_category_check;
ALTER TABLE system_events ADD CONSTRAINT system_events_category_check
  CHECK (category IN (
    -- Existing from BP03
    'initialization', 'registry', 'tool_selection', 'permission',
    'execution', 'stream', 'turn_complete', 'session',
    'compaction', 'usage', 'error', 'hook', 'verification',
    -- New for BP05
    'boot',           -- boot pipeline phase events
    'doctor',         -- doctor check events
    'config'          -- configuration loading events
  ));


-- ============================================================
-- 4. View: boot_performance_summary
-- For operational dashboards showing boot time trends.
-- ============================================================

CREATE OR REPLACE VIEW boot_performance_summary AS
SELECT
  session_id,
  run_id,
  status,
  reached_phase,
  failed_phase,
  trust_mode,
  fast_path_used,
  total_duration_ms,
  -- Extract individual phase durations for charting
  (phase_timings->'prefetch'->>'duration_ms')::int         AS prefetch_ms,
  (phase_timings->'environment'->>'duration_ms')::int       AS environment_ms,
  (phase_timings->'config_loading'->>'duration_ms')::int    AS config_loading_ms,
  (phase_timings->'trust_gate'->>'duration_ms')::int        AS trust_gate_ms,
  (phase_timings->'registry_init'->>'duration_ms')::int     AS registry_init_ms,
  (phase_timings->'workspace_init'->>'duration_ms')::int    AS workspace_init_ms,
  (phase_timings->'deferred_loading'->>'duration_ms')::int  AS deferred_loading_ms,
  (phase_timings->'mode_routing'->>'duration_ms')::int      AS mode_routing_ms,
  (phase_timings->'doctor_check'->>'duration_ms')::int      AS doctor_check_ms,
  -- Doctor results
  (doctor_summary->>'pass')::int  AS doctor_pass,
  (doctor_summary->>'warn')::int  AS doctor_warn,
  (doctor_summary->>'fail')::int  AS doctor_fail,
  created_at
FROM boot_runs
ORDER BY created_at DESC;

GRANT SELECT ON boot_performance_summary TO service_role;


-- ============================================================
-- 5. Function: persist_config_snapshot()
-- Called by the boot pipeline after config loading phase.
-- Inserts a new config snapshot and returns its config_id.
-- ============================================================

CREATE OR REPLACE FUNCTION persist_config_snapshot(
  p_session_id TEXT,
  p_merged_config JSONB,
  p_provenance JSONB,
  p_mcp_servers JSONB,
  p_source_files JSONB,
  p_valid BOOLEAN DEFAULT true,
  p_validation_errors JSONB DEFAULT '[]'::jsonb
)
RETURNS UUID AS $$
DECLARE
  v_config_id UUID;
BEGIN
  INSERT INTO agent_config (
    session_id, merged_config, provenance,
    mcp_servers, source_files, valid, validation_errors
  )
  VALUES (
    p_session_id, p_merged_config, p_provenance,
    p_mcp_servers, p_source_files, p_valid, p_validation_errors
  )
  RETURNING config_id INTO v_config_id;

  RETURN v_config_id;
END;
$$ LANGUAGE plpgsql;
