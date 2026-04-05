# Hardening Report -- OB1 Agentic Runtime

**Date:** 2026-04-05  
**Scope:** conversation-runtime.ts, budget-tracker.ts, night-runner.ts, coordinator.ts, doctor.ts, transcript-compactor.ts, anthropic-client.ts

## Summary

Five real issues found and fixed. Two areas reviewed and found solid.

---

## Issues Found and Fixed

### 1. Budget enforcement gap in transcript compactor

**File:** `src/transcript-compactor.ts`  
**Severity:** High  
**Issue:** The `compactIfNeeded()` method calls `apiClient.complete()` to generate a summary via the LLM, but never checks whether the budget allows an API call first. The existing guards only check `shouldCompact` (whether compaction is needed based on turn count) and `consecutiveFailures`, but not whether the overall token/USD budget has been exhausted. This means a compaction LLM call could fire even after the budget tracker says `can_proceed: false`.

**Fix:** Added a `budget.checkBudget()` call as Guard 2b, between the `shouldCompact` check and the minimum turn count check. If the budget is exhausted, compaction is skipped and a warning event is logged.

---

### 2. No retry logic for transient API errors (429/500/529)

**File:** `src/conversation-runtime.ts`  
**Severity:** High  
**Issue:** When the Anthropic API returns a 429 (rate limited), 500, 502, 503, or 529 (overloaded), the runtime either yielded an error event (for stream-level errors) or threw (for fetch-level errors). In both cases, the turn failed immediately with no retry. For an autonomous overnight run, a single transient 429 would terminate the entire agentic loop.

**Fix:** Wrapped the stream call in a retry loop (max 3 attempts) with exponential backoff (2s, 4s, 8s). The `isRetryableApiError()` function pattern-matches error messages for transient HTTP status codes. Retries are attempted for both stream-level error events and fetch-level exceptions. Non-retryable errors still fail immediately. Each retry is logged for observability.

---

### 3. Night runner graceful shutdown can exceed wall-clock limit

**File:** `src/night-runner.ts`  
**Severity:** Medium  
**Issue:** After the main execute loop exits (due to `shouldStop()` returning true), the runner unconditionally waits for all active tasks to finish via `Promise.allSettled(remaining)`. Since each task can take up to 30 minutes (AGENT_TIMEOUT_MS), and up to 3 tasks can be active, the actual wall-clock time could exceed `maxDurationMinutes` by up to 90 minutes. For a user expecting the runner to be done by morning, this matters.

**Fix:** Replaced the unconditional `Promise.allSettled` with `Promise.race` against a grace period timer. The grace period is calculated as (maxDuration - elapsed + 5 minutes), giving active tasks a 5-minute grace window to finish. If tasks are still running after the grace period, the runner logs a warning and proceeds to generate the report.

---

### 4. Coordinator awaitDependencies ignores failed dependencies

**File:** `src/coordinator.ts`  
**Severity:** Medium  
**Issue:** The `awaitDependencies()` method only waited for dependency promises to settle, but never checked whether they succeeded. If a dependency agent failed, `awaitDependencies()` returned normally, and the dependent agent would proceed with its task as if the dependency succeeded. The `executeWaves()` method handled this correctly (it marks failed deps in the graph), but direct `spawn()` calls with `dependsOn` did not.

**Fix:** Added post-settlement validation that checks each dependency's status. If any dependency has a status other than `'completed'`, or if its promise was rejected, `awaitDependencies()` now throws with a descriptive error. This causes the calling `spawn()` to enter its catch block and properly mark the agent as failed.

---

### 5. Coordinator fireAndForget has no timeout

**File:** `src/coordinator.ts`  
**Severity:** Medium  
**Issue:** The `fireAndForget()` method spawns a forked runtime and stores its promise in `activeRuntimes`, but the underlying `forkedRuntime.run()` call has no timeout. If the forked runtime hangs (e.g., network partition, API stall), the promise never resolves. While `awaitAgent()` has a 5-minute timeout, the underlying leaked promise would prevent the coordinator from cleaning up via `awaitAll()`.

**Fix:** Wrapped `forkedRuntime.run(task)` in `Promise.race` with a 30-minute timeout (matching the night runner's `AGENT_TIMEOUT_MS`). Also fixed `durationMs` which was hardcoded to 0 -- it now calculates actual elapsed time.

---

## Areas Reviewed -- No Issues Found

### Budget enforcement in the main agentic loop

The `conversation-runtime.ts` main loop properly calls `budget.checkBudget()` at the top of every `runTurn()` (Step 1, line 414) before any API call. The `maxIterations` guard (default 200) prevents infinite loops. Usage recording happens immediately after each turn. This is solid.

### Night runner safety

The night runner is well-built:
- **Wall-clock timeout:** `shouldStop()` checks `maxDurationMinutes` every loop iteration.
- **Per-task timeout:** `pollAgentCompletion()` uses `AGENT_TIMEOUT_MS` (30 min).
- **SIGINT/SIGTERM:** Properly handled with cleanup in `finally` block.
- **Morning report:** `generateReport()` produces detailed per-task results; `persistReport()` stores it as an OB1 thought with tags and provenance.
- **Crash recovery:** Orphaned `running` tasks are detected and marked failed on startup.
- **Supabase resilience:** `withSupabaseRetry()` provides exponential backoff for transient DB failures.
- **Heartbeat logging:** 60-second interval heartbeats provide status visibility.

### Doctor system

The `doctor.ts` health-check system is solid. All checks have proper error handling (try/catch in each check function), auto-repair is scoped to safe operations (creating files/directories only), and the category ordering respects dependency chains. No changes needed.

### Coordinator task claiming

Within a single coordinator, the DAG-based scheduling prevents double-claiming. Each agent job has a unique `runId`, the DAG tracks status per node, and `executeWaves()` processes each wave atomically. Cross-coordinator coordination relies on Supabase for serialization via `spawnAgent()`. Message passing uses database-backed `sendMessage()` with timestamps for ordering. No race conditions found within the scope of this code.

---

## Files Modified

| File | Changes |
|------|---------|
| `src/transcript-compactor.ts` | Added budget check before compaction LLM call |
| `src/conversation-runtime.ts` | Added retry loop with exponential backoff for transient API errors |
| `src/night-runner.ts` | Added wall-clock cap to graceful shutdown wait |
| `src/coordinator.ts` | Fixed awaitDependencies to check dep status; added timeout to fireAndForget |
