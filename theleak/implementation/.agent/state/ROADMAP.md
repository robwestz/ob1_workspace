# Roadmap — OB1 Agentic Architecture v0.1

## Milestone: First Deployable System + GUI + Night Run

### Phase 1: Deploy Backend
> Deploy SQL + Edge Functions to Supabase, verify everything works

| Plan | Description | Wave |
|------|-------------|------|
| 1A | Run SQL migrations 001-008 | 1 |
| 1B | Deploy 7 Edge Functions | 1 |
| 1C | Run smoke tests + integration tests | 2 |
| 1D | Verify memory system end-to-end | 2 |

### Phase 2: Launch GUI
> Get the Next.js dashboard running and connected

| Plan | Description | Wave |
|------|-------------|------|
| 2A | npm install + build + fix type errors | 1 |
| 2B | Configure env + connect to Supabase | 1 |
| 2C | Verify all 11 pages load with real data | 2 |
| 2D | Fix API integration issues | 2 |
| 2E | Test Supabase Realtime subscriptions | 3 |

### Phase 3: Runtime Integration
> Build runtime, verify CLI works, test night runner

| Plan | Description | Wave |
|------|-------------|------|
| 3A | npm install + build runtime | 1 |
| 3B | ob1-agent boot — verify 10-phase boot | 2 |
| 3C | ob1-agent doctor — verify 6 health categories | 2 |
| 3D | ob1-agent run — test interactive agentic loop | 3 |
| 3E | Test night runner with sample tasks | 3 |

### Phase 4: Premier Project
> Robin's first real overnight build — TBD scope

| Plan | Description | Wave |
|------|-------------|------|
| 4A | Define project scope with Robin | 1 |
| 4B | Create night-tasks.json | 1 |
| 4C | Configure budget + model + concurrency | 1 |
| 4D | Execute first night run | 2 |
| 4E | Review morning report + iterate | 3 |

### Phase 5: Polish & Hardening
> Production readiness

| Plan | Description | Wave |
|------|-------------|------|
| 5A | Set up Sentry error tracking | 1 |
| 5B | Set up Doppler secrets management | 1 |
| 5C | Set up ConfigCat feature flags | 1 |
| 5D | Add New Relic APM | 2 |
| 5E | Codecov coverage enforcement (80%+) | 2 |
| 5F | Documentation + onboarding guide | 3 |
