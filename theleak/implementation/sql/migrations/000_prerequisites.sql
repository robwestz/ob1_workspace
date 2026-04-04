-- =============================================================================
-- Migration 000: Prerequisites
-- Date: 2026-04-04
--
-- This migration runs BEFORE all others. It ensures that the trigger
-- functions used across migrations 001-008 exist, regardless of whether
-- the core OB1 setup has been run.
--
-- Creates:
--   1. update_updated_at_column() — the canonical trigger function used
--      by migrations 003, 004, 007, 008 and now standardized for all.
--   2. update_updated_at() — alias for the same behavior, created only
--      if it does not already exist (core OB1 may provide its own).
--
-- Safe to re-run: uses CREATE OR REPLACE and existence guards.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. Canonical trigger function: update_updated_at_column()
--    All migrations should reference this function.
--    CREATE OR REPLACE is safe if it already exists from migration 003/004/007/008.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
-- 2. Alias: update_updated_at()
--    Core OB1 setup may already provide this function. If it does, we
--    leave it alone. If it does not exist, we create it with identical
--    behavior so that any migration referencing it will not fail.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at'
  ) THEN
    CREATE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END $$;


-- =============================================================================
-- End of Migration 000
-- =============================================================================
