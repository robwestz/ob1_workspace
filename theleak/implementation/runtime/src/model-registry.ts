/**
 * ModelRegistry — Multi-model gateway registry for OB1 Control.
 * Defines model specs across providers, tracks capabilities/pricing,
 * and provides model selection by requirements.
 * @module model-registry
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type ModelProvider = 'anthropic' | 'openai' | 'google';

export type ModelCapability =
  | 'reasoning'          // complex analysis, architecture
  | 'code_generation'    // writing/editing code
  | 'large_context'      // 1M+ token context
  | 'vision'             // image understanding
  | 'fast_output'        // high throughput
  | 'tool_use'           // function calling
  | 'structured_output'  // JSON mode
  | 'multilingual';      // strong non-English

export type ModelTier = 'flagship' | 'balanced' | 'fast';

export interface ModelSpec {
  id: string;                    // e.g. 'claude-opus-4-6'
  name: string;                  // e.g. 'Claude Opus 4.6'
  provider: ModelProvider;
  tier: ModelTier;
  capabilities: ModelCapability[];
  context_window: number;        // tokens
  max_output: number;            // tokens
  input_cost_per_mtok: number;   // USD per million tokens
  output_cost_per_mtok: number;  // USD per million tokens
  rate_limit_rpm?: number;       // requests per minute
  rate_limit_tpm?: number;       // tokens per minute
  api_endpoint: string;          // base URL
  auth_env_var: string;          // which env var holds the key
  enabled: boolean;
  notes?: string;
}

export interface ProviderHealth {
  provider: ModelProvider;
  healthy: boolean;
  latency_ms: number;
  last_checked: Date;
  error?: string;
}

// ── Capability sets ─────────────────────────────────────────────────────────

const ALL_CAPABILITIES: ModelCapability[] = [
  'reasoning', 'code_generation', 'large_context', 'vision',
  'fast_output', 'tool_use', 'structured_output', 'multilingual',
];

const MOST_CAPABILITIES: ModelCapability[] = [
  'code_generation', 'vision', 'fast_output',
  'tool_use', 'structured_output', 'multilingual',
];

// ── Provider endpoints & auth ───────────────────────────────────────────────

const PROVIDER_DEFAULTS: Record<ModelProvider, { endpoint: string; env: string }> = {
  anthropic: { endpoint: 'https://api.anthropic.com',    env: 'ANTHROPIC_API_KEY' },
  openai:    { endpoint: 'https://api.openai.com',       env: 'OPENAI_API_KEY' },
  google:    { endpoint: 'https://generativelanguage.googleapis.com', env: 'GOOGLE_API_KEY' },
};

// ── Default model catalogue ─────────────────────────────────────────────────

function defaultModels(): ModelSpec[] {
  const a = PROVIDER_DEFAULTS.anthropic;
  const o = PROVIDER_DEFAULTS.openai;
  const g = PROVIDER_DEFAULTS.google;

  return [
    // ── Anthropic ──
    {
      id: 'claude-opus-4-6',
      name: 'Claude Opus 4.6',
      provider: 'anthropic',
      tier: 'flagship',
      capabilities: [...ALL_CAPABILITIES],
      context_window: 200_000,
      max_output: 32_000,
      input_cost_per_mtok: 15,
      output_cost_per_mtok: 75,
      api_endpoint: a.endpoint,
      auth_env_var: a.env,
      enabled: true,
    },
    {
      id: 'claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6',
      provider: 'anthropic',
      tier: 'balanced',
      capabilities: [...ALL_CAPABILITIES],
      context_window: 200_000,
      max_output: 16_000,
      input_cost_per_mtok: 3,
      output_cost_per_mtok: 15,
      api_endpoint: a.endpoint,
      auth_env_var: a.env,
      enabled: true,
    },
    {
      id: 'claude-haiku-4-5',
      name: 'Claude Haiku 4.5',
      provider: 'anthropic',
      tier: 'fast',
      capabilities: [...MOST_CAPABILITIES],
      context_window: 200_000,
      max_output: 8_192,
      input_cost_per_mtok: 0.80,
      output_cost_per_mtok: 4,
      api_endpoint: a.endpoint,
      auth_env_var: a.env,
      enabled: true,
    },
    // ── OpenAI ──
    {
      id: 'gpt-4.1',
      name: 'GPT-4.1',
      provider: 'openai',
      tier: 'flagship',
      capabilities: [...ALL_CAPABILITIES],
      context_window: 1_000_000,
      max_output: 32_768,
      input_cost_per_mtok: 2,
      output_cost_per_mtok: 8,
      api_endpoint: o.endpoint,
      auth_env_var: o.env,
      enabled: true,
    },
    {
      id: 'gpt-4.1-mini',
      name: 'GPT-4.1 Mini',
      provider: 'openai',
      tier: 'balanced',
      capabilities: [...MOST_CAPABILITIES],
      context_window: 1_000_000,
      max_output: 16_384,
      input_cost_per_mtok: 0.40,
      output_cost_per_mtok: 1.60,
      api_endpoint: o.endpoint,
      auth_env_var: o.env,
      enabled: true,
    },
    {
      id: 'codex-mini',
      name: 'Codex Mini',
      provider: 'openai',
      tier: 'fast',
      capabilities: ['code_generation', 'large_context', 'tool_use', 'structured_output', 'fast_output'],
      context_window: 1_000_000,
      max_output: 16_384,
      input_cost_per_mtok: 1.50,
      output_cost_per_mtok: 6,
      api_endpoint: o.endpoint,
      auth_env_var: o.env,
      enabled: true,
    },
    // ── Google ──
    {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      provider: 'google',
      tier: 'flagship',
      capabilities: [...ALL_CAPABILITIES],
      context_window: 1_000_000,
      max_output: 65_536,
      input_cost_per_mtok: 1.25,
      output_cost_per_mtok: 10,
      api_endpoint: g.endpoint,
      auth_env_var: g.env,
      enabled: true,
    },
    {
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      provider: 'google',
      tier: 'fast',
      capabilities: [...MOST_CAPABILITIES],
      context_window: 1_000_000,
      max_output: 65_536,
      input_cost_per_mtok: 0.15,
      output_cost_per_mtok: 0.60,
      api_endpoint: g.endpoint,
      auth_env_var: g.env,
      enabled: true,
    },
  ];
}

// ── Registry ────────────────────────────────────────────────────────────────

export class ModelRegistry {
  private models: Map<string, ModelSpec> = new Map();
  private healthCache: Map<ModelProvider, ProviderHealth> = new Map();

  constructor() {
    this.loadDefaults();
  }

  private loadDefaults(): void {
    for (const spec of defaultModels()) {
      this.models.set(spec.id, spec);
    }
  }

  get(modelId: string): ModelSpec | undefined {
    return this.models.get(modelId);
  }

  list(filter?: {
    provider?: ModelProvider;
    tier?: ModelTier;
    capability?: ModelCapability;
    enabled?: boolean;
  }): ModelSpec[] {
    let results = Array.from(this.models.values());

    if (filter) {
      if (filter.provider !== undefined) {
        results = results.filter((m) => m.provider === filter.provider);
      }
      if (filter.tier !== undefined) {
        results = results.filter((m) => m.tier === filter.tier);
      }
      if (filter.capability !== undefined) {
        results = results.filter((m) => m.capabilities.includes(filter.capability!));
      }
      if (filter.enabled !== undefined) {
        results = results.filter((m) => m.enabled === filter.enabled);
      }
    }

    return results;
  }

  /** Find cheapest enabled model matching all required capabilities, cost cap, and min context. */
  findBest(requirements: {
    capabilities: ModelCapability[];
    maxCostPerMtok?: number;
    minContext?: number;
  }): ModelSpec | undefined {
    const candidates = Array.from(this.models.values()).filter((m) => {
      if (!m.enabled) return false;
      for (const cap of requirements.capabilities) {
        if (!m.capabilities.includes(cap)) return false;
      }
      if (requirements.maxCostPerMtok !== undefined && m.output_cost_per_mtok > requirements.maxCostPerMtok) {
        return false;
      }
      if (requirements.minContext !== undefined && m.context_window < requirements.minContext) {
        return false;
      }
      return true;
    });

    if (candidates.length === 0) return undefined;

    const tierRank: Record<ModelTier, number> = { flagship: 0, balanced: 1, fast: 2 };
    candidates.sort((a, b) => {
      const costA = (a.input_cost_per_mtok + a.output_cost_per_mtok) / 2;
      const costB = (b.input_cost_per_mtok + b.output_cost_per_mtok) / 2;
      if (costA !== costB) return costA - costB;
      return tierRank[a.tier] - tierRank[b.tier];
    });

    return candidates[0];
  }

  register(spec: ModelSpec): void {
    this.models.set(spec.id, spec);
  }

  setEnabled(modelId: string, enabled: boolean): void {
    const spec = this.models.get(modelId);
    if (spec) {
      spec.enabled = enabled;
    }
  }

  /** Health-check a provider via lightweight GET, measuring latency. */
  async checkHealth(provider: ModelProvider): Promise<ProviderHealth> {
    const defaults = PROVIDER_DEFAULTS[provider];
    const start = Date.now();
    let healthy = false;
    let error: string | undefined;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);

      const response = await fetch(defaults.endpoint, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${process.env[defaults.env] ?? ''}`,
        },
      });

      clearTimeout(timeout);
      healthy = response.status < 500; // 401/403 = reachable but auth required
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err);
    }

    const result: ProviderHealth = {
      provider,
      healthy,
      latency_ms: Date.now() - start,
      last_checked: new Date(),
      error,
    };

    this.healthCache.set(provider, result);
    return result;
  }

  getHealth(provider: ModelProvider): ProviderHealth | undefined {
    return this.healthCache.get(provider);
  }

  async checkAllHealth(): Promise<Map<ModelProvider, ProviderHealth>> {
    const providers: ModelProvider[] = ['anthropic', 'openai', 'google'];
    const results = await Promise.all(providers.map((p) => this.checkHealth(p)));
    const map = new Map<ModelProvider, ProviderHealth>();
    for (const r of results) {
      map.set(r.provider, r);
    }
    return map;
  }
}
