// =============================================================================
// anthropic-client.ts — Anthropic Messages API Client
//
// Wraps the Anthropic Messages API with streaming SSE support. Implements the
// ApiClient interface used by TranscriptCompactor (complete()) and
// ConversationRuntime (stream()).
//
// Uses built-in fetch (Node 20+). No external dependencies.
// =============================================================================

import type {
  ApiClient as CompactorApiClient,
} from './transcript-compactor.js';

import type {
  ApiClient as RuntimeApiClient,
  Message,
  ToolDefinition,
  StreamEvent,
  ContentBlock,
} from './conversation-runtime.js';

// ---------------------------------------------------------------------------
// Model name resolution
// ---------------------------------------------------------------------------

const MODEL_MAP: Record<string, string> = {
  haiku:  'claude-haiku-4-20250414',
  sonnet: 'claude-sonnet-4-20250514',
  opus:   'claude-opus-4-20250414',
};

/**
 * Resolve a shorthand model name to the full Anthropic model ID.
 * If the input already looks like a full ID, return it as-is.
 */
function resolveModel(model: string): string {
  const lowered = model.toLowerCase();
  return MODEL_MAP[lowered] ?? model;
}

// ---------------------------------------------------------------------------
// SSE line parser
// ---------------------------------------------------------------------------

/**
 * Parse a single SSE data line into a typed object.
 * Returns null for non-data lines (event:, id:, retry:, comments).
 */
function parseSSELine(line: string): Record<string, unknown> | null {
  if (!line.startsWith('data: ')) return null;
  const payload = line.slice(6).trim();
  if (payload === '[DONE]') return null;
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AnthropicApiClient
// ---------------------------------------------------------------------------

/**
 * HTTP client for the Anthropic Messages API with streaming support.
 *
 * Implements both the CompactorApiClient (non-streaming `complete()` for
 * transcript compaction) and RuntimeApiClient (streaming `stream()` for
 * the agentic loop).
 */
export class AnthropicApiClient implements CompactorApiClient, RuntimeApiClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly apiVersion: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    model = 'claude-sonnet-4-20250514',
    options?: { apiVersion?: string; baseUrl?: string },
  ) {
    this.apiKey = apiKey;
    this.model = resolveModel(model);
    this.apiVersion = options?.apiVersion ?? '2023-06-01';
    this.baseUrl = options?.baseUrl ?? 'https://api.anthropic.com';
  }

  // =========================================================================
  // CompactorApiClient — non-streaming completion
  // =========================================================================

  /**
   * Send a non-streaming completion request. Used by TranscriptCompactor
   * for generating structured summaries.
   */
  async complete(params: {
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    max_tokens: number;
  }): Promise<string> {
    const body = {
      model: this.model,
      max_tokens: params.max_tokens,
      system: params.system,
      messages: params.messages,
    };

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(
        `Anthropic API error ${res.status}: ${errorBody.slice(0, 500)}`,
      );
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
    };

    // Extract text from the first text block
    const textBlock = data.content?.find((b) => b.type === 'text');
    return textBlock?.text ?? '';
  }

  // =========================================================================
  // RuntimeApiClient — streaming for the agentic loop
  // =========================================================================

  /**
   * Stream a Messages API response, yielding typed StreamEvent objects.
   *
   * Sends the request with `stream: true` and parses the SSE response.
   * Each SSE `data:` line is parsed into the StreamEvent discriminated
   * union used by ConversationRuntime.
   */
  async *stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string,
  ): AsyncGenerator<StreamEvent> {
    // Convert messages to Anthropic API format
    const apiMessages = messages.map((msg) => ({
      role: msg.role === 'system' ? 'user' : msg.role,
      content: msg.content,
    }));

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 8192,
      stream: true,
      system: systemPrompt,
      messages: apiMessages,
    };

    if (tools.length > 0) {
      body.tools = tools;
    }

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      yield {
        type: 'error',
        error: {
          type: 'api_error',
          message: `Anthropic API error ${res.status}: ${errorBody.slice(0, 500)}`,
        },
      } as StreamEvent;
      return;
    }

    if (!res.body) {
      yield {
        type: 'error',
        error: { type: 'api_error', message: 'Response body is null' },
      } as StreamEvent;
      return;
    }

    // Read the SSE stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const parsed = parseSSELine(trimmed);
          if (!parsed) continue;

          const event = this.mapToStreamEvent(parsed);
          if (event) {
            yield event;
          }
        }
      }

      // Process any remaining data in the buffer
      if (buffer.trim()) {
        const parsed = parseSSELine(buffer.trim());
        if (parsed) {
          const event = this.mapToStreamEvent(parsed);
          if (event) yield event;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // =========================================================================
  // Private: SSE to StreamEvent mapping
  // =========================================================================

  /**
   * Map a raw SSE JSON object to a typed StreamEvent.
   *
   * Anthropic SSE event types:
   *   - message_start      -> StreamEvent.message_start (with message metadata)
   *   - content_block_start -> StreamEvent.content_block_start (text or tool_use)
   *   - content_block_delta -> StreamEvent.content_block_delta (incremental text/json)
   *   - content_block_stop  -> StreamEvent.content_block_stop
   *   - message_delta       -> StreamEvent.message_delta (stop_reason, usage)
   *   - message_stop        -> StreamEvent.message_stop
   *   - ping                -> StreamEvent.ping
   *   - error               -> StreamEvent.error
   */
  private mapToStreamEvent(raw: Record<string, unknown>): StreamEvent | null {
    const type = raw.type as string;

    switch (type) {
      case 'message_start': {
        const message = raw.message as Record<string, unknown> | undefined;
        return {
          type: 'message_start',
          message: message
            ? {
                id: (message.id as string) ?? '',
                role: (message.role as string) ?? 'assistant',
                content: (message.content as ContentBlock[]) ?? [],
                model: (message.model as string) ?? this.model,
                stop_reason: (message.stop_reason as string | null) ?? null,
                usage: (message.usage as { input_tokens: number; output_tokens: number }) ?? {
                  input_tokens: 0,
                  output_tokens: 0,
                },
              }
            : undefined,
        } as StreamEvent;
      }

      case 'content_block_start': {
        const block = raw.content_block as Record<string, unknown> | undefined;
        return {
          type: 'content_block_start',
          index: raw.index as number | undefined,
          content_block: block
            ? {
                type: block.type as string,
                text: block.text as string | undefined,
                id: block.id as string | undefined,
                name: block.name as string | undefined,
                input: block.input as Record<string, unknown> | undefined,
              }
            : undefined,
        } as StreamEvent;
      }

      case 'content_block_delta': {
        const delta = raw.delta as Record<string, unknown> | undefined;
        return {
          type: 'content_block_delta',
          index: raw.index as number | undefined,
          delta: delta
            ? {
                type: delta.type as string,
                text: delta.text as string | undefined,
                partial_json: delta.partial_json as string | undefined,
              }
            : undefined,
        } as StreamEvent;
      }

      case 'content_block_stop':
        return {
          type: 'content_block_stop',
          index: raw.index as number | undefined,
        } as StreamEvent;

      case 'message_delta': {
        const delta = raw.delta as Record<string, unknown> | undefined;
        const usage = raw.usage as Record<string, unknown> | undefined;
        return {
          type: 'message_delta',
          delta: delta
            ? {
                type: 'message_delta',
                text: undefined,
              }
            : undefined,
          message: delta
            ? {
                id: '',
                role: 'assistant',
                content: [],
                model: this.model,
                stop_reason: (delta.stop_reason as string | null) ?? null,
                usage: {
                  input_tokens: 0,
                  output_tokens: (usage?.output_tokens as number) ?? 0,
                },
              }
            : undefined,
          usage: usage
            ? { output_tokens: (usage.output_tokens as number) ?? 0 }
            : undefined,
        } as StreamEvent;
      }

      case 'message_stop':
        return { type: 'message_stop' } as StreamEvent;

      case 'ping':
        return { type: 'ping' } as StreamEvent;

      case 'error': {
        const error = raw.error as Record<string, unknown> | undefined;
        return {
          type: 'error',
          error: error
            ? {
                type: (error.type as string) ?? 'unknown',
                message: (error.message as string) ?? 'Unknown error',
              }
            : { type: 'unknown', message: 'Unknown error' },
        } as StreamEvent;
      }

      default:
        return null;
    }
  }
}
