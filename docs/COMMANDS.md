# OB1 Command Reference

Quick-find cheat sheet. Every command Robin needs, organized by system.

**Navigation:** [Runtime CLI](#1-ob1-runtime-cli) | [GUI Dashboard](#2-ob1-gui-dashboard) | [API](#3-ob1-api-edge-functions) | [Bacowr](#4-bacowr) | [Mac Platform](#5-mac-platform-launchd) | [Tailscale](#6-tailscale--network) | [OpenClaw](#7-openclaw) | [Claude Code Skills](#8-claude-code-skills) | [Agent Framework](#9-agent-framework) | [GSD Framework](#10-gsd-framework) | [Buildr](#11-buildr-system) | [Team & Scheduling](#12-team--scheduling) | [Git & Deploy](#13-git--deploy)

---

## 1. OB1 Runtime CLI

Binary: `ob1-agent` (from `theleak/implementation/runtime`)

| Command | When to Use | Example |
|---------|-------------|---------|
| `ob1-agent boot` | First run or after config change -- runs 10-phase startup | `ob1-agent boot --verbose` |
| `ob1-agent doctor` | Something feels wrong -- runs 6-category health checks with auto-repair | `ob1-agent doctor` |
| `ob1-agent run` | Start an interactive agent session | `ob1-agent run --model opus --max-usd 5` |
| `ob1-agent run --simple` | Quick task with limited tools (read, edit, bash only) | `ob1-agent run --simple` |
| `ob1-agent resume` | Continue a previous session | `ob1-agent resume --session <id>` |
| `ob1-agent status` | Check current session info, usage, budget | `ob1-agent status --session <id>` |
| `ob1-agent sessions` | List recent sessions | `ob1-agent sessions --json` |
| `ob1-agent budget` | See budget breakdown (tokens, USD, turns) | `ob1-agent budget` |
| `ob1-agent tools` | List available tools and their permissions | `ob1-agent tools` |
| `ob1-agent agents` | List registered agent types | `ob1-agent agents` |
| `ob1-agent memory recall` | Semantic search across memories | `ob1-agent memory recall "architecture"` |
| `ob1-agent memory store` | Store a new memory | `ob1-agent memory store "Important decision..."` |
| `ob1-agent memory stats` | Memory system statistics | `ob1-agent memory stats` |
| `ob1-agent version` | Show version | `ob1-agent version` |

**Global options:** `--config <path>`, `--model <haiku|sonnet|opus>`, `--max-turns <n>`, `--max-tokens <n>`, `--max-usd <n>`, `--verbose`, `--json`

---

## 2. OB1 GUI Dashboard

Routes at `localhost:3000`

| Route | What It Shows | When to Check |
|-------|--------------|---------------|
| `/` | Dashboard home -- stats, night run progress, agent summary | Morning check, general overview |
| `/morning` | Morning report -- daily summary of overnight activity | First thing in the morning |
| `/agents` | Agent monitor -- list by status (running, completed, failed) | When agents are running |
| `/agents/spawn` | Spawn new agent -- form to create agent runs | When you need a new agent |
| `/agents/[runId]` | Agent detail -- full run info, messages, tools used | Debugging a specific run |
| `/sessions` | Sessions list -- status, budget usage, model | Reviewing past work |
| `/tasks` | Night task manager -- configure overnight jobs | Evening setup |
| `/memory` | Memory explorer -- semantic search across all memories | Finding past decisions |
| `/memory/[id]` | Memory detail -- full content, metadata, similarity | Deep dive on specific memory |
| `/health` | Health checks -- doctor report, system status | When something seems wrong |
| `/tools` | Tool inventory -- registered tools, permissions | Checking available capabilities |

---

## 3. OB1 API (Edge Functions)

All `POST` to `<SUPABASE_URL>/functions/v1/<function>` with `x-access-key` header.

| Function | Key Actions | When to Use |
|----------|------------|-------------|
| `agent-tools` | list_tools, register_tool, update_tool, assemble_pool, set_policy, get_policies | Managing tool registry |
| `agent-state` | create_session, get_session, update_session, list_sessions, create_checkpoint, record_usage, get_budget, check_budget | Session lifecycle |
| `agent-stream` | stream | Real-time LLM streaming |
| `agent-doctor` | run_doctor, record_boot | Health checks, boot tracking |
| `agent-memory` | recall, store, stats | Semantic memory operations |
| `agent-skills` | register_skill, list_skills | Skill management |
| `agent-coordinator` | spawn_agent, list_agent_types, send_message, get_messages, get_agent_summary | Multi-agent orchestration |

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-doctor" \
  -H "x-access-key: $OB1_KEY" \
  -d '{"action":"run_doctor"}'
```

---

## 4. Bacowr

Worker at `localhost:8080`

| Endpoint | When to Use | Example |
|----------|-------------|---------|
| `GET /health` | Check worker is running | `curl localhost:8080/health` |
| `GET /status` | Active jobs, completed today, queue depth | `curl localhost:8080/status` |
| `POST /process-job` | Submit single job for processing | `curl -X POST localhost:8080/process-job -d '{...}'` |
| `POST /process-batch` | Submit multiple jobs | `curl -X POST localhost:8080/process-batch -d '{"jobs":[...]}'` |

**Bacowr API** (Edge Function): `POST <SUPABASE_URL>/functions/v1/bacowr-api` with `x-api-key` header.

Actions: `submit_batch`, `get_batch`, `list_batches`, `get_job`, `get_article`, `get_usage`, `get_profile`, `regenerate_api_key`

---

## 5. Mac Platform (launchd)

| Command | When to Use | Example |
|---------|-------------|---------|
| `launchctl load ~/Library/LaunchAgents/com.ob1.runtime.plist` | Start OB1 night runner | After install or reboot |
| `launchctl unload ~/Library/LaunchAgents/com.ob1.runtime.plist` | Stop OB1 night runner | Maintenance |
| `launchctl load ~/Library/LaunchAgents/com.ob1.dashboard.plist` | Start GUI dashboard | After install or reboot |
| `launchctl load ~/Library/LaunchAgents/com.bacowr.worker.plist` | Start Bacowr worker | After install or reboot |
| `launchctl load ~/Library/LaunchAgents/com.openclaw.gateway.plist` | Start OpenClaw gateway | After install or reboot |
| `launchctl list \| grep -E "ob1\|bacowr\|openclaw"` | Check what's running | Troubleshooting |
| `tail -f /tmp/ob1-runtime.log` | Watch runtime logs | Debugging |
| `tail -f /tmp/ob1-dashboard.log` | Watch dashboard logs | Debugging |
| `tail -f /tmp/bacowr-worker.log` | Watch worker logs | Debugging |

---

## 6. Tailscale & Network

| Command | When to Use | Example |
|---------|-------------|---------|
| `tailscale status` | Check mesh VPN connections | Connectivity issues |
| `tailscale ip` | Get Mac's Tailscale IP | Setting up remote access |
| `curl http://<tailscale-ip>:3000` | Access GUI from Windows PC | Remote dashboard access |
| `curl http://<tailscale-ip>:8080/health` | Check Bacowr from Windows | Remote worker check |
| `ssh openclaw@<tailscale-ip>` | SSH to Mac from Windows | Remote admin |

---

## 7. OpenClaw

| Command | When to Use | Example |
|---------|-------------|---------|
| `openclaw gateway` | Start/manage the gateway daemon | Service management |
| `openclaw agent "message"` | Send a message to the AI assistant | Quick task |
| `openclaw message send -c telegram "text"` | Send via a specific channel | Remote notification |
| `openclaw onboard` | Setup wizard (channels, auth, daemon) | First-time setup |
| `openclaw doctor` | Diagnostic and migration tool | Troubleshooting |
| `openclaw channels` | List connected channels | Checking channel status |

---

## 8. Claude Code Skills

Slash commands for the Claude Code CLI.

| Skill | When to Use | Example |
|-------|-------------|---------|
| `/harness-engineering` | Set up or update agent harness for a repo | After major refactors |
| `/find-skills` | Discover available skills | When you need new capabilities |
| `/commit` | Create a well-formatted git commit | After completing work |
| `/review-pr` | Review a GitHub PR | Code review |
| `/simplify` | Review code for reuse and quality | After writing code |
| `/the-cleaner` | Clean up code | After agent-heavy sessions |
| `/debug-detective` | Systematic debugging | Stuck on a bug |
| `/spec-to-app` | Generate app from spec | New project |
| `/schedule` | Create cron-based remote agents | Recurring automation |
| `/loop 5m /command` | Run a command every N minutes | Monitoring |

---

## 9. Agent Framework

| Skill | When to Use | Example |
|-------|-------------|---------|
| `/agent:install` | Initialize `.agent/` in a project | New project setup |
| `/agent:new-project` | Start structured development project | Green-field project |
| `/agent:create-roadmap` | Define project phases | Project planning |
| `/agent:plan-phase` | Create PLAN.md for a phase | Before execution |
| `/agent:execute-plan` | Run tasks from a PLAN.md | Building features |
| `/agent:execute-phase` | Run all plans in a phase in parallel | Batch execution |
| `/agent:go` | Autonomous execution until completion | Hands-off mode |
| `/agent:status` | Check project progress | Status check |
| `/agent:plugin` | Side-task without interrupting main work | Quick detour |

---

## 10. GSD Framework

| Skill | When to Use | Example |
|-------|-------------|---------|
| `/gsd:new-project` | Initialize with deep context gathering | Starting from scratch |
| `/gsd:create-roadmap` | Create phased roadmap | Project planning |
| `/gsd:discuss-phase` | Gather context before planning | Understanding scope |
| `/gsd:plan-phase` | Create execution plan for a phase | Ready to plan |
| `/gsd:execute-phase` | Execute with wave-based parallelization | Ready to build |
| `/gsd:execute-plan` | Execute a single PLAN.md | Focused execution |
| `/gsd:progress` | Check progress, route to next action | Where am I? |
| `/gsd:verify-work` | Manual acceptance testing | After building |
| `/gsd:debug` | Systematic debugging with persistent state | Stuck on a bug |
| `/gsd:pause-work` | Create context handoff | Stopping mid-work |
| `/gsd:resume-work` | Resume with full context restoration | Coming back |
| `/gsd:map-codebase` | Analyze codebase with parallel agents | Understanding a repo |
| `/gsd:add-todo` | Capture idea as todo | Quick capture |
| `/gsd:check-todos` | List and pick a todo | What to work on |

---

## 11. Buildr System

| Skill | When to Use | Example |
|-------|-------------|---------|
| `/buildr-operator` | Generate complete project workspace from description | New project |
| `/buildr-executor` | Execute a Buildr workspace wave by wave | Running a workspace |
| `/buildr-rescue` | Fix stuck/broken project | Project in trouble |
| `/buildr-scout` | Extract knowledge from external sources | Research |
| `/buildr-smith` | Create/maintain Vault items (skills, constraints) | System evolution |

---

## 12. Team & Scheduling

| Skill | When to Use | Example |
|-------|-------------|---------|
| `/team-architect` | Design and launch agent teams | Complex parallel work |
| `/schedule` | Create cron-based remote agents | Recurring tasks |
| `/schedule list` | List scheduled agents | Check what's running |
| `/schedule run <name>` | Manually trigger a scheduled agent | Test a schedule |

---

## 13. Git & Deploy

| Command | When to Use | Example |
|---------|-------------|---------|
| `./deploy.sh` | Deploy OB1 to Supabase (migrations + functions) | Production deploy |
| `./deploy.sh --skip-migrations` | Deploy only Edge Functions | Code-only update |
| `supabase functions deploy <name>` | Deploy single Edge Function | Quick fix |
| `supabase db push` | Push migrations to remote | Schema update |
| `docker build -t bacowr-worker -f worker/Dockerfile .` | Build Bacowr Docker image | DigitalOcean deploy |
| `git checkout -b contrib/robin/<feature>` | Start a contribution branch | New feature |
