// =============================================================================
// OB1 Agentic Runtime -- Shared Type Definitions
// =============================================================================
// All shared types, interfaces, and enums used across the OB1 runtime.
// Derived from Blueprints 01-08.
// =============================================================================

// ---------------------------------------------------------------------------
// Permission System (Blueprint 01)
// ---------------------------------------------------------------------------

/** Five ordered permission modes. Comparison determines access. */
export enum PermissionMode {
  ReadOnly = 'read_only',
  WorkspaceWrite = 'workspace_write',
  DangerFullAccess = 'danger_full_access',
  Prompt = 'prompt',
  Allow = 'allow',
}

/** Numeric ranking for permission comparison. */
export const PERMISSION_RANK: Record<PermissionMode, number> = {
  [PermissionMode.ReadOnly]: 0,
  [PermissionMode.WorkspaceWrite]: 1,
  [PermissionMode.DangerFullAccess]: 2,
  [PermissionMode.Prompt]: 3,
  [PermissionMode.Allow]: 4,
};

/** Where a tool was defined. */
export type SourceType = 'built_in' | 'plugin' | 'skill' | 'mcp';

/** Side-effect profile attached to every tool. */
export interface SideEffectProfile {
  writes_files: boolean;
  network_access: boolean;
  destructive: boolean;
  reversible: boolean;
  spawns_process: boolean;
}

/** Complete tool specification stored in tool_registry. */
export interface ToolSpec {
  name: string;
  description: string;
  source_type: SourceType;
  required_permission: PermissionMode;
  input_schema: Record<string, unknown>;
  side_effect_profile: SideEffectProfile;
  enabled: boolean;
  aliases: string[];
  mcp_server_url?: string;
  metadata: Record<string, unknown>;
}

/** Named permission policy assigned to sessions or agents. */
export interface PermissionPolicy {
  id: string;
  name: string;
  description?: string;
  active_mode: PermissionMode;
  tool_overrides: Record<string, PermissionMode>;
  handler_type: 'interactive' | 'coordinator' | 'swarm_worker';
  deny_tools: string[];
  deny_prefixes: string[];
  allow_tools: string[];
  metadata: Record<string, unknown>;
}

/** Logged when a tool request is denied by the permission system. */
export interface PermissionDenial {
  tool_name: string;
  reason: string;
  timestamp: string;
}

/** Single entry in the permission audit log. */
export interface AuditEntry {
  session_id: string;
  tool_name: string;
  decision: 'allow' | 'deny' | 'escalate';
  reason?: string;
  decided_by: 'policy' | 'prompter' | 'coordinator' | 'swarm_deny';
  active_mode: string;
  required_mode: string;
  policy_id?: string;
  input_summary?: string;
}

/** Aggregated audit summary for a session. */
export interface AuditSummary {
  session_id: string;
  total_decisions: number;
  denial_count: number;
  decisions_by_type: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Session Persistence (Blueprint 02)
// ---------------------------------------------------------------------------

/** Per-message token usage breakdown. */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

/** A single message in the conversation transcript. */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ContentBlock[];
  usage?: TokenUsage;
  timestamp?: string;
  tool_use_id?: string;
}

/** Content block within a message. */
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: unknown;
  is_error?: boolean;
}

/** Permission decision persisted across a session. */
export interface PermissionDecision {
  tool_name: string;
  decision: 'allow' | 'deny';
  reason?: string;
  granted_at: string;
  scope: 'turn' | 'session';
}

/** Complete session state snapshot. */
export interface SessionState {
  session_id: string;
  version: number;
  status: 'active' | 'suspended' | 'completed' | 'crashed';
  messages: Message[];
  config_snapshot: Record<string, unknown>;
  permission_decisions: PermissionDecision[];
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_write_tokens: number;
  total_cache_read_tokens: number;
  total_cost_usd: number;
  turn_count: number;
  compaction_count: number;
  last_compaction_at?: string;
}

// ---------------------------------------------------------------------------
// Workflow State & Idempotency (Blueprint 02)
// ---------------------------------------------------------------------------

/** State machine for workflow step progression. */
export enum WorkflowState {
  Planned = 'planned',
  AwaitingApproval = 'awaiting_approval',
  Executing = 'executing',
  WaitingOnExternal = 'waiting_on_external',
  Completed = 'completed',
  Failed = 'failed',
  Skipped = 'skipped',
}

/** A single checkpoint in a workflow (write-ahead log entry). */
export interface WorkflowStep {
  id: string;
  session_id: string;
  workflow_id: string;
  step_index: number;
  state: WorkflowState;
  step_type: string;
  step_description?: string;
  step_input: Record<string, unknown>;
  step_output?: Record<string, unknown>;
  error_detail?: string;
  idempotency_key: string;
  execution_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

/** Result of crash recovery on stuck workflows. */
export interface RecoveryResult {
  recovered_steps: number;
  failed_steps: number;
  details: Array<{
    step_index: number;
    idempotency_key: string;
    previous_state: WorkflowState;
    action_taken: string;
  }>;
}

// ---------------------------------------------------------------------------
// Budget Tracking (Blueprint 02)
// ---------------------------------------------------------------------------

/** Budget limits for a session. */
export interface BudgetConfig {
  max_turns?: number;
  max_budget_tokens?: number;
  max_budget_usd?: number;
  compact_after_turns?: number;
}

/** Current budget consumption status returned by checkBudget. */
export interface BudgetStatus {
  turns_used: number;
  tokens_used: number;
  usd_used: number;
  can_proceed: boolean;
  stop_reason?: StopReason;
}

/** Reason a session was stopped. */
export enum StopReason {
  Completed = 'completed',
  MaxTurnsReached = 'max_turns_reached',
  MaxBudgetTokensReached = 'max_budget_tokens_reached',
  MaxBudgetUsdReached = 'max_budget_usd_reached',
  UserCancelled = 'user_cancelled',
  Error = 'error',
  Timeout = 'timeout',
  ContextOverflow = 'context_overflow',
}

/** Usage entry written to the budget ledger. */
export interface UsageEntry {
  session_id: string;
  turn_number: number;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  model?: string;
}

// ---------------------------------------------------------------------------
// Streaming Events (Blueprint 03)
// ---------------------------------------------------------------------------

/** Discriminated union tag for stream events. */
export enum StreamEventType {
  MessageStart = 'message_start',
  ToolMatch = 'tool_match',
  PermissionDenial = 'permission_denial',
  MessageDelta = 'message_delta',
  MessageStop = 'message_stop',
  ToolExecution = 'tool_execution',
}

/** Base fields present on every stream event. */
export interface StreamEventBase {
  type: StreamEventType;
  timestamp: string;
  session_id: string;
  sequence: number;
}

/** Emitted at the start of each agent response. */
export interface MessageStartEvent extends StreamEventBase {
  type: StreamEventType.MessageStart;
  prompt_fingerprint: string;
  model: string;
  context_token_count: number;
}

/** Emitted when the router matches tools for the current turn. */
export interface ToolMatchEvent extends StreamEventBase {
  type: StreamEventType.ToolMatch;
  matched_tools: Array<{
    tool_name: string;
    match_score: number;
    source: 'builtin' | 'mcp' | 'skill';
  }>;
  total_available: number;
}

/** Emitted when a tool is denied by the permission system. */
export interface PermissionDenialEvent extends StreamEventBase {
  type: StreamEventType.PermissionDenial;
  tool_name: string;
  denial_reason: string;
  policy_source: 'allowlist' | 'denylist' | 'user_rejection' | 'budget';
  was_destructive: boolean;
}

/** Emitted for each content chunk from the LLM. */
export interface MessageDeltaEvent extends StreamEventBase {
  type: StreamEventType.MessageDelta;
  delta: string;
  accumulated_length: number;
}

/** Emitted when the LLM response completes. */
export interface MessageStopEvent extends StreamEventBase {
  type: StreamEventType.MessageStop;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'budget_exhausted' | 'error';
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    total_cost_cents: number;
  };
  transcript_size: number;
  turn_duration_ms: number;
}

/** Emitted when the agent requests tool execution. */
export interface ToolExecutionEvent extends StreamEventBase {
  type: StreamEventType.ToolExecution;
  tool_name: string;
  requires_approval: boolean;
  approval_status: 'pending' | 'approved' | 'denied' | 'auto_approved';
  execution_duration_ms?: number;
  exit_code?: number;
}

/** Union of all stream event types. */
export type StreamEvent =
  | MessageStartEvent
  | ToolMatchEvent
  | PermissionDenialEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | ToolExecutionEvent;

// ---------------------------------------------------------------------------
// System Event Logging (Blueprint 03)
// ---------------------------------------------------------------------------

/** Severity levels in ascending order of importance. */
export type Severity = 'debug' | 'info' | 'warn' | 'error' | 'critical';

/** Event categories matching lifecycle phases. */
export type EventCategory =
  | 'initialization'
  | 'registry'
  | 'tool_selection'
  | 'permission'
  | 'execution'
  | 'stream'
  | 'turn_complete'
  | 'session'
  | 'compaction'
  | 'usage'
  | 'error'
  | 'hook'
  | 'verification'
  | 'boot'
  | 'doctor'
  | 'config'
  | 'agent_spawn'
  | 'agent_complete'
  | 'agent_fail'
  | 'agent_cancel'
  | 'agent_message'
  | 'coordinator';

/** Immutable system event record. */
export interface SystemEvent {
  event_id: string;
  timestamp: string;
  session_id: string;
  category: EventCategory;
  severity: Severity;
  title: string;
  detail: Record<string, unknown>;
  sequence?: number;
}

/** Result from the verification harness. */
export interface VerificationResult {
  passed: boolean;
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  failures: Array<{
    invariant: string;
    expected: unknown;
    actual: unknown;
    detail: string;
  }>;
}

// ---------------------------------------------------------------------------
// Boot Sequence (Blueprint 05)
// ---------------------------------------------------------------------------

/** The 10 boot phases in strict execution order. */
export enum BootPhase {
  Prefetch = 'prefetch',
  Environment = 'environment',
  ConfigLoading = 'config_loading',
  TrustGate = 'trust_gate',
  RegistryInit = 'registry_init',
  WorkspaceInit = 'workspace_init',
  DeferredLoading = 'deferred_loading',
  ModeRouting = 'mode_routing',
  DoctorCheck = 'doctor_check',
  MainLoop = 'main_loop',
}

/** Strict phase ordering (index = execution order). */
export const BOOT_PHASE_ORDER: BootPhase[] = [
  BootPhase.Prefetch,
  BootPhase.Environment,
  BootPhase.ConfigLoading,
  BootPhase.TrustGate,
  BootPhase.RegistryInit,
  BootPhase.WorkspaceInit,
  BootPhase.DeferredLoading,
  BootPhase.ModeRouting,
  BootPhase.DoctorCheck,
  BootPhase.MainLoop,
];

// ---------------------------------------------------------------------------
// Doctor Pattern (Blueprint 05)
// ---------------------------------------------------------------------------

/** The 6 doctor validation categories. */
export type DoctorCategory =
  | 'workspace'
  | 'configuration'
  | 'credentials'
  | 'connections'
  | 'tools'
  | 'sessions';

/** Individual health check result. */
export interface DoctorCheckResult {
  category: DoctorCategory;
  check: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  fix_action?: string;
  duration_ms: number;
  auto_repairable?: boolean;
  auto_repaired?: boolean;
}

/** Complete doctor report. */
export interface DoctorReport {
  run_id: string;
  session_id: string;
  timestamp: string;
  total_duration_ms: number;
  checks: DoctorCheckResult[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
    auto_repaired: number;
    total: number;
  };
}

/** Boot run record persisted to Supabase. */
export interface BootRun {
  run_id: string;
  session_id: string;
  status: 'running' | 'completed' | 'failed' | 'rolled_back';
  reached_phase: BootPhase;
  failed_phase?: BootPhase;
  failure_reason?: string;
  phase_timings: Record<string, PhaseTimingEntry>;
  trust_mode?: 'trusted' | 'untrusted' | 'prompt';
  doctor_summary?: { pass: number; warn: number; fail: number; auto_repaired: number };
  total_duration_ms?: number;
}

/** Per-phase timing record. */
export interface PhaseTimingEntry {
  started_at: string;
  duration_ms: number;
  status: 'ok' | 'skipped' | 'failed' | 'rolled_back';
  error?: string;
  skip_reason?: string;
}

// ---------------------------------------------------------------------------
// Agent Type System & Coordinator (Blueprint 06)
// ---------------------------------------------------------------------------

/** Output format expected from an agent type. */
export type AgentOutputFormat = 'markdown' | 'json' | 'structured_facts' | 'plan' | 'status' | 'free';

/** Handler type for permission decisions. */
export type HandlerType = 'interactive' | 'coordinator' | 'swarm_worker';

/** Complete agent type definition. */
export interface AgentType {
  id?: string;
  name: string;
  display_name?: string;
  description?: string;
  source?: 'built_in' | 'custom' | 'skill_pack';
  permission_mode: PermissionMode;
  system_prompt: string;
  allowed_tools: string[];
  denied_tools: string[];
  denied_prefixes?: string[];
  constraints?: string[];
  max_iterations: number;
  output_format: AgentOutputFormat;
  handler_type?: HandlerType;
  color?: string;
  icon?: string;
  can_spawn?: boolean;
  metadata?: Record<string, unknown>;
  enabled?: boolean;
}

/** Run status for a spawned agent. */
export type AgentRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';

/** Durable record of a single agent run. */
export interface AgentRun {
  id?: string;
  run_id: string;
  agent_type: string;
  agent_type_id?: string;
  status: AgentRunStatus;
  coordinator_id?: string;
  parent_run_id?: string;
  task_prompt?: string;
  task_context?: Record<string, unknown>;
  depends_on: string[];
  blocks?: string[];
  session_id?: string;
  thought_ids?: string[];
  output_summary?: string;
  output_data?: Record<string, unknown>;
  error_message?: string;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_cost_usd?: number;
  iteration_count?: number;
  queued_at?: string;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
}

/** Inter-agent message. */
export interface AgentMessage {
  id?: string;
  coordinator_run_id: string;
  from_run_id: string;
  to_run_id?: string;
  channel?: string;
  message_type: 'data' | 'finding' | 'request' | 'status_update' | 'error' | 'completion';
  content: Record<string, unknown>;
  summary?: string;
  thought_id?: string;
  delivered?: boolean;
  delivered_at?: string;
  acknowledged?: boolean;
  created_at?: string;
}

/** Aggregated summary of all agents under a coordinator. */
export interface AgentSummary {
  coordinator_id: string;
  total_agents: number;
  by_status: Record<AgentRunStatus, number>;
  total_cost_usd: number;
  total_tokens: number;
  total_duration_ms: number;
  agents: AgentRun[];
}

// ---------------------------------------------------------------------------
// Memory System (Blueprint 07)
// ---------------------------------------------------------------------------

/** Memory scope determines visibility and query filtering. */
export enum MemoryScope {
  Personal = 'personal',
  Team = 'team',
  Project = 'project',
  Session = 'session',
  Agent = 'agent',
}

/** Memory type determines aging, trust, and relevance weight. */
export enum MemoryType {
  Fact = 'fact',
  Preference = 'preference',
  Decision = 'decision',
  Instruction = 'instruction',
  Observation = 'observation',
  Context = 'context',
}

/** Memory metadata stored in the thoughts table JSONB. */
export interface MemoryMetadata {
  memory_scope: MemoryScope;
  memory_type: MemoryType;
  tags: string[];
  owner_id?: string;
  team_id?: string;
  project_id?: string;
  agent_id?: string;
  session_id?: string;
  provenance: {
    source_type: 'user_stated' | 'model_inferred' | 'tool_observed' | 'compaction_derived';
    trust_level: number;
    created_at: string;
    last_validated?: string;
    contradicted_by?: string[];
    source_session_id?: string;
    source_uri?: string;
  };
  version: number;
  supersedes?: string;
  superseded_by?: string;
  relevance_boost?: number;
  pin?: boolean;
  deleted?: boolean;
  deleted_at?: string;
  deleted_reason?: string;
}

/** A scored memory result returned by recall. */
export interface MemoryResult {
  thought_id: string;
  content: string;
  similarity: number;
  age_factor: number;
  final_score: number;
  metadata: MemoryMetadata;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Context Fragments (Blueprint 04)
// ---------------------------------------------------------------------------

/** Trust levels for context fragments. */
export type TrustLevel = 1 | 2 | 3 | 4 | 5;

/** Role of a context fragment in the conversation. */
export type FragmentRole = 'system' | 'memory' | 'tool_output' | 'compaction_summary';

/** A piece of context injected into the agent's prompt. */
export interface ContextFragment {
  content: string;
  source_type: 'memory' | 'tool' | 'file' | 'compaction' | 'user';
  trust_level: TrustLevel;
  fragment_role: FragmentRole;
  provenance: {
    origin: string;
    thought_id?: string;
    session_id?: string;
    created_at: string;
  };
}

// ---------------------------------------------------------------------------
// Skills & Extensibility (Blueprint 08)
// ---------------------------------------------------------------------------

/** Hook event types. */
export enum HookEvent {
  PreToolUse = 'PreToolUse',
  PostToolUse = 'PostToolUse',
}

/** Result of executing a hook command. */
export interface HookResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

/** Hook configuration registered in hook_configurations table. */
export interface HookConfig {
  id?: string;
  name: string;
  event_type: HookEvent;
  command: string;
  tool_filter: string[];
  priority: number;
  timeout_ms: number;
  plugin_id?: string;
  trust_tier: 'built_in' | 'plugin' | 'skill';
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

/** Skill trigger conditions. */
export interface SkillTrigger {
  phrases: string[];
  file_patterns: string[];
  tool_context: string[];
  always: boolean;
}

/** Skill input contract. */
export interface SkillInputContract {
  required: string[];
  optional: string[];
  defaults: Record<string, unknown>;
}

/** Skill output contract. */
export interface SkillOutputContract {
  produces: string[];
  side_effects: string[];
}

/** Complete skill definition. */
export interface SkillDef {
  id?: string;
  name: string;
  slug: string;
  description: string;
  version: string;
  source_type: 'bundled' | 'user' | 'ob1' | 'mcp_generated';
  source_path?: string;
  ob1_slug?: string;
  prompt_template: string;
  trigger: SkillTrigger;
  input_contract: SkillInputContract;
  output_contract: SkillOutputContract;
  tool_requirements: string[];
  plugin_id?: string;
  trust_tier: 'built_in' | 'plugin' | 'skill';
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

/** Installed plugin package. */
export interface Plugin {
  id?: string;
  name: string;
  slug: string;
  description?: string;
  version: string;
  author_name?: string;
  author_github?: string;
  trust_tier: 'built_in' | 'plugin';
  status: 'enabled' | 'disabled' | 'installing' | 'error';
  granted_permissions?: Record<string, unknown>;
  manifest?: Record<string, unknown>;
  source_url?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Configuration (Blueprint 05)
// ---------------------------------------------------------------------------

/** The three tiers of configuration scope. */
export type ConfigScope = 'user' | 'project' | 'local';

/** Provenance record tracking where a config value came from. */
export interface ConfigProvenance {
  value: unknown;
  scope: ConfigScope;
  file: string;
  overridden_by?: {
    scope: ConfigScope;
    file: string;
  };
}

/** MCP server entry after deduplication. */
export interface McpServerEntry {
  name: string;
  url: string;
  scope: ConfigScope;
  headers?: Record<string, string>;
  deduplicated_from?: ConfigScope[];
}

/** Complete merged configuration with provenance. */
export interface MergedConfig {
  config: Record<string, unknown>;
  provenance: Record<string, ConfigProvenance>;
  mcpServers: McpServerEntry[];
  sources: ConfigSource[];
  validationErrors: string[];
}

/** Source file entry from config discovery. */
export interface ConfigSource {
  path: string;
  scope: ConfigScope;
  exists: boolean;
  loaded: boolean;
  error?: string;
}

