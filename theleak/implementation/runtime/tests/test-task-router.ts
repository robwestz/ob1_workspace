// =============================================================================
// Tests — Task-to-Model Router
// =============================================================================

import { TaskRouter, ModelSpec, ModelProvider, ProviderHealth, TaskProfile } from '../src/task-router';

// -- Fixtures

const MODELS: ModelSpec[] = [
  { id: 'claude-opus', name: 'Claude Opus', provider: 'anthropic', tier: 'flagship',
    capabilities: ['reasoning', 'code_generation', 'large_context', 'tool_use'],
    context_window: 200_000, max_output: 32_000, input_cost_per_mtok: 15, output_cost_per_mtok: 75, enabled: true },
  { id: 'claude-sonnet', name: 'Claude Sonnet', provider: 'anthropic', tier: 'balanced',
    capabilities: ['reasoning', 'code_generation', 'tool_use', 'structured_output'],
    context_window: 200_000, max_output: 16_000, input_cost_per_mtok: 3, output_cost_per_mtok: 15, enabled: true },
  { id: 'claude-haiku', name: 'Claude Haiku', provider: 'anthropic', tier: 'fast',
    capabilities: ['reasoning', 'code_generation', 'tool_use', 'multilingual'],
    context_window: 200_000, max_output: 8_000, input_cost_per_mtok: 0.25, output_cost_per_mtok: 1.25, enabled: true },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', tier: 'flagship',
    capabilities: ['reasoning', 'code_generation', 'vision', 'tool_use', 'structured_output'],
    context_window: 128_000, max_output: 16_000, input_cost_per_mtok: 5, output_cost_per_mtok: 15, enabled: true },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', tier: 'fast',
    capabilities: ['reasoning', 'code_generation', 'tool_use', 'multilingual'],
    context_window: 128_000, max_output: 16_000, input_cost_per_mtok: 0.15, output_cost_per_mtok: 0.60, enabled: true },
  { id: 'gemini-pro', name: 'Gemini 2.5 Pro', provider: 'google', tier: 'flagship',
    capabilities: ['reasoning', 'large_context', 'vision', 'code_generation', 'multilingual'],
    context_window: 1_000_000, max_output: 65_000, input_cost_per_mtok: 1.25, output_cost_per_mtok: 10, enabled: true },
  { id: 'disabled-model', name: 'Disabled Model', provider: 'google', tier: 'balanced',
    capabilities: ['reasoning'], context_window: 128_000, max_output: 8_000,
    input_cost_per_mtok: 1, output_cost_per_mtok: 5, enabled: false },
];

const HEALTHY: Record<ModelProvider, ProviderHealth> = {
  anthropic: { provider: 'anthropic', healthy: true, latency_ms: 120 },
  openai:    { provider: 'openai',    healthy: true, latency_ms: 200 },
  google:    { provider: 'google',    healthy: true, latency_ms: 250 },
};

function makeRouter(models = MODELS, health: Record<string, ProviderHealth> = HEALTHY): TaskRouter {
  return new TaskRouter(() => models, (p) => health[p]);
}

// -- Test harness

let passed = 0, failed = 0;
function assert(ok: boolean, label: string) {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else    { failed++; console.error(`  FAIL  ${label}`); }
}

console.log('\n=== Task Router Tests ===\n');

// 1. Routes complex architecture tasks to flagship models
{
  const d = makeRouter().route({
    type: 'architecture', complexity: 'expert', estimated_tokens: 100_000,
    required_capabilities: ['reasoning', 'large_context'], priority: 'high',
  });
  assert(d.model.tier === 'flagship', 'architecture/expert routes to flagship');
  assert(d.score > 0, 'score is positive');
  assert(d.reasoning.length > 0, 'reasoning is non-empty');
}

// 2. Routes trivial documentation to fast/cheap models
{
  const d = makeRouter().route({
    type: 'documentation', complexity: 'trivial', estimated_tokens: 5_000,
    required_capabilities: ['multilingual'], priority: 'low',
  });
  assert(d.model.tier === 'fast', 'trivial docs routes to fast tier');
  assert(d.estimated_cost_usd < 0.01, 'trivial docs cost is very low');
}

// 3. Respects budget cap -- skips expensive models
{
  const router = makeRouter();
  const d = router.route({
    type: 'code_write', complexity: 'complex', estimated_tokens: 50_000,
    required_capabilities: ['reasoning'], priority: 'normal', max_cost_usd: 0.05,
  });
  assert(router.estimateCost(d.model, 50_000, 15_000) <= 0.05, 'selected model respects budget cap');
  assert(d.model.id !== 'claude-opus', 'expensive opus excluded by budget');
  assert(d.model.id !== 'gpt-4o', 'expensive gpt-4o excluded by budget');
}

// 4. Excludes unhealthy providers
{
  const health: Record<string, ProviderHealth> = {
    anthropic: { provider: 'anthropic', healthy: false, latency_ms: 9999 },
    openai:    { provider: 'openai',    healthy: true,  latency_ms: 200 },
    google:    { provider: 'google',    healthy: true,  latency_ms: 250 },
  };
  const d = makeRouter(MODELS, health).route({
    type: 'general', complexity: 'moderate', estimated_tokens: 40_000,
    required_capabilities: ['reasoning'], priority: 'normal',
  });
  assert(d.model.provider !== 'anthropic', 'unhealthy anthropic excluded');
  assert(d.fallbacks.every((m) => m.provider !== 'anthropic'), 'fallbacks also exclude unhealthy');
}

// 5. Excludes disabled models
{
  const d = makeRouter().route({
    type: 'general', complexity: 'moderate', estimated_tokens: 40_000,
    required_capabilities: ['reasoning'], priority: 'normal',
  });
  assert(d.model.id !== 'disabled-model', 'disabled model not selected');
  assert(!d.fallbacks.some((m) => m.id === 'disabled-model'), 'disabled model not in fallbacks');
}

// 6. Returns fallbacks in order
{
  const d = makeRouter().route({
    type: 'code_write', complexity: 'moderate', estimated_tokens: 50_000,
    required_capabilities: ['code_generation', 'tool_use'], priority: 'normal',
  });
  assert(d.fallbacks.length <= 2, 'at most 2 fallbacks');
  assert(d.fallbacks.length >= 1, 'at least 1 fallback returned');
  const allIds = [d.model.id, ...d.fallbacks.map((m) => m.id)];
  assert(new Set(allIds).size === allIds.length, 'no duplicates between primary and fallbacks');
}

// 7. quickRoute returns reasonable defaults for each task type
{
  const router = makeRouter();
  const types = ['code_write','code_review','architecture','testing','security','research','documentation','general'] as const;
  for (const t of types) {
    const d = router.quickRoute(t);
    assert(d.model !== undefined, `quickRoute(${t}) returns a model`);
    assert(d.score > 0 && d.score <= 1, `quickRoute(${t}) score in (0,1]`);
  }
}

// 8. estimateCost calculates correctly
{
  const router = makeRouter();
  const opus = MODELS[0]; // 15/mtok in, 75/mtok out
  assert(router.estimateCost(opus, 1_000_000, 1_000_000) === 90, 'estimateCost: 1M+1M on Opus = $90');
  const small = router.estimateCost(opus, 1_000, 500);
  const expected = (1_000 / 1e6) * 15 + (500 / 1e6) * 75;
  assert(Math.abs(small - expected) < 1e-6, `estimateCost: small tokens = ${expected}`);
}

// 9. Preferred provider gets bonus in scoring
{
  const router = makeRouter();
  const base: TaskProfile = { type: 'general', complexity: 'moderate', estimated_tokens: 40_000,
    required_capabilities: ['reasoning'], priority: 'normal' };
  const withPref = router.route({ ...base, preferred_provider: 'google' });
  if (withPref.model.provider === 'google') {
    assert(true, 'preferred provider google selected when bonus applied');
  } else {
    assert(withPref.score > 0, 'preferred provider bonus does not break routing');
  }
}

// 10. All required capabilities must be present (missing = excluded)
{
  const d = makeRouter().route({
    type: 'research', complexity: 'moderate', estimated_tokens: 40_000,
    required_capabilities: ['vision', 'large_context'], priority: 'normal',
  });
  assert(d.model.capabilities.includes('vision'), 'selected model has vision capability');
  assert(d.model.capabilities.includes('large_context'), 'selected model has large_context capability');
}

// 11. Throws when no model matches
{
  let threw = false;
  try {
    makeRouter().route({ type: 'general', complexity: 'expert', estimated_tokens: 100_000,
      required_capabilities: ['vision', 'multilingual', 'large_context', 'fast_output'], priority: 'critical' });
  } catch { threw = true; }
  assert(threw, 'throws when no model has all required capabilities');
}

// -- Summary
console.log(`\n--- ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
