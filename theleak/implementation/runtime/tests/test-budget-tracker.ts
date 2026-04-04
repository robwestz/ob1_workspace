// =============================================================================
// Unit Tests — BudgetTracker
// =============================================================================

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  BudgetTracker,
  computeCostUsd,
  pricingForModel,
  formatUsd,
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

    it('uses default limits when BudgetConfig fields are undefined', async () => {
      // All fields undefined -- should use defaults (50 turns, 1M tokens, no USD limit)
      const tracker = new BudgetTracker(client, {});

      const status = await tracker.checkBudget('sess-1');
      assert.equal(status.can_proceed, true);
      assert.equal(status.stop_reason, undefined);
    });

    it('does not stop on USD when max_budget_usd is undefined', async () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 1000,
        max_budget_tokens: 100_000_000,
        // max_budget_usd intentionally omitted
      });

      // Record large usage that would trigger a USD stop if there was a limit
      const usage: TokenUsage = {
        input_tokens: 10_000_000,
        output_tokens: 10_000_000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };
      await tracker.recordUsage('sess-1', usage);

      const status = await tracker.checkBudget('sess-1');
      assert.equal(status.can_proceed, true);
      assert.equal(status.stop_reason, undefined);
    });

    it('turn limit check takes priority over token limit', async () => {
      // Both limits exceeded -- turns checked first
      const tracker = new BudgetTracker(client, {
        max_turns: 1,
        max_budget_tokens: 100,
      });

      const usage: TokenUsage = {
        input_tokens: 200,
        output_tokens: 200,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };
      await tracker.recordUsage('sess-1', usage);

      const status = await tracker.checkBudget('sess-1');
      assert.equal(status.can_proceed, false);
      assert.equal(status.stop_reason, StopReason.MaxTurnsReached);
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

    it('returns stop_reason when budget exceeded after recording', async () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 1,
        max_budget_tokens: 1_000_000,
      });

      const usage: TokenUsage = {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };

      const result = await tracker.recordUsage('sess-1', usage);
      assert.equal(result.stop_reason, StopReason.MaxTurnsReached);
    });

    it('returns compaction_needed when turns exceed compact_after_turns', async () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 100,
        max_budget_tokens: 1_000_000,
        compact_after_turns: 2,
      });

      const usage: TokenUsage = {
        input_tokens: 10,
        output_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };

      const r1 = await tracker.recordUsage('sess-1', usage);
      assert.equal(r1.compaction_needed, false);

      const r2 = await tracker.recordUsage('sess-1', usage);
      assert.equal(r2.compaction_needed, true);
    });

    it('returns stop_reason undefined when no budget exceeded', async () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 100,
        max_budget_tokens: 1_000_000,
      });

      const usage: TokenUsage = {
        input_tokens: 10,
        output_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };

      const result = await tracker.recordUsage('sess-1', usage);
      assert.equal(result.stop_reason, undefined);
    });

    it('persists usage to client.recordUsage', async () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 100,
        max_budget_tokens: 1_000_000,
      });

      const usage: TokenUsage = {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      };

      await tracker.recordUsage('sess-1', usage);

      assert.equal(client.recordUsage.mock.callCount(), 1);
    });

    it('handles client.recordUsage failure gracefully (non-fatal)', async () => {
      const failingClient = {
        recordUsage: mock.fn(async () => {
          throw new Error('Network error');
        }),
        logEvent: mock.fn(async () => {}),
      } as any;

      const tracker = new BudgetTracker(failingClient, {
        max_turns: 100,
        max_budget_tokens: 1_000_000,
      });

      const usage: TokenUsage = {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };

      // Should not throw
      const result = await tracker.recordUsage('sess-1', usage);
      assert.equal(tracker.turnsUsed, 1);
      assert.equal(result.stop_reason, undefined);
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

    it('returns 0 cost for zero tokens', () => {
      const pricing = pricingForModel('sonnet');
      const usage: TokenUsage = {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };

      const cost = computeCostUsd(usage, pricing);
      assert.equal(cost, 0);
    });
  });

  // ---- pricingForModel ------------------------------------------------

  describe('pricingForModel', () => {
    it('falls back to sonnet pricing for unknown models', () => {
      const unknown = pricingForModel('gpt-4-turbo');
      const sonnet = pricingForModel('sonnet');

      assert.deepEqual(unknown, sonnet);
    });

    it('is case-insensitive', () => {
      const upper = pricingForModel('CLAUDE-HAIKU');
      const lower = pricingForModel('claude-haiku');
      assert.deepEqual(upper, lower);
    });

    it('matches model family by substring', () => {
      const pricing = pricingForModel('claude-3.5-sonnet-20241022');
      assert.equal(pricing.input_per_million, 3.00);
      assert.equal(pricing.output_per_million, 15.00);
    });
  });

  // ---- formatUsd ------------------------------------------------------

  describe('formatUsd', () => {
    it('formats to 4 decimal places with dollar sign', () => {
      assert.equal(formatUsd(0), '$0.0000');
      assert.equal(formatUsd(1.5), '$1.5000');
      assert.equal(formatUsd(0.00019), '$0.0002'); // rounds up
      assert.equal(formatUsd(123.456789), '$123.4568');
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

    it('uses default compact_after_turns (20) when not specified', async () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 100,
        max_budget_tokens: 10_000_000,
      });

      const usage: TokenUsage = {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };

      // Record 19 turns -- should not compact
      for (let i = 0; i < 19; i++) {
        await tracker.recordUsage('sess-1', usage);
      }
      assert.equal(tracker.shouldCompact, false);

      // 20th turn -- should trigger
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

  // ---- percentUsed --------------------------------------------------

  describe('percentUsed', () => {
    it('returns 0% for fresh tracker', () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 10,
        max_budget_tokens: 100_000,
        max_budget_usd: 1.0,
      });

      const pct = tracker.percentUsed;
      assert.equal(pct.turns, 0);
      assert.equal(pct.tokens, 0);
      assert.equal(pct.usd, 0);
    });

    it('returns correct percentages after usage', async () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 10,
        max_budget_tokens: 1000,
        max_budget_usd: 1.0,
      });

      const usage: TokenUsage = {
        input_tokens: 250,
        output_tokens: 250,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };

      await tracker.recordUsage('sess-1', usage);

      const pct = tracker.percentUsed;
      assert.equal(pct.turns, 10); // 1/10 = 10%
      assert.equal(pct.tokens, 50); // 500/1000 = 50%
    });

    it('caps at 100%', async () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 1,
        max_budget_tokens: 100,
      });

      const usage: TokenUsage = {
        input_tokens: 500,
        output_tokens: 500,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };

      await tracker.recordUsage('sess-1', usage);

      const pct = tracker.percentUsed;
      assert.equal(pct.turns, 100);
      assert.equal(pct.tokens, 100);
    });

    it('returns 0% for usd when no USD limit is set', () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 10,
        max_budget_tokens: 100_000,
        // no max_budget_usd
      });

      const pct = tracker.percentUsed;
      assert.equal(pct.usd, 0);
    });
  });

  // ---- setModel -----------------------------------------------------

  describe('setModel', () => {
    it('changes the pricing used for cost estimation', async () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 100,
        max_budget_tokens: 10_000_000,
      });

      // Default model is sonnet
      const usage: TokenUsage = {
        input_tokens: 1_000_000,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };

      await tracker.recordUsage('sess-1', usage);
      const sonnetCost = tracker.usdUsed;

      // Create a fresh tracker with opus
      const tracker2 = new BudgetTracker(client, {
        max_turns: 100,
        max_budget_tokens: 10_000_000,
      });
      tracker2.setModel('opus');

      await tracker2.recordUsage('sess-1', usage);
      const opusCost = tracker2.usdUsed;

      // Opus should be more expensive than sonnet
      assert.ok(opusCost > sonnetCost, `Opus ($${opusCost}) should cost more than Sonnet ($${sonnetCost})`);
    });
  });

  // ---- toStreamingEvent -----------------------------------------------

  describe('toStreamingEvent', () => {
    it('returns a structured event with budget status', async () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 10,
        max_budget_tokens: 100_000,
        max_budget_usd: 5.0,
      });

      const usage: TokenUsage = {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      };
      await tracker.recordUsage('sess-1', usage);

      const event = tracker.toStreamingEvent();
      assert.equal(event.type, 'budget_status');
      assert.equal(event.turns, '1/10');
      assert.ok(typeof event.cost === 'string');
      assert.ok((event.cost as string).startsWith('$'));
      assert.ok(typeof event.budget_percent === 'number');
      assert.equal(event.compaction_status, 'ok');
    });

    it('shows unlimited when no USD limit', () => {
      const tracker = new BudgetTracker(client, {
        max_turns: 10,
        max_budget_tokens: 100_000,
      });

      const event = tracker.toStreamingEvent();
      assert.equal(event.cost_limit, 'unlimited');
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

    it('handles empty message array', () => {
      const tracker = BudgetTracker.fromMessages(
        client,
        { max_turns: 50, max_budget_tokens: 1_000_000 },
        'sonnet',
        [],
      );

      assert.equal(tracker.turnsUsed, 0);
      assert.equal(tracker.usdUsed, 0);
      assert.deepEqual(tracker.tokensUsed, {
        input: 0,
        output: 0,
        cache_write: 0,
        cache_read: 0,
      });
    });

    it('uses correct pricing for the specified model', () => {
      const messages: Message[] = [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
          usage: {
            input_tokens: 1_000_000,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      ];

      const haikuTracker = BudgetTracker.fromMessages(client, {}, 'haiku', messages);
      const opusTracker = BudgetTracker.fromMessages(client, {}, 'opus', messages);

      // haiku: $1.00/M input, opus: $15.00/M input
      assert.equal(haikuTracker.usdUsed, 1.00);
      assert.equal(opusTracker.usdUsed, 15.00);
    });
  });
});
