# Project State

## Identity
- **Project**: OB1 Agentic Architecture
- **Type**: Full-stack agentic platform (backend + runtime + GUI)
- **Stack**: TypeScript, Next.js 14, Supabase (PostgreSQL + pgvector), Deno Edge Functions
- **Started**: 2026-04-03

## Current Position
- **Phase**: Pre-deployment (all code written, nothing deployed yet)
- **Milestone**: v0.1 — First deployable system
- **Blocking**: Deploy to Supabase + first night run

## What Exists (BUILT)

### Backend (ready to deploy)
- [x] 8 SQL migrations (001-008) — 20 tables, 2 views, 4 functions, 30+ indexes
- [x] 7 Edge Functions — 52 API actions across tools, state, stream, doctor, memory, skills, coordinator
- [x] Deploy scripts (deploy.sh, migrate.sh, smoke-test.sh)
- [x] Smoke tests (6 validation checks)

### Runtime (ready to build/run)
- [x] types.ts — all shared types/interfaces/enums
- [x] ob1-client.ts — unified HTTP client (52 methods)
- [x] config.ts — 3-tier scoped config with provenance
- [x] session-manager.ts — create/resume/flush/crash recovery
- [x] budget-tracker.ts — pre-turn checks, USD pricing, compaction guard
- [x] tool-pool.ts — 4-filter pipeline, defense-in-depth, sub-agent scoping
- [x] hook-runner.ts — shell hooks, 30s timeout, platform-aware
- [x] transcript-compactor.ts — structured XML summary, archive to Supabase
- [x] context-assembler.ts — 5 injection patterns, trust hierarchy, budget limits
- [x] conversation-runtime.ts — THE CORE agentic loop
- [x] boot.ts — 10-phase startup with parallel phases 5+6
- [x] doctor.ts — 6-category health checks with auto-repair
- [x] coordinator.ts — DAG wave execution, inter-agent messaging
- [x] night-runner.ts — autonomous overnight executor with crash recovery
- [x] anthropic-client.ts — streaming API wrapper
- [x] cli.ts — full CLI (boot, doctor, run, status, memory, etc.)

### GUI Dashboard (ready to npm install + run)
- [x] Next.js 14 scaffold with dark theme, sidebar, API client
- [x] Dashboard home (stats, activity feed, night run status)
- [x] Agent Monitor (live tracking, spawn, detail, cancel/resume)
- [x] Task Manager (drag-reorder, dependency graph, night config)
- [x] Memory Explorer (semantic search, trust dots, version history)
- [x] Morning Report (gradient hero, charts, timeline, print CSS)
- [x] System Health (doctor, boot chart, event log, verification)
- [x] Session History (budget bars, permission log, resume)
- [x] Tool Registry (permissions, policies, audit trail)

### Tests (ready to run)
- [x] test-migrations.ts — 12 test groups for SQL validation
- [x] test-edge-functions.ts — API action tests with auth
- [x] test-budget-tracker.ts — 14 unit tests
- [x] test-tool-pool.ts — 12 unit tests
- [x] test-context-assembler.ts — 12 unit tests
- [x] test-config.ts — 8 unit tests

## What's Next (NOT DONE)

### Phase 1: Deploy & Verify
- [ ] Run SQL migrations against Supabase
- [ ] Deploy Edge Functions
- [ ] Run smoke tests
- [ ] Run integration tests
- [ ] Verify memory system works end-to-end

### Phase 2: GUI Launch
- [ ] npm install in gui/
- [ ] Configure .env.local with Supabase credentials
- [ ] npm run dev — verify all pages load
- [ ] Fix any API integration issues

### Phase 3: First Night Run
- [ ] Create task file for premier project
- [ ] Configure night runner
- [ ] Run first overnight execution
- [ ] Verify morning report generates

### Phase 4: Premier Project
- [ ] Define premier project scope (TBD — Robin hasn't specified yet)
- [ ] Create night-tasks.json
- [ ] Execute and iterate

## Architecture References
- Blueprints: `../blueprints/01-08_*.md`
- Extracted knowledge: `../claw-code-main/extraction/`
- Infrastructure plan: `../INFRASTRUCTURE.md`
- Execution plan: `../EXECUTION_PLAN.md`
