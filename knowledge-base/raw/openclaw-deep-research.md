# OpenClaw Deep Research — Gamechangers

Research date: 2026-04-05
Sources: Local repo (C:\Users\robin\Downloads\openclaw), Robin's live config (~/.openclaw/), all docs directories

---

## Things We Completely Missed

### 1. Nodes — Distributed Execution Mesh

**What:** Nodes are companion devices (macOS, iOS, Android, Linux, Windows headless) that connect to the Gateway WebSocket and expose a command surface (`system.run`, `canvas.*`, `camera.*`, `screen.record`, `location.get`, `sms.send`). Any machine can be a node.

**Gamechanger because:** Robin can connect his Windows PC + Mac Agent + DigitalOcean Droplet as a unified execution mesh. The Gateway stays on one machine; nodes on others execute commands remotely. The agent can run `git status` on the Mac, take a screenshot of a browser on Windows, snap a photo from an iPhone camera, get GPS location, and even send SMS from an Android — all from a single conversation.

**Config:**
```bash
# On the node machine (Mac/Linux/Windows)
openclaw node run --host <gateway-host> --port 18789 --display-name "Mac Agent"

# Install as background service
openclaw node install --host <gateway-host> --port 18789 --display-name "Mac Agent"

# On the gateway machine — approve the pairing
openclaw nodes pending
openclaw nodes approve <requestId>

# Route exec to the node
openclaw config set tools.exec.host node
openclaw config set tools.exec.node "Mac Agent"
```

**Key capabilities per node type:**
- **Headless node host** (any OS): `system.run`, `system.which`, exec approvals
- **macOS companion app**: All above + `canvas.*`, `camera.*`, `screen.record`, `system.notify`
- **iOS/Android app**: Canvas, camera (photo + video clip), screen recording, location, SMS (Android)

**Per-agent node binding:** Each agent can target a different node:
```json5
agents.list[0].tools.exec.node = "Build Node"
agents.list[1].tools.exec.node = "Mac Agent"
```

**Pre-load strategy:** Set up node hosts on Mac and Droplet, configure exec routing per agent. SysAdmin agent uses the Mac node for macOS-specific tools; Ops agent uses the Droplet for server tasks.

### 2. Canvas — Agent-Controlled WebView Display on Nodes

**What:** Canvas is a WebView surface on iOS/Android/macOS nodes that the agent can control. It can display HTML pages, navigate URLs, execute JavaScript, take snapshots, and push A2UI (Agent-to-UI) JSONL content.

**Gamechanger because:** The agent can build and display interactive UIs on connected devices. Show a dashboard, render a report, display a map, push notifications — all without building a separate app. The canvas is literally a programmable screen the agent controls.

**Commands:**
```bash
openclaw nodes canvas present --node <id> --target https://example.com
openclaw nodes canvas navigate https://example.com --node <id>
openclaw nodes canvas eval --node <id> --js "document.title"
openclaw nodes canvas snapshot --node <id> --format png
openclaw nodes canvas a2ui push --node <id> --text "Hello"
openclaw nodes canvas hide --node <id>
```

**Robin's existing canvas file** (`~/.openclaw/canvas/index.html`) is a test page with iOS/Android bridge detection and action buttons (Hello, Time, Photo, Dalek). It demonstrates the `openclawSendUserAction` bridge for bidirectional communication.

**Pre-load strategy:** Create custom canvas HTML pages for agent dashboards. Put them in the workspace `canvas/` folder. The agent can show real-time system status, Bacowr metrics, or morning reports as visual cards.

### 3. Continuum — Checkpoint System with Crash Recovery and Agent Handoffs

**What:** A full checkpoint/restore system that captures point-in-time snapshots of agent state (context, tasks, memory, decisions, open questions, working files) with crash recovery and cross-agent handoff support.

**Gamechanger because:** This is not just "save state." It's a time-travel system for agents. Checkpoints capture the agent's entire mental model — what it was working on, what it decided, what questions are open, what files it touched. After a crash, the agent can resume exactly where it left off. And the handoff system lets one agent pass its complete context to another agent with resume instructions.

**Checkpoint triggers:** `manual`, `auto` (periodic), `shutdown` (graceful), `workflow-stage`, `error` (recovery), `handoff` (cross-agent)

**Robin already has checkpoints:**
- `cp_1770206938119_vyh2bu` — "Sprint 2 complete" (Feb 4)
- `cp_1770252904974_pg0zi4` — "Sprint 6 Browser Integration KLAR" (Feb 5)

**Checkpoint state includes:**
```typescript
{
  context: { cwd, modelProvider, model, channel },
  tasks: [{ id, subject, status }],
  memory: { insights: [], projectNotes: {} },
  workingFiles: [],
  decisions: [{ decision, rationale, relatedFiles }],
  openQuestions: [],
  stateHash: "sha256..."
}
```

**Agent Handoff type:**
```typescript
{
  fromAgent: string,
  toAgent: string,
  context: { currentTask, workingFiles, decisions, openQuestions },
  resumeInstructions: string,
  checkpointId: string
}
```

**Crash Recovery:** Detects crashed processes by PID, finds the last good checkpoint, and presents resume options (`resume`, `recover`, `new`).

**Pre-load strategy:** Create periodic auto-checkpoints for long night sessions. The crash recovery means if the gateway restarts, the agent can pick up exactly where it left off. Use handoffs to pass work between SysAdmin and CodeReview agents.

### 4. Conductor — Multi-Model Orchestration System

**What:** A sophisticated module-based orchestration system that routes different tasks to different models based on complexity scoring, domain tags, and routing rules. It creates "Uppdragspaket" (Swedish for "assignment packages") with per-module personas, skills, and handoff contexts.

**Gamechanger because:** This is a full multi-model routing engine built into OpenClaw. It can automatically assign Haiku to simple tasks, Sonnet to medium tasks, and Opus to complex ones. Each module gets a custom persona, expertise list, and test strategy. Handoff items flow between modules with priority levels.

**Key types:**
- `ModelAssignment` — routes module to provider with complexity scoring
- `Uppdragspaket` — complete assignment package with persona, skills, contracts, and handoff context
- `RoutingRule` — match by complexity level, domain tags, module id, or name pattern
- `ComplexityFactor` — weighted scoring factors for task complexity

**Routing config:**
```typescript
{
  defaultProvider: "anthropic/claude-sonnet-4-6",
  rules: [
    { match: { type: "complexity", level: "high" }, assign: "anthropic/claude-opus-4-6", priority: 1 },
    { match: { type: "domain", tags: ["security"] }, assign: "anthropic/claude-opus-4-6", priority: 2 }
  ],
  overrides: { "auth-module": "anthropic/claude-opus-4-6" }
}
```

**Pre-load strategy:** Configure routing rules so security-sensitive and architectural tasks go to Opus, routine coding to Sonnet, and quick formatting to Haiku. This optimizes both quality and cost automatically.

### 5. Sub-Agents — Nested Orchestrator Pattern with Thread Binding

**What:** Sub-agents are background agent runs spawned via `sessions_spawn`. They run in isolated sessions, announce results back to the parent, and support nested spawning (orchestrator pattern: main -> orchestrator -> workers). Discord threads can be bound to specific sub-agent sessions.

**Gamechanger because:** This enables true parallel work. The main agent can spawn an orchestrator sub-agent that then fans out to 5 worker sub-agents — all running concurrently. Each worker announces its results back up the chain. With Discord thread binding, each sub-agent gets its own conversation thread that users can interact with directly.

**Nesting config:**
```json5
{
  agents: {
    defaults: {
      subagents: {
        maxSpawnDepth: 2,         // allow orchestrator -> workers
        maxChildrenPerAgent: 5,   // max concurrent per parent
        maxConcurrent: 8,         // global cap
        model: "anthropic/claude-sonnet-4-5",  // cheaper for sub-agents
        archiveAfterMinutes: 60
      }
    }
  }
}
```

**Slash commands:**
```
/subagents list
/subagents spawn coding "Refactor the auth module" --model opus --thinking high
/subagents kill <id|all>
/subagents log <id> [limit] [tools]
/subagents send <id> <message>
/subagents steer <id> <message>
```

**Discord thread binding:**
```
/focus <subagent-label>    — bind thread to sub-agent
/unfocus                   — detach
/agents                    — list active runs
/session ttl 24h           — auto-unfocus timer
```

**Pre-load strategy:** Configure maxSpawnDepth: 2 and use Sonnet for sub-agents (cost optimization). Set up the SysAdmin agent to spawn research sub-agents for overnight work.

### 6. Agent-to-Agent Messaging (Inter-Agent Communication)

**What:** Agents can send messages to each other's sessions via `sessions_send`. This triggers a reply-back ping-pong loop (up to 5 rounds) where agents negotiate and collaborate, then an announce step posts the result to the target channel.

**Gamechanger because:** Multiple agents can have conversations with each other autonomously. SysAdmin can ask CodeReview to analyze a PR, wait for the reply, discuss it back and forth, then announce the final verdict. This is multi-agent collaboration without human mediation.

**Config:**
```json5
{
  tools: {
    agentToAgent: {
      enabled: true,
      allow: ["main", "ops", "coding"]
    }
  },
  session: {
    agentToAgent: {
      maxPingPongTurns: 5  // 0-5 rounds of back-and-forth
    }
  }
}
```

**Reply protocol:**
- Reply `REPLY_SKIP` to stop the ping-pong
- Reply `ANNOUNCE_SKIP` during announce to stay silent
- Inter-session messages are tagged with `provenance.kind = "inter_session"` in transcripts

### 7. Memory System — Hybrid BM25 + Vector Search with Temporal Decay and MMR

**What:** A sophisticated memory search system combining vector embeddings (semantic) with BM25 (keyword), plus temporal decay (recent memories rank higher) and MMR re-ranking (diversity over redundancy). Supports multiple embedding providers (OpenAI, Gemini, Voyage, local GGUF), session transcript indexing, and a QMD sidecar backend.

**Gamechanger because:** This is not just "grep through files." The hybrid search means both "what does this mean?" and "find this exact ID" queries work well. Temporal decay means yesterday's notes outrank stale info from months ago. MMR prevents 5 copies of the same note from filling results. The QMD backend adds reranking on top. And session transcript indexing means the agent can recall past conversations semantically.

**Full config:**
```json5
{
  agents: {
    defaults: {
      memorySearch: {
        provider: "openai",
        model: "text-embedding-3-small",
        query: {
          hybrid: {
            enabled: true,
            vectorWeight: 0.7,
            textWeight: 0.3,
            mmr: { enabled: true, lambda: 0.7 },
            temporalDecay: { enabled: true, halfLifeDays: 30 }
          }
        },
        experimental: { sessionMemory: true },
        sources: ["memory", "sessions"],
        cache: { enabled: true, maxEntries: 50000 },
        extraPaths: ["../team-docs"]
      }
    }
  }
}
```

**QMD backend (experimental):**
```json5
{
  memory: {
    backend: "qmd",
    citations: "auto",
    qmd: {
      includeDefaultMemory: true,
      update: { interval: "5m" },
      limits: { maxResults: 6 },
      sessions: { enabled: true, retentionDays: 30 },
      paths: [{ name: "docs", path: "~/notes", pattern: "**/*.md" }]
    }
  }
}
```

**Pre-load strategy:** Enable hybrid search, temporal decay, MMR, and session memory indexing. Use OpenAI embeddings with batch indexing for the initial backfill. Add extra paths for OB1 docs and project notes.

### 8. Auto Memory Flush (Pre-Compaction Memory Save)

**What:** Before the context window compacts (summarizes old messages), OpenClaw runs a silent agent turn that reminds the model to write durable memories to disk. The agent writes notes, then the context compacts. Nothing is lost.

**Gamechanger because:** This solves the "long session amnesia" problem. Before compaction throws away old context, the agent gets a chance to save everything important. The flush is silent (NO_REPLY), so the user never sees it.

**Config:**
```json5
{
  agents: {
    defaults: {
      compaction: {
        reserveTokensFloor: 20000,
        memoryFlush: {
          enabled: true,
          softThresholdTokens: 4000,
          systemPrompt: "Session nearing compaction. Store durable memories now.",
          prompt: "Write any lasting notes to memory/YYYY-MM-DD.md; reply with NO_REPLY if nothing to store."
        }
      }
    }
  }
}
```

### 9. Hooks — Event-Driven Automation Engine

**What:** A full hook system that fires on agent lifecycle events: `/new`, `/reset`, `/stop`, `agent:bootstrap`, `gateway:startup`, `message:received`, `message:sent`. Hooks can save session context to memory, inject extra bootstrap files, log commands, run startup scripts, and intercept bootstrap files to swap personas.

**Gamechanger because:** Hooks make OpenClaw programmable. The `session-memory` hook saves context on `/new` so nothing is lost between sessions. The `bootstrap-extra-files` hook can inject monorepo-local AGENTS.md files. The `boot-md` hook runs `BOOT.md` on gateway startup — so you can have the agent do initialization work every time it starts. Custom hooks can trigger external APIs, update dashboards, or chain automations.

**Bundled hooks:**
1. `session-memory` — saves session context to memory on `/new`
2. `bootstrap-extra-files` — injects additional workspace files during bootstrap
3. `command-logger` — JSONL audit log of all commands
4. `boot-md` — runs BOOT.md instructions on gateway startup

**Plugin hooks (agent lifecycle):**
- `before_model_resolve` — override model selection
- `before_prompt_build` — inject context before submission
- `before_tool_call` / `after_tool_call` — intercept tool params/results
- `tool_result_persist` — transform tool results before transcript write
- `message_received` / `message_sending` / `message_sent`
- `session_start` / `session_end`
- `gateway_start` / `gateway_stop`
- `before_compaction` / `after_compaction`

**Pre-load strategy:** Enable `session-memory` and `boot-md` hooks. Write a BOOT.md that checks system health on startup. Create a custom hook that posts "gateway started" to a monitoring channel.

### 10. Lobster — Deterministic Workflow Runtime with Approval Gates

**What:** A typed workflow runtime that chains tool calls into deterministic pipelines with explicit human approval checkpoints and resumable state. Pipelines can be defined inline or in `.lobster` YAML files with conditional steps, stdin piping, and per-step approvals.

**Gamechanger because:** Instead of the LLM orchestrating 10 tool calls (burning tokens and risking errors), Lobster runs the entire pipeline as one deterministic call. When a side effect is reached (send email, deploy code), it pauses with a resume token. You approve, and it continues. Workflows are auditable, reproducible, and don't require the LLM to maintain state.

**Example `.lobster` workflow:**
```yaml
name: inbox-triage
steps:
  - id: collect
    command: inbox list --json
  - id: categorize
    command: inbox categorize --json
    stdin: $collect.stdout
  - id: approve
    command: inbox apply --approve
    stdin: $categorize.stdout
    approval: required
  - id: execute
    command: inbox apply --execute
    stdin: $categorize.stdout
    condition: $approve.approved
```

**Enable:**
```json5
{ tools: { alsoAllow: ["lobster"] } }
```

### 11. LLM-Task — Schema-Validated JSON LLM Steps for Workflows

**What:** An optional plugin tool that runs a JSON-only LLM task with schema validation. No tools exposed to the model. Returns structured JSON validated against a JSON Schema.

**Gamechanger because:** Inside a Lobster pipeline, you can add an LLM classification/summarization step without giving the model any tools. The output is guaranteed JSON matching your schema. Perfect for email triage, content classification, intent detection.

**Config:**
```json5
{
  plugins: { entries: { "llm-task": { enabled: true, config: { defaultModel: "gpt-5.2", maxTokens: 800 } } } },
  agents: { list: [{ id: "main", tools: { allow: ["llm-task"] } }] }
}
```

### 12. OpenProse — Multi-Agent Workflow Programs

**What:** A markdown-first workflow format for orchestrating AI sessions with explicit parallelism. Programs live in `.prose` files and can spawn multiple sub-agents with control flow. Includes a `/prose` slash command.

**Gamechanger because:** Write a `.prose` file that says "spawn a researcher agent and a writer agent in parallel, then merge their outputs." It's declarative multi-agent orchestration. Programs are portable across supported runtimes.

**Example:**
```prose
agent researcher:
  model: sonnet
  prompt: "You research thoroughly and cite sources."

agent writer:
  model: opus
  prompt: "You write a concise summary."

parallel:
  findings = session: researcher
    prompt: "Research {topic}."
  draft = session: writer
    prompt: "Summarize {topic}."

session "Merge the findings + draft into a final answer."
context: { findings, draft }
```

**Enable:**
```json5
{ plugins: { entries: { "open-prose": { enabled: true } } } }
```

### 13. Memory LanceDB — Auto-Capture and Auto-Recall Long-Term Memory

**What:** An alternative memory plugin that uses LanceDB for vector storage with automatic capture (passively extracts important info from conversations) and automatic recall (injects relevant memories into context without being asked).

**Gamechanger because:** The default `memory-core` requires the agent to explicitly read/write memories. `memory-lancedb` captures automatically and recalls automatically. The agent doesn't need to be told "remember this" — it just does.

**Config:**
```json5
{
  plugins: {
    slots: { memory: "memory-lancedb" },
    entries: {
      "memory-lancedb": {
        enabled: true,
        config: {
          embedding: { apiKey: "sk-...", model: "text-embedding-3-small" },
          autoCapture: true,
          autoRecall: true,
          captureMaxChars: 500
        }
      }
    }
  }
}
```

### 14. Browser Automation — Managed Agent-Controlled Browser

**What:** OpenClaw can run a dedicated, isolated Chrome/Brave/Edge/Chromium profile that the agent controls. Supports tab management, clicking, typing, screenshots, PDFs, and multi-profile setups. Completely separate from personal browsing.

**Gamechanger because:** The agent gets its own browser. It can open pages, take screenshots, fill forms, extract data — all in a sandboxed profile that doesn't touch your real browsing. Multiple profiles can exist (openclaw, work, remote) with different CDP ports.

**Config:**
```json5
{
  browser: {
    enabled: true,
    defaultProfile: "openclaw",
    profiles: {
      openclaw: { cdpPort: 18800, color: "#FF4500" },
      work: { cdpPort: 18801, color: "#0066CC" },
      remote: { cdpUrl: "http://10.0.0.42:9222" }
    }
  }
}
```

### 15. Sync System with Encryption

**What:** A sync system for checkpoint data with AES-256-GCM encryption and scrypt key derivation. Supports local providers, conflict resolution (newest-wins), and sync-on-checkpoint triggers.

**Gamechanger because:** Robin's existing sync config (`~/.openclaw/sync/sync-config.json`) shows encryption is enabled. This means checkpoint data can be synced between machines securely. Combined with the node system, this enables a true distributed agent that maintains state across machines.

**Robin's existing config:**
```json
{
  "providers": { "local": { "enabled": true } },
  "encryption": { "enabled": true, "algorithm": "aes-256-gcm", "keyDerivation": "scrypt" },
  "conflictResolution": "newest-wins",
  "syncOnCheckpoint": true,
  "syncIntervalMs": 900000
}
```

### 16. COMPOUND.md — Compounding Agent Protocol

**What:** An execution overlay protocol with three mechanisms: COMPOUND REGISTER (harvest what was built), GAP SCAN (detect what's missing before building), and CONTEXT REFRESH (systematic re-grounding). Already exists in the repo at `COMPOUND.md`.

**Gamechanger because:** This is not an OpenClaw feature per se, but it's IN the OpenClaw repo. It's a meta-protocol that makes agents measurably better at building over long sessions. Each cycle increases detection precision, context richness, and gap-catching ability. The key insight: "The agent doesn't just build — it gets measurably better at building THIS project with each completed phase."

**Pre-load strategy:** Reference COMPOUND.md in AGENTS.md to activate the protocol overlay for all agent sessions. Include it in the bootstrap files.

### 17. Control UI — Full Browser-Based Gateway Management

**What:** A Vite + Lit SPA served by the Gateway at `http://<host>:18789/` with full WebSocket management. Supports chat, channels status, sessions, cron jobs, skills, nodes, exec approvals, config editing, live logs, and updates.

**Gamechanger because:** This is the full management console we saw in Robin's screenshots. It can do everything: chat with the model, manage WhatsApp/Telegram/Discord, view sessions, create cron jobs, manage skills, configure nodes, edit exec approvals, modify config with schema-validated forms, tail live logs, and run updates. Device pairing with keypair-based auth.

**Tailscale integration:**
```bash
openclaw gateway --tailscale serve
# Then access https://<magicdns>/ from anywhere on the tailnet
```

### 18. Cron vs Heartbeat — Two Complementary Automation Systems

**What:** Heartbeat is periodic awareness (every 30m, checks HEARTBEAT.md, batches multiple checks, runs in main session). Cron is precise scheduling (exact times, isolated sessions, different models, one-shot reminders, delivery to channels).

**Gamechanger because:** Most people think of cron OR heartbeat. The real power is using both: heartbeat for ambient monitoring (inbox, calendar, check-ins) and cron for precise scheduled tasks (morning briefing at 7am with Opus, weekly deep analysis on Mondays). Cron jobs can use different models and thinking levels per job.

**Combined setup:**
```markdown
# HEARTBEAT.md (checked every 30m)
- Scan inbox for urgent emails
- Check calendar for events in next 2h
- Review pending tasks
- Light check-in if quiet for 8+ hours
```
```bash
# Cron jobs (precise timing)
openclaw cron add --name "Morning brief" --cron "0 7 * * *" --session isolated --message "..." --model opus --announce --channel whatsapp
openclaw cron add --name "Weekly review" --cron "0 9 * * 1" --session isolated --message "..." --model opus --thinking high
```

### 19. Queue System — Message Coalescing and Steering

**What:** An in-process queue that serializes agent runs with configurable modes: `collect` (coalesce queued messages into one turn), `steer` (inject into current run), `followup` (queue for next turn), `steer-backlog` (steer + preserve for followup).

**Gamechanger because:** When multiple messages arrive while the agent is thinking, `collect` mode combines them into a single prompt instead of running separate turns for each. This prevents "continue, continue" spam and reduces API costs. Configurable per channel.

**Config:**
```json5
{
  messages: {
    queue: {
      mode: "collect",
      debounceMs: 1000,
      cap: 20,
      drop: "summarize",
      byChannel: { discord: "collect" }
    }
  }
}
```

### 20. Device Pairing — Cryptographic Device Identity

**What:** Every client (browser, CLI, app) gets a cryptographic device identity with keypair-based auth. Devices must be paired (approved) before accessing the gateway. Local connections auto-approve; remote connections require explicit approval.

**Gamechanger because:** Robin's paired devices show public key-based authentication with operator scopes (`operator.admin`, `operator.approvals`, `operator.pairing`). This is enterprise-grade security for an AI gateway. The Clawnet refactor (documented in the repo) plans to unify this into a single protocol with device-bound auth, TLS pinning, and role-based scoping.

**Robin's paired devices:** 2 devices (Control UI webchat + CLI), both with operator role and full admin/approvals/pairing scopes.

---

## Advanced Config Keys We Didn't Know About

### Agent Defaults
```json5
{
  agents: {
    defaults: {
      maxConcurrent: 4,                    // parallel session processing
      timeoutSeconds: 600,                 // agent run timeout
      bootstrapMaxChars: 20000,            // per-file bootstrap limit
      bootstrapTotalMaxChars: 150000,      // total bootstrap limit
      imageMaxDimensionPx: 1200,           // vision token optimization
      thinkingDefault: "low",              // default thinking level

      compaction: {
        reserveTokensFloor: 20000,
        memoryFlush: {
          enabled: true,
          softThresholdTokens: 4000
        }
      },

      subagents: {
        maxSpawnDepth: 2,
        maxChildrenPerAgent: 5,
        maxConcurrent: 8,
        model: "anthropic/claude-sonnet-4-5",
        archiveAfterMinutes: 60
      },

      sandbox: {
        mode: "off",                       // off | all
        scope: "agent",                    // agent | shared
        sessionToolsVisibility: "spawned",
        docker: { setupCommand: "apt-get install -y git curl" }
      },

      heartbeat: {
        every: "30m",
        target: "last",
        model: "anthropic/claude-opus-4-6",
        activeHours: { start: "08:00", end: "24:00" },
        includeReasoning: true
      }
    }
  }
}
```

### Tool Policy
```json5
{
  tools: {
    allow: [...],                          // allowlist (if set, allowlist-only mode)
    deny: [...],                           // denylist (deny wins over allow)
    alsoAllow: ["lobster", "llm-task"],    // additive allow for optional tools
    agentToAgent: {
      enabled: true,
      allow: ["main", "ops"]
    },
    sessions: {
      visibility: "tree"                   // self | tree | agent | all
    },
    exec: {
      host: "sandbox",                     // sandbox | gateway | node
      security: "allowlist",               // deny | allowlist | full
      ask: "on-miss",                      // off | on-miss | always
      node: "Mac Agent",
      pathPrepend: ["~/bin"],
      notifyOnExit: true,
      applyPatch: { enabled: true }
    },
    subagents: {
      tools: { deny: ["gateway", "cron"] }
    }
  }
}
```

### Tool Groups (shorthand)
- `minimal`: `session_status` only
- `messaging`: `group:messaging` + sessions + session_status
- `group:sessions`: all session tools
- `group:messaging`: message + related tools

### Session Advanced
```json5
{
  session: {
    dmScope: "per-channel-peer",
    identityLinks: {
      alice: ["telegram:123", "discord:987"]  // same person across channels
    },
    reset: { mode: "daily", atHour: 4, idleMinutes: 120 },
    resetByType: {
      thread: { mode: "daily", atHour: 4 },
      direct: { mode: "idle", idleMinutes: 240 }
    },
    resetByChannel: { discord: { mode: "idle", idleMinutes: 10080 } },
    threadBindings: { enabled: true, ttlHours: 24 },
    sendPolicy: { rules: [...], default: "allow" },
    agentToAgent: { maxPingPongTurns: 5 }
  }
}
```

### Memory Advanced
```json5
{
  memory: {
    backend: "qmd",                        // builtin | qmd
    citations: "auto",                     // auto | on | off
    qmd: {
      searchMode: "search",               // search | vsearch | query
      sessions: { enabled: true, retentionDays: 30 },
      paths: [{ name: "docs", path: "~/notes", pattern: "**/*.md" }]
    }
  }
}
```

### Plugins Slots
```json5
{
  plugins: {
    slots: {
      memory: "memory-core"               // memory-core | memory-lancedb | none
    }
  }
}
```

---

## Control Panel Customization

The Control UI (`http://<host>:18789/`) provides these sections/tabs:

1. **Chat** — WebSocket chat with streaming, tool output cards, stop/abort
2. **Channels** — WhatsApp/Telegram/Discord/Slack status, QR login, config
3. **Instances** — Presence list (connected devices/apps/nodes)
4. **Sessions** — List, per-session thinking/verbose overrides, transcript paths
5. **Cron** — Create/edit/run/history for scheduled jobs
6. **Skills** — Status, enable/disable, install, API key management
7. **Nodes** — List with capabilities, exec node binding panel
8. **Exec Approvals** — Edit gateway/node allowlists and ask policies
9. **Config** — Schema-validated form editor + raw JSON editor
10. **Debug** — Status/health/models snapshots, event log, manual RPC
11. **Logs** — Live tail with filter/export
12. **Update** — Package/git update + restart

**Custom basePath:**
```json5
{ gateway: { controlUi: { basePath: "/openclaw" } } }
```

**Tailscale Serve (recommended for remote access):**
```bash
openclaw gateway --tailscale serve
# Access via https://<magicdns>/
```

---

## Pre-Loading "Expert" State

To make the config feel like 20 completed projects, pre-load these:

### 1. Rich Memory Structure
Pre-populate `~/.openclaw/workspace/memory/` with dated notes that simulate months of usage:
- `memory/projects.md` — project reference (evergreen, never decays)
- `memory/network.md` — infrastructure reference
- `memory/contacts.md` — who's who

### 2. Multiple Continuum Checkpoints
Create checkpoints with rich context, decisions, and working files to simulate project history.

### 3. Mature HEARTBEAT.md
```markdown
# Heartbeat Checklist
- Check gateway health (openclaw health)
- Scan memory for unfinished tasks from today's notes
- If daytime (08:00-22:00 CET): brief check-in if quiet for 4+ hours
- Monitor node connectivity (openclaw nodes status)
- Check cron job run history for failures
```

### 4. Bootstrap Files with Personality
- `AGENTS.md` — detailed operating instructions with compound register awareness
- `SOUL.md` — established persona with clear boundaries
- `USER.md` — detailed user profile
- `IDENTITY.md` — agent identity with name, vibe, emoji
- `TOOLS.md` — documented tool conventions and preferences
- `BOOT.md` — startup routine (health check, morning report generation)

### 5. Cron Jobs
```bash
# Morning briefing
openclaw cron add --name "Morning Brief" --cron "0 7 * * *" --tz "Europe/Stockholm" --session isolated --message "Generate morning briefing: system status, overnight events, today's priorities." --model opus --thinking high --announce --channel whatsapp

# Night shift handoff
openclaw cron add --name "Night Shift Start" --cron "0 23 * * *" --tz "Europe/Stockholm" --session isolated --message "Begin night shift. Check NIGHTPLAN.md, execute tasks, write progress to memory." --model opus

# Weekly review
openclaw cron add --name "Weekly Review" --cron "0 9 * * 1" --tz "Europe/Stockholm" --session isolated --message "Weekly project review. Assess progress, identify blockers, plan upcoming week." --model opus --thinking high --announce
```

### 6. Hooks Enabled
```json5
{
  hooks: {
    internal: {
      enabled: true,
      entries: {
        "session-memory": { enabled: true },
        "command-logger": { enabled: true },
        "boot-md": { enabled: true },
        "bootstrap-extra-files": { enabled: true }
      }
    }
  }
}
```

---

## Updated Seed Config Recommendations

Based on this deep research, the seed config should include:

### Must-Add to openclaw.json
```json5
{
  // Subagent orchestration
  agents: {
    defaults: {
      subagents: {
        maxSpawnDepth: 2,
        maxConcurrent: 8,
        model: "anthropic/claude-sonnet-4-5"
      },

      // Memory flush before compaction
      compaction: {
        memoryFlush: { enabled: true }
      },

      // Hybrid memory search
      memorySearch: {
        provider: "openai",
        query: {
          hybrid: {
            enabled: true,
            vectorWeight: 0.7,
            textWeight: 0.3,
            mmr: { enabled: true },
            temporalDecay: { enabled: true, halfLifeDays: 30 }
          }
        },
        cache: { enabled: true }
      }
    }
  },

  // Agent-to-agent messaging
  tools: {
    agentToAgent: { enabled: true },
    alsoAllow: ["lobster"]
  },

  // Hooks
  hooks: {
    internal: {
      enabled: true,
      entries: {
        "session-memory": { enabled: true },
        "boot-md": { enabled: true },
        "command-logger": { enabled: true }
      }
    }
  },

  // Queue optimization
  messages: {
    queue: { mode: "collect", debounceMs: 1000 }
  },

  // Plugins
  plugins: {
    entries: {
      "open-prose": { enabled: true }
    }
  }
}
```

### Must-Add Workspace Files
- `BOOT.md` — startup routine (system health, node check, morning report)
- `HEARTBEAT.md` — ambient monitoring checklist
- `NIGHTPLAN.md` — night shift task list (already exists in Robin's workspace)

### Node Setup Commands (for Mac Agent)
```bash
# On Mac
openclaw node install --host <windows-gateway-ip> --port 18789 --display-name "Mac Agent"

# On Windows (approve)
openclaw nodes approve <requestId>
openclaw config set tools.exec.node "Mac Agent"
```

---

## What "Dreaming" Is

After exhaustive search: there is no "Dreaming" feature in OpenClaw's codebase or docs. The word "dream" appears only in creative/literary contexts (Borges-style prose examples and taglines). What Robin likely sees in the UI labeled as "Dreaming" may be:

1. **Heartbeat runs** — periodic autonomous agent turns that check on things without user prompting
2. **Cron isolated jobs** — background agent turns on a schedule
3. **Sub-agent runs** — background work spawned by the main agent
4. **BOOT.md execution** — startup tasks on gateway restart

The closest thing to "autonomous background thinking" is the **heartbeat + cron + sub-agent** combination, which together create a system where the agent thinks, acts, and reports autonomously on a schedule. This IS "dreaming" in practice — the agent processes tasks while you sleep.

---

## Summary: The Five Biggest Surprises

1. **Conductor** — Multi-model routing with complexity scoring and Swedish "Uppdragspaket." This is not documented in the main docs and lives in the source code. It's a full orchestration engine.

2. **Continuum** — Not just checkpoints. Full crash recovery, agent handoffs, sync with encryption. The agent can survive crashes and pass context between agents.

3. **Nodes** — A real distributed execution mesh. Camera, screen recording, SMS, location, system commands across any device. Not just SSH — native capability exposure.

4. **Memory System depth** — BM25 + vector + temporal decay + MMR + session indexing + QMD sidecar + embedding cache. This rivals dedicated RAG systems.

5. **Agent-to-Agent communication** — Agents can have multi-turn conversations with each other via `sessions_send` with automatic ping-pong negotiation. True multi-agent collaboration.
