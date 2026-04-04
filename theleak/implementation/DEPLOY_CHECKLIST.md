# Deployment Checklist -- OB1 Agentic Architecture

Generated: 2026-04-04

---

## 1. Pre-Deployment Checks

Before running any migration, confirm the following:

- [ ] The core OB1 `thoughts` table exists and has columns: `id` (UUID), `content` (TEXT), `metadata` (JSONB), `embedding` (vector(1536)), `created_at` (TIMESTAMPTZ), `content_fingerprint`
- [ ] The `update_updated_at()` trigger function exists (core OB1 setup). Migrations 001 and 002 will RAISE EXCEPTION if it is missing
- [ ] The `pgvector` extension is enabled (`CREATE EXTENSION IF NOT EXISTS vector`)
- [ ] Supabase project has `supabase_realtime` publication (migration 003 adds a table to it)
- [ ] The `auth.role()` function exists (all RLS policies depend on it)
- [ ] `OPENAI_API_KEY` environment variable is set for the `agent-memory` Edge Function (embedding generation)
- [ ] `OB1_ACCESS_KEY` environment variable is set for all three Edge Functions (auth)
- [ ] `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables are set for all Edge Functions
- [ ] Back up the database before running migrations

---

## 2. Migration Order -- Dependency Analysis

### Required execution order

```
001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 -> 008
```

### Dependency graph

| Migration | Depends on tables from | Depends on functions from | Notes |
|-----------|----------------------|-------------------------|-------|
| 001 | `thoughts` (core) | `update_updated_at()` (core) | Self-contained. Creates `tool_registry`, `permission_policies`, `permission_audit_log` |
| 002 | `thoughts` (core) | `update_updated_at()` (core) | Self-contained. Creates `agent_sessions`, `workflow_checkpoints`, `budget_ledger` |
| 003 | None | None | Independent of 001/002. Creates `system_events`, `verification_runs` |
| 004 | `thoughts` (core), `budget_ledger` (002) | `update_updated_at_column()` (003 or self) | **Must run after 002** -- ALTERs `budget_ledger` constraint |
| 005 | `system_events` (003) | `update_updated_at()` (core) | **Must run after 003** -- ALTERs `system_events` category CHECK |
| 006 | `thoughts` (core), `agent_runs` (self), `system_events` (003) | `update_updated_at()` (core) | **Must run after 003 and 005** -- ALTERs `system_events` category CHECK |
| 007 | `thoughts` (core) | None | Independent of other migrations (adds indexes + functions) |
| 008 | None | None | Self-contained. Creates `plugin_registry`, `skill_registry`, `hook_configurations`, `hook_execution_log` |

### Conclusion

No circular dependencies. The stated order (001 through 008) is correct and safe. Migrations 001, 002, 003, 007, and 008 are independent of each other and could theoretically run in parallel, but sequential execution is safer and avoids trigger function name confusion (see Issue #1 below).

---

## 3. Issues Found

### ISSUE 1 -- CRITICAL: Trigger function name inconsistency (`update_updated_at` vs `update_updated_at_column`)

**Two different trigger functions exist with nearly identical names and identical behavior:**

- **`update_updated_at()`** -- assumed to exist from core OB1 setup. Used by migrations 001, 002, 005, and 006.
- **`update_updated_at_column()`** -- created via `CREATE OR REPLACE` in migrations 003, 004, 007, and 008.

This is not a bug that prevents first-run deployment -- both functions will exist after all migrations run. But it creates confusion and fragility:

- Migrations 001 and 002 explicitly check for `update_updated_at()` via `pg_proc` and will RAISE EXCEPTION if core OB1 setup has not been run.
- Migrations 003, 004, 007, 008 create their own `update_updated_at_column()` and use it instead.
- Migrations 005 and 006 use `update_updated_at()` (the core one) **without** the guard check that 001/002 have.

**Impact:** If core OB1 setup has not been run, migrations 005 and 006 will fail with `function update_updated_at() does not exist` at the CREATE TRIGGER statement. Unlike 001/002, they do not check for the function upfront, so the error will come mid-migration after tables have already been created, leaving a partially-applied state.

**Recommended fix:** Either:
- (a) Add a prerequisite check block at the top of 005 and 006 (like 001/002 have), OR
- (b) Standardize all migrations on `update_updated_at_column()` (the self-created one), OR
- (c) Add `CREATE OR REPLACE FUNCTION update_updated_at()` to migration 003 or 005 as a fallback

---

### ISSUE 2 -- MEDIUM: Triggers in 005 and 006 are not idempotent (missing DROP TRIGGER IF EXISTS)

Migrations 005 and 006 create triggers with bare `CREATE TRIGGER` statements:

- 005, line 84: `CREATE TRIGGER boot_runs_updated_at`
- 005, line 153: `CREATE TRIGGER agent_config_updated_at`
- 006, line 88: `CREATE TRIGGER agent_types_updated_at`
- 006, line 178: `CREATE TRIGGER agent_runs_updated_at`
- 006, line 249: `CREATE TRIGGER agent_messages_updated_at`

**Impact:** Re-running migration 005 or 006 will fail with `trigger already exists` errors. All other migrations (001, 002, 003, 004, 007, 008) handle this correctly -- either with `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`, or with `DO $$ IF NOT EXISTS` blocks.

**Recommended fix:** Add `DROP TRIGGER IF EXISTS <name> ON <table>;` before each `CREATE TRIGGER` in 005 and 006.

---

### ISSUE 3 -- MEDIUM: RLS policies in 003, 004, 005, and 006 are not idempotent

Migrations 003, 004, 005, and 006 use bare `CREATE POLICY` statements without checking for existence:

- 003, line 140: `CREATE POLICY` on `system_events`
- 003, line 148: `CREATE POLICY` on `verification_runs`
- 004, line 171: `CREATE POLICY` on `compaction_archive`
- 004, line 176: `CREATE POLICY` on `context_fragments`
- 005, line 92: `CREATE POLICY` on `boot_runs`
- 005, line 161: `CREATE POLICY` on `agent_config`
- 006, line 96: `CREATE POLICY` on `agent_types`
- 006, line 186: `CREATE POLICY` on `agent_runs`
- 006, line 258: `CREATE POLICY` on `agent_messages`

**Impact:** Re-running these migrations will fail with `policy already exists` errors. Migrations 001, 002, 007, and 008 handle this correctly with `DO $$ IF NOT EXISTS` guard blocks.

**Recommended fix:** Wrap each `CREATE POLICY` in 003, 004, 005, 006 with the same `DO $$` guard pattern used in 001/002/007/008.

---

### ISSUE 4 -- LOW: RLS policy naming inconsistency

Two naming patterns are used across migrations:

- **Pattern A (001, 002, 007, 008):** `"Service role full access"` (same name on every table)
- **Pattern B (003, 004, 005, 006):** `"Service role full access on <tablename>"` (unique per table)

**Impact:** Not a functional issue -- PostgreSQL policy names are scoped per table. But the inconsistency means tooling that searches for policies by name will need to handle both patterns.

**Recommended fix:** No immediate fix needed. Consider standardizing in future migrations.

---

### ISSUE 5 -- LOW (runtime impact): Missing UPDATE grant on `tool_registry`

Migration 001 grants only SELECT and INSERT on `tool_registry` (line 218):

```sql
GRANT SELECT, INSERT ON TABLE public.tool_registry TO service_role;
```

But the `agent-tools` Edge Function has an `update_tool` action that calls `.update()` on `tool_registry` (index.ts line 186).

**Full grants table for reference:**

| Table | Grants | Migration |
|-------|--------|-----------|
| `tool_registry` | SELECT, INSERT | 001 |
| `permission_policies` | SELECT, INSERT, UPDATE | 001 |
| `permission_audit_log` | SELECT, INSERT | 001 |
| `agent_sessions` | SELECT, INSERT, UPDATE, DELETE | 002 |
| `workflow_checkpoints` | SELECT, INSERT, UPDATE, DELETE | 002 |
| `budget_ledger` | SELECT, INSERT, UPDATE, DELETE | 002 |
| `system_events` | SELECT, INSERT, UPDATE, DELETE | 003 |
| `verification_runs` | SELECT, INSERT, UPDATE, DELETE | 003 |
| `compaction_archive` | SELECT, INSERT, UPDATE, DELETE | 004 |
| `context_fragments` | SELECT, INSERT, UPDATE, DELETE | 004 |
| `boot_runs` | SELECT, INSERT, UPDATE | 005 |
| `agent_config` | SELECT, INSERT | 005 |
| `agent_types` | SELECT, INSERT, UPDATE, DELETE | 006 |
| `agent_runs` | SELECT, INSERT, UPDATE | 006 |
| `agent_messages` | SELECT, INSERT, UPDATE | 006 |
| `memory_versions` | SELECT, INSERT, UPDATE, DELETE | 007 |
| `plugin_registry` | SELECT, INSERT, UPDATE, DELETE | 008 |
| `skill_registry` | SELECT, INSERT, UPDATE, DELETE | 008 |
| `hook_configurations` | SELECT, INSERT, UPDATE, DELETE | 008 |
| `hook_execution_log` | SELECT, INSERT | 008 |

**Impact:** The `update_tool` action in the `agent-tools` Edge Function will return a 500 error because `service_role` does not have UPDATE permission on `tool_registry`.

**Recommended fix:** Change line 218 of migration 001 to:

```sql
GRANT SELECT, INSERT, UPDATE ON TABLE public.tool_registry TO service_role;
```

---

### ISSUE 6 -- LOW: `supabase_realtime` publication may not exist

Migration 003, line 169:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE system_events;
```

**Impact:** If the Supabase project does not have real-time enabled or the publication does not exist, this will fail. This is not wrapped in any guard.

**Recommended fix:** Wrap in a `DO $$` block with exception handling, or add a comment noting this requires real-time to be enabled in the Supabase dashboard first.

---

### ISSUE 7 -- INFO: `memory_age_factor()` is declared IMMUTABLE but uses `now()` default

Migration 007, lines 98-127: The function is declared `IMMUTABLE` but has a default parameter `reference_time TIMESTAMPTZ DEFAULT now()`. While the function body itself is deterministic for given inputs, the `IMMUTABLE` declaration could lead the query planner to cache results inappropriately.

**Impact:** Unlikely to cause problems in practice. But it is technically incorrect per PostgreSQL semantics.

**Recommended fix:** Change `IMMUTABLE` to `STABLE`.

---

## 4. Edge Function to SQL Alignment

### agent-tools (index.ts) vs Migration 001

| Operation | Table/Column Used | Status |
|-----------|------------------|--------|
| `listTools` | `tool_registry.*` | OK |
| `listTools` filters | `source_type`, `enabled`, `required_permission` | OK |
| `registerTool` | `tool_registry` upsert on `name` | OK |
| `registerTool` columns | `name, description, source_type, required_permission, input_schema, side_effect_profile, enabled, aliases, mcp_server_url, metadata` | OK |
| `updateTool` | `tool_registry.update()` | **FAIL -- missing UPDATE grant** (Issue #5) |
| `getPolicies` | `permission_policies.*` | OK |
| `setPolicy` | `permission_policies` upsert on `name` | OK |
| `setPolicy` columns | `name, description, active_mode, tool_overrides, handler_type, deny_tools, deny_prefixes, allow_tools, metadata` | OK |
| `logAudit` | `permission_audit_log` insert | OK |
| `logAudit` columns | `session_id, tool_name, decision, reason, decided_by, active_mode, required_mode, policy_id, input_summary` | OK |
| `getAuditSummary` | `permission_audit_log` select | OK |
| `assemblePool` | `tool_registry` + `permission_policies` | OK |

### agent-state (index.ts) vs Migration 002

| Operation | Table/Column Used | Status |
|-----------|------------------|--------|
| `createSession` | `agent_sessions` insert | OK |
| `getSession` | `agent_sessions` select by `session_id` | OK |
| `updateSession` | `agent_sessions` update (12 allowed fields) | OK -- all columns exist |
| `listSessions` | `agent_sessions` select with range | OK |
| `createCheckpoint` | `workflow_checkpoints` insert | OK |
| `getCheckpoints` | `workflow_checkpoints` select | OK |
| `recoverStuck` | `workflow_checkpoints` select + update | OK |
| `recordUsage` | `budget_ledger` insert + `agent_sessions` update | OK |
| `getBudget` | `budget_ledger` select | OK |
| `checkBudget` | `budget_ledger` select | OK |

**Full alignment. No issues.**

### agent-memory (index.ts) vs Migrations 007 + core thoughts

| Operation | Table/Column Used | Status |
|-----------|------------------|--------|
| `memory_store` | `thoughts` insert (`content, metadata, embedding`) | OK |
| `memory_store` | Selects `id, content_fingerprint, created_at` | **NOTE**: verify `content_fingerprint` exists on core `thoughts` table |
| `memory_recall` | RPC `match_thoughts_scored` (defined in 007) | OK -- params match |
| `memory_forget` | `thoughts` select + update (metadata only) | OK -- no structural change |
| `memory_update` | `thoughts` + `memory_versions` insert | OK |
| `memory_consolidate` | `thoughts` select + insert + update (metadata only) | OK -- no structural change |
| `get_memory_stats` | `thoughts` select with metadata filters | OK |
| `get_memory_stats` | Calls `exec_sql` RPC (not in any migration) | OK -- graceful fallback exists |

**Guard rail check: `agent-memory` does NOT modify the `thoughts` table structure.** It only performs INSERT (new rows), UPDATE (metadata column only), and SELECT. Compliant.

**Notes:**
- `content_fingerprint`: The function references this column in a `.select()` call (line 166). Verify it exists on the core `thoughts` table. If not, `memory_store` will error.
- `exec_sql` RPC: Not defined in any migration. The code has a complete fallback path that uses individual Supabase queries instead.

---

## 5. Post-Deployment Verification

Run these queries after all migrations complete to verify the deployment.

### 5.1 Verify all tables exist

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'thoughts',
    'tool_registry', 'permission_policies', 'permission_audit_log',
    'agent_sessions', 'workflow_checkpoints', 'budget_ledger',
    'system_events', 'verification_runs',
    'compaction_archive', 'context_fragments',
    'boot_runs', 'agent_config',
    'agent_types', 'agent_runs', 'agent_messages',
    'memory_versions',
    'plugin_registry', 'skill_registry', 'hook_configurations', 'hook_execution_log'
  )
ORDER BY table_name;
-- Expected: 21 rows
```

### 5.2 Verify seed data

```sql
-- 9 built-in tools from migration 001
SELECT name, source_type, required_permission
FROM tool_registry
WHERE source_type = 'built_in'
ORDER BY name;
-- Expected: agent, bash, edit_file, glob_search, grep_search,
--           read_file, tool_search, web_fetch, write_file

-- 6 built-in agent types from migration 006
SELECT name, display_name, permission_mode
FROM agent_types
WHERE source = 'built_in'
ORDER BY name;
-- Expected: explore, general_purpose, guide, plan, statusline, verification
```

### 5.3 Verify RLS is enabled on all tables

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'tool_registry', 'permission_policies', 'permission_audit_log',
    'agent_sessions', 'workflow_checkpoints', 'budget_ledger',
    'system_events', 'verification_runs',
    'compaction_archive', 'context_fragments',
    'boot_runs', 'agent_config',
    'agent_types', 'agent_runs', 'agent_messages',
    'memory_versions',
    'plugin_registry', 'skill_registry', 'hook_configurations', 'hook_execution_log'
  )
ORDER BY tablename;
-- Expected: all rows show rowsecurity = true
```

### 5.4 Verify functions exist

```sql
SELECT proname, pronargs
FROM pg_proc
WHERE proname IN (
  'update_updated_at',
  'update_updated_at_column',
  'persist_permission_audit',
  'cleanup_old_system_events',
  'persist_config_snapshot',
  'memory_age_factor',
  'match_thoughts_scored'
)
ORDER BY proname;
-- Expected: 7 rows
```

### 5.5 Verify views exist

```sql
SELECT table_name
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name IN ('session_event_summary', 'boot_performance_summary');
-- Expected: 2 rows
```

### 5.6 Verify extended CHECK constraint on budget_ledger

```sql
INSERT INTO budget_ledger (session_id, turn_number, stop_reason)
VALUES ('__deploy_test__', 0, 'timeout');
DELETE FROM budget_ledger WHERE session_id = '__deploy_test__';
```

### 5.7 Verify extended CHECK constraint on system_events

```sql
INSERT INTO system_events (event_id, session_id, category, severity, title, sequence)
VALUES (gen_random_uuid(), '__deploy_test__', 'coordinator', 'info', 'test', 0);
DELETE FROM system_events WHERE session_id = '__deploy_test__';
```

### 5.8 Verify match_thoughts_scored function works

```sql
SELECT * FROM match_thoughts_scored(
  query_embedding := (SELECT embedding FROM thoughts LIMIT 1),
  match_threshold := 0.0,
  match_count := 1
);
```

### 5.9 Edge Function smoke tests

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-tools" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "list_tools"}'

curl -X POST "$SUPABASE_URL/functions/v1/agent-state" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "list_sessions"}'

curl -X POST "$SUPABASE_URL/functions/v1/agent-memory" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_memory_stats"}'
```

---

## 6. Recommended Fixes (Summary)

| # | Severity | Issue | File(s) | Fix |
|---|----------|-------|---------|-----|
| 1 | CRITICAL | Trigger function name split (`update_updated_at` vs `update_updated_at_column`) -- 005/006 fail if core function missing | 005, 006 | Add prerequisite check blocks or add `CREATE OR REPLACE FUNCTION update_updated_at()` |
| 2 | MEDIUM | Triggers in 005/006 not idempotent -- re-run fails | 005, 006 | Add `DROP TRIGGER IF EXISTS` before each `CREATE TRIGGER` |
| 3 | MEDIUM | RLS policies in 003/004/005/006 not idempotent -- re-run fails | 003, 004, 005, 006 | Wrap `CREATE POLICY` in `DO $$ IF NOT EXISTS` blocks |
| 4 | LOW | RLS policy naming inconsistency | 003, 004, 005, 006 | Cosmetic -- standardize in future |
| 5 | LOW | Missing UPDATE grant on `tool_registry` -- `update_tool` Edge Function fails | 001 | Add UPDATE to GRANT statement |
| 6 | LOW | `supabase_realtime` publication assumed to exist | 003 | Add guard or document prerequisite |
| 7 | INFO | `memory_age_factor()` declared IMMUTABLE with `now()` default | 007 | Change to STABLE |

### First-run vs re-run risk

If all migrations are run once in order on a clean database (after core OB1 setup), **only Issues 1 and 5 are relevant**. Issues 2, 3, and 4 only matter if migrations need to be re-run (e.g., during development iteration or disaster recovery).

---

## 7. Deployment Steps

```
1. Verify core OB1 setup is complete (thoughts table, update_updated_at function)
2. Apply recommended fixes for Issues 1 and 5 (critical/blocking)
3. Optionally apply fixes for Issues 2, 3 (idempotency, recommended)
4. Run migrations in order: 001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 -> 008
5. Run post-deployment verification queries (Section 5)
6. Deploy Edge Functions: agent-tools, agent-state, agent-memory
7. Run Edge Function smoke tests (Section 5.9)
8. Monitor Supabase logs for any runtime errors
```
