# OB1 Operational Runbook

Practical incident response for the OB1 platform. Commands first, theory never.

**Infrastructure:** Windows 11 PC (control plane) + MacBook Air M2 (agent host, SSH user `openclaw`) + Supabase (state/backend)

---

## Quick Reference

| Symptom | First Command |
|---------|--------------|
| Something feels wrong | `ob1 status` |
| Night session not responding | `ob1 night status` |
| Need to stop overnight run | `ob1 night stop` |
| Deploy went bad | `ob1 deploy rollback` |
| Check what happened last night | `ob1 night report` |
| Mac not responding | `ssh openclaw@<tailscale-ip> echo ok` |
| See live logs | `ob1 logs runtime -f` |
| Check all logs at once | `ob1 logs --all` |
| See budget spent | `ob1 status --json` |
| Deploy history | `ob1 deploy history` |

---

## Incidents

### Incident 1: Night session stuck/hanging

**Symptoms:** `ob1 night status` shows RUNNING but no new waves completing for >1 hour. Morning report timestamp is stale. Logs show repeated retries or silence.
**Severity:** High
**Who:** Robin (manual)

**Steps:**
1. `ob1 night status --waves` -- check wave progress timestamps
2. `ob1 logs runtime -f` -- look for retry loops or silence
3. `ssh openclaw@<tailscale-ip> "pgrep -f wave-runner && echo ALIVE || echo DEAD"` -- confirm process exists
4. `ssh openclaw@<tailscale-ip> "top -l 1 -n 5 | head -20"` -- check CPU/memory
5. If stuck: `ob1 night stop` then `ob1 night start --goal "Continue: <goal>" --budget <remaining>`
6. If graceful stop hangs: `ob1 night stop --force`
7. Verify: `ob1 night status`

**Prevention:** The wave protocol moves on after 3 failed verify attempts. Ensure quality gates are not misconfigured to retry indefinitely.

---

### Incident 2: Night session crashed

**Symptoms:** `ob1 night status` shows STOPPED unexpectedly. Morning report is incomplete or missing. Heartbeat stale.
**Severity:** High
**Who:** Robin (manual)

**Steps:**
1. `ob1 night status` -- confirm STOPPED
2. `ob1 logs runtime --since 8h --level error` -- find crash cause
3. `ssh openclaw@<tailscale-ip> "tail -100 /tmp/ob1-wave-runner.log"` -- raw crash output
4. `ob1 night report` -- partial report exists (updated per-wave)
5. `ssh openclaw@<tailscale-ip> "cd ~/workspace/OB1 && git log --oneline -10"` -- check committed waves
6. `ssh openclaw@<tailscale-ip> "log show --predicate 'process == \"node\"' --last 2h --style compact | tail -30"` -- OS-level crash info
7. Resume: `ob1 night start --goal "Resume from wave N: <goal>" --budget <remaining>`

**Prevention:** The wave protocol commits per-wave, so crash damage is limited to the in-progress wave. Ensure adequate disk space and memory. Consider a watchdog cron job.

---

### Incident 3: Budget overrun

**Symptoms:** `ob1 status --json` shows spent > configured budget. Morning report shows higher cost than contracted.
**Severity:** Critical
**Who:** Robin (manual)

**Steps:**
1. `ob1 status --json` -- check spent vs. budget
2. `ob1 night stop` -- immediately stop if still running
3. `ssh openclaw@<tailscale-ip> "cat ~/.ob1/active-contract.json"` -- confirm contracted limit
4. `ob1 night report --raw` -- per-wave spend breakdown
5. `ob1 logs runtime --level warn --since 8h` -- look for runaway retries or expensive calls
6. Verify against guardrails: single task $5, night total $25, Bacowr batch $50

**Prevention:** Always set explicit `--budget` on `ob1 night start`. The wave-runner checks budget before each wave. Never increase limits without Robin's approval.

---

### Incident 4: Mac unreachable via Tailscale

**Symptoms:** `ob1 status` shows Mac (Tailscale) as DOWN. SSH connection refused or timed out. Dashboard inaccessible.
**Severity:** Critical
**Who:** Robin (manual)

**Steps:**
1. `ob1 status` -- confirm Mac is DOWN
2. `ssh openclaw@<tailscale-ip> echo ok` -- test raw SSH
3. `tailscale status` -- check Tailscale mesh from Windows
4. If Mac offline in Tailscale: physical access needed (wake Mac, check power/network). Mac may have slept.
5. If Tailscale connected but SSH refused: `tailscale ping <tailscale-ip>` -- then check sshd on Mac
6. Once reconnected: `ob1 status` -- verify all services
7. If night session interrupted: `ob1 night status` and `ob1 night report`

**Prevention:** Disable Mac sleep (`sudo pmset -a disablesleep 1`). Enable Tailscale on boot. Set SSH to auto-start (`sudo systemsetup -setremotelogin on`).

---

### Incident 5: Failed deploy

**Symptoms:** `ob1 deploy push` fails. Auto-rollback triggered. `ob1 deploy history` shows `rolled_back` status.
**Severity:** High
**Who:** Robin (manual)

**Steps:**
1. `ob1 deploy history -n 5` -- check what happened
2. `ob1 status` -- verify auto-rollback health (rollback is automatic on health check failure)
3. If auto-rollback did not run: `ob1 deploy rollback` (or `--sha <sha>` for specific commit)
4. `ob1 logs runtime --since 30m --level error` -- find the build/restart failure
5. Fix locally, then redeploy: `ob1 deploy push`

**Prevention:** Do not use `--skip-gates` in production. Use `--dry-run` first. The pipeline runs `tsc --noEmit` before pushing.

---

### Incident 6: Supabase down/unreachable

**Symptoms:** `ob1 status` shows Supabase API as DOWN. Edge Functions show 0/7 healthy. API timeouts in logs.
**Severity:** Critical
**Who:** Robin (manual)

**Steps:**
1. `ob1 status` -- confirm Supabase API and Edge Functions status
2. Check https://status.supabase.com for global incidents
3. Test directly: `curl -s -o /dev/null -w "%{http_code}" https://<project-ref>.supabase.co/rest/v1/ -H "apikey: <anon-key>"`
4. If global outage: wait for recovery. No local fix.
5. If only Edge Functions: check Supabase Dashboard > Edge Functions > Logs
6. `ob1 night stop` -- stop sessions to avoid wasting budget on failed calls
7. After recovery: `ob1 status` -- verify all services

**Prevention:** Runtime should handle transient failures with exponential backoff. Wave-runner should auto-stop on consecutive API failures. Subscribe to Supabase status notifications.

---

### Incident 7: Quality gates flapping

**Symptoms:** Tests pass, then fail, then pass without code changes. Intermittent CI failures. `tsc --noEmit` succeeds locally but fails on Mac.
**Severity:** Medium
**Who:** Robin (manual)

**Steps:**
1. `npx tsc --noEmit` -- establish local baseline
2. `npm test` -- run tests locally
3. `ssh openclaw@<tailscale-ip> "cd ~/workspace/OB1 && node --version && npm --version"` -- check Mac env matches
4. `ob1 logs runtime --level error --since 2h` -- look for timing-dependent failures
5. `ssh openclaw@<tailscale-ip> "cd ~/workspace/OB1 && git status"` -- check for dirty working tree / race conditions
6. If Node versions differ: `ssh openclaw@<tailscale-ip> "nvm use --lts"`
7. `ob1 status` -- check if tests depend on external services that are down

**Prevention:** Pin Node.js versions across environments. Mock external service calls. If a test flaps 3 times, quarantine it.

---

### Incident 8: Model provider outage

**Symptoms:** Anthropic/OpenAI/Google API returning 500s. Wave-runner failing at EXECUTE step. Logs show repeated API errors.
**Severity:** High
**Who:** SysAdmin (auto) / Robin (manual if prolonged)

**Steps:**
1. `ob1 logs runtime --level error --since 1h` -- identify which provider is failing
2. Check status pages: Anthropic (status.anthropic.com), OpenAI (status.openai.com), Google (status.cloud.google.com)
3. `ob1 night status --waves` -- wave protocol should auto-handle (3 retries then move on)
4. If stuck on one provider: `ob1 night stop` then `ob1 night start --goal "<goal>" --model <alternative>`
5. If all providers down: `ob1 night stop`
6. After recovery: `ob1 status`

**Prevention:** Multi-model orchestration should auto-fallback between Claude, Codex, and Gemini. Ensure all three are configured before overnight sessions.

---

### Incident 9: Disk full on Mac

**Symptoms:** Build failures with ENOSPC errors. Log files not writing. Git operations failing.
**Severity:** High
**Who:** Robin (manual)

**Steps:**
1. `ssh openclaw@<tailscale-ip> "df -h /"` -- check usage
2. `ssh openclaw@<tailscale-ip> "du -sh /tmp/ob1-* /tmp/bacowr-* ~/workspace/OB1/node_modules ~/.npm/_cacache 2>/dev/null | sort -rh | head -10"` -- find biggest offenders
3. `ssh openclaw@<tailscale-ip> "truncate -s 0 /tmp/ob1-*.log /tmp/bacowr-*.log 2>/dev/null; echo done"` -- clean logs
4. `ssh openclaw@<tailscale-ip> "npm cache clean --force"` -- clean npm cache
5. `ssh openclaw@<tailscale-ip> "cd ~/workspace/OB1 && rm -rf theleak/implementation/runtime/dist theleak/implementation/gui/.next"` -- clean build artifacts
6. `ssh openclaw@<tailscale-ip> "df -h /"` -- verify recovery
7. `ob1 deploy push --skip-gates` -- rebuild services

**Prevention:** Cron job to rotate/truncate logs weekly. Add a disk-space gate that warns at 80% full.

---

### Incident 10: New model onboarding

**Symptoms:** N/A -- this is a planned operation, not an incident.
**Severity:** Low
**Who:** Robin (manual)

**Steps:**
1. `ssh openclaw@<tailscale-ip> "curl -s https://<provider-api>/v1/models -H 'Authorization: Bearer <key>' | head -5"` -- verify API access from Mac
2. Add model to registry (requires Robin's approval -- architectural change per escalation boundaries)
3. `ssh openclaw@<tailscale-ip> "echo 'export NEW_PROVIDER_KEY=...' >> ~/.zshrc && source ~/.zshrc"` -- set env vars
4. `ob1 deploy push` -- deploy updated config
5. `ob1 night start --goal "Test new model" --budget 2 --hours 1 --model <new-model> --dry-run` -- dry run first
6. `ob1 night start --goal "Test new model" --budget 2 --hours 1 --model <new-model>` -- real test
7. `ob1 night status --waves` and `ob1 logs runtime -f` -- monitor
8. `ob1 night report` -- verify model attribution in report

**Prevention:** Always test new models with short, low-budget sessions first. Document model-specific quirks in the knowledge base.

---

## Escalation Rules

When in doubt, check the full escalation boundaries at `docs/design-docs/escalation-boundaries.md`.

| Action | Who Decides |
|--------|------------|
| Stop a running session | Robin |
| Rollback a deploy | Robin |
| Clean disk space | Robin |
| Restart a failed session | Robin |
| Increase budget limits | Robin (approval required) |
| Add new model/provider | Robin (approval required) |
| Change escalation boundaries | Robin (approval required) |
| Auto-stop on budget exhaustion | SysAdmin (automatic) |
| Auto-rollback on failed health check | SysAdmin (automatic) |
| Move to next wave after 3 failures | SysAdmin (automatic) |

## Log File Locations (Mac)

| Service | Path |
|---------|------|
| Wave-runner | `/tmp/ob1-wave-runner.log` |
| Runtime | `/tmp/ob1-runtime.log` |
| Dashboard | `/tmp/ob1-dashboard.log` |
| Bacowr worker | `/tmp/bacowr-worker.log` |
| OpenClaw gateway | `/tmp/openclaw-gateway.log` |
| macOS system | `/var/log/system.log` |

## Key Config Paths

| Item | Location |
|------|----------|
| OB1 CLI config | `~/.ob1/config.json` (Windows) |
| Active session contract | `~/.ob1/active-contract.json` (Mac) |
| Deploy history | `~/.ob1/deploy-history.json` (Windows) |
| Morning reports | `~/workspace/OB1/theleak/implementation/MORNING_REPORT_<date>.md` (Mac) |
| Session planning | `D:\OB1\.planning/` (Windows) |
