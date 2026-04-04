/**
 * OB1 API Client
 *
 * Wraps all 7 Supabase Edge Functions (52 actions) behind a typed,
 * namespace-scoped interface.  Every call goes through `this.call()`
 * which handles auth, serialization, and error normalization.
 *
 * All Edge Functions use POST with { action, ...params } body and
 * x-access-key header authentication.
 */

export class OB1ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'OB1ApiError';
    this.status = status;
    this.code = code;
  }
}

// --- Types ---

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface TaskMetadata {
  type: 'task';
  status: TaskStatus;
  priority: number;
  agent_type: string;
  depends_on: string[];
  max_turns: number;
  max_usd: number;
  title: string;
  description: string;
  memory_scope?: string;
  memory_type?: string;
  tags?: string[];
  provenance?: Record<string, unknown>;
  version?: number;
}

export interface Task {
  id: string;
  content: string;
  metadata: TaskMetadata;
  created_at: string;
}

export interface NightRunConfig {
  total_budget_usd: number;
  max_duration_hours: number;
  max_concurrent_agents: number;
  model: 'haiku' | 'sonnet' | 'opus';
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'pending' | 'cancelled' | 'timeout';

export interface Run {
  id: string;
  name: string;
  status: RunStatus;
  created_at: string;
  completed_at?: string;
  budget_used_usd?: number;
  budget_limit_usd?: number;
  tasks_completed?: number;
  tasks_total?: number;
  duration_seconds?: number;
  type?: 'night_run' | 'manual' | 'scheduled';
}

export interface AgentRun {
  id: string;
  run_id: string;
  agent_type_id: string;
  agent_type_name: string;
  task_prompt: string;
  task_context: Record<string, unknown>;
  status: RunStatus;
  coordinator_run_id: string | null;
  parent_run_id: string | null;
  depends_on: string[];
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  iteration_count: number | null;
  max_iterations_used: number;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  total_cost_usd: number | null;
  output_summary: string | null;
  output_data: Record<string, unknown> | null;
  error_message: string | null;
  thought_ids: string[];
  session_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AgentType {
  id: string;
  name: string;
  display_name: string;
  description: string;
  source: 'built_in' | 'custom' | 'skill_pack';
  permission_mode: 'read_only' | 'workspace_write' | 'danger_full_access';
  allowed_tools: string[];
  denied_tools: string[];
  denied_prefixes: string[];
  system_prompt: string;
  constraints: string[];
  max_iterations: number;
  output_format: string;
  handler_type: string;
  color: string | null;
  icon: string | null;
  can_spawn: boolean;
  enabled: boolean;
  metadata: Record<string, unknown>;
}

export interface AgentMessage {
  id: string;
  coordinator_run_id: string;
  from_run_id: string;
  to_run_id: string | null;
  channel: string;
  message_type: 'data' | 'finding' | 'request' | 'status_update' | 'error' | 'completion';
  content: Record<string, unknown>;
  summary: string | null;
  thought_id: string | null;
  delivered: boolean;
  delivered_at: string | null;
  created_at: string;
}

export interface AgentSummary {
  coordinator_run_id: string;
  overall_status: string;
  total_agents: number;
  by_status: Record<string, number>;
  totals: {
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    duration_ms: number;
  };
  failed_agents: Array<{ run_id: string; agent_type: string; error: string | null }>;
  agents: Array<{
    run_id: string;
    agent_type: string;
    status: string;
    duration_ms: number | null;
    cost_usd: number | null;
  }>;
}

export interface SpawnAgentRequest {
  agent_type: string;
  task_prompt: string;
  task_context?: Record<string, unknown>;
  coordinator_run_id?: string;
  parent_run_id?: string;
  depends_on?: string[];
  session_id?: string;
  metadata?: Record<string, unknown>;
}

export interface Session {
  id: string;
  created_at: string;
  budget_used_usd: number;
  budget_limit_usd: number;
}

export type HealthStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: HealthStatus;
  message: string;
}

export interface DoctorResult {
  overall: HealthStatus;
  checks: DoctorCheck[];
  timestamp: string;
}

export interface MemoryStats {
  total_thoughts: number;
  thoughts_today: number;
  vector_coverage: number;
  by_scope: Record<string, number>;
  by_type: Record<string, number>;
  average_trust: number;
}

export type MemoryScope = 'personal' | 'team' | 'project' | 'session' | 'agent';
export type MemoryType = 'fact' | 'preference' | 'decision' | 'instruction' | 'observation' | 'context';
export type MemorySource = 'user-stated' | 'model-inferred' | 'compaction-derived';

export interface Memory {
  id: string;
  content: string;
  scope: MemoryScope;
  type: MemoryType;
  trust_level: number;
  tags: string[];
  source: MemorySource;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  deleted_reason?: string;
  similarity?: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryVersion {
  id: string;
  memory_id: string;
  content: string;
  changed_at: string;
  changed_by?: string;
  change_reason?: string;
}

export interface MemorySearchFilters {
  scope?: MemoryScope;
  type?: MemoryType;
  min_trust?: number;
  max_trust?: number;
  max_results?: number;
  min_similarity?: number;
}

export interface MemoryCreateInput {
  content: string;
  scope: MemoryScope;
  type: MemoryType;
  tags?: string[];
  trust_level?: number;
}

export interface MemoryUpdateInput {
  content?: string;
  new_content?: string;
  scope?: MemoryScope;
  type?: MemoryType;
  tags?: string[];
  trust_level?: number;
  reason?: string;
}

export type EventSeverity = 'info' | 'warn' | 'error';

export interface SystemEvent {
  id: string;
  title: string;
  description?: string;
  severity: EventSeverity;
  timestamp: string;
  source?: string;
  type?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class OB1ApiClient {
  private baseUrl: string;
  private accessKey: string;

  constructor(supabaseUrl: string, accessKey: string) {
    this.baseUrl = supabaseUrl.replace(/\/$/, '') + '/functions/v1';
    this.accessKey = accessKey;
  }

  /** All Edge Functions use POST + { action, ...params } + x-access-key header */
  private async call<T = any>(
    fn: string,
    action: string,
    params?: Record<string, any>,
  ): Promise<T> {
    const url = `${this.baseUrl}/${fn}`;
    const body = JSON.stringify({ action, ...params });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-access-key': this.accessKey,
      },
      body,
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const message =
        data?.error ?? data?.message ?? `Edge Function ${fn} returned ${res.status}`;
      throw new OB1ApiError(message, res.status, data?.code);
    }

    return data as T;
  }

  // -----------------------------------------------------------------------
  // Tool operations  (agent-tools)
  // -----------------------------------------------------------------------

  tools = {
    list: (filters?: Record<string, any>) =>
      this.call('agent-tools', 'list_tools', filters),
    get: (toolId: string) =>
      this.call('agent-tools', 'get_tool', { tool_id: toolId }),
    register: (tool: Record<string, any>) =>
      this.call('agent-tools', 'register_tool', tool),
    assemblePool: (options?: Record<string, any>) =>
      this.call('agent-tools', 'assemble_pool', options),
    checkPermission: (params: Record<string, any>) =>
      this.call('agent-tools', 'check_permission', params),
    logUsage: (params: Record<string, any>) =>
      this.call('agent-tools', 'log_tool_usage', params),
    getAuditSummary: (sessionId: string) =>
      this.call('agent-tools', 'get_audit_summary', { session_id: sessionId }),
  };

  // -----------------------------------------------------------------------
  // State operations  (agent-state)
  // -----------------------------------------------------------------------

  state = {
    createSession: (config?: Record<string, any>) =>
      this.call('agent-state', 'create_session', config),
    getSession: (id: string) =>
      this.call('agent-state', 'get_session', { session_id: id }),
    listSessions: (filters?: Record<string, any>) =>
      this.call<Session[]>('agent-state', 'list_sessions', filters),
    updateSession: (id: string, updates: Record<string, any>) =>
      this.call('agent-state', 'update_session', { session_id: id, ...updates }),
    endSession: (id: string) =>
      this.call('agent-state', 'end_session', { session_id: id }),
    getWorkflow: (id: string) =>
      this.call('agent-state', 'get_workflow', { session_id: id }),
    checkBudget: (id: string) =>
      this.call('agent-state', 'check_budget', { session_id: id }),
    getBudget: (id: string) =>
      this.call('agent-state', 'get_budget', { session_id: id }),
    recordCost: (id: string, cost: Record<string, any>) =>
      this.call('agent-state', 'record_cost', { session_id: id, ...cost }),
  };

  // -----------------------------------------------------------------------
  // Events  (agent-stream)
  // -----------------------------------------------------------------------

  events = {
    emit: (event: Record<string, any>) =>
      this.call('agent-stream', 'emit_event', event),
    query: (filters?: Record<string, any>) =>
      this.call<SystemEvent[]>('agent-stream', 'query_events', filters),
    getSummary: (sessionId: string) =>
      this.call('agent-stream', 'get_event_summary', { session_id: sessionId }),
    getVerificationRuns: (filters?: Record<string, any>) =>
      this.call('agent-stream', 'get_verification_runs', filters),
    getVerificationRun: (runId: string) =>
      this.call('agent-stream', 'get_verification_run', { run_id: runId }),
  };

  // -----------------------------------------------------------------------
  // Doctor  (agent-doctor)
  // -----------------------------------------------------------------------

  doctor = {
    run: () => this.call<DoctorResult>('agent-doctor', 'run_doctor'),
    getReport: () => this.call<DoctorResult>('agent-doctor', 'get_doctor_report'),
    getBootHistory: (filters?: Record<string, any>) =>
      this.call('agent-doctor', 'get_boot_history', filters),
    getBootPerformance: () =>
      this.call('agent-doctor', 'get_boot_performance'),
    getConfig: () => this.call('agent-doctor', 'get_config'),
    updateConfig: (config: Record<string, any>) =>
      this.call('agent-doctor', 'update_config', config),
  };

  // -----------------------------------------------------------------------
  // Memory  (agent-memory)
  // -----------------------------------------------------------------------

  memory = {
    store: (content: string, metadata?: Record<string, any>) =>
      this.call<Memory>('agent-memory', 'memory_store', { content, ...metadata }),
    recall: (query: string, filters?: MemorySearchFilters) =>
      this.call<Memory[]>('agent-memory', 'memory_recall', { query, ...filters }),
    forget: (thoughtId: string, reason?: string) =>
      this.call<{ success: boolean }>('agent-memory', 'memory_forget', {
        thought_id: thoughtId, reason,
      }),
    update: (thoughtId: string, updates: MemoryUpdateInput) =>
      this.call<Memory>('agent-memory', 'memory_update', {
        thought_id: thoughtId, ...updates,
      }),
    consolidate: (params?: Record<string, any>) =>
      this.call('agent-memory', 'memory_consolidate', params),
    stats: () => this.call<MemoryStats>('agent-memory', 'get_memory_stats'),
  };

  // -----------------------------------------------------------------------
  // Skills  (agent-skills)
  // -----------------------------------------------------------------------

  skills = {
    list: (filters?: Record<string, any>) =>
      this.call('agent-skills', 'list_skills', filters),
    get: (skillId: string) =>
      this.call('agent-skills', 'get_skill', { skill_id: skillId }),
    register: (skill: Record<string, any>) =>
      this.call('agent-skills', 'register_skill', skill),
    listHooks: () => this.call('agent-skills', 'list_hooks'),
    getHook: (hookId: string) =>
      this.call('agent-skills', 'get_hook', { hook_id: hookId }),
    listPlugins: () => this.call('agent-skills', 'list_plugins'),
    getPlugin: (pluginId: string) =>
      this.call('agent-skills', 'get_plugin', { plugin_id: pluginId }),
  };

  // -----------------------------------------------------------------------
  // Coordinator  (agent-coordinator)
  // -----------------------------------------------------------------------

  coordinator = {
    listTypes: () =>
      this.call<{ agent_types: AgentType[]; count: number }>('agent-coordinator', 'list_agent_types'),
    getType: (typeId: string) =>
      this.call<AgentType>('agent-coordinator', 'get_agent_type', { type_id: typeId }),
    spawn: (opts: SpawnAgentRequest) =>
      this.call<{ id: string; run_id: string; agent_type: string; status: string; created_at: string }>(
        'agent-coordinator', 'spawn_agent', opts,
      ),
    listRuns: (filters?: Record<string, any>) =>
      this.call<{ runs: AgentRun[]; count: number }>('agent-coordinator', 'list_agent_runs', filters),
    getRun: (runId: string) =>
      this.call<{ run: AgentRun }>('agent-coordinator', 'get_agent_run', { run_id: runId }),
    cancelRun: (runId: string, reason?: string) =>
      this.call('agent-coordinator', 'cancel_agent_run', { run_id: runId, reason }),
    updateStatus: (runId: string, status: RunStatus, extra?: Record<string, unknown>) =>
      this.call<{ run: AgentRun; updated: boolean }>(
        'agent-coordinator', 'update_agent_status', { run_id: runId, status, ...extra },
      ),
    getSummary: (coordinatorId: string) =>
      this.call<AgentSummary>('agent-coordinator', 'get_agent_summary', {
        coordinator_id: coordinatorId,
      }),
    getMessages: (runId: string, coordinatorRunId?: string) =>
      this.call<{ messages: AgentMessage[]; count: number }>(
        'agent-coordinator', 'get_messages', {
          run_id: runId,
          ...(coordinatorRunId ? { coordinator_run_id: coordinatorRunId } : {}),
        },
      ),
    sendMessage: (runId: string, message: Record<string, any>) =>
      this.call('agent-coordinator', 'send_message', { run_id: runId, ...message }),
  };

  // -----------------------------------------------------------------------
  // Tasks  (compound operations via agent-memory + agent-coordinator)
  // -----------------------------------------------------------------------

  tasks = {
    list: () =>
      this.call<{ results: Task[] }>('agent-memory', 'memory_recall', {
        query: 'night run task',
        memory_scope: 'project',
        memory_type: 'instruction',
        max_results: 100,
        min_similarity: 0.0,
      }),
    create: (task: {
      title: string;
      description: string;
      agent_type: string;
      max_turns: number;
      max_usd: number;
      priority: number;
      depends_on: string[];
    }) =>
      this.call<{ thought_id: string }>('agent-memory', 'memory_store', {
        content: `[Task] ${task.title}: ${task.description}`,
        memory_type: 'instruction',
        memory_scope: 'project',
        source_type: 'user_stated',
        trust_level: 5,
        tags: ['task', 'night-run', task.agent_type],
      }),
    update: (thoughtId: string, newContent: string, reason?: string) =>
      this.call<{ new_thought_id: string }>('agent-memory', 'memory_update', {
        thought_id: thoughtId,
        new_content: newContent,
        reason: reason ?? 'Task updated',
      }),
    remove: (thoughtId: string) =>
      this.call<{ forgotten: boolean }>('agent-memory', 'memory_forget', {
        thought_id: thoughtId,
        reason: 'Task removed by user',
      }),
    startNightRun: (config: NightRunConfig, taskIds: string[]) =>
      this.call<{ run_id: string; status: string }>('agent-coordinator', 'spawn_agent', {
        agent_type: 'coordinator',
        task_prompt: `Night run with ${taskIds.length} tasks. Budget: $${config.total_budget_usd}, Duration: ${config.max_duration_hours}h, Model: ${config.model}, Concurrency: ${config.max_concurrent_agents}`,
        task_context: { config, task_ids: taskIds },
      }),
  };
}

// ---------------------------------------------------------------------------
// Default singleton for pages that import `api` directly
// (Prefer the context-based `useApi()` hook in new code.)
// ---------------------------------------------------------------------------

const SUPABASE_URL = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
  : (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');

const ACCESS_KEY = typeof window !== 'undefined'
  ? (process.env.OB1_ACCESS_KEY ?? process.env.NEXT_PUBLIC_OB1_ACCESS_KEY ?? '')
  : (process.env.OB1_ACCESS_KEY ?? '');

export const api = new OB1ApiClient(SUPABASE_URL, ACCESS_KEY);
