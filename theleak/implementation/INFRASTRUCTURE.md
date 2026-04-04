# Infrastructure Map — Agentic Architecture Deployment

## Architecture Overview

```
MacBook Air (lokal)                    Supabase (remote)
┌─────────────────────┐               ┌──────────────────────────┐
│  Runtime (Node.js)  │───REST/MCP───▶│  PostgreSQL + pgvector   │
│  - Agentic Loop     │               │  20 tabeller             │
│  - SessionManager   │               │  3 SQL functions         │
│  - BudgetTracker    │               │  4 expression indexes    │
│  - ToolPool         │               ├──────────────────────────┤
│  - HookRunner       │               │  7 Edge Functions        │
│  - ContextAssembler │               │  52 API actions          │
│  - BootSequence     │               │  Real-time subscriptions │
│  - Doctor           │               └──────────────────────────┘
└─────────────────────┘
         │
         ▼
┌─────────────────────┐               ┌──────────────────────────┐
│  Monitoring         │               │  Secrets                 │
│  - Sentry (errors)  │               │  - Doppler (env vars)    │
│  - New Relic (APM)  │               │  - 1Password (keys)      │
│  - Datadog (infra)  │               └──────────────────────────┘
└─────────────────────┘
```

## Service Mapping — GitHub Student Pack

### Must-Have (set up first)

| Service | Free Offer | Our Use | Priority |
|---------|-----------|---------|----------|
| **Supabase** | Already set up (OB1) | Database + Edge Functions + Auth | DONE |
| **Doppler** | Free Team subscription | Centralized secrets: SUPABASE_URL, SERVICE_ROLE_KEY, OPENAI_API_KEY, OB1_ACCESS_KEY. Syncs across local dev and Edge Functions | DAG 1 |
| **Sentry** | 50K errors/yr | Error tracking in runtime + Edge Functions. Catch crash-recovery gaps, hook failures, budget overruns | DAG 1 |
| **GitHub Pro** | Free | Branch protection, Actions CI, required status checks | DAG 1 |
| **GitHub Copilot** | Free Pro | AI-assisted coding during runtime implementation | DONE |

### Should-Have (set up week 1)

| Service | Free Offer | Our Use | Priority |
|---------|-----------|---------|----------|
| **New Relic** | $300/mo value | APM for agent runtime: turn latency, API call durations, budget consumption rate, compaction timing | VECKA 1 |
| **Codecov** | Free | Coverage for verification harness tests. Enforce 80%+ on runtime code | VECKA 1 |
| **ConfigCat** | 1000 flags free | Feature flags: `enable_multi_agent`, `enable_usd_budget`, `enable_provenance_scanning`, `max_concurrent_agents` | VECKA 1 |
| **1Password** | Free 1yr | Team secrets backup. Store Supabase creds, API keys, deploy tokens | VECKA 1 |
| **MongoDB** | $50 Atlas credits | Session event archival. system_events table grows fast — archive cold events to MongoDB for long-term analysis | VECKA 1 |

### Nice-to-Have (month 1)

| Service | Free Offer | Our Use | Priority |
|---------|-----------|---------|----------|
| **Datadog** | Free 2yr, 10 servers | MacBook Air metrics: CPU/RAM during agent runs, disk I/O during session persistence | MÅNAD 1 |
| **DigitalOcean** | $200 credit | Offload heavy agent workloads from MacBook. Run coordinator-mode on a $6/mo droplet | MÅNAD 1 |
| **Heroku** | $312 total credit | Preview deployments for agent-generated workspaces | MÅNAD 1 |
| **SimpleAnalytics** | Free 100K pageviews | Usage analytics if we build a dashboard frontend | MÅNAD 1 |
| **Honeybadger** | Free 1yr | Uptime monitoring + cron check-ins for scheduled agent tasks | MÅNAD 1 |

## MacBook Air Hosting — Local Runtime Setup

The MacBook Air runs the **runtime layer** (the agentic loop, managers, hooks).
The **database and API layer** stays on Supabase (remote, as per OB1 CLAUDE.md).

### Requirements
- Node.js 20+ (for TypeScript runtime)
- ~500MB RAM for runtime process
- Network access to Supabase

### Why Local + Remote Hybrid
1. **Runtime locally** = zero hosting cost, instant iteration, full control
2. **Database remotely** = persistent, scalable, accessible from any AI client
3. **Edge Functions remotely** = MCP-compatible, always-on API layer
4. **Monitoring remotely** = Sentry/New Relic catch issues even when MacBook sleeps

### Upgrade Path
When MacBook Air isn't enough:
- Move runtime to DigitalOcean ($6/mo droplet, $200 free credit)
- Or Heroku (free $312 credit)
- Or Azure Functions ($100 credit)
- Runtime code is identical — just change the Doppler environment
