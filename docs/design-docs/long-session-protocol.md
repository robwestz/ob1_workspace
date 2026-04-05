# Long Session Protocol — OB1

**Problem:** Autonomous agent sessions (4-12h) fail in predictable ways:
- Agent runs out of meaningful work after 30 minutes
- No verification between tasks — errors compound
- Single failure kills the whole session
- No checkpointing — crash = lost work
- Morning report is shallow ("did 4 things") instead of deep

**Solution:** A structured protocol that makes long sessions iteratively intelligent.

---

## The Wave Contract

Every long session is a sequence of **waves**. Each wave follows a strict contract:

```
WAVE N
  1. PLAN    — What will this wave accomplish? (based on previous wave results)
  2. EXECUTE — Run the work (agents, code, research)
  3. VERIFY  — Did it work? (compile, test, check output)
  4. FIX     — If verify failed, fix before moving on
  5. COMMIT  — Git commit + push (checkpoint)
  6. ASSESS  — What did we learn? What's the highest-value next wave?
```

**Rules:**
- Never skip VERIFY. A wave without verification is wasted work.
- Never skip COMMIT. Unpushed work is un-done work.
- ASSESS is where intelligence lives. Don't just pick the next task from a list — analyze what this wave revealed and do the most valuable thing next.
- If VERIFY fails 3 times, stop the wave, document the failure, move to next priority.

---

## Session Lifecycle

### 1. Session Contract (before sleep)

Human and agent agree on:

```yaml
session:
  name: "Night shift 2026-04-05"
  duration_hours: 8
  budget_usd: 25.00
  
goals:
  primary: "Raise test coverage from F to B"
  secondary: "Security review"
  stretch: "Competitive analysis"

boundaries:
  autonomous:
    - Write tests
    - Fix bugs found by tests
    - Documentation
    - Git commit + push
  requires_approval:
    - Public API changes
    - New dependencies
    - Schema changes
    
stop_conditions:
  - Budget exhausted
  - All goals complete
  - 3 consecutive waves with no meaningful progress
  - Critical error requiring human judgment
```

### 2. Wave Execution (the loop)

```
while (budget_remaining > 0 && time_remaining > 0 && !stop_condition):
    
    wave = plan_next_wave(previous_results, remaining_goals)
    
    if wave.estimated_value < MINIMUM_VALUE_THRESHOLD:
        log("No more high-value work. Stopping.")
        break
    
    results = execute_wave(wave)
    verified = verify_wave(results)
    
    if not verified:
        fix_attempts = 0
        while not verified and fix_attempts < 3:
            results = fix_and_retry(results)
            verified = verify_wave(results)
            fix_attempts += 1
        
        if not verified:
            log_failure(wave, results)
            continue  # Move to next wave, don't get stuck
    
    commit_and_push(wave, results)
    update_morning_report(wave, results)
    
    # The critical step: what did we learn?
    assess(wave, results, remaining_goals)
```

### 3. Morning Report (always generated, even on crash)

The morning report is updated after EVERY wave, not just at the end. If the session crashes at wave 4, Robin still has waves 1-3 documented.

Structure:
- What was accomplished (per wave, with verification results)
- What failed and why
- What's ready to use NOW
- What needs human input
- Budget spent vs. remaining
- Recommended next priorities

---

## Quality Gates Between Waves

Every wave must pass before the next starts:

| Gate | Check | Fail Action |
|------|-------|-------------|
| Compile | `tsc --noEmit` | Fix type errors |
| Tests | All existing tests pass | Fix regressions |
| New tests | New code has tests | Write tests |
| Lint | No banned patterns | Fix violations |
| Build | `next build` (if dashboard) | Fix build errors |
| Size | No file > 500 lines | Split if needed |

If a gate fails, that IS the work for the current wave. Don't move on.

---

## Self-Direction Heuristics

When ASSESS asks "what's the highest-value next wave?", use these heuristics:

1. **Fix what's broken first.** If tests are failing, that's wave N+1. Always.
2. **Deepen before broadening.** 1 feature fully tested > 3 features untested.
3. **Verify claims.** If wave N "wrote 50 tests", wave N+1 should run them.
4. **Follow the errors.** Compiler errors, test failures, and security findings are free prioritization.
5. **Diminishing returns detection.** If wave N produced less value than wave N-1, and N-1 less than N-2, consider stopping.
6. **Dog-food the product.** The best test is using it. If Bacowr generates articles, read one.

---

## Checkpointing

Every commit is a checkpoint. If the session crashes:

1. The morning report (updated per-wave) shows what was done
2. `git log` shows all committed waves
3. Unstaged changes are lost — that's why we commit per wave
4. Next session can read the morning report and resume

For multi-day projects, use `.planning/` directory:

```
.planning/
  session-2026-04-05.md    # Tonight's session contract + results
  session-2026-04-06.md    # Tomorrow's
  backlog.md               # Things we noticed but didn't do
```

---

## Anti-Patterns

| Anti-Pattern | Why It Fails | Instead |
|-------------|-------------|---------|
| Launch 4 agents, commit, done | 30-min burst, not 8h session | Wave loop with verification |
| Run tests but don't read output | Failures compound silently | Verify means READ the output |
| Add features without testing | Quality debt accumulates | Quality gate: tests before next wave |
| Keep working when stuck | Burns budget on retries | 3 strikes → document → move on |
| One big commit at the end | Crash = lost everything | Commit per wave |
| Same task list start to finish | Ignores what we learned | ASSESS step redirects based on findings |
| Shallow morning report | Robin can't act on "did stuff" | Per-wave details with verification status |

---

## Implementation

This protocol is currently human-orchestrated (Claude follows the wave pattern in conversation). To fully automate:

### Phase 1: Protocol as Skill (now)
- This document defines the protocol
- Agent follows it when told "run night shift"
- Morning report is the output contract

### Phase 2: Night Runner Integration (soon)
- night-runner.ts gains wave-based execution
- Each task = one wave with built-in verify step
- Quality gates run automatically between waves
- Morning report updated per-wave

### Phase 3: Self-Directing Agent (future)
- Agent reads previous wave results
- Uses ASSESS heuristics to pick next wave
- Can spawn sub-agents for parallel work within a wave
- Stops when diminishing returns detected
