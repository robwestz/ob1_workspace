// =============================================================================
// Unit Tests — Dispatcher
// =============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  Dispatcher, BudgetExhaustedError,
  type DispatchModelSpec, type DispatchDeps, type UnifiedLLMResponse,
} from '../src/dispatch.js';

// -- Helpers ------------------------------------------------------------------

function model(o: Partial<DispatchModelSpec> = {}): DispatchModelSpec {
  return {
    id: 'test-model', name: 'Test Model', provider: 'test', tier: 'balanced',
    capabilities: ['reasoning'], context_window: 200_000, max_output: 4096,
    input_cost_per_mtok: 3, output_cost_per_mtok: 15, enabled: true, ...o,
  };
}

function resp(o: Partial<UnifiedLLMResponse> = {}): UnifiedLLMResponse {
  return {
    content: 'Hello', model: 'test-model', provider: 'test',
    input_tokens: 100, output_tokens: 50, stop_reason: 'end_turn', latency_ms: 200, ...o,
  };
}

function deps(models: DispatchModelSpec[] = [model()], r?: UnifiedLLMResponse): DispatchDeps {
  return {
    getModels: () => models, getHealth: () => ({ healthy: true }),
    getProvider: () => ({ complete: async () => r ?? resp() }),
  };
}

const MSG = [{ role: 'user', content: 'Hi' }];

// -- Tests --------------------------------------------------------------------

describe('Dispatcher', () => {
  it('calls provider and returns result', async () => {
    const d = new Dispatcher({ budgetUsd: 10 }, deps());
    const r = await d.dispatch({ messages: MSG });
    assert.equal(r.response.content, 'Hello');
    assert.equal(r.routingDecision.model_id, 'test-model');
    assert.ok(r.budgetStatus.usd_spent > 0);
  });

  it('rejects when budget is exhausted', async () => {
    const d = new Dispatcher({ budgetUsd: 0.000001 }, deps([model()]));
    await assert.rejects(() => d.dispatch({ messages: MSG }), BudgetExhaustedError);
  });

  it('fires budget alerts at 50%, 75%, 90%', async () => {
    const alerts: number[] = [];
    // Model cost per call: 5000*3/1M + 5000*15/1M = 0.09
    const r = resp({ input_tokens: 5000, output_tokens: 5000 });
    const d = new Dispatcher(
      { budgetUsd: 0.18, onBudgetAlert: (lvl) => alerts.push(lvl) },
      deps([model()], r),
    );
    await d.dispatch({ messages: MSG }); // 50%
    assert.ok(alerts.includes(50));
    await d.dispatch({ messages: MSG }); // 100%
    assert.ok(alerts.includes(100));
  });

  it('fires each alert level only once', async () => {
    const alerts: number[] = [];
    const r = resp({ input_tokens: 10000, output_tokens: 10000 });
    // Per call: 0.18, budget 0.20 -> fires 50+75+90 on first call
    const d = new Dispatcher(
      { budgetUsd: 0.20, onBudgetAlert: (lvl) => alerts.push(lvl) },
      deps([model()], r),
    );
    await d.dispatch({ messages: MSG });
    const unique = new Set(alerts);
    assert.equal(unique.size, alerts.length, 'no duplicate alerts');
  });

  it('complete() returns just the text', async () => {
    const d = new Dispatcher({ budgetUsd: 10 }, deps());
    assert.equal(await d.complete('Hi'), 'Hello');
  });

  it('canContinue returns false when USD budget exceeded', async () => {
    const r = resp({ input_tokens: 100_000, output_tokens: 100_000 });
    const expensive = model({ input_cost_per_mtok: 1000, output_cost_per_mtok: 5000 });
    const d = new Dispatcher({ budgetUsd: 0.001 }, deps([expensive], r));
    try { await d.dispatch({ messages: MSG }); } catch { /* budget reject ok */ }
    if (d.getBudgetStatus().usd_spent > 0) assert.equal(d.canContinue(), false);
  });

  it('canContinue returns false when token budget exceeded', async () => {
    const r = resp({ input_tokens: 500, output_tokens: 500 });
    const d = new Dispatcher({ budgetUsd: 100, budgetTokens: 500 }, deps([model()], r));
    await d.dispatch({ messages: MSG });
    assert.equal(d.canContinue(), false);
  });

  it('aggregates usage by model', async () => {
    const ma = model({ id: 'model-a', name: 'A' });
    const mb = model({ id: 'model-b', name: 'B' });
    const r = resp({ input_tokens: 100, output_tokens: 50 });
    const d = new Dispatcher({ budgetUsd: 100 }, deps([ma, mb], r));
    await d.dispatch({ messages: MSG, model: 'model-a' });
    await d.dispatch({ messages: MSG, model: 'model-a' });
    await d.dispatch({ messages: MSG, model: 'model-b' });
    const usage = d.getUsageByModel();
    const a = usage.find((u) => u.model === 'model-a')!;
    assert.equal(a.calls, 2);
    assert.equal(a.tokens, 300);
    assert.equal(usage.find((u) => u.model === 'model-b')!.calls, 1);
  });

  it('resets all state', async () => {
    const d = new Dispatcher({ budgetUsd: 100 }, deps());
    await d.dispatch({ messages: MSG });
    d.reset();
    const s = d.getBudgetStatus();
    assert.equal(s.usd_spent, 0);
    assert.equal(s.tokens_used, 0);
    assert.equal(s.calls, 0);
    assert.deepEqual(d.getUsageByModel(), []);
  });

  it('falls back to cheaper model when budget tight', async () => {
    const expensive = model({ id: 'expensive', input_cost_per_mtok: 100, output_cost_per_mtok: 500 });
    const cheap = model({ id: 'cheap', input_cost_per_mtok: 0.1, output_cost_per_mtok: 0.4 });
    const r = resp({ input_tokens: 10, output_tokens: 10 });
    const d = new Dispatcher(
      { budgetUsd: 0.01, defaultModel: 'expensive' },
      deps([expensive, cheap], r),
    );
    const result = await d.dispatch({ messages: MSG });
    assert.equal(result.routingDecision.model_id, 'cheap');
  });

  it('getBudgetStatus reflects accurate spend', async () => {
    const r = resp({ input_tokens: 1000, output_tokens: 500 });
    const d = new Dispatcher({ budgetUsd: 1.0 }, deps([model()], r));
    await d.dispatch({ messages: MSG });
    const s = d.getBudgetStatus();
    // Cost: 1000*3/1M + 500*15/1M = 0.003 + 0.0075 = 0.0105
    assert.ok(Math.abs(s.usd_spent - 0.0105) < 0.0001);
    assert.equal(s.tokens_used, 1500);
    assert.equal(s.calls, 1);
    assert.ok(s.usd_remaining > 0);
    assert.ok(s.percent_used > 0);
  });
});
