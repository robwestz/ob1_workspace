// =============================================================================
// OB1 Agentic Runtime -- Public API
// =============================================================================

export * from './types.js';
export { OB1Client, OB1Error } from './ob1-client.js';
export { ScopedConfigLoader, loadConfig } from './config.js';
export { SessionManager } from './session-manager.js';
export {
  BudgetTracker,
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
  pricingForModel,
  computeCostUsd,
  formatUsd,
} from './budget-tracker.js';
export type { ModelPricing } from './budget-tracker.js';
export {
  ToolPool,
  PermissionPolicy,
} from './tool-pool.js';
export type {
  ToolPoolOptions,
  MCPToolDefinition,
  AnthropicToolDefinition,
  PermissionCheckResult,
} from './tool-pool.js';
export { HookRunner } from './hook-runner.js';
export type {
  HookOutcome,
  HookPayload,
  HookExecutionResult,
  HookDecision,
} from './hook-runner.js';
export { TranscriptCompactor } from './transcript-compactor.js';
export type {
  ApiClient,
  StreamEventEmitter,
  CompactionEvent,
  CompactionConfig,
} from './transcript-compactor.js';
export { AnthropicApiClient } from './anthropic-client.js';
export { ContextAssembler, assignTrustLevel, classifyFragmentRole } from './context-assembler.js';
export type {
  SourceType as ContextSourceType,
  FragmentRole,
  ContextFragment as AssembledContextFragment,
  ContextOptions,
  InjectionScanResult,
  Contradiction,
  ContextResult,
} from './context-assembler.js';
export { BootSequence } from './boot.js';
export type {
  RuntimeConfig,
  BootResult,
  BootContext,
  PhaseResult,
  BootMergedConfig,
  DoctorSummary,
  DeferredInitResult,
  PrefetchResult,
} from './boot.js';
export { BootPhase, FastPath } from './boot.js';
export { DoctorSystem } from './doctor.js';
export type {
  DoctorCheckResult as DoctorCheck,
  DoctorReport,
  RepairResult,
  DoctorCategory,
} from './doctor.js';
export { AgentCoordinator } from './coordinator.js';
export type {
  SpawnOptions,
  AgentJob,
  AgentRun as CoordinatorAgentRun,
  WaveResult,
  AgentMessage as CoordinatorAgentMessage,
} from './coordinator.js';
export { ConversationRuntime } from './conversation-runtime.js';
export type {
  ApiClient as RuntimeApiClient,
  SessionManager as RuntimeSessionManager,
  BudgetTracker as RuntimeBudgetTracker,
  ToolPool as RuntimeToolPool,
  PermissionPolicy as RuntimePermissionPolicy,
  HookRunner as RuntimeHookRunner,
  TranscriptCompactor as RuntimeTranscriptCompactor,
  ContextAssembler as RuntimeContextAssembler,
  EventLogger as RuntimeEventLogger,
  TurnResult,
  RunResult,
  ConversationRuntimeConfig,
  StopReason as RuntimeStopReason,
} from './conversation-runtime.js';
export { NightRunner } from './night-runner.js';
export type {
  NightRunnerConfig,
  NightTask,
  NightTaskStatus,
  NightRunReport,
  TaskResult,
} from './night-runner.js';
