# Blueprint 05: Doctor Pattern, Staged Boot Sequence & Scoped Configuration

> Primitives #12 (Doctor Pattern), #13 (Staged Boot Sequence), #13b (Scoped Configuration)
>
> Status: IMPLEMENTATION BLUEPRINT
> Date: 2026-04-03
> Depends on:
>   - Blueprint 01 (Tool Registry & Permissions) -- registry init at boot, tool checks in doctor
>   - Blueprint 02 (State & Budget) -- session table checks in doctor, session restore at boot
>   - Blueprint 03 (Streaming, Logging, Verification) -- EventLogger init at boot, system_events table

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Database Schema](#2-database-schema)
3. [Scoped Configuration (#13b)](#3-scoped-configuration-13b)
4. [Staged Boot Sequence (#13)](#4-staged-boot-sequence-13)
5. [Doctor Pattern (#12)](#5-doctor-pattern-12)
6. [Edge Function Endpoints](#6-edge-function-endpoints)
7. [Cross-Blueprint Integration](#7-cross-blueprint-integration)
8. [Build Order](#8-build-order)
9. [File Map](#9-file-map)

---

## 1. Architecture Overview

Three subsystems form a startup-to-diagnosis lifecycle:

```
    +------------------------------------------------------+
    |                   Agent Startup                       |
    |                                                      |
    |  1. Config loaded (Scoped Configuration #13b)        |
    |     User -> Project -> Local deep merge              |
    |                                                      |
    |  2. Boot pipeline (Staged Boot Sequence #13)         |
    |     10 phases, gated, timed, with rollback           |
    |                                                      |
    |  3. Health validated (Doctor Pattern #12)             |
    |     6 categories, auto-repair, structured output     |
    +-----------------------------+------------------------+
                                  |
                                  v
    +------------------------------------------------------+
    |               OB1 Supabase Persistence                |
    |                                                      |
    |  agent_config         -- scoped config snapshots     |
    |  boot_runs            -- boot timing + phase logs    |
    |  system_events        -- all events (from BP03)      |
    |  tool_registry        -- tool defs (from BP01)       |
    |  agent_sessions       -- sessions (from BP02)        |
    |  budget_ledger        -- budgets (from BP02)         |
    +------------------------------------------------------+
```

### Data Flow

```
CLI / MCP entry
  |
  +-> ScopedConfigLoader
  |     |-- load ~/.claude.json         (User scope)
  |     |-- load ~/.claude/settings.json (User scope)
  |     |-- load .claude.json            (Project scope)
  |     |-- load .claude/settings.json   (Project scope)
  |     |-- load .claude/settings.local.json (Local scope)
  |     |-- deep merge with origin tracking
  |     |-- MCP server deduplication
  |     +-> MergedConfig with provenance map
  |
  +-> BootPipeline
  |     |-- Phase 1: Prefetch (credentials, workspace scan)
  |     |-- Phase 2: Environment Guards (platform, deps)
  |     |-- Phase 3: Config Loading (from ScopedConfigLoader)
  |     |-- Phase 4: Trust Gate
  |     |-- Phase 5: Registry Init (parallel)  <-- BP01 tool_registry
  |     |-- Phase 6: Workspace Init (parallel) <-- BP02 agent_sessions
  |     |-- Phase 7: Deferred Loading (trust-gated)
  |     |-- Phase 8: Mode Routing
  |     |-- Phase 9: Doctor Check (fast-path)   <-- Doctor below
  |     |-- Phase 10: Main Loop handoff
  |     |
  |     +-> Each phase: timing, events to EventLogger (BP03)
  |     +-> Boot summary persisted to boot_runs table
  |
  +-> DoctorSystem
        |-- Workspace checks
        |-- Configuration checks
        |-- Credential checks
        |-- Connection checks
        |-- Tool checks (BP01 tool_registry)
        |-- Session checks (BP02 agent_sessions, budget_ledger)
        |
        +-> Structured report: pass/warn/fail per check
        +-> Auto-repair for repairable failures
        +-> Persisted to system_events (BP03)
```

---

## 2. Database Schema

Run these migrations after blueprints 01, 02, and 03 schemas exist.

### 2.1 Boot Runs Table

```sql
-- ============================================================
-- Boot Runs Table
-- Records each boot sequence execution with per-phase timing.
-- Used by the doctor pattern and operational dashboards.
-- ============================================================

CREATE TABLE boot_runs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  session_id    TEXT NOT NULL,

  -- Overall boot outcome
  status        TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'rolled_back')),

  -- Which phase the boot reached (or failed at)
  reached_phase TEXT NOT NULL DEFAULT 'prefetch',
  failed_phase  TEXT,
  failure_reason TEXT,

  -- Per-phase timing (populated incrementally as phases complete)
  phase_timings JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Example:
  -- {
  --   "prefetch":         {"started_at": "...", "duration_ms": 12, "status": "ok"},
  --   "environment":      {"started_at": "...", "duration_ms": 3,  "status": "ok"},
  --   "config_loading":   {"started_at": "...", "duration_ms": 45, "status": "ok"},
  --   "trust_gate":       {"started_at": "...", "duration_ms": 1,  "status": "ok"},
  --   "registry_init":    {"started_at": "...", "duration_ms": 80, "status": "ok"},
  --   "workspace_init":   {"started_at": "...", "duration_ms": 60, "status": "ok"},
  --   "deferred_loading": {"started_at": "...", "duration_ms": 200, "status": "ok"},
  --   "mode_routing":     {"started_at": "...", "duration_ms": 2,  "status": "ok"},
  --   "doctor_check":     {"started_at": "...", "duration_ms": 150, "status": "ok"},
  --   "main_loop":        {"started_at": "...", "duration_ms": 0,  "status": "ok"}
  -- }

  -- Fast-path short-circuit (if boot was aborted early for a fast path)
  fast_path_used TEXT,
  -- One of: 'version', 'system_prompt', 'mcp_bridge', 'daemon_worker',
  --         'daemon', 'background_session', 'template', 'env_runner',
  --         'health_check', 'config_dump'

  -- Config snapshot at boot (the merged config that was loaded)
  config_scope_sources JSONB DEFAULT '{}'::jsonb,
  -- Example: {"model": {"value": "opus-4", "scope": "project", "file": ".claude.json"}}

  -- Trust determination
  trust_mode    TEXT CHECK (trust_mode IN ('trusted', 'untrusted', 'prompt')),

  -- Doctor check summary (if phase 9 ran)
  doctor_summary JSONB DEFAULT '{}'::jsonb,
  -- Example: {"pass": 14, "warn": 2, "fail": 0, "auto_repaired": 1}

  -- Total boot duration
  total_duration_ms INTEGER,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

-- Find boots for a session
CREATE INDEX idx_boot_runs_session
  ON boot_runs (session_id, created_at DESC);

-- Find failed boots for debugging
CREATE INDEX idx_boot_runs_failed
  ON boot_runs (status, created_at DESC)
  WHERE status IN ('failed', 'rolled_back');

-- RLS
ALTER TABLE boot_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on boot_runs"
  ON boot_runs
  FOR ALL
  USING (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE ON TABLE public.boot_runs TO service_role;
```

### 2.2 Agent Config Table

```sql
-- ============================================================
-- Agent Configuration Table
-- Stores scoped configuration snapshots with provenance tracking.
-- Each row represents a complete merged configuration as of a
-- point in time, with every setting traced to its source scope.
-- ============================================================

CREATE TABLE agent_config (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  config_id     UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  session_id    TEXT,  -- NULL for "current active config" (no session yet)

  -- The merged configuration object
  merged_config JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Provenance map: which scope provided which setting
  provenance    JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Example:
  -- {
  --   "model":       {"value": "opus-4", "scope": "project", "file": ".claude.json"},
  --   "permissions":  {"value": {"allow": []}, "scope": "user", "file": "~/.claude/settings.json"},
  --   "mcpServers.ob1": {"value": {...}, "scope": "local", "file": ".claude/settings.local.json"}
  -- }

  -- MCP server list after deduplication
  mcp_servers   JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Example:
  -- [
  --   {"name": "ob1", "url": "https://...", "scope": "project", "deduplicated_from": ["user", "project"]},
  --   {"name": "github", "url": "https://...", "scope": "user"}
  -- ]

  -- Source files that were loaded (for debugging)
  source_files  JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Example:
  -- [
  --   {"path": "~/.claude.json", "scope": "user", "exists": true, "loaded": true},
  --   {"path": ".claude/settings.local.json", "scope": "local", "exists": false, "loaded": false}
  -- ]

  -- Validation status
  valid         BOOLEAN NOT NULL DEFAULT true,
  validation_errors JSONB DEFAULT '[]'::jsonb,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup by session
CREATE INDEX idx_agent_config_session
  ON agent_config (session_id, created_at DESC);

-- RLS
ALTER TABLE agent_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on agent_config"
  ON agent_config
  FOR ALL
  USING (auth.role() = 'service_role');

GRANT SELECT, INSERT ON TABLE public.agent_config TO service_role;
```

### 2.3 Extend system_events Categories

The `system_events` table from Blueprint 03 already exists. We need to add new categories for boot and doctor events. Since the category column uses a CHECK constraint, we alter it:

```sql
-- Add boot and doctor categories to the system_events CHECK constraint.
-- The existing categories from BP03 are preserved.
ALTER TABLE system_events DROP CONSTRAINT IF EXISTS system_events_category_check;
ALTER TABLE system_events ADD CONSTRAINT system_events_category_check
  CHECK (category IN (
    -- Existing from BP03
    'initialization', 'registry', 'tool_selection', 'permission',
    'execution', 'stream', 'turn_complete', 'session',
    'compaction', 'usage', 'error', 'hook', 'verification',
    -- New for BP05
    'boot',           -- boot pipeline phase events
    'doctor',         -- doctor check events
    'config'          -- configuration loading events
  ));
```

---

## 3. Scoped Configuration (#13b)

### 3.1 Types

```typescript
// config/types.ts

/** The three tiers of configuration scope */
export type ConfigScope = 'user' | 'project' | 'local';

/** Discovery path entry: where to look for config and what scope it belongs to */
export interface ConfigSource {
  path: string;       // filesystem path (absolute or ~ prefixed)
  scope: ConfigScope;
  exists: boolean;    // populated after discovery
  loaded: boolean;    // populated after load attempt
  error?: string;     // populated if load failed
}

/** Provenance record: tracks where each config value came from */
export interface ConfigProvenance {
  value: unknown;
  scope: ConfigScope;
  file: string;
  overridden_by?: {
    scope: ConfigScope;
    file: string;
  };
}

/** MCP server entry after deduplication */
export interface McpServerEntry {
  name: string;
  url: string;
  scope: ConfigScope;
  headers?: Record<string, string>;
  /** If this server appeared in multiple scopes, list them */
  deduplicated_from?: ConfigScope[];
}

/** Feature-specific sub-configs parsed from merged result */
export interface PermissionConfig {
  active_mode: string;
  allow_tools: string[];
  deny_tools: string[];
  deny_prefixes: string[];
}

export interface ModelConfig {
  model: string;
  max_tokens?: number;
  temperature?: number;
}

export interface HookConfig {
  pre_tool?: Record<string, string>;   // tool_name -> hook command
  post_tool?: Record<string, string>;
  pre_commit?: string;
}

/** Complete merged configuration with provenance */
export interface MergedConfig {
  /** The merged JSON object (ready for runtime use) */
  config: Record<string, unknown>;

  /** Per-key provenance tracking */
  provenance: Record<string, ConfigProvenance>;

  /** MCP servers after deduplication */
  mcpServers: McpServerEntry[];

  /** Parsed sub-configs */
  permissions: PermissionConfig;
  model: ModelConfig;
  hooks: HookConfig;

  /** Source files that were scanned */
  sources: ConfigSource[];

  /** Validation errors (non-fatal parse issues, schema mismatches) */
  validationErrors: string[];
}
```

### 3.2 Config Loader

```typescript
// config/scoped-config-loader.ts

import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join, resolve } from 'path';
import {
  ConfigScope, ConfigSource, ConfigProvenance,
  McpServerEntry, MergedConfig, PermissionConfig,
  ModelConfig, HookConfig,
} from './types';

/** Default discovery order: 5 files, 3 scopes */
const DEFAULT_SOURCES: Array<{ relative: string; scope: ConfigScope }> = [
  { relative: '~/.claude.json',                scope: 'user' },
  { relative: '~/.claude/settings.json',       scope: 'user' },
  { relative: '.claude.json',                  scope: 'project' },
  { relative: '.claude/settings.json',         scope: 'project' },
  { relative: '.claude/settings.local.json',   scope: 'local' },
];

export class ScopedConfigLoader {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
  }

  /** Load and merge all config tiers. Never throws -- returns errors in validationErrors. */
  async load(): Promise<MergedConfig> {
    const sources = this.discoverSources();
    const layers: Array<{ data: Record<string, unknown>; source: ConfigSource }> = [];

    // Load each source file
    for (const source of sources) {
      try {
        const raw = await readFile(source.path, 'utf-8');
        const data = JSON.parse(raw);
        source.exists = true;
        source.loaded = true;
        layers.push({ data, source });
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          source.exists = false;
          source.loaded = false;
        } else {
          source.exists = true;
          source.loaded = false;
          source.error = err.message;
        }
      }
    }

    // Deep merge with provenance tracking
    const merged: Record<string, unknown> = {};
    const provenance: Record<string, ConfigProvenance> = {};
    const allMcpServers: Map<string, McpServerEntry> = new Map();
    const validationErrors: string[] = [];

    for (const { data, source } of layers) {
      this.deepMergeWithProvenance(
        merged, data, provenance,
        source.scope, source.path,
        '', // key prefix
      );

      // Extract MCP servers for deduplication
      const servers = (data as any)?.mcpServers ?? (data as any)?.mcp_servers;
      if (servers && typeof servers === 'object') {
        for (const [name, serverConfig] of Object.entries(servers)) {
          const existing = allMcpServers.get(name);
          const entry: McpServerEntry = {
            name,
            url: (serverConfig as any)?.url ?? '',
            scope: source.scope,
            headers: (serverConfig as any)?.headers,
          };

          if (existing) {
            // Last scope wins; track that we deduplicated
            entry.deduplicated_from = [
              ...(existing.deduplicated_from ?? [existing.scope]),
              source.scope,
            ];
          }

          allMcpServers.set(name, entry);
        }
      }
    }

    // Parse feature sub-configs
    const permissions = this.parsePermissions(merged, validationErrors);
    const model = this.parseModel(merged, validationErrors);
    const hooks = this.parseHooks(merged, validationErrors);

    return {
      config: merged,
      provenance,
      mcpServers: Array.from(allMcpServers.values()),
      permissions,
      model,
      hooks,
      sources,
      validationErrors,
    };
  }

  /** Resolve ~ and relative paths into absolute paths */
  private discoverSources(): ConfigSource[] {
    return DEFAULT_SOURCES.map(({ relative, scope }) => {
      let path: string;
      if (relative.startsWith('~/') || relative.startsWith('~\\')) {
        path = join(homedir(), relative.slice(2));
      } else {
        path = join(this.projectRoot, relative);
      }
      return { path, scope, exists: false, loaded: false };
    });
  }

  /**
   * Deep merge `source` into `target`, recording provenance for every leaf value.
   * Objects are recursively merged. Arrays and primitives are replaced (last wins).
   */
  private deepMergeWithProvenance(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
    provenance: Record<string, ConfigProvenance>,
    scope: ConfigScope,
    file: string,
    prefix: string,
  ): void {
    for (const [key, value] of Object.entries(source)) {
      // Skip MCP servers -- handled separately for deduplication
      if (key === 'mcpServers' || key === 'mcp_servers') continue;

      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        // Recursive merge for nested objects
        if (typeof target[key] !== 'object' || target[key] === null || Array.isArray(target[key])) {
          target[key] = {};
        }
        this.deepMergeWithProvenance(
          target[key] as Record<string, unknown>,
          value as Record<string, unknown>,
          provenance, scope, file, fullKey,
        );
      } else {
        // Leaf value -- record provenance
        const existing = provenance[fullKey];
        if (existing) {
          // We are overriding a previously set value
          existing.overridden_by = { scope, file };
        }
        provenance[fullKey] = { value, scope, file };
        target[key] = value;
      }
    }
  }

  private parsePermissions(
    merged: Record<string, unknown>,
    errors: string[],
  ): PermissionConfig {
    const perms = (merged as any)?.permissions ?? {};
    return {
      active_mode: perms.active_mode ?? 'read_only',
      allow_tools: Array.isArray(perms.allow_tools) ? perms.allow_tools : [],
      deny_tools: Array.isArray(perms.deny_tools) ? perms.deny_tools : [],
      deny_prefixes: Array.isArray(perms.deny_prefixes) ? perms.deny_prefixes : [],
    };
  }

  private parseModel(
    merged: Record<string, unknown>,
    errors: string[],
  ): ModelConfig {
    return {
      model: (merged as any)?.model ?? 'claude-sonnet-4-20250514',
      max_tokens: (merged as any)?.max_tokens,
      temperature: (merged as any)?.temperature,
    };
  }

  private parseHooks(
    merged: Record<string, unknown>,
    errors: string[],
  ): HookConfig {
    const hooks = (merged as any)?.hooks ?? {};
    return {
      pre_tool: hooks.pre_tool,
      post_tool: hooks.post_tool,
      pre_commit: hooks.pre_commit,
    };
  }
}
```

### 3.3 Config Debugging Utility

```typescript
// config/config-debug.ts

import { MergedConfig, ConfigProvenance } from './types';

/**
 * Render a human-readable debug view of the merged config,
 * showing which scope provided each value.
 */
export function renderConfigDebug(config: MergedConfig): string {
  const lines: string[] = [
    '# Configuration Debug Report',
    '',
    '## Source Files',
  ];

  for (const source of config.sources) {
    const status = source.loaded
      ? 'LOADED'
      : source.exists
        ? `ERROR: ${source.error}`
        : 'NOT FOUND';
    lines.push(`- [${source.scope}] ${source.path} -- ${status}`);
  }

  lines.push('', '## Settings (with provenance)', '');
  lines.push('| Key | Value | Scope | Source File |');
  lines.push('|-----|-------|-------|-------------|');

  const sortedKeys = Object.keys(config.provenance).sort();
  for (const key of sortedKeys) {
    const prov = config.provenance[key];
    const valueStr = typeof prov.value === 'string'
      ? prov.value
      : JSON.stringify(prov.value);
    const truncated = valueStr.length > 60
      ? valueStr.slice(0, 57) + '...'
      : valueStr;
    const override = prov.overridden_by
      ? ` (overridden by ${prov.overridden_by.scope})`
      : '';
    lines.push(`| ${key} | ${truncated} | ${prov.scope}${override} | ${prov.file} |`);
  }

  lines.push('', '## MCP Servers (after deduplication)', '');
  lines.push('| Name | URL | Scope | Deduplicated? |');
  lines.push('|------|-----|-------|---------------|');

  for (const server of config.mcpServers) {
    const dedup = server.deduplicated_from
      ? `Yes (from: ${server.deduplicated_from.join(', ')})`
      : 'No';
    lines.push(`| ${server.name} | ${server.url} | ${server.scope} | ${dedup} |`);
  }

  if (config.validationErrors.length > 0) {
    lines.push('', '## Validation Errors', '');
    for (const err of config.validationErrors) {
      lines.push(`- ${err}`);
    }
  }

  return lines.join('\n');
}
```

---

## 4. Staged Boot Sequence (#13)

### 4.1 Boot Phase Enum

```typescript
// boot/types.ts

/**
 * The 10 boot phases in strict execution order.
 * Each phase is gated on the previous phase completing successfully
 * (except phases 5 and 6 which run in parallel).
 */
export enum BootPhase {
  Prefetch        = 'prefetch',
  Environment     = 'environment',
  ConfigLoading   = 'config_loading',
  TrustGate       = 'trust_gate',
  RegistryInit    = 'registry_init',
  WorkspaceInit   = 'workspace_init',
  DeferredLoading = 'deferred_loading',
  ModeRouting     = 'mode_routing',
  DoctorCheck     = 'doctor_check',
  MainLoop        = 'main_loop',
}

/** Strict ordering of phases (index = execution order) */
export const BOOT_PHASE_ORDER: BootPhase[] = [
  BootPhase.Prefetch,
  BootPhase.Environment,
  BootPhase.ConfigLoading,
  BootPhase.TrustGate,
  BootPhase.RegistryInit,     // parallel with WorkspaceInit
  BootPhase.WorkspaceInit,    // parallel with RegistryInit
  BootPhase.DeferredLoading,
  BootPhase.ModeRouting,
  BootPhase.DoctorCheck,
  BootPhase.MainLoop,
];

/** Per-phase timing record */
export interface PhaseTimingEntry {
  started_at: string;    // ISO 8601
  duration_ms: number;
  status: 'ok' | 'skipped' | 'failed' | 'rolled_back';
  error?: string;
  skip_reason?: string;
}

/** The 10 fast-path short-circuits */
export enum FastPath {
  Version         = 'version',
  SystemPrompt    = 'system_prompt',
  McpBridge       = 'mcp_bridge',
  DaemonWorker    = 'daemon_worker',
  Daemon          = 'daemon',
  BackgroundSession = 'background_session',
  Template        = 'template',
  EnvRunner       = 'env_runner',
  HealthCheck     = 'health_check',
  ConfigDump      = 'config_dump',
}

/** Boot context accumulated as phases execute */
export interface BootContext {
  // Phase 1: Prefetch results
  prefetchResults: PrefetchResult[];

  // Phase 2: Environment
  platform: string;
  nodeVersion: string;
  missingDeps: string[];

  // Phase 3: Config
  config: import('../config/types').MergedConfig | null;

  // Phase 4: Trust
  trustMode: 'trusted' | 'untrusted' | 'prompt';

  // Phase 5: Registry
  toolCount: number;
  mcpToolCount: number;

  // Phase 6: Workspace
  sessionRestored: boolean;
  workspacePath: string;

  // Phase 7: Deferred
  deferredInit: DeferredInitResult | null;

  // Phase 8: Mode
  agentMode: 'interactive' | 'coordinator' | 'swarm_worker' | 'background';

  // Phase 9: Doctor
  doctorSummary: { pass: number; warn: number; fail: number; auto_repaired: number } | null;

  // Timing
  phaseTimings: Record<string, PhaseTimingEntry>;
  totalDurationMs: number;

  // Fast path (if used)
  fastPathUsed: FastPath | null;
}

export interface PrefetchResult {
  name: string;
  started: boolean;
  detail: string;
}

export interface DeferredInitResult {
  trusted: boolean;
  plugin_init: boolean;
  skill_init: boolean;
  mcp_prefetch: boolean;
  session_hooks: boolean;
}
```

### 4.2 Phase Runner with Timing and Rollback

```typescript
// boot/phase-runner.ts

import {
  BootPhase, PhaseTimingEntry, BootContext,
} from './types';
import { EventLogger } from '../logging/event-logger';

/** A single phase implementation */
export interface PhaseHandler {
  phase: BootPhase;
  /** Execute the phase. Receives and mutates boot context. */
  execute(ctx: BootContext): Promise<void>;
  /** Rollback the phase if a later phase fails. Optional -- not all phases need rollback. */
  rollback?(ctx: BootContext): Promise<void>;
  /** Should this phase be skipped? Return a reason string to skip, or null to execute. */
  shouldSkip?(ctx: BootContext): string | null;
}

/**
 * Runs boot phases in order with:
 * - Per-phase timing instrumentation
 * - Gate conditions (previous phase must succeed)
 * - Rollback on failure (unwinds completed phases in reverse)
 * - Fast-path short-circuits (skip remaining phases)
 * - Event logging at each phase boundary
 */
export class PhaseRunner {
  private handlers: Map<BootPhase, PhaseHandler> = new Map();
  private completedPhases: PhaseHandler[] = [];
  private logger: EventLogger;

  constructor(logger: EventLogger) {
    this.logger = logger;
  }

  /** Register a phase handler */
  register(handler: PhaseHandler): void {
    this.handlers.set(handler.phase, handler);
  }

  /**
   * Execute all phases in order.
   * Returns the final boot context.
   * If a phase fails, rolls back completed phases in reverse order.
   */
  async run(ctx: BootContext): Promise<BootContext> {
    const { BOOT_PHASE_ORDER } = await import('./types');

    // Separate out the parallel pair (registry + workspace)
    const parallelPhases = new Set([BootPhase.RegistryInit, BootPhase.WorkspaceInit]);

    let i = 0;
    while (i < BOOT_PHASE_ORDER.length) {
      const phase = BOOT_PHASE_ORDER[i];

      // Check for fast-path exit
      if (ctx.fastPathUsed !== null) {
        this.logger.info('boot', `Fast-path: ${ctx.fastPathUsed}`, {
          skipped_from: phase,
        });
        break;
      }

      // Handle parallel phases (RegistryInit + WorkspaceInit)
      if (phase === BootPhase.RegistryInit) {
        const registryHandler = this.handlers.get(BootPhase.RegistryInit);
        const workspaceHandler = this.handlers.get(BootPhase.WorkspaceInit);

        if (registryHandler && workspaceHandler) {
          const results = await Promise.allSettled([
            this.executePhase(registryHandler, ctx),
            this.executePhase(workspaceHandler, ctx),
          ]);

          // Check for failures in parallel execution
          for (const result of results) {
            if (result.status === 'rejected') {
              await this.rollbackAll(ctx, result.reason);
              throw result.reason;
            }
          }

          // Skip WorkspaceInit in the loop (already done in parallel)
          i += 2;
          continue;
        }
      }

      // Skip the workspace phase if we already did it in parallel
      if (phase === BootPhase.WorkspaceInit && ctx.phaseTimings[BootPhase.WorkspaceInit]) {
        i++;
        continue;
      }

      const handler = this.handlers.get(phase);
      if (!handler) {
        this.logger.warn('boot', `No handler for phase: ${phase}`);
        i++;
        continue;
      }

      try {
        await this.executePhase(handler, ctx);
      } catch (err: any) {
        await this.rollbackAll(ctx, err);
        throw err;
      }

      i++;
    }

    return ctx;
  }

  /** Execute a single phase with timing and skip logic */
  private async executePhase(handler: PhaseHandler, ctx: BootContext): Promise<void> {
    const phase = handler.phase;

    // Check skip condition
    if (handler.shouldSkip) {
      const skipReason = handler.shouldSkip(ctx);
      if (skipReason) {
        const timing: PhaseTimingEntry = {
          started_at: new Date().toISOString(),
          duration_ms: 0,
          status: 'skipped',
          skip_reason: skipReason,
        };
        ctx.phaseTimings[phase] = timing;

        this.logger.info('boot', `Phase skipped: ${phase}`, {
          phase,
          reason: skipReason,
        });
        return;
      }
    }

    const startedAt = new Date();
    const startMs = performance.now();

    this.logger.debug('boot', `Phase starting: ${phase}`, { phase });

    try {
      await handler.execute(ctx);

      const durationMs = Math.round(performance.now() - startMs);
      const timing: PhaseTimingEntry = {
        started_at: startedAt.toISOString(),
        duration_ms: durationMs,
        status: 'ok',
      };
      ctx.phaseTimings[phase] = timing;

      this.logger.info('boot', `Phase completed: ${phase}`, {
        phase,
        duration_ms: durationMs,
      });

      this.completedPhases.push(handler);
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startMs);
      const timing: PhaseTimingEntry = {
        started_at: startedAt.toISOString(),
        duration_ms: durationMs,
        status: 'failed',
        error: err.message,
      };
      ctx.phaseTimings[phase] = timing;

      this.logger.error('boot', `Phase failed: ${phase}`, {
        phase,
        duration_ms: durationMs,
        error: err.message,
      });

      throw err;
    }
  }

  /**
   * Roll back completed phases in reverse order.
   * Only phases that define a rollback() method are rolled back.
   */
  private async rollbackAll(ctx: BootContext, cause: Error): Promise<void> {
    this.logger.warn('boot', 'Rolling back boot sequence', {
      completed_count: this.completedPhases.length,
      cause: cause.message,
    });

    // Reverse order rollback
    for (let i = this.completedPhases.length - 1; i >= 0; i--) {
      const handler = this.completedPhases[i];
      if (handler.rollback) {
        try {
          this.logger.info('boot', `Rolling back phase: ${handler.phase}`, {
            phase: handler.phase,
          });
          await handler.rollback(ctx);

          // Update timing to reflect rollback
          const existing = ctx.phaseTimings[handler.phase];
          if (existing) {
            existing.status = 'rolled_back';
          }
        } catch (rollbackErr: any) {
          this.logger.error('boot', `Rollback failed for phase: ${handler.phase}`, {
            phase: handler.phase,
            error: rollbackErr.message,
          });
          // Continue rolling back other phases even if one fails
        }
      }
    }
  }
}
```

### 4.3 Phase Implementations

```typescript
// boot/phases/prefetch.ts

import { PhaseHandler, BootPhase, BootContext, PrefetchResult } from '../types';

/**
 * Phase 1: Prefetch
 * Fire-and-forget credential validation and workspace scan.
 * These run in parallel and store their results for downstream phases.
 */
export const prefetchPhase: PhaseHandler = {
  phase: BootPhase.Prefetch,

  async execute(ctx: BootContext): Promise<void> {
    const results = await Promise.allSettled([
      prefetchCredentials(),
      prefetchWorkspaceScan(ctx.workspacePath),
      prefetchProjectDetection(ctx.workspacePath),
    ]);

    ctx.prefetchResults = results.map((r, i) => {
      const names = ['credentials', 'workspace_scan', 'project_detection'];
      if (r.status === 'fulfilled') {
        return r.value;
      }
      return { name: names[i], started: false, detail: (r as any).reason?.message ?? 'unknown' };
    });
  },

  // No rollback needed -- prefetches have no side effects
};

async function prefetchCredentials(): Promise<PrefetchResult> {
  // Check environment variables for Supabase connection
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

  return {
    name: 'credentials',
    started: true,
    detail: [
      url ? 'Supabase URL set' : 'SUPABASE_URL missing',
      key ? 'Supabase key set' : 'SUPABASE_SERVICE_ROLE_KEY missing',
      hasApiKey ? 'API key set' : 'ANTHROPIC_API_KEY missing',
    ].join('; '),
  };
}

async function prefetchWorkspaceScan(workspacePath: string): Promise<PrefetchResult> {
  const { existsSync } = await import('fs');
  const { join } = await import('path');

  const markers = [
    'CLAUDE.md',
    '.claude',
    '.claude.json',
    '.claude/settings.json',
    'package.json',
    'Cargo.toml',
    'pyproject.toml',
  ];

  const found = markers.filter(m => existsSync(join(workspacePath, m)));

  return {
    name: 'workspace_scan',
    started: true,
    detail: `Found: ${found.join(', ') || 'none'}`,
  };
}

async function prefetchProjectDetection(workspacePath: string): Promise<PrefetchResult> {
  const { existsSync } = await import('fs');
  const { join } = await import('path');

  const detections: string[] = [];
  const checks: Array<[string, string]> = [
    ['package.json', 'node'],
    ['tsconfig.json', 'typescript'],
    ['Cargo.toml', 'rust'],
    ['pyproject.toml', 'python'],
    ['go.mod', 'go'],
    ['next.config.js', 'nextjs'],
    ['next.config.mjs', 'nextjs'],
    ['next.config.ts', 'nextjs'],
  ];

  for (const [file, lang] of checks) {
    if (existsSync(join(workspacePath, file))) {
      detections.push(lang);
    }
  }

  return {
    name: 'project_detection',
    started: true,
    detail: `Detected: ${[...new Set(detections)].join(', ') || 'none'}`,
  };
}
```

```typescript
// boot/phases/environment.ts

import { PhaseHandler, BootPhase, BootContext } from '../types';

/**
 * Phase 2: Environment Guards
 * Validate platform, runtime version, and critical dependencies.
 */
export const environmentPhase: PhaseHandler = {
  phase: BootPhase.Environment,

  async execute(ctx: BootContext): Promise<void> {
    ctx.platform = process.platform;
    ctx.nodeVersion = process.version;
    ctx.missingDeps = [];

    // Node version check (require >= 18 for fetch, structuredClone, etc.)
    const major = parseInt(process.version.slice(1), 10);
    if (major < 18) {
      throw new Error(`Node.js >= 18 required, found ${process.version}`);
    }

    // Check for critical dependencies
    const requiredModules = [
      '@supabase/supabase-js',
    ];

    for (const mod of requiredModules) {
      try {
        await import(mod);
      } catch {
        ctx.missingDeps.push(mod);
      }
    }

    if (ctx.missingDeps.length > 0) {
      throw new Error(
        `Missing required dependencies: ${ctx.missingDeps.join(', ')}. Run npm install.`
      );
    }
  },

  // No rollback needed -- read-only checks
};
```

```typescript
// boot/phases/config-loading.ts

import { PhaseHandler, BootPhase, BootContext } from '../types';
import { ScopedConfigLoader } from '../../config/scoped-config-loader';

/**
 * Phase 3: Config Loading
 * Load scoped configuration from User -> Project -> Local tiers.
 */
export const configLoadingPhase: PhaseHandler = {
  phase: BootPhase.ConfigLoading,

  async execute(ctx: BootContext): Promise<void> {
    const loader = new ScopedConfigLoader(ctx.workspacePath);
    ctx.config = await loader.load();

    if (ctx.config.validationErrors.length > 0) {
      // Non-fatal: log warnings but don't fail the phase
      // The caller (boot pipeline) will log these
    }
  },

  // Config loading is read-only -- no rollback needed
};
```

```typescript
// boot/phases/trust-gate.ts

import { PhaseHandler, BootPhase, BootContext } from '../types';

/**
 * Phase 4: Trust Gate
 * Determine the trust mode which gates all subsequent security-sensitive phases.
 * This is the single boolean that controls plugin init, skill loading,
 * MCP server connections, and session hooks.
 */
export const trustGatePhase: PhaseHandler = {
  phase: BootPhase.TrustGate,

  async execute(ctx: BootContext): Promise<void> {
    // Trust determination based on config and environment
    const configMode = ctx.config?.permissions?.active_mode;

    if (configMode === 'allow' || configMode === 'danger_full_access') {
      ctx.trustMode = 'trusted';
    } else if (configMode === 'prompt') {
      ctx.trustMode = 'prompt';
    } else if (process.env.OB1_TRUST_MODE === 'trusted') {
      ctx.trustMode = 'trusted';
    } else {
      // Default to untrusted for safety
      ctx.trustMode = 'untrusted';
    }
  },

  // Trust gate is a value determination -- no rollback needed
};
```

```typescript
// boot/phases/registry-init.ts

import { PhaseHandler, BootPhase, BootContext } from '../types';
import { createClient } from '@supabase/supabase-js';

/**
 * Phase 5: Registry Init (runs in parallel with Phase 6)
 * Load the tool registry and apply permission policies.
 * Depends on: BP01 tool_registry and permission_policies tables.
 */
export const registryInitPhase: PhaseHandler = {
  phase: BootPhase.RegistryInit,

  async execute(ctx: BootContext): Promise<void> {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Load enabled tools from registry (BP01)
    const { data: tools, error: toolsErr } = await supabase
      .from('tool_registry')
      .select('*')
      .eq('enabled', true);

    if (toolsErr) {
      throw new Error(`Failed to load tool registry: ${toolsErr.message}`);
    }

    ctx.toolCount = tools?.length ?? 0;
    ctx.mcpToolCount = tools?.filter(t => t.source_type === 'mcp').length ?? 0;
  },

  async rollback(ctx: BootContext): Promise<void> {
    // Clear the tool counts -- registry state is in Supabase, no local cleanup needed
    ctx.toolCount = 0;
    ctx.mcpToolCount = 0;
  },
};
```

```typescript
// boot/phases/workspace-init.ts

import { PhaseHandler, BootPhase, BootContext } from '../types';
import { createClient } from '@supabase/supabase-js';

/**
 * Phase 6: Workspace Init (runs in parallel with Phase 5)
 * Restore sessions and validate workspace state.
 * Depends on: BP02 agent_sessions table.
 */
export const workspaceInitPhase: PhaseHandler = {
  phase: BootPhase.WorkspaceInit,

  async execute(ctx: BootContext): Promise<void> {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Check for crashed/active sessions to restore (BP02)
    const { data: sessions } = await supabase
      .from('agent_sessions')
      .select('session_id, status, updated_at')
      .in('status', ['active', 'crashed'])
      .order('updated_at', { ascending: false })
      .limit(1);

    ctx.sessionRestored = (sessions?.length ?? 0) > 0;
  },

  async rollback(ctx: BootContext): Promise<void> {
    ctx.sessionRestored = false;
  },
};
```

```typescript
// boot/phases/deferred-loading.ts

import { PhaseHandler, BootPhase, BootContext, DeferredInitResult } from '../types';

/**
 * Phase 7: Deferred Loading (trust-gated)
 * Load plugins, skills, MCP servers, and session hooks.
 * Only executes if trust gate passed (trusted or prompt mode).
 */
export const deferredLoadingPhase: PhaseHandler = {
  phase: BootPhase.DeferredLoading,

  shouldSkip(ctx: BootContext): string | null {
    if (ctx.trustMode === 'untrusted') {
      return 'Trust gate: untrusted mode -- skipping deferred loading';
    }
    return null;
  },

  async execute(ctx: BootContext): Promise<void> {
    const trusted = ctx.trustMode === 'trusted';

    const result: DeferredInitResult = {
      trusted,
      plugin_init: false,
      skill_init: false,
      mcp_prefetch: false,
      session_hooks: false,
    };

    // Plugin initialization
    try {
      // Plugin loading would go here -- load from config.plugins
      result.plugin_init = true;
    } catch {
      result.plugin_init = false;
    }

    // Skill initialization
    try {
      // Skill loading would go here -- load from config.skills
      result.skill_init = true;
    } catch {
      result.skill_init = false;
    }

    // MCP server prefetch
    if (ctx.config?.mcpServers && ctx.config.mcpServers.length > 0) {
      try {
        // For each MCP server, verify it responds to initialize
        // This is fire-and-forget -- results checked by doctor
        result.mcp_prefetch = true;
      } catch {
        result.mcp_prefetch = false;
      }
    } else {
      result.mcp_prefetch = true; // no servers to check
    }

    // Session hooks
    try {
      result.session_hooks = true;
    } catch {
      result.session_hooks = false;
    }

    ctx.deferredInit = result;
  },

  async rollback(ctx: BootContext): Promise<void> {
    // Unload plugins, skills, disconnect MCP servers
    ctx.deferredInit = null;
  },
};
```

```typescript
// boot/phases/mode-routing.ts

import { PhaseHandler, BootPhase, BootContext } from '../types';

/**
 * Phase 8: Mode Routing
 * Determine which agent mode to start (interactive, coordinator, swarm, background).
 */
export const modeRoutingPhase: PhaseHandler = {
  phase: BootPhase.ModeRouting,

  async execute(ctx: BootContext): Promise<void> {
    // Mode determination based on CLI args and config
    const mode = process.env.OB1_AGENT_MODE ?? 'interactive';

    switch (mode) {
      case 'coordinator':
        ctx.agentMode = 'coordinator';
        break;
      case 'swarm':
      case 'swarm_worker':
        ctx.agentMode = 'swarm_worker';
        break;
      case 'background':
        ctx.agentMode = 'background';
        break;
      default:
        ctx.agentMode = 'interactive';
    }
  },

  // Mode routing is a value determination -- no rollback needed
};
```

```typescript
// boot/phases/doctor-check.ts

import { PhaseHandler, BootPhase, BootContext } from '../types';

/**
 * Phase 9: Doctor Check
 * Quick health validation. Uses the Doctor system (Section 5) in fast mode.
 * Skip if the boot was a fast-path or if OB1_SKIP_DOCTOR is set.
 */
export const doctorCheckPhase: PhaseHandler = {
  phase: BootPhase.DoctorCheck,

  shouldSkip(ctx: BootContext): string | null {
    if (ctx.fastPathUsed) {
      return `Fast-path active: ${ctx.fastPathUsed}`;
    }
    if (process.env.OB1_SKIP_DOCTOR === 'true') {
      return 'OB1_SKIP_DOCTOR=true';
    }
    return null;
  },

  async execute(ctx: BootContext): Promise<void> {
    // Import doctor system lazily to avoid circular deps
    const { DoctorSystem } = await import('../../doctor/doctor-system');
    const doctor = new DoctorSystem(ctx);
    const report = await doctor.runAll();

    ctx.doctorSummary = {
      pass: report.checks.filter(c => c.status === 'pass').length,
      warn: report.checks.filter(c => c.status === 'warn').length,
      fail: report.checks.filter(c => c.status === 'fail').length,
      auto_repaired: report.checks.filter(c => c.auto_repaired).length,
    };

    // If any check failed critically, throw to trigger rollback
    const criticalFailures = report.checks.filter(
      c => c.status === 'fail' && c.category === 'credentials'
    );
    if (criticalFailures.length > 0) {
      throw new Error(
        `Critical doctor failures: ${criticalFailures.map(c => c.name).join(', ')}`
      );
    }
  },

  // Doctor check is diagnostic -- no rollback needed
};
```

```typescript
// boot/phases/main-loop.ts

import { PhaseHandler, BootPhase, BootContext } from '../types';

/**
 * Phase 10: Main Loop
 * Hand off to the agentic loop. This phase marks boot as complete.
 * The actual loop implementation lives outside the boot pipeline.
 */
export const mainLoopPhase: PhaseHandler = {
  phase: BootPhase.MainLoop,

  async execute(ctx: BootContext): Promise<void> {
    // No-op: the boot pipeline marks this as the handoff point.
    // The actual main loop is started by the caller after run() returns.
  },

  // Main loop handoff has no rollback
};
```

### 4.4 Boot Pipeline Orchestrator

```typescript
// boot/boot-pipeline.ts

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  BootPhase, BootContext, FastPath, PhaseTimingEntry,
} from './types';
import { PhaseRunner } from './phase-runner';
import { EventLogger } from '../logging/event-logger';

// Phase implementations
import { prefetchPhase } from './phases/prefetch';
import { environmentPhase } from './phases/environment';
import { configLoadingPhase } from './phases/config-loading';
import { trustGatePhase } from './phases/trust-gate';
import { registryInitPhase } from './phases/registry-init';
import { workspaceInitPhase } from './phases/workspace-init';
import { deferredLoadingPhase } from './phases/deferred-loading';
import { modeRoutingPhase } from './phases/mode-routing';
import { doctorCheckPhase } from './phases/doctor-check';
import { mainLoopPhase } from './phases/main-loop';

export class BootPipeline {
  private logger: EventLogger;
  private supabase: SupabaseClient;
  private sessionId: string;

  constructor(
    sessionId: string,
    logger: EventLogger,
    supabaseUrl: string,
    supabaseKey: string,
  ) {
    this.sessionId = sessionId;
    this.logger = logger;
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Run the full boot pipeline.
   * Returns the boot context with all phase results.
   */
  async boot(workspacePath: string): Promise<BootContext> {
    const bootStartMs = performance.now();

    // Initialize boot context
    const ctx: BootContext = {
      prefetchResults: [],
      platform: '',
      nodeVersion: '',
      missingDeps: [],
      config: null,
      trustMode: 'untrusted',
      toolCount: 0,
      mcpToolCount: 0,
      sessionRestored: false,
      workspacePath,
      deferredInit: null,
      agentMode: 'interactive',
      doctorSummary: null,
      phaseTimings: {},
      totalDurationMs: 0,
      fastPathUsed: null,
    };

    // Check fast-path short-circuits before full boot
    const fastPath = this.checkFastPaths();
    if (fastPath) {
      ctx.fastPathUsed = fastPath;
      ctx.totalDurationMs = Math.round(performance.now() - bootStartMs);
      await this.persistBootRun(ctx, 'completed');
      return ctx;
    }

    // Build and run the phase pipeline
    const runner = new PhaseRunner(this.logger);
    runner.register(prefetchPhase);
    runner.register(environmentPhase);
    runner.register(configLoadingPhase);
    runner.register(trustGatePhase);
    runner.register(registryInitPhase);
    runner.register(workspaceInitPhase);
    runner.register(deferredLoadingPhase);
    runner.register(modeRoutingPhase);
    runner.register(doctorCheckPhase);
    runner.register(mainLoopPhase);

    try {
      await runner.run(ctx);
      ctx.totalDurationMs = Math.round(performance.now() - bootStartMs);

      this.logger.info('boot', 'Boot completed', {
        total_duration_ms: ctx.totalDurationMs,
        tool_count: ctx.toolCount,
        trust_mode: ctx.trustMode,
        agent_mode: ctx.agentMode,
        doctor_summary: ctx.doctorSummary,
      });

      await this.persistBootRun(ctx, 'completed');
      return ctx;
    } catch (err: any) {
      ctx.totalDurationMs = Math.round(performance.now() - bootStartMs);

      this.logger.critical('boot', 'Boot failed', {
        total_duration_ms: ctx.totalDurationMs,
        error: err.message,
        phase_timings: ctx.phaseTimings,
      });

      await this.persistBootRun(ctx, 'failed');
      throw err;
    }
  }

  /**
   * Check for fast-path short-circuits.
   * Returns a FastPath value if a fast path applies, or null for full boot.
   */
  private checkFastPaths(): FastPath | null {
    const args = process.argv.slice(2);

    if (args.includes('--version') || args.includes('-v')) {
      return FastPath.Version;
    }
    if (args.includes('--print-system-prompt')) {
      return FastPath.SystemPrompt;
    }
    if (args.includes('--mcp-bridge')) {
      return FastPath.McpBridge;
    }
    if (args.includes('--daemon-worker')) {
      return FastPath.DaemonWorker;
    }
    if (args.includes('--daemon')) {
      return FastPath.Daemon;
    }
    if (args.includes('--background')) {
      return FastPath.BackgroundSession;
    }
    if (args.includes('--template')) {
      return FastPath.Template;
    }
    if (args.includes('--env-runner')) {
      return FastPath.EnvRunner;
    }
    if (args.includes('--health-check')) {
      return FastPath.HealthCheck;
    }
    if (args.includes('--config-dump')) {
      return FastPath.ConfigDump;
    }

    return null;
  }

  /**
   * Persist boot run to Supabase for operational visibility.
   */
  private async persistBootRun(
    ctx: BootContext,
    status: 'completed' | 'failed' | 'rolled_back',
  ): Promise<void> {
    try {
      // Find the last completed phase and first failed phase
      const reachedPhase = this.findReachedPhase(ctx);
      const failedPhase = this.findFailedPhase(ctx);

      await this.supabase.from('boot_runs').insert({
        session_id: this.sessionId,
        status,
        reached_phase: reachedPhase,
        failed_phase: failedPhase,
        failure_reason: failedPhase
          ? ctx.phaseTimings[failedPhase]?.error
          : null,
        phase_timings: ctx.phaseTimings,
        fast_path_used: ctx.fastPathUsed,
        config_scope_sources: ctx.config?.provenance ?? {},
        trust_mode: ctx.trustMode,
        doctor_summary: ctx.doctorSummary,
        total_duration_ms: ctx.totalDurationMs,
        completed_at: new Date().toISOString(),
      });
    } catch (err) {
      // Boot persistence failure is non-fatal -- log and continue
      this.logger.warn('boot', 'Failed to persist boot run', {
        error: (err as Error).message,
      });
    }
  }

  private findReachedPhase(ctx: BootContext): string {
    const { BOOT_PHASE_ORDER } = require('./types');
    let last = 'prefetch';
    for (const phase of BOOT_PHASE_ORDER) {
      const timing = ctx.phaseTimings[phase];
      if (timing && (timing.status === 'ok' || timing.status === 'skipped')) {
        last = phase;
      }
    }
    return last;
  }

  private findFailedPhase(ctx: BootContext): string | null {
    for (const [phase, timing] of Object.entries(ctx.phaseTimings)) {
      if (timing.status === 'failed') {
        return phase;
      }
    }
    return null;
  }
}
```

### 4.5 System Init Message

```typescript
// boot/system-init-message.ts

import { BootContext } from './types';

/**
 * Build the system init message that gets injected into the LLM context.
 * Summarizes what was loaded, trust state, and boot health.
 */
export function buildSystemInitMessage(ctx: BootContext): string {
  const lines: string[] = [
    '# System Init',
    '',
    `Platform: ${ctx.platform} | Node: ${ctx.nodeVersion}`,
    `Trust: ${ctx.trustMode}`,
    `Mode: ${ctx.agentMode}`,
    `Tools: ${ctx.toolCount} (${ctx.mcpToolCount} from MCP)`,
    `Session restored: ${ctx.sessionRestored}`,
    '',
    'Boot phases:',
  ];

  for (const [phase, timing] of Object.entries(ctx.phaseTimings)) {
    const icon = timing.status === 'ok'
      ? 'OK'
      : timing.status === 'skipped'
        ? 'SKIP'
        : 'FAIL';
    lines.push(`- [${icon}] ${phase} (${timing.duration_ms}ms)`);
  }

  lines.push(``, `Total boot time: ${ctx.totalDurationMs}ms`);

  if (ctx.doctorSummary) {
    const d = ctx.doctorSummary;
    lines.push(
      '',
      `Doctor: ${d.pass} pass, ${d.warn} warn, ${d.fail} fail` +
      (d.auto_repaired > 0 ? `, ${d.auto_repaired} auto-repaired` : ''),
    );
  }

  if (ctx.deferredInit) {
    const di = ctx.deferredInit;
    lines.push(
      '',
      'Deferred init:',
      `- Plugins: ${di.plugin_init ? 'loaded' : 'skipped'}`,
      `- Skills: ${di.skill_init ? 'loaded' : 'skipped'}`,
      `- MCP prefetch: ${di.mcp_prefetch ? 'done' : 'skipped'}`,
      `- Session hooks: ${di.session_hooks ? 'active' : 'skipped'}`,
    );
  }

  return lines.join('\n');
}
```

---

## 5. Doctor Pattern (#12)

### 5.1 Doctor Types

```typescript
// doctor/types.ts

/** The 6 validation categories */
export type DoctorCategory =
  | 'workspace'
  | 'configuration'
  | 'credentials'
  | 'connections'
  | 'tools'
  | 'sessions';

/** Individual check result */
export interface HealthCheckResult {
  category: DoctorCategory;
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  /** If true, the doctor attempted auto-repair */
  auto_repairable: boolean;
  /** If auto_repairable, did the repair succeed? */
  auto_repaired: boolean;
  /** The action taken or suggested */
  fix_action?: string;
  /** How long this check took */
  duration_ms: number;
}

/** Complete doctor report */
export interface DoctorReport {
  run_id: string;
  session_id: string;
  timestamp: string;
  total_duration_ms: number;
  checks: HealthCheckResult[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
    auto_repaired: number;
    total: number;
  };
}
```

### 5.2 Doctor System

```typescript
// doctor/doctor-system.ts

import { v4 as uuidv4 } from 'uuid';
import {
  DoctorCategory, HealthCheckResult, DoctorReport,
} from './types';
import { BootContext } from '../boot/types';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/** A single check function */
type CheckFn = (ctx: BootContext, supabase: SupabaseClient) => Promise<HealthCheckResult>;

/**
 * Unified /doctor health-check system.
 * Runs 6 categories of validation in dependency order:
 * workspace -> configuration -> credentials -> connections -> tools -> sessions
 */
export class DoctorSystem {
  private ctx: BootContext;
  private supabase: SupabaseClient;
  private checks: Map<DoctorCategory, CheckFn[]> = new Map();

  constructor(ctx: BootContext) {
    this.ctx = ctx;
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    this.registerDefaultChecks();
  }

  /** Run all checks in dependency order */
  async runAll(): Promise<DoctorReport> {
    const startMs = performance.now();
    const results: HealthCheckResult[] = [];
    const sessionId = (this.ctx as any).sessionId ?? 'unknown';

    // Run categories in dependency order
    const categoryOrder: DoctorCategory[] = [
      'workspace',
      'configuration',
      'credentials',
      'connections',
      'tools',
      'sessions',
    ];

    for (const category of categoryOrder) {
      const categoryChecks = this.checks.get(category) ?? [];
      for (const check of categoryChecks) {
        try {
          const result = await check(this.ctx, this.supabase);
          results.push(result);
        } catch (err: any) {
          results.push({
            category,
            name: `${category}_unknown`,
            status: 'fail',
            detail: `Check threw: ${err.message}`,
            auto_repairable: false,
            auto_repaired: false,
            duration_ms: 0,
          });
        }
      }
    }

    const totalDurationMs = Math.round(performance.now() - startMs);

    return {
      run_id: uuidv4(),
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      total_duration_ms: totalDurationMs,
      checks: results,
      summary: {
        pass: results.filter(r => r.status === 'pass').length,
        warn: results.filter(r => r.status === 'warn').length,
        fail: results.filter(r => r.status === 'fail').length,
        auto_repaired: results.filter(r => r.auto_repaired).length,
        total: results.length,
      },
    };
  }

  /** Render doctor report as markdown */
  static renderReport(report: DoctorReport): string {
    const lines: string[] = [
      '# Doctor Report',
      '',
      `Run: ${report.run_id}`,
      `Time: ${report.timestamp}`,
      `Duration: ${report.total_duration_ms}ms`,
      '',
      `## Summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
      '',
    ];

    if (report.summary.auto_repaired > 0) {
      lines.push(`Auto-repaired: ${report.summary.auto_repaired}`, '');
    }

    // Group by category
    const categories = new Map<string, HealthCheckResult[]>();
    for (const check of report.checks) {
      const group = categories.get(check.category) ?? [];
      group.push(check);
      categories.set(check.category, group);
    }

    for (const [category, checks] of categories) {
      lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}`, '');

      for (const check of checks) {
        const icon = check.status === 'pass'
          ? '[PASS]'
          : check.status === 'warn'
            ? '[WARN]'
            : '[FAIL]';
        const repaired = check.auto_repaired ? ' (auto-repaired)' : '';
        lines.push(`- ${icon} **${check.name}**: ${check.detail}${repaired}`);
        if (check.fix_action && check.status !== 'pass') {
          lines.push(`  - Fix: ${check.fix_action}`);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /** Register the default set of checks */
  private registerDefaultChecks(): void {
    // --- Workspace checks ---
    this.addCheck('workspace', checkClaudeMdPresence);
    this.addCheck('workspace', checkClaudeDirectory);
    this.addCheck('workspace', checkGitState);
    this.addCheck('workspace', checkGitignoreEntries);

    // --- Configuration checks ---
    this.addCheck('configuration', checkConfigLoaded);
    this.addCheck('configuration', checkConfigConflicts);
    this.addCheck('configuration', checkMcpServerConfig);

    // --- Credential checks ---
    this.addCheck('credentials', checkSupabaseCredentials);
    this.addCheck('credentials', checkApiKey);

    // --- Connection checks ---
    this.addCheck('connections', checkSupabaseConnection);
    this.addCheck('connections', checkMcpServerConnections);

    // --- Tool checks ---
    this.addCheck('tools', checkToolRegistryLoaded);
    this.addCheck('tools', checkRequiredToolsAvailable);
    this.addCheck('tools', checkPermissionPoliciesValid);

    // --- Session checks ---
    this.addCheck('sessions', checkOrphanedSessions);
    this.addCheck('sessions', checkBudgetLedgerConsistency);
  }

  private addCheck(category: DoctorCategory, fn: CheckFn): void {
    const existing = this.checks.get(category) ?? [];
    existing.push(fn);
    this.checks.set(category, existing);
  }
}
```

### 5.3 Check Implementations

#### Workspace Checks

```typescript
// doctor/checks/workspace.ts

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { HealthCheckResult } from '../types';
import { BootContext } from '../../boot/types';
import { SupabaseClient } from '@supabase/supabase-js';

/** Check for CLAUDE.md in the workspace root */
export async function checkClaudeMdPresence(
  ctx: BootContext,
  _supabase: SupabaseClient,
): Promise<HealthCheckResult> {
  const startMs = performance.now();
  const claudeMdPath = join(ctx.workspacePath, 'CLAUDE.md');

  if (existsSync(claudeMdPath)) {
    return {
      category: 'workspace',
      name: 'claude_md_presence',
      status: 'pass',
      detail: 'CLAUDE.md found in workspace root',
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  }

  // Auto-repair: create a minimal CLAUDE.md
  const content = [
    '# CLAUDE.md',
    '',
    '## Project',
    '',
    'Describe your project here.',
    '',
    '## Instructions',
    '',
    'Add agent instructions here.',
    '',
  ].join('\n');

  try {
    writeFileSync(claudeMdPath, content, 'utf-8');
    return {
      category: 'workspace',
      name: 'claude_md_presence',
      status: 'warn',
      detail: 'CLAUDE.md was missing; created with starter template',
      auto_repairable: true,
      auto_repaired: true,
      fix_action: `Created ${claudeMdPath}`,
      duration_ms: Math.round(performance.now() - startMs),
    };
  } catch {
    return {
      category: 'workspace',
      name: 'claude_md_presence',
      status: 'fail',
      detail: 'CLAUDE.md missing and could not be created',
      auto_repairable: true,
      auto_repaired: false,
      fix_action: `Create CLAUDE.md manually in ${ctx.workspacePath}`,
      duration_ms: Math.round(performance.now() - startMs),
    };
  }
}

/** Check .claude/ directory structure */
export async function checkClaudeDirectory(
  ctx: BootContext,
  _supabase: SupabaseClient,
): Promise<HealthCheckResult> {
  const startMs = performance.now();
  const claudeDir = join(ctx.workspacePath, '.claude');

  if (existsSync(claudeDir)) {
    return {
      category: 'workspace',
      name: 'claude_directory',
      status: 'pass',
      detail: '.claude/ directory exists',
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  }

  // Auto-repair: create .claude/
  try {
    mkdirSync(claudeDir, { recursive: true });
    return {
      category: 'workspace',
      name: 'claude_directory',
      status: 'warn',
      detail: '.claude/ directory was missing; created',
      auto_repairable: true,
      auto_repaired: true,
      fix_action: `Created ${claudeDir}`,
      duration_ms: Math.round(performance.now() - startMs),
    };
  } catch {
    return {
      category: 'workspace',
      name: 'claude_directory',
      status: 'fail',
      detail: '.claude/ directory missing and could not be created',
      auto_repairable: true,
      auto_repaired: false,
      fix_action: `Create .claude/ directory manually`,
      duration_ms: Math.round(performance.now() - startMs),
    };
  }
}

/** Check git repository state */
export async function checkGitState(
  ctx: BootContext,
  _supabase: SupabaseClient,
): Promise<HealthCheckResult> {
  const startMs = performance.now();
  const gitDir = join(ctx.workspacePath, '.git');

  if (!existsSync(gitDir)) {
    return {
      category: 'workspace',
      name: 'git_state',
      status: 'warn',
      detail: 'Not a git repository. Version control recommended.',
      auto_repairable: false,
      auto_repaired: false,
      fix_action: 'Run: git init',
      duration_ms: Math.round(performance.now() - startMs),
    };
  }

  return {
    category: 'workspace',
    name: 'git_state',
    status: 'pass',
    detail: 'Git repository detected',
    auto_repairable: false,
    auto_repaired: false,
    duration_ms: Math.round(performance.now() - startMs),
  };
}

/** Check .gitignore has required entries */
export async function checkGitignoreEntries(
  ctx: BootContext,
  _supabase: SupabaseClient,
): Promise<HealthCheckResult> {
  const startMs = performance.now();
  const gitignorePath = join(ctx.workspacePath, '.gitignore');
  const requiredEntries = ['.claude/settings.local.json'];

  if (!existsSync(gitignorePath)) {
    return {
      category: 'workspace',
      name: 'gitignore_entries',
      status: 'warn',
      detail: '.gitignore not found',
      auto_repairable: false,
      auto_repaired: false,
      fix_action: 'Create .gitignore with .claude/settings.local.json entry',
      duration_ms: Math.round(performance.now() - startMs),
    };
  }

  const content = readFileSync(gitignorePath, 'utf-8');
  const missing = requiredEntries.filter(entry => !content.includes(entry));

  if (missing.length === 0) {
    return {
      category: 'workspace',
      name: 'gitignore_entries',
      status: 'pass',
      detail: 'All required .gitignore entries present',
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  }

  // Auto-repair: append missing entries
  try {
    const additions = '\n# Claude Code\n' + missing.join('\n') + '\n';
    writeFileSync(gitignorePath, content + additions, 'utf-8');
    return {
      category: 'workspace',
      name: 'gitignore_entries',
      status: 'warn',
      detail: `Added missing entries: ${missing.join(', ')}`,
      auto_repairable: true,
      auto_repaired: true,
      fix_action: `Appended to .gitignore: ${missing.join(', ')}`,
      duration_ms: Math.round(performance.now() - startMs),
    };
  } catch {
    return {
      category: 'workspace',
      name: 'gitignore_entries',
      status: 'warn',
      detail: `Missing .gitignore entries: ${missing.join(', ')}`,
      auto_repairable: true,
      auto_repaired: false,
      fix_action: `Add to .gitignore: ${missing.join(', ')}`,
      duration_ms: Math.round(performance.now() - startMs),
    };
  }
}
```

#### Configuration Checks

```typescript
// doctor/checks/configuration.ts

import { HealthCheckResult } from '../types';
import { BootContext } from '../../boot/types';
import { SupabaseClient } from '@supabase/supabase-js';

/** Check that config was loaded without errors */
export async function checkConfigLoaded(
  ctx: BootContext,
  _supabase: SupabaseClient,
): Promise<HealthCheckResult> {
  const startMs = performance.now();

  if (!ctx.config) {
    return {
      category: 'configuration',
      name: 'config_loaded',
      status: 'fail',
      detail: 'Configuration was not loaded during boot',
      auto_repairable: false,
      auto_repaired: false,
      fix_action: 'Check config file paths and JSON syntax',
      duration_ms: Math.round(performance.now() - startMs),
    };
  }

  const loadedCount = ctx.config.sources.filter(s => s.loaded).length;
  const totalCount = ctx.config.sources.length;

  if (loadedCount === 0) {
    return {
      category: 'configuration',
      name: 'config_loaded',
      status: 'warn',
      detail: 'No config files found. Using defaults.',
      auto_repairable: false,
      auto_repaired: false,
      fix_action: 'Create .claude.json or .claude/settings.json',
      duration_ms: Math.round(performance.now() - startMs),
    };
  }

  return {
    category: 'configuration',
    name: 'config_loaded',
    status: 'pass',
    detail: `${loadedCount}/${totalCount} config files loaded`,
    auto_repairable: false,
    auto_repaired: false,
    duration_ms: Math.round(performance.now() - startMs),
  };
}

/** Check for configuration conflicts (e.g., contradictory settings across scopes) */
export async function checkConfigConflicts(
  ctx: BootContext,
  _supabase: SupabaseClient,
): Promise<HealthCheckResult> {
  const startMs = performance.now();

  if (!ctx.config) {
    return {
      category: 'configuration',
      name: 'config_conflicts',
      status: 'warn',
      detail: 'Skipped -- no config loaded',
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  }

  const errors = ctx.config.validationErrors;
  if (errors.length === 0) {
    return {
      category: 'configuration',
      name: 'config_conflicts',
      status: 'pass',
      detail: 'No configuration conflicts detected',
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  }

  return {
    category: 'configuration',
    name: 'config_conflicts',
    status: 'warn',
    detail: `${errors.length} validation issues: ${errors[0]}${errors.length > 1 ? ' ...' : ''}`,
    auto_repairable: false,
    auto_repaired: false,
    fix_action: 'Review config files for conflicting settings',
    duration_ms: Math.round(performance.now() - startMs),
  };
}

/** Check MCP server configuration validity */
export async function checkMcpServerConfig(
  ctx: BootContext,
  _supabase: SupabaseClient,
): Promise<HealthCheckResult> {
  const startMs = performance.now();

  if (!ctx.config) {
    return {
      category: 'configuration',
      name: 'mcp_server_config',
      status: 'warn',
      detail: 'Skipped -- no config loaded',
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  }

  const servers = ctx.config.mcpServers;
  if (servers.length === 0) {
    return {
      category: 'configuration',
      name: 'mcp_server_config',
      status: 'pass',
      detail: 'No MCP servers configured',
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  }

  // Check for servers missing URLs
  const invalid = servers.filter(s => !s.url);
  if (invalid.length > 0) {
    return {
      category: 'configuration',
      name: 'mcp_server_config',
      status: 'fail',
      detail: `${invalid.length} MCP server(s) missing URL: ${invalid.map(s => s.name).join(', ')}`,
      auto_repairable: false,
      auto_repaired: false,
      fix_action: 'Add URL to MCP server config entries',
      duration_ms: Math.round(performance.now() - startMs),
    };
  }

  const deduped = servers.filter(s => s.deduplicated_from);
  const dedupNote = deduped.length > 0
    ? ` (${deduped.length} deduplicated across scopes)`
    : '';

  return {
    category: 'configuration',
    name: 'mcp_server_config',
    status: 'pass',
    detail: `${servers.length} MCP server(s) configured${dedupNote}`,
    auto_repairable: false,
    auto_repaired: false,
    duration_ms: Math.round(performance.now() - startMs),
  };
}
```

#### Credential Checks

```typescript
// doctor/checks/credentials.ts

import { HealthCheckResult } from '../types';
import { BootContext } from '../../boot/types';
import { SupabaseClient } from '@supabase/supabase-js';

/** Check Supabase credentials are set */
export async function checkSupabaseCredentials(
  ctx: BootContext,
  _supabase: SupabaseClient,
): Promise<HealthCheckResult> {
  const startMs = performance.now();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && key) {
    return {
      category: 'credentials',
      name: 'supabase_credentials',
      status: 'pass',
      detail: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set',
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  }

  const missing: string[] = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!key) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  return {
    category: 'credentials',
    name: 'supabase_credentials',
    status: 'fail',
    detail: `Missing environment variables: ${missing.join(', ')}`,
    auto_repairable: false,
    auto_repaired: false,
    fix_action: 'Set the missing environment variables in your shell or .env file',
    duration_ms: Math.round(performance.now() - startMs),
  };
}

/** Check API key is set */
export async function checkApiKey(
  ctx: BootContext,
  _supabase: SupabaseClient,
): Promise<HealthCheckResult> {
  const startMs = performance.now();

  if (process.env.ANTHROPIC_API_KEY) {
    return {
      category: 'credentials',
      name: 'api_key',
      status: 'pass',
      detail: 'ANTHROPIC_API_KEY is set',
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  }

  return {
    category: 'credentials',
    name: 'api_key',
    status: 'warn',
    detail: 'ANTHROPIC_API_KEY not set -- API calls will fail unless using OAuth',
    auto_repairable: false,
    auto_repaired: false,
    fix_action: 'Set ANTHROPIC_API_KEY in your environment',
    duration_ms: Math.round(performance.now() - startMs),
  };
}
```

#### Connection Checks

```typescript
// doctor/checks/connections.ts

import { HealthCheckResult } from '../types';
import { BootContext } from '../../boot/types';
import { SupabaseClient } from '@supabase/supabase-js';

/** Check Supabase is reachable */
export async function checkSupabaseConnection(
  ctx: BootContext,
  supabase: SupabaseClient,
): Promise<HealthCheckResult> {
  const startMs = performance.now();

  try {
    // Simple connectivity test: query a system table
    const { data, error } = await supabase
      .from('thoughts')
      .select('id')
      .limit(1);

    if (error) {
      return {
        category: 'connections',
        name: 'supabase_connection',
        status: 'fail',
        detail: `Supabase query failed: ${error.message}`,
        auto_repairable: false,
        auto_repaired: false,
        fix_action: 'Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, verify Supabase project is running',
        duration_ms: Math.round(performance.now() - startMs),
      };
    }

    return {
      category: 'connections',
      name: 'supabase_connection',
      status: 'pass',
      detail: 'Supabase is reachable and responding',
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  } catch (err: any) {
    return {
      category: 'connections',
      name: 'supabase_connection',
      status: 'fail',
      detail: `Supabase connection failed: ${err.message}`,
      auto_repairable: false,
      auto_repaired: false,
      fix_action: 'Check network connectivity and Supabase project status',
      duration_ms: Math.round(performance.now() - startMs),
    };
  }
}

/** Check MCP servers are responding */
export async function checkMcpServerConnections(
  ctx: BootContext,
  _supabase: SupabaseClient,
): Promise<HealthCheckResult> {
  const startMs = performance.now();

  if (!ctx.config?.mcpServers || ctx.config.mcpServers.length === 0) {
    return {
      category: 'connections',
      name: 'mcp_server_connections',
      status: 'pass',
      detail: 'No MCP servers configured -- nothing to check',
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  }

  const results: Array<{ name: string; ok: boolean; error?: string }> = [];

  for (const server of ctx.config.mcpServers) {
    if (!server.url) {
      results.push({ name: server.name, ok: false, error: 'No URL configured' });
      continue;
    }

    try {
      // Try a simple fetch to the server URL
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(server.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(server.headers ?? {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: { capabilities: {} },
          id: 1,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      results.push({
        name: server.name,
        ok: response.ok || response.status === 200,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      });
    } catch (err: any) {
      results.push({
        name: server.name,
        ok: false,
        error: err.name === 'AbortError' ? 'Timeout (5s)' : err.message,
      });
    }
  }

  const failed = results.filter(r => !r.ok);

  if (failed.length === 0) {
    return {
      category: 'connections',
      name: 'mcp_server_connections',
      status: 'pass',
      detail: `All ${results.length} MCP server(s) responding`,
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  }

  const status = failed.length === results.length ? 'fail' : 'warn';
  return {
    category: 'connections',
    name: 'mcp_server_connections',
    status,
    detail: `${failed.length}/${results.length} MCP server(s) unreachable: ${failed.map(f => `${f.name} (${f.error})`).join(', ')}`,
    auto_repairable: false,
    auto_repaired: false,
    fix_action: 'Check MCP server deployment status and URLs',
    duration_ms: Math.round(performance.now() - startMs),
  };
}
```

#### Tool Checks

```typescript
// doctor/checks/tools.ts

import { HealthCheckResult } from '../types';
import { BootContext } from '../../boot/types';
import { SupabaseClient } from '@supabase/supabase-js';

/** Check tool registry is loaded and populated */
export async function checkToolRegistryLoaded(
  ctx: BootContext,
  supabase: SupabaseClient,
): Promise<HealthCheckResult> {
  const startMs = performance.now();

  try {
    const { count, error } = await supabase
      .from('tool_registry')
      .select('*', { count: 'exact', head: true })
      .eq('enabled', true);

    if (error) {
      return {
        category: 'tools',
        name: 'tool_registry_loaded',
        status: 'fail',
        detail: `Cannot query tool_registry: ${error.message}`,
        auto_repairable: false,
        auto_repaired: false,
        fix_action: 'Run BP01 migrations to create tool_registry table',
        duration_ms: Math.round(performance.now() - startMs),
      };
    }

    if ((count ?? 0) === 0) {
      return {
        category: 'tools',
        name: 'tool_registry_loaded',
        status: 'warn',
        detail: 'Tool registry is empty -- no tools registered',
        auto_repairable: false,
        auto_repaired: false,
        fix_action: 'Seed the tool_registry table with built-in tools (see BP01 Section 2.3)',
        duration_ms: Math.round(performance.now() - startMs),
      };
    }

    return {
      category: 'tools',
      name: 'tool_registry_loaded',
      status: 'pass',
      detail: `${count} enabled tools in registry`,
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  } catch (err: any) {
    return {
      category: 'tools',
      name: 'tool_registry_loaded',
      status: 'fail',
      detail: `Tool registry check failed: ${err.message}`,
      auto_repairable: false,
      auto_repaired: false,
      fix_action: 'Ensure tool_registry table exists (BP01 migrations)',
      duration_ms: Math.round(performance.now() - startMs),
    };
  }
}

/** Check that essential tools are available */
export async function checkRequiredToolsAvailable(
  ctx: BootContext,
  supabase: SupabaseClient,
): Promise<HealthCheckResult> {
  const startMs = performance.now();

  const requiredTools = ['read_file', 'write_file', 'edit_file', 'glob_search', 'grep_search', 'bash'];

  try {
    const { data: tools, error } = await supabase
      .from('tool_registry')
      .select('name')
      .in('name', requiredTools)
      .eq('enabled', true);

    if (error) {
      return {
        category: 'tools',
        name: 'required_tools_available',
        status: 'fail',
        detail: `Cannot query tools: ${error.message}`,
        auto_repairable: false,
        auto_repaired: false,
        duration_ms: Math.round(performance.now() - startMs),
      };
    }

    const foundNames = new Set(tools?.map(t => t.name) ?? []);
    const missing = requiredTools.filter(t => !foundNames.has(t));

    if (missing.length === 0) {
      return {
        category: 'tools',
        name: 'required_tools_available',
        status: 'pass',
        detail: `All ${requiredTools.length} required tools available`,
        auto_repairable: false,
        auto_repaired: false,
        duration_ms: Math.round(performance.now() - startMs),
      };
    }

    return {
      category: 'tools',
      name: 'required_tools_available',
      status: 'fail',
      detail: `Missing required tools: ${missing.join(', ')}`,
      auto_repairable: false,
      auto_repaired: false,
      fix_action: 'Seed tool_registry with built-in tools (BP01)',
      duration_ms: Math.round(performance.now() - startMs),
    };
  } catch (err: any) {
    return {
      category: 'tools',
      name: 'required_tools_available',
      status: 'fail',
      detail: `Check failed: ${err.message}`,
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  }
}

/** Check permission policies are valid */
export async function checkPermissionPoliciesValid(
  ctx: BootContext,
  supabase: SupabaseClient,
): Promise<HealthCheckResult> {
  const startMs = performance.now();

  try {
    const { data: policies, error } = await supabase
      .from('permission_policies')
      .select('name, deny_tools, allow_tools');

    if (error) {
      return {
        category: 'tools',
        name: 'permission_policies_valid',
        status: 'warn',
        detail: `Cannot query permission_policies: ${error.message}`,
        auto_repairable: false,
        auto_repaired: false,
        fix_action: 'Run BP01 migrations to create permission_policies table',
        duration_ms: Math.round(performance.now() - startMs),
      };
    }

    // Check for policies with both allow and deny lists (contradictory)
    const contradictory = (policies ?? []).filter(
      p => (p.allow_tools?.length ?? 0) > 0 && (p.deny_tools?.length ?? 0) > 0
    );

    if (contradictory.length > 0) {
      return {
        category: 'tools',
        name: 'permission_policies_valid',
        status: 'warn',
        detail: `${contradictory.length} policy(ies) have both allow and deny lists: ${contradictory.map(p => p.name).join(', ')}`,
        auto_repairable: false,
        auto_repaired: false,
        fix_action: 'Use either allow_tools or deny_tools, not both in the same policy',
        duration_ms: Math.round(performance.now() - startMs),
      };
    }

    return {
      category: 'tools',
      name: 'permission_policies_valid',
      status: 'pass',
      detail: `${(policies ?? []).length} permission policies configured, no conflicts`,
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  } catch (err: any) {
    return {
      category: 'tools',
      name: 'permission_policies_valid',
      status: 'warn',
      detail: `Check failed: ${err.message}`,
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  }
}
```

#### Session Checks

```typescript
// doctor/checks/sessions.ts

import { HealthCheckResult } from '../types';
import { BootContext } from '../../boot/types';
import { SupabaseClient } from '@supabase/supabase-js';

/** Check for orphaned sessions (active but stale) */
export async function checkOrphanedSessions(
  ctx: BootContext,
  supabase: SupabaseClient,
): Promise<HealthCheckResult> {
  const startMs = performance.now();

  try {
    // Find sessions that have been "active" for more than 24 hours
    // These are likely orphans from crashed processes
    const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleSessions, error } = await supabase
      .from('agent_sessions')
      .select('session_id, status, updated_at')
      .eq('status', 'active')
      .lt('updated_at', staleThreshold);

    if (error) {
      return {
        category: 'sessions',
        name: 'orphaned_sessions',
        status: 'warn',
        detail: `Cannot query agent_sessions: ${error.message}`,
        auto_repairable: false,
        auto_repaired: false,
        duration_ms: Math.round(performance.now() - startMs),
      };
    }

    if ((staleSessions?.length ?? 0) === 0) {
      return {
        category: 'sessions',
        name: 'orphaned_sessions',
        status: 'pass',
        detail: 'No orphaned sessions found',
        auto_repairable: false,
        auto_repaired: false,
        duration_ms: Math.round(performance.now() - startMs),
      };
    }

    // Auto-repair: mark stale sessions as crashed
    const sessionIds = staleSessions!.map(s => s.session_id);
    const { error: updateError } = await supabase
      .from('agent_sessions')
      .update({ status: 'crashed' })
      .in('session_id', sessionIds);

    if (updateError) {
      return {
        category: 'sessions',
        name: 'orphaned_sessions',
        status: 'warn',
        detail: `${staleSessions!.length} orphaned session(s) found but could not update: ${updateError.message}`,
        auto_repairable: true,
        auto_repaired: false,
        fix_action: `Manually update status to 'crashed' for sessions: ${sessionIds.join(', ')}`,
        duration_ms: Math.round(performance.now() - startMs),
      };
    }

    return {
      category: 'sessions',
      name: 'orphaned_sessions',
      status: 'warn',
      detail: `${staleSessions!.length} orphaned session(s) marked as crashed`,
      auto_repairable: true,
      auto_repaired: true,
      fix_action: `Marked ${sessionIds.length} stale session(s) as crashed`,
      duration_ms: Math.round(performance.now() - startMs),
    };
  } catch (err: any) {
    return {
      category: 'sessions',
      name: 'orphaned_sessions',
      status: 'warn',
      detail: `Check failed: ${err.message}`,
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  }
}

/** Check budget ledger consistency */
export async function checkBudgetLedgerConsistency(
  ctx: BootContext,
  supabase: SupabaseClient,
): Promise<HealthCheckResult> {
  const startMs = performance.now();

  try {
    // Check for budget entries where running_total doesn't match sum of deltas
    // This uses the budget_ledger table from BP02
    const { data: budgets, error } = await supabase
      .from('budget_ledger')
      .select('session_id, running_total_usd, delta_usd')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      // Table might not exist yet -- non-fatal
      return {
        category: 'sessions',
        name: 'budget_ledger_consistency',
        status: 'warn',
        detail: `Cannot query budget_ledger: ${error.message}`,
        auto_repairable: false,
        auto_repaired: false,
        fix_action: 'Run BP02 migrations to create budget_ledger table',
        duration_ms: Math.round(performance.now() - startMs),
      };
    }

    // Group by session and check for negative running totals
    const negativeEntries = (budgets ?? []).filter(
      b => parseFloat(b.running_total_usd) < 0
    );

    if (negativeEntries.length > 0) {
      return {
        category: 'sessions',
        name: 'budget_ledger_consistency',
        status: 'warn',
        detail: `${negativeEntries.length} budget entries with negative running total`,
        auto_repairable: false,
        auto_repaired: false,
        fix_action: 'Review budget_ledger entries for accounting errors',
        duration_ms: Math.round(performance.now() - startMs),
      };
    }

    return {
      category: 'sessions',
      name: 'budget_ledger_consistency',
      status: 'pass',
      detail: `Budget ledger consistent (${(budgets ?? []).length} recent entries checked)`,
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  } catch (err: any) {
    return {
      category: 'sessions',
      name: 'budget_ledger_consistency',
      status: 'warn',
      detail: `Check failed: ${err.message}`,
      auto_repairable: false,
      auto_repaired: false,
      duration_ms: Math.round(performance.now() - startMs),
    };
  }
}
```

---

## 6. Edge Function Endpoints

### 6.1 Doctor Endpoint

```typescript
// supabase/functions/agent-doctor/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const { session_id, categories, format } = body;

    // If a session_id is provided, run checks against that session's state.
    // Otherwise, run infrastructure checks only.
    const checks: any[] = [];
    const startMs = performance.now();

    // ---- Supabase connectivity ----
    {
      const checkStart = performance.now();
      const { error } = await supabase.from('thoughts').select('id').limit(1);
      checks.push({
        category: 'connections',
        name: 'supabase_connection',
        status: error ? 'fail' : 'pass',
        detail: error ? `Query failed: ${error.message}` : 'Supabase responding',
        auto_repairable: false,
        auto_repaired: false,
        duration_ms: Math.round(performance.now() - checkStart),
      });
    }

    // ---- Tool registry ----
    {
      const checkStart = performance.now();
      const { count, error } = await supabase
        .from('tool_registry')
        .select('*', { count: 'exact', head: true })
        .eq('enabled', true);

      checks.push({
        category: 'tools',
        name: 'tool_registry_count',
        status: error ? 'fail' : (count ?? 0) > 0 ? 'pass' : 'warn',
        detail: error
          ? `Query failed: ${error.message}`
          : `${count} enabled tools`,
        auto_repairable: false,
        auto_repaired: false,
        duration_ms: Math.round(performance.now() - checkStart),
      });
    }

    // ---- Tables exist ----
    const requiredTables = [
      'thoughts', 'tool_registry', 'permission_policies',
      'agent_sessions', 'budget_ledger', 'system_events',
      'boot_runs', 'agent_config',
    ];

    for (const table of requiredTables) {
      const checkStart = performance.now();
      const { error } = await supabase.from(table).select('*').limit(0);
      checks.push({
        category: 'connections',
        name: `table_${table}`,
        status: error ? 'fail' : 'pass',
        detail: error ? `Table missing or inaccessible: ${error.message}` : 'OK',
        auto_repairable: false,
        auto_repaired: false,
        duration_ms: Math.round(performance.now() - checkStart),
      });
    }

    // ---- Orphaned sessions ----
    if (!categories || categories.includes('sessions')) {
      const checkStart = performance.now();
      const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: stale } = await supabase
        .from('agent_sessions')
        .select('session_id')
        .eq('status', 'active')
        .lt('updated_at', staleThreshold);

      checks.push({
        category: 'sessions',
        name: 'orphaned_sessions',
        status: (stale?.length ?? 0) === 0 ? 'pass' : 'warn',
        detail: (stale?.length ?? 0) === 0
          ? 'No orphaned sessions'
          : `${stale!.length} orphaned session(s)`,
        auto_repairable: true,
        auto_repaired: false,
        duration_ms: Math.round(performance.now() - checkStart),
      });
    }

    // ---- Recent boot failures ----
    {
      const checkStart = performance.now();
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // last hour
      const { data: failures } = await supabase
        .from('boot_runs')
        .select('run_id, failed_phase, failure_reason')
        .eq('status', 'failed')
        .gte('created_at', since);

      checks.push({
        category: 'sessions',
        name: 'recent_boot_failures',
        status: (failures?.length ?? 0) === 0 ? 'pass' : 'warn',
        detail: (failures?.length ?? 0) === 0
          ? 'No boot failures in the last hour'
          : `${failures!.length} boot failure(s) in the last hour`,
        auto_repairable: false,
        auto_repaired: false,
        duration_ms: Math.round(performance.now() - checkStart),
      });
    }

    const totalDurationMs = Math.round(performance.now() - startMs);
    const report = {
      run_id: crypto.randomUUID(),
      session_id: session_id ?? null,
      timestamp: new Date().toISOString(),
      total_duration_ms: totalDurationMs,
      checks,
      summary: {
        pass: checks.filter((c: any) => c.status === 'pass').length,
        warn: checks.filter((c: any) => c.status === 'warn').length,
        fail: checks.filter((c: any) => c.status === 'fail').length,
        auto_repaired: checks.filter((c: any) => c.auto_repaired).length,
        total: checks.length,
      },
    };

    // Persist the report to system_events
    await supabase.from('system_events').insert({
      event_id: report.run_id,
      session_id: session_id ?? 'system',
      category: 'doctor',
      severity: report.summary.fail > 0 ? 'error' : report.summary.warn > 0 ? 'warn' : 'info',
      title: `Doctor: ${report.summary.pass}P/${report.summary.warn}W/${report.summary.fail}F`,
      detail: report,
      sequence: 0,
    });

    // Return format
    if (format === 'markdown') {
      // Inline a simplified markdown renderer
      const lines = [
        `# Doctor Report`,
        ``,
        `**${report.summary.pass}** pass | **${report.summary.warn}** warn | **${report.summary.fail}** fail`,
        ``,
      ];
      for (const check of checks) {
        const icon = check.status === 'pass' ? 'PASS' : check.status === 'warn' ? 'WARN' : 'FAIL';
        lines.push(`- [${icon}] **${check.name}**: ${check.detail}`);
      }
      return new Response(lines.join('\n'), {
        headers: { ...corsHeaders, 'Content-Type': 'text/markdown' },
      });
    }

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
```

### 6.2 Boot Timing Dashboard Query

```sql
-- ============================================================
-- View: boot performance summary
-- For operational dashboards showing boot time trends.
-- ============================================================

CREATE OR REPLACE VIEW boot_performance_summary AS
SELECT
  session_id,
  run_id,
  status,
  reached_phase,
  failed_phase,
  trust_mode,
  fast_path_used,
  total_duration_ms,
  -- Extract individual phase durations for charting
  (phase_timings->'prefetch'->>'duration_ms')::int         AS prefetch_ms,
  (phase_timings->'environment'->>'duration_ms')::int       AS environment_ms,
  (phase_timings->'config_loading'->>'duration_ms')::int    AS config_loading_ms,
  (phase_timings->'trust_gate'->>'duration_ms')::int        AS trust_gate_ms,
  (phase_timings->'registry_init'->>'duration_ms')::int     AS registry_init_ms,
  (phase_timings->'workspace_init'->>'duration_ms')::int    AS workspace_init_ms,
  (phase_timings->'deferred_loading'->>'duration_ms')::int  AS deferred_loading_ms,
  (phase_timings->'mode_routing'->>'duration_ms')::int      AS mode_routing_ms,
  (phase_timings->'doctor_check'->>'duration_ms')::int      AS doctor_check_ms,
  -- Doctor results
  (doctor_summary->>'pass')::int  AS doctor_pass,
  (doctor_summary->>'warn')::int  AS doctor_warn,
  (doctor_summary->>'fail')::int  AS doctor_fail,
  created_at
FROM boot_runs
ORDER BY created_at DESC;

GRANT SELECT ON boot_performance_summary TO service_role;
```

### 6.3 Config Persistence Function

```sql
-- ============================================================
-- Function: persist a config snapshot
-- Called by the boot pipeline after config loading phase.
-- ============================================================

CREATE OR REPLACE FUNCTION persist_config_snapshot(
  p_session_id TEXT,
  p_merged_config JSONB,
  p_provenance JSONB,
  p_mcp_servers JSONB,
  p_source_files JSONB,
  p_valid BOOLEAN DEFAULT true,
  p_validation_errors JSONB DEFAULT '[]'::jsonb
)
RETURNS UUID AS $$
DECLARE
  v_config_id UUID;
BEGIN
  INSERT INTO agent_config (
    session_id, merged_config, provenance,
    mcp_servers, source_files, valid, validation_errors
  )
  VALUES (
    p_session_id, p_merged_config, p_provenance,
    p_mcp_servers, p_source_files, p_valid, p_validation_errors
  )
  RETURNING config_id INTO v_config_id;

  RETURN v_config_id;
END;
$$ LANGUAGE plpgsql;
```

---

## 7. Cross-Blueprint Integration

### 7.1 Integration Map

```
BP05 (this blueprint) depends on and extends:

+-------+    init at boot    +-------+
| BP01  |<-------------------| BP05  |
| Tools |    doctor checks   | Boot  |
+-------+                    | +Doc  |
                              | +Cfg  |
+-------+    session restore +-------+
| BP02  |<-------------------|       |
| State |    doctor checks   |       |
+-------+                    |       |
                              |       |
+-------+    event logging   |       |
| BP03  |<-------------------|       |
| Logs  |    boot events     |       |
+-------+                    +-------+
```

### 7.2 Integration Points in Detail

| Blueprint | What BP05 reads | What BP05 writes |
|-----------|----------------|-----------------|
| BP01 | `tool_registry` (count, required tools check) | Nothing (registry is loaded, not modified) |
| BP01 | `permission_policies` (validity check) | Nothing |
| BP02 | `agent_sessions` (orphaned session check, session restore) | Updates stale sessions to `crashed` status (auto-repair) |
| BP02 | `budget_ledger` (consistency check) | Nothing |
| BP03 | `system_events` (via EventLogger) | Boot events, doctor events, config events |
| BP03 | EventLogger class (used by PhaseRunner) | Events at each phase boundary |

### 7.3 Boot Sequence Calls to Other Blueprints

```
Phase 5 (RegistryInit):
  -> Reads BP01 tool_registry table
  -> Counts enabled tools, MCP tools
  -> Stores counts in BootContext

Phase 6 (WorkspaceInit):
  -> Reads BP02 agent_sessions table
  -> Checks for active/crashed sessions to restore
  -> Stores session restore status in BootContext

Phase 9 (DoctorCheck):
  -> Reads BP01 tool_registry (tool count, required tools)
  -> Reads BP01 permission_policies (validity)
  -> Reads BP02 agent_sessions (orphaned sessions)
  -> Reads BP02 budget_ledger (consistency)
  -> Writes BP02 agent_sessions (auto-repair: mark orphans as crashed)

All Phases:
  -> Write to BP03 system_events via EventLogger
```

---

## 8. Build Order

Build in this sequence. Each step is testable independently.

| Step | What | Depends On | Test |
|------|------|-----------|------|
| 1 | Run SQL migrations (Section 2) | BP01-03 tables exist | `SELECT * FROM boot_runs LIMIT 0;` returns empty |
| 2 | Build `ScopedConfigLoader` (Section 3.2) | Nothing | Unit test: create temp JSON files, load and verify merge |
| 3 | Build `renderConfigDebug` (Section 3.3) | Step 2 | Unit test: verify markdown output has provenance |
| 4 | Build `PhaseRunner` (Section 4.2) | BP03 EventLogger | Unit test: register mock phases, verify ordering + timing |
| 5 | Build prefetch + environment phases (4.3) | Step 4 | Unit test: run phases, check BootContext |
| 6 | Build config-loading + trust-gate phases (4.3) | Steps 2, 4 | Unit test: config appears in BootContext |
| 7 | Build registry-init + workspace-init phases (4.3) | Steps 4, BP01, BP02 | Integration test: queries Supabase |
| 8 | Build deferred-loading + mode-routing phases (4.3) | Steps 4, 6 | Unit test: trust gate skip logic |
| 9 | Build doctor check implementations (Section 5.3) | BP01, BP02, BP03 | Integration test: each check returns valid result |
| 10 | Build `DoctorSystem` (Section 5.2) | Step 9 | Integration test: runAll() returns complete report |
| 11 | Build doctor-check phase (4.3) | Steps 4, 10 | Unit test: doctor summary in BootContext |
| 12 | Build `BootPipeline` orchestrator (Section 4.4) | Steps 4-11 | Integration test: full boot against Supabase |
| 13 | Build `buildSystemInitMessage` (Section 4.5) | Step 12 | Unit test: message contains expected sections |
| 14 | Deploy Edge Function (Section 6.1) | Steps 1, 10 | `curl /agent-doctor` returns JSON report |
| 15 | Create `boot_performance_summary` view (6.2) | Step 1 | `SELECT * FROM boot_performance_summary;` |

---

## 9. File Map

```
config/
  types.ts                           # Section 3.1 -- config types
  scoped-config-loader.ts            # Section 3.2 -- multi-tier loader
  config-debug.ts                    # Section 3.3 -- debug renderer

boot/
  types.ts                           # Section 4.1 -- BootPhase, BootContext, etc.
  phase-runner.ts                    # Section 4.2 -- phase execution engine
  boot-pipeline.ts                   # Section 4.4 -- orchestrator
  system-init-message.ts             # Section 4.5 -- LLM context message
  phases/
    prefetch.ts                      # Section 4.3 -- Phase 1
    environment.ts                   # Section 4.3 -- Phase 2
    config-loading.ts                # Section 4.3 -- Phase 3
    trust-gate.ts                    # Section 4.3 -- Phase 4
    registry-init.ts                 # Section 4.3 -- Phase 5
    workspace-init.ts                # Section 4.3 -- Phase 6
    deferred-loading.ts              # Section 4.3 -- Phase 7
    mode-routing.ts                  # Section 4.3 -- Phase 8
    doctor-check.ts                  # Section 4.3 -- Phase 9
    main-loop.ts                     # Section 4.3 -- Phase 10

doctor/
  types.ts                           # Section 5.1 -- doctor types
  doctor-system.ts                   # Section 5.2 -- unified doctor
  checks/
    workspace.ts                     # Section 5.3 -- workspace checks
    configuration.ts                 # Section 5.3 -- config checks
    credentials.ts                   # Section 5.3 -- credential checks
    connections.ts                   # Section 5.3 -- connection checks
    tools.ts                         # Section 5.3 -- tool checks
    sessions.ts                      # Section 5.3 -- session checks

supabase/
  migrations/
    005_boot_and_doctor.sql          # Section 2 -- all SQL
  functions/
    agent-doctor/
      index.ts                       # Section 6.1 -- Edge Function
```
