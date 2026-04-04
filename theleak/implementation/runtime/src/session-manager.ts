/**
 * SessionManager — Manages agent session lifecycle and conversation state.
 *
 * Persists session snapshots to Supabase `agent_sessions` table via OB1Client.
 * Handles create, resume, message management, auto-save (debounced), and completion.
 *
 * @module session-manager
 */

import { OB1Client } from './ob1-client.js';
import {
  type SessionState,
  type BudgetConfig,
  type Message,
  type TokenUsage,
  type PermissionDecision,
  StopReason,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Debounce interval for auto-saving dirty state to Supabase. */
const SAVE_DEBOUNCE_MS = 500;

/** Schema version written to every session row for future migration support. */
const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

export class SessionManager {
  // -- Internal state -------------------------------------------------------
  private state: SessionState;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private client: OB1Client) {
    // Initialize with an empty, unsaved state. Callers must call `create()`
    // or `resume()` before the session is usable.
    this.state = SessionManager.emptyState();
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Create a brand-new session, persist the initial state, and return it.
   *
   * @param config - Partial budget config; missing keys are filled from defaults.
   */
  async create(config?: Partial<BudgetConfig>): Promise<SessionState> {
    const sessionConfig: Record<string, unknown> = {
      max_turns: config?.max_turns ?? 50,
      max_budget_tokens: config?.max_budget_tokens ?? 1_000_000,
      max_budget_usd: config?.max_budget_usd ?? undefined,
      compact_after_turns: config?.compact_after_turns ?? 20,
    };

    // Create via the Edge Function; the server assigns session_id etc.
    this.state = await this.client.createSession(sessionConfig);
    this.dirty = false;

    return this.copyState();
  }

  /**
   * Resume an existing session from Supabase by its session ID.
   *
   * If the session was previously `crashed` or `suspended`, it is
   * automatically transitioned back to `active`.
   */
  async resume(sessionId: string): Promise<SessionState> {
    this.state = await this.client.getSession(sessionId);

    // Re-activate crashed / suspended sessions
    if (this.state.status === 'crashed' || this.state.status === 'suspended') {
      this.state.status = 'active';
      await this.client.updateSession(sessionId, { status: 'active' });
    }

    this.dirty = false;
    return this.copyState();
  }

  /**
   * Immediately flush any pending dirty state to Supabase.
   *
   * Idempotent: does nothing if the state is already clean.
   */
  async flush(): Promise<void> {
    this.cancelScheduledFlush();
    if (!this.dirty) return;
    await this.persistToSupabase();
    this.dirty = false;
  }

  /**
   * Complete the session with a stop reason, persisting the final state.
   */
  async complete(stopReason: StopReason): Promise<void> {
    this.state.status = 'completed';

    // Store the stop reason in config_snapshot for auditability
    (this.state.config_snapshot as Record<string, unknown>).stop_reason = stopReason;

    await this.client.updateSession(this.state.session_id, {
      status: 'completed',
      config_snapshot: this.state.config_snapshot,
    });

    this.dirty = false;
  }

  /**
   * Mark the session as crashed (e.g. from an unhandled error or SIGTERM).
   */
  async markCrashed(): Promise<void> {
    this.state.status = 'crashed';
    this.dirty = true;
    await this.flush();
  }

  // =========================================================================
  // Message Management
  // =========================================================================

  /**
   * Append a message to the conversation log.
   *
   * - If the message carries a `usage` block, cumulative token counters are
   *   updated automatically.
   * - If the message role is `assistant`, the turn counter increments.
   * - A debounced auto-save is scheduled after every append.
   */
  addMessage(message: Message): void {
    this.state.messages.push(message);

    // Accumulate usage if present
    if (message.usage) {
      this.state.total_input_tokens += message.usage.input_tokens;
      this.state.total_output_tokens += message.usage.output_tokens;
      this.state.total_cache_write_tokens += message.usage.cache_creation_input_tokens;
      this.state.total_cache_read_tokens += message.usage.cache_read_input_tokens;
    }

    // Count assistant turns
    if (message.role === 'assistant') {
      this.state.turn_count++;
    }

    this.markDirty();
  }

  /**
   * Return a shallow copy of the current message array.
   */
  getMessages(): Message[] {
    return [...this.state.messages];
  }

  /**
   * Replace the entire message array (used after auto-compaction).
   *
   * The caller is responsible for providing a compaction summary message
   * followed by the preserved recent messages.
   */
  replaceMessages(messages: Message[]): void {
    this.state.messages = messages;
    this.state.compaction_count++;
    this.state.last_compaction_at = new Date().toISOString();
    this.markDirty();
  }

  // =========================================================================
  // Permission Decisions
  // =========================================================================

  /**
   * Record a session-scoped or turn-scoped permission decision.
   * Deduplicates by (tool_name, scope).
   */
  recordPermission(decision: PermissionDecision): void {
    this.state.permission_decisions = this.state.permission_decisions.filter(
      d => !(d.tool_name === decision.tool_name && d.scope === decision.scope),
    );
    this.state.permission_decisions.push(decision);
    this.markDirty();
  }

  /**
   * Check whether a tool has a persisted `allow` grant in this session.
   */
  hasPermission(toolName: string): PermissionDecision | undefined {
    return this.state.permission_decisions.find(
      d => d.tool_name === toolName && d.decision === 'allow',
    );
  }

  // =========================================================================
  // State Accessors
  // =========================================================================

  get sessionId(): string {
    return this.state.session_id;
  }

  get status(): string {
    return this.state.status;
  }

  get tokenUsage(): TokenUsage {
    return {
      input_tokens: this.state.total_input_tokens,
      output_tokens: this.state.total_output_tokens,
      cache_creation_input_tokens: this.state.total_cache_write_tokens,
      cache_read_input_tokens: this.state.total_cache_read_tokens,
    };
  }

  get turnCount(): number {
    return this.state.turn_count;
  }

  get costUsd(): number {
    return this.state.total_cost_usd;
  }

  get compactionCount(): number {
    return this.state.compaction_count;
  }

  // =========================================================================
  // Usage Reconstruction (for BudgetTracker hydration after resume)
  // =========================================================================

  /**
   * Reconstruct per-turn and cumulative usage from embedded message data.
   */
  reconstructUsage(): {
    perTurn: TokenUsage[];
    cumulative: TokenUsage;
    turns: number;
  } {
    const perTurn: TokenUsage[] = [];
    const cumulative: TokenUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };

    for (const msg of this.state.messages) {
      if (msg.usage) {
        perTurn.push(msg.usage);
        cumulative.input_tokens += msg.usage.input_tokens;
        cumulative.output_tokens += msg.usage.output_tokens;
        cumulative.cache_creation_input_tokens += msg.usage.cache_creation_input_tokens;
        cumulative.cache_read_input_tokens += msg.usage.cache_read_input_tokens;
      }
    }

    return { perTurn, cumulative, turns: perTurn.length };
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  /** Mark the state as dirty and schedule a debounced flush. */
  private markDirty(): void {
    this.dirty = true;
    this.scheduleFlush();
  }

  /** Schedule a debounced auto-save. Cancels any previously scheduled timer. */
  private scheduleFlush(): void {
    this.cancelScheduledFlush();
    this.saveTimer = setTimeout(() => {
      this.flush().catch(err => {
        console.error('[SessionManager] auto-flush failed:', err);
      });
    }, SAVE_DEBOUNCE_MS);
  }

  /** Cancel any pending auto-save timer. */
  private cancelScheduledFlush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /** Persist the current state to Supabase via OB1Client.updateSession. */
  private async persistToSupabase(): Promise<void> {
    await this.client.updateSession(this.state.session_id, {
      status: this.state.status,
      messages: this.state.messages,
      config_snapshot: this.state.config_snapshot,
      permission_decisions: this.state.permission_decisions,
      total_input_tokens: this.state.total_input_tokens,
      total_output_tokens: this.state.total_output_tokens,
      total_cache_write_tokens: this.state.total_cache_write_tokens,
      total_cache_read_tokens: this.state.total_cache_read_tokens,
      total_cost_usd: this.state.total_cost_usd,
      turn_count: this.state.turn_count,
      compaction_count: this.state.compaction_count,
      last_compaction_at: this.state.last_compaction_at,
    });
  }

  /** Return a defensive copy of the current state. */
  private copyState(): SessionState {
    return { ...this.state, messages: [...this.state.messages] };
  }

  /** Produce an empty, un-persisted state with sane defaults. */
  private static emptyState(): SessionState {
    return {
      session_id: '',
      version: SCHEMA_VERSION,
      status: 'active',
      messages: [],
      config_snapshot: {},
      permission_decisions: [],
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cache_write_tokens: 0,
      total_cache_read_tokens: 0,
      total_cost_usd: 0,
      turn_count: 0,
      compaction_count: 0,
    };
  }
}
