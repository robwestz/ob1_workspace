// =============================================================================
// Unit Tests — BudgetTracker
// =============================================================================

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  BudgetTracker,
  computeCostUsd,
  pricingForModel,
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
} from '../src/budget-tracker.js';
import { StopReason, type TokenUsage, type Message } from '../src/types.js';

// ---------------------------------------------------------------------------
// Mock OB1Client — records calls but never touches the network
// ---------------------------------------------------------------------------

function createMockClient() {
  const recorded: Array<{ method: string; args: unknown[] }> = [];
  return {
    recorded,
    recordUsage: mock.fn(async (...args: unknown[]) => {
      recorded.push({ method: 'recordUsage', args });
    }),
    // Other methods the tracker never calls directly during unit tests:
    logEvent: mock.fn(async () => {}),
  } as any;            // cast — we only need the subset BudgetTracker uses
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BudgetTracker', () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  // ---- checkBudget ---------------------------------------------------

  describe('checkBudget', () => {
    it('returns can_proceed=true when under all limits', async () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 10,
        max_budget_tokens: 100_000,
        max_budget_usd: 5.0,
      });

      const status = await tracker.checkBudget('sess-1');

      assert.equal(status.can_proceed, true);
      assert.equal(status.stop_reason, undefined);
      assert.equal(status.turns_used, 0);
      assert.equal(status.tokens_used, 0);
      assert.equal(status.usd_used, 0);
    });

    it('returns max_turns_reached when turns >= max_turns', async () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 2,
        max_budget_tokens: 1_000_000,
      });

      // Record 2 turns of usage to hit the limit
      const usage: TokenUsage = {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };
      await tracker.recordUsage('sess-1', usage);
      await tracker.recordUsage('sess-1', usage);

      const status = await tracker.checkBudget('sess-1');

      assert.equal(status.can_proceed, false);
      assert.equal(status.stop_reason, StopReason.MaxTurnsReached);
    });

    it('returns max_budget_tokens_reached when tokens >= max', async () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 100,
        max_budget_tokens: 500,
      });

      const usage: TokenUsage = {
        input_tokens: 300,
        output_tokens: 250,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };
      await tracker.recordUsage('sess-1', usage);

      const status = await tracker.checkBudget('sess-1');

      assert.equal(status.can_proceed, false);
      assert.equal(status.stop_reason, StopReason.MaxBudgetTokensReached);
    });

    it('returns max_budget_usd_reached when USD >= max', async () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 100,
        max_budget_tokens: 10_000_000,
        max_budget_usd: 0.001,          // very small budget
      });

      const usage: TokenUsage = {
        input_tokens: 1000,
        output_tokens: 1000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };
      await tracker.recordUsage('sess-1', usage);

      const status = await tracker.checkBudget('sess-1');

      assert.equal(status.can_proceed, false);
      assert.equal(status.stop_reason, StopReason.MaxBudgetUsdReached);
    });
  });

  // ---- recordUsage ---------------------------------------------------

  describe('recordUsage', () => {
    it('accumulates correctly across multiple calls', async () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 100,
        max_budget_tokens: 1_000_000,
      });

      const usage1: TokenUsage = {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      };
      const usage2: TokenUsage = {
        input_tokens: 200,
        output_tokens: 100,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 10,
      };

      await tracker.recordUsage('sess-1', usage1);
      await tracker.recordUsage('sess-1', usage2);

      assert.equal(tracker.turnsUsed, 2);
      assert.deepEqual(tracker.tokensUsed, {
        input: 300,
        output: 150,
        cache_write: 30,
        cache_read: 15,
      });
    });
  });

  // ---- USD cost calculation -----------------------------------------

  describe('USD cost calculation', () => {
    it('is correct for haiku model', () => {
      const pricing = pricingForModel('claude-3.5-haiku-20241022');
      const usage: TokenUsage = {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
      };

      const cost = computeCostUsd(usage, pricing);

      // haiku: $1.00 input + $5.00 output + $1.25 cache_write + $0.10 cache_read
      const expected = 1.0 + 5.0 + 1.25 + 0.10;
      assert.equal(cost, expected);
    });

    it('is correct for sonnet model', () => {
      const pricing = pricingForModel('claude-3.5-sonnet-20241022');
      const usage: TokenUsage = {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
      };

      const cost = computeCostUsd(usage, pricing);

      // sonnet: $3.00 input + $15.00 output + $3.75 cache_write + $0.30 cache_read
      const expected = 3.0 + 15.0 + 3.75 + 0.30;
      assert.equal(cost, expected);
    });

    it('is correct for opus model', () => {
      const pricing = pricingForModel('claude-3-opus-20240229');
      const usage: TokenUsage = {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
      };

      const cost = computeCostUsd(usage, pricing);

      // opus: $15.00 input + $75.00 output + $18.75 cache_write + $1.50 cache_read
      const expected = 15.0 + 75.0 + 18.75 + 1.50;
      assert.equal(cost, expected);
    });
  });

  // ---- shouldCompact ------------------------------------------------

  describe('shouldCompact', () => {
    it('returns true after compact_after_turns', async () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 100,
        max_budget_tokens: 10_000_000,
        compact_after_turns: 3,
      });

      const usage: TokenUsage = {
        input_tokens: 10,
        output_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };

      // 2 turns -- not yet
      await tracker.recordUsage('sess-1', usage);
      await tracker.recordUsage('sess-1', usage);
      assert.equal(tracker.shouldCompact, false);

      // 3rd turn -- should trigger
      await tracker.recordUsage('sess-1', usage);
      assert.equal(tracker.shouldCompact, true);
    });
  });

  // ---- compactionFailures -------------------------------------------

  describe('compaction failure tracking', () => {
    it('increments compactionFailures on failure', () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 100,
        max_budget_tokens: 10_000_000,
      });

      assert.equal(tracker.compactionFailures, 0);

      tracker.recordCompactionResult(false);
      assert.equal(tracker.compactionFailures, 1);

      tracker.recordCompactionResult(false);
      assert.equal(tracker.compactionFailures, 2);
    });

    it('resets compactionFailures on success', () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 100,
        max_budget_tokens: 10_000_000,
      });

      tracker.recordCompactionResult(false);
      tracker.recordCompactionResult(false);
      assert.equal(tracker.compactionFailures, 2);

      tracker.recordCompactionResult(true);
      assert.equal(tracker.compactionFailures, 0);
    });

    it('maxCompactionFailuresReached triggers at 3', () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 100,
        max_budget_tokens: 10_000_000,
      });

      tracker.recordCompactionResult(false);
      tracker.recordCompactionResult(false);
      assert.equal(tracker.maxCompactionFailuresReached, false);

      tracker.recordCompactionResult(false);
      assert.equal(tracker.maxCompactionFailuresReached, true);
      assert.equal(tracker.compactionFailures, MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES);
    });

    it('shouldCompact returns false after max compaction failures even when turns exceed threshold', async () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 100,
        max_budget_tokens: 10_000_000,
        compact_after_turns: 2,
      });

      const usage: TokenUsage = {
        input_tokens: 10,
        output_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };

      // Exceed compact_after_turns
      await tracker.recordUsage('sess-1', usage);
      await tracker.recordUsage('sess-1', usage);
      assert.equal(tracker.shouldCompact, true);

      // Exhaust compaction failures
      tracker.recordCompactionResult(false);
      tracker.recordCompactionResult(false);
      tracker.recordCompactionResult(false);

      assert.equal(tracker.shouldCompact, false);
    });
  });

  // ---- fromMessages factory -----------------------------------------

  describe('fromMessages', () => {
    it('correctly hydrates from a message array', () => {
      const messages: Message[] = [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 5,
          },
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hi' }],
          // No usage on user messages
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'How can I help?' }],
          usage: {
            input_tokens: 200,
            output_tokens: 100,
            cache_creation_input_tokens: 20,
            cache_read_input_tokens: 10,
          },
        },
      ];

      const tracker = BudgetTracker.fromMessages(
        client,
        { max_turns: 50, max_budget_tokens: 1_000_000 },
        'sonnet',
        messages,
      );

      // Only messages with usage count as turns
      assert.equal(tracker.turnsUsed, 2);
      assert.deepEqual(tracker.tokensUsed, {
        input: 300,
        output: 150,
        cache_write: 30,
        cache_read: 15,
      });

      // Cost should be computed from cumulative tokens at sonnet pricing
      const expectedCost = computeCostUsd(
        {
          input_tokens: 300,
          output_tokens: 150,
          cache_creation_input_tokens: 30,
          cache_read_input_tokens: 15,
        },
        pricingForModel('sonnet'),
      );
      assert.equal(tracker.usdUsed, expectedCost);
    });
  });
});
