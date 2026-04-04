-- ============================================================
-- Migration 004: Transcript Compaction, Stop Reason Taxonomy,
--                Provenance-Aware Context Assembly
-- Source: Blueprint 04 — Primitives #10, #14, #15
-- Date: 2026-04-03
--
-- Creates:
--   - compaction_archive table (full content of compaction events)
--   - context_fragments table (provenance-tracked context pieces)
--   - Extended stop_reason CHECK on budget_ledger (from migration 002)
--   - RLS policies and grants for service_role
--
-- Dependencies:
--   - Migration 002 (budget_ledger table must exist for ALTER TABLE)
--   - thoughts table (referenced by compaction_archive.thought_id)
--
-- Runnable in: Supabase SQL Editor
-- ============================================================

-- ============================================================
-- Helper: updated_at trigger function
-- Uses CREATE OR REPLACE so it is safe to run if it already
-- exists from a prior migration (e.g., 003).
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- Table: compaction_archive
-- Archive of compacted transcript segments. Each row represents
-- one compaction event's removed messages. The summary goes into
-- agent_sessions.messages; the raw compacted messages go here
-- for retrieval and re-indexing.
-- ============================================================
CREATE TABLE IF NOT EXISTS compaction_archive (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,
  compaction_index INT NOT NULL,            -- 1st compaction, 2nd, etc.

  -- What was compacted
  messages_removed JSONB NOT NULL,          -- full message objects that were summarized
  message_count INT NOT NULL,               -- count for fast queries
  summary_text TEXT NOT NULL,               -- the generated summary
  summary_format TEXT NOT NULL DEFAULT 'xml'
    CHECK (summary_format IN ('xml', 'markdown', 'plain')),

  -- Token accounting at time of compaction
  input_tokens_before BIGINT NOT NULL,      -- cumulative input tokens before compaction
  input_tokens_after BIGINT NOT NULL,       -- cumulative input tokens after (should be lower)
  tokens_recovered BIGINT GENERATED ALWAYS AS (input_tokens_before - input_tokens_after) STORED,

  -- Persistence state
  persisted_to_thought BOOLEAN NOT NULL DEFAULT false,
  thought_id UUID REFERENCES thoughts(id),

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger: auto-update updated_at on compaction_archive
DROP TRIGGER IF EXISTS update_compaction_archive_updated_at ON compaction_archive;
CREATE TRIGGER update_compaction_archive_updated_at
    BEFORE UPDATE ON compaction_archive
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- Indexes: compaction_archive
-- ============================================================

-- Primary query: all compactions for a session, in order
CREATE INDEX IF NOT EXISTS idx_compaction_archive_session
  ON compaction_archive (session_id, compaction_index);

-- Find un-persisted compactions (for background thought-creation job)
CREATE INDEX IF NOT EXISTS idx_compaction_archive_unpersisted
  ON compaction_archive (persisted_to_thought)
  WHERE persisted_to_thought = false;


-- ============================================================
-- Table: context_fragments
-- Provenance-tracked context fragments. Every piece of context
-- injected into an agent prompt is tracked with provenance
-- metadata for trust scoring and contradiction detection.
-- ============================================================
CREATE TABLE IF NOT EXISTS context_fragments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,

  -- What this fragment is
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,                -- SHA-256 for deduplication
  token_count INT NOT NULL DEFAULT 0,        -- estimated token count

  -- Provenance metadata
  source_type TEXT NOT NULL
    CHECK (source_type IN (
      'system_prompt',
      'user_message',
      'tool_result',
      'retrieved_memory',
      'web_result',
      'compaction_summary',
      'instruction_file'
    )),
  source_uri TEXT,                           -- file path, URL, thought ID, etc.
  trust_level INT NOT NULL DEFAULT 3
    CHECK (trust_level BETWEEN 1 AND 5),     -- 5=highest (system_prompt), 1=lowest (web_result)

  -- Classification
  fragment_role TEXT NOT NULL DEFAULT 'evidence'
    CHECK (fragment_role IN ('instruction', 'evidence')),
  freshness_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- when content was created/fetched
  ttl_seconds INT,                           -- optional expiry (NULL = never expires)

  -- Injection tracking
  injected_at_turn INT,                      -- which turn this was injected into
  injection_budget_tokens INT,               -- how many tokens this consumed from budget

  -- Contradiction detection
  supersedes_fragment_id UUID REFERENCES context_fragments(id),
  contradiction_detected BOOLEAN NOT NULL DEFAULT false,
  contradiction_detail TEXT,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger: auto-update updated_at on context_fragments
DROP TRIGGER IF EXISTS update_context_fragments_updated_at ON context_fragments;
CREATE TRIGGER update_context_fragments_updated_at
    BEFORE UPDATE ON context_fragments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- Indexes: context_fragments
-- ============================================================

-- Fast lookup by session + source type
CREATE INDEX IF NOT EXISTS idx_context_fragments_session
  ON context_fragments (session_id, source_type);

-- Deduplication check
CREATE INDEX IF NOT EXISTS idx_context_fragments_hash
  ON context_fragments (content_hash);

-- Find expired fragments
CREATE INDEX IF NOT EXISTS idx_context_fragments_expiry
  ON context_fragments (freshness_at, ttl_seconds)
  WHERE ttl_seconds IS NOT NULL;


-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE compaction_archive ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'compaction_archive' AND policyname = 'Service role full access on compaction_archive'
  ) THEN
    CREATE POLICY "Service role full access on compaction_archive"
      ON compaction_archive
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

ALTER TABLE context_fragments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'context_fragments' AND policyname = 'Service role full access on context_fragments'
  ) THEN
    CREATE POLICY "Service role full access on context_fragments"
      ON context_fragments
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;


-- ============================================================
-- Grants
-- Explicit grants for service_role (required on newer Supabase
-- projects where default privileges may not include DML).
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.compaction_archive TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.context_fragments TO service_role;


-- ============================================================
-- Extend budget_ledger stop_reason CHECK constraint
-- Adds the new stop reasons from the complete taxonomy:
--   timeout, context_overflow, user_cancelled
-- while preserving the original values from Blueprint 02:
--   completed, max_turns_reached, max_budget_tokens_reached,
--   max_budget_usd_reached, auto_compacted, user_stopped, error
--
-- NOTE: Requires budget_ledger to exist (from migration 002).
-- Postgres requires dropping and re-adding the constraint.
-- ============================================================

ALTER TABLE budget_ledger
  DROP CONSTRAINT IF EXISTS budget_ledger_stop_reason_check;

ALTER TABLE budget_ledger
  ADD CONSTRAINT budget_ledger_stop_reason_check
  CHECK (stop_reason IS NULL OR stop_reason IN (
    'completed',
    'max_turns_reached',
    'max_budget_tokens_reached',
    'max_budget_usd_reached',
    'auto_compacted',
    'user_stopped',
    'user_cancelled',
    'error',
    'timeout',
    'context_overflow'
  ));
