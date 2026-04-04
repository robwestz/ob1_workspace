-- ============================================================
-- Migration 001: Tool Registry & Permission System
-- ============================================================
--
-- Creates:
--   Tables:
--     - tool_registry          — single source of truth for all registered tools
--     - permission_policies    — named permission policies for sessions/agents
--     - permission_audit_log   — every permission decision is logged here
--
--   Functions:
--     - persist_permission_audit()  — summarises a session's audit trail
--                                     and writes it as a thought
--
--   Seed data:
--     - 9 built-in tool entries (read_file, write_file, edit_file,
--       glob_search, grep_search, bash, web_fetch, agent, tool_search)
--
-- Prerequisites:
--   - Core OB1 `thoughts` table must already exist
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
-- 1. tool_registry
--    The single source of truth for all registered tools.
--    Tools can be built-in, plugins, skills, or MCP-sourced.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_registry (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name                 TEXT        NOT NULL UNIQUE,
  description          TEXT        NOT NULL,
  source_type          TEXT        NOT NULL
    CHECK (source_type IN ('built_in', 'plugin', 'skill', 'mcp')),
  required_permission  TEXT        NOT NULL DEFAULT 'read_only'
    CHECK (required_permission IN ('read_only', 'workspace_write', 'danger_full_access')),
  input_schema         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  side_effect_profile  JSONB       DEFAULT '{}'::jsonb,
  enabled              BOOLEAN     NOT NULL DEFAULT true,
  aliases              TEXT[]      DEFAULT '{}',
  mcp_server_url       TEXT,
  metadata             JSONB       DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

-- Fast lookups by source type and permission level
CREATE INDEX IF NOT EXISTS idx_tool_registry_source
  ON tool_registry (source_type);

CREATE INDEX IF NOT EXISTS idx_tool_registry_permission
  ON tool_registry (required_permission);

-- Partial index: only enabled tools (most common query path)
CREATE INDEX IF NOT EXISTS idx_tool_registry_enabled
  ON tool_registry (enabled) WHERE enabled = true;

-- Auto-update timestamp
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'tool_registry_updated_at'
  ) THEN
    CREATE TRIGGER tool_registry_updated_at
      BEFORE UPDATE ON tool_registry
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;


-- -------------------------------------------------------
-- 2. permission_policies
--    Named permission policies assignable to sessions
--    or agents. Controls baseline mode, per-tool overrides,
--    deny/allow lists, and escalation handler type.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS permission_policies (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT        NOT NULL UNIQUE,
  description     TEXT,
  active_mode     TEXT        NOT NULL DEFAULT 'read_only'
    CHECK (active_mode IN (
      'read_only', 'workspace_write', 'danger_full_access', 'prompt', 'allow'
    )),
  tool_overrides  JSONB       DEFAULT '{}'::jsonb,
  handler_type    TEXT        NOT NULL DEFAULT 'interactive'
    CHECK (handler_type IN ('interactive', 'coordinator', 'swarm_worker')),
  deny_tools      TEXT[]      DEFAULT '{}',
  deny_prefixes   TEXT[]      DEFAULT '{}',
  allow_tools     TEXT[]      DEFAULT '{}',
  metadata        JSONB       DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Auto-update timestamp
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'permission_policies_updated_at'
  ) THEN
    CREATE TRIGGER permission_policies_updated_at
      BEFORE UPDATE ON permission_policies
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;


-- -------------------------------------------------------
-- 3. permission_audit_log
--    Append-only log of every permission decision.
--    Each row records which tool was checked, the outcome,
--    who/what decided, and which policy was evaluated.
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS permission_audit_log (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      TEXT        NOT NULL,
  tool_name       TEXT        NOT NULL,
  decision        TEXT        NOT NULL
    CHECK (decision IN ('allow', 'deny', 'escalate')),
  reason          TEXT,
  decided_by      TEXT        NOT NULL
    CHECK (decided_by IN ('policy', 'prompter', 'coordinator', 'swarm_deny')),
  active_mode     TEXT        NOT NULL,
  required_mode   TEXT        NOT NULL,
  policy_id       UUID        REFERENCES permission_policies(id),
  input_summary   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Query audit trail by session (newest first)
CREATE INDEX IF NOT EXISTS idx_audit_session
  ON permission_audit_log (session_id, created_at DESC);

-- Query audit trail by tool (newest first)
CREATE INDEX IF NOT EXISTS idx_audit_tool
  ON permission_audit_log (tool_name, created_at DESC);

-- Filter by decision outcome
CREATE INDEX IF NOT EXISTS idx_audit_decision
  ON permission_audit_log (decision);


-- -------------------------------------------------------
-- 4. Row-Level Security
-- -------------------------------------------------------
ALTER TABLE tool_registry          ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_policies    ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_audit_log   ENABLE ROW LEVEL SECURITY;

-- Policies: service_role gets full access to all three tables.
-- Using DO blocks to avoid errors on re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tool_registry' AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON tool_registry FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'permission_policies' AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON permission_policies FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'permission_audit_log' AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON permission_audit_log FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;


-- -------------------------------------------------------
-- 5. Grants
-- -------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON TABLE public.tool_registry TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.permission_policies TO service_role;
GRANT SELECT, INSERT ON TABLE public.permission_audit_log TO service_role;


-- -------------------------------------------------------
-- 6. persist_permission_audit() function
--    Summarises a session's permission audit trail and
--    writes it as a thought in the core thoughts table.
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION persist_permission_audit(
  p_session_id TEXT,
  p_summary    JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
  v_denial_count INT;
  v_total_count  INT;
  v_content      TEXT;
  v_id           UUID;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE decision = 'deny'),
    COUNT(*)
  INTO v_denial_count, v_total_count
  FROM permission_audit_log
  WHERE session_id = p_session_id;

  v_content := format(
    'Permission audit for session %s: %s decisions total, %s denials.',
    p_session_id, v_total_count, v_denial_count
  );

  INSERT INTO thoughts (content, metadata)
  VALUES (
    v_content,
    jsonb_build_object(
      'type',            'permission_audit',
      'session_id',      p_session_id,
      'total_decisions', v_total_count,
      'denial_count',    v_denial_count,
      'summary',         p_summary,
      'created_at',      now()
    )
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;


-- -------------------------------------------------------
-- 7. Seed data: built-in tool definitions
--    Uses ON CONFLICT to make this idempotent.
-- -------------------------------------------------------

-- read_file
INSERT INTO tool_registry (name, description, source_type, required_permission, input_schema, side_effect_profile, enabled, aliases, metadata)
VALUES (
  'read_file',
  'Read a file from the filesystem',
  'built_in',
  'read_only',
  '{"type":"object","properties":{"file_path":{"type":"string","description":"Absolute path to file"},"offset":{"type":"number","description":"Line to start from"},"limit":{"type":"number","description":"Number of lines to read"}},"required":["file_path"]}'::jsonb,
  '{"writes_files":false,"network_access":false,"destructive":false,"reversible":true,"spawns_process":false}'::jsonb,
  true,
  ARRAY['read'],
  '{}'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- write_file
INSERT INTO tool_registry (name, description, source_type, required_permission, input_schema, side_effect_profile, enabled, aliases, metadata)
VALUES (
  'write_file',
  'Write content to a file (overwrites)',
  'built_in',
  'workspace_write',
  '{"type":"object","properties":{"file_path":{"type":"string"},"content":{"type":"string"}},"required":["file_path","content"]}'::jsonb,
  '{"writes_files":true,"network_access":false,"destructive":true,"reversible":false,"spawns_process":false}'::jsonb,
  true,
  ARRAY['write'],
  '{}'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- edit_file
INSERT INTO tool_registry (name, description, source_type, required_permission, input_schema, side_effect_profile, enabled, aliases, metadata)
VALUES (
  'edit_file',
  'Apply a targeted string replacement to a file',
  'built_in',
  'workspace_write',
  '{"type":"object","properties":{"file_path":{"type":"string"},"old_string":{"type":"string"},"new_string":{"type":"string"},"replace_all":{"type":"boolean","default":false}},"required":["file_path","old_string","new_string"]}'::jsonb,
  '{"writes_files":true,"network_access":false,"destructive":false,"reversible":true,"spawns_process":false}'::jsonb,
  true,
  ARRAY['edit'],
  '{}'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- glob_search
INSERT INTO tool_registry (name, description, source_type, required_permission, input_schema, side_effect_profile, enabled, aliases, metadata)
VALUES (
  'glob_search',
  'Find files by glob pattern',
  'built_in',
  'read_only',
  '{"type":"object","properties":{"pattern":{"type":"string"},"path":{"type":"string"}},"required":["pattern"]}'::jsonb,
  '{"writes_files":false,"network_access":false,"destructive":false,"reversible":true,"spawns_process":false}'::jsonb,
  true,
  ARRAY['glob'],
  '{}'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- grep_search
INSERT INTO tool_registry (name, description, source_type, required_permission, input_schema, side_effect_profile, enabled, aliases, metadata)
VALUES (
  'grep_search',
  'Search file contents with regex',
  'built_in',
  'read_only',
  '{"type":"object","properties":{"pattern":{"type":"string"},"path":{"type":"string"},"glob":{"type":"string"}},"required":["pattern"]}'::jsonb,
  '{"writes_files":false,"network_access":false,"destructive":false,"reversible":true,"spawns_process":false}'::jsonb,
  true,
  ARRAY['grep'],
  '{}'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- bash
INSERT INTO tool_registry (name, description, source_type, required_permission, input_schema, side_effect_profile, enabled, aliases, metadata)
VALUES (
  'bash',
  'Execute a shell command',
  'built_in',
  'danger_full_access',
  '{"type":"object","properties":{"command":{"type":"string"},"timeout":{"type":"number"}},"required":["command"]}'::jsonb,
  '{"writes_files":true,"network_access":true,"destructive":true,"reversible":false,"spawns_process":true}'::jsonb,
  true,
  ARRAY['shell', 'exec'],
  '{}'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- web_fetch
INSERT INTO tool_registry (name, description, source_type, required_permission, input_schema, side_effect_profile, enabled, aliases, metadata)
VALUES (
  'web_fetch',
  'Fetch content from a URL',
  'built_in',
  'read_only',
  '{"type":"object","properties":{"url":{"type":"string"}},"required":["url"]}'::jsonb,
  '{"writes_files":false,"network_access":true,"destructive":false,"reversible":true,"spawns_process":false}'::jsonb,
  true,
  ARRAY['fetch'],
  '{}'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- agent
INSERT INTO tool_registry (name, description, source_type, required_permission, input_schema, side_effect_profile, enabled, aliases, metadata)
VALUES (
  'agent',
  'Spawn a sub-agent with scoped tools and permissions',
  'built_in',
  'danger_full_access',
  '{"type":"object","properties":{"prompt":{"type":"string"},"allowed_tools":{"type":"array","items":{"type":"string"}},"permission_mode":{"type":"string"}},"required":["prompt"]}'::jsonb,
  '{"writes_files":true,"network_access":true,"destructive":true,"reversible":false,"spawns_process":true}'::jsonb,
  true,
  ARRAY[]::text[],
  '{}'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- tool_search
INSERT INTO tool_registry (name, description, source_type, required_permission, input_schema, side_effect_profile, enabled, aliases, metadata)
VALUES (
  'tool_search',
  'Discover deferred/MCP tools at runtime by name or keyword',
  'built_in',
  'read_only',
  '{"type":"object","properties":{"query":{"type":"string"},"max_results":{"type":"number","default":5}},"required":["query"]}'::jsonb,
  '{"writes_files":false,"network_access":false,"destructive":false,"reversible":true,"spawns_process":false}'::jsonb,
  true,
  ARRAY[]::text[],
  '{"is_meta_tool":true}'::jsonb
)
ON CONFLICT (name) DO NOTHING;


-- ============================================================
-- Done. Verify with:
--   SELECT name, source_type, required_permission FROM tool_registry ORDER BY name;
--   SELECT name, active_mode, handler_type FROM permission_policies;
--   SELECT count(*) FROM permission_audit_log;
-- ============================================================
