# SQL Migration Fix Log

**Date:** 2026-04-04
**Source:** Issues identified in `DEPLOY_CHECKLIST.md` sections 3 and 6.

---

## Summary

Fixed 5 categories of issues across 7 migration files and created 1 new prerequisite migration.

---

## Changes by File

### NEW: `000_prerequisites.sql`

Created to run before all other migrations. Ensures both trigger functions exist:

1. `update_updated_at_column()` -- canonical function, created via `CREATE OR REPLACE` (safe if already exists from migrations 003/004/007/008).
2. `update_updated_at()` -- alias created only if it does not already exist (core OB1 may provide its own).

This eliminates the CRITICAL risk of migrations 005/006 failing mid-execution if core OB1 setup has not run.

---

### `001_tool_registry_and_permissions.sql`

| Issue | Severity | Change |
|-------|----------|--------|
| Trigger function dependency on core `update_updated_at()` | CRITICAL | Removed hard `RAISE EXCEPTION` check for `update_updated_at`. Added `CREATE OR REPLACE FUNCTION update_updated_at_column()` guard. Switched all `EXECUTE FUNCTION update_updated_at()` references to `EXECUTE FUNCTION update_updated_at_column()`. |
| Missing UPDATE grant on `tool_registry` | BLOCKING | Changed `GRANT SELECT, INSERT` to `GRANT SELECT, INSERT, UPDATE` on `tool_registry`. |

---

### `002_state_and_budget.sql`

| Issue | Severity | Change |
|-------|----------|--------|
| Trigger function dependency on core `update_updated_at()` | CRITICAL | Removed hard `RAISE EXCEPTION` check for `update_updated_at`. Added `CREATE OR REPLACE FUNCTION update_updated_at_column()` guard. Switched all `EXECUTE FUNCTION update_updated_at()` references to `EXECUTE FUNCTION update_updated_at_column()`. |

---

### `003_streaming_logging_verification.sql`

| Issue | Severity | Change |
|-------|----------|--------|
| Non-idempotent RLS policies | MEDIUM | Wrapped both `CREATE POLICY` statements (`system_events`, `verification_runs`) in `DO $$ IF NOT EXISTS` guard blocks. |

---

### `004_compaction_stops_provenance.sql`

| Issue | Severity | Change |
|-------|----------|--------|
| Non-idempotent RLS policies | MEDIUM | Wrapped both `CREATE POLICY` statements (`compaction_archive`, `context_fragments`) in `DO $$ IF NOT EXISTS` guard blocks. |

---

### `005_doctor_and_boot.sql`

| Issue | Severity | Change |
|-------|----------|--------|
| Missing trigger function prerequisite | CRITICAL | Added `CREATE OR REPLACE FUNCTION update_updated_at_column()` guard at top of file. Switched all `EXECUTE FUNCTION update_updated_at()` to `EXECUTE FUNCTION update_updated_at_column()`. |
| Non-idempotent triggers | MEDIUM | Added `DROP TRIGGER IF EXISTS` before both `CREATE TRIGGER` statements (`boot_runs_updated_at`, `agent_config_updated_at`). |
| Non-idempotent RLS policies | MEDIUM | Wrapped both `CREATE POLICY` statements (`boot_runs`, `agent_config`) in `DO $$ IF NOT EXISTS` guard blocks. |

---

### `006_agent_type_system.sql`

| Issue | Severity | Change |
|-------|----------|--------|
| Missing trigger function prerequisite | CRITICAL | Added `CREATE OR REPLACE FUNCTION update_updated_at_column()` guard at top of file. Switched all `EXECUTE FUNCTION update_updated_at()` to `EXECUTE FUNCTION update_updated_at_column()`. |
| Non-idempotent triggers | MEDIUM | Added `DROP TRIGGER IF EXISTS` before all three `CREATE TRIGGER` statements (`agent_types_updated_at`, `agent_runs_updated_at`, `agent_messages_updated_at`). |
| Non-idempotent RLS policies | MEDIUM | Wrapped all three `CREATE POLICY` statements (`agent_types`, `agent_runs`, `agent_messages`) in `DO $$ IF NOT EXISTS` guard blocks. |

---

### `007_memory_system.sql`

| Issue | Severity | Change |
|-------|----------|--------|
| `memory_age_factor()` declared `IMMUTABLE` but uses `now()` default | INFO | Changed `IMMUTABLE` to `STABLE`. |

---

## Migration Execution Order (Updated)

```
000 -> 001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 -> 008
```

Migration 000 must run first. All other ordering remains unchanged.

---

## Verification

After applying these fixes, all migrations are:

1. **Independently re-runnable** -- every `CREATE TABLE`, `CREATE TRIGGER`, `CREATE POLICY`, and `CREATE FUNCTION` is guarded against re-execution errors.
2. **Consistent in trigger function naming** -- all migrations use `update_updated_at_column()`.
3. **Safe without core OB1 setup** -- migration 000 creates both `update_updated_at_column()` and (if missing) `update_updated_at()` as a fallback alias.
4. **Correct in grants** -- `tool_registry` now grants UPDATE to `service_role`, matching the `agent-tools` Edge Function's `update_tool` action.
5. **Correct in function volatility** -- `memory_age_factor()` is marked `STABLE`, not `IMMUTABLE`.
