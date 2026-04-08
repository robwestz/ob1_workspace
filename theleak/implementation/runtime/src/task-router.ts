// =============================================================================
// OB1 Control — Task-to-Model Router
// =============================================================================
// Phase 2, Plan 2: Routes tasks to the optimal model based on task profile,
// model capabilities, cost constraints, and provider health.
// =============================================================================

// -- Shared types (will live in model-registry.ts, defined here for compilation)

export type ModelProvider = 'anthropic' | 'openai' | 'google';
export type ModelCapability =
  | 'reasoning' | 'code_generation' | 'large_context' | 'vision'
  | 'fast_output' | 'tool_use' | 'structured_output' | 'multilingual';
export type ModelTier = 'flagship' | 'balanced' | 'fast';

export interface ModelSpec {
  id: string; name: string; provider: ModelProvider; tier: ModelTier;
  capabilities: ModelCapability[]; context_window: number; max_output: number;
  input_cost_per_mtok: number; output_cost_per_mtok: number; enabled: boolean;
}

export interface ProviderHealth {
  provider: ModelProvider; healthy: boolean; latency_ms: number;
}

// -- Task types

export type TaskType =
  | 'code_write' | 'code_review' | 'code_fix' | 'architecture'
  | 'research' | 'documentation' | 'testing' | 'security'
  | 'refactor' | 'deploy' | 'general';

export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'expert';

export interface TaskProfile {
  type: TaskType;
  complexity: TaskComplexity;
  estimated_tokens: number;
  required_capabilities: ModelCapability[];
  preferred_provider?: ModelProvider;
  max_cost_usd?: number;
  priority: 'low' | 'normal' | 'high' | 'critical';
}

export interface RoutingDecision {
  model: ModelSpec;
  score: number;
  reasoning: string;
  fallbacks: ModelSpec[];
  estimated_cost_usd: number;
}

// -- Quick-route defaults per task type

const QUICK_ROUTE_DEFAULTS: Record<TaskType, Omit<TaskProfile, 'type'>> = {
  code_write:     { complexity: 'moderate', required_capabilities: ['code_generation', 'tool_use'],    estimated_tokens: 50_000,  priority: 'normal' },
  code_review:    { complexity: 'simple',   required_capabilities: ['reasoning'],                      estimated_tokens: 30_000,  priority: 'normal' },
  code_fix:       { complexity: 'moderate', required_capabilities: ['code_generation', 'reasoning'],   estimated_tokens: 40_000,  priority: 'normal' },
  architecture:   { complexity: 'expert',   required_capabilities: ['reasoning', 'large_context'],     estimated_tokens: 100_000, priority: 'high'   },
  research:       { complexity: 'moderate', required_capabilities: ['large_context', 'reasoning'],     estimated_tokens: 80_000,  priority: 'normal' },
  documentation:  { complexity: 'simple',   required_capabilities: ['multilingual'],                   estimated_tokens: 20_000,  priority: 'low'    },
  testing:        { complexity: 'simple',   required_capabilities: ['code_generation', 'tool_use'],    estimated_tokens: 30_000,  priority: 'normal' },
  security:       { complexity: 'complex',  required_capabilities: ['reasoning', 'code_generation'],   estimated_tokens: 50_000,  priority: 'high'   },
  refactor:       { complexity: 'moderate', required_capabilities: ['code_generation', 'reasoning'],   estimated_tokens: 50_000,  priority: 'normal' },
  deploy:         { complexity: 'simple',   required_capabilities: ['tool_use'],                       estimated_tokens: 20_000,  priority: 'high'   },
  general:        { complexity: 'moderate', required_capabilities: ['reasoning'],                      estimated_tokens: 40_000,  priority: 'normal' },
};

// -- Scoring weights

const WEIGHTS = { capability: 0.30, tier: 0.25, cost: 0.25, context: 0.10, latency: 0.10 } as const;
const PREFERRED_PROVIDER_BONUS = 0.05;

// -- Router

export class TaskRouter {
  constructor(
    private getModels: () => ModelSpec[],
    private getHealth: (provider: ModelProvider) => ProviderHealth | undefined,
  ) {}

  /**
   * Route a task to the best available model.
   *
   * Scoring: capability(0.3) + tier(0.25) + cost(0.25) + context(0.1) + latency(0.1)
   * Returns top model + reasoning + up to 2 fallbacks.
   */
  route(task: TaskProfile): RoutingDecision {
    const candidates = this.filterCandidates(task);
    if (candidates.length === 0) {
      throw new Error(`No eligible model found for task: ${task.type} (${task.complexity})`);
    }
    const scored = this.scoreCandidates(candidates, task);
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const fallbacks = scored.slice(1, 3).map((s) => s.model);
    const estimatedCost = this.estimateCost(best.model, task.estimated_tokens, Math.round(task.estimated_tokens * 0.3));
    return { model: best.model, score: best.score, reasoning: best.reasoning, fallbacks, estimated_cost_usd: estimatedCost };
  }

  /** Quick route by task type using sensible defaults for complexity/tokens. */
  quickRoute(type: TaskType): RoutingDecision {
    return this.route({ type, ...QUICK_ROUTE_DEFAULTS[type] });
  }

  /** Estimate cost for a task on a given model. */
  estimateCost(model: ModelSpec, estimatedInputTokens: number, estimatedOutputTokens: number): number {
    const inputCost = (estimatedInputTokens / 1_000_000) * model.input_cost_per_mtok;
    const outputCost = (estimatedOutputTokens / 1_000_000) * model.output_cost_per_mtok;
    return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
  }

  // -- Internals

  private filterCandidates(task: TaskProfile): ModelSpec[] {
    return this.getModels().filter((model) => {
      if (!model.enabled) return false;
      const health = this.getHealth(model.provider);
      if (health && !health.healthy) return false;
      if (!task.required_capabilities.every((cap) => model.capabilities.includes(cap))) return false;
      if (task.max_cost_usd !== undefined) {
        const estCost = this.estimateCost(model, task.estimated_tokens, Math.round(task.estimated_tokens * 0.3));
        if (estCost > task.max_cost_usd) return false;
      }
      return true;
    });
  }

  private scoreCandidates(
    candidates: ModelSpec[], task: TaskProfile,
  ): Array<{ model: ModelSpec; score: number; reasoning: string }> {
    const maxCost = Math.max(...candidates.map((m) => m.input_cost_per_mtok + m.output_cost_per_mtok));

    return candidates.map((model) => {
      const capScore = this.scoreCapability(model, task);
      const tierScore = this.scoreTier(model, task);
      const costScore = this.scoreCost(model, maxCost);
      const contextScore = this.scoreContext(model, task);
      const latencyScore = this.scoreLatency(model);

      let total = capScore * WEIGHTS.capability + tierScore * WEIGHTS.tier +
        costScore * WEIGHTS.cost + contextScore * WEIGHTS.context + latencyScore * WEIGHTS.latency;
      if (task.preferred_provider && model.provider === task.preferred_provider) total += PREFERRED_PROVIDER_BONUS;
      total = Math.min(1, Math.max(0, total));

      const reasoning =
        `${model.name} (${model.provider}/${model.tier}): ` +
        `cap=${capScore.toFixed(2)} tier=${tierScore.toFixed(2)} cost=${costScore.toFixed(2)} ` +
        `ctx=${contextScore.toFixed(2)} lat=${latencyScore.toFixed(2)}` +
        (task.preferred_provider === model.provider ? ' +preferred' : '');

      return { model, score: Math.round(total * 1000) / 1000, reasoning };
    });
  }

  /** Prefer specialists: ratio of required caps to total model caps. */
  private scoreCapability(model: ModelSpec, task: TaskProfile): number {
    if (task.required_capabilities.length === 0) return 1.0;
    const matching = task.required_capabilities.filter((c) => model.capabilities.includes(c)).length;
    return matching / model.capabilities.length;
  }

  /** Match model tier to task complexity. */
  private scoreTier(model: ModelSpec, task: TaskProfile): number {
    const ideal: Record<TaskComplexity, ModelTier> = {
      trivial: 'fast', simple: 'fast', moderate: 'balanced', complex: 'flagship', expert: 'flagship',
    };
    return model.tier === ideal[task.complexity] ? 1.0 : 0.4;
  }

  /** Cheaper is better (normalized against the candidate set). */
  private scoreCost(model: ModelSpec, maxCostInSet: number): number {
    if (maxCostInSet === 0) return 1.0;
    return 1.0 - (model.input_cost_per_mtok + model.output_cost_per_mtok) / maxCostInSet;
  }

  /** Context window should comfortably exceed estimated tokens. */
  private scoreContext(model: ModelSpec, task: TaskProfile): number {
    if (model.context_window >= task.estimated_tokens * 2) return 1.0;
    if (model.context_window >= task.estimated_tokens) return 0.5;
    return 0.0;
  }

  /** Lower provider latency gets a higher score. */
  private scoreLatency(model: ModelSpec): number {
    const health = this.getHealth(model.provider);
    if (!health) return 0.5;
    if (health.latency_ms <= 100) return 1.0;
    if (health.latency_ms <= 300) return 0.7;
    if (health.latency_ms <= 500) return 0.5;
    return 0.3;
  }
}
