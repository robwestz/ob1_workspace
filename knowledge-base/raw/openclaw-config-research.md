# OpenClaw Configuration Research

> Research date: 2026-04-05
> Source: Local `~/.openclaw/` directory + `C:\Users\robin\Downloads\openclaw\docs\` + `AGENTS.md`
> Purpose: Understand every config file so we can pre-build a fully-configured instance

---

## ~/.openclaw/ Directory Structure (Complete Map)

```
~/.openclaw/
├── openclaw.json              # Main config (JSON5) -- THE central config file
├── openclaw.json.bak          # Auto-backup of previous config (up to .bak.3)
├── gateway.cmd                # Windows gateway launcher script (auto-generated)
├── exec-approvals.json        # Exec approval socket config + per-agent defaults
├── update-check.json          # Last update check timestamp + notified version
│
├── identity/
│   ├── device.json            # This device's identity (deviceId, Ed25519 keypair, createdAt)
│   └── device-auth.json       # Device auth credentials (tokens, secrets)
│
├── agents/
│   └── main/                  # Agent "main" (default agent)
│       ├── agent/
│       │   ├── auth.json      # Per-provider auth credentials (API keys, OAuth tokens)
│       │   └── auth-profiles.json  # Auth profile registry (profiles, lastGood, usageStats)
│       └── sessions/
│           ├── sessions.json  # Session store (map of sessionKey -> metadata)
│           ├── *.jsonl        # Session transcripts (one per session)
│           └── *.jsonl.deleted.*  # Soft-deleted sessions with timestamp
│
├── credentials/
│   └── whatsapp/              # WhatsApp Baileys auth state (per-account)
│
├── skills/                    # Managed/local skills (symlinks or directories)
│   ├── agent-evaluation -> ~/.agents/skills/agent-evaluation
│   ├── agentic-workflow-orchestration -> ...
│   ├── asyncreview -> ...
│   ├── find-skills -> ...
│   └── harness-engineering -> ...
│
├── workspace/                 # Agent workspace (git repo, bootstrapped)
│   ├── .git/                  # Git-tracked workspace
│   ├── .openclaw/
│   │   └── workspace-state.json  # Bootstrap tracking (version, bootstrapSeededAt)
│   ├── .pi/                   # Legacy pi directory (empty)
│   ├── AGENTS.md              # Operating instructions (loaded every session)
│   ├── SOUL.md                # Persona and tone (loaded every session)
│   ├── USER.md                # User profile (loaded every session)
│   ├── IDENTITY.md            # Agent name/vibe/emoji (loaded every session)
│   ├── TOOLS.md               # Local tool notes (loaded every session)
│   ├── HEARTBEAT.md           # Heartbeat checklist (loaded on heartbeat runs)
│   ├── BOOTSTRAP.md           # One-time first-run ritual (should be deleted after)
│   ├── MEMORY.md              # Curated long-term memory (loaded in main session only)
│   ├── NIGHTPLAN.md           # Custom planning doc
│   ├── onboarding-prompt.md   # Onboarding prompt
│   ├── memory/
│   │   ├── 2026-01-31.md      # Daily memory log
│   │   └── 2026-02-05.md      # Daily memory log
│   ├── curated-modules/       # User project files
│   ├── planner/               # Planning files
│   └── projects/              # Project workspace files
│
├── gateway/
│   └── schedules.json         # Gateway scheduled tasks (cron-like entries)
│
├── cron/
│   ├── jobs.json              # Cron job registry {"version":1,"jobs":[]}
│   └── jobs.json.bak          # Backup
│
├── devices/
│   ├── paired.json            # Paired device registry (deviceId, publicKey, roles, scopes, tokens)
│   ├── paired.json.*.tmp      # Atomic write temp files
│   └── pending.json           # Pending pairing requests (currently [])
│
├── subagents/
│   └── runs.json              # Subagent run registry {"version":2,"runs":{}}
│
├── continuum/
│   └── checkpoints/
│       ├── manifest.json      # Checkpoint registry (id, label, trigger, path)
│       └── cp_<timestamp>_<id>/
│           ├── state.json     # Full checkpoint state (context, model, tasks, decisions)
│           ├── context.json   # Context snapshot (cwd, model, channel)
│           ├── memory.json    # Memory snapshot (insights, projectNotes)
│           └── tasks.json     # Task list at checkpoint time
│
├── sync/
│   ├── sync-config.json       # Sync configuration (providers, encryption, conflict resolution)
│   ├── manifest.json          # Sync manifest (lastSyncAt, items, providerStates)
│   ├── data/                  # Sync data store (empty)
│   └── staging/               # Sync staging area (empty)
│
├── media/
│   └── inbound/               # Inbound media attachments from channels
│       └── *.jpg              # Received images
│
├── canvas/
│   └── index.html             # Canvas UI host page (for node displays)
│
├── completions/               # Shell completions (auto-generated)
│   ├── openclaw.bash
│   ├── openclaw.fish
│   ├── openclaw.ps1
│   └── openclaw.zsh
│
└── (not present but documented)
    ├── .env                   # Global env vars (not overriding existing)
    ├── hooks/                 # Managed hooks directory
    ├── sandboxes/             # Sandbox workspaces (when sandbox enabled)
    ├── tools/                 # Downloaded tool binaries from skill installers
    └── logs/                  # Command logs (when command-logger hook enabled)
```

---

## openclaw.json -- Main Config

**Location:** `~/.openclaw/openclaw.json`
**Format:** JSON5 (comments + trailing commas allowed)
**Behavior:** Gateway watches this file and hot-reloads most changes. Strict validation -- unknown keys cause startup failure.

### Top-Level Structure

```json5
{
  meta: {},           // Internal metadata (version tracking)
  wizard: {},         // Onboarding wizard state
  auth: {},           // Auth profile references
  agents: {},         // Agent configuration (models, workspace, heartbeat, sandbox)
  messages: {},       // Message handling config
  commands: {},       // Chat command config
  hooks: {},          // Hook system config
  channels: {},       // Per-channel configuration (whatsapp, telegram, discord, etc.)
  gateway: {},        // Gateway server config (port, bind, auth, tailscale)
  skills: {},         // Skill management
  plugins: {},        // Plugin management
  session: {},        // Session management
  cron: {},           // Cron job config
  tools: {},          // Tool configuration (browser, exec, sandbox)
  env: {},            // Environment variable injection
  bindings: [],       // Multi-agent routing bindings
  web: {},            // WhatsApp web (Baileys) config
  ui: {},             // UI configuration
  logging: {},        // Logging configuration
  identity: {},       // Identity configuration
  discovery: {},      // Service discovery
  canvasHost: {},     // Canvas host config
  broadcast: {},      // Broadcast group config
  memory: {},         // Memory backend config (builtin vs qmd)
}
```

### Current Config (Robin's)

Key settings from the live `openclaw.json`:

| Key | Value | Purpose |
|-----|-------|---------|
| `meta.lastTouchedVersion` | `"2026.1.29"` | Last OpenClaw version that touched config |
| `meta.lastTouchedAt` | `"2026-01-31T17:59:20.397Z"` | When config was last modified |
| `wizard.lastRunAt` | `"2026-01-31T17:55:03.564Z"` | When onboarding wizard last ran |
| `wizard.lastRunVersion` | `"2026.1.29"` | Version used for onboarding |
| `wizard.lastRunCommand` | `"onboard"` | Last wizard command |
| `wizard.lastRunMode` | `"local"` | Gateway mode during onboard |
| `auth.profiles` | anthropic:robincamjo (token), openai-codex:default (oauth) | Auth profile definitions |
| `agents.defaults.model.primary` | `"anthropic/claude-opus-4-5"` | Default model |
| `agents.defaults.workspace` | `"C:\\Users\\robin\\.openclaw\\workspace"` | Workspace path |
| `agents.defaults.contextPruning.mode` | `"cache-ttl"` | Context pruning enabled |
| `agents.defaults.compaction.mode` | `"safeguard"` | Compaction mode |
| `agents.defaults.heartbeat.every` | `"30m"` | Heartbeat interval |
| `agents.defaults.maxConcurrent` | `4` | Max concurrent agent runs |
| `agents.defaults.subagents.maxConcurrent` | `8` | Max concurrent subagents |
| `messages.ackReactionScope` | `"group-mentions"` | When to send ack reactions |
| `channels.whatsapp.dmPolicy` | `"allowlist"` | WhatsApp DM policy |
| `channels.whatsapp.selfChatMode` | `true` | Self-chat enabled |
| `channels.whatsapp.allowFrom` | `["+46738124230"]` | Allowed WhatsApp numbers |
| `gateway.port` | `18789` | Gateway port |
| `gateway.mode` | `"local"` | Local gateway mode |
| `gateway.bind` | `"loopback"` | Bind to localhost |
| `gateway.auth.mode` | `"token"` | Token auth for gateway |
| `gateway.tailscale.mode` | `"off"` | Tailscale disabled |
| `hooks.internal.enabled` | `true` | Internal hooks enabled |
| `hooks.internal.entries` | boot-md, command-logger, session-memory | Active hooks |
| `skills.entries` | openai-image-gen, openai-whisper-api (with API keys) | Skill API key config |
| `plugins.entries.whatsapp.enabled` | `true` | WhatsApp plugin enabled |

---

## Identity System

### device.json (`~/.openclaw/identity/device.json`)
**Purpose:** Unique device identity for this OpenClaw installation.

```json
{
  "version": 1,
  "deviceId": "<64-char hex hash>",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
  "privateKeyPem": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "createdAtMs": 1769879754905   // Unix timestamp in milliseconds
}
```

**Key facts:**
- Ed25519 keypair (30-byte keys in PEM format)
- `deviceId` is a 64-char hex SHA-256 hash (likely of the public key)
- `createdAtMs` = device creation time (Jan 31, 2026 for Robin's)
- Used for device pairing, gateway auth, and crypto operations

### device-auth.json (`~/.openclaw/identity/device-auth.json`)
**Purpose:** Device authentication credentials. EXISTS but contains secrets -- do not read.

### Agent Identity (workspace files)

Identity is defined in workspace markdown files, NOT in structured config:

- **IDENTITY.md** -- Agent name, creature type, vibe, emoji, avatar path
- **SOUL.md** -- Persona, tone, boundaries, behavior guidelines
- **USER.md** -- User profile (name, location, timezone, preferences)

Per-agent identity can also be set in config:
```json5
{
  agents: {
    list: [{
      id: "main",
      identity: {
        name: "Samantha",
        theme: "helpful sloth",
        emoji: "\ud83e\udda5",
        avatar: "avatars/samantha.png"
      }
    }]
  }
}
```

---

## Agent System

### Agent Directory Structure
```
~/.openclaw/agents/<agentId>/
├── agent/
│   ├── auth.json           # Per-provider credentials for this agent
│   └── auth-profiles.json  # Full auth profile registry
└── sessions/
    ├── sessions.json       # Session store (key -> metadata map)
    └── <sessionId>.jsonl   # Individual session transcripts
```

### auth.json
Maps provider names to credential objects:
```json
{
  "<provider>": {
    "type": "api_key" | "oauth",
    "key": "...",                    // for api_key type
    "access": "...",                 // for oauth type (JWT)
    "refresh": "...",                // for oauth type
    "expires": 1770745880040         // unix ms for oauth
  }
}
```

### auth-profiles.json
Extended registry with usage tracking:
```json
{
  "version": 1,
  "profiles": {
    "<provider>:<profileName>": {
      "type": "token" | "oauth",
      "provider": "<provider>",
      "token": "...",
      "accountId": "..."             // for oauth
    }
  },
  "lastGood": {
    "<provider>": "<provider>:<profileName>"
  },
  "usageStats": {
    "<provider>:<profileName>": {
      "lastUsed": <unix_ms>,
      "errorCount": 0,
      "lastFailureAt": <unix_ms>
    }
  }
}
```

### sessions.json
Map of session keys to metadata:
```json
{
  "agent:<agentId>:<mainKey>": {
    "sessionId": "<uuid>",
    "updatedAt": <unix_ms>,
    "systemSent": true,
    "abortedLastRun": false,
    "chatType": "direct" | "group",
    "deliveryContext": { "channel": "webchat" | "whatsapp" | ... },
    "lastChannel": "webchat",
    "origin": {
      "provider": "webchat",
      "surface": "webchat",
      "chatType": "direct"
    },
    "sessionFile": "<full_path>.jsonl",
    "compactionCount": 0,
    "skillsSnapshot": { ... },       // Large object with resolved skills
    "authProfileOverride": "anthropic:robincamjo",
    "modelProvider": "anthropic",
    "model": "claude-opus-4-5",
    "contextTokens": 200000,
    "systemPromptReport": { ... }    // Detailed system prompt breakdown
  }
}
```

### Session key formats:
- Direct: `agent:<agentId>:main` (default) or scoped variants
- Group: `agent:<agentId>:<channel>:group:<groupId>`
- Cron: `cron:<jobId>`
- Hook: `hook:<uuid>`
- Node: `node-<nodeId>`

---

## Skills System

### Three skill locations (precedence order):
1. **Workspace skills:** `<workspace>/skills/` (highest)
2. **Managed/local skills:** `~/.openclaw/skills/` (middle)
3. **Bundled skills:** shipped with OpenClaw install (lowest)

### Managed skills (`~/.openclaw/skills/`)
Can be directories or symlinks. Robin's are symlinks to `~/.agents/skills/`:
- `agent-evaluation`
- `agentic-workflow-orchestration`
- `asyncreview`
- `find-skills`
- `harness-engineering`

### Skill format
Each skill is a directory with `SKILL.md` containing YAML frontmatter:
```yaml
---
name: skill-name
description: What this skill does
metadata: {"openclaw": {"requires": {"bins": ["tool"], "env": ["API_KEY"]}, "primaryEnv": "API_KEY"}}
---
Instructions for the agent...
```

### Config overrides (`openclaw.json`)
```json5
{
  skills: {
    install: { nodeManager: "npm" },  // npm/pnpm/yarn/bun for skill deps
    entries: {
      "skill-name": {
        enabled: true,
        apiKey: "...",                // maps to primaryEnv
        env: { VAR: "value" },       // injected during agent run
        config: { ... }              // custom per-skill config
      }
    },
    load: {
      watch: true,                   // auto-refresh on SKILL.md changes
      watchDebounceMs: 250,
      extraDirs: ["/path/to/skills"] // additional skill directories
    },
    allowBundled: ["skill1", "skill2"]  // allowlist for bundled skills
  }
}
```

### ClawHub
Public skill registry at https://clawhub.com. Install via `clawhub install <slug>`.

---

## Gateway & Channels

### Gateway Config
```json5
{
  gateway: {
    port: 18789,                    // default
    mode: "local",                  // local | remote
    bind: "loopback",              // loopback | 0.0.0.0
    auth: {
      mode: "token",               // token | none
      token: "<48-char hex>"        // gateway access token
    },
    tailscale: {
      mode: "off",                  // off | funnel | serve
      resetOnExit: false
    },
    reload: {
      mode: "hybrid",              // hybrid | hot | restart | off
      debounceMs: 300
    },
    remote: { ... }                 // remote gateway settings
  }
}
```

### gateway.cmd (Windows launcher)
Auto-generated batch file with:
- Full PATH
- `OPENCLAW_GATEWAY_PORT`
- `OPENCLAW_GATEWAY_TOKEN`
- `OPENCLAW_SERVICE_VERSION`
- Launches `node <openclaw_dist>/index.js gateway --port 18789`

### Channel Config Pattern
All channels follow the same DM/group policy pattern:
```json5
{
  channels: {
    "<provider>": {
      enabled: true,
      dmPolicy: "pairing",         // pairing | allowlist | open | disabled
      allowFrom: [...],            // sender allowlist
      groupPolicy: "allowlist",    // allowlist | open | disabled
      groupAllowFrom: [...],       // group allowlist
      groups: { "*": { requireMention: true } },
      mediaMaxMb: 50,
      textChunkLimit: 4000,
      chunkMode: "length",         // length | newline
      historyLimit: 50,
      streaming: "off",            // off | partial | block | progress
    }
  }
}
```

### Supported Channels
- **WhatsApp** (via Baileys web): `channels.whatsapp` + `web` section
- **Telegram**: `channels.telegram` (botToken required)
- **Discord**: `channels.discord` (token required)
- **Slack**: `channels.slack` (botToken + appToken for socket mode)
- **Signal**: `channels.signal`
- **iMessage**: `channels.imessage` (macOS only, requires Full Disk Access)
- **Google Chat**: `channels.googlechat` (service account)
- **Mattermost**: `channels.mattermost` (plugin)
- **Matrix**: plugin
- **MS Teams**: plugin
- **IRC, Line, Nostr, Twitch, Zalo**: various plugins/extensions

### Schedules (`~/.openclaw/gateway/schedules.json`)
Gateway-level scheduled tasks:
```json
{
  "sched-<8char_hex>": {
    "id": "sched-<8char_hex>",
    "name": "task-name",
    "cron": "0 * * * *",
    "command": "echo ping",
    "enabled": true
  }
}
```

---

## Memory & Persistence

### Memory Architecture
OpenClaw memory is **plain Markdown** in the workspace:

1. **Daily logs:** `workspace/memory/YYYY-MM-DD.md` (append-only, one per day)
2. **Long-term memory:** `workspace/MEMORY.md` (curated, loaded in main session only)
3. **Vector index:** Auto-built over memory files for semantic search

### Memory Tools (agent-facing)
- `memory_search` -- semantic recall over indexed snippets
- `memory_get` -- targeted read of specific memory file/line range

### Memory Config
```json5
{
  agents: {
    defaults: {
      compaction: {
        mode: "safeguard",
        reserveTokensFloor: 20000,
        memoryFlush: {
          enabled: true,
          softThresholdTokens: 4000,
          systemPrompt: "Session nearing compaction...",
          prompt: "Write any lasting notes..."
        }
      },
      memorySearch: {
        provider: "openai" | "gemini" | "voyage" | "local",
        // auto-selected based on available API keys
      }
    }
  },
  memory: {
    backend: "builtin" | "qmd",   // QMD = local BM25+vector sidecar
    qmd: { ... }
  }
}
```

### Continuum (Checkpoints)
Manual or automatic snapshots of agent state:

**manifest.json:**
```json
{
  "version": 1,
  "updatedAt": "2026-02-05T00:55:05.067Z",
  "checkpoints": {
    "<checkpoint_id>": {
      "id": "cp_<timestamp>_<random>",
      "createdAt": "<ISO date>",
      "label": "Human-readable description",
      "agentId": "main",
      "sessionId": "manual_<timestamp>",
      "trigger": "manual",
      "path": "<checkpoint_id>"
    }
  },
  "latestCheckpointId": "<checkpoint_id>"
}
```

**Per-checkpoint files:**
- `state.json` -- Full state (context, tasks, memory, decisions, working files, stateHash)
- `context.json` -- Context snapshot (cwd, model, channel)
- `memory.json` -- Memory snapshot (insights, projectNotes)
- `tasks.json` -- Task list

### Sync System
Cross-device sync (currently local-only):

**sync-config.json:**
```json
{
  "providers": { "local": { "enabled": true } },
  "encryption": {
    "enabled": true,
    "algorithm": "aes-256-gcm",
    "keyDerivation": "scrypt"
  },
  "conflictResolution": "newest-wins",
  "syncOnCheckpoint": true,
  "syncIntervalMs": 900000
}
```

---

## MCP Integration

OpenClaw does not use MCP in the traditional sense (no `claude_desktop_config.json`). Instead:
- Tools are provided via the embedded agent runtime (pi-mono derived)
- Skills teach the agent how to use tools
- Plugins can extend tool surfaces
- The gateway exposes an RPC interface for programmatic access

Built-in tools (from sessions.json systemPromptReport):
- `read`, `edit`, `write` -- File operations
- `exec`, `process` -- Shell execution
- `browser` -- Web browser control
- `canvas` -- Canvas UI rendering
- `nodes` -- Node (remote machine) operations
- `message` -- Send messages to channels
- `tts` -- Text-to-speech
- `agents_list`, `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`
- `subagents` -- Subagent management
- `session_status` -- Session info
- `web_search`, `web_fetch` -- Web access
- `image` -- Image generation/processing
- `memory_search`, `memory_get` -- Memory access

---

## Hooks & Automation

### Hook System
Hooks fire on agent events (`/new`, `/reset`, `/stop`, lifecycle events).

**Discovery locations (precedence):**
1. `<workspace>/hooks/` (per-agent)
2. `~/.openclaw/hooks/` (managed)
3. `<openclaw>/dist/hooks/bundled/` (shipped)

**Hook format:**
```
my-hook/
├── HOOK.md          # Metadata + documentation
└── handler.ts       # TypeScript handler implementation
```

**Bundled hooks:**
- `session-memory` -- Save context to `workspace/memory/` on `/new`
- `bootstrap-extra-files` -- Inject additional workspace files during bootstrap
- `command-logger` -- Log commands to `~/.openclaw/logs/commands.log`
- `boot-md` -- Run `BOOT.md` on gateway start

### Config
```json5
{
  hooks: {
    enabled: true,
    token: "shared-secret",
    path: "/hooks",
    internal: {
      enabled: true,
      entries: {
        "boot-md": { enabled: true },
        "command-logger": { enabled: true },
        "session-memory": { enabled: true }
      }
    },
    mappings: [
      { match: { path: "gmail" }, action: "agent", agentId: "main", deliver: true }
    ]
  }
}
```

### Cron Jobs
```json5
{
  cron: {
    enabled: true,
    maxConcurrentRuns: 2,
    sessionRetention: "24h"
  }
}
```

**cron/jobs.json:**
```json
{ "version": 1, "jobs": [] }
```

Jobs are managed via CLI: `openclaw cron add/list/remove/run`.

---

## Auth System

### Auth Profile Structure
Profiles stored in both `openclaw.json` (reference) and `agents/<id>/agent/auth-profiles.json` (credentials).

**Profile naming:** `<provider>:<profileName>` (e.g., `anthropic:robincamjo`, `openai-codex:default`)

**Supported auth types:**
- `token` / `api_key` -- Direct API key
- `oauth` -- OAuth2 with access/refresh tokens

**Provider auth resolution order:**
1. `OPENCLAW_LIVE_<PROVIDER>_KEY` (override)
2. `<PROVIDER>_API_KEYS` (comma-separated)
3. `<PROVIDER>_API_KEY` (single)
4. `<PROVIDER>_API_KEY_*` (glob)
5. Auth profiles from `auth-profiles.json`

**OAuth token flow:**
- Access tokens have expiry timestamps
- Refresh tokens are used to renew
- `usageStats` tracks lastUsed and errorCount per profile

### Device Pairing
`~/.openclaw/devices/paired.json` tracks paired devices:
```json
{
  "<deviceId>": {
    "deviceId": "<64-char hex>",
    "publicKey": "<base64url>",
    "platform": "Win32" | "win32" | "darwin" | "linux",
    "clientId": "openclaw-control-ui" | "cli",
    "clientMode": "webchat" | "cli",
    "role": "operator",
    "roles": ["operator"],
    "scopes": ["operator.admin", "operator.approvals", "operator.pairing"],
    "tokens": {
      "operator": {
        "token": "<32-char hex>",
        "role": "operator",
        "scopes": [...],
        "createdAtMs": <unix_ms>,
        "lastUsedAtMs": <unix_ms>
      }
    },
    "createdAtMs": <unix_ms>,
    "approvedAtMs": <unix_ms>
  }
}
```

### Exec Approvals
```json
{
  "version": 1,
  "socket": {
    "path": "~/.openclaw/exec-approvals.sock",
    "token": "<32-char alphanumeric>"
  },
  "defaults": {},
  "agents": {}
}
```

---

## What We Need to Pre-Build (10-Month-Old Config)

To make a config that looks like it's been running since ~June 2025, we need to create/populate these files:

### 1. `~/.openclaw/openclaw.json` (CRITICAL)
- Set `meta.lastTouchedVersion` to a plausible version from 10 months ago
- Set `meta.lastTouchedAt` to a date ~10 months ago
- Set `wizard.lastRunAt` earlier than meta
- Configure all desired channels, models, heartbeat, hooks
- Include auth profile references
- Include skill entries with API keys

### 2. `~/.openclaw/identity/device.json` (CRITICAL)
- Generate new Ed25519 keypair
- Set `createdAtMs` to ~10 months ago
- Generate deterministic `deviceId` from public key

### 3. `~/.openclaw/identity/device-auth.json`
- Device-level auth tokens

### 4. `~/.openclaw/agents/main/agent/auth.json` (CRITICAL)
- Provider credentials (API keys, OAuth tokens)
- Must have valid credentials for desired providers

### 5. `~/.openclaw/agents/main/agent/auth-profiles.json` (CRITICAL)
- Full profile registry with realistic `usageStats`
- `lastUsed` timestamps spread over 10 months
- Low `errorCount` values
- Plausible `lastGood` entries

### 6. `~/.openclaw/agents/main/sessions/sessions.json`
- Session metadata with realistic timestamps
- `origin` metadata for each session
- `compactionCount` > 0 for long-running sessions
- Multiple session keys (main, group chats, etc.)

### 7. `~/.openclaw/workspace/` (CRITICAL)
- All bootstrap files filled in (not templates):
  - `AGENTS.md` -- customized operating instructions
  - `SOUL.md` -- developed persona
  - `IDENTITY.md` -- filled in with name, vibe, emoji
  - `USER.md` -- complete user profile
  - `TOOLS.md` -- populated with actual tool notes
  - `HEARTBEAT.md` -- active checklist or empty (normal)
  - NO `BOOTSTRAP.md` (deleted after first run = sign of maturity)
  - `MEMORY.md` -- extensive curated memory (10 months worth)
- `memory/` directory with many daily log files spanning months
- `.openclaw/workspace-state.json` with old `bootstrapSeededAt`
- Git history with commits spanning months

### 8. `~/.openclaw/devices/paired.json`
- At least one paired device with old `createdAtMs`
- `lastUsedAtMs` recent (shows active use)

### 9. `~/.openclaw/gateway/schedules.json`
- A few meaningful scheduled tasks (not test entries)

### 10. `~/.openclaw/cron/jobs.json`
- Active cron jobs (or empty = also normal)

### 11. `~/.openclaw/continuum/checkpoints/`
- Multiple checkpoints spanning months
- Manifest with realistic labels and timestamps

### 12. `~/.openclaw/credentials/whatsapp/`
- Only needed if WhatsApp is configured (requires actual Baileys auth)

### 13. `~/.openclaw/exec-approvals.json`
- Standard structure with socket path and token

### 14. `~/.openclaw/subagents/runs.json`
- Empty or with some historical runs

### 15. `~/.openclaw/sync/`
- `sync-config.json` with local provider
- `manifest.json` with old `lastSyncAt`

### 16. `~/.openclaw/update-check.json`
- Recent `lastCheckedAt`
- Plausible `lastNotifiedVersion`

### 17. `~/.openclaw/completions/`
- Auto-generated, not needed to pre-build

### 18. `~/.openclaw/skills/`
- Symlinks or directories for desired managed skills

### Signs of Maturity (What a 10-Month-Old Config Would Have):
- `BOOTSTRAP.md` deleted (not present)
- `IDENTITY.md` fully filled in with personality
- `SOUL.md` evolved beyond the default template
- `MEMORY.md` extensive (5000+ chars) with dated entries
- Multiple `memory/YYYY-MM-DD.md` files (not daily, but periodic)
- `auth-profiles.json` with high `lastUsed` timestamps and low error counts
- `sessions.json` with `compactionCount > 0` on main session
- Multiple continuum checkpoints with meaningful labels
- `openclaw.json.bak` files present (shows config evolution)
- `update-check.json` with recent check times
- At least 2 paired devices
- Custom tools noted in `TOOLS.md`
- Heartbeat state tracked in `memory/heartbeat-state.json`
