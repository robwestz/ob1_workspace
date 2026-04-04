-- =============================================================================
-- Migration 008: Skills & Extensibility
-- Blueprint: 08_skills_and_extensibility.md
--
-- Creates the skills, hooks, and plugin system tables:
--   1. plugin_registry     — installed plugins with trust tiers and permissions
--   2. skill_registry      — skill definitions with prompt templates and triggers
--   3. hook_configurations — registered hook commands per event type
--   4. hook_execution_log  — audit trail of every hook invocation
--
-- Note: plugin_registry is created FIRST because skill_registry and
--       hook_configurations reference it via foreign key.
--
-- Safe to run in Supabase SQL Editor. All operations are additive.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Utility: ensure the updated_at trigger function exists
--    (Shared with migration 007; CREATE OR REPLACE is safe to re-run.)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
-- 1. plugin_registry table
--    Installed plugins: packages of skills + hooks + tools + config.
--    Created first because skill_registry and hook_configurations
--    reference it via FK.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS plugin_registry (
  id                  UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  name                TEXT         NOT NULL UNIQUE,
  slug                TEXT         NOT NULL UNIQUE,
  description         TEXT,
  version             TEXT         NOT NULL DEFAULT '1.0.0',
  author_name         TEXT,
  author_github       TEXT,

  -- Trust tier assigned at install time
  trust_tier          TEXT         NOT NULL DEFAULT 'plugin'
    CHECK (trust_tier IN ('built_in', 'plugin')),

  -- Plugin state
  status              TEXT         NOT NULL DEFAULT 'enabled'
    CHECK (status IN ('enabled', 'disabled', 'installing', 'error')),

  -- Scoped permissions: what this plugin's skills and hooks can do
  -- Schema: { "tools": [...], "hooks": [...], "file_access": [...], "network": bool }
  granted_permissions JSONB        DEFAULT '{}'::jsonb,

  -- Plugin manifest (full package.json-like definition)
  manifest            JSONB        NOT NULL DEFAULT '{}'::jsonb,

  -- Where the plugin was installed from
  source_url          TEXT,

  metadata            JSONB        DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ  DEFAULT now(),
  updated_at          TIMESTAMPTZ  DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_plugin_status
  ON plugin_registry (status);

CREATE INDEX IF NOT EXISTS idx_plugin_trust
  ON plugin_registry (trust_tier);

-- Auto-update updated_at
DROP TRIGGER IF EXISTS plugin_registry_updated_at ON plugin_registry;
CREATE TRIGGER plugin_registry_updated_at
  BEFORE UPDATE ON plugin_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 2. skill_registry table
--    Skill definitions: prompt templates, triggers, and tool requirements.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS skill_registry (
  id                UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  name              TEXT         NOT NULL,
  slug              TEXT         NOT NULL UNIQUE,
  description       TEXT         NOT NULL,
  version           TEXT         NOT NULL DEFAULT '1.0.0',

  -- Skill source: where this skill was loaded from
  source_type       TEXT         NOT NULL
    CHECK (source_type IN ('bundled', 'user', 'ob1', 'mcp_generated')),

  -- For user skills: the file path on disk where the SKILL.md lives
  source_path       TEXT,

  -- For OB1 skills: the community skill slug from OB1/skills/
  ob1_slug          TEXT,

  -- The prompt template injected when this skill activates
  -- Supports {{variable}} interpolation from input_contract
  prompt_template   TEXT         NOT NULL,

  -- Trigger conditions (evaluated by the skill router)
  -- Schema: { "phrases": [...], "file_patterns": [...], "tool_context": [...], "always": bool }
  trigger           JSONB        NOT NULL DEFAULT '{}'::jsonb,

  -- What the skill expects as input
  -- Schema: { "required": [...], "optional": [...], "defaults": {...} }
  input_contract    JSONB        DEFAULT '{}'::jsonb,

  -- What the skill produces
  -- Schema: { "produces": [...], "side_effects": [...] }
  output_contract   JSONB        DEFAULT '{}'::jsonb,

  -- Tools this skill needs in the tool pool to function
  tool_requirements TEXT[]       DEFAULT '{}',

  -- Plugin that owns this skill (NULL for standalone skills)
  plugin_id         UUID         REFERENCES plugin_registry(id) ON DELETE CASCADE,

  -- Trust tier inherited from source
  trust_tier        TEXT         NOT NULL DEFAULT 'skill'
    CHECK (trust_tier IN ('built_in', 'plugin', 'skill')),

  enabled           BOOLEAN      NOT NULL DEFAULT true,
  metadata          JSONB        DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ  DEFAULT now(),
  updated_at        TIMESTAMPTZ  DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_skill_source
  ON skill_registry (source_type);

CREATE INDEX IF NOT EXISTS idx_skill_enabled
  ON skill_registry (enabled)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_skill_slug
  ON skill_registry (slug);

CREATE INDEX IF NOT EXISTS idx_skill_plugin
  ON skill_registry (plugin_id)
  WHERE plugin_id IS NOT NULL;

-- Full-text search on skill name + description for discovery
CREATE INDEX IF NOT EXISTS idx_skill_fts
  ON skill_registry
  USING gin(to_tsvector('english', name || ' ' || description));

-- Auto-update updated_at
DROP TRIGGER IF EXISTS skill_registry_updated_at ON skill_registry;
CREATE TRIGGER skill_registry_updated_at
  BEFORE UPDATE ON skill_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 3. hook_configurations table
--    Hook commands registered per event type (PreToolUse / PostToolUse).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hook_configurations (
  id           UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  name         TEXT         NOT NULL,
  event_type   TEXT         NOT NULL
    CHECK (event_type IN ('PreToolUse', 'PostToolUse')),

  -- The shell command to execute
  command      TEXT         NOT NULL,

  -- Optional: only run this hook for specific tools (empty = all tools)
  -- Example: {"bash", "write_file"} means only trigger for these tools
  tool_filter  TEXT[]       DEFAULT '{}',

  -- Execution priority (lower = runs first)
  priority     INTEGER      NOT NULL DEFAULT 100,

  -- Timeout in milliseconds (0 = no timeout)
  timeout_ms   INTEGER      NOT NULL DEFAULT 30000,

  -- Plugin that owns this hook (NULL for user-defined hooks)
  plugin_id    UUID         REFERENCES plugin_registry(id) ON DELETE CASCADE,

  -- Trust tier determines execution context
  trust_tier   TEXT         NOT NULL DEFAULT 'skill'
    CHECK (trust_tier IN ('built_in', 'plugin', 'skill')),

  enabled      BOOLEAN      NOT NULL DEFAULT true,
  metadata     JSONB        DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ  DEFAULT now(),
  updated_at   TIMESTAMPTZ  DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hook_event
  ON hook_configurations (event_type);

CREATE INDEX IF NOT EXISTS idx_hook_enabled
  ON hook_configurations (enabled)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_hook_plugin
  ON hook_configurations (plugin_id)
  WHERE plugin_id IS NOT NULL;

-- Auto-update updated_at
DROP TRIGGER IF EXISTS hook_configurations_updated_at ON hook_configurations;
CREATE TRIGGER hook_configurations_updated_at
  BEFORE UPDATE ON hook_configurations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 4. hook_execution_log table
--    Audit trail of every hook invocation. Append-only by design.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hook_execution_log (
  id             UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id     TEXT         NOT NULL,
  hook_config_id UUID         REFERENCES hook_configurations(id),
  event_type     TEXT         NOT NULL,
  tool_name      TEXT         NOT NULL,

  -- Outcome: what the hook decided
  outcome        TEXT         NOT NULL
    CHECK (outcome IN ('allow', 'warn', 'deny', 'timeout', 'error')),
  exit_code      INTEGER,

  -- Hook feedback (stdout captured)
  feedback       TEXT,
  -- Error output (stderr captured)
  error_output   TEXT,

  -- Timing
  duration_ms    INTEGER      NOT NULL,
  timed_out      BOOLEAN      NOT NULL DEFAULT false,

  created_at     TIMESTAMPTZ  DEFAULT now(),
  updated_at     TIMESTAMPTZ  DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hook_log_session
  ON hook_execution_log (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hook_log_tool
  ON hook_execution_log (tool_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hook_log_outcome
  ON hook_execution_log (outcome);

-- Auto-update updated_at (for consistency, though this table is mostly append-only)
DROP TRIGGER IF EXISTS hook_execution_log_updated_at ON hook_execution_log;
CREATE TRIGGER hook_execution_log_updated_at
  BEFORE UPDATE ON hook_execution_log
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 5. RLS Policies
--    All tables use service_role access pattern matching OB1 conventions.
-- ---------------------------------------------------------------------------

-- plugin_registry
ALTER TABLE plugin_registry ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'plugin_registry'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON plugin_registry
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END;
$$;

-- skill_registry
ALTER TABLE skill_registry ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'skill_registry'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON skill_registry
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END;
$$;

-- hook_configurations
ALTER TABLE hook_configurations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hook_configurations'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON hook_configurations
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END;
$$;

-- hook_execution_log
ALTER TABLE hook_execution_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hook_execution_log'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON hook_execution_log
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END;
$$;


-- ---------------------------------------------------------------------------
-- 6. Grants
--    service_role gets full CRUD on all tables except hook_execution_log
--    which is append-heavy (SELECT + INSERT only, per blueprint).
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.plugin_registry TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.skill_registry TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hook_configurations TO service_role;
GRANT SELECT, INSERT ON TABLE public.hook_execution_log TO service_role;


-- =============================================================================
-- End of Migration 008
-- =============================================================================
