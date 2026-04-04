// =============================================================================
// OB1 Agentic Runtime -- Unified HTTP Client
// =============================================================================
// Single client for all 7 Supabase Edge Functions (52 API actions).
// Uses built-in fetch (Node 20+). No external HTTP dependencies.
// =============================================================================

import type {
  ToolSpec,
  PermissionPolicy,
  PermissionMode,
  AuditEntry,
  AuditSummary,
  SessionState,
  WorkflowStep,
  RecoveryResult,
  BudgetStatus,
  BudgetConfig,
  UsageEntry,
  SystemEvent,
  VerificationResult,
  DoctorCheckResult,
  BootRun,
  AgentType,
  AgentRun,
  AgentRunStatus,
  AgentMessage,
  AgentSummary,
  MemoryResult,
  SkillDef,
  HookConfig,
  HookEvent,
  Plugin,
  SourceType,
} from './types.js';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Structured error from an Edge Function response. */
export class OB1Error extends Error {
  constructor(
    message: string,
    public readonly functionName: string,
    public readonly action: string,
    public readonly status: number,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'OB1Error';
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class OB1Client {
  private readonly baseUrl: string;
  private readonly accessKey: string;
  private readonly defaultTimeout: number;

  /**
   * @param supabaseUrl  Project URL, e.g. "https://xyz.supabase.co"
   * @param accessKey    Service-role key (never the anon key for server-side usage)
   * @param timeoutMs    Default request timeout in milliseconds (default 30 000)
   */
  constructor(supabaseUrl: string, accessKey: string, timeoutMs = 30_000) {
    // Strip trailing slash so we can append /functions/v1/...
    this.baseUrl = supabaseUrl.replace(/\/+$/, '');
    this.accessKey = accessKey;
    this.defaultTimeout = timeoutMs;
  }

  // =========================================================================
  // Generic action caller
  // =========================================================================

  /**
   * Call a single action on a named Edge Function.
   *
   * Every Edge Function follows the same envelope:
   *   POST /functions/v1/{functionName}
   *   Body: { action: string, params: Record<string, any> }
   *   Response: { data?: any, error?: string }
   */
  private async call<T = unknown>(
    functionName: string,
    action: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<T> {
    const url = `${this.baseUrl}/functions/v1/${functionName}`;
    const controller = new AbortController();
    const timeout = timeoutMs ?? this.defaultTimeout;
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessKey}`,
          apikey: this.accessKey,
        },
        body: JSON.stringify({ action, params }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      if (!res.ok || body.error) {
        throw new OB1Error(
          (body.error as string) ?? `Edge function returned ${res.status}`,
          functionName,
          action,
          res.status,
          body,
        );
      }

      return (body.data ?? body) as T;
    } catch (err: unknown) {
      clearTimeout(timer);

      if (err instanceof OB1Error) throw err;

      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new OB1Error(
          `Request timed out after ${timeout}ms`,
          functionName,
          action,
          408,
        );
      }

      const message = err instanceof Error ? err.message : String(err);
      throw new OB1Error(
        `Network error: ${message}`,
        functionName,
        action,
        0,
      );
    }
  }

  // =========================================================================
  // Tool Registry  (agent-tools)
  // =========================================================================

  /** List all registered tools, optionally filtered. */
  async listTools(filters?: {
    source_type?: SourceType;
    required_permission?: PermissionMode;
    enabled_only?: boolean;
  }): Promise<ToolSpec[]> {
    return this.call<ToolSpec[]>('agent-tools', 'list_tools', { filters });
  }

  /** Register or update a tool definition. */
  async registerTool(tool: ToolSpec): Promise<void> {
    await this.call('agent-tools', 'register_tool', { tool });
  }

  /** Get all permission policies. */
  async getPolicies(): Promise<PermissionPolicy[]> {
    return this.call<PermissionPolicy[]>('agent-tools', 'get_policies');
  }

  /** Create or update a permission policy. */
  async setPolicy(policy: Partial<PermissionPolicy> & { name: string }): Promise<void> {
    await this.call('agent-tools', 'set_policy', { policy });
  }

  /** Log a single permission audit entry. */
  async logAudit(decision: AuditEntry): Promise<void> {
    await this.call('agent-tools', 'log_audit', { decision });
  }

  /** Get an aggregated audit summary for a session. */
  async getAuditSummary(sessionId: string): Promise<AuditSummary> {
    return this.call<AuditSummary>('agent-tools', 'get_audit_summary', {
      session_id: sessionId,
    });
  }

  /**
   * Assemble a tool pool for a session based on policy, filters, and overrides.
   * Returns only the tools the session is allowed to use.
   */
  async assemblePool(options: {
    policy_name?: string;
    permission_mode?: PermissionMode;
    include_mcp?: boolean;
    additional_deny?: string[];
  }): Promise<ToolSpec[]> {
    return this.call<ToolSpec[]>('agent-tools', 'assemble_pool', options);
  }

  // =========================================================================
  // State  (agent-state)
  // =========================================================================

  /** Create a new agent session. Returns the initial session state. */
  async createSession(config?: Record<string, unknown>): Promise<SessionState> {
    return this.call<SessionState>('agent-state', 'create_session', {
      config: config ?? {},
    });
  }

  /** Retrieve an existing session by ID. */
  async getSession(sessionId: string): Promise<SessionState> {
    return this.call<SessionState>('agent-state', 'get_session', {
      session_id: sessionId,
    });
  }

  /** Partially update a session (status, messages, etc.). */
  async updateSession(
    sessionId: string,
    updates: Partial<SessionState>,
  ): Promise<void> {
    await this.call('agent-state', 'update_session', {
      session_id: sessionId,
      updates,
    });
  }

  /** Create a workflow checkpoint (write-ahead log entry). */
  async createCheckpoint(checkpoint: Partial<WorkflowStep> & {
    session_id: string;
    workflow_id: string;
    step_index: number;
    step_type: string;
    idempotency_key: string;
  }): Promise<WorkflowStep> {
    return this.call<WorkflowStep>('agent-state', 'create_checkpoint', {
      checkpoint,
    });
  }

  /** Recover stuck workflows (incomplete checkpoints) for a session. */
  async recoverStuck(sessionId: string): Promise<RecoveryResult> {
    return this.call<RecoveryResult>('agent-state', 'recover_stuck', {
      session_id: sessionId,
    });
  }

  /** Record token/cost usage to the budget ledger. */
  async recordUsage(
    sessionId: string,
    usage: Omit<UsageEntry, 'session_id'>,
  ): Promise<void> {
    await this.call('agent-state', 'record_usage', {
      session_id: sessionId,
      ...usage,
    });
  }

  /** Check whether the session can proceed under its budget limits. */
  async checkBudget(sessionId: string): Promise<BudgetStatus> {
    return this.call<BudgetStatus>('agent-state', 'check_budget', {
      session_id: sessionId,
    });
  }

  // =========================================================================
  // Events  (agent-stream)
  // =========================================================================

  /** Log a single system event. */
  async logEvent(event: Partial<SystemEvent> & {
    category: SystemEvent['category'];
    severity: SystemEvent['severity'];
    title: string;
  }): Promise<void> {
    await this.call('agent-stream', 'log_event', { event });
  }

  /** Log a batch of system events (max ~100 per call). */
  async logEventsBatch(events: Array<Partial<SystemEvent> & {
    category: SystemEvent['category'];
    severity: SystemEvent['severity'];
    title: string;
  }>): Promise<void> {
    await this.call('agent-stream', 'log_events_batch', { events });
  }

  /** Query system events with filters. */
  async queryEvents(filters: {
    session_id?: string;
    category?: SystemEvent['category'];
    severity?: SystemEvent['severity'];
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<SystemEvent[]> {
    return this.call<SystemEvent[]>('agent-stream', 'query_events', { filters });
  }

  /** Run the verification harness against logged events / results. */
  async runVerification(results: {
    session_id: string;
    invariants?: string[];
  }): Promise<VerificationResult> {
    return this.call<VerificationResult>('agent-stream', 'run_verification', results);
  }

  // =========================================================================
  // Doctor  (agent-doctor)
  // =========================================================================

  /** Run the full doctor health-check suite. */
  async runDoctor(): Promise<DoctorCheckResult[]> {
    return this.call<DoctorCheckResult[]>('agent-doctor', 'run_doctor');
  }

  /** Record a completed boot run. */
  async recordBoot(bootRun: BootRun): Promise<void> {
    await this.call('agent-doctor', 'record_boot', { boot_run: bootRun });
  }

  /** Get the current scoped configuration. */
  async getConfig(scope?: string): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>('agent-doctor', 'get_config', {
      scope,
    });
  }

  /** Save a configuration snapshot. */
  async saveConfig(config: {
    session_id?: string;
    merged_config: Record<string, unknown>;
    provenance: Record<string, unknown>;
    mcp_servers?: unknown[];
    source_files?: unknown[];
  }): Promise<void> {
    await this.call('agent-doctor', 'save_config', { config });
  }

  // =========================================================================
  // Memory  (agent-memory)
  // =========================================================================

  /** Store a new memory (thought) and return its ID. */
  async memoryStore(
    content: string,
    metadata: Record<string, unknown>,
  ): Promise<string> {
    return this.call<string>('agent-memory', 'memory_store', {
      content,
      metadata,
    });
  }

  /** Recall memories by semantic similarity, filtered by scope/type/tags. */
  async memoryRecall(
    query: string,
    filters?: {
      memory_scope?: string;
      memory_type?: string;
      tags?: string[];
      limit?: number;
      min_similarity?: number;
      owner_id?: string;
      team_id?: string;
      project_id?: string;
    },
  ): Promise<MemoryResult[]> {
    return this.call<MemoryResult[]>('agent-memory', 'memory_recall', {
      query,
      filters,
    });
  }

  /** Soft-delete a memory (marks deleted in metadata). */
  async memoryForget(thoughtId: string, reason: string): Promise<void> {
    await this.call('agent-memory', 'memory_forget', {
      thought_id: thoughtId,
      reason,
    });
  }

  /** Update a memory's content, creating a new version. Returns the new thought ID. */
  async memoryUpdate(thoughtId: string, newContent: string): Promise<string> {
    return this.call<string>('agent-memory', 'memory_update', {
      thought_id: thoughtId,
      new_content: newContent,
    });
  }

  /** Consolidate multiple memories into one. Returns the consolidated thought ID. */
  async memoryConsolidate(thoughtIds: string[]): Promise<string> {
    return this.call<string>('agent-memory', 'memory_consolidate', {
      thought_ids: thoughtIds,
    });
  }

  // =========================================================================
  // Skills  (agent-skills)
  // =========================================================================

  /** List registered skills, optionally filtered. */
  async listSkills(filters?: {
    source_type?: string;
    enabled_only?: boolean;
    plugin_id?: string;
  }): Promise<SkillDef[]> {
    return this.call<SkillDef[]>('agent-skills', 'list_skills', { filters });
  }

  /** Register or update a skill definition. */
  async registerSkill(skill: SkillDef): Promise<void> {
    await this.call('agent-skills', 'register_skill', { skill });
  }

  /** List registered hook configurations, optionally filtered. */
  async listHooks(filters?: {
    event_type?: HookEvent;
    tool_name?: string;
    enabled_only?: boolean;
  }): Promise<HookConfig[]> {
    return this.call<HookConfig[]>('agent-skills', 'list_hooks', { filters });
  }

  /** Register or update a hook configuration. */
  async registerHook(hook: HookConfig): Promise<void> {
    await this.call('agent-skills', 'register_hook', { hook });
  }

  /** List installed plugins, optionally filtered. */
  async listPlugins(filters?: {
    status?: string;
    trust_tier?: string;
  }): Promise<Plugin[]> {
    return this.call<Plugin[]>('agent-skills', 'list_plugins', { filters });
  }

  // =========================================================================
  // Coordinator  (agent-coordinator)
  // =========================================================================

  /** List all registered agent type definitions. */
  async listAgentTypes(): Promise<AgentType[]> {
    return this.call<AgentType[]>('agent-coordinator', 'list_agent_types');
  }

  /** Spawn a new agent of the given type. Returns the created AgentRun. */
  async spawnAgent(
    type: string,
    options: {
      task_prompt: string;
      task_context?: Record<string, unknown>;
      coordinator_run_id?: string;
      parent_run_id?: string;
      depends_on?: string[];
      budget_config?: BudgetConfig;
    },
  ): Promise<AgentRun> {
    return this.call<AgentRun>('agent-coordinator', 'spawn_agent', {
      agent_type: type,
      ...options,
    });
  }

  /** Update an agent run's status and optionally its result/output. */
  async updateAgentStatus(
    runId: string,
    status: AgentRunStatus,
    result?: {
      output_summary?: string;
      output_data?: Record<string, unknown>;
      error_message?: string;
      thought_ids?: string[];
    },
  ): Promise<void> {
    await this.call('agent-coordinator', 'update_agent_status', {
      run_id: runId,
      status,
      result,
    });
  }

  /** Get a single agent run by ID. */
  async getAgentRun(runId: string): Promise<AgentRun> {
    return this.call<AgentRun>('agent-coordinator', 'get_agent_run', {
      run_id: runId,
    });
  }

  /** List agent runs, optionally filtered. */
  async listAgentRuns(filters?: {
    coordinator_run_id?: string;
    status?: AgentRunStatus;
    agent_type?: string;
    limit?: number;
  }): Promise<AgentRun[]> {
    return this.call<AgentRun[]>('agent-coordinator', 'list_agent_runs', {
      filters,
    });
  }

  /** Send a message from one agent to another (or broadcast). */
  async sendMessage(
    from: string,
    to: string | null,
    content: Record<string, unknown>,
    options?: {
      coordinator_run_id: string;
      channel?: string;
      message_type?: AgentMessage['message_type'];
      summary?: string;
    },
  ): Promise<void> {
    await this.call('agent-coordinator', 'send_message', {
      from_run_id: from,
      to_run_id: to,
      content,
      ...options,
    });
  }

  /** Get messages for an agent run, optionally only undelivered ones. */
  async getMessages(
    runId: string,
    undeliveredOnly = false,
  ): Promise<AgentMessage[]> {
    return this.call<AgentMessage[]>('agent-coordinator', 'get_messages', {
      run_id: runId,
      undelivered_only: undeliveredOnly,
    });
  }

  /** Get an aggregated summary of all agents under a coordinator. */
  async getAgentSummary(coordinatorId: string): Promise<AgentSummary> {
    return this.call<AgentSummary>('agent-coordinator', 'get_agent_summary', {
      coordinator_id: coordinatorId,
    });
  }
}
