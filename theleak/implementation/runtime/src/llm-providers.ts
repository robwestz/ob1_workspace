/**
 * LLM Provider Abstraction Layer — Multi-Model Gateway for OB1 Control
 * Wraps Claude, OpenAI/Codex, and Gemini behind a unified interface.
 * Phase 2, Plan 3 of the OB1 Control roadmap.
 * @module llm-providers
 */

// ── Unified Types ────────────────────────────────────────────────────────────

export interface UnifiedLLMRequest {
  model: string;
  system?: string;
  messages: UnifiedMessage[];
  tools?: UnifiedTool[];
  max_tokens?: number;
  temperature?: number;
  stop_sequences?: string[];
  response_format?: 'text' | 'json';
}

export interface UnifiedMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | UnifiedContent[];
}

export interface UnifiedContent {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  tool_use_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result_content?: string;
}

export interface UnifiedTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface UnifiedLLMResponse {
  id: string;
  model: string;
  provider: string;
  content: string;
  tool_calls?: UnifiedToolCall[];
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence';
  usage: { input_tokens: number; output_tokens: number; total_tokens: number; cost_usd: number };
  latency_ms: number;
}

export interface UnifiedToolCall { id: string; name: string; input: Record<string, unknown> }

// ── Provider Error ───────────────────────────────────────────────────────────

export class LLMProviderError extends Error {
  constructor(public provider: string, public statusCode: number, public detail: string, public retryable: boolean) {
    super(`[${provider}] ${statusCode}: ${detail}`);
    this.name = 'LLMProviderError';
  }
}

// ── Model Pricing (USD per 1M tokens) ────────────────────────────────────────

interface ModelCost { input: number; output: number }

const MODEL_COSTS: Record<string, ModelCost> = {
  'claude-sonnet-4-20250514': { input: 3, output: 15 }, 'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 1, output: 5 }, 'claude-3-opus-20240229': { input: 15, output: 75 },
  'gpt-4o': { input: 2.5, output: 10 }, 'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 }, 'o3': { input: 10, output: 40 },
  'o3-mini': { input: 1.1, output: 4.4 }, 'codex-mini': { input: 1.5, output: 6 },
  'gemini-2.5-pro': { input: 1.25, output: 10 }, 'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
};

function lookupCost(model: string): ModelCost {
  if (MODEL_COSTS[model]) return MODEL_COSTS[model];
  const lower = model.toLowerCase();
  for (const [key, cost] of Object.entries(MODEL_COSTS)) {
    if (lower.includes(key) || key.includes(lower)) return cost;
  }
  if (lower.includes('claude')) return { input: 3, output: 15 };
  if (lower.includes('gpt')) return { input: 2.5, output: 10 };
  if (lower.includes('gemini')) return { input: 0.15, output: 0.6 };
  return { input: 3, output: 15 };
}

function calcCost(model: string, inp: number, out: number): number {
  const c = lookupCost(model);
  return (inp * c.input + out * c.output) / 1_000_000;
}

// ── Provider Interface ───────────────────────────────────────────────────────

export interface LLMProvider {
  name: string;
  complete(request: UnifiedLLMRequest): Promise<UnifiedLLMResponse>;
}

// ── Shared Helpers ───────────────────────────────────────────────────────────

async function apiFetch(provider: string, url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => 'unknown error');
    throw new LLMProviderError(provider, res.status, text, res.status === 429 || res.status >= 500);
  }
  return res.json();
}

function flattenContent(content: string | UnifiedContent[]): string {
  if (typeof content === 'string') return content;
  return content.filter((c) => c.type === 'text' && c.text).map((c) => c.text!).join('');
}

type StopReason = UnifiedLLMResponse['stop_reason'];

// ── Anthropic Provider ───────────────────────────────────────────────────────

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  constructor(private apiKey: string, private baseUrl = 'https://api.anthropic.com') {}

  async complete(req: UnifiedLLMRequest): Promise<UnifiedLLMResponse> {
    const messages = req.messages.filter((m) => m.role !== 'system').map((m) => {
      if (typeof m.content === 'string') return { role: m.role, content: m.content };
      const blocks: unknown[] = m.content.map((c) => {
        if (c.type === 'tool_use') return { type: 'tool_use', id: c.tool_use_id, name: c.tool_name, input: c.tool_input ?? {} };
        if (c.type === 'tool_result') return { type: 'tool_result', tool_use_id: c.tool_use_id, content: c.tool_result_content ?? '' };
        return { type: 'text', text: c.text ?? '' };
      });
      return { role: m.role, content: blocks };
    });

    const systemParts: string[] = [];
    if (req.system) systemParts.push(req.system);
    for (const m of req.messages) if (m.role === 'system') systemParts.push(flattenContent(m.content));

    const body: Record<string, unknown> = { model: req.model, messages, max_tokens: req.max_tokens ?? 4096 };
    if (systemParts.length) body.system = systemParts.join('\n\n');
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.stop_sequences?.length) body.stop_sequences = req.stop_sequences;
    if (req.tools?.length) body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));

    const start = Date.now();
    const raw = (await apiFetch(this.name, `${this.baseUrl}/v1/messages`, {
      'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01',
    }, body)) as Record<string, unknown>;
    const latency = Date.now() - start;

    let text = '';
    const toolCalls: UnifiedToolCall[] = [];
    for (const block of raw.content as Array<Record<string, unknown>>) {
      if (block.type === 'text') text += block.text as string;
      if (block.type === 'tool_use') toolCalls.push({ id: block.id as string, name: block.name as string, input: block.input as Record<string, unknown> });
    }
    const usage = raw.usage as { input_tokens: number; output_tokens: number };
    const stopMap: Record<string, StopReason> = { end_turn: 'end_turn', max_tokens: 'max_tokens', tool_use: 'tool_use', stop_sequence: 'stop_sequence' };

    return {
      id: raw.id as string, model: raw.model as string, provider: this.name, content: text,
      tool_calls: toolCalls.length ? toolCalls : undefined,
      stop_reason: stopMap[raw.stop_reason as string] ?? 'end_turn',
      usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, total_tokens: usage.input_tokens + usage.output_tokens, cost_usd: calcCost(req.model, usage.input_tokens, usage.output_tokens) },
      latency_ms: latency,
    };
  }
}

// ── OpenAI Provider ──────────────────────────────────────────────────────────

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  constructor(private apiKey: string, private baseUrl = 'https://api.openai.com') {}

  async complete(req: UnifiedLLMRequest): Promise<UnifiedLLMResponse> {
    const messages: Array<Record<string, unknown>> = [];
    if (req.system) messages.push({ role: 'system', content: req.system });

    for (const m of req.messages) {
      if (typeof m.content === 'string') { messages.push({ role: m.role, content: m.content }); continue; }
      const hasToolResult = m.content.some((c) => c.type === 'tool_result');
      if (hasToolResult) {
        for (const c of m.content) if (c.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: c.tool_use_id, content: c.tool_result_content ?? '' });
      } else if (m.content.some((c) => c.type === 'tool_use')) {
        const tcs = m.content.filter((c) => c.type === 'tool_use').map((c) => ({ id: c.tool_use_id, type: 'function', function: { name: c.tool_name, arguments: JSON.stringify(c.tool_input ?? {}) } }));
        messages.push({ role: 'assistant', content: flattenContent(m.content) || null, tool_calls: tcs });
      } else {
        messages.push({ role: m.role, content: flattenContent(m.content) });
      }
    }

    const body: Record<string, unknown> = { model: req.model, messages };
    if (req.max_tokens) body.max_tokens = req.max_tokens;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.stop_sequences?.length) body.stop = req.stop_sequences;
    if (req.response_format === 'json') body.response_format = { type: 'json_object' };
    if (req.tools?.length) body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));

    const start = Date.now();
    const raw = (await apiFetch(this.name, `${this.baseUrl}/v1/chat/completions`, { Authorization: `Bearer ${this.apiKey}` }, body)) as Record<string, unknown>;
    const latency = Date.now() - start;

    const choice = (raw.choices as Array<Record<string, unknown>>)[0];
    const msg = choice.message as Record<string, unknown>;
    const text = (msg.content as string) ?? '';
    const toolCalls: UnifiedToolCall[] = [];
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
        const fn = tc.function as Record<string, unknown>;
        toolCalls.push({ id: tc.id as string, name: fn.name as string, input: JSON.parse((fn.arguments as string) || '{}') });
      }
    }
    const usage = raw.usage as { prompt_tokens: number; completion_tokens: number };
    const finishMap: Record<string, StopReason> = { stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use', content_filter: 'end_turn' };

    return {
      id: raw.id as string, model: raw.model as string, provider: this.name, content: text,
      tool_calls: toolCalls.length ? toolCalls : undefined,
      stop_reason: finishMap[choice.finish_reason as string] ?? 'end_turn',
      usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens, total_tokens: usage.prompt_tokens + usage.completion_tokens, cost_usd: calcCost(req.model, usage.prompt_tokens, usage.completion_tokens) },
      latency_ms: latency,
    };
  }
}

// ── Gemini Provider ──────────────────────────────────────────────────────────

export class GeminiProvider implements LLMProvider {
  name = 'google';
  constructor(private apiKey: string, private baseUrl = 'https://generativelanguage.googleapis.com') {}

  async complete(req: UnifiedLLMRequest): Promise<UnifiedLLMResponse> {
    const contents: Array<Record<string, unknown>> = [];
    for (const m of req.messages) {
      if (m.role === 'system') continue;
      const role = m.role === 'assistant' ? 'model' : 'user';
      if (typeof m.content === 'string') { contents.push({ role, parts: [{ text: m.content }] }); continue; }
      const parts: unknown[] = [];
      for (const c of m.content) {
        if (c.type === 'text') parts.push({ text: c.text ?? '' });
        if (c.type === 'tool_use') parts.push({ functionCall: { name: c.tool_name, args: c.tool_input ?? {} } });
        if (c.type === 'tool_result') parts.push({ functionResponse: { name: c.tool_name ?? '', response: { result: c.tool_result_content ?? '' } } });
      }
      if (parts.length) contents.push({ role, parts });
    }

    const systemParts: string[] = [];
    if (req.system) systemParts.push(req.system);
    for (const m of req.messages) if (m.role === 'system') systemParts.push(flattenContent(m.content));

    const body: Record<string, unknown> = { contents };
    if (systemParts.length) body.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] };
    const gc: Record<string, unknown> = {};
    if (req.max_tokens) gc.maxOutputTokens = req.max_tokens;
    if (req.temperature !== undefined) gc.temperature = req.temperature;
    if (req.stop_sequences?.length) gc.stopSequences = req.stop_sequences;
    if (req.response_format === 'json') gc.responseMimeType = 'application/json';
    if (Object.keys(gc).length) body.generationConfig = gc;
    if (req.tools?.length) body.tools = [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.input_schema })) }];

    const url = `${this.baseUrl}/v1beta/models/${req.model}:generateContent`;
    const start = Date.now();
    const raw = (await apiFetch(this.name, url, { 'x-goog-api-key': this.apiKey }, body)) as Record<string, unknown>;
    const latency = Date.now() - start;

    const candidate = (raw.candidates as Array<Record<string, unknown>>)[0];
    const parts = (candidate.content as Record<string, unknown>).parts as Array<Record<string, unknown>>;
    let text = '';
    const toolCalls: UnifiedToolCall[] = [];
    for (const part of parts) {
      if (part.text) text += part.text as string;
      if (part.functionCall) {
        const fc = part.functionCall as Record<string, unknown>;
        toolCalls.push({ id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: fc.name as string, input: (fc.args as Record<string, unknown>) ?? {} });
      }
    }
    const um = raw.usageMetadata as Record<string, number> | undefined;
    const inp = um?.promptTokenCount ?? 0;
    const out = um?.candidatesTokenCount ?? 0;
    const finishMap: Record<string, StopReason> = { STOP: 'end_turn', MAX_TOKENS: 'max_tokens', TOOL_CALL: 'tool_use', SAFETY: 'end_turn' };

    return {
      id: `gemini-${Date.now()}`, model: req.model, provider: this.name, content: text,
      tool_calls: toolCalls.length ? toolCalls : undefined,
      stop_reason: finishMap[candidate.finishReason as string] ?? 'end_turn',
      usage: { input_tokens: inp, output_tokens: out, total_tokens: inp + out, cost_usd: calcCost(req.model, inp, out) },
      latency_ms: latency,
    };
  }
}

// ── Provider Factory ─────────────────────────────────────────────────────────

export class ProviderFactory {
  private providers: Map<string, LLMProvider> = new Map();

  constructor() {
    if (typeof process !== 'undefined' && process.env) {
      if (process.env.ANTHROPIC_API_KEY) this.providers.set('anthropic', new AnthropicProvider(process.env.ANTHROPIC_API_KEY));
      if (process.env.OPENAI_API_KEY) this.providers.set('openai', new OpenAIProvider(process.env.OPENAI_API_KEY));
      const gk = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
      if (gk) this.providers.set('google', new GeminiProvider(gk));
    }
  }

  register(name: string, provider: LLMProvider): void { this.providers.set(name, provider); }
  get(provider: string): LLMProvider | undefined { return this.providers.get(provider); }
  has(provider: string): boolean { return this.providers.has(provider); }
  list(): string[] { return Array.from(this.providers.keys()); }
}

// ── Call Logger ──────────────────────────────────────────────────────────────

export interface LLMCallLog {
  id: string; timestamp: string; model: string; provider: string;
  input_tokens: number; output_tokens: number; cost_usd: number;
  latency_ms: number; stop_reason: string; session_id?: string; task_id?: string;
}

export class CallLogger {
  private logs: LLMCallLog[] = [];

  record(response: UnifiedLLMResponse, meta?: { session_id?: string; task_id?: string }): void {
    this.logs.push({
      id: response.id, timestamp: new Date().toISOString(),
      model: response.model, provider: response.provider,
      input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens,
      cost_usd: response.usage.cost_usd, latency_ms: response.latency_ms,
      stop_reason: response.stop_reason, session_id: meta?.session_id, task_id: meta?.task_id,
    });
  }

  getRecent(limit = 50): LLMCallLog[] { return this.logs.slice(-limit); }
  getTotalCost(): number { return this.logs.reduce((s, l) => s + l.cost_usd, 0); }

  getTotalTokens(): { input: number; output: number } {
    return this.logs.reduce((a, l) => ({ input: a.input + l.input_tokens, output: a.output + l.output_tokens }), { input: 0, output: 0 });
  }

  getByModel(): Map<string, { calls: number; cost: number; tokens: number }> {
    const m = new Map<string, { calls: number; cost: number; tokens: number }>();
    for (const l of this.logs) {
      const e = m.get(l.model) ?? { calls: 0, cost: 0, tokens: 0 };
      e.calls += 1; e.cost += l.cost_usd; e.tokens += l.input_tokens + l.output_tokens;
      m.set(l.model, e);
    }
    return m;
  }

  clear(): void { this.logs = []; }
}
