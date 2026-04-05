// =============================================================================
// conversation-runtime.ts — THE CORE AGENTIC LOOP
//
// This is the most important file in the system. It ties together every other
// component (SessionManager, BudgetTracker, ToolPool, PermissionPolicy,
// HookRunner, TranscriptCompactor, ContextAssembler, EventLogger) into a
// single multi-turn agentic loop.
//
// The loop:
//   1. Pre-turn budget check
//   2. Assemble context (provenance-aware)
//   3. Assemble tool pool
//   4. Call LLM API (streaming)
//   5. Parse response for tool_use blocks
//   6. For each tool_use: permissions -> pre-hooks -> execute -> post-hooks
//   7. Check if response is complete or needs another turn
//   8. Compact if threshold reached
//   9. Persist session
//  10. Loop to step 1 or return
//
// Blueprints: skill_build_agentic_loop.md, gc_generic_runtime.md
// =============================================================================

import type { OB1Client } from './ob1-client.js';
import type { AgentType as AgentTypeDef } from './types.js';

// ---------------------------------------------------------------------------
// External component interfaces
// ---------------------------------------------------------------------------
// These interfaces are implemented by the modules other agents are building.
// The ConversationRuntime accepts them via constructor injection.

/** Wraps the Anthropic Messages API with streaming support */
export interface ApiClient {
  stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string,
  ): AsyncGenerator<StreamEvent>;
}

/** Session management — persists messages, manages state */
export interface SessionManager {
  getMessages(): Message[];
  addMessage(message: Message): void;
  flush(): Promise<void>;
  getSessionId(): string;
  getTokenCount(): number;
}

/** Budget tracking — enforces cost and turn limits */
export interface BudgetTracker {
  checkBudget(): BudgetCheck;
  recordUsage(usage: TokenUsage): void;
  getStatus(): BudgetStatus;
}

/** Tool pool — curated set of tools with permission filtering */
export interface ToolPool {
  toAnthropicFormat(): ToolDefinition[];
  has(toolName: string): boolean;
  execute(toolName: string, input: Record<string, unknown>): Promise<ToolResult>;
  getToolNames(): string[];
}

/** Permission policy — checks whether a tool call is allowed */
export interface PermissionPolicy {
  check(toolName: string, input: Record<string, unknown>): PermissionDecision;
}

/** Hook runner — pre/post tool lifecycle hooks */
export interface HookRunner {
  runPre(toolName: string, input: Record<string, unknown>): Promise<HookResult>;
  runPost(toolName: string, input: Record<string, unknown>, result: ToolResult): Promise<HookResult>;
}

/** Transcript compactor — compresses old messages to save context */
export interface TranscriptCompactor {
  compactIfNeeded(messages: Message[], tokenCount: number, threshold: number): Promise<CompactionResult>;
}

/** Context assembler — gathers CLAUDE.md, system prompts, memories, etc. */
export interface ContextAssembler {
  assemble(): Promise<AssembledContext>;
}

/** Event logger — structured event persistence */
export interface EventLogger {
  log(event: LogEvent): Promise<void>;
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  output: string;
  isError: boolean;
  metadata?: Record<string, unknown>;
}

export interface StreamEvent {
  type: 'content_block_start' | 'content_block_delta' | 'content_block_stop'
    | 'message_start' | 'message_delta' | 'message_stop'
    | 'ping' | 'error';
  index?: number;
  content_block?: ContentBlock;
  delta?: { type: string; text?: string; partial_json?: string; stop_reason?: string };
  message?: {
    id: string;
    role: string;
    content: ContentBlock[];
    model: string;
    stop_reason: string | null;
    usage: { input_tokens: number; output_tokens: number };
  };
  usage?: { output_tokens: number };
  error?: { type: string; message: string };
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export interface BudgetCheck {
  canProceed: boolean;
  stopReason?: 'budget_exceeded' | 'turns_exceeded' | 'tokens_exceeded';
  remainingTurns?: number;
  remainingBudgetUsd?: number;
  warning?: string;
}

export interface BudgetStatus {
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  cumulativeCostUsd: number;
  turnCount: number;
}

export interface PermissionDecision {
  allowed: boolean;
  reason?: string;
}

export interface HookResult {
  proceed: boolean;
  modified?: Record<string, unknown>;
  error?: string;
}

export interface CompactionResult {
  compacted: boolean;
  messagesBefore: number;
  messagesAfter: number;
  tokensBefore: number;
  tokensAfter: number;
}

export interface AssembledContext {
  systemPrompt: string;
  contextBlocks: string[];
  totalTokenEstimate: number;
}

export interface LogEvent {
  category: string;
  eventType: string;
  data: Record<string, unknown>;
}

export type StopReason = 'end_turn' | 'budget_exceeded' | 'max_iterations' | 'user_stop' | 'error';

// ---------------------------------------------------------------------------
// Turn result
// ---------------------------------------------------------------------------

export interface TurnResult {
  stopReason: StopReason | null;
  shouldContinue: boolean;
  usage: TokenUsage;
  toolCallCount: number;
  toolsCalled: string[];
  assistantText: string;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Run result
// ---------------------------------------------------------------------------

export interface RunResult {
  stopReason: StopReason;
  turnCount: number;
  lastAssistantMessage: string;
  totalUsage: TokenUsage;
  totalCostUsd: number;
  errors: string[];
  error?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Runtime config
// ---------------------------------------------------------------------------

export interface ConversationRuntimeConfig {
  maxIterations: number;
  autoCompactionThreshold: number;
  systemPromptOverride?: string;
  model?: string;
}

const DEFAULT_CONFIG: ConversationRuntimeConfig = {
  maxIterations: 200,
  autoCompactionThreshold: 200_000,
};

// [HARDENING] Maximum retries for transient API errors (429, 500, 529).
const MAX_API_RETRIES = 3;
const API_RETRY_BASE_DELAY_MS = 2_000;

/** Check if an error message indicates a transient/retryable API error. */
function isRetryableApiError(errorMessage: string): boolean {
  return /\b(429|500|502|503|529|rate.?limit|overloaded|temporarily unavailable)/i.test(errorMessage);
}

// ---------------------------------------------------------------------------
// ConversationRuntime
// ---------------------------------------------------------------------------

export class ConversationRuntime {
  private session: SessionManager;
  private budget: BudgetTracker;
  private toolPool: ToolPool;
  private permissions: PermissionPolicy;
  private hooks: HookRunner;
  private compactor: TranscriptCompactor;
  private context: ContextAssembler;
  private eventLogger: EventLogger;
  private client: OB1Client;
  private apiClient: ApiClient;
  private config: ConversationRuntimeConfig;

  private stopped = false;
  private stopReasonOverride: StopReason | null = null;
  private turnCount = 0;
  private totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  private allErrors: string[] = [];

  constructor(
    client: OB1Client,
    apiClient: ApiClient,
    deps: {
      session: SessionManager;
      budget: BudgetTracker;
      toolPool: ToolPool;
      permissions: PermissionPolicy;
      hooks: HookRunner;
      compactor: TranscriptCompactor;
      context: ContextAssembler;
      eventLogger: EventLogger;
    },
    config?: Partial<ConversationRuntimeConfig>,
  ) {
    this.client = client;
    this.apiClient = apiClient;
    this.session = deps.session;
    this.budget = deps.budget;
    this.toolPool = deps.toolPool;
    this.permissions = deps.permissions;
    this.hooks = deps.hooks;
    this.compactor = deps.compactor;
    this.context = deps.context;
    this.eventLogger = deps.eventLogger;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── The main loop ───────────────────────────────────────────

  /**
   * Run the agentic loop to completion.
   *
   * 1. Add initial prompt as user message (if provided)
   * 2. Enter the turn loop
   * 3. Each turn: budget -> context -> tools -> LLM -> tool exec -> compact -> persist
   * 4. Loop until: end_turn, budget exceeded, max iterations, or stop() called
   * 5. Return RunResult
   */
  async run(initialPrompt?: string): Promise<RunResult> {
    if (initialPrompt) {
      this.session.addMessage({ role: 'user', content: initialPrompt });
    }

    await this.eventLogger.log({
      category: 'session',
      eventType: 'run_started',
      data: {
        sessionId: this.session.getSessionId(),
        maxIterations: this.config.maxIterations,
        hasInitialPrompt: !!initialPrompt,
      },
    });

    let lastAssistantText = '';
    let finalStopReason: StopReason = 'end_turn';

    try {
      while (!this.stopped && this.turnCount < this.config.maxIterations) {
        const turnResult = await this.runTurn();
        this.turnCount++;
        lastAssistantText = turnResult.assistantText || lastAssistantText;

        if (turnResult.errors.length > 0) {
          this.allErrors.push(...turnResult.errors);
        }

        if (!turnResult.shouldContinue) {
          finalStopReason = turnResult.stopReason ?? 'end_turn';
          break;
        }
      }

      if (this.turnCount >= this.config.maxIterations && !this.stopped) {
        finalStopReason = 'max_iterations';
      }
      if (this.stopReasonOverride) {
        finalStopReason = this.stopReasonOverride;
      }
    } catch (err: any) {
      finalStopReason = 'error';
      this.allErrors.push(err.message);
      await this.eventLogger.log({ category: 'error', eventType: 'run_error', data: { error: err.message, turnCount: this.turnCount } });
    }

    // Final session flush
    await this.session.flush();

    const budgetStatus = this.budget.getStatus();

    await this.eventLogger.log({
      category: 'session',
      eventType: 'run_completed',
      data: {
        sessionId: this.session.getSessionId(),
        stopReason: finalStopReason,
        turnCount: this.turnCount,
        totalInputTokens: this.totalUsage.inputTokens,
        totalOutputTokens: this.totalUsage.outputTokens,
        totalCostUsd: budgetStatus.cumulativeCostUsd,
        errorCount: this.allErrors.length,
      },
    });

    return {
      stopReason: finalStopReason,
      turnCount: this.turnCount,
      lastAssistantMessage: lastAssistantText,
      totalUsage: { ...this.totalUsage },
      totalCostUsd: budgetStatus.cumulativeCostUsd,
      errors: [...this.allErrors],
      error: finalStopReason === 'error' ? this.allErrors[this.allErrors.length - 1] : undefined,
      metadata: { sessionId: this.session.getSessionId(), model: this.config.model },
    };
  }

  // ── Single turn execution (THE HEART) ───────────────────────

  /**
   * Execute a single turn of the agentic loop.
   *
   *  1. budget.checkBudget()        -- BEFORE API call
   *  2. context.assemble()          -- gather context
   *  3. toolPool.toAnthropicFormat() -- prepare tools
   *  4. apiClient.stream()          -- call LLM
   *  5. Parse tool_use blocks
   *  6. For each: permissions -> pre-hooks -> execute -> post-hooks
   *  7. session.addMessage()        -- append results
   *  8. compactor.compactIfNeeded() -- if threshold reached
   *  9. session.flush()             -- persist
   * 10. Return TurnResult
   */
  async runTurn(): Promise<TurnResult> {
    const turnErrors: string[] = [];
    const toolsCalled: string[] = [];
    let assistantText = '';
    let turnUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let shouldContinue = false;
    let stopReason: StopReason | null = null;

    // ── Step 1: Pre-turn budget check ──
    const budgetCheck = this.budget.checkBudget();
    if (!budgetCheck.canProceed) {
      await this.eventLogger.log({ category: 'usage', eventType: 'budget_exceeded', data: { reason: budgetCheck.stopReason } });
      return { stopReason: 'budget_exceeded', shouldContinue: false, usage: turnUsage, toolCallCount: 0, toolsCalled: [], assistantText: '', errors: [] };
    }

    if (budgetCheck.warning) {
      await this.eventLogger.log({ category: 'usage', eventType: 'budget_warning', data: { warning: budgetCheck.warning } });
    }

    // ── Step 2: Assemble context ──
    const assembled = await this.context.assemble();

    // ── Step 3: Prepare tools ──
    const tools = this.toolPool.toAnthropicFormat();

    // ── Step 4: Call LLM API (streaming) ──
    const messages = this.session.getMessages();
    const systemPrompt = this.config.systemPromptOverride ?? assembled.systemPrompt;

    const contentBlocks: ContentBlock[] = [];
    let messageStopReason: string | null = null;
    let messageUsage: { input_tokens: number; output_tokens: number } = { input_tokens: 0, output_tokens: 0 };

    // [HARDENING] Retry loop for transient API errors (429 rate limit, 500/529 overload).
    // Without this, a single 429 would terminate the entire agentic run.
    let apiAttempt = 0;
    let streamSucceeded = false;
    while (apiAttempt < MAX_API_RETRIES && !streamSucceeded) {
      apiAttempt++;
      // Reset accumulators on retry (previous attempt produced no usable data)
      if (apiAttempt > 1) {
        contentBlocks.length = 0;
        messageStopReason = null;
        messageUsage = { input_tokens: 0, output_tokens: 0 };
      }

      try {
        const stream = this.apiClient.stream(messages, tools, systemPrompt);
        let streamHadRetryableError = false;

        for await (const event of stream) {
          switch (event.type) {
            case 'message_start':
              if (event.message?.usage) messageUsage = event.message.usage;
              break;

            case 'content_block_start':
              if (event.content_block) contentBlocks.push({ ...event.content_block });
              break;

            case 'content_block_delta':
              if (event.index !== undefined && event.delta) {
                const block = contentBlocks[event.index];
                if (block) {
                  if (event.delta.type === 'text_delta' && event.delta.text) {
                    block.text = (block.text ?? '') + event.delta.text;
                  } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
                    (block as any)._rawJson = ((block as any)._rawJson ?? '') + event.delta.partial_json;
                  }
                }
              }
              break;

            case 'content_block_stop':
              if (event.index !== undefined) {
                const block = contentBlocks[event.index];
                if (block && block.type === 'tool_use' && (block as any)._rawJson) {
                  try { block.input = JSON.parse((block as any)._rawJson); } catch { block.input = {}; }
                  delete (block as any)._rawJson;
                }
              }
              break;

            case 'message_delta':
              if (event.usage) {
                messageUsage = { input_tokens: messageUsage.input_tokens, output_tokens: messageUsage.output_tokens + event.usage.output_tokens };
              }
              if (event.delta?.stop_reason) messageStopReason = event.delta.stop_reason;
              break;

            case 'message_stop':
              break;

            case 'error': {
              const errMsg = event.error?.message ?? 'Unknown stream error';
              // [HARDENING] Check if this is a retryable error (429/500/529)
              if (isRetryableApiError(errMsg) && apiAttempt < MAX_API_RETRIES) {
                streamHadRetryableError = true;
                await this.eventLogger.log({ category: 'error', eventType: 'stream_error_retryable', data: { error: errMsg, attempt: apiAttempt, maxRetries: MAX_API_RETRIES } });
              } else {
                turnErrors.push(errMsg);
                await this.eventLogger.log({ category: 'error', eventType: 'stream_error', data: { error: errMsg } });
              }
              break;
            }
          }
        }

        if (streamHadRetryableError) {
          // Backoff before retry
          const delay = API_RETRY_BASE_DELAY_MS * Math.pow(2, apiAttempt - 1);
          await this.eventLogger.log({ category: 'error', eventType: 'api_retry', data: { attempt: apiAttempt, delayMs: delay } });
          await new Promise(r => setTimeout(r, delay));
          continue; // retry the stream
        }

        streamSucceeded = true;
      } catch (err: any) {
        // [HARDENING] Retry on transient fetch-level errors (network, 429, etc.)
        if (isRetryableApiError(err.message) && apiAttempt < MAX_API_RETRIES) {
          const delay = API_RETRY_BASE_DELAY_MS * Math.pow(2, apiAttempt - 1);
          await this.eventLogger.log({ category: 'error', eventType: 'api_retry', data: { error: err.message, attempt: apiAttempt, delayMs: delay } });
          await new Promise(r => setTimeout(r, delay));
          continue; // retry
        }
        turnErrors.push(`API call failed: ${err.message}`);
        await this.eventLogger.log({ category: 'error', eventType: 'api_error', data: { error: err.message } });
        return { stopReason: 'error', shouldContinue: false, usage: turnUsage, toolCallCount: 0, toolsCalled: [], assistantText: '', errors: turnErrors };
      }
    }

    if (!streamSucceeded) {
      turnErrors.push(`API call failed after ${MAX_API_RETRIES} retries`);
      await this.eventLogger.log({ category: 'error', eventType: 'api_error_retries_exhausted', data: { attempts: MAX_API_RETRIES } });
      return { stopReason: 'error', shouldContinue: false, usage: turnUsage, toolCallCount: 0, toolsCalled: [], assistantText: '', errors: turnErrors };
    }

    // Record usage
    turnUsage = { inputTokens: messageUsage.input_tokens, outputTokens: messageUsage.output_tokens };
    this.totalUsage.inputTokens += turnUsage.inputTokens;
    this.totalUsage.outputTokens += turnUsage.outputTokens;
    this.budget.recordUsage(turnUsage);

    // ── Step 5: Append assistant response ──
    this.session.addMessage({ role: 'assistant', content: contentBlocks.length > 0 ? contentBlocks : '' });

    // Extract text
    assistantText = contentBlocks.filter(b => b.type === 'text' && b.text).map(b => b.text!).join('\n');

    await this.eventLogger.log({
      category: 'turn_complete', eventType: 'turn_completed',
      data: { inputTokens: turnUsage.inputTokens, outputTokens: turnUsage.outputTokens, stopReason: messageStopReason, contentBlockCount: contentBlocks.length },
    });

    // ── Step 6: Process tool_use blocks ──
    const toolUseBlocks = contentBlocks.filter((b): b is ToolUseBlock => b.type === 'tool_use' && !!b.id && !!b.name);

    if (toolUseBlocks.length > 0) {
      for (const toolUse of toolUseBlocks) {
        const toolInput = toolUse.input ?? {};

        // 6a. Permission check
        const permDecision = this.permissions.check(toolUse.name, toolInput);
        if (!permDecision.allowed) {
          await this.eventLogger.log({ category: 'permission', eventType: 'tool_denied', data: { tool: toolUse.name, reason: permDecision.reason } });
          this.session.addMessage({ role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: `Permission denied: ${permDecision.reason ?? 'Tool not allowed'}`, is_error: true }] });
          continue;
        }

        // 6b. Pre-hooks
        const preHook = await this.hooks.runPre(toolUse.name, toolInput);
        if (!preHook.proceed) {
          await this.eventLogger.log({ category: 'hook', eventType: 'pre_hook_blocked', data: { tool: toolUse.name, error: preHook.error } });
          this.session.addMessage({ role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: `Pre-hook blocked: ${preHook.error ?? 'Blocked'}`, is_error: true }] });
          continue;
        }

        // 6c. Execute tool
        let toolResult: ToolResult;
        try {
          await this.eventLogger.log({ category: 'execution', eventType: 'tool_start', data: { tool: toolUse.name } });
          const effectiveInput = preHook.modified ?? toolInput;
          toolResult = await this.toolPool.execute(toolUse.name, effectiveInput);
          toolsCalled.push(toolUse.name);
          await this.eventLogger.log({ category: 'execution', eventType: 'tool_complete', data: { tool: toolUse.name, isError: toolResult.isError, outputLength: toolResult.output.length } });
        } catch (err: any) {
          toolResult = { output: `Tool execution error: ${err.message}`, isError: true };
          turnErrors.push(`Tool "${toolUse.name}" failed: ${err.message}`);
          await this.eventLogger.log({ category: 'error', eventType: 'tool_error', data: { tool: toolUse.name, error: err.message } });
        }

        // 6d. Post-hooks
        await this.hooks.runPost(toolUse.name, toolInput, toolResult);

        // 6e. Append tool result
        this.session.addMessage({ role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: toolResult.output, is_error: toolResult.isError }] });
      }

      // Tool calls made: LLM needs another turn
      shouldContinue = true;
    } else {
      // No tool calls: check stop reason
      if (messageStopReason === 'end_turn' || messageStopReason === 'stop_sequence') {
        stopReason = 'end_turn';
        shouldContinue = false;
      } else if (messageStopReason === 'max_tokens') {
        shouldContinue = true; // LLM needs continuation
      } else {
        stopReason = 'end_turn';
        shouldContinue = false;
      }
    }

    // ── Step 8: Compact if needed ──
    const tokenCount = this.session.getTokenCount();
    if (tokenCount > this.config.autoCompactionThreshold) {
      const compactionResult = await this.compactor.compactIfNeeded(this.session.getMessages(), tokenCount, this.config.autoCompactionThreshold);
      if (compactionResult.compacted) {
        await this.eventLogger.log({
          category: 'compaction', eventType: 'auto_compacted',
          data: { messagesBefore: compactionResult.messagesBefore, messagesAfter: compactionResult.messagesAfter, tokensBefore: compactionResult.tokensBefore, tokensAfter: compactionResult.tokensAfter },
        });
      }
    }

    // ── Step 9: Persist session ──
    await this.session.flush();

    // ── Step 10: Return ──
    return { stopReason, shouldContinue, usage: turnUsage, toolCallCount: toolUseBlocks.length, toolsCalled, assistantText, errors: turnErrors };
  }

  // ── Fork for sub-agent ──────────────────────────────────────

  /**
   * Fork this runtime for a sub-agent with isolated context.
   *
   * Creates a new ConversationRuntime that shares the same ApiClient and
   * OB1Client connections but uses the agent type's configuration for
   * iteration limits and other behavioral parameters.
   *
   * The caller (AgentCoordinator) must provide isolated SessionManager,
   * BudgetTracker, ToolPool, and PermissionPolicy instances. This method
   * creates the structural fork; the coordinator wires in the scoped deps.
   */
  fork(agentType: AgentTypeDef): ConversationRuntime {
    return new ConversationRuntime(
      this.client,
      this.apiClient,
      {
        session: this.session,       // Coordinator replaces with isolated session
        budget: this.budget,         // Coordinator replaces with isolated budget
        toolPool: this.toolPool,     // Coordinator replaces with scoped tool pool
        permissions: this.permissions,
        hooks: this.hooks,
        compactor: this.compactor,
        context: this.context,
        eventLogger: this.eventLogger,
      },
      {
        maxIterations: agentType.max_iterations,
        autoCompactionThreshold: this.config.autoCompactionThreshold,
        model: this.config.model,
      },
    );
  }

  // ── Stop ────────────────────────────────────────────────────

  /** Signal the runtime to stop after the current turn completes. */
  stop(reason: StopReason): void {
    this.stopped = true;
    this.stopReasonOverride = reason;
  }

  // ── Accessors ───────────────────────────────────────────────

  getSessionId(): string {
    return this.session.getSessionId();
  }

  getTurnCount(): number {
    return this.turnCount;
  }

  getTotalUsage(): TokenUsage {
    return { ...this.totalUsage };
  }

  isStopped(): boolean {
    return this.stopped;
  }
}
