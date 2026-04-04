-- =============================================================================
-- Migration 007: Memory System
-- Blueprint: 07_memory_system.md
--
-- Creates the memory system layer on top of OB1's existing thoughts table.
-- This migration does NOT modify the core thoughts table structure.
-- It adds:
--   1. memory_versions table — tracks memory evolution over time
--   2. memory_age_factor() function — exponential decay by memory type
--   3. match_thoughts_scored() function — scored search with aging, scope,
--      trust weighting (wraps existing match_thoughts)
--   4. Expression indexes on thoughts.metadata for memory-system queries
--
-- Safe to run in Supabase SQL Editor. All operations are additive.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Utility: ensure the updated_at trigger function exists
--    (OB1 extensions use update_updated_at_column; we create it IF NOT EXISTS
--     via CREATE OR REPLACE so it is safe to re-run.)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
-- 1. memory_versions table
--    Tracks the evolution of memories over time. Each row represents one
--    version change. Does NOT modify the core thoughts table.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS memory_versions (
  id            UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  thought_id    UUID         NOT NULL REFERENCES thoughts(id),         -- the new version
  previous_thought_id UUID   REFERENCES thoughts(id),                  -- the old version (NULL for v1)
  version_number INT         NOT NULL DEFAULT 1,
  change_reason  TEXT,                                                  -- why this was updated
  previous_content TEXT,                                                -- snapshot of old content
  created_at    TIMESTAMPTZ  DEFAULT now(),
  updated_at    TIMESTAMPTZ  DEFAULT now()
);

-- Primary query: version chain for a thought
CREATE INDEX IF NOT EXISTS idx_memory_versions_thought
  ON memory_versions (thought_id);

-- Reverse lookup: what replaced this thought?
CREATE INDEX IF NOT EXISTS idx_memory_versions_previous
  ON memory_versions (previous_thought_id)
  WHERE previous_thought_id IS NOT NULL;

-- Auto-update updated_at on row changes
DROP TRIGGER IF EXISTS memory_versions_updated_at ON memory_versions;
CREATE TRIGGER memory_versions_updated_at
  BEFORE UPDATE ON memory_versions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 2. RLS + Grants for memory_versions
-- ---------------------------------------------------------------------------

ALTER TABLE memory_versions ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access (matches OB1 pattern)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'memory_versions'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON memory_versions
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.memory_versions TO service_role;


-- ---------------------------------------------------------------------------
-- 3. memory_age_factor() function
--    Returns a decay multiplier between 0.0 and 1.0 based on the age of a
--    memory and its type. Instructions persist longest (365-day half-life);
--    context is most ephemeral (7-day half-life).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION memory_age_factor(
  created_at   TIMESTAMPTZ,
  memory_type  TEXT,
  reference_time TIMESTAMPTZ DEFAULT now()
)
RETURNS FLOAT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  days_old  FLOAT;
  half_life FLOAT;
BEGIN
  days_old := EXTRACT(EPOCH FROM (reference_time - created_at)) / 86400.0;

  -- Half-life in days by memory type
  half_life := CASE memory_type
    WHEN 'instruction' THEN 365.0   -- Instructions persist for a year
    WHEN 'decision'    THEN 90.0    -- Decisions are relevant for a quarter
    WHEN 'preference'  THEN 180.0   -- Preferences change slowly
    WHEN 'fact'        THEN 120.0   -- Facts may become outdated
    WHEN 'observation' THEN 30.0    -- Observations go stale quickly
    WHEN 'context'     THEN 7.0     -- Context is highly ephemeral
    ELSE 90.0                        -- Default to 90-day half-life
  END;

  -- Exponential decay: 1.0 / (1.0 + days_old / half_life)
  RETURN 1.0 / (1.0 + days_old / half_life);
END;
$$;


-- ---------------------------------------------------------------------------
-- 4. match_thoughts_scored() function
--    Scored search: pgvector cosine similarity * age decay * scope weight
--    * trust weight * relevance boost. Wraps the existing match_thoughts
--    function with scoring overlays.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION match_thoughts_scored(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.5,
  match_count     int   DEFAULT 10,
  filter          jsonb DEFAULT '{}'::jsonb,
  apply_aging     boolean DEFAULT true
)
RETURNS TABLE (
  id          uuid,
  content     text,
  metadata    jsonb,
  similarity  float,
  aged_score  float,
  created_at  timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.content,
    t.metadata,
    (1 - (t.embedding <=> query_embedding))::float AS similarity,
    CASE
      WHEN apply_aging THEN
        (1 - (t.embedding <=> query_embedding))::float
        * memory_age_factor(
            t.created_at,
            COALESCE(t.metadata->>'memory_type', 'observation')
          )
        * CASE COALESCE(t.metadata->>'memory_scope', 'personal')
            WHEN 'project'  THEN 1.0
            WHEN 'team'     THEN 0.9
            WHEN 'personal' THEN 0.8
            WHEN 'agent'    THEN 0.7
            ELSE 0.8
          END
        * CASE
            WHEN (t.metadata->'provenance'->>'trust_level')::int IS NULL THEN 0.5
            ELSE ((t.metadata->'provenance'->>'trust_level')::int / 5.0)::float
          END
        * COALESCE((t.metadata->>'relevance_boost')::float, 1.0)
      ELSE
        (1 - (t.embedding <=> query_embedding))::float
    END AS aged_score,
    t.created_at
  FROM thoughts t
  WHERE
    -- Cosine similarity threshold
    1 - (t.embedding <=> query_embedding) > match_threshold
    -- Metadata filter (existing behavior from match_thoughts)
    AND (filter = '{}'::jsonb OR t.metadata @> filter)
    -- Exclude soft-deleted memories
    AND (t.metadata->>'deleted') IS DISTINCT FROM 'true'
    -- Only include thoughts that have memory metadata (avoid non-memory thoughts)
    AND t.metadata->>'memory_scope' IS NOT NULL
  ORDER BY
    CASE
      WHEN apply_aging THEN
        (1 - (t.embedding <=> query_embedding))::float
        * memory_age_factor(
            t.created_at,
            COALESCE(t.metadata->>'memory_type', 'observation')
          )
        * CASE COALESCE(t.metadata->>'memory_scope', 'personal')
            WHEN 'project'  THEN 1.0
            WHEN 'team'     THEN 0.9
            WHEN 'personal' THEN 0.8
            WHEN 'agent'    THEN 0.7
            ELSE 0.8
          END
        * CASE
            WHEN (t.metadata->'provenance'->>'trust_level')::int IS NULL THEN 0.5
            ELSE ((t.metadata->'provenance'->>'trust_level')::int / 5.0)::float
          END
        * COALESCE((t.metadata->>'relevance_boost')::float, 1.0)
      ELSE
        (1 - (t.embedding <=> query_embedding))::float
    END DESC
  LIMIT match_count;
END;
$$;


-- ---------------------------------------------------------------------------
-- 5. Expression indexes on thoughts.metadata
--    These are additive indexes on the EXISTING thoughts table.
--    The table structure is NOT modified (guard rail compliant).
-- ---------------------------------------------------------------------------

-- Fast scope-filtered queries
CREATE INDEX IF NOT EXISTS idx_thoughts_memory_scope
  ON thoughts ((metadata->>'memory_scope'))
  WHERE metadata->>'memory_scope' IS NOT NULL;

-- Fast type-filtered queries
CREATE INDEX IF NOT EXISTS idx_thoughts_memory_type
  ON thoughts ((metadata->>'memory_type'))
  WHERE metadata->>'memory_type' IS NOT NULL;

-- Fast owner-filtered queries (personal scope)
CREATE INDEX IF NOT EXISTS idx_thoughts_owner_id
  ON thoughts ((metadata->>'owner_id'))
  WHERE metadata->>'owner_id' IS NOT NULL;

-- Exclude soft-deleted from default queries
CREATE INDEX IF NOT EXISTS idx_thoughts_not_deleted
  ON thoughts ((metadata->>'deleted'))
  WHERE (metadata->>'deleted') IS DISTINCT FROM 'true';


-- =============================================================================
-- End of Migration 007
-- =============================================================================
