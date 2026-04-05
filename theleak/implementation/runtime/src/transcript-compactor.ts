// =============================================================================
// transcript-compactor.ts — Transcript Compaction Engine
//
// Summarizes old messages when the context window grows too large, preserving
// the most recent messages and archiving everything else to Supabase. The
// compacted content is also persisted as a searchable OB1 thought with
// provenance metadata and embeddings.
//
// Trigger: budget tracker signals shouldCompact (turn threshold exceeded)
// Strategy: keep last N messages (default 4), summarize the rest
// Archive: raw messages stored in compaction_archive table
// Persist: summary stored as an OB1 thought for cross-session retrieval
//
// Integration: called by the agentic loop after each turn (post-turn phase).
// =============================================================================

import { OB1Client } from './ob1-client.js';
import type {
  Message,
} from './types.js';
import { SessionManager } from './session-manager.js';
import { BudgetTracker, MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES } from './budget-tracker.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** LLM API client used for generating the structured summary. */
export interface ApiClient {
  /**
   * Send a completion request and return the text response.
   * Used to generate the structured summary from compacted messages.
   */
  complete(params: {
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    max_tokens: number;
  }): Promise<string>;
}

/** Event emitter interface for streaming compaction events. */
export interface StreamEventEmitter {
  emit(event: CompactionEvent): void;
}

export type CompactionEvent =
  | {
      type: 'compaction_start';
      messages_to_compact: number;
      messages_to_preserve: number;
      input_tokens_before: number;
    }
  | {
      type: 'compaction_complete';
      messages_removed: number;
      tokens_recovered: number;
      thought_id: string | null;
      compaction_index: number;
      consecutive_failures: number;
    }
  | {
      type: 'compaction_failed';
      reason: string;
      consecutive_failures: number;
      max_failures: number;
      will_retry: boolean;
    };

/** Compaction configuration. */
export interface CompactionConfig {
  /** Number of recent messages to preserve verbatim. Default: 4. */
  preserve_recent: number;
  /** Minimum turn count before compaction is allowed. Default: 8. */
  min_turns_before_compact: number;
  /** Whether to persist summaries as OB1 thoughts. Default: true. */
  persist_to_thoughts: boolean;
  /** Summary format. Default: 'xml'. */
  summary_format: 'xml' | 'structured';
}

const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  preserve_recent: 4,
  min_turns_before_compact: 8,
  persist_to_thoughts: true,
  summary_format: 'xml',
};

/** Structured summary extracted from compacted messages. */
interface StructuredSummary {
  user_requests: string[];
  key_decisions: string[];
  pending_work: string[];
  files_touched: string[];
  tools_used: Array<{ name: string; count: number; last_outcome: 'success' | 'error' }>;
  timeline: { first: string; last: string };
  errors_encountered: string[];
  message_count: number;
}

// ---------------------------------------------------------------------------
// TranscriptCompactor
// ---------------------------------------------------------------------------

export class TranscriptCompactor {
  private client: OB1Client;
  private apiClient: ApiClient;
  private config: CompactionConfig;
  private consecutiveFailures: number = 0;
  private eventEmitter: StreamEventEmitter | null;

  constructor(
    client: OB1Client,
    apiClient: ApiClient,
    config: Partial<CompactionConfig> = {},
    eventEmitter?: StreamEventEmitter,
  ) {
    this.client = client;
    this.apiClient = apiClient;
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
    this.eventEmitter = eventEmitter ?? null;
  }

  // ---- Public API ----

  /**
   * Check if compaction is needed and perform it if so.
   *
   * Returns true if compaction was performed, false otherwise.
   *
   * Flow:
   *   1. Guard checks: failure count, budget.shouldCompact, minimum turns
   *   2. Split messages into to-summarize and to-keep
   *   3. Generate structured summary via LLM
   *   4. Archive raw messages to compaction_archive via Edge Function
   *   5. Persist summary as a searchable OB1 thought
   *   6. Replace session messages with [continuation_msg, ...recent_msgs]
   *   7. Emit streaming events
   *   8. Update budget tracker
   */
  async compactIfNeeded(
    session: SessionManager,
    budget: BudgetTracker,
  ): Promise<boolean> {
    // Guard 1: Check consecutive failure count
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
      await this.client.logEvent({
        category: 'compaction',
        title: 'compaction_skipped_max_failures',
        severity: 'warn',
        session_id: session.sessionId,
        detail: {
          consecutive_failures: this.consecutiveFailures,
          max_allowed: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
        },
      }).catch(() => {});
      return false;
    }

    // Guard 2: Check whether budget says compaction is needed
    if (!budget.shouldCompact) {
      return false;
    }

    // Guard 2b: Budget check before LLM call — compaction itself burns tokens,
    // so we must not call the LLM if the budget is already exhausted.
    // [HARDENING] Added missing budget check before compaction LLM call.
    const budgetStatus = await budget.checkBudget(session.sessionId);
    if (!budgetStatus.can_proceed) {
      await this.client.logEvent({
        category: 'compaction',
        title: 'compaction_skipped_budget_exhausted',
        severity: 'warn',
        session_id: session.sessionId,
        detail: {
          stop_reason: budgetStatus.stop_reason,
          tokens_used: budgetStatus.tokens_used,
          usd_used: budgetStatus.usd_used,
        },
      }).catch(() => {});
      return false;
    }

    // Guard 3: Minimum turn count
    if (budget.turnsUsed < this.config.min_turns_before_compact) {
      return false;
    }

    const messages = session.getMessages();
    const preserveCount = this.config.preserve_recent;

    // Guard 4: Enough messages to compact
    if (messages.length <= preserveCount + 1) {
      this.recordFailure(budget, session.sessionId, 'Not enough messages to compact');
      return false;
    }

    // Split messages
    const toSummarize = messages.slice(0, messages.length - preserveCount);
    const toKeep = messages.slice(messages.length - preserveCount);

    // Capture token count before compaction
    const inputTokensBefore = budget.tokensUsed.input + budget.tokensUsed.output;

    // Emit start event
    this.eventEmitter?.emit({
      type: 'compaction_start',
      messages_to_compact: toSummarize.length,
      messages_to_preserve: toKeep.length,
      input_tokens_before: inputTokensBefore,
    });

    try {
      // Generate summary
      const summaryText = await this.generateSummary(toSummarize);

      if (!summaryText) {
        this.recordFailure(budget, session.sessionId, 'Summary generation returned empty');
        return false;
      }

      const compactionIndex = session.compactionCount + 1;

      // Archive raw messages
      const archiveId = await this.archiveMessages(
        session.sessionId,
        toSummarize,
        summaryText,
        compactionIndex,
        inputTokensBefore,
      );

      // Build continuation message with summary
      const continuationMessage: Message = {
        role: 'system',
        content: [
          {
            type: 'text',
            text: [
              'This session is being continued from a previous conversation that ran out of context.',
              'The summary below covers the earlier portion of the conversation.',
              'Do not recap or acknowledge this summary -- just continue working.',
              '',
              summaryText,
            ].join('\n'),
          },
        ],
        timestamp: new Date().toISOString(),
      };

      // Replace session messages (this also increments compaction_count)
      session.replaceMessages([continuationMessage, ...toKeep]);
      await session.flush();

      // Persist as OB1 thought
      let thoughtId: string | null = null;
      if (this.config.persist_to_thoughts) {
        thoughtId = await this.persistSummaryAsThought(
          session.sessionId,
          compactionIndex,
          summaryText,
          toSummarize,
        );
      }

      // Record success
      this.consecutiveFailures = 0;
      budget.recordCompactionResult(true);

      // Compute tokens recovered
      const postTokens = budget.tokensUsed.input + budget.tokensUsed.output;
      const tokensRecovered = inputTokensBefore - postTokens;

      // Log success
      await this.client.logEvent({
        category: 'compaction',
        title: 'auto_compaction_complete',
        severity: 'info',
        session_id: session.sessionId,
        detail: {
          messages_removed: toSummarize.length,
          compaction_index: compactionIndex,
          summary_length: summaryText.length,
          thought_id: thoughtId,
          archive_id: archiveId,
          tokens_before: inputTokensBefore,
          tokens_after: postTokens,
          tokens_recovered: tokensRecovered,
        },
      }).catch(() => {});

      // Emit complete event
      this.eventEmitter?.emit({
        type: 'compaction_complete',
        messages_removed: toSummarize.length,
        tokens_recovered: tokensRecovered,
        thought_id: thoughtId,
        compaction_index: compactionIndex,
        consecutive_failures: this.consecutiveFailures,
      });

      return true;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.recordFailure(budget, session.sessionId, reason);
      return false;
    }
  }

  /** Reset the consecutive failure counter (e.g., after manual compaction). */
  resetFailures(): void {
    this.consecutiveFailures = 0;
  }

  /** Current consecutive failure count. */
  get failureCount(): number {
    return this.consecutiveFailures;
  }

  /** Whether the compactor has exhausted its retry budget. */
  get isExhausted(): boolean {
    return this.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES;
  }

  // ---- Private: Summary Generation ----

  /**
   * Generate a structured summary of old messages.
   *
   * First extracts structured data deterministically, then uses the LLM
   * to produce a narrative summary. Both are rendered into XML.
   */
  private async generateSummary(messages: Message[]): Promise<string> {
    const structured = this.extractStructuredData(messages);
    const prompt = this.formatSummaryPrompt(messages);

    try {
      const llmSummary = await this.apiClient.complete({
        system:
          'You are a transcript summarizer. Produce a concise, actionable summary of the conversation. ' +
          'Focus on what was done, what decisions were made, what work remains, and any errors encountered. ' +
          'Be precise about file paths, tool names, and technical details. ' +
          'Do NOT include pleasantries or meta-commentary about summarizing.',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
      });

      return this.renderSummaryXml(structured, llmSummary);
    } catch {
      // Fallback: structured extraction only (no LLM call)
      return this.renderSummaryXml(structured, null);
    }
  }

  /**
   * Extract structured data from messages without an LLM call.
   * Deterministic, fast extraction of key information.
   */
  private extractStructuredData(messages: Message[]): StructuredSummary {
    const userRequests: string[] = [];
    const filesTouched = new Set<string>();
    const toolUsage = new Map<string, { count: number; last_outcome: 'success' | 'error' }>();
    const errors: string[] = [];

    for (const msg of messages) {
      for (const block of msg.content) {
        // Extract user requests
        if (msg.role === 'user' && block.type === 'text' && block.text) {
          userRequests.push(block.text.slice(0, 200));
        }

        // Track tool usage
        if (block.type === 'tool_use' && block.tool_name) {
          const existing = toolUsage.get(block.tool_name) ?? {
            count: 0,
            last_outcome: 'success' as const,
          };
          existing.count++;
          toolUsage.set(block.tool_name, existing);
        }

        // Track tool errors
        if (block.type === 'tool_result' && block.is_error) {
          const errorText =
            typeof block.tool_result === 'string'
              ? block.tool_result.slice(0, 150)
              : JSON.stringify(block.tool_result).slice(0, 150);
          errors.push(errorText);

          // Mark the last tool as having errored (heuristic)
          for (const [_name, data] of toolUsage.entries()) {
            data.last_outcome = 'error';
          }
        }

        // Extract file paths from text content
        if (block.type === 'text' && block.text) {
          const filePattern = /(?:^|\s)([\w./\\-]+\.\w{1,10})(?:\s|$|:|,)/g;
          let match;
          while ((match = filePattern.exec(block.text)) !== null) {
            const path = match[1];
            if (path.includes('/') || path.includes('\\')) {
              filesTouched.add(path);
            }
          }
        }
      }
    }

    const timestamps = messages
      .map((m) => m.timestamp)
      .filter((t): t is string => t !== undefined)
      .sort();

    return {
      user_requests: userRequests.slice(-5),
      key_decisions: [],
      pending_work: [],
      files_touched: [...filesTouched].slice(0, 20),
      tools_used: [...toolUsage.entries()].map(([name, data]) => ({
        name,
        count: data.count,
        last_outcome: data.last_outcome,
      })),
      timeline: {
        first: timestamps[0] ?? new Date().toISOString(),
        last: timestamps[timestamps.length - 1] ?? new Date().toISOString(),
      },
      errors_encountered: errors.slice(-5),
      message_count: messages.length,
    };
  }

  /**
   * Format the prompt sent to the LLM for summary generation.
   */
  private formatSummaryPrompt(messages: Message[]): string {
    const lines: string[] = [
      'Summarize the following conversation transcript. Extract:',
      '1. What the user requested (key tasks and goals)',
      '2. Key decisions made (architecture, library choices, approach)',
      '3. Work that was started but not finished',
      '4. Files that were read, written, or discussed',
      '5. Errors encountered and how they were resolved (or not)',
      '',
      'Be concise. Use bullet points. Include specific file paths and tool names.',
      '',
      '--- TRANSCRIPT ---',
      '',
    ];

    for (const msg of messages) {
      const roleLabel = msg.role.toUpperCase();

      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          const text =
            block.text.length > 1000 ? block.text.slice(0, 1000) + '...[truncated]' : block.text;
          lines.push(`[${roleLabel}] ${text}`);
        } else if (block.type === 'tool_use' && block.tool_name) {
          const inputStr = block.tool_input
            ? JSON.stringify(block.tool_input).slice(0, 200)
            : '';
          lines.push(`[TOOL_USE: ${block.tool_name}] ${inputStr}`);
        } else if (block.type === 'tool_result') {
          const status = block.is_error ? 'ERROR' : 'OK';
          const resultStr =
            typeof block.tool_result === 'string'
              ? block.tool_result.slice(0, 200)
              : '';
          lines.push(`[TOOL_RESULT: ${status}] ${resultStr}`);
        }
      }
    }

    lines.push('', '--- END TRANSCRIPT ---');
    return lines.join('\n');
  }

  /**
   * Render the structured summary into XML format with <summary> tags.
   */
  private renderSummaryXml(
    structured: StructuredSummary,
    narrativeSummary: string | null,
  ): string {
    const sections: string[] = [];

    sections.push('<summary>');
    sections.push(
      `<scope>Compacted ${structured.message_count} messages (${structured.timeline.first} to ${structured.timeline.last})</scope>`,
    );

    if (narrativeSummary) {
      sections.push('<narrative>');
      sections.push(escapeXml(narrativeSummary.trim()));
      sections.push('</narrative>');
    }

    if (structured.user_requests.length > 0) {
      sections.push('<user_requests>');
      for (const req of structured.user_requests) {
        sections.push(`  <request>${escapeXml(req)}</request>`);
      }
      sections.push('</user_requests>');
    }

    if (structured.key_decisions.length > 0) {
      sections.push('<decisions>');
      for (const dec of structured.key_decisions) {
        sections.push(`  <decision>${escapeXml(dec)}</decision>`);
      }
      sections.push('</decisions>');
    }

    if (structured.pending_work.length > 0) {
      sections.push('<pending_work>');
      for (const work of structured.pending_work) {
        sections.push(`  <item>${escapeXml(work)}</item>`);
      }
      sections.push('</pending_work>');
    }

    if (structured.files_touched.length > 0) {
      sections.push('<files_context>');
      for (const file of structured.files_touched) {
        sections.push(`  <file>${escapeXml(file)}</file>`);
      }
      sections.push('</files_context>');
    }

    if (structured.tools_used.length > 0) {
      sections.push('<tools_inventory>');
      for (const tool of structured.tools_used) {
        sections.push(
          `  <tool name="${escapeXml(tool.name)}" uses="${tool.count}" last_outcome="${tool.last_outcome}" />`,
        );
      }
      sections.push('</tools_inventory>');
    }

    if (structured.errors_encountered.length > 0) {
      sections.push('<errors>');
      for (const err of structured.errors_encountered) {
        sections.push(`  <error>${escapeXml(err)}</error>`);
      }
      sections.push('</errors>');
    }

    sections.push('</summary>');
    return sections.join('\n');
  }

  // ---- Private: Archive & Persist ----

  /**
   * Archive removed messages to the compaction_archive table via Edge Function.
   * Returns the archive row ID, or null on failure.
   */
  private async archiveMessages(
    sessionId: string,
    messages: Message[],
    summary: string,
    compactionIndex: number,
    inputTokensBefore: number,
  ): Promise<string | null> {
    try {
      // Use the generic call method on OB1Client to reach the Edge Function
      await this.client.updateSession(sessionId, {
        // We store the archive alongside the session update; alternatively
        // a dedicated Edge Function endpoint handles this.
        config_snapshot: {
          _compaction_archive: {
            compaction_index: compactionIndex,
            messages_removed: messages,
            message_count: messages.length,
            summary_text: summary,
            summary_format: this.config.summary_format === 'xml' ? 'xml' : 'plain',
            input_tokens_before: inputTokensBefore,
            input_tokens_after: 0,
          },
        },
      } as any).then(() => null);

      // The archive insertion is best-effort; return null for now.
      // A production deployment would have a dedicated create_compaction_archive action.
      return null;
    } catch (err) {
      await this.client.logEvent({
        category: 'compaction',
        title: 'archive_write_failed',
        severity: 'warn',
        session_id: sessionId,
        detail: { error: err instanceof Error ? err.message : String(err) },
      }).catch(() => {});
      return null;
    }
  }

  /**
   * Persist the compaction summary as a searchable OB1 thought.
   * The thought gets an embedding for semantic retrieval across sessions.
   */
  private async persistSummaryAsThought(
    sessionId: string,
    compactionIndex: number,
    _summaryText: string,
    compactedMessages: Message[],
  ): Promise<string | null> {
    const structured = this.extractStructuredData(compactedMessages);

    const content = [
      `Session ${sessionId} compaction #${compactionIndex}:`,
      '',
      structured.user_requests.length > 0
        ? `User worked on: ${structured.user_requests.join('; ')}`
        : '',
      structured.key_decisions.length > 0
        ? `Key decisions: ${structured.key_decisions.join('; ')}`
        : '',
      structured.pending_work.length > 0
        ? `Pending: ${structured.pending_work.join('; ')}`
        : '',
      structured.files_touched.length > 0
        ? `Files: ${structured.files_touched.join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const metadata = {
      type: 'compaction_summary',
      memory_scope: 'session',
      memory_type: 'context',
      session_id: sessionId,
      compaction_index: compactionIndex,
      messages_compacted: structured.message_count,
      key_decisions: structured.key_decisions,
      pending_work: structured.pending_work,
      files_touched: structured.files_touched,
      tools_used: structured.tools_used.map((t) => t.name),
      timeline: structured.timeline,
      tags: ['compaction', `session:${sessionId}`],
      provenance: {
        source_type: 'compaction_derived' as const,
        trust_level: 4,
        created_at: new Date().toISOString(),
      },
      version: 1,
    };

    try {
      const thoughtId = await this.client.memoryStore(content, metadata);
      return thoughtId ?? null;
    } catch (err) {
      await this.client.logEvent({
        category: 'compaction',
        title: 'thought_persist_failed',
        severity: 'warn',
        session_id: sessionId,
        detail: { error: err instanceof Error ? err.message : String(err) },
      }).catch(() => {});
      return null;
    }
  }

  // ---- Private: Failure Tracking ----

  /**
   * Record a compaction failure, emit failure event, and log.
   */
  private async recordFailure(
    budget: BudgetTracker,
    sessionId: string,
    reason: string,
  ): Promise<void> {
    this.consecutiveFailures++;
    budget.recordCompactionResult(false);

    const willRetry = this.consecutiveFailures < MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES;

    this.eventEmitter?.emit({
      type: 'compaction_failed',
      reason,
      consecutive_failures: this.consecutiveFailures,
      max_failures: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
      will_retry: willRetry,
    });

    await this.client.logEvent({
      category: 'compaction',
      title: 'compaction_failed',
      severity: willRetry ? 'warn' : 'error',
      session_id: sessionId,
      detail: {
        reason,
        consecutive_failures: this.consecutiveFailures,
        max_failures: MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
        will_retry: willRetry,
      },
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
