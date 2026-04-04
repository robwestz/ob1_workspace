# Night Build Plan: Agentic Dashboard GUI

**Target:** Wake up to a working platform where agents can operate, build, and be monitored.
**Runtime:** 8 hours overnight (~22:00 - 06:00)
**Budget:** $20 USD total across all tasks
**Concurrency:** 3 agents max

---

## Prerequisites (Manual, Before Sleep)

Before starting the NightRunner:

1. Ensure all 8 SQL migrations are applied (`theleak/implementation/sql/migrations/001-008`)
2. Ensure all 7 Edge Functions are deployed (`agent-tools`, `agent-state`, `agent-stream`, `agent-doctor`, `agent-memory`, `agent-skills`, `agent-coordinator`)
3. Run `smoke-test.sh` to verify backend connectivity
4. Set environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`
5. Place `night-tasks-gui.json` in the runtime src directory
6. Start NightRunner: `node cli.js night --tasks night-tasks-gui.json --max-usd 20 --max-hours 8`

---

## Phase 1: Scaffold & Foundation (Tasks 1-3, ~45 min, ~$2.50)

These tasks run first and have no dependencies. They set up the project skeleton that all subsequent page-building tasks depend on.

### Task 1: Scaffold Next.js App
**Priority:** 1 | **Budget:** $1.00 | **Turns:** 15

Create the new dashboard at `theleak/implementation/dashboard/` based on the existing OB1 Next.js dashboard pattern (`dashboards/open-brain-dashboard-next/`).

What gets built:
- `package.json` — Next.js 16, React 19, Tailwind CSS 4, iron-session 8, `@supabase/supabase-js` (for Realtime subscriptions), `recharts` (for charts)
- `tsconfig.json`, `postcss.config.mjs`, `next.config.ts`, `eslint.config.mjs`
- `.env.example` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `OB1_ACCESS_KEY`, `SESSION_SECRET`
- `app/globals.css` — Copy the existing OB1 dark theme (same color tokens: `--color-bg-primary: #0a0a0f`, `--color-violet: #8b5cf6`, etc.) and add new tokens for agent status colors (`--color-agent-running`, `--color-agent-idle`, `--color-agent-failed`)
- `app/layout.tsx` — Root layout with Geist fonts, sidebar, and main content area (same pattern as existing dashboard)
- `.gitignore`

### Task 2: API Client Library
**Priority:** 1 | **Budget:** $1.00 | **Turns:** 15

Create `lib/ob1-api.ts` — a browser/server-compatible client that wraps all 7 Edge Functions using the same envelope pattern as the runtime's `OB1Client`:

```
POST /functions/v1/{functionName}
Body: { action: string, params: Record<string, any> }
Headers: { Authorization: Bearer KEY, apikey: KEY }
```

Methods to implement (matching the runtime `ob1-client.ts` exactly):
- **Tools:** `listTools()`, `getPolicies()`, `setPolicy()`, `getAuditSummary()`
- **State:** `createSession()`, `getSession()`, `updateSession()`, `checkBudget()`, `recordUsage()`
- **Events:** `logEvent()`, `queryEvents()`, `runVerification()`
- **Doctor:** `runDoctor()`, `recordBoot()`, `getConfig()`
- **Memory:** `memoryStore()`, `memoryRecall()`, `memoryForget()`, `memoryUpdate()`
- **Skills:** `listSkills()`, `listHooks()`, `listPlugins()`
- **Coordinator:** `listAgentTypes()`, `spawnAgent()`, `updateAgentStatus()`, `getAgentRun()`, `listAgentRuns()`, `sendMessage()`, `getMessages()`, `getAgentSummary()`

Also create:
- `lib/types.ts` — TypeScript types mirroring `runtime/src/types.ts` (ToolSpec, SessionState, SystemEvent, AgentRun, AgentType, NightRunReport, etc.)
- `lib/supabase.ts` — Supabase client initialization for Realtime subscriptions
- `lib/auth.ts` — iron-session auth (copy pattern from existing dashboard)
- `lib/format.ts` — Date formatting, USD formatting, duration formatting utilities

### Task 3: Shared UI Components
**Priority:** 1 | **Budget:** $0.50 | **Turns:** 10

Create reusable components in `components/`:
- `Sidebar.tsx` — Navigation sidebar with 8 nav items (Dashboard, Agents, Tasks, Memory, Sessions, Morning Report, Health, Tools). Use the exact same Sidebar pattern from the existing dashboard (fixed left, w-56, OB logo, nav items with SVG icons, active state with violet highlight)
- `StatusBadge.tsx` — Colored badge for statuses (running=blue pulse, completed=green, failed=red, pending=gray, skipped=yellow)
- `BudgetGauge.tsx` — Circular or bar gauge showing USD spent vs limit with color transitions (green -> yellow -> red)
- `Card.tsx` — Reusable card component with `bg-bg-surface border border-border rounded-lg`
- `EmptyState.tsx` — Consistent empty state with icon and message
- `LoadingSpinner.tsx` — Skeleton loaders and spinners
- `Toast.tsx` — Client-side toast notification component (success/error/info)
- `PageHeader.tsx` — Page title + subtitle + optional action buttons
- `DataTable.tsx` — Sortable, filterable table component
- `login/` — Login page (copy from existing dashboard, adapt for OB1 access key auth)

---

## Phase 2: Core Pages (Tasks 4-8, ~3 hours, ~$8.00)

These are the main pages. Each task builds one complete page with its API route handlers. Tasks 4-8 all depend on tasks 1-3 but are independent of each other, so the NightRunner can execute up to 3 in parallel.

### Task 4: Dashboard Home (`/`)
**Priority:** 2 | **Depends on:** task-001, task-002, task-003 | **Budget:** $1.50 | **Turns:** 20

Build the main dashboard at `app/page.tsx`:

**Layout (top to bottom):**
1. **Status Strip** — 4 stat cards in a row:
   - Agents Running (count from `listAgentRuns({ status: 'running' })`)
   - Tasks Completed today (from `queryEvents({ category: 'coordinator', from: todayStart })`)
   - Budget Used (from aggregating `checkBudget()` across sessions)
   - Memory Count (from `memoryRecall('*', { limit: 0 })` or stats)

2. **Budget Gauge** — Large visual showing overnight budget: USD spent / $20 limit. Use the BudgetGauge component with recharts RadialBarChart.

3. **Recent Activity Feed** — Last 20 system events from `queryEvents({ limit: 20 })`, rendered as a timeline. Each event shows: timestamp, category icon, severity color, title, detail snippet.

4. **Quick Actions** — Button row:
   - "Start Night Run" — calls `spawnAgent('coordinator', { task_prompt: 'Execute night run tasks' })`
   - "Run Doctor" — calls `runDoctor()` and shows results in a modal
   - "New Memory" — opens capture form

**API routes:**
- `app/api/dashboard/route.ts` — Aggregates all dashboard data in one server-side call
- `app/api/actions/doctor/route.ts` — Runs doctor and returns results
- `app/api/actions/spawn/route.ts` — Spawns a new agent

### Task 5: Agent Monitor (`/agents`)
**Priority:** 2 | **Depends on:** task-001, task-002, task-003 | **Budget:** $2.00 | **Turns:** 25

Build `app/agents/page.tsx`:

**Layout:**
1. **Header** — "Agent Monitor" + "Spawn Agent" button (opens modal with agent type selector and task prompt textarea)

2. **Agent List** — Cards for each agent run from `listAgentRuns({ limit: 50 })`:
   - Status badge (running with pulse animation, completed, failed)
   - Agent type tag
   - Task prompt (truncated)
   - Duration (live updating if running)
   - Cost (USD)
   - Token count
   - Expand button to show full details

3. **Expanded Detail** — When a card is expanded:
   - Full task prompt and context
   - Messages sent/received (from `getMessages(runId)`)
   - Output summary
   - Error details (if failed)
   - Timeline of status changes

4. **Live Updates** — Use Supabase Realtime subscription on `agent_runs` table:
   ```ts
   supabase.channel('agent-runs')
     .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_runs' }, handler)
     .subscribe()
   ```
   When a run updates, refresh its card without full page reload.

5. **Spawn Modal** — Form with:
   - Agent type dropdown (populated from `listAgentTypes()`)
   - Task prompt textarea
   - Budget limit input (USD)
   - Max turns input
   - "Spawn" button that calls `spawnAgent()`

**API routes:**
- `app/api/agents/route.ts` — GET: list runs; POST: spawn agent
- `app/api/agents/[id]/route.ts` — GET: single run details + messages
- `app/api/agents/types/route.ts` — GET: list agent types

### Task 6: Task Manager (`/tasks`)
**Priority:** 2 | **Depends on:** task-001, task-002, task-003 | **Budget:** $2.00 | **Turns:** 25

Build `app/tasks/page.tsx`:

**Layout:**
1. **Header** — "Task Manager" + "New Task" button + "Start Night Run" button

2. **Task List** — Draggable list (use native HTML drag-and-drop, no extra deps):
   - Each task card shows: priority number, title, description preview, agent type badge, estimated cost, dependency count, status badge
   - Drag handle on the left for reordering (updates priority numbers)
   - Edit button (inline edit or modal)
   - Delete button (with confirmation)

3. **Task Editor** — Modal or inline form:
   - Title (text input)
   - Description (textarea, supports markdown)
   - Priority (number input)
   - Agent type (dropdown from `listAgentTypes()`)
   - Dependencies (multi-select of other task IDs)
   - Max turns (number input)
   - Budget cap in USD (number input)

4. **Dependency Visualization** — Simple ASCII or CSS-grid dependency graph showing which tasks depend on which. Color-code by status.

5. **Night Run Config Panel** — Collapsible section:
   - Total budget (USD input, default $20)
   - Max duration (hours, default 8)
   - Max concurrent agents (number, default 3)
   - Task source (file or thoughts toggle)
   - "Start Night Run" button with confirmation modal

**Data storage:** Tasks are stored as OB1 memories (thoughts) with metadata tags `['task', 'night-run']` and type `task`, matching the NightRunner's `loadTasksFromThoughts()` format. CRUD operations use `memoryStore()`, `memoryRecall()`, `memoryUpdate()`, `memoryForget()`.

**API routes:**
- `app/api/tasks/route.ts` — GET: recall tasks from memory; POST: create new task
- `app/api/tasks/[id]/route.ts` — PUT: update task; DELETE: forget task
- `app/api/tasks/reorder/route.ts` — POST: batch update priorities
- `app/api/night-run/route.ts` — POST: start night run

### Task 7: Memory Explorer (`/memory`)
**Priority:** 2 | **Depends on:** task-001, task-002, task-003 | **Budget:** $1.50 | **Turns:** 20

Build `app/memory/page.tsx`:

**Layout:**
1. **Search Bar** — Prominent search input that calls `memoryRecall(query, filters)`. Supports:
   - Free-text semantic search
   - Filter pills: scope (user/agent/system), type (fact/preference/procedure/etc.), tags
   - Min similarity slider (0.5 - 1.0)

2. **Results Grid** — Memory cards showing:
   - Content preview (first 200 chars)
   - Scope badge (user=blue, agent=purple, system=gray)
   - Type badge
   - Trust score bar (0-1.0)
   - Tags as pills
   - Created date
   - Click to expand full content

3. **Memory Detail** — Expanded view:
   - Full content (rendered as markdown if applicable)
   - All metadata
   - Edit button (opens editor that calls `memoryUpdate()`)
   - Forget button (calls `memoryForget()` with reason input)
   - Version history (if available in metadata)

4. **Create Memory** — Floating action button that opens form:
   - Content textarea
   - Scope selector
   - Type selector
   - Tags input (comma-separated)
   - Importance slider (1-10)
   - "Store" button that calls `memoryStore()`

5. **Stats Sidebar** — Right column or top bar:
   - Total memory count
   - Breakdown by scope (pie chart)
   - Breakdown by type (bar chart)
   - Recent additions timeline

**API routes:**
- `app/api/memory/route.ts` — GET: recall with filters; POST: store new memory
- `app/api/memory/[id]/route.ts` — PUT: update; DELETE: forget
- `app/api/memory/search/route.ts` — POST: semantic search with advanced filters

### Task 8: Session History (`/sessions`)
**Priority:** 2 | **Depends on:** task-001, task-002, task-003 | **Budget:** $1.00 | **Turns:** 15

Build `app/sessions/page.tsx`:

**Layout:**
1. **Session List** — Table of sessions from `getSession()` calls or direct Supabase query:
   - Session ID (truncated)
   - Status badge (active, completed, failed, paused)
   - Started at / ended at
   - Duration
   - Total cost (USD)
   - Token count
   - Agent type
   - Expand button

2. **Session Detail** — Expanded view:
   - Full session metadata
   - Budget breakdown (from `checkBudget()`)
   - Event timeline (from `queryEvents({ session_id })`)
   - Workflow steps (from checkpoints)
   - "Resume" button (creates new session linked to this one)

3. **Filters** — Filter by status, date range, agent type

**API routes:**
- `app/api/sessions/route.ts` — GET: list sessions
- `app/api/sessions/[id]/route.ts` — GET: session detail + events + budget
- `app/api/sessions/[id]/resume/route.ts` — POST: create continuation session

---

## Phase 3: Specialized Pages (Tasks 9-11, ~2 hours, ~$5.50)

These pages depend on Phase 2 being mostly done (they reference data structures established there). They can run in parallel with each other.

### Task 9: Morning Report (`/morning`)
**Priority:** 3 | **Depends on:** task-004 | **Budget:** $2.00 | **Turns:** 20

Build `app/morning/page.tsx` — the page Robin sees first when he wakes up.

**Layout (designed for a sleepy human scanning quickly):**
1. **Hero Section** — Large greeting:
   - "Good morning, Robin" (or time-appropriate greeting)
   - Night run summary in one sentence: "3 of 4 tasks completed, $4.23 spent, 0 errors"
   - Overall status indicator: green checkmark / yellow warning / red alert

2. **Task Results** — Clean table:
   - Task title
   - Status (completed/failed/skipped with color)
   - Duration
   - Cost
   - One-line output summary
   - Expand for full details

3. **Budget Breakdown** — Recharts BarChart:
   - X-axis: task names
   - Y-axis: USD spent
   - Color-coded by status
   - Total line showing $20 budget ceiling

4. **Attention Required** — Red/yellow section (only shown if there are issues):
   - Failed tasks with error summaries
   - Budget warnings
   - Doctor warnings from overnight run
   - Suggested actions

5. **Recommended Next Tasks** — AI-generated suggestions based on:
   - What was completed (context from output summaries)
   - What failed (what to retry or fix)
   - What was skipped (should it be re-queued?)

6. **System Health Snapshot** — Mini version of the health page:
   - Doctor pass/warn/fail counts
   - Memory usage
   - Last boot time

**Data source:** The NightRunner stores its `NightRunReport` as an OB1 thought with tags `['night-run-report']` and type `report`. The morning page retrieves this via `memoryRecall('night run report', { tags: ['night-run-report'], limit: 1 })` and parses the JSON content.

**API routes:**
- `app/api/morning/route.ts` — GET: fetch latest night run report from memory
- `app/api/morning/history/route.ts` — GET: list all past night run reports

### Task 10: System Health (`/health`)
**Priority:** 3 | **Depends on:** task-004 | **Budget:** $1.50 | **Turns:** 20

Build `app/health/page.tsx`:

**Layout:**
1. **Doctor Results** — 6 category cards (credentials, connections, tables, functions, config, memory), each showing:
   - Category name and icon
   - Status: pass (green check), warn (yellow triangle), fail (red X)
   - Check name
   - Detail message
   - "Re-run" button per category

2. **Boot History** — Table of recent boot runs:
   - Boot ID
   - Started at
   - Duration (ms)
   - Status
   - Failed phase (if any)
   - Failure reason

3. **Event Log** — Filterable event viewer:
   - Severity filter (info, warn, error, fatal)
   - Category filter (boot, session, coordinator, tool, hook, budget, memory)
   - Time range picker
   - Auto-refreshing with Realtime subscription on `system_events` table
   - Each event: timestamp, severity icon, category, title, detail (expandable)

4. **Verification History** — Past verification harness runs:
   - Session ID
   - Run date
   - Result (pass/fail)
   - Invariant details

5. **Action Buttons:**
   - "Run Full Doctor" — runs complete check suite
   - "Quick Health Check" — runs just credentials + connections
   - "Export Event Log" — downloads filtered events as JSON

**API routes:**
- `app/api/health/doctor/route.ts` — GET: run doctor; POST: run specific category
- `app/api/health/boots/route.ts` — GET: list boot runs
- `app/api/health/events/route.ts` — GET: query events with filters
- `app/api/health/verification/route.ts` — POST: run verification

### Task 11: Tool Registry (`/tools`)
**Priority:** 3 | **Depends on:** task-004 | **Budget:** $2.00 | **Turns:** 20

Build `app/tools/page.tsx`:

**Layout:**
1. **Tool List** — Filterable table from `listTools()`:
   - Tool name
   - Source type badge (built_in, plugin, skill, mcp)
   - Required permission level
   - Side effect indicators (icons for: writes files, network, destructive, spawns process)
   - Enabled/disabled toggle
   - Click to expand

2. **Tool Detail** — Expanded view:
   - Full description
   - Input schema (rendered as a tree)
   - Side effect profile
   - Aliases
   - MCP server URL (if applicable)
   - Metadata

3. **Permission Policies** — Tab or section:
   - List of policies from `getPolicies()`
   - Each shows: name, active mode, handler type, tool overrides count
   - Edit button opens modal:
     - Active permission mode dropdown
     - Handler type selector
     - Tool overrides (add/remove/edit)
     - Deny tools list
     - Allow tools list
   - "Create Policy" button

4. **Audit Trail** — Tab showing recent permission decisions:
   - Session ID filter
   - Decision (allow/deny/escalate) with color
   - Tool name
   - Reason
   - Decided by (policy/prompter/coordinator)
   - Active mode vs required mode comparison

**API routes:**
- `app/api/tools/route.ts` — GET: list tools
- `app/api/tools/policies/route.ts` — GET: list policies; POST: create/update policy
- `app/api/tools/audit/route.ts` — GET: query audit entries

---

## Phase 4: Polish & Integration (Tasks 12-14, ~1.5 hours, ~$4.00)

Final tasks that depend on the pages being built. These handle cross-cutting concerns.

### Task 12: Realtime & Notifications
**Priority:** 4 | **Depends on:** task-005, task-010 | **Budget:** $1.50 | **Turns:** 15

Wire up Supabase Realtime across the app:

1. **`components/RealtimeProvider.tsx`** — Client component that wraps the app:
   - Initializes Supabase Realtime client
   - Subscribes to `agent_runs`, `system_events`, `budget_ledger` tables
   - Provides a React context with live data
   - Auto-reconnects on disconnect

2. **Agent Monitor live updates** — When an `agent_runs` row changes:
   - Update the agent card in-place (no full page reload)
   - Flash animation on status change
   - Toast notification: "Agent X completed task Y" or "Agent X failed: reason"

3. **Event feed** — System events appear in real-time on:
   - Dashboard activity feed
   - Health page event log
   - As toast notifications for severity=error or severity=fatal

4. **Budget tracking** — Real-time budget gauge updates:
   - Dashboard budget gauge reflects new usage entries immediately
   - Warning toast when budget hits 80%
   - Alert toast when budget hits 95%

5. **Connection status indicator** — Small dot in sidebar footer:
   - Green: connected to Realtime
   - Yellow: reconnecting
   - Red: disconnected

### Task 13: Responsive Layout & Mobile
**Priority:** 4 | **Depends on:** task-009 | **Budget:** $1.00 | **Turns:** 15

Make the morning report and dashboard usable on Robin's phone:

1. **Sidebar** — Collapsible on mobile:
   - Hamburger menu button (visible below md breakpoint)
   - Overlay sidebar with backdrop
   - Auto-close on navigation

2. **Morning Report** — Mobile-first redesign:
   - Stack hero section vertically
   - Task results as swipeable cards instead of table
   - Budget chart fits phone width
   - Attention section at top (most important info first)

3. **Dashboard** — Responsive grid:
   - 4 stat cards: 2x2 on mobile, 4x1 on desktop
   - Activity feed: full width, scrollable
   - Quick actions: horizontal scroll on mobile

4. **All pages** — Basic responsive:
   - Tables scroll horizontally on mobile
   - Modals become full-screen drawers
   - Font sizes scale appropriately

### Task 14: Final Integration Testing
**Priority:** 5 | **Depends on:** task-012, task-013 | **Budget:** $1.50 | **Turns:** 20

End-to-end verification that everything works:

1. **Smoke test each page** — Navigate to every route and verify:
   - No build errors
   - API calls succeed (or show graceful error states)
   - Dark theme renders correctly
   - Data displays properly

2. **Test core workflows:**
   - Login flow (API key auth)
   - Create a task -> see it in task list
   - Spawn an agent -> see it in agent monitor
   - Store a memory -> find it in memory explorer
   - Run doctor -> see results in health page
   - View morning report (may need mock data if no night run happened yet)

3. **Create mock data** — If the database is empty, seed with:
   - 5 sample agent runs (2 completed, 1 running, 1 failed, 1 pending)
   - 10 sample system events
   - 3 sample tasks
   - 5 sample memories
   - 1 sample night run report

4. **Fix any issues found** — Common issues to watch for:
   - TypeScript type mismatches between API responses and frontend types
   - Missing error handling on API routes
   - Broken links in sidebar navigation
   - CSS issues (overflow, z-index, dark mode contrast)

5. **Build verification:**
   - Run `npm run build` — ensure zero errors
   - Run `npm run lint` — fix any lint issues
   - Test `npm run start` — verify production build works

---

## Budget Breakdown

| Phase | Tasks | Estimated Cost | Estimated Time |
|-------|-------|---------------|----------------|
| 1. Scaffold & Foundation | 1-3 | $2.50 | 45 min |
| 2. Core Pages | 4-8 | $8.00 | 3 hours |
| 3. Specialized Pages | 9-11 | $5.50 | 2 hours |
| 4. Polish & Integration | 12-14 | $4.00 | 1.5 hours |
| **Total** | **14 tasks** | **$20.00** | **~7.25 hours** |

Buffer: 45 minutes for retries, dependency waits, and NightRunner overhead.

---

## Dependency Graph

```
task-001 (scaffold) ──┐
task-002 (api client) ─┤──▶ task-004 (dashboard) ──▶ task-009 (morning) ──▶ task-013 (responsive)
task-003 (components) ─┤──▶ task-005 (agents) ───▶ task-012 (realtime) ──▶ task-014 (testing)
                       ├──▶ task-006 (tasks)
                       ├──▶ task-007 (memory)
                       ├──▶ task-008 (sessions)
                       ├──▶ task-010 (health) ───▶ task-012 (realtime)
                       └──▶ task-011 (tools)
```

**Wave execution plan (3 concurrent slots):**
- Wave 1: task-001, task-002, task-003 (parallel, no deps)
- Wave 2: task-004, task-005, task-006 (parallel, all depend on wave 1)
- Wave 3: task-007, task-008, task-009 (parallel, depend on wave 1 or 2)
- Wave 4: task-010, task-011, task-012 (parallel)
- Wave 5: task-013, task-014 (task-014 waits for task-012+013)

---

## What Robin Wakes Up To

1. Open browser to `localhost:3000`
2. Login with OB1 access key
3. See the **Dashboard** with agent counts, budget gauge, activity feed
4. Navigate to **Morning Report** to see the night run summary
5. Check **Agent Monitor** for any running/failed agents
6. Browse **Memory** to see what was stored overnight
7. Open **Tasks** to plan the next night's work
8. Check **Health** for system status

If the night run itself built this dashboard, the morning report will show the meta-result: "I built the tool that's showing you this report."

---

## Recovery Plan

If the NightRunner crashes or budget runs out mid-build:

1. The scaffold (tasks 1-3) is the critical path. If these complete, Robin can manually finish pages.
2. Each page is self-contained. A partially completed dashboard (e.g., 5 of 8 pages) is still useful.
3. The NightRunner stores its report regardless of completion level.
4. Failed tasks can be retried by running the NightRunner again with the same task file.
5. The task file is idempotent — re-running won't duplicate work if the agent checks for existing files.
