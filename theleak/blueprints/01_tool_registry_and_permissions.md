# Blueprint 01 — Tool Registry & Permission System

> Primitives #1 (Tool Registry) and #2 (Permission System) for the OB1 agentic architecture.
> Build target: Supabase Edge Functions + MCP protocol + TypeScript runtime.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Tool Registry Architecture](#2-tool-registry-architecture)
3. [Permission System](#3-permission-system)
4. [Permission Audit Trail](#4-permission-audit-trail)
5. [Tool Pool Assembly](#5-tool-pool-assembly)
6. [MCP Integration](#6-mcp-integration)
7. [Edge Function Endpoints](#7-edge-function-endpoints)
8. [Build Order](#8-build-order)

---

## 1. Database Schema

Run these migrations in your Supabase SQL Editor after the core `thoughts` table exists.

### 1.1 Tool Registry Table

```sql
-- Tool definitions: the single source of truth for all registered tools
CREATE TABLE tool_registry (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('built_in', 'plugin', 'skill', 'mcp')),
  required_permission text NOT NULL DEFAULT 'read_only'
    CHECK (required_permission IN ('read_only', 'workspace_write', 'danger_full_access')),
  input_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  side_effect_profile jsonb DEFAULT '{}'::jsonb,
  -- Side effect profile example:
  -- {"writes_files": true, "network_access": false, "destructive": false, "reversible": true}
  enabled boolean NOT NULL DEFAULT true,
  aliases text[] DEFAULT '{}',
  -- For MCP tools: the server origin URL
  mcp_server_url text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Fast lookups by source type and permission level
CREATE INDEX idx_tool_registry_source ON tool_registry (source_type);
CREATE INDEX idx_tool_registry_permission ON tool_registry (required_permission);
CREATE INDEX idx_tool_registry_enabled ON tool_registry (enabled) WHERE enabled = true;

-- Auto-update timestamp
CREATE TRIGGER tool_registry_updated_at
  BEFORE UPDATE ON tool_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

### 1.2 Permission Policies Table

```sql
-- Named permission policies that can be assigned to sessions or agents
CREATE TABLE permission_policies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text,
  -- The baseline mode for this policy
  active_mode text NOT NULL DEFAULT 'read_only'
    CHECK (active_mode IN ('read_only', 'workspace_write', 'danger_full_access', 'prompt', 'allow')),
  -- Per-tool overrides: {"bash": "danger_full_access", "read_file": "read_only"}
  tool_overrides jsonb DEFAULT '{}'::jsonb,
  -- Handler type determines escalation behavior
  handler_type text NOT NULL DEFAULT 'interactive'
    CHECK (handler_type IN ('interactive', 'coordinator', 'swarm_worker')),
  -- Deny lists
  deny_tools text[] DEFAULT '{}',
  deny_prefixes text[] DEFAULT '{}',
  -- Allow list (if non-empty, ONLY these tools are available)
  allow_tools text[] DEFAULT '{}',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER permission_policies_updated_at
  BEFORE UPDATE ON permission_policies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

### 1.3 Permission Audit Log Table

```sql
-- Every permission decision is logged here
CREATE TABLE permission_audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id text NOT NULL,
  tool_name text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('allow', 'deny', 'escalate')),
  reason text,
  -- Who or what made the decision
  decided_by text NOT NULL CHECK (decided_by IN ('policy', 'prompter', 'coordinator', 'swarm_deny')),
  -- The permission mode that was active when the decision was made
  active_mode text NOT NULL,
  required_mode text NOT NULL,
  -- The policy that was evaluated
  policy_id uuid REFERENCES permission_policies(id),
  -- Tool input (redacted/summarized for security — never store raw secrets)
  input_summary text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_session ON permission_audit_log (session_id, created_at DESC);
CREATE INDEX idx_audit_tool ON permission_audit_log (tool_name, created_at DESC);
CREATE INDEX idx_audit_decision ON permission_audit_log (decision);

-- Grant access
GRANT SELECT, INSERT ON TABLE public.tool_registry TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.permission_policies TO service_role;
GRANT SELECT, INSERT ON TABLE public.permission_audit_log TO service_role;

-- RLS
ALTER TABLE tool_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON tool_registry
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON permission_policies
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON permission_audit_log
  FOR ALL USING (auth.role() = 'service_role');
```

### 1.4 Persist Audit Summaries to Thoughts

```sql
-- Function to persist a session's audit summary as a thought
CREATE OR REPLACE FUNCTION persist_permission_audit(
  p_session_id text,
  p_summary jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid AS $$
DECLARE
  v_denial_count int;
  v_total_count int;
  v_content text;
  v_id uuid;
BEGIN
  SELECT COUNT(*) FILTER (WHERE decision = 'deny'),
         COUNT(*)
  INTO v_denial_count, v_total_count
  FROM permission_audit_log
  WHERE session_id = p_session_id;

  v_content := format(
    'Permission audit for session %s: %s decisions total, %s denials.',
    p_session_id, v_total_count, v_denial_count
  );

  INSERT INTO thoughts (content, metadata)
  VALUES (
    v_content,
    jsonb_build_object(
      'type', 'permission_audit',
      'session_id', p_session_id,
      'total_decisions', v_total_count,
      'denial_count', v_denial_count,
      'summary', p_summary,
      'created_at', now()
    )
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;
```

---

## 2. Tool Registry Architecture

### 2.1 Core Principle: Metadata-First

`listTools()` returns metadata without executing anything. The tool definitions sent to the LLM are assembled from the registry, not hardcoded. This means:

- Tools can be registered/unregistered at runtime
- Filtering happens BEFORE the API call (smaller prompt = better performance)
- The same registry serves both the MCP `tools/list` endpoint and internal tool assembly

### 2.2 ToolSpec Type

```typescript
// types/tool-registry.ts

export type SourceType = 'built_in' | 'plugin' | 'skill' | 'mcp';

export type PermissionMode =
  | 'read_only'        // 0 — glob, grep, read, web search
  | 'workspace_write'  // 1 — write, edit, todo, notebook
  | 'danger_full_access' // 2 — bash, agent, REPL, destructive ops
  | 'prompt'           // 3 — ask the handler for each escalation
  | 'allow';           // 4 — everything auto-allowed

// Numeric ordering for comparison
const PERMISSION_RANK: Record<PermissionMode, number> = {
  read_only: 0,
  workspace_write: 1,
  danger_full_access: 2,
  prompt: 3,
  allow: 4,
};

export interface SideEffectProfile {
  writes_files: boolean;
  network_access: boolean;
  destructive: boolean;
  reversible: boolean;
  spawns_process: boolean;
}

export interface ToolSpec {
  name: string;
  description: string;
  source_type: SourceType;
  required_permission: PermissionMode;
  input_schema: Record<string, unknown>; // JSON Schema
  side_effect_profile: SideEffectProfile;
  enabled: boolean;
  aliases: string[];
  mcp_server_url?: string;
  metadata: Record<string, unknown>;
}
```

### 2.3 Built-In Tool Registry (Seed Data)

```typescript
// registry/built-in-tools.ts

import { ToolSpec } from '../types/tool-registry';

export const BUILT_IN_TOOLS: ToolSpec[] = [
  {
    name: 'read_file',
    description: 'Read a file from the filesystem',
    source_type: 'built_in',
    required_permission: 'read_only',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to file' },
        offset: { type: 'number', description: 'Line to start from' },
        limit: { type: 'number', description: 'Number of lines to read' },
      },
      required: ['file_path'],
    },
    side_effect_profile: {
      writes_files: false, network_access: false,
      destructive: false, reversible: true, spawns_process: false,
    },
    enabled: true,
    aliases: ['read'],
    metadata: {},
  },
  {
    name: 'write_file',
    description: 'Write content to a file (overwrites)',
    source_type: 'built_in',
    required_permission: 'workspace_write',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['file_path', 'content'],
    },
    side_effect_profile: {
      writes_files: true, network_access: false,
      destructive: true, reversible: false, spawns_process: false,
    },
    enabled: true,
    aliases: ['write'],
    metadata: {},
  },
  {
    name: 'edit_file',
    description: 'Apply a targeted string replacement to a file',
    source_type: 'built_in',
    required_permission: 'workspace_write',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean', default: false },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
    side_effect_profile: {
      writes_files: true, network_access: false,
      destructive: false, reversible: true, spawns_process: false,
    },
    enabled: true,
    aliases: ['edit'],
    metadata: {},
  },
  {
    name: 'glob_search',
    description: 'Find files by glob pattern',
    source_type: 'built_in',
    required_permission: 'read_only',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' },
      },
      required: ['pattern'],
    },
    side_effect_profile: {
      writes_files: false, network_access: false,
      destructive: false, reversible: true, spawns_process: false,
    },
    enabled: true,
    aliases: ['glob'],
    metadata: {},
  },
  {
    name: 'grep_search',
    description: 'Search file contents with regex',
    source_type: 'built_in',
    required_permission: 'read_only',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' },
        glob: { type: 'string' },
      },
      required: ['pattern'],
    },
    side_effect_profile: {
      writes_files: false, network_access: false,
      destructive: false, reversible: true, spawns_process: false,
    },
    enabled: true,
    aliases: ['grep'],
    metadata: {},
  },
  {
    name: 'bash',
    description: 'Execute a shell command',
    source_type: 'built_in',
    required_permission: 'danger_full_access',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout: { type: 'number' },
      },
      required: ['command'],
    },
    side_effect_profile: {
      writes_files: true, network_access: true,
      destructive: true, reversible: false, spawns_process: true,
    },
    enabled: true,
    aliases: ['shell', 'exec'],
    metadata: {},
  },
  {
    name: 'web_fetch',
    description: 'Fetch content from a URL',
    source_type: 'built_in',
    required_permission: 'read_only',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
      },
      required: ['url'],
    },
    side_effect_profile: {
      writes_files: false, network_access: true,
      destructive: false, reversible: true, spawns_process: false,
    },
    enabled: true,
    aliases: ['fetch'],
    metadata: {},
  },
  {
    name: 'agent',
    description: 'Spawn a sub-agent with scoped tools and permissions',
    source_type: 'built_in',
    required_permission: 'danger_full_access',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        allowed_tools: { type: 'array', items: { type: 'string' } },
        permission_mode: { type: 'string' },
      },
      required: ['prompt'],
    },
    side_effect_profile: {
      writes_files: true, network_access: true,
      destructive: true, reversible: false, spawns_process: true,
    },
    enabled: true,
    aliases: [],
    metadata: {},
  },
  {
    name: 'tool_search',
    description: 'Discover deferred/MCP tools at runtime by name or keyword',
    source_type: 'built_in',
    required_permission: 'read_only',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        max_results: { type: 'number', default: 5 },
      },
      required: ['query'],
    },
    side_effect_profile: {
      writes_files: false, network_access: false,
      destructive: false, reversible: true, spawns_process: false,
    },
    enabled: true,
    aliases: [],
    metadata: { is_meta_tool: true },
  },
];
```

### 2.4 Registration and Discovery

```typescript
// registry/tool-registry.ts

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ToolSpec, PermissionMode } from '../types/tool-registry';
import { BUILT_IN_TOOLS } from './built-in-tools';

export class ToolRegistry {
  private supabase: SupabaseClient;
  // In-memory cache, refreshed on demand
  private cache: Map<string, ToolSpec> = new Map();
  private aliasMap: Map<string, string> = new Map();

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  // --- Registration ---

  async seedBuiltIns(): Promise<void> {
    for (const tool of BUILT_IN_TOOLS) {
      await this.register(tool);
    }
  }

  async register(spec: ToolSpec): Promise<void> {
    const { error } = await this.supabase
      .from('tool_registry')
      .upsert({
        name: spec.name,
        description: spec.description,
        source_type: spec.source_type,
        required_permission: spec.required_permission,
        input_schema: spec.input_schema,
        side_effect_profile: spec.side_effect_profile,
        enabled: spec.enabled,
        aliases: spec.aliases,
        mcp_server_url: spec.mcp_server_url ?? null,
        metadata: spec.metadata,
      }, { onConflict: 'name' });

    if (error) throw new Error(`Failed to register tool ${spec.name}: ${error.message}`);
    this.invalidateCache();
  }

  async unregister(name: string): Promise<void> {
    const { error } = await this.supabase
      .from('tool_registry')
      .update({ enabled: false })
      .eq('name', name);

    if (error) throw new Error(`Failed to unregister tool ${name}: ${error.message}`);
    this.invalidateCache();
  }

  // --- Discovery ---

  async listTools(filters?: {
    source_type?: string;
    required_permission?: PermissionMode;
    enabled_only?: boolean;
  }): Promise<ToolSpec[]> {
    await this.ensureCache();

    let tools = Array.from(this.cache.values());

    if (filters?.enabled_only !== false) {
      tools = tools.filter(t => t.enabled);
    }
    if (filters?.source_type) {
      tools = tools.filter(t => t.source_type === filters.source_type);
    }
    if (filters?.required_permission) {
      const maxRank = PERMISSION_RANK[filters.required_permission];
      tools = tools.filter(t => PERMISSION_RANK[t.required_permission] <= maxRank);
    }

    return tools;
  }

  async getToolByName(name: string): Promise<ToolSpec | null> {
    await this.ensureCache();
    const canonical = this.aliasMap.get(this.normalizeName(name));
    if (!canonical) return null;
    return this.cache.get(canonical) ?? null;
  }

  // --- Name normalization (matches Claude Code pattern) ---

  private normalizeName(value: string): string {
    return value.trim().replace(/-/g, '_').toLowerCase();
  }

  // --- Cache management ---

  private invalidateCache(): void {
    this.cache.clear();
    this.aliasMap.clear();
  }

  private async ensureCache(): Promise<void> {
    if (this.cache.size > 0) return;

    const { data, error } = await this.supabase
      .from('tool_registry')
      .select('*');

    if (error) throw new Error(`Failed to load tool registry: ${error.message}`);

    for (const row of data ?? []) {
      const spec: ToolSpec = {
        name: row.name,
        description: row.description,
        source_type: row.source_type,
        required_permission: row.required_permission,
        input_schema: row.input_schema,
        side_effect_profile: row.side_effect_profile,
        enabled: row.enabled,
        aliases: row.aliases ?? [],
        mcp_server_url: row.mcp_server_url,
        metadata: row.metadata ?? {},
      };
      this.cache.set(spec.name, spec);

      // Build alias map: canonical name + all aliases -> canonical name
      const normalized = this.normalizeName(spec.name);
      this.aliasMap.set(normalized, spec.name);
      for (const alias of spec.aliases) {
        this.aliasMap.set(this.normalizeName(alias), spec.name);
      }
    }
  }
}

const PERMISSION_RANK: Record<PermissionMode, number> = {
  read_only: 0,
  workspace_write: 1,
  danger_full_access: 2,
  prompt: 3,
  allow: 4,
};
```

---

## 3. Permission System

### 3.1 Permission Mode Hierarchy

Five ordered levels. Comparison determines access:

```
read_only < workspace_write < danger_full_access < prompt < allow
    0              1                  2                3       4
```

- **read_only**: Can invoke read-only tools (glob, grep, read_file, web_fetch, tool_search)
- **workspace_write**: Can also invoke write/edit tools (write_file, edit_file)
- **danger_full_access**: Can also invoke bash, agent, REPL, destructive operations
- **prompt**: When the active mode is lower than required, delegate to the handler for a per-tool decision
- **allow**: Everything auto-allowed, no checks

### 3.2 PermissionPolicy

```typescript
// permissions/permission-policy.ts

import { PermissionMode, ToolSpec } from '../types/tool-registry';

export type PermissionDecision = 'allow' | 'deny' | 'escalate';

export interface PermissionOutcome {
  decision: PermissionDecision;
  reason?: string;
}

export interface PermissionDenial {
  tool_name: string;
  reason: string;
  timestamp: string; // ISO 8601
  active_mode: PermissionMode;
  required_mode: PermissionMode;
}

export type HandlerType = 'interactive' | 'coordinator' | 'swarm_worker';

export interface PermissionPolicyConfig {
  active_mode: PermissionMode;
  tool_overrides: Record<string, PermissionMode>;
  handler_type: HandlerType;
  deny_tools: Set<string>;
  deny_prefixes: string[];
  allow_tools: Set<string>; // empty = all allowed (subject to mode)
}

const RANK: Record<PermissionMode, number> = {
  read_only: 0,
  workspace_write: 1,
  danger_full_access: 2,
  prompt: 3,
  allow: 4,
};

export class PermissionPolicy {
  private config: PermissionPolicyConfig;

  constructor(config: PermissionPolicyConfig) {
    this.config = config;
  }

  /**
   * Core authorization check. This is called BEFORE hooks and BEFORE execution.
   * Defense-in-depth: the executor calls this again even if the API layer already filtered.
   */
  authorize(
    toolName: string,
    toolSpec: ToolSpec,
    handler?: PermissionHandler,
  ): PermissionOutcome {
    // Layer 1: Deny-list check (exact name + prefix)
    if (this.isDenied(toolName)) {
      return {
        decision: 'deny',
        reason: `Tool "${toolName}" is on the deny list`,
      };
    }

    // Layer 2: Allow-list check (if configured)
    if (this.config.allow_tools.size > 0 && !this.config.allow_tools.has(toolName)) {
      return {
        decision: 'deny',
        reason: `Tool "${toolName}" is not in the allowed tools set`,
      };
    }

    // Layer 3: Permission mode check
    const activeMode = this.config.active_mode;
    const requiredMode = this.config.tool_overrides[toolName]
      ?? toolSpec.required_permission;

    // allow mode: everything passes
    if (activeMode === 'allow') {
      return { decision: 'allow' };
    }

    // Active mode >= required mode: allowed
    if (RANK[activeMode] >= RANK[requiredMode]) {
      return { decision: 'allow' };
    }

    // Prompt mode: delegate to handler
    if (activeMode === 'prompt' || this.canEscalate(activeMode, requiredMode)) {
      if (handler) {
        return handler.decide(toolName, toolSpec, activeMode, requiredMode);
      }
      // No handler available — deny
      return {
        decision: 'deny',
        reason: `Escalation required but no handler available (need ${requiredMode}, have ${activeMode})`,
      };
    }

    return {
      decision: 'deny',
      reason: `Insufficient permission: need ${requiredMode}, have ${activeMode}`,
    };
  }

  private isDenied(toolName: string): boolean {
    const lowered = toolName.toLowerCase();
    if (this.config.deny_tools.has(lowered)) return true;
    return this.config.deny_prefixes.some(prefix => lowered.startsWith(prefix));
  }

  private canEscalate(active: PermissionMode, required: PermissionMode): boolean {
    // workspace_write can escalate to danger_full_access via prompter
    return active === 'workspace_write' && required === 'danger_full_access';
  }

  // --- Factory methods for common policies ---

  static readOnly(): PermissionPolicy {
    return new PermissionPolicy({
      active_mode: 'read_only',
      tool_overrides: {},
      handler_type: 'swarm_worker',
      deny_tools: new Set(),
      deny_prefixes: [],
      allow_tools: new Set(),
    });
  }

  static subAgent(allowedTools: string[]): PermissionPolicy {
    return new PermissionPolicy({
      active_mode: 'workspace_write',
      tool_overrides: {},
      handler_type: 'coordinator',
      deny_tools: new Set(),
      deny_prefixes: ['mcp__'],
      allow_tools: new Set(allowedTools.map(t => t.toLowerCase())),
    });
  }

  static fullAccess(): PermissionPolicy {
    return new PermissionPolicy({
      active_mode: 'allow',
      tool_overrides: {},
      handler_type: 'interactive',
      deny_tools: new Set(),
      deny_prefixes: [],
      allow_tools: new Set(),
    });
  }
}
```

### 3.3 Three Permission Handler Types

```typescript
// permissions/handlers.ts

import { PermissionOutcome, PermissionMode } from './permission-policy';
import { ToolSpec } from '../types/tool-registry';

export interface PermissionHandler {
  decide(
    toolName: string,
    toolSpec: ToolSpec,
    activeMode: PermissionMode,
    requiredMode: PermissionMode,
  ): PermissionOutcome;
}

/**
 * Interactive handler: prompts a human user for approval.
 * Used in primary CLI sessions.
 */
export class InteractiveHandler implements PermissionHandler {
  private promptFn: (message: string) => Promise<boolean>;

  constructor(promptFn: (message: string) => Promise<boolean>) {
    this.promptFn = promptFn;
  }

  decide(
    toolName: string,
    toolSpec: ToolSpec,
    activeMode: PermissionMode,
    requiredMode: PermissionMode,
  ): PermissionOutcome {
    // In an async context, this would await the prompt.
    // For the MCP edge function context, this becomes a structured
    // "escalation_required" response that the client handles.
    return {
      decision: 'escalate',
      reason: `Tool "${toolName}" requires ${requiredMode} (current: ${activeMode}). User approval needed.`,
    };
  }
}

/**
 * Coordinator handler: policy-only decisions, never prompts a user.
 * Used when a coordinator agent manages sub-agents.
 */
export class CoordinatorHandler implements PermissionHandler {
  private allowedEscalations: Set<string>;

  constructor(allowedEscalations: string[] = []) {
    this.allowedEscalations = new Set(allowedEscalations.map(t => t.toLowerCase()));
  }

  decide(
    toolName: string,
    _toolSpec: ToolSpec,
    _activeMode: PermissionMode,
    _requiredMode: PermissionMode,
  ): PermissionOutcome {
    if (this.allowedEscalations.has(toolName.toLowerCase())) {
      return { decision: 'allow' };
    }
    return {
      decision: 'deny',
      reason: `Coordinator policy denies escalation for "${toolName}"`,
    };
  }
}

/**
 * Swarm worker handler: always denies escalation.
 * Used for headless background tasks with no human in the loop.
 */
export class SwarmWorkerHandler implements PermissionHandler {
  decide(
    toolName: string,
    _toolSpec: ToolSpec,
    _activeMode: PermissionMode,
    _requiredMode: PermissionMode,
  ): PermissionOutcome {
    return {
      decision: 'deny',
      reason: `Swarm workers cannot escalate permissions (tool: "${toolName}")`,
    };
  }
}
```

### 3.4 Defense-in-Depth: Two Checkpoints

Permission checks happen at TWO points in the execution pipeline:

```
LLM API Call                         Tool Execution
     |                                    |
     v                                    v
[Tool Pool Assembly]              [ToolExecutor.execute()]
     |                                    |
     +-- Filter by policy           +-- Re-check policy
     +-- Remove denied tools        +-- Reject even if model
     +-- Only send allowed               somehow requests a
         tool defs to model               blocked tool
     |                                    |
     v                                    v
 Model sees only                   Execution only proceeds
 permitted tools                   if permission re-verified
```

**Checkpoint 1 — API layer (tool pool assembly):**
Tools are filtered before being sent as tool definitions to the LLM. The model never even sees tools it cannot use.

**Checkpoint 2 — Executor layer (runtime rejection):**
Even if a tool somehow appears in a model response (hallucinated name, cached response, etc.), the executor re-checks permission before executing.

```typescript
// In the execution pipeline, permission check comes BEFORE hooks:
//
//   1. Parse tool_use from model response
//   2. *** PERMISSION CHECK *** <-- HERE, before anything else
//   3. Run pre-execution hooks
//   4. Execute the tool
//   5. Run post-execution hooks
//   6. Return tool_result to model
```

---

## 4. Permission Audit Trail

### 4.1 SessionAuditTrail

```typescript
// audit/session-audit-trail.ts

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PermissionDenial, PermissionOutcome, PermissionMode } from '../permissions/permission-policy';

export class SessionAuditTrail {
  private sessionId: string;
  private denials: PermissionDenial[] = [];
  private allDecisions: AuditEntry[] = [];
  private supabase: SupabaseClient;

  constructor(sessionId: string, supabaseUrl: string, supabaseKey: string) {
    this.sessionId = sessionId;
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Record a permission decision (allow or deny).
   * Denials are accumulated for the session summary.
   */
  record(
    toolName: string,
    outcome: PermissionOutcome,
    activeMode: PermissionMode,
    requiredMode: PermissionMode,
    decidedBy: string,
    policyId?: string,
    inputSummary?: string,
  ): void {
    const entry: AuditEntry = {
      session_id: this.sessionId,
      tool_name: toolName,
      decision: outcome.decision,
      reason: outcome.reason,
      active_mode: activeMode,
      required_mode: requiredMode,
      decided_by: decidedBy,
      policy_id: policyId,
      input_summary: inputSummary,
      timestamp: new Date().toISOString(),
    };

    this.allDecisions.push(entry);

    if (outcome.decision === 'deny') {
      this.denials.push({
        tool_name: toolName,
        reason: outcome.reason ?? 'No reason provided',
        timestamp: entry.timestamp,
        active_mode: activeMode,
        required_mode: requiredMode,
      });
    }
  }

  /** Get all denials accumulated in this session so far */
  getDenials(): ReadonlyArray<PermissionDenial> {
    return this.denials;
  }

  /** Get denials that occurred in the current turn only */
  getDenialsSince(turnStart: string): PermissionDenial[] {
    return this.denials.filter(d => d.timestamp >= turnStart);
  }

  /** Denial count for a specific tool (for behavioral adaptation) */
  denialCountForTool(toolName: string): number {
    return this.denials.filter(d => d.tool_name === toolName).length;
  }

  /** Overall denial rate */
  denialRate(): number {
    if (this.allDecisions.length === 0) return 0;
    return this.denials.length / this.allDecisions.length;
  }

  /**
   * Flush all decisions to Supabase.
   * Call this at the end of each turn or when the session ends.
   */
  async flush(): Promise<void> {
    if (this.allDecisions.length === 0) return;

    const rows = this.allDecisions.map(d => ({
      session_id: d.session_id,
      tool_name: d.tool_name,
      decision: d.decision,
      reason: d.reason,
      decided_by: d.decided_by,
      active_mode: d.active_mode,
      required_mode: d.required_mode,
      policy_id: d.policy_id,
      input_summary: d.input_summary,
    }));

    const { error } = await this.supabase
      .from('permission_audit_log')
      .insert(rows);

    if (error) {
      console.error(`Failed to flush audit trail: ${error.message}`);
      // Don't throw — audit failures should not block execution
    }

    // Clear flushed entries but keep denials for session-level reporting
    this.allDecisions = [];
  }

  /**
   * Persist a summary to the thoughts table for long-term memory.
   * Call this when the session ends.
   */
  async persistSummary(): Promise<string | null> {
    const summary = {
      total_decisions: this.allDecisions.length + this.denials.length,
      denial_count: this.denials.length,
      denial_rate: this.denialRate(),
      top_denied_tools: this.topDeniedTools(5),
      denials: this.denials.map(d => ({
        tool: d.tool_name,
        reason: d.reason,
      })),
    };

    const { data, error } = await this.supabase
      .rpc('persist_permission_audit', {
        p_session_id: this.sessionId,
        p_summary: summary,
      });

    if (error) {
      console.error(`Failed to persist audit summary: ${error.message}`);
      return null;
    }
    return data;
  }

  private topDeniedTools(limit: number): Array<{ tool: string; count: number }> {
    const counts = new Map<string, number>();
    for (const d of this.denials) {
      counts.set(d.tool_name, (counts.get(d.tool_name) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tool, count]) => ({ tool, count }));
  }
}

interface AuditEntry {
  session_id: string;
  tool_name: string;
  decision: string;
  reason?: string;
  active_mode: string;
  required_mode: string;
  decided_by: string;
  policy_id?: string;
  input_summary?: string;
  timestamp: string;
}
```

### 4.2 TurnResult Integration

```typescript
// runtime/turn-result.ts

import { PermissionDenial } from '../permissions/permission-policy';

export interface TurnResult {
  messages: unknown[];
  permission_denials: PermissionDenial[];  // Denials from THIS turn
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason: string;
  iterations: number;
}
```

### 4.3 Streaming Events

When streaming turn results, emit a dedicated event for denials:

```typescript
// If any tools were denied during this turn, emit a structured event
if (turnDenials.length > 0) {
  yield {
    type: 'permission_denial',
    denials: turnDenials.map(d => ({
      tool_name: d.tool_name,
      reason: d.reason,
    })),
  };
}
```

### 4.4 Behavioral Adaptation

Use denial data to adapt agent behavior at runtime:

```typescript
// Before attempting a tool call, check if it has been repeatedly denied
const priorDenials = audit.denialCountForTool(toolName);
if (priorDenials >= 3) {
  // The model keeps trying a tool it cannot use.
  // Inject a system message to redirect.
  session.addSystemMessage(
    `The tool "${toolName}" has been denied ${priorDenials} times in this session. ` +
    `Do not attempt to use it again. Use alternative approaches.`
  );
}
```

---

## 5. Tool Pool Assembly

### 5.1 Three-Filter Pipeline

The tool pool sent to the LLM is assembled by applying three sequential filters:

```
All Registered Tools (from tool_registry table)
        |
        v
  [Filter 1: Simple Mode]
  If simple_mode=true, keep only: read_file, edit_file, bash
  Result: 3 tools (massive prompt reduction)
        |
        v
  [Filter 2: MCP Exclusion]
  If include_mcp=false, drop all tools where:
    - source_type = 'mcp', OR
    - name starts with 'mcp__'
        |
        v
  [Filter 3: Permission Deny-List]
  Drop tools where:
    - name is in deny_tools (exact frozenset match), OR
    - name starts with any deny_prefix
        |
        v
  [Filter 4: Allow-List (if configured)]
  If allow_tools is non-empty, keep ONLY named tools
        |
        v
  ToolPool (frozen, immutable for the session)
```

### 5.2 Implementation

```typescript
// pool/tool-pool.ts

import { ToolSpec } from '../types/tool-registry';
import { PermissionPolicyConfig } from '../permissions/permission-policy';

export interface ToolPoolConfig {
  simple_mode: boolean;
  include_mcp: boolean;
  permission_config: PermissionPolicyConfig;
}

const SIMPLE_MODE_TOOLS = new Set(['read_file', 'edit_file', 'bash']);

export class ToolPool {
  readonly tools: ReadonlyArray<ToolSpec>;
  readonly simple_mode: boolean;
  readonly include_mcp: boolean;

  private constructor(tools: ToolSpec[], simple_mode: boolean, include_mcp: boolean) {
    this.tools = Object.freeze([...tools]);
    this.simple_mode = simple_mode;
    this.include_mcp = include_mcp;
  }

  /**
   * Assemble a tool pool from the full registry, applying all filters.
   * The returned pool is frozen and immutable for the lifetime of the session.
   */
  static assemble(allTools: ToolSpec[], config: ToolPoolConfig): ToolPool {
    let tools = [...allTools].filter(t => t.enabled);

    // Filter 1: Simple mode whitelist
    if (config.simple_mode) {
      tools = tools.filter(t => SIMPLE_MODE_TOOLS.has(t.name));
    }

    // Filter 2: MCP exclusion
    if (!config.include_mcp) {
      tools = tools.filter(t =>
        t.source_type !== 'mcp' &&
        !t.name.toLowerCase().startsWith('mcp__')
      );
    }

    // Filter 3: Permission deny-list (dual strategy)
    const denyNames = config.permission_config.deny_tools;
    const denyPrefixes = config.permission_config.deny_prefixes;

    tools = tools.filter(t => {
      const lowered = t.name.toLowerCase();
      if (denyNames.has(lowered)) return false;
      if (denyPrefixes.some(prefix => lowered.startsWith(prefix))) return false;
      return true;
    });

    // Filter 4: Allow-list (if configured)
    const allowTools = config.permission_config.allow_tools;
    if (allowTools.size > 0) {
      tools = tools.filter(t => allowTools.has(t.name.toLowerCase()));
    }

    return new ToolPool(tools, config.simple_mode, config.include_mcp);
  }

  /** Convert to MCP tool definitions for the tools/list response */
  toMCPToolDefinitions(): MCPToolDefinition[] {
    return this.tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.input_schema,
    }));
  }

  /** Convert to LLM API tool definitions (Anthropic format) */
  toAnthropicToolDefinitions(): AnthropicToolDefinition[] {
    return this.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
  }

  /** Diagnostic markdown for logging/debugging */
  toMarkdown(): string {
    const lines = [
      '# Tool Pool',
      `Simple mode: ${this.simple_mode}`,
      `Include MCP: ${this.include_mcp}`,
      `Tool count: ${this.tools.length}`,
      '',
      '## Tools',
    ];
    for (const tool of this.tools) {
      lines.push(`- **${tool.name}** (${tool.source_type}, requires: ${tool.required_permission})`);
    }
    return lines.join('\n');
  }

  /** Check if a tool is in this pool */
  has(toolName: string): boolean {
    return this.tools.some(t => t.name === toolName);
  }

  /** Get a specific tool from the pool */
  get(toolName: string): ToolSpec | undefined {
    return this.tools.find(t => t.name === toolName);
  }
}

interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
```

### 5.3 Sub-Agent Tool Scoping

When the `agent` tool spawns a sub-agent, it creates a restricted tool pool:

```typescript
// runtime/sub-agent.ts

import { ToolPool, ToolPoolConfig } from '../pool/tool-pool';
import { PermissionPolicy } from '../permissions/permission-policy';

interface SubAgentConfig {
  prompt: string;
  allowed_tools: string[];
  permission_mode: PermissionMode;
}

function createSubAgentToolPool(
  parentPool: ToolPool,
  config: SubAgentConfig,
  allTools: ToolSpec[],
): { pool: ToolPool; policy: PermissionPolicy } {
  // Sub-agents always get coordinator handler (no user prompts)
  const policy = PermissionPolicy.subAgent(config.allowed_tools);

  const pool = ToolPool.assemble(allTools, {
    simple_mode: false,
    include_mcp: false,  // Sub-agents never get MCP tools by default
    permission_config: {
      active_mode: config.permission_mode,
      tool_overrides: {},
      handler_type: 'coordinator',
      deny_tools: new Set(),
      deny_prefixes: ['mcp__'],
      allow_tools: new Set(config.allowed_tools.map(t => t.toLowerCase())),
    },
  });

  return { pool, policy };
}
```

### 5.4 Runtime Tool Discovery via tool_search

The `tool_search` meta-tool enables runtime discovery of deferred tools (MCP tools not in the initial pool):

```typescript
// tools/tool-search.ts

import { ToolRegistry } from '../registry/tool-registry';

export async function executeToolSearch(
  registry: ToolRegistry,
  query: string,
  maxResults: number = 5,
): Promise<string> {
  // Search the full registry (including disabled/MCP tools not in current pool)
  const allTools = await registry.listTools({ enabled_only: true });

  // Match by name, alias, or description substring
  const queryLower = query.toLowerCase();
  const matches = allTools
    .filter(t =>
      t.name.toLowerCase().includes(queryLower) ||
      t.aliases.some(a => a.toLowerCase().includes(queryLower)) ||
      t.description.toLowerCase().includes(queryLower)
    )
    .slice(0, maxResults);

  if (matches.length === 0) {
    return `No tools found matching "${query}"`;
  }

  // Return full schemas so the model can invoke them
  return JSON.stringify(
    matches.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
      required_permission: t.required_permission,
      source_type: t.source_type,
    })),
    null,
    2,
  );
}
```

---

## 6. MCP Integration

### 6.1 How This Maps to MCP

OB1 uses Supabase Edge Functions as remote MCP servers. The tool registry and permission system integrate at the MCP protocol level:

```
Claude Desktop / AI Client
      |
      | (MCP protocol over HTTPS)
      v
Supabase Edge Function: ob1-tool-registry
      |
      +-- tools/list    → returns filtered tool definitions from ToolPool
      +-- tools/call    → permission check → execute → return result
      +-- resources     → permission policies, audit summaries
      |
      v
Supabase PostgreSQL
      +-- tool_registry table
      +-- permission_policies table
      +-- permission_audit_log table
      +-- thoughts table (audit summaries persisted here)
```

### 6.2 MCP Server Handler

```typescript
// supabase/functions/ob1-tool-registry/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ToolRegistry } from './registry/tool-registry.ts';
import { PermissionPolicy } from './permissions/permission-policy.ts';
import { SessionAuditTrail } from './audit/session-audit-trail.ts';
import { ToolPool } from './pool/tool-pool.ts';

serve(async (req: Request) => {
  // Access key check (same pattern as core OB1 MCP server)
  const accessKey = req.headers.get('x-access-key');
  if (accessKey !== Deno.env.get('MCP_ACCESS_KEY')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const registry = new ToolRegistry(supabaseUrl, supabaseKey);

  const body = await req.json();
  const { method, params } = body;

  switch (method) {
    case 'tools/list': {
      return handleToolsList(registry, params);
    }
    case 'tools/call': {
      return handleToolsCall(registry, params, supabaseUrl, supabaseKey);
    }
    case 'registry/register': {
      return handleRegister(registry, params);
    }
    case 'registry/policies': {
      return handleListPolicies(supabaseUrl, supabaseKey);
    }
    case 'audit/summary': {
      return handleAuditSummary(params, supabaseUrl, supabaseKey);
    }
    default: {
      return jsonResponse({ error: `Unknown method: ${method}` }, 400);
    }
  }
});

async function handleToolsList(
  registry: ToolRegistry,
  params: { session_id?: string; policy_name?: string; simple_mode?: boolean; include_mcp?: boolean },
) {
  const allTools = await registry.listTools({ enabled_only: true });

  // Load policy if specified
  let policyConfig = PermissionPolicy.fullAccess();
  if (params.policy_name) {
    // Load from permission_policies table
    policyConfig = await loadPolicyByName(params.policy_name);
  }

  const pool = ToolPool.assemble(allTools, {
    simple_mode: params.simple_mode ?? false,
    include_mcp: params.include_mcp ?? true,
    permission_config: policyConfig.config,
  });

  return jsonResponse({
    tools: pool.toMCPToolDefinitions(),
    meta: {
      total_registered: allTools.length,
      filtered_count: pool.tools.length,
      simple_mode: pool.simple_mode,
      include_mcp: pool.include_mcp,
    },
  });
}

async function handleToolsCall(
  registry: ToolRegistry,
  params: {
    tool_name: string;
    input: Record<string, unknown>;
    session_id: string;
    policy_name?: string;
  },
  supabaseUrl: string,
  supabaseKey: string,
) {
  const toolSpec = await registry.getToolByName(params.tool_name);
  if (!toolSpec) {
    return jsonResponse({
      type: 'tool_result',
      tool_name: params.tool_name,
      content: `Unknown tool: ${params.tool_name}`,
      is_error: true,
    });
  }

  // Load policy
  const policy = params.policy_name
    ? await loadPolicyByName(params.policy_name)
    : PermissionPolicy.fullAccess();

  // Initialize audit trail
  const audit = new SessionAuditTrail(params.session_id, supabaseUrl, supabaseKey);

  // Permission check (Checkpoint 2: executor layer)
  const outcome = policy.authorize(params.tool_name, toolSpec);

  // Record the decision
  audit.record(
    params.tool_name,
    outcome,
    policy.config.active_mode,
    toolSpec.required_permission,
    policy.config.handler_type,
  );

  if (outcome.decision === 'deny') {
    await audit.flush();
    return jsonResponse({
      type: 'tool_result',
      tool_name: params.tool_name,
      content: outcome.reason ?? 'Permission denied',
      is_error: true,
    });
  }

  if (outcome.decision === 'escalate') {
    await audit.flush();
    return jsonResponse({
      type: 'escalation_required',
      tool_name: params.tool_name,
      reason: outcome.reason,
      required_permission: toolSpec.required_permission,
    });
  }

  // Execute the tool (actual execution logic depends on tool type)
  try {
    const result = await executeRegisteredTool(toolSpec, params.input, supabaseUrl, supabaseKey);
    await audit.flush();
    return jsonResponse({
      type: 'tool_result',
      tool_name: params.tool_name,
      content: result,
      is_error: false,
    });
  } catch (err) {
    await audit.flush();
    return jsonResponse({
      type: 'tool_result',
      tool_name: params.tool_name,
      content: `Tool execution failed: ${err.message}`,
      is_error: true,
    });
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

---

## 7. Edge Function Endpoints

### 7.1 Endpoint Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `tools/list` | POST | List available tools (filtered by policy, mode, MCP inclusion) |
| `tools/call` | POST | Execute a tool with permission check + audit |
| `registry/register` | POST | Register a new tool definition |
| `registry/policies` | GET | List all permission policies |
| `audit/summary` | POST | Get permission audit summary for a session |

### 7.2 Request/Response Examples

**tools/list**
```json
// Request
{
  "method": "tools/list",
  "params": {
    "session_id": "sess_abc123",
    "policy_name": "sub_agent_explorer",
    "simple_mode": false,
    "include_mcp": false
  }
}

// Response
{
  "tools": [
    {
      "name": "read_file",
      "description": "Read a file from the filesystem",
      "inputSchema": { "type": "object", "properties": { "file_path": { "type": "string" } } }
    }
  ],
  "meta": {
    "total_registered": 12,
    "filtered_count": 4,
    "simple_mode": false,
    "include_mcp": false
  }
}
```

**tools/call**
```json
// Request
{
  "method": "tools/call",
  "params": {
    "tool_name": "bash",
    "input": { "command": "ls -la" },
    "session_id": "sess_abc123",
    "policy_name": "sub_agent_explorer"
  }
}

// Response (denied)
{
  "type": "tool_result",
  "tool_name": "bash",
  "content": "Insufficient permission: need danger_full_access, have read_only",
  "is_error": true
}
```

**audit/summary**
```json
// Request
{
  "method": "audit/summary",
  "params": { "session_id": "sess_abc123" }
}

// Response
{
  "session_id": "sess_abc123",
  "total_decisions": 47,
  "denial_count": 3,
  "denial_rate": 0.064,
  "top_denied_tools": [
    { "tool": "bash", "count": 2 },
    { "tool": "agent", "count": 1 }
  ]
}
```

---

## 8. Build Order

Execute in this order. Each step is independently testable before proceeding.

### Phase 1: Schema (30 min)

1. Run the `tool_registry` table migration (Section 1.1)
2. Run the `permission_policies` table migration (Section 1.2)
3. Run the `permission_audit_log` table migration (Section 1.3)
4. Run the `persist_permission_audit` function migration (Section 1.4)
5. Verify all tables exist in Supabase Table Editor

### Phase 2: Types and Registry (1 hr)

6. Create `types/tool-registry.ts` with all type definitions (Section 2.2)
7. Create `registry/built-in-tools.ts` with seed data (Section 2.3)
8. Create `registry/tool-registry.ts` with ToolRegistry class (Section 2.4)
9. Test: seed built-ins, call `listTools()`, verify 9 tools returned

### Phase 3: Permission System (1 hr)

10. Create `permissions/permission-policy.ts` with PermissionPolicy class (Section 3.2)
11. Create `permissions/handlers.ts` with all three handler types (Section 3.3)
12. Test: create ReadOnly policy, verify bash is denied, read_file is allowed
13. Test: create SubAgent policy with allow_tools, verify scoping works
14. Test: create FullAccess policy, verify everything passes

### Phase 4: Audit Trail (45 min)

15. Create `audit/session-audit-trail.ts` (Section 4.1)
16. Create `runtime/turn-result.ts` with TurnResult type (Section 4.2)
17. Test: record 5 allow + 3 deny decisions, verify `denialRate()` = 0.375
18. Test: `flush()` writes to `permission_audit_log` table
19. Test: `persistSummary()` creates a thought with type='permission_audit'

### Phase 5: Tool Pool Assembly (45 min)

20. Create `pool/tool-pool.ts` with ToolPool class (Section 5.2)
21. Test: assemble with simple_mode=true, verify only 3 tools
22. Test: assemble with include_mcp=false, verify MCP tools excluded
23. Test: assemble with deny_prefixes=['mcp__'], verify prefix blocking
24. Test: assemble with allow_tools=['read_file', 'grep_search'], verify whitelist
25. Create `runtime/sub-agent.ts` (Section 5.3)

### Phase 6: MCP Edge Function (1 hr)

26. Create the Edge Function at `supabase/functions/ob1-tool-registry/index.ts` (Section 6.2)
27. Set Supabase secrets: `MCP_ACCESS_KEY`
28. Deploy: `supabase functions deploy ob1-tool-registry`
29. Test `tools/list` endpoint
30. Test `tools/call` with an allowed tool
31. Test `tools/call` with a denied tool, verify audit log entry
32. Connect to Claude Desktop via Settings > Connectors > Add custom connector

### Phase 7: Integration Tests (30 min)

33. End-to-end: register a custom tool, list it, call it, check audit
34. End-to-end: create a restrictive policy, verify denial flow
35. End-to-end: verify audit summary persists to thoughts table
36. Sub-agent scoping: verify child agent cannot use parent's tools

---

## Quick Reference: Permission Mode by Tool

| Tool | Required Permission | Side Effects |
|------|-------------------|--------------|
| read_file | read_only | None |
| glob_search | read_only | None |
| grep_search | read_only | None |
| web_fetch | read_only | Network read |
| tool_search | read_only | None (meta-tool) |
| write_file | workspace_write | Writes files |
| edit_file | workspace_write | Writes files |
| bash | danger_full_access | Everything |
| agent | danger_full_access | Spawns processes |

## Quick Reference: Policy Presets

| Preset | Mode | Handler | Deny Prefixes | Use Case |
|--------|------|---------|---------------|----------|
| `ReadOnly` | read_only | swarm_worker | — | Explorer sub-agents |
| `SubAgent` | workspace_write | coordinator | `mcp__` | Code-writing sub-agents |
| `FullAccess` | allow | interactive | — | Primary user session |
| `SimpleMode` | workspace_write | interactive | — | Constrained 3-tool mode |
