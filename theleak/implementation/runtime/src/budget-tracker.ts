/**
 * BudgetTracker — Enforces token, turn, and USD budgets for agent sessions.
 *
 * Runs pre-turn budget checks (BEFORE the API call), records post-turn usage
 * to the budget ledger, tracks compaction failures, and provides real-time
 * budget status and percentage calculations.
 *
 * @module budget-tracker
 */

import { OB1Client } from './ob1-client.js';
import {
  type BudgetConfig,
  type BudgetStatus,
  type TokenUsage,
  type Message,
  StopReason,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * After this many consecutive auto-compaction failures, the tracker stops
 * attempting compaction. Prevents infinite retry loops when the compactor
 * is broken or context is un-compactable.
 */
export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;

// ---------------------------------------------------------------------------
// Model Pricing (per 1M tokens)
// ---------------------------------------------------------------------------

export interface ModelPricing {
  input_per_million: number;
  output_per_million: number;
  cache_write_per_million: number;
  cache_read_per_million: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  haiku: {
    input_per_million: 1.00,      // $0.25 -> updated to $1.00/M input
    output_per_million: 5.00,     // $1.25 -> updated to $5.00/M output
    cache_write_per_million: 1.25,
    cache_read_per_million: 0.10,
  },
  sonnet: {
    input_per_million: 3.00,
    output_per_million: 15.00,
    cache_write_per_million: 3.75,
    cache_read_per_million: 0.30,
  },
  opus: {
    input_per_million: 15.00,
    output_per_million: 75.00,
    cache_write_per_million: 18.75,
    cache_read_per_million: 1.50,
  },
};

/**
 * Resolve pricing for a model string. Matches by substring (e.g.
 * "claude-3.5-sonnet-20241022" resolves to `sonnet`). Falls back to
 * sonnet pricing when the model family is unrecognised.
 */
export function pricingForModel(model: string): ModelPricing {
  const normalized = model.toLowerCase();
  if (normalized.includes('haiku')) return MODEL_PRICING.haiku;
  if (normalized.includes('opus')) return MODEL_PRICING.opus;
  if (normalized.includes('sonnet')) return MODEL_PRICING.sonnet;
  // Default to sonnet pricing for unknown models
  return MODEL_PRICING.sonnet;
}

/**
 * Compute the USD cost for a single usage block at the given pricing.
 */
export function computeCostUsd(usage: TokenUsage, pricing: ModelPricing): number {
  return (
    (usage.input_tokens * pricing.input_per_million) / 1_000_000 +
    (usage.output_tokens * pricing.output_per_million) / 1_000_000 +
    (usage.cache_creation_input_tokens * pricing.cache_write_per_million) / 1_000_000 +
    (usage.cache_read_input_tokens * pricing.cache_read_per_million) / 1_000_000
  );
}

/**
 * Format a USD amount to 4 decimal places with dollar sign.
 */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// Internal defaults (applied when BudgetConfig fields are undefined)
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TURNS = 50;
const DEFAULT_MAX_BUDGET_TOKENS = 1_000_000;
const DEFAULT_COMPACT_AFTER_TURNS = 20;

// ---------------------------------------------------------------------------
// BudgetTracker
// ---------------------------------------------------------------------------

export class BudgetTracker {
  // Running cumulative token counts
  private cumulative: TokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  private _turnCount = 0;
  private cumulativeCostUsd = 0;
  private _consecutiveCompactFailures = 0;
  private model = 'sonnet';
  private pricing: ModelPricing;

  // Resolved limits (config fields are optional, so we resolve at construction)
  private readonly maxTurns: number;
  private readonly maxBudgetTokens: number;
  private readonly maxBudgetUsd: number | undefined;
  private readonly compactAfterTurns: number;

  constructor(
    private client: OB1Client,
    private _config: BudgetConfig,
  ) {
    this.pricing = pricingForModel(this.model);
    this.maxTurns = this._config.max_turns ?? DEFAULT_MAX_TURNS;
    this.maxBudgetTokens = this._config.max_budget_tokens ?? DEFAULT_MAX_BUDGET_TOKENS;
    this.maxBudgetUsd = this._config.max_budget_usd;
    this.compactAfterTurns = this._config.compact_after_turns ?? DEFAULT_COMPACT_AFTER_TURNS;
  }

  // =========================================================================
  // Factory: hydrate from a resumed session's messages
  // =========================================================================

  /**
   * Restore budget state from an array of previously-persisted messages
   * (e.g. after `SessionManager.resume()`).
   */
  static fromMessages(
    client: OB1Client,
    config: BudgetConfig,
    model: string,
    messages: Message[],
  ): BudgetTracker {
    const tracker = new BudgetTracker(client, config);
    tracker.model = model;
    tracker.pricing = pricingForModel(model);

    for (const msg of messages) {
      if (msg.usage) {
        tracker.cumulative.input_tokens += msg.usage.input_tokens;
        tracker.cumulative.output_tokens += msg.usage.output_tokens;
        tracker.cumulative.cache_creation_input_tokens += msg.usage.cache_creation_input_tokens;
        tracker.cumulative.cache_read_input_tokens += msg.usage.cache_read_input_tokens;
        tracker._turnCount++;
      }
    }

    tracker.cumulativeCostUsd = computeCostUsd(tracker.cumulative, tracker.pricing);
    return tracker;
  }

  // =========================================================================
  // Model configuration
  // =========================================================================

  /**
   * Change the model (and therefore the pricing) used for cost estimation.
   */
  setModel(model: string): void {
    this.model = model;
    this.pricing = pricingForModel(model);
  }

  // =========================================================================
  // Pre-Turn Check — THE critical method
  // =========================================================================

  /**
   * Check budget BEFORE making an API call. Returns the current BudgetStatus.
   *
   * If `can_proceed` is `false`, the caller MUST NOT issue an API request.
   * The `stop_reason` field tells the caller which limit was hit.
   */
  async checkBudget(_sessionId: string): Promise<BudgetStatus> {
    const totalTokens = this.cumulative.input_tokens + this.cumulative.output_tokens;

    // Check 1: Turn limit
    if (this._turnCount >= this.maxTurns) {
      return this.buildStatus(false, StopReason.MaxTurnsReached);
    }

    // Check 2: Token budget
    if (totalTokens >= this.maxBudgetTokens) {
      return this.buildStatus(false, StopReason.MaxBudgetTokensReached);
    }

    // Check 3: USD budget
    if (
      this.maxBudgetUsd !== undefined &&
      this.cumulativeCostUsd >= this.maxBudgetUsd
    ) {
      return this.buildStatus(false, StopReason.MaxBudgetUsdReached);
    }

    return this.buildStatus(true);
  }

  // =========================================================================
  // Post-Turn Recording
  // =========================================================================

  /**
   * Record token usage after an API call completes. Persists an entry to the
   * budget ledger via `client.recordUsage` and returns any triggered stop
   * reason plus whether compaction is now needed.
   */
  async recordUsage(
    sessionId: string,
    usage: TokenUsage,
  ): Promise<{ stop_reason: StopReason | undefined; compaction_needed: boolean }> {
    // Accumulate running totals
    this.cumulative.input_tokens += usage.input_tokens;
    this.cumulative.output_tokens += usage.output_tokens;
    this.cumulative.cache_creation_input_tokens += usage.cache_creation_input_tokens;
    this.cumulative.cache_read_input_tokens += usage.cache_read_input_tokens;
    this._turnCount++;

    const turnCostUsd = computeCostUsd(usage, this.pricing);
    this.cumulativeCostUsd += turnCostUsd;

    // Post-turn limit evaluation
    let stopReason: StopReason | undefined;
    const totalTokens = this.cumulative.input_tokens + this.cumulative.output_tokens;

    if (this._turnCount >= this.maxTurns) {
      stopReason = StopReason.MaxTurnsReached;
    } else if (totalTokens >= this.maxBudgetTokens) {
      stopReason = StopReason.MaxBudgetTokensReached;
    } else if (
      this.maxBudgetUsd !== undefined &&
      this.cumulativeCostUsd >= this.maxBudgetUsd
    ) {
      stopReason = StopReason.MaxBudgetUsdReached;
    }

    // Compaction is needed when turn count exceeds the configured threshold
    const compactionNeeded = this._turnCount >= this.compactAfterTurns;

    // Persist to budget_ledger (best-effort)
    try {
      await this.client.recordUsage(sessionId, {
        turn_number: this._turnCount,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_write_tokens: usage.cache_creation_input_tokens,
        cache_read_tokens: usage.cache_read_input_tokens,
        cost_usd: turnCostUsd,
        model: this.model,
      });
    } catch (err) {
      // Non-fatal: budget tracking is observability, not a hard gate
      console.error(
        '[BudgetTracker] budget_ledger write failed:',
        err instanceof Error ? err.message : err,
      );
    }

    return { stop_reason: stopReason, compaction_needed: compactionNeeded };
  }

  // =========================================================================
  // Compaction Tracking
  // =========================================================================

  /**
   * Record the outcome of an auto-compaction attempt.
   *
   * - On success: resets consecutive failure counter.
   * - On failure: increments consecutive failure counter.
   */
  recordCompactionResult(success: boolean): void {
    if (success) {
      this._consecutiveCompactFailures = 0;
    } else {
      this._consecutiveCompactFailures++;
    }
  }

  /**
   * Whether auto-compaction should be attempted.
   *
   * Returns `true` when the turn count exceeds `compact_after_turns` AND
   * consecutive compaction failures have not reached the maximum.
   */
  get shouldCompact(): boolean {
    if (this._consecutiveCompactFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
      return false;
    }
    return this._turnCount >= this.compactAfterTurns;
  }

  /** Number of consecutive compaction failures so far. */
  get compactionFailures(): number {
    return this._consecutiveCompactFailures;
  }

  /** Whether the maximum number of consecutive compaction failures has been reached. */
  get maxCompactionFailuresReached(): boolean {
    return this._consecutiveCompactFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES;
  }

  // =========================================================================
  // Budget Status Accessors
  // =========================================================================

  /** Number of turns consumed so far. */
  get turnsUsed(): number {
    return this._turnCount;
  }

  /** Cumulative token usage broken out by category. */
  get tokensUsed(): {
    input: number;
    output: number;
    cache_write: number;
    cache_read: number;
  } {
    return {
      input: this.cumulative.input_tokens,
      output: this.cumulative.output_tokens,
      cache_write: this.cumulative.cache_creation_input_tokens,
      cache_read: this.cumulative.cache_read_input_tokens,
    };
  }

  /** Cumulative estimated cost in USD. */
  get usdUsed(): number {
    return this.cumulativeCostUsd;
  }

  /**
   * Budget utilisation as a percentage of each limit dimension.
   *
   * - `turns`: percentage of `max_turns` consumed.
   * - `tokens`: percentage of `max_budget_tokens` consumed.
   * - `usd`: percentage of `max_budget_usd` consumed (0 if no USD limit).
   */
  get percentUsed(): { turns: number; tokens: number; usd: number } {
    const totalTokens = this.cumulative.input_tokens + this.cumulative.output_tokens;

    const turns = (this._turnCount / this.maxTurns) * 100;
    const tokens = (totalTokens / this.maxBudgetTokens) * 100;
    const usd =
      this.maxBudgetUsd !== undefined
        ? (this.cumulativeCostUsd / this.maxBudgetUsd) * 100
        : 0;

    return {
      turns: Math.min(100, turns),
      tokens: Math.min(100, tokens),
      usd: Math.min(100, usd),
    };
  }

  // =========================================================================
  // Streaming / Diagnostic Helpers
  // =========================================================================

  /**
   * Format the current status as a structured streaming event for clients.
   */
  toStreamingEvent(): Record<string, unknown> {
    return {
      type: 'budget_status',
      turns: `${this._turnCount}/${this.maxTurns}`,
      tokens: `${(this.cumulative.input_tokens + this.cumulative.output_tokens).toLocaleString()}/${this.maxBudgetTokens.toLocaleString()}`,
      cost: formatUsd(this.cumulativeCostUsd),
      cost_limit:
        this.maxBudgetUsd !== undefined
          ? formatUsd(this.maxBudgetUsd)
          : 'unlimited',
      budget_percent: Math.round(
        Math.max(this.percentUsed.turns, this.percentUsed.tokens, this.percentUsed.usd),
      ),
      compaction_status: this.shouldCompact
        ? `pending (failures: ${this._consecutiveCompactFailures}/${MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES})`
        : 'ok',
    };
  }

  // =========================================================================
  // Private
  // =========================================================================

  /**
   * Build a BudgetStatus snapshot matching the types.ts interface.
   */
  private buildStatus(
    canProceed: boolean,
    stopReason?: StopReason,
  ): BudgetStatus {
    const totalTokens = this.cumulative.input_tokens + this.cumulative.output_tokens;

    return {
      turns_used: this._turnCount,
      tokens_used: totalTokens,
      usd_used: this.cumulativeCostUsd,
      can_proceed: canProceed,
      stop_reason: stopReason,
    };
  }
}
