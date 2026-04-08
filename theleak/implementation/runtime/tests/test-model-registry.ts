/**
 * Tests for ModelRegistry — Node.js built-in test runner.
 *
 * Run: npx tsx --test tests/test-model-registry.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ModelRegistry,
  type ModelSpec,
} from '../src/model-registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCustomModel(overrides: Partial<ModelSpec> = {}): ModelSpec {
  return {
    id: 'custom-test-model',
    name: 'Custom Test Model',
    provider: 'openai',
    tier: 'balanced',
    capabilities: ['code_generation', 'tool_use'],
    context_window: 128_000,
    max_output: 4_096,
    input_cost_per_mtok: 1,
    output_cost_per_mtok: 3,
    api_endpoint: 'https://custom.example.com',
    auth_env_var: 'CUSTOM_API_KEY',
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModelRegistry', () => {

  describe('loadDefaults', () => {
    it('registers all 8 default models', () => {
      const registry = new ModelRegistry();
      const all = registry.list();
      assert.equal(all.length, 8, `expected 8 models, got ${all.length}`);
    });

    it('includes models from all three providers', () => {
      const registry = new ModelRegistry();
      const providers = new Set(registry.list().map((m) => m.provider));
      assert.ok(providers.has('anthropic'));
      assert.ok(providers.has('openai'));
      assert.ok(providers.has('google'));
    });
  });

  describe('get', () => {
    it('returns correct model by ID', () => {
      const registry = new ModelRegistry();
      const opus = registry.get('claude-opus-4-6');
      assert.ok(opus);
      assert.equal(opus.name, 'Claude Opus 4.6');
      assert.equal(opus.provider, 'anthropic');
      assert.equal(opus.tier, 'flagship');
    });

    it('returns undefined for unknown ID', () => {
      const registry = new ModelRegistry();
      assert.equal(registry.get('nonexistent-model'), undefined);
    });
  });

  describe('list', () => {
    it('returns all enabled models when no filter is given', () => {
      const registry = new ModelRegistry();
      const all = registry.list();
      assert.equal(all.length, 8);
      assert.ok(all.every((m) => m.enabled));
    });

    it('filters by provider', () => {
      const registry = new ModelRegistry();
      const anthropic = registry.list({ provider: 'anthropic' });
      assert.equal(anthropic.length, 3);
      assert.ok(anthropic.every((m) => m.provider === 'anthropic'));
    });

    it('filters by tier', () => {
      const registry = new ModelRegistry();
      const flagships = registry.list({ tier: 'flagship' });
      assert.equal(flagships.length, 3); // opus, gpt-4.1, gemini-2.5-pro
      assert.ok(flagships.every((m) => m.tier === 'flagship'));
    });

    it('filters by capability', () => {
      const registry = new ModelRegistry();
      const reasoning = registry.list({ capability: 'reasoning' });
      // Flagships + balanced Anthropic/OpenAI have reasoning via ALL_CAPABILITIES
      // MOST_CAPABILITIES does not include reasoning
      assert.ok(reasoning.length > 0);
      assert.ok(reasoning.every((m) => m.capabilities.includes('reasoning')));
    });

    it('filters by enabled status', () => {
      const registry = new ModelRegistry();
      registry.setEnabled('claude-haiku-4-5', false);
      const enabled = registry.list({ enabled: true });
      assert.equal(enabled.length, 7);
      const disabled = registry.list({ enabled: false });
      assert.equal(disabled.length, 1);
      assert.equal(disabled[0].id, 'claude-haiku-4-5');
    });
  });

  describe('findBest', () => {
    it('returns a model with reasoning capability', () => {
      const registry = new ModelRegistry();
      const best = registry.findBest({ capabilities: ['reasoning'] });
      assert.ok(best);
      assert.ok(best.capabilities.includes('reasoning'));
    });

    it('returns cheapest model that meets requirements', () => {
      const registry = new ModelRegistry();
      // Among models with all capabilities (flagships + balanced anthropic),
      // the cheapest should be picked
      const best = registry.findBest({ capabilities: ['tool_use'] });
      assert.ok(best);
      // gemini-2.5-flash has the lowest average cost
      assert.equal(best.id, 'gemini-2.5-flash');
    });

    it('excludes models above maxCostPerMtok', () => {
      const registry = new ModelRegistry();
      // Cap output cost at $10/Mtok — excludes opus ($75) and sonnet ($15)
      const best = registry.findBest({
        capabilities: ['reasoning'],
        maxCostPerMtok: 10,
      });
      assert.ok(best);
      assert.ok(best.output_cost_per_mtok <= 10);
      // Should not be opus or sonnet
      assert.notEqual(best.id, 'claude-opus-4-6');
      assert.notEqual(best.id, 'claude-sonnet-4-6');
    });

    it('filters by minContext', () => {
      const registry = new ModelRegistry();
      const best = registry.findBest({
        capabilities: ['tool_use'],
        minContext: 500_000,
      });
      assert.ok(best);
      assert.ok(best.context_window >= 500_000);
      // Should not be any Anthropic model (200K context)
      assert.notEqual(best.provider, 'anthropic');
    });

    it('returns undefined when no model matches', () => {
      const registry = new ModelRegistry();
      const best = registry.findBest({
        capabilities: ['reasoning'],
        maxCostPerMtok: 0.01, // impossibly cheap
      });
      assert.equal(best, undefined);
    });
  });

  describe('register', () => {
    it('adds a custom model', () => {
      const registry = new ModelRegistry();
      const custom = makeCustomModel();
      registry.register(custom);

      const retrieved = registry.get('custom-test-model');
      assert.ok(retrieved);
      assert.equal(retrieved.name, 'Custom Test Model');
      assert.equal(registry.list().length, 9); // 8 defaults + 1 custom
    });

    it('overwrites existing model with same ID', () => {
      const registry = new ModelRegistry();
      const updated = makeCustomModel({ id: 'claude-opus-4-6', name: 'Opus Override' });
      registry.register(updated);

      const retrieved = registry.get('claude-opus-4-6');
      assert.ok(retrieved);
      assert.equal(retrieved.name, 'Opus Override');
      assert.equal(registry.list().length, 8); // still 8
    });
  });

  describe('setEnabled', () => {
    it('disables a model', () => {
      const registry = new ModelRegistry();
      registry.setEnabled('claude-opus-4-6', false);

      const opus = registry.get('claude-opus-4-6');
      assert.ok(opus);
      assert.equal(opus.enabled, false);
    });

    it('re-enables a disabled model', () => {
      const registry = new ModelRegistry();
      registry.setEnabled('claude-opus-4-6', false);
      registry.setEnabled('claude-opus-4-6', true);

      const opus = registry.get('claude-opus-4-6');
      assert.ok(opus);
      assert.equal(opus.enabled, true);
    });

    it('is a no-op for unknown model IDs', () => {
      const registry = new ModelRegistry();
      // Should not throw
      registry.setEnabled('nonexistent', false);
      assert.equal(registry.list().length, 8);
    });
  });

  describe('health checks', () => {
    it('getHealth returns undefined before any check', () => {
      const registry = new ModelRegistry();
      assert.equal(registry.getHealth('anthropic'), undefined);
    });

    it('checkHealth returns a ProviderHealth structure', async () => {
      const registry = new ModelRegistry();
      // This will likely fail or timeout in test env — that is fine,
      // we just verify the shape of the response.
      const health = await registry.checkHealth('anthropic');

      assert.equal(health.provider, 'anthropic');
      assert.equal(typeof health.healthy, 'boolean');
      assert.equal(typeof health.latency_ms, 'number');
      assert.ok(health.last_checked instanceof Date);
    });

    it('checkHealth caches the result', async () => {
      const registry = new ModelRegistry();
      await registry.checkHealth('openai');
      const cached = registry.getHealth('openai');
      assert.ok(cached);
      assert.equal(cached.provider, 'openai');
    });
  });
});
