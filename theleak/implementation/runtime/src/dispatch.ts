/**
 * Dispatcher — Budget-aware dispatch layer for OB1 Control's multi-model gateway.
 *
 * Top-level entry point for all LLM calls. Ties together model registry,
 * task routing, provider abstraction, and budget tracking.
 *
 * @module dispatch
 */

// -- Local interfaces (duck-typed for parallel development) -------------------

export interface DispatchModelSpec {
  id: string; name: string; provider: string; tier: string;
  capabilities: string[]; context_window: number; max_output: number;
  input_cost_per_mtok: number; output_cost_per_mtok: number; enabled: boolean;
}

export interface UnifiedLLMResponse {
  content: string; model: string; provider: string;
  input_tokens: number; output_tokens: number;
  stop_reason: string; latency_ms: number;
}

export interface ProviderHealthStatus { healthy: boolean; latency_ms?: number; error?: string }

export interface ProviderRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  system?: string;
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  maxTokens?: number; temperature?: number;
}

export interface DispatchDeps {
  getModels?: () => DispatchModelSpec[];
  getHealth?: (provider: string) => ProviderHealthStatus | undefined;
  getProvider?: (provider: string) => { complete: (req: ProviderRequest) => Promise<UnifiedLLMResponse> } | undefined;
}

// -- Configuration & result types ---------------------------------------------

export interface DispatchConfig {
  supabaseUrl?: string; accessKey?: string; defaultModel?: string;
  budgetUsd?: number; budgetTokens?: number;
  onBudgetAlert?: (level: number, spent: number, total: number) => void;
  sessionId?: string; logCalls?: boolean;
}

export type BudgetAlertLevel = 50 | 75 | 90 | 100;

export interface DispatchResult {
  response: UnifiedLLMResponse;
  budgetStatus: { usd_spent: number; usd_remaining: number; percent_used: number; tokens_used: number };
  routingDecision: { model_id: string; model_name: string; provider: string; score: number; reasoning: string };
}

export interface CallLogEntry {
  timestamp: Date; model_id: string; provider: string;
  input_tokens: number; output_tokens: number; cost_usd: number; latency_ms: number;
}

// -- Errors -------------------------------------------------------------------

export class BudgetExhaustedError extends Error {
  constructor(public remaining_usd: number, public estimated_cost: number) {
    super(`Budget exhausted: estimated $${estimated_cost.toFixed(4)} > remaining $${remaining_usd.toFixed(4)}`);
    this.name = 'BudgetExhaustedError';
  }
}

// -- Cost helpers -------------------------------------------------------------

function estimateInputTokens(messages: Array<{ role: string; content: string }>): number {
  return Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4);
}

function costForTokens(model: DispatchModelSpec, input: number, output: number): number {
  return (input * model.input_cost_per_mtok + output * model.output_cost_per_mtok) / 1_000_000;
}

// -- Dispatcher ---------------------------------------------------------------

export class Dispatcher {
  private totalUsdSpent = 0;
  private totalTokensUsed = 0;
  private callCount = 0;
  private alertsFired = new Set<BudgetAlertLevel>();
  private callLogs: CallLogEntry[] = [];
  private deps: Required<DispatchDeps>;

  constructor(private config: DispatchConfig, deps?: DispatchDeps) {
    this.deps = {
      getModels: deps?.getModels ?? (() => []),
      getHealth: deps?.getHealth ?? (() => ({ healthy: true })),
      getProvider: deps?.getProvider ?? (() => undefined),
    };
  }

  /**
   * Main dispatch: route task -> check budget -> call model -> record usage -> return result.
   */
  async dispatch(request: {
    taskType?: string; complexity?: string;
    messages: Array<{ role: string; content: string }>;
    system?: string;
    tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
    model?: string; maxTokens?: number; temperature?: number;
  }): Promise<DispatchResult> {
    const routing = this.selectModel(request.model);
    const model = routing.model;
    const maxTokens = request.maxTokens ?? Math.min(model.max_output, 4096);

    // Pre-call budget check
    const inputEst = estimateInputTokens(request.messages);
    const estimated = costForTokens(model, inputEst, maxTokens);
    const remaining = this.config.budgetUsd !== undefined
      ? Math.max(0, this.config.budgetUsd - this.totalUsdSpent) : undefined;

    if (remaining !== undefined && estimated > remaining) {
      const cheaper = this.findCheaperModel(remaining, inputEst, maxTokens);
      if (cheaper) return this.dispatch({ ...request, model: cheaper.id });
      throw new BudgetExhaustedError(remaining, estimated);
    }

    // Call provider
    const provider = this.deps.getProvider(model.provider);
    if (!provider) throw new Error(`No provider adapter for "${model.provider}"`);

    const t0 = Date.now();
    const response = await provider.complete({
      model: model.id, messages: request.messages, system: request.system,
      tools: request.tools, maxTokens, temperature: request.temperature,
    });
    const latencyMs = Date.now() - t0;

    // Record usage
    const cost = costForTokens(model, response.input_tokens, response.output_tokens);
    this.totalUsdSpent += cost;
    this.totalTokensUsed += response.input_tokens + response.output_tokens;
    this.callCount++;

    if (this.config.logCalls !== false) {
      this.callLogs.push({
        timestamp: new Date(), model_id: model.id, provider: model.provider,
        input_tokens: response.input_tokens, output_tokens: response.output_tokens,
        cost_usd: cost, latency_ms: latencyMs,
      });
    }

    this.checkAlerts();

    const budgetUsd = this.config.budgetUsd ?? 0;
    const pct = budgetUsd > 0 ? (this.totalUsdSpent / budgetUsd) * 100 : 0;
    return {
      response,
      budgetStatus: {
        usd_spent: this.totalUsdSpent,
        usd_remaining: budgetUsd > 0 ? budgetUsd - this.totalUsdSpent : Infinity,
        percent_used: Math.min(100, pct), tokens_used: this.totalTokensUsed,
      },
      routingDecision: {
        model_id: model.id, model_name: model.name, provider: model.provider,
        score: routing.score, reasoning: routing.reasoning,
      },
    };
  }

  /** Simple dispatch -- send a prompt, get text back. */
  async complete(prompt: string, opts?: { model?: string; system?: string; maxTokens?: number }): Promise<string> {
    const r = await this.dispatch({
      messages: [{ role: 'user', content: prompt }],
      model: opts?.model, system: opts?.system, maxTokens: opts?.maxTokens,
    });
    return r.response.content;
  }

  /** Check if budget allows another call. */
  canContinue(): boolean {
    if (this.config.budgetUsd !== undefined && this.totalUsdSpent >= this.config.budgetUsd) return false;
    if (this.config.budgetTokens !== undefined && this.totalTokensUsed >= this.config.budgetTokens) return false;
    return true;
  }

  /** Current budget status snapshot. */
  getBudgetStatus() {
    const b = this.config.budgetUsd ?? 0;
    const pct = b > 0 ? (this.totalUsdSpent / b) * 100 : 0;
    return {
      usd_spent: this.totalUsdSpent,
      usd_remaining: b > 0 ? Math.max(0, b - this.totalUsdSpent) : Infinity,
      percent_used: Math.min(100, pct), tokens_used: this.totalTokensUsed, calls: this.callCount,
    };
  }

  /** Call history aggregated by model. */
  getUsageByModel(): Array<{ model: string; calls: number; cost_usd: number; tokens: number }> {
    const map = new Map<string, { calls: number; cost_usd: number; tokens: number }>();
    for (const log of this.callLogs) {
      const e = map.get(log.model_id) ?? { calls: 0, cost_usd: 0, tokens: 0 };
      e.calls++; e.cost_usd += log.cost_usd; e.tokens += log.input_tokens + log.output_tokens;
      map.set(log.model_id, e);
    }
    return Array.from(map.entries()).map(([model, s]) => ({ model, ...s }));
  }

  /** Reset budget tracking for a new session. */
  reset(): void {
    this.totalUsdSpent = 0; this.totalTokensUsed = 0; this.callCount = 0;
    this.alertsFired.clear(); this.callLogs = [];
  }

  // -- Private: model selection -----------------------------------------------

  private selectModel(overrideId?: string): { model: DispatchModelSpec; score: number; reasoning: string } {
    const models = this.deps.getModels().filter((m) => m.enabled);
    if (overrideId) {
      const m = models.find((x) => x.id === overrideId);
      if (m) return { model: m, score: 1.0, reasoning: `Explicit override: ${overrideId}` };
    }
    if (this.config.defaultModel) {
      const m = models.find((x) => x.id === this.config.defaultModel);
      if (m) return { model: m, score: 0.8, reasoning: `Default model: ${this.config.defaultModel}` };
    }
    if (models.length > 0) {
      const sorted = [...models].sort((a, b) =>
        (a.input_cost_per_mtok + a.output_cost_per_mtok) - (b.input_cost_per_mtok + b.output_cost_per_mtok));
      return { model: sorted[0], score: 0.5, reasoning: 'Auto-selected cheapest available model' };
    }
    throw new Error('No models available in registry');
  }

  private findCheaperModel(remaining: number, input: number, output: number): DispatchModelSpec | undefined {
    const affordable = this.deps.getModels()
      .filter((m) => m.enabled && costForTokens(m, input, output) <= remaining);
    if (affordable.length === 0) return undefined;
    affordable.sort((a, b) =>
      (a.input_cost_per_mtok + a.output_cost_per_mtok) - (b.input_cost_per_mtok + b.output_cost_per_mtok));
    return affordable[0];
  }

  // -- Private: budget alerts -------------------------------------------------

  private checkAlerts(): void {
    if (this.config.budgetUsd === undefined || !this.config.onBudgetAlert) return;
    const pct = (this.totalUsdSpent / this.config.budgetUsd) * 100;
    for (const level of [50, 75, 90, 100] as BudgetAlertLevel[]) {
      if (pct >= level && !this.alertsFired.has(level)) {
        this.alertsFired.add(level);
        this.config.onBudgetAlert(level, this.totalUsdSpent, this.config.budgetUsd);
      }
    }
  }
}
