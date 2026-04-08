-- =============================================================================
-- Migration 010: Knowledge Base
-- Roadmap: Phase 1, Plan 3 — Knowledge Base System
--
-- Creates the knowledge_base table for structured document storage that agents
-- consult before making decisions. Categories cover vision, architecture,
-- process, project, customer, operational, and learning knowledge.
--
-- Features:
--   1. knowledge_base table with category validation, versioning, and embeddings
--   2. RLS enabled, service_role full access
--   3. GIN index on tags, btree on category, IVFFlat on embedding
--   4. Similarity search RPC function (match_knowledge)
--   5. update_updated_at trigger
--
-- Safe to run in Supabase SQL Editor. All operations are additive.
-- No DROP TABLE, DROP DATABASE, TRUNCATE, or unqualified DELETE FROM.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Utility: ensure the updated_at trigger function exists
--    (Shared with migrations 007, 008; CREATE OR REPLACE is safe to re-run.)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
-- 1. knowledge_base table
--    Structured document store for agent decision-making. Each entry is a
--    versioned piece of knowledge with category, tags, relevance score,
--    and an optional embedding for semantic search.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS knowledge_base (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  category          TEXT         NOT NULL
    CHECK (category IN ('vision', 'architecture', 'process', 'project', 'customer', 'operational', 'learning')),
  title             TEXT         NOT NULL,
  content           TEXT         NOT NULL,
  version           INTEGER      NOT NULL DEFAULT 1,
  supersedes        UUID         REFERENCES knowledge_base(id),
  tags              TEXT[]       DEFAULT '{}',
  relevance_score   NUMERIC      DEFAULT 1.0
    CHECK (relevance_score >= 0 AND relevance_score <= 1),
  embedding         vector(1536),                   -- OpenAI text-embedding-3-small
  last_verified_at  TIMESTAMPTZ,                     -- when an agent last confirmed this is still true
  source            TEXT,                             -- where this knowledge came from
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

-- GIN index on tags for array containment queries (@> and &&)
CREATE INDEX IF NOT EXISTS idx_knowledge_base_tags
  ON knowledge_base USING gin(tags);

-- Btree index on category for filtered queries
CREATE INDEX IF NOT EXISTS idx_knowledge_base_category
  ON knowledge_base (category);

-- IVFFlat index on embedding for approximate nearest-neighbor search
-- Uses cosine distance (<=>). Lists tuned for small-to-medium table sizes.
-- Note: IVFFlat requires at least some rows to build; Supabase handles
-- empty-table indexing gracefully on first insert batch.
CREATE INDEX IF NOT EXISTS idx_knowledge_base_embedding
  ON knowledge_base USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Version chain lookup: find what superseded a given entry
CREATE INDEX IF NOT EXISTS idx_knowledge_base_supersedes
  ON knowledge_base (supersedes)
  WHERE supersedes IS NOT NULL;

-- Stale knowledge detection: entries not verified recently
CREATE INDEX IF NOT EXISTS idx_knowledge_base_verified
  ON knowledge_base (last_verified_at)
  WHERE last_verified_at IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 3. Auto-update updated_at trigger
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS knowledge_base_updated_at ON knowledge_base;
CREATE TRIGGER knowledge_base_updated_at
  BEFORE UPDATE ON knowledge_base
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 4. RLS + Grants
--    Service-role full access, matching OB1 conventions.
-- ---------------------------------------------------------------------------

ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'knowledge_base'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON knowledge_base
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.knowledge_base TO service_role;


-- ---------------------------------------------------------------------------
-- 5. match_knowledge() RPC function
--    Semantic search over knowledge_base entries using pgvector cosine
--    similarity. Optionally filters by category and respects relevance_score.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION match_knowledge(
  query_embedding   vector(1536),
  match_threshold   float DEFAULT 0.5,
  match_count       int   DEFAULT 10,
  filter_category   text  DEFAULT NULL
)
RETURNS TABLE (
  id              uuid,
  category        text,
  title           text,
  content         text,
  version         integer,
  tags            text[],
  relevance_score numeric,
  source          text,
  similarity      float,
  weighted_score  float,
  created_at      timestamptz,
  updated_at      timestamptz
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kb.id,
    kb.category,
    kb.title,
    kb.content,
    kb.version,
    kb.tags,
    kb.relevance_score,
    kb.source,
    (1 - (kb.embedding <=> query_embedding))::float AS similarity,
    ((1 - (kb.embedding <=> query_embedding))::float * kb.relevance_score::float) AS weighted_score,
    kb.created_at,
    kb.updated_at
  FROM knowledge_base kb
  WHERE
    -- Only entries that have embeddings
    kb.embedding IS NOT NULL
    -- Cosine similarity threshold
    AND (1 - (kb.embedding <=> query_embedding)) > match_threshold
    -- Only latest version (not superseded by another entry)
    AND NOT EXISTS (
      SELECT 1 FROM knowledge_base newer
      WHERE newer.supersedes = kb.id
    )
    -- Optional category filter
    AND (filter_category IS NULL OR kb.category = filter_category)
  ORDER BY weighted_score DESC
  LIMIT match_count;
END;
$$;


-- =============================================================================
-- End of Migration 010
-- =============================================================================
