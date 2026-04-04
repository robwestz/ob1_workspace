# OB1 Agentic Architecture -- Full Deploy Guide

Last updated: 2026-04-04

This guide walks through deploying the complete OB1 agentic architecture to Supabase, including the database migrations, Edge Functions, local runtime, and optional dashboard and Bacowr setup.

---

## 1. Prerequisites

### Accounts

- **Supabase account** with an existing project (the core OB1 `thoughts` table must already exist)
- **Anthropic API key** from [console.anthropic.com](https://console.anthropic.com) (for LLM calls)
- **OpenAI API key** from [platform.openai.com](https://platform.openai.com) (for embedding generation)

### Software

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| Supabase CLI | latest | `npm install -g supabase` |
| psql (PostgreSQL client) | any | See below |
| curl | any | Usually pre-installed |
| Git | any | [git-scm.com](https://git-scm.com) |

#### Installing psql

psql is needed to run SQL migrations. Install it without the full PostgreSQL server:

```bash
# macOS
brew install libpq && brew link --force libpq

# Ubuntu / Debian
sudo apt-get install postgresql-client

# Windows (via Scoop)
scoop install postgresql

# Windows (via Chocolatey)
choco install postgresql --params '/Password:postgres'
# psql will be at C:\Program Files\PostgreSQL\16\bin\psql.exe
```

#### Installing Supabase CLI

```bash
# npm (any platform)
npm install -g supabase

# macOS
brew install supabase/tap/supabase

# Windows (via Scoop)
scoop install supabase
```

Verify installation:

```bash
supabase --version
psql --version
node --version
```

---

## 2. Supabase Project Setup

If you already have an OB1 Supabase project with the `thoughts` table, skip to Step 3.

### 2.1 Create a new Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Click **New project**
3. Choose organization, name, password, region
4. Wait for project to provision (1-2 minutes)

### 2.2 Get your credentials

From the Supabase dashboard, collect these values:

| Credential | Where to find it |
|------------|-----------------|
| **Project URL** | Settings > API > Project URL |
| **Service Role Key** | Settings > API > service_role (secret) |
| **Database URL** | Settings > Database > Connection string > URI |
| **Project Ref** | In the dashboard URL: `supabase.com/dashboard/project/<ref>` |

The database URL looks like:
```
postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
```

### 2.3 Enable required extensions

In the SQL Editor (Supabase dashboard), run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 2.4 Verify core OB1 setup

The agentic architecture builds on top of the core OB1 `thoughts` table. Verify it exists:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'thoughts'
ORDER BY ordinal_position;
```

Expected columns: `id` (UUID), `content` (TEXT), `metadata` (JSONB), `embedding` (vector), `created_at` (TIMESTAMPTZ), `content_fingerprint` (TEXT).

If the `thoughts` table does not exist, follow `docs/01-getting-started.md` first.

### 2.5 Link Supabase CLI to your project

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

---

## 3. Environment Variables

### 3.1 Runtime .env

Create the file `theleak/implementation/runtime/.env`:

```bash
cd theleak/implementation/runtime
cp .env.example .env
```

Fill in the values:

```env
# Supabase Connection
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>

# OB1 Access Key (for x-access-key header auth on Edge Functions)
OB1_ACCESS_KEY=<your-access-key>

# Anthropic API Key (for LLM calls)
ANTHROPIC_API_KEY=<your-anthropic-api-key>

# OpenAI API Key (for embeddings)
OPENAI_API_KEY=<your-openai-api-key>

# Optional defaults
OB1_MODEL=sonnet
OB1_MAX_TURNS=50
OB1_MAX_BUDGET_TOKENS=1000000
OB1_MAX_BUDGET_USD=10.00
```

### 3.2 Dashboard .env.local

Create the file `theleak/implementation/gui/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
OB1_ACCESS_KEY=<your-access-key>
```

### 3.3 Choose your OB1_ACCESS_KEY

You have two options:

- **Simple:** Use your `SUPABASE_SERVICE_ROLE_KEY` as the `OB1_ACCESS_KEY`
- **Better:** Generate a dedicated secret (`openssl rand -hex 32`) and set it both as a Supabase Edge Function secret and in your .env files

---

## 4. Database Setup

### 4.1 Run migrations in order

There are 9 migration files (000 through 008) that must run sequentially.

Set your database URL:

```bash
export DB_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres"
```

Run all migrations in order:

```bash
cd theleak/implementation/sql/migrations

psql "$DB_URL" -v ON_ERROR_STOP=1 -f 000_prerequisites.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f 001_tool_registry_and_permissions.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f 002_state_and_budget.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f 003_streaming_logging_verification.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f 004_compaction_stops_provenance.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f 005_doctor_and_boot.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f 006_agent_type_system.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f 007_memory_system.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f 008_skills_and_extensibility.sql
```

Alternatively, use the automated deploy script:

```bash
cd theleak/implementation
chmod +x deploy.sh
./deploy.sh --db-url "$DB_URL"
```

### 4.2 Verify tables exist

After migrations, run this query in Supabase SQL Editor or via psql:

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

### 4.3 Verify seed data

```sql
-- 9 built-in tools
SELECT name, source_type, required_permission
FROM tool_registry WHERE source_type = 'built_in' ORDER BY name;

-- 6 built-in agent types
SELECT name, display_name, permission_mode
FROM agent_types WHERE source = 'built_in' ORDER BY name;
```

### 4.4 Verify RLS is enabled

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
-- All rows should show rowsecurity = true
```

### 4.5 Verify functions

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

---

## 5. Edge Function Deployment

There are 7 Edge Functions to deploy.

### 5.1 Deploy all functions

From the implementation directory:

```bash
cd theleak/implementation

supabase functions deploy agent-tools --no-verify-jwt
supabase functions deploy agent-state --no-verify-jwt
supabase functions deploy agent-stream --no-verify-jwt
supabase functions deploy agent-doctor --no-verify-jwt
supabase functions deploy agent-memory --no-verify-jwt
supabase functions deploy agent-skills --no-verify-jwt
supabase functions deploy agent-coordinator --no-verify-jwt
```

The `--no-verify-jwt` flag is required because these functions use `x-access-key` header authentication instead of Supabase JWT tokens.

### 5.2 Verify deployment

```bash
supabase functions list
```

You should see all 7 functions listed with status "Active".

---

## 6. Secrets Configuration

Edge Functions need access to secrets. Set them via the Supabase CLI:

```bash
supabase secrets set OB1_ACCESS_KEY=<your-access-key>
supabase secrets set OPENAI_API_KEY=<your-openai-api-key>
```

Verify secrets are set:

```bash
supabase secrets list
```

You should see `OB1_ACCESS_KEY` and `OPENAI_API_KEY` in the list. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available to Edge Functions.

---

## 7. Smoke Test

Set these variables for the smoke test commands:

```bash
export SUPABASE_URL="https://<your-project-ref>.supabase.co"
export OB1_ACCESS_KEY="<your-access-key>"
```

### 7.1 Test agent-doctor

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/agent-doctor" \
  -H "Content-Type: application/json" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -d '{"action":"run_doctor"}' | jq .
```

Expected: HTTP 200 with a JSON body containing `overall_status`.

### 7.2 Test agent-tools

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/agent-tools" \
  -H "Content-Type: application/json" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -d '{"action":"list_tools"}' | jq .
```

Expected: HTTP 200 with a JSON array of 9 built-in tools.

### 7.3 Test agent-state

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/agent-state" \
  -H "Content-Type: application/json" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -d '{"action":"list_sessions"}' | jq .
```

Expected: HTTP 200 with `{"sessions": [], "count": 0}` or similar.

### 7.4 Test agent-memory

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/agent-memory" \
  -H "Content-Type: application/json" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -d '{"action":"get_memory_stats"}' | jq .
```

Expected: HTTP 200 with memory statistics JSON.

### 7.5 Test agent-skills

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/agent-skills" \
  -H "Content-Type: application/json" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -d '{"action":"list_skills"}' | jq .
```

Expected: HTTP 200 with skills listing.

### 7.6 Full smoke test script

There is also an automated smoke test:

```bash
cd theleak/implementation
chmod +x smoke-test.sh
./smoke-test.sh "$SUPABASE_URL" "$OB1_ACCESS_KEY"
```

---

## 8. Dashboard Setup

The dashboard is a Next.js app that provides a visual interface to the agentic architecture.

### 8.1 Install dependencies

```bash
cd theleak/implementation/gui
npm install
```

### 8.2 Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
OB1_ACCESS_KEY=<your-access-key>
```

### 8.3 Run locally

```bash
npm run dev
```

The dashboard will be available at `http://localhost:3000`.

### 8.4 Build for production

```bash
npm run build
npm run start
```

### 8.5 Deploy to Vercel (optional)

```bash
npx vercel --prod
```

Set the environment variables in the Vercel dashboard:
- `NEXT_PUBLIC_SUPABASE_URL`
- `OB1_ACCESS_KEY`

---

## 9. Local Runtime Setup

The runtime is the Node.js process that runs the agentic loop, session management, budget tracking, and overnight tasks locally.

### 9.1 Install dependencies

```bash
cd theleak/implementation/runtime
npm install
```

### 9.2 Build

```bash
npm run build
```

### 9.3 Run tests

```bash
npm test
```

### 9.4 Start the Night Runner

For overnight autonomous execution:

```bash
# From OB1 thoughts (default)
node dist/night-runner.js --max-usd 20 --max-hours 8 --source thoughts

# From a task file
node dist/night-runner.js --max-usd 10 --tasks night-tasks.json

# Quick test run
node dist/night-runner.js --max-usd 5 --max-hours 1 --max-agents 1
```

Required environment variables for the Night Runner:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`

---

## 10. Bacowr Setup (Optional)

Bacowr runs in an isolated `bacowr` schema within the same Supabase project.

### 10.1 Run the Bacowr migration

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -f projects/Bacowr-v6.3/supabase/migrations/001_bacowr_saas.sql
```

### 10.2 Verify the schema

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'bacowr'
ORDER BY table_name;
-- Expected: customers, purchases, job_batches, jobs, articles, usage_log
```

### 10.3 Enable the Night Runner Bacowr task

In `theleak/implementation/night-tasks.json`, set `"enabled": true` on the `bacowr-queue` task after verifying Bacowr tables exist.

---

## 11. Troubleshooting

### Migration fails: "thoughts table must exist"

The core OB1 setup has not been completed. Follow `docs/01-getting-started.md` to create the `thoughts` table before running agentic migrations.

### Migration fails: "function update_updated_at() does not exist"

Migration 000 should create this function. Re-run:

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -f 000_prerequisites.sql
```

### Edge Function deploy fails

Check that you are in the correct directory and the project is linked:

```bash
supabase functions list
```

If not linked:

```bash
supabase link --project-ref <your-project-ref>
```

### Smoke test returns 401 Unauthorized

The `x-access-key` header value does not match the `OB1_ACCESS_KEY` secret set on the Edge Functions. Verify:

```bash
supabase secrets list
```

Re-set if needed:

```bash
supabase secrets set OB1_ACCESS_KEY=<your-access-key>
```

### Smoke test returns 500 Internal Server Error

Check Edge Function logs:

```bash
supabase functions logs agent-doctor --tail
```

Common causes:
- Missing `OPENAI_API_KEY` secret (needed by `agent-memory`)
- Database tables not created (migrations not run)
- RLS blocking access (verify service_role policies)

### Real-time subscription fails (migration 003)

If you see an error about `supabase_realtime` publication, enable Real-time in the Supabase dashboard:

1. Go to Database > Replication
2. Enable the `supabase_realtime` publication
3. Re-run migration 003

### Dashboard shows "Failed to fetch"

- Verify `NEXT_PUBLIC_SUPABASE_URL` is correct in `.env.local`
- Verify Edge Functions are deployed and responding (run smoke tests)
- Check browser console for CORS errors

### Night Runner exits immediately

- Verify all three env vars are set: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`
- Check that the boot sequence and doctor checks pass
- Run with `OB1_DEBUG=1` for verbose output

### psql: SSL connection errors on Windows

Add `?sslmode=require` to the connection string:

```bash
export DB_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres?sslmode=require"
```

### Re-running migrations fails with "already exists"

Migrations 000-004, 007, and 008 are idempotent. Migrations 005 and 006 have trigger and policy creation statements that are not fully idempotent. If you need to re-run them, either:

1. Drop the affected triggers/policies first, or
2. Ignore the "already exists" errors (the tables and data are fine)

See `theleak/implementation/sql/MIGRATION_AUDIT.md` for the full analysis.

---

## Quick Reference: File Locations

| Component | Path |
|-----------|------|
| Deploy script | `theleak/implementation/deploy.sh` |
| Smoke test script | `theleak/implementation/smoke-test.sh` |
| SQL migrations | `theleak/implementation/sql/migrations/` |
| Edge Functions | `theleak/implementation/functions/` |
| Runtime source | `theleak/implementation/runtime/src/` |
| Runtime .env | `theleak/implementation/runtime/.env` |
| Dashboard | `theleak/implementation/gui/` |
| Dashboard .env | `theleak/implementation/gui/.env.local` |
| Night tasks config | `theleak/implementation/night-tasks.json` |
| Migration audit | `theleak/implementation/sql/MIGRATION_AUDIT.md` |
| Deploy checklist | `theleak/implementation/DEPLOY_CHECKLIST.md` |
| Infrastructure map | `theleak/implementation/INFRASTRUCTURE.md` |
