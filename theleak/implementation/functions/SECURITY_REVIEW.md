# Security Review: OB1 Edge Functions + Bacowr API

**Reviewed**: 2026-04-05
**Scope**: 7 OB1 functions (agent-tools, agent-state, agent-stream, agent-doctor, agent-memory, agent-skills, agent-coordinator) + bacowr-api
**Reviewer**: Automated audit via Claude

---

## Critical Issues (Fixed)

### 1. SQL Injection in agent-memory `get_memory_stats`

**File**: `agent-memory/index.ts` (lines 596-630 original)
**Severity**: CRITICAL
**Status**: FIXED

User-supplied `owner_id`, `team_id`, and `project_id` were interpolated directly into raw SQL strings passed to `supabase.rpc("exec_sql", { query: ... })`:

```typescript
// BEFORE (vulnerable):
conditions.push(`metadata->>'owner_id' = '${params.owner_id}'`);
// A crafted owner_id like: ' OR 1=1; DROP TABLE thoughts; --
// would inject arbitrary SQL.
```

**Fix**: Removed the entire `exec_sql` RPC path. The function now uses only the Supabase query builder fallback (which was already present), which parameterizes all values automatically. The `exec_sql` RPC itself is a dangerous pattern -- if it exists as a database function, consider removing it entirely.

### 2. Filter Injection in agent-skills `list_skills`

**File**: `agent-skills/index.ts` (line 80 original)
**Severity**: HIGH
**Status**: FIXED

The `search` parameter was interpolated directly into a PostgREST `.or()` filter string:

```typescript
// BEFORE (vulnerable):
query = query.or(`name.ilike.%${params.search}%,description.ilike.%${params.search}%`);
// A crafted search like: %,id.gt.0,name.ilike.%
// could manipulate the filter and leak unintended data.
```

**Fix**: Input is now sanitized (PostgREST metacharacters stripped, length capped to 200).

### 3. Bacowr: API Key Stored in Plaintext

**File**: `bacowr-api/index.ts`
**Severity**: CRITICAL
**Status**: FIXED

API keys were stored and looked up as plaintext in the `customers.api_key` column. A database leak would expose all customer API keys.

**Fix**: Added `hashApiKey()` using SHA-256. Lookup now queries `api_key_hash` instead of `api_key`. The raw key is only returned once at generation time. **Migration required**: Existing plaintext keys need to be hashed and moved to the `api_key_hash` column. The old `api_key` column should be dropped after migration.

### 4. Bacowr: Non-Atomic Credit Deduction (Race Condition)

**File**: `bacowr-api/index.ts` (submitBatch)
**Severity**: HIGH
**Status**: FIXED

Credit deduction used a read-then-write pattern without any locking:

```
1. Read customer.article_balance  (e.g., 5)
2. Check if balance >= jobs       (5 >= 3, OK)
3. Update balance to balance - 3  (set to 2)
```

Two concurrent requests could both read balance=5, both pass the check, and both deduct, resulting in a negative balance (overspending).

**Fix**: Added optimistic locking via a conditional WHERE clause on the update:
```typescript
.eq("article_balance", customer.article_balance) // optimistic lock
```
If the balance changed between read and write (concurrent request), the update matches zero rows and the batch is rolled back with a 409 response.

---

## Moderate Issues (Fixed)

### 5. Error Message Leaking (All 7 OB1 Functions)

**Files**: All function entry points
**Severity**: MODERATE
**Status**: FIXED

The top-level catch blocks in agent-tools, agent-state, agent-stream, and agent-doctor leaked `err.message` directly to the client response. This can expose internal details like table names, column names, constraint names, and partial stack traces.

```typescript
// BEFORE:
return json({ error: message }, 500);  // message = err.message
// AFTER:
return json({ error: "Internal server error" }, 500);
```

The error is still logged server-side via `console.error()`.

**Note**: The individual action handlers still return `dbError.message` from Supabase in some cases (e.g., `return error(dbError.message, 500)`). These are lower risk since they are Supabase client errors (typically "relation does not exist" or constraint violations), but could be further sanitized in a follow-up pass.

### 6. Missing Input Size Limits

**Files**: agent-memory, agent-coordinator, agent-skills
**Severity**: MODERATE
**Status**: FIXED

| Location | Issue | Fix |
|----------|-------|-----|
| `agent-memory` memory_store | `content` had no length limit | Capped at 100,000 chars |
| `agent-memory` memory_update | `new_content` had no length limit | Capped at 100,000 chars |
| `agent-memory` memory_consolidate | `consolidated_content` had no length limit | Capped at 100,000 chars |
| `agent-memory` memory_consolidate | `thought_ids` array had no size limit | Capped at 50 |
| `agent-memory` memory_recall | `max_results` had no cap | Capped at 100 |
| `agent-coordinator` mark_delivered | `message_ids` array had no size limit | Capped at 500 |
| `agent-coordinator` list_agent_runs | `limit` had no cap | Capped at 200 |
| `agent-coordinator` get_messages | `limit` had no cap | Capped at 500 |
| `agent-skills` get_hook_log | `limit` had no cap | Capped at 500 |
| `bacowr-api` submit_batch | CSV payload had no size limit | Capped at 500KB |

---

## Low / Informational Issues (Not Fixed -- Noted)

### 7. dbError.message Leaking from Supabase Client Calls

**All files** -- Many action handlers return `dbError.message` from failed Supabase queries directly to the client (e.g., `return error(dbError.message, 500)`). These messages are typically benign ("PGRST116 not found") but could occasionally leak table/column names. Lower priority since auth is required.

### 8. No Rate Limiting

**All files** -- None of the functions implement rate limiting. The access key requirement mitigates this for the OB1 functions (single trusted caller), but Bacowr supports customer-facing API keys where rate limiting would be valuable. The monthly cap on Bacowr provides some protection, but per-second/minute burst limits are absent.

### 9. Bacowr: Customer Isolation is Correct

All Bacowr queries include `.eq("customer_id", customer_id)` derived from the authenticated session. One customer cannot access another's batches, jobs, or articles. **No issue found.**

### 10. Auth Check is Present in All Functions

All 7 OB1 functions check `x-access-key` against `OB1_ACCESS_KEY`. Bacowr uses a separate auth system (API key or JWT). No function can be called without auth. **No issue found.**

### 11. No Raw SQL in Other Functions

Apart from the `get_memory_stats` issue (fixed), all other functions use the Supabase query builder exclusively (`.eq()`, `.in()`, `.update()`, etc.), which parameterizes values automatically. **No additional SQL injection risk.**

### 12. Bacowr: getProfile Returns Full Customer Record

The `getProfile` handler selects `*` from customers before filtering fields for the response. If new sensitive columns are added to the customers table in the future, they could be inadvertently exposed. Consider selecting only the needed columns in the query rather than filtering after the fact.

---

## Summary

| Category | Critical | High | Moderate | Low/Info |
|----------|----------|------|----------|----------|
| SQL Injection | 1 fixed | 1 fixed | -- | -- |
| Auth Bypass | -- | -- | -- | 0 (all OK) |
| Input Validation | -- | -- | 10 fixed | -- |
| Error Leaking | -- | -- | 4 fixed | 1 noted |
| Race Condition | -- | 1 fixed | -- | -- |
| Plaintext Secrets | 1 fixed | -- | -- | -- |
| Rate Limiting | -- | -- | -- | 1 noted |
| Data Isolation | -- | -- | -- | 0 (all OK) |

**Total issues found**: 19 (16 fixed, 3 noted for follow-up)

---

## Migration Notes for Bacowr API Key Hashing

The fix changes the column from `api_key` to `api_key_hash`. To deploy:

1. Add column: `ALTER TABLE bacowr.customers ADD COLUMN api_key_hash TEXT;`
2. Backfill hashes: For each existing customer with a non-null `api_key`, compute `SHA-256(api_key)` and store in `api_key_hash`.
3. Deploy the updated Edge Function.
4. Drop old column: `ALTER TABLE bacowr.customers DROP COLUMN api_key;`
5. Add index: `CREATE INDEX idx_customers_api_key_hash ON bacowr.customers(api_key_hash);`

**Warning**: Existing API keys in use will need to be re-issued (or the backfill must hash the existing plaintext values before the old column is dropped).
