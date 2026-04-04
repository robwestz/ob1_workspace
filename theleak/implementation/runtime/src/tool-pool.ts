/**
 * ToolPool & PermissionPolicy — Tool assembly, filtering, permission
 * enforcement, and format conversion for the OB1 agentic architecture.
 *
 * ToolPool applies a four-filter pipeline (simple-mode, MCP exclusion,
 * deny-list, allow-list) to produce an immutable set of tools for a session.
 *
 * PermissionPolicy implements the five-level permission hierarchy with
 * deny/allow lists, per-tool overrides, and an audit trail.
 *
 * @module tool-pool
 */

import { OB1Client } from './ob1-client.js';
import {
  type ToolSpec,
  type PermissionDenial,
  type AuditEntry,
  PermissionMode,
  PERMISSION_RANK,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tools available in simple mode (minimal prompt footprint). */
const SIMPLE_MODE_TOOLS = new Set(['read_file', 'edit_file', 'bash']);

// ---------------------------------------------------------------------------
// Supplementary interfaces (not in the shared types module)
// ---------------------------------------------------------------------------

/** Configuration passed to ToolPool.assemble(). */
export interface ToolPoolOptions {
  /** If true, only expose read_file, edit_file, and bash. */
  simple_mode: boolean;
  /** If false, exclude all MCP-sourced tools and tools prefixed with mcp__. */
  include_mcp: boolean;
  /** Exact tool names to deny (case-insensitive). */
  deny_tools?: string[];
  /** Tool name prefixes to deny (case-insensitive). */
  deny_prefixes?: string[];
  /** If non-empty, ONLY these tools survive (case-insensitive). */
  allow_tools?: string[];
}

/** MCP tools/list response entry. */
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Anthropic API tool definition. */
export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Result of a runtime permission check on a single tool. */
export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  active_mode: PermissionMode;
  required_mode: PermissionMode;
  /** True when the denial could be resolved by user approval (prompt mode). */
  escalation_possible?: boolean;
}

// ---------------------------------------------------------------------------
// ToolPool
// ---------------------------------------------------------------------------

export class ToolPool {
  /** The frozen, filtered set of tools available in this pool. */
  private _tools: ToolSpec[] = [];

  /** Fast lookup index keyed by tool name. */
  private toolIndex: Map<string, ToolSpec> = new Map();

  constructor(private client: OB1Client) {}

  // =========================================================================
  // Assembly — the four-filter pipeline
  // =========================================================================

  /**
   * Assemble a filtered tool pool from the full tool registry.
   *
   * Pipeline:
   *   1. Keep only enabled tools
   *   2. Simple-mode whitelist (if `simple_mode` is true)
   *   3. MCP exclusion (if `include_mcp` is false)
   *   4. Permission deny-list (exact names + prefixes)
   *   5. Allow-list (if non-empty, only named tools survive)
   *
   * The returned ToolPool is frozen for the lifetime of the session.
   *
   * @param options - Assembly configuration (mode flags, deny/allow lists).
   * @returns `this` for chaining.
   */
  async assemble(options: ToolPoolOptions): Promise<ToolPool> {
    // Fetch all tools from the registry via OB1Client
    const allTools = await this.client.listTools({ enabled_only: true });

    let tools = [...allTools];

    // Filter 1: Simple mode whitelist
    if (options.simple_mode) {
      tools = tools.filter(t => SIMPLE_MODE_TOOLS.has(t.name));
    }

    // Filter 2: MCP exclusion
    if (!options.include_mcp) {
      tools = tools.filter(
        t => t.source_type !== 'mcp' && !t.name.toLowerCase().startsWith('mcp__'),
      );
    }

    // Filter 3: Permission deny-list (exact names + prefix match)
    const denyTools = new Set(
      (options.deny_tools ?? []).map(n => n.toLowerCase()),
    );
    const denyPrefixes = (options.deny_prefixes ?? []).map(p => p.toLowerCase());

    tools = tools.filter(t => {
      const lowered = t.name.toLowerCase();
      if (denyTools.has(lowered)) return false;
      if (denyPrefixes.some(prefix => lowered.startsWith(prefix))) return false;
      return true;
    });

    // Filter 4: Allow-list (if non-empty, ONLY these tools survive)
    const allowTools = new Set(
      (options.allow_tools ?? []).map(n => n.toLowerCase()),
    );
    if (allowTools.size > 0) {
      tools = tools.filter(t => allowTools.has(t.name.toLowerCase()));
    }

    // Freeze the pool
    this._tools = Object.freeze([...tools]) as ToolSpec[];
    this.toolIndex = new Map(this._tools.map(t => [t.name, t]));

    return this;
  }

  // =========================================================================
  // Access
  // =========================================================================

  /** All tools in this pool. */
  get tools(): ToolSpec[] {
    return this._tools;
  }

  /** Check whether a tool exists in this pool by name. */
  has(toolName: string): boolean {
    return this.toolIndex.has(toolName);
  }

  /** Get a single tool by name, or `undefined` if not present. */
  get(toolName: string): ToolSpec | undefined {
    return this.toolIndex.get(toolName);
  }

  /** Number of tools in the pool. */
  get size(): number {
    return this._tools.length;
  }

  // =========================================================================
  // Permission Checking (defense-in-depth, Checkpoint 2)
  // =========================================================================

  /**
   * Check whether a tool is permitted under the given permission mode.
   *
   * This is the runtime checkpoint: even if a tool is in the pool, the
   * executor re-checks permission before executing (defense-in-depth).
   *
   * @param toolName    - Name of the tool to check.
   * @param currentMode - The active permission mode for this session/agent.
   */
  checkPermission(
    toolName: string,
    currentMode: PermissionMode,
  ): PermissionCheckResult {
    const tool = this.toolIndex.get(toolName);

    if (!tool) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" is not in the assembled tool pool`,
        active_mode: currentMode,
        required_mode: PermissionMode.ReadOnly,
      };
    }

    // Allow mode: everything passes
    if (currentMode === PermissionMode.Allow) {
      return {
        allowed: true,
        active_mode: currentMode,
        required_mode: tool.required_permission,
      };
    }

    const activeRank = PERMISSION_RANK[currentMode] ?? 0;
    const requiredRank = PERMISSION_RANK[tool.required_permission] ?? 0;

    if (activeRank >= requiredRank) {
      return {
        allowed: true,
        active_mode: currentMode,
        required_mode: tool.required_permission,
      };
    }

    // Prompt mode: escalation is possible but must be handled by the caller
    if (currentMode === PermissionMode.Prompt) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" requires ${tool.required_permission} — user approval needed (prompt mode)`,
        active_mode: currentMode,
        required_mode: tool.required_permission,
        escalation_possible: true,
      };
    }

    return {
      allowed: false,
      reason: `Insufficient permission: need ${tool.required_permission}, have ${currentMode}`,
      active_mode: currentMode,
      required_mode: tool.required_permission,
    };
  }

  // =========================================================================
  // Sub-Agent Scoping
  // =========================================================================

  /**
   * Create a restricted ToolPool for a sub-agent, limited to a specific
   * set of tool names drawn from this parent pool.
   *
   * Sub-agent pools never include MCP tools by default and use the
   * coordinator handler type.
   *
   * @param allowedTools - Tool names the sub-agent may use.
   * @returns A new ToolPool containing only the intersection of
   *          `allowedTools` and this pool's tools.
   */
  createSubAgentPool(allowedTools: string[]): ToolPool {
    const allowed = new Set(allowedTools.map(n => n.toLowerCase()));
    const subPool = new ToolPool(this.client);

    const filtered = this._tools.filter(t => allowed.has(t.name.toLowerCase()));
    subPool._tools = Object.freeze([...filtered]) as ToolSpec[];
    subPool.toolIndex = new Map(subPool._tools.map(t => [t.name, t]));

    return subPool;
  }

  // =========================================================================
  // Format Conversion
  // =========================================================================

  /**
   * Convert to MCP `tools/list` response format.
   */
  toMCPFormat(): MCPToolDefinition[] {
    return this._tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.input_schema,
    }));
  }

  /**
   * Convert to Anthropic API tool definition format.
   */
  toAnthropicFormat(): AnthropicToolDefinition[] {
    return this._tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
  }

  // =========================================================================
  // Diagnostics
  // =========================================================================

  /**
   * Produce a Markdown summary for logging / debugging.
   */
  toMarkdown(): string {
    const lines = [
      '# Tool Pool',
      `Tool count: ${this._tools.length}`,
      '',
      '## Tools',
    ];
    for (const tool of this._tools) {
      lines.push(
        `- **${tool.name}** (${tool.source_type}, requires: ${tool.required_permission})`,
      );
    }
    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// PermissionPolicy
// ---------------------------------------------------------------------------

/**
 * PermissionPolicy — Evaluates tool-level authorization against a named
 * policy loaded from Supabase, and maintains an in-memory audit trail
 * of decisions for the current session.
 */
export class PermissionPolicy {
  // Policy configuration (loaded from DB or constructed programmatically)
  private activeMode: PermissionMode = PermissionMode.ReadOnly;
  private toolOverrides: Record<string, PermissionMode> = {};
  private handlerType: 'interactive' | 'coordinator' | 'swarm_worker' = 'interactive';
  private denyTools: Set<string> = new Set();
  private denyPrefixes: string[] = [];
  private allowTools: Set<string> = new Set();

  // Session audit state
  private _denials: PermissionDenial[] = [];
  private _totalDecisions = 0;

  constructor(private client: OB1Client) {}

  // =========================================================================
  // Configuration
  // =========================================================================

  /**
   * Load a named policy from the `permission_policies` table.
   *
   * Fetches all policies and finds the one matching `policyName`.
   */
  async loadPolicy(policyName: string): Promise<void> {
    const policies = await this.client.getPolicies();
    const policy = policies.find(p => p.name === policyName);
    if (!policy) {
      throw new Error(`Permission policy not found: ${policyName}`);
    }

    this.activeMode = policy.active_mode;
    this.toolOverrides = policy.tool_overrides ?? {};
    this.handlerType = policy.handler_type;
    this.denyTools = new Set(
      (policy.deny_tools ?? []).map(t => t.toLowerCase()),
    );
    this.denyPrefixes = (policy.deny_prefixes ?? []).map(p => p.toLowerCase());
    this.allowTools = new Set(
      (policy.allow_tools ?? []).map(t => t.toLowerCase()),
    );
  }

  /**
   * Configure the policy programmatically (for sub-agents or tests).
   */
  configure(config: {
    active_mode: PermissionMode;
    tool_overrides?: Record<string, PermissionMode>;
    handler_type?: 'interactive' | 'coordinator' | 'swarm_worker';
    deny_tools?: string[];
    deny_prefixes?: string[];
    allow_tools?: string[];
  }): void {
    this.activeMode = config.active_mode;
    this.toolOverrides = config.tool_overrides ?? {};
    this.handlerType = config.handler_type ?? 'interactive';
    this.denyTools = new Set(
      (config.deny_tools ?? []).map(t => t.toLowerCase()),
    );
    this.denyPrefixes = (config.deny_prefixes ?? []).map(p => p.toLowerCase());
    this.allowTools = new Set(
      (config.allow_tools ?? []).map(t => t.toLowerCase()),
    );
  }

  // =========================================================================
  // Authorization Check
  // =========================================================================

  /**
   * Check if a tool action is allowed under the current policy.
   *
   * Implements three-layer defense:
   *   1. Deny-list check (exact name + prefix)
   *   2. Allow-list check (if configured)
   *   3. Permission mode comparison
   *
   * @param toolName - Name of the tool to authorize.
   * @param mode     - The active permission mode for this invocation.
   * @returns `{ allowed, reason }` -- reason is present only on denial.
   */
  async check(
    toolName: string,
    mode: PermissionMode,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const effectiveMode = mode ?? this.activeMode;
    this._totalDecisions++;

    // Layer 1: Deny-list check
    const lowered = toolName.toLowerCase();
    if (this.denyTools.has(lowered)) {
      return { allowed: false, reason: `Tool "${toolName}" is on the deny list` };
    }
    if (this.denyPrefixes.some(prefix => lowered.startsWith(prefix))) {
      return { allowed: false, reason: `Tool "${toolName}" matches a denied prefix` };
    }

    // Layer 2: Allow-list check
    if (this.allowTools.size > 0 && !this.allowTools.has(lowered)) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" is not in the allowed tools set`,
      };
    }

    // Layer 3: Permission mode comparison
    if (effectiveMode === PermissionMode.Allow) {
      return { allowed: true };
    }

    const requiredMode = this.toolOverrides[toolName] ?? PermissionMode.DangerFullAccess;
    const activeRank = PERMISSION_RANK[effectiveMode] ?? 0;
    const requiredRank = PERMISSION_RANK[requiredMode] ?? 0;

    if (activeRank >= requiredRank) {
      return { allowed: true };
    }

    // Prompt / escalation handling
    if (
      effectiveMode === PermissionMode.Prompt ||
      this.canEscalate(effectiveMode, requiredMode)
    ) {
      if (this.handlerType === 'interactive') {
        return {
          allowed: false,
          reason: `Tool "${toolName}" requires ${requiredMode} (current: ${effectiveMode}). User approval needed.`,
        };
      }
      if (this.handlerType === 'swarm_worker') {
        return {
          allowed: false,
          reason: `Swarm workers cannot escalate permissions (tool: "${toolName}")`,
        };
      }
      // Coordinator: deny by default unless explicitly allowed
      return {
        allowed: false,
        reason: `Coordinator policy denies escalation for "${toolName}"`,
      };
    }

    return {
      allowed: false,
      reason: `Insufficient permission: need ${requiredMode}, have ${effectiveMode}`,
    };
  }

  // =========================================================================
  // Audit Trail
  // =========================================================================

  /**
   * Log a permission decision to the `permission_audit_log` table and
   * accumulate denials in session memory.
   */
  async logDecision(
    toolName: string,
    allowed: boolean,
    reason: string,
    sessionId: string,
  ): Promise<void> {
    // Track denials in memory
    if (!allowed) {
      this._denials.push({
        tool_name: toolName,
        reason,
        timestamp: new Date().toISOString(),
      });
    }

    // Persist to audit log via OB1Client
    const entry: AuditEntry = {
      session_id: sessionId,
      tool_name: toolName,
      decision: allowed ? 'allow' : 'deny',
      reason,
      decided_by: this.handlerType === 'interactive'
        ? 'policy'
        : this.handlerType === 'coordinator'
          ? 'coordinator'
          : 'swarm_deny',
      active_mode: this.activeMode,
      required_mode: this.toolOverrides[toolName] ?? PermissionMode.DangerFullAccess,
    };

    try {
      await this.client.logAudit(entry);
    } catch (err) {
      // Audit failures are non-fatal -- they should not block execution
      console.error(
        '[PermissionPolicy] audit log write failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // =========================================================================
  // Session Denial Tracking
  // =========================================================================

  /** Total number of denials in this session. */
  get denialCount(): number {
    return this._denials.length;
  }

  /** All denial records accumulated in this session. */
  get denials(): PermissionDenial[] {
    return [...this._denials];
  }

  /**
   * Number of denials for a specific tool (for behavioral adaptation:
   * if a tool has been denied 3+ times, inject a redirect message).
   */
  denialCountForTool(toolName: string): number {
    return this._denials.filter(d => d.tool_name === toolName).length;
  }

  /** Overall denial rate across all decisions. */
  denialRate(): number {
    if (this._totalDecisions === 0) return 0;
    return this._denials.length / this._totalDecisions;
  }

  // =========================================================================
  // Factory Methods
  // =========================================================================

  /**
   * Create a read-only policy (swarm worker, no escalation).
   */
  static readOnly(client: OB1Client): PermissionPolicy {
    const policy = new PermissionPolicy(client);
    policy.configure({
      active_mode: PermissionMode.ReadOnly,
      handler_type: 'swarm_worker',
    });
    return policy;
  }

  /**
   * Create a sub-agent policy with scoped tools and coordinator handler.
   */
  static subAgent(client: OB1Client, allowedTools: string[]): PermissionPolicy {
    const policy = new PermissionPolicy(client);
    policy.configure({
      active_mode: PermissionMode.WorkspaceWrite,
      handler_type: 'coordinator',
      deny_prefixes: ['mcp__'],
      allow_tools: allowedTools,
    });
    return policy;
  }

  /**
   * Create a full-access policy (everything auto-allowed).
   */
  static fullAccess(client: OB1Client): PermissionPolicy {
    const policy = new PermissionPolicy(client);
    policy.configure({
      active_mode: PermissionMode.Allow,
      handler_type: 'interactive',
    });
    return policy;
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  /**
   * Determine whether the active mode can be escalated to the required mode.
   * Only workspace_write can escalate to danger_full_access (via prompter).
   */
  private canEscalate(
    active: PermissionMode,
    required: PermissionMode,
  ): boolean {
    return (
      active === PermissionMode.WorkspaceWrite &&
      required === PermissionMode.DangerFullAccess
    );
  }
}
