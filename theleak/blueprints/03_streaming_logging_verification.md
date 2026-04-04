# Blueprint 03: Streaming Events, System Event Logging, Verification Harness

> Primitives #6, #7, #8 -- Stream-Builder Agent Output
> Synthesized from: skill_streaming_renderer, skill_system_event_logging, skill_detected_pattern_event-driven_streaming, gap_ops_analysis, gc_sse_incremental, gc_markdown_streaming

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Structured Streaming Events (Primitive #6)](#2-structured-streaming-events-primitive-6)
3. [System Event Logging (Primitive #7)](#3-system-event-logging-primitive-7)
4. [Verification Harness (Primitive #8)](#4-verification-harness-primitive-8)
5. [Cross-Primitive Dependencies](#5-cross-primitive-dependencies)
6. [OB1 Integration](#6-ob1-integration)
7. [Implementation Order](#7-implementation-order)

---

## 1. Architecture Overview

Three primitives form a layered observability and correctness stack:

```
                  +---------------------------+
                  |   Verification Harness    |  <-- validates both layers below
                  |   (Primitive #8)          |
                  +---------------------------+
                             |
              +--------------+--------------+
              |                             |
   +----------v----------+    +-------------v-----------+
   | Structured Streaming |    | System Event Logging    |
   | Events (Primitive #6)|    | (Primitive #7)          |
   +-----------+----------+    +-------------+-----------+
               |                             |
               +------ feed into ------------+
               |                             |
   +-----------v-----------------------------v-----------+
   |              OB1 Supabase Persistence                |
   |   thoughts table (type='system_event')               |
   |   system_events table (dedicated, high-throughput)    |
   |   Real-time subscriptions for live monitoring         |
   +-----------------------------------------------------+
```

### Data Flow

```
Agent Turn
  |
  +-> SSE Stream from LLM API
  |     |
  |     +-> SseParser.push(chunk) -> typed SseEvent[]
  |     |     |
  |     |     +-> StreamEventDispatcher
  |     |           |
  |     |           +-> message_start -> EventLogger.log(category='stream', ...)
  |     |           +-> tool_match    -> EventLogger.log(category='tool_selection', ...)
  |     |           +-> permission_denial -> EventLogger.log(category='permission', ...)
  |     |           +-> message_delta -> MarkdownStreamBuffer.push(delta)
  |     |           +-> message_stop  -> EventLogger.log(category='turn_complete', ...)
  |     |
  |     +-> MarkdownStreamBuffer
  |           |
  |           +-> Fence-aware buffering
  |           +-> Safe boundary flushing
  |           +-> Rendered output to consumer (TUI/dashboard/webhook)
  |
  +-> EventLogger (append-only, session-scoped)
  |     |
  |     +-> HistoryLog (in-memory, append-only, per-session)
  |     +-> TranscriptStore (compactable shadow)
  |     +-> Supabase persistence (batched writes)
  |
  +-> VerificationHarness (runs on change triggers)
        |
        +-> Invariant tests against logged events
        +-> Results stored in OB1
```

---

## 2. Structured Streaming Events (Primitive #6)

### 2.1 Typed Event System

Define a discriminated union of all stream events. Every event carries a `type` field for dispatch and structured metadata.

```typescript
// types/stream-events.ts

/** Base interface for all stream events */
interface StreamEventBase {
  type: string;
  timestamp: string;        // ISO 8601 with ms precision
  session_id: string;
  sequence: number;         // monotonic counter within session
}

/** Emitted at the start of each agent response */
interface MessageStartEvent extends StreamEventBase {
  type: 'message_start';
  prompt_fingerprint: string;  // hash of the prompt for correlation
  model: string;               // model ID being used
  context_token_count: number; // tokens in context at start
}

/** Emitted when the router matches tools for the current turn */
interface ToolMatchEvent extends StreamEventBase {
  type: 'tool_match';
  matched_tools: Array<{
    tool_name: string;
    match_score: number;
    source: 'builtin' | 'mcp' | 'skill';
  }>;
  total_available: number;
}

/** Emitted when a tool is denied by the permission system */
interface PermissionDenialEvent extends StreamEventBase {
  type: 'permission_denial';
  tool_name: string;
  denial_reason: string;
  policy_source: 'allowlist' | 'denylist' | 'user_rejection' | 'budget';
  was_destructive: boolean;
}

/** Emitted for each content chunk from the LLM */
interface MessageDeltaEvent extends StreamEventBase {
  type: 'message_delta';
  delta: string;              // raw text chunk
  accumulated_length: number; // total chars so far
}

/** Emitted when the LLM response completes */
interface MessageStopEvent extends StreamEventBase {
  type: 'message_stop';
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'budget_exhausted' | 'error';
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    total_cost_cents: number;
  };
  transcript_size: number;    // message count in transcript
  turn_duration_ms: number;   // wall clock time for this turn
}

/** Emitted when the agent requests tool execution */
interface ToolExecutionEvent extends StreamEventBase {
  type: 'tool_execution';
  tool_name: string;
  requires_approval: boolean;
  approval_status: 'pending' | 'approved' | 'denied' | 'auto_approved';
  execution_duration_ms?: number;
  exit_code?: number;
}

/** Union type for dispatch */
type StreamEvent =
  | MessageStartEvent
  | ToolMatchEvent
  | PermissionDenialEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | ToolExecutionEvent;
```

### 2.2 SSE Parser with Incremental Buffering

Ported from the Rust `SseParser` pattern. Handles arbitrary chunk sizes, never loses a frame.

```typescript
// streaming/sse-parser.ts

interface SseFrame {
  event: string;  // SSE "event:" field, defaults to "message"
  data: string;   // SSE "data:" field (joined if multi-line)
  id?: string;    // SSE "id:" field
  retry?: number; // SSE "retry:" field
}

export class SseParser {
  private buffer: string = '';
  private lastEventId: string = '';

  /**
   * Push a raw chunk from the network. Returns zero or more complete frames.
   * Incomplete frames remain buffered for the next push().
   */
  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];

    // SSE frames are delimited by double newlines
    let boundary: number;
    while ((boundary = this.buffer.indexOf('\n\n')) !== -1) {
      const rawFrame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);

      const frame = this.parseFrame(rawFrame);
      if (frame) {
        frames.push(frame);
      }
    }

    return frames;
  }

  /**
   * Call when the stream ends. Flushes any trailing data that didn't
   * end with a double newline.
   */
  finish(): SseFrame[] {
    if (this.buffer.trim().length === 0) {
      return [];
    }
    const frame = this.parseFrame(this.buffer);
    this.buffer = '';
    return frame ? [frame] : [];
  }

  private parseFrame(raw: string): SseFrame | null {
    let event = 'message';
    const dataLines: string[] = [];
    let id: string | undefined;
    let retry: number | undefined;

    for (const line of raw.split('\n')) {
      // Skip comments (lines starting with :)
      if (line.startsWith(':')) continue;

      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const field = line.slice(0, colonIndex);
      // Spec: if char after colon is space, skip it
      const value = line.slice(colonIndex + 1).replace(/^ /, '');

      switch (field) {
        case 'event':
          event = value;
          break;
        case 'data':
          dataLines.push(value);
          break;
        case 'id':
          if (!value.includes('\0')) {
            id = value;
            this.lastEventId = value;
          }
          break;
        case 'retry':
          const n = parseInt(value, 10);
          if (!isNaN(n)) retry = n;
          break;
      }
    }

    // No data lines means this wasn't a real event (e.g., just a comment)
    if (dataLines.length === 0) return null;

    return {
      event,
      data: dataLines.join('\n'),
      id: id ?? this.lastEventId || undefined,
      retry,
    };
  }
}
```

### 2.3 Typed Event Dispatcher

Converts raw SSE frames into typed `StreamEvent` objects and routes them to handlers.

```typescript
// streaming/event-dispatcher.ts

type StreamEventHandler = (event: StreamEvent) => void | Promise<void>;

export class StreamEventDispatcher {
  private handlers: Map<string, StreamEventHandler[]> = new Map();
  private sequence: number = 0;
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /** Register a handler for a specific event type, or '*' for all events */
  on(eventType: string | '*', handler: StreamEventHandler): void {
    const existing = this.handlers.get(eventType) || [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  /** Parse an SSE frame and dispatch to registered handlers */
  async dispatch(frame: SseFrame): Promise<void> {
    let parsed: any;
    try {
      parsed = JSON.parse(frame.data);
    } catch {
      // Non-JSON data frames (e.g., ping) -- skip
      return;
    }

    const event: StreamEvent = {
      ...parsed,
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      sequence: this.sequence++,
    };

    // Dispatch to specific handlers
    const specific = this.handlers.get(event.type) || [];
    for (const handler of specific) {
      await handler(event);
    }

    // Dispatch to wildcard handlers
    const wildcard = this.handlers.get('*') || [];
    for (const handler of wildcard) {
      await handler(event);
    }
  }
}
```

### 2.4 Markdown-Aware Stream Buffer

Never break a code block mid-render. Tracks fence depth and only flushes at safe boundaries.

```typescript
// streaming/markdown-buffer.ts

export class MarkdownStreamBuffer {
  private pending: string = '';
  private fenceDepth: number = 0;
  private onFlush: (rendered: string) => void;

  constructor(onFlush: (rendered: string) => void) {
    this.onFlush = onFlush;
  }

  /**
   * Push a delta from a message_delta event.
   * May trigger zero or more flush() calls with safe-to-render chunks.
   */
  push(delta: string): void {
    this.pending += delta;
    this.updateFenceDepth(delta);

    // Inside a code fence -- buffer everything, render nothing
    if (this.fenceDepth > 0) {
      return;
    }

    // Outside fences -- look for safe paragraph boundaries
    this.flushAtSafeBoundary();
  }

  /**
   * Force-flush everything remaining. Call when the stream ends
   * (message_stop received).
   */
  finish(): void {
    if (this.pending.length > 0) {
      this.onFlush(this.pending);
      this.pending = '';
    }
    this.fenceDepth = 0;
  }

  private updateFenceDepth(delta: string): void {
    // Count fence markers (``` or ~~~) in the new delta
    // We need to scan the full pending buffer because a fence
    // marker might span two deltas (e.g., "``" + "`\n")
    const fencePattern = /^(`{3,}|~{3,})/gm;
    let totalFences = 0;
    let match: RegExpExecArray | null;
    while ((match = fencePattern.exec(this.pending)) !== null) {
      totalFences++;
    }
    // Odd number means we're inside a fence, even means outside
    this.fenceDepth = totalFences % 2;
  }

  private flushAtSafeBoundary(): void {
    // Find the last paragraph break (double newline) in pending
    const lastBreak = this.pending.lastIndexOf('\n\n');
    if (lastBreak === -1) {
      return; // No safe boundary yet -- keep buffering
    }

    const safeChunk = this.pending.slice(0, lastBreak + 2);
    this.pending = this.pending.slice(lastBreak + 2);

    // Verify no unclosed fence in the safe chunk
    const fences = (safeChunk.match(/^(`{3,}|~{3,})/gm) || []).length;
    if (fences % 2 !== 0) {
      // Fence opened but not closed in this chunk -- put it back
      this.pending = safeChunk + this.pending;
      return;
    }

    this.onFlush(safeChunk);
  }
}
```

### 2.5 Integrated Stream Pipeline

Wire the parser, dispatcher, and buffer together into a single pipeline.

```typescript
// streaming/stream-pipeline.ts

import { SseParser } from './sse-parser';
import { StreamEventDispatcher } from './event-dispatcher';
import { MarkdownStreamBuffer } from './markdown-buffer';
import { EventLogger } from '../logging/event-logger';

export class StreamPipeline {
  private parser: SseParser;
  private dispatcher: StreamEventDispatcher;
  private markdownBuffer: MarkdownStreamBuffer;
  private logger: EventLogger;
  private turnStartTime: number = 0;

  constructor(
    sessionId: string,
    logger: EventLogger,
    onRender: (markdown: string) => void,
  ) {
    this.parser = new SseParser();
    this.dispatcher = new StreamEventDispatcher(sessionId);
    this.markdownBuffer = new MarkdownStreamBuffer(onRender);
    this.logger = logger;

    this.wireHandlers();
  }

  private wireHandlers(): void {
    // Log all events to the system event logger
    this.dispatcher.on('*', (event) => {
      this.logger.log({
        category: this.eventCategoryMap(event.type),
        severity: event.type === 'permission_denial' ? 'warn' : 'info',
        title: event.type,
        detail: event,
      });
    });

    // Route message deltas to the markdown buffer
    this.dispatcher.on('message_delta', (event) => {
      const delta = event as MessageDeltaEvent;
      this.markdownBuffer.push(delta.delta);
    });

    // Record turn start time
    this.dispatcher.on('message_start', () => {
      this.turnStartTime = Date.now();
    });

    // Flush markdown buffer on stop
    this.dispatcher.on('message_stop', () => {
      this.markdownBuffer.finish();
    });
  }

  /** Feed raw SSE bytes/text from the network */
  async processChunk(chunk: string): Promise<void> {
    const frames = this.parser.push(chunk);
    for (const frame of frames) {
      await this.dispatcher.dispatch(frame);
    }
  }

  /** Signal end of stream */
  async finish(): Promise<void> {
    const frames = this.parser.finish();
    for (const frame of frames) {
      await this.dispatcher.dispatch(frame);
    }
    this.markdownBuffer.finish();
  }

  private eventCategoryMap(type: string): string {
    const map: Record<string, string> = {
      message_start: 'stream',
      tool_match: 'tool_selection',
      permission_denial: 'permission',
      message_delta: 'stream',
      message_stop: 'turn_complete',
      tool_execution: 'execution',
    };
    return map[type] || 'unknown';
  }
}
```

---

## 3. System Event Logging (Primitive #7)

### 3.1 Design Principles

The source architecture has a three-layer system. We preserve the same structure but add what was identified as missing in the gap analysis:

| What Claude Code Has | What We Add |
|---------------------|-------------|
| `HistoryEvent(title, detail)` -- no timestamp | `timestamp: string` (ISO 8601, ms precision) |
| No severity | `severity: 'debug' \| 'info' \| 'warn' \| 'error' \| 'critical'` |
| No event IDs | `event_id: string` (UUID for cross-subsystem correlation) |
| No durable persistence separate from session | Supabase persistence with `type='system_event'` |
| No event filtering | Query by category, severity, time range, session |
| Transcript compaction destroys history | Compacted events archived before deletion |

### 3.2 Event Types and Categories

```typescript
// logging/types.ts

/** Severity levels -- ascending order of importance */
export type Severity = 'debug' | 'info' | 'warn' | 'error' | 'critical';

/** Event categories matching the lifecycle phases identified in source analysis */
export type EventCategory =
  | 'initialization'     // boot sequence, context discovery
  | 'registry'           // command/tool registry load
  | 'tool_selection'     // routing, tool matching
  | 'permission'         // permission checks, denials, approvals
  | 'execution'          // tool/command execution
  | 'stream'             // streaming events (deltas, start/stop)
  | 'turn_complete'      // end of LLM turn
  | 'session'            // session save/load/resume
  | 'compaction'         // transcript compaction
  | 'usage'              // token accounting, cost tracking
  | 'error'              // errors and failures
  | 'hook'               // pre/post tool hooks
  | 'verification';      // verification harness results

/** Immutable event record */
export interface SystemEvent {
  event_id: string;           // UUID v4
  timestamp: string;          // ISO 8601 with ms
  session_id: string;
  category: EventCategory;
  severity: Severity;
  title: string;              // short label, human-scannable (max 80 chars)
  detail: Record<string, any>; // structured payload
  sequence: number;           // monotonic within session
}
```

### 3.3 HistoryLog (Append-Only Session Journal)

```typescript
// logging/history-log.ts

import { v4 as uuidv4 } from 'uuid';
import { SystemEvent, EventCategory, Severity } from './types';

export class HistoryLog {
  private events: SystemEvent[] = [];
  private sequence: number = 0;
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /** Append an event. Events are immutable after creation. */
  add(
    category: EventCategory,
    severity: Severity,
    title: string,
    detail: Record<string, any> = {},
  ): SystemEvent {
    const event: SystemEvent = {
      event_id: uuidv4(),
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      category,
      severity,
      title,
      detail,
      sequence: this.sequence++,
    };

    // Freeze to enforce immutability
    Object.freeze(event);
    this.events.push(event);

    return event;
  }

  /** Get all events, optionally filtered */
  query(filters?: {
    category?: EventCategory;
    severity?: Severity;
    since?: string;
    limit?: number;
  }): SystemEvent[] {
    let result = [...this.events];

    if (filters?.category) {
      result = result.filter(e => e.category === filters.category);
    }
    if (filters?.severity) {
      const levels: Severity[] = ['debug', 'info', 'warn', 'error', 'critical'];
      const minLevel = levels.indexOf(filters.severity);
      result = result.filter(e => levels.indexOf(e.severity) >= minLevel);
    }
    if (filters?.since) {
      result = result.filter(e => e.timestamp >= filters.since);
    }
    if (filters?.limit) {
      result = result.slice(-filters.limit);
    }

    return result;
  }

  /** Render as human-readable markdown for diagnostic output */
  asMarkdown(): string {
    const lines: string[] = ['# Session Event Log', ''];
    const severityIcon: Record<Severity, string> = {
      debug: 'DBG',
      info: 'INF',
      warn: 'WRN',
      error: 'ERR',
      critical: 'CRT',
    };

    for (const event of this.events) {
      const time = event.timestamp.split('T')[1]?.replace('Z', '') || event.timestamp;
      const icon = severityIcon[event.severity];
      const detailStr = Object.keys(event.detail).length > 0
        ? ` | ${JSON.stringify(event.detail)}`
        : '';
      lines.push(`[${time}] [${icon}] [${event.category}] ${event.title}${detailStr}`);
    }

    return lines.join('\n');
  }

  /** Get raw event array for persistence */
  getEvents(): ReadonlyArray<SystemEvent> {
    return this.events;
  }

  /** Event count */
  get size(): number {
    return this.events.length;
  }
}
```

### 3.4 TranscriptStore (Compactable Shadow)

```typescript
// logging/transcript-store.ts

interface TranscriptMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export class TranscriptStore {
  private messages: TranscriptMessage[] = [];
  private compactedArchive: TranscriptMessage[] = []; // preserve what compaction removes
  private flushed: boolean = false;

  /** Append a message to the transcript */
  append(message: TranscriptMessage): void {
    this.messages.push(message);
    this.flushed = false;
  }

  /**
   * Compact the transcript, keeping only the last N messages.
   * Removed messages are archived (not destroyed -- this is our improvement
   * over the source architecture).
   */
  compact(keepLast: number): { removedCount: number } {
    if (this.messages.length <= keepLast) {
      return { removedCount: 0 };
    }

    const removeCount = this.messages.length - keepLast;
    const removed = this.messages.splice(0, removeCount);

    // Archive removed messages instead of destroying them
    this.compactedArchive.push(...removed);
    this.flushed = false;

    return { removedCount: removeCount };
  }

  /** Replay the current (non-compacted) messages */
  replay(): ReadonlyArray<TranscriptMessage> {
    return [...this.messages];
  }

  /** Get archived (compacted) messages for persistence */
  getArchive(): ReadonlyArray<TranscriptMessage> {
    return [...this.compactedArchive];
  }

  /** Mark as flushed (persisted to storage) */
  markFlushed(): void {
    this.flushed = true;
  }

  /** Check if there are unflushed changes */
  isDirty(): boolean {
    return !this.flushed;
  }

  get size(): number {
    return this.messages.length;
  }

  get archiveSize(): number {
    return this.compactedArchive.length;
  }
}
```

### 3.5 EventLogger (Unified Logging Facade)

Combines HistoryLog, TranscriptStore, and Supabase persistence into a single interface.

```typescript
// logging/event-logger.ts

import { HistoryLog } from './history-log';
import { TranscriptStore } from './transcript-store';
import { SystemEvent, EventCategory, Severity } from './types';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

interface LogEntry {
  category: EventCategory;
  severity: Severity;
  title: string;
  detail: Record<string, any>;
}

export class EventLogger {
  private historyLog: HistoryLog;
  private transcript: TranscriptStore;
  private supabase: SupabaseClient;
  private flushBuffer: SystemEvent[] = [];
  private flushIntervalMs: number = 5000;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private minPersistSeverity: Severity = 'info'; // don't persist debug by default

  constructor(
    sessionId: string,
    supabaseUrl: string,
    supabaseKey: string,
    options?: {
      flushIntervalMs?: number;
      minPersistSeverity?: Severity;
    },
  ) {
    this.historyLog = new HistoryLog(sessionId);
    this.transcript = new TranscriptStore();
    this.supabase = createClient(supabaseUrl, supabaseKey);

    if (options?.flushIntervalMs) this.flushIntervalMs = options.flushIntervalMs;
    if (options?.minPersistSeverity) this.minPersistSeverity = options.minPersistSeverity;

    this.startPeriodicFlush();
  }

  /** Log a system event */
  log(entry: LogEntry): SystemEvent {
    const event = this.historyLog.add(
      entry.category,
      entry.severity,
      entry.title,
      entry.detail,
    );

    // Buffer for Supabase persistence if severity >= threshold
    const levels: Severity[] = ['debug', 'info', 'warn', 'error', 'critical'];
    if (levels.indexOf(entry.severity) >= levels.indexOf(this.minPersistSeverity)) {
      this.flushBuffer.push(event);
    }

    return event;
  }

  /** Convenience methods for common severity levels */
  debug(category: EventCategory, title: string, detail: Record<string, any> = {}): SystemEvent {
    return this.log({ category, severity: 'debug', title, detail });
  }

  info(category: EventCategory, title: string, detail: Record<string, any> = {}): SystemEvent {
    return this.log({ category, severity: 'info', title, detail });
  }

  warn(category: EventCategory, title: string, detail: Record<string, any> = {}): SystemEvent {
    return this.log({ category, severity: 'warn', title, detail });
  }

  error(category: EventCategory, title: string, detail: Record<string, any> = {}): SystemEvent {
    return this.log({ category, severity: 'error', title, detail });
  }

  critical(category: EventCategory, title: string, detail: Record<string, any> = {}): SystemEvent {
    return this.log({ category, severity: 'critical', title, detail });
  }

  /** Get the history log for diagnostic output */
  getHistoryLog(): HistoryLog {
    return this.historyLog;
  }

  /** Get the transcript store */
  getTranscript(): TranscriptStore {
    return this.transcript;
  }

  /** Flush buffered events to Supabase */
  async flush(): Promise<{ persisted: number; errors: number }> {
    if (this.flushBuffer.length === 0) {
      return { persisted: 0, errors: 0 };
    }

    const batch = [...this.flushBuffer];
    this.flushBuffer = [];

    // Insert into dedicated system_events table
    const { error: eventsError } = await this.supabase
      .from('system_events')
      .insert(batch.map(event => ({
        event_id: event.event_id,
        session_id: event.session_id,
        category: event.category,
        severity: event.severity,
        title: event.title,
        detail: event.detail,
        sequence: event.sequence,
        created_at: event.timestamp,
      })));

    // Also insert a summary into the thoughts table for semantic search
    if (batch.some(e => e.severity === 'warn' || e.severity === 'error' || e.severity === 'critical')) {
      const significantEvents = batch.filter(
        e => e.severity === 'warn' || e.severity === 'error' || e.severity === 'critical',
      );
      const summary = significantEvents
        .map(e => `[${e.severity}] ${e.category}: ${e.title}`)
        .join('\n');

      await this.supabase.from('thoughts').insert({
        content: summary,
        metadata: {
          type: 'system_event',
          session_id: batch[0].session_id,
          event_count: significantEvents.length,
          categories: [...new Set(significantEvents.map(e => e.category))],
          severities: [...new Set(significantEvents.map(e => e.severity))],
          first_timestamp: significantEvents[0].timestamp,
          last_timestamp: significantEvents[significantEvents.length - 1].timestamp,
        },
      });
    }

    if (eventsError) {
      console.error('Failed to persist system events:', eventsError);
      // Put failed events back in buffer for retry
      this.flushBuffer.unshift(...batch);
      return { persisted: 0, errors: batch.length };
    }

    return { persisted: batch.length, errors: 0 };
  }

  /** Shut down the logger, flushing all remaining events */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  private startPeriodicFlush(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(err => {
        console.error('Periodic flush failed:', err);
      });
    }, this.flushIntervalMs);
  }
}
```

### 3.6 Lifecycle Emission Points

The following lifecycle boundaries should emit events. This mirrors the 6 emission points found in the source architecture, extended with our additions:

```typescript
// Example: how event logging integrates into a session lifecycle

async function bootstrapSession(sessionId: string, prompt: string): Promise<void> {
  const logger = new EventLogger(sessionId, SUPABASE_URL, SUPABASE_KEY);

  // 1. Context/workspace discovery complete
  logger.info('initialization', 'workspace_discovered', {
    project_files: context.fileCount,
    archive_available: context.hasArchive,
    runtime_mode: 'local',
  });

  // 2. Registry load complete
  logger.info('registry', 'registries_loaded', {
    commands: COMMANDS.length,
    tools: TOOLS.length,
    mcp_servers: MCP_SERVERS.length,
  });

  // 3. Prompt routing complete
  const matches = await router.match(prompt);
  logger.info('tool_selection', 'routing_complete', {
    matches: matches.length,
    prompt_preview: prompt.slice(0, 100),
  });

  // 4. Permission checks
  for (const denied of deniedTools) {
    logger.warn('permission', 'tool_denied', {
      tool_name: denied.toolName,
      reason: denied.reason,
      was_destructive: denied.isDestructive,
    });
  }

  // 5. Turn complete
  logger.info('turn_complete', 'turn_finished', {
    stop_reason: result.stopReason,
    input_tokens: result.usage.inputTokens,
    output_tokens: result.usage.outputTokens,
    cost_cents: result.usage.costCents,
  });

  // 6. Session persistence
  logger.info('session', 'session_saved', {
    path: sessionPath,
    event_count: logger.getHistoryLog().size,
    transcript_size: logger.getTranscript().size,
  });

  await logger.shutdown();
}
```

---

## 4. Verification Harness (Primitive #8)

### 4.1 Design

The verification harness runs invariant tests against the system's behavior, using logged events as evidence. It validates that security properties hold, outputs conform to schemas, and error handling is correct.

### 4.2 Invariant Definitions

```typescript
// verification/invariants.ts

import { SystemEvent } from '../logging/types';

export type InvariantResult = {
  name: string;
  passed: boolean;
  message: string;
  evidence: SystemEvent[];  // events that prove/disprove the invariant
  severity: 'blocking' | 'warning' | 'info';
};

export type Invariant = {
  name: string;
  description: string;
  severity: 'blocking' | 'warning' | 'info';
  check: (events: SystemEvent[]) => InvariantResult;
};
```

### 4.3 Core Invariants

```typescript
// verification/core-invariants.ts

import { Invariant, InvariantResult } from './invariants';
import { SystemEvent } from '../logging/types';

/**
 * INVARIANT 1: Destructive tools ALWAYS require approval.
 *
 * Any tool_execution event where requires_approval=true must have
 * approval_status='approved' or 'denied'. Never 'auto_approved'.
 */
export const destructiveToolsRequireApproval: Invariant = {
  name: 'destructive_tools_require_approval',
  description: 'Destructive tools must never be auto-approved. They always require explicit user or policy approval.',
  severity: 'blocking',
  check: (events: SystemEvent[]): InvariantResult => {
    const violations: SystemEvent[] = [];

    const toolExecutions = events.filter(
      e => e.category === 'execution' && e.detail?.requires_approval === true,
    );

    for (const event of toolExecutions) {
      if (event.detail?.approval_status === 'auto_approved') {
        violations.push(event);
      }
    }

    return {
      name: 'destructive_tools_require_approval',
      passed: violations.length === 0,
      message: violations.length === 0
        ? `All ${toolExecutions.length} destructive tool executions required approval.`
        : `${violations.length} destructive tool(s) were auto-approved without user consent.`,
      evidence: violations,
      severity: 'blocking',
    };
  },
};

/**
 * INVARIANT 2: Denied tools NEVER execute.
 *
 * If a permission_denial event exists for a tool, no subsequent
 * tool_execution event for that tool should exist in the same turn.
 */
export const deniedToolsNeverExecute: Invariant = {
  name: 'denied_tools_never_execute',
  description: 'A tool that was denied by the permission system must never have a corresponding execution event.',
  severity: 'blocking',
  check: (events: SystemEvent[]): InvariantResult => {
    const violations: SystemEvent[] = [];

    const denials = events.filter(e => e.category === 'permission' && e.title === 'tool_denied');
    const deniedToolNames = new Set(denials.map(e => e.detail?.tool_name));

    const executions = events.filter(e => e.category === 'execution');

    for (const exec of executions) {
      if (deniedToolNames.has(exec.detail?.tool_name)) {
        violations.push(exec);
      }
    }

    return {
      name: 'denied_tools_never_execute',
      passed: violations.length === 0,
      message: violations.length === 0
        ? `No denied tools were executed. ${denials.length} denial(s) enforced.`
        : `${violations.length} denied tool(s) executed despite permission denial.`,
      evidence: violations,
      severity: 'blocking',
    };
  },
};

/**
 * INVARIANT 3: Budget exhaustion produces graceful stop.
 *
 * If any event indicates budget exhaustion (cost tracking), the session
 * must end with stop_reason='budget_exhausted', not an error or crash.
 */
export const budgetExhaustionGracefulStop: Invariant = {
  name: 'budget_exhaustion_graceful_stop',
  description: 'When token budget is exhausted, the system must stop gracefully with a clear stop_reason, not crash.',
  severity: 'blocking',
  check: (events: SystemEvent[]): InvariantResult => {
    const budgetEvents = events.filter(
      e => e.category === 'usage' && e.detail?.budget_remaining !== undefined && e.detail.budget_remaining <= 0,
    );

    if (budgetEvents.length === 0) {
      return {
        name: 'budget_exhaustion_graceful_stop',
        passed: true,
        message: 'No budget exhaustion events detected (budget was not exceeded).',
        evidence: [],
        severity: 'blocking',
      };
    }

    // Find the final message_stop event
    const stopEvents = events.filter(
      e => e.title === 'message_stop' || e.detail?.stop_reason,
    );
    const lastStop = stopEvents[stopEvents.length - 1];

    if (!lastStop) {
      return {
        name: 'budget_exhaustion_graceful_stop',
        passed: false,
        message: 'Budget was exhausted but no message_stop event was found. Session may have crashed.',
        evidence: budgetEvents,
        severity: 'blocking',
      };
    }

    const graceful = lastStop.detail?.stop_reason === 'budget_exhausted';

    return {
      name: 'budget_exhaustion_graceful_stop',
      passed: graceful,
      message: graceful
        ? 'Budget exhaustion produced graceful stop with stop_reason=budget_exhausted.'
        : `Budget exhausted but stop_reason was '${lastStop.detail?.stop_reason}' instead of 'budget_exhausted'.`,
      evidence: graceful ? [] : [lastStop, ...budgetEvents],
      severity: 'blocking',
    };
  },
};

/**
 * INVARIANT 4: Structured outputs validate against schema.
 *
 * Every tool_execution event with a structured output must have
 * schema_valid=true in its detail.
 */
export const structuredOutputsValidateSchema: Invariant = {
  name: 'structured_outputs_validate_schema',
  description: 'All structured outputs from tool executions must validate against their declared schema.',
  severity: 'blocking',
  check: (events: SystemEvent[]): InvariantResult => {
    const violations: SystemEvent[] = [];

    const executions = events.filter(
      e => e.category === 'execution' && e.detail?.has_structured_output === true,
    );

    for (const exec of executions) {
      if (exec.detail?.schema_valid !== true) {
        violations.push(exec);
      }
    }

    return {
      name: 'structured_outputs_validate_schema',
      passed: violations.length === 0,
      message: violations.length === 0
        ? `All ${executions.length} structured outputs validated against schema.`
        : `${violations.length} structured output(s) failed schema validation.`,
      evidence: violations,
      severity: 'blocking',
    };
  },
};

/**
 * INVARIANT 5: Every response is bracketed by start/stop events.
 *
 * For every message_start, there must be a corresponding message_stop.
 * No orphaned starts or stops.
 */
export const responsesBracketed: Invariant = {
  name: 'responses_bracketed',
  description: 'Every message_start must have a corresponding message_stop. No orphaned events.',
  severity: 'warning',
  check: (events: SystemEvent[]): InvariantResult => {
    const starts = events.filter(e => e.title === 'message_start');
    const stops = events.filter(e => e.title === 'message_stop');

    const orphanedStarts = starts.length - stops.length;

    return {
      name: 'responses_bracketed',
      passed: orphanedStarts === 0,
      message: orphanedStarts === 0
        ? `All ${starts.length} responses properly bracketed with start/stop.`
        : `${Math.abs(orphanedStarts)} response(s) missing ${orphanedStarts > 0 ? 'stop' : 'start'} event.`,
      evidence: orphanedStarts > 0 ? starts.slice(-orphanedStarts) : [],
      severity: 'warning',
    };
  },
};

/**
 * INVARIANT 6: No events logged after session shutdown.
 *
 * The session_saved event must be the last significant event (ignoring debug).
 */
export const noEventsAfterShutdown: Invariant = {
  name: 'no_events_after_shutdown',
  description: 'No events should be logged after session persistence. Indicates lifecycle violation.',
  severity: 'warning',
  check: (events: SystemEvent[]): InvariantResult => {
    const sessionSaved = events.findIndex(
      e => e.category === 'session' && e.title === 'session_saved',
    );

    if (sessionSaved === -1) {
      return {
        name: 'no_events_after_shutdown',
        passed: true,
        message: 'No session_saved event found (session may still be active).',
        evidence: [],
        severity: 'warning',
      };
    }

    const afterShutdown = events
      .slice(sessionSaved + 1)
      .filter(e => e.severity !== 'debug');

    return {
      name: 'no_events_after_shutdown',
      passed: afterShutdown.length === 0,
      message: afterShutdown.length === 0
        ? 'No significant events after session shutdown.'
        : `${afterShutdown.length} event(s) logged after session shutdown.`,
      evidence: afterShutdown,
      severity: 'warning',
    };
  },
};

/** All core invariants as a single exportable array */
export const CORE_INVARIANTS: Invariant[] = [
  destructiveToolsRequireApproval,
  deniedToolsNeverExecute,
  budgetExhaustionGracefulStop,
  structuredOutputsValidateSchema,
  responsesBracketed,
  noEventsAfterShutdown,
];
```

### 4.4 Verification Runner

```typescript
// verification/runner.ts

import { Invariant, InvariantResult } from './invariants';
import { SystemEvent } from '../logging/types';
import { CORE_INVARIANTS } from './core-invariants';
import { EventLogger } from '../logging/event-logger';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type VerificationReport = {
  run_id: string;
  timestamp: string;
  session_id: string;
  trigger: VerificationTrigger;
  total_invariants: number;
  passed: number;
  failed: number;
  warnings: number;
  results: InvariantResult[];
  overall_verdict: 'pass' | 'fail' | 'warn';
};

export type VerificationTrigger =
  | 'prompt_change'     // system prompt was modified
  | 'model_swap'        // LLM model was changed
  | 'tool_change'       // tool registry was modified
  | 'routing_change'    // routing logic was updated
  | 'manual'            // developer-triggered
  | 'post_session'      // automatic after session end
  | 'scheduled';        // periodic health check

export class VerificationRunner {
  private invariants: Invariant[];
  private supabase: SupabaseClient;

  constructor(
    supabaseUrl: string,
    supabaseKey: string,
    customInvariants?: Invariant[],
  ) {
    this.invariants = [...CORE_INVARIANTS, ...(customInvariants || [])];
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /** Run all invariants against a set of events */
  async run(
    sessionId: string,
    events: SystemEvent[],
    trigger: VerificationTrigger,
  ): Promise<VerificationReport> {
    const results: InvariantResult[] = [];

    for (const invariant of this.invariants) {
      try {
        const result = invariant.check(events);
        results.push(result);
      } catch (error) {
        results.push({
          name: invariant.name,
          passed: false,
          message: `Invariant check threw an error: ${error instanceof Error ? error.message : String(error)}`,
          evidence: [],
          severity: invariant.severity,
        });
      }
    }

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed && r.severity === 'blocking').length;
    const warnings = results.filter(r => !r.passed && r.severity !== 'blocking').length;

    const report: VerificationReport = {
      run_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      trigger,
      total_invariants: results.length,
      passed,
      failed,
      warnings,
      results,
      overall_verdict: failed > 0 ? 'fail' : warnings > 0 ? 'warn' : 'pass',
    };

    // Persist verification results to OB1
    await this.persistReport(report);

    return report;
  }

  /** Load events from Supabase for a given session and run verification */
  async runForSession(
    sessionId: string,
    trigger: VerificationTrigger,
  ): Promise<VerificationReport> {
    const { data: events, error } = await this.supabase
      .from('system_events')
      .select('*')
      .eq('session_id', sessionId)
      .order('sequence', { ascending: true });

    if (error) {
      throw new Error(`Failed to load events for session ${sessionId}: ${error.message}`);
    }

    return this.run(sessionId, events || [], trigger);
  }

  private async persistReport(report: VerificationReport): Promise<void> {
    // Store in dedicated verification_runs table
    const { error: runError } = await this.supabase
      .from('verification_runs')
      .insert({
        run_id: report.run_id,
        session_id: report.session_id,
        trigger: report.trigger,
        verdict: report.overall_verdict,
        passed: report.passed,
        failed: report.failed,
        warnings: report.warnings,
        results: report.results,
        created_at: report.timestamp,
      });

    if (runError) {
      console.error('Failed to persist verification report:', runError);
    }

    // Also store significant failures as thoughts for semantic search
    const failures = report.results.filter(r => !r.passed && r.severity === 'blocking');
    if (failures.length > 0) {
      const summary = failures
        .map(f => `INVARIANT VIOLATION: ${f.name} -- ${f.message}`)
        .join('\n');

      await this.supabase.from('thoughts').insert({
        content: summary,
        metadata: {
          type: 'verification_failure',
          run_id: report.run_id,
          session_id: report.session_id,
          trigger: report.trigger,
          failed_invariants: failures.map(f => f.name),
          verdict: report.overall_verdict,
        },
      });
    }
  }
}
```

### 4.5 Change-Triggered Verification

The harness runs automatically when specific changes are detected:

```typescript
// verification/triggers.ts

import { VerificationRunner, VerificationTrigger } from './runner';

/**
 * Hook into system change points to trigger verification.
 * These correspond to the trigger conditions specified in the primitive:
 * - prompt changes
 * - model swaps
 * - tool changes
 * - routing logic changes
 */
export class VerificationTriggerManager {
  private runner: VerificationRunner;
  private lastPromptHash: string = '';
  private lastModel: string = '';
  private lastToolSet: string = '';
  private lastRoutingHash: string = '';

  constructor(runner: VerificationRunner) {
    this.runner = runner;
  }

  /** Call after each session to check if verification should run */
  async checkAndRun(
    sessionId: string,
    events: any[],
    currentState: {
      promptHash: string;
      model: string;
      toolSetHash: string;
      routingHash: string;
    },
  ): Promise<void> {
    const triggers: VerificationTrigger[] = [];

    if (currentState.promptHash !== this.lastPromptHash && this.lastPromptHash !== '') {
      triggers.push('prompt_change');
    }
    if (currentState.model !== this.lastModel && this.lastModel !== '') {
      triggers.push('model_swap');
    }
    if (currentState.toolSetHash !== this.lastToolSet && this.lastToolSet !== '') {
      triggers.push('tool_change');
    }
    if (currentState.routingHash !== this.lastRoutingHash && this.lastRoutingHash !== '') {
      triggers.push('routing_change');
    }

    // Update state
    this.lastPromptHash = currentState.promptHash;
    this.lastModel = currentState.model;
    this.lastToolSet = currentState.toolSetHash;
    this.lastRoutingHash = currentState.routingHash;

    // Run for each detected trigger
    for (const trigger of triggers) {
      const report = await this.runner.run(sessionId, events, trigger);
      if (report.overall_verdict === 'fail') {
        console.error(
          `VERIFICATION FAILED [${trigger}]: ${report.failed} blocking invariant(s) violated.`,
        );
        // In production, this could: send alerts, block deployment, etc.
      }
    }

    // Always run post_session verification
    await this.runner.run(sessionId, events, 'post_session');
  }
}
```

---

## 5. Cross-Primitive Dependencies

### 5.1 Dependency Chain

The ops-analyst identified a clear dependency chain across operational primitives:

```
System Event Logging (#7)
  |
  +-- Streaming Events (#6) feed into logging
  |     Stream events are automatically logged via StreamPipeline.wireHandlers()
  |     Every stream event (message_start, tool_match, permission_denial,
  |     message_delta, message_stop) generates a corresponding SystemEvent
  |
  +-- Staged Boot (#13) emits to logging (future primitive)
  |     Each boot phase completion -> EventLogger.info('initialization', ...)
  |     Setup report -> stream event (message_start)
  |     Deferred init status -> structured event payload
  |
  +-- Doctor Pattern (#12) validates logging output (future primitive)
        Event history reveals what went wrong during boot
        Usage tracking reveals cost anomalies
        Transcript store reveals conversation state integrity

Verification Harness (#8) validates both:
  |
  +-- Validates streaming: responses bracketed, no orphaned events
  +-- Validates logging: no events after shutdown, lifecycle ordering
  +-- Validates permissions: denied tools never execute, destructive require approval
  +-- Validates budgets: graceful stop on exhaustion
```

### 5.2 How Streaming Events Feed Into Logging

The `StreamPipeline` class (Section 2.5) wires a wildcard handler that logs every stream event:

```
SSE Chunk -> SseParser -> SseFrame -> StreamEventDispatcher
                                          |
                                          +-> handler: EventLogger.log({
                                                category: mapped_from_event_type,
                                                severity: 'info' (or 'warn' for denials),
                                                title: event.type,
                                                detail: full_event_payload,
                                              })
```

This means the `system_events` table contains a complete record of the streaming lifecycle, queryable by category, severity, and time range.

### 5.3 How Verification Validates Both

The verification harness consumes `SystemEvent[]` arrays that contain entries from both sources:

- **Stream-originated events** have categories: `stream`, `tool_selection`, `permission`, `turn_complete`, `execution`
- **Logging-originated events** have categories: `initialization`, `registry`, `session`, `compaction`, `usage`

Invariants span both. For example:
- `deniedToolsNeverExecute` correlates `permission` events (from streaming) with `execution` events
- `responsesBracketed` checks `stream` events for proper start/stop pairing
- `noEventsAfterShutdown` checks `session` events (from logging) against all subsequent events

---

## 6. OB1 Integration

### 6.1 Database Schema

Run in the Supabase SQL Editor. This creates two new tables without modifying the core `thoughts` table.

```sql
-- ============================================================
-- System Events Table
-- High-throughput, append-only storage for all system events.
-- Separate from thoughts to avoid polluting semantic search
-- with operational noise.
-- ============================================================

CREATE TABLE system_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id      UUID NOT NULL UNIQUE,
  session_id    TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN (
    'initialization', 'registry', 'tool_selection', 'permission',
    'execution', 'stream', 'turn_complete', 'session',
    'compaction', 'usage', 'error', 'hook', 'verification'
  )),
  severity      TEXT NOT NULL CHECK (severity IN (
    'debug', 'info', 'warn', 'error', 'critical'
  )),
  title         TEXT NOT NULL,
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
  sequence      INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying events by session (the most common access pattern)
CREATE INDEX idx_system_events_session
  ON system_events (session_id, sequence);

-- Index for filtering by category and severity
CREATE INDEX idx_system_events_category_severity
  ON system_events (category, severity, created_at DESC);

-- Index for time-range queries (operational dashboards)
CREATE INDEX idx_system_events_created_at
  ON system_events (created_at DESC);

-- Partial index for high-severity events (alerts, debugging)
CREATE INDEX idx_system_events_high_severity
  ON system_events (created_at DESC)
  WHERE severity IN ('warn', 'error', 'critical');

-- GIN index on detail JSONB for flexible querying
CREATE INDEX idx_system_events_detail
  ON system_events USING GIN (detail);

-- ============================================================
-- Verification Runs Table
-- Stores the results of each verification harness execution.
-- ============================================================

CREATE TABLE verification_runs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        UUID NOT NULL UNIQUE,
  session_id    TEXT NOT NULL,
  trigger       TEXT NOT NULL CHECK (trigger IN (
    'prompt_change', 'model_swap', 'tool_change',
    'routing_change', 'manual', 'post_session', 'scheduled'
  )),
  verdict       TEXT NOT NULL CHECK (verdict IN ('pass', 'fail', 'warn')),
  passed        INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  warnings      INTEGER NOT NULL DEFAULT 0,
  results       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying verification runs by session
CREATE INDEX idx_verification_runs_session
  ON verification_runs (session_id, created_at DESC);

-- Index for finding failures across all sessions
CREATE INDEX idx_verification_runs_verdict
  ON verification_runs (verdict, created_at DESC)
  WHERE verdict IN ('fail', 'warn');

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE system_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on system_events"
  ON system_events
  FOR ALL
  USING (auth.role() = 'service_role');

ALTER TABLE verification_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on verification_runs"
  ON verification_runs
  FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================
-- Grants (required on newer Supabase projects)
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.system_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.verification_runs TO service_role;

-- ============================================================
-- Real-time subscriptions
-- Enable real-time for system_events so dashboards can
-- subscribe to live event streams.
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE system_events;

-- ============================================================
-- Cleanup function: purge events older than retention period
-- Run via pg_cron or Supabase scheduled function.
-- Does NOT use unqualified DELETE -- always scoped by date.
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_old_system_events(
  retention_days INTEGER DEFAULT 30
)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM system_events
  WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL
    AND severity NOT IN ('error', 'critical');

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Aggregation view: session summary from events
-- Useful for dashboards and operational monitoring.
-- ============================================================

CREATE OR REPLACE VIEW session_event_summary AS
SELECT
  session_id,
  COUNT(*) AS total_events,
  COUNT(*) FILTER (WHERE severity = 'error') AS error_count,
  COUNT(*) FILTER (WHERE severity = 'critical') AS critical_count,
  COUNT(*) FILTER (WHERE severity = 'warn') AS warn_count,
  COUNT(*) FILTER (WHERE category = 'permission') AS permission_events,
  COUNT(*) FILTER (WHERE category = 'execution') AS execution_events,
  MIN(created_at) AS session_start,
  MAX(created_at) AS session_end,
  MAX(created_at) - MIN(created_at) AS session_duration,
  ARRAY_AGG(DISTINCT category) AS categories_seen
FROM system_events
GROUP BY session_id;

GRANT SELECT ON session_event_summary TO service_role;
```

### 6.2 Edge Function: Streaming Endpoint

A Supabase Edge Function that acts as a streaming proxy, applying the SSE parsing and event logging pipeline.

```typescript
// supabase/functions/agent-stream/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ACCESS_KEY = Deno.env.get('OB1_ACCESS_KEY')!;

serve(async (req: Request) => {
  // Auth check
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${ACCESS_KEY}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { session_id, prompt, model } = await req.json();

  if (!session_id || !prompt) {
    return new Response(
      JSON.stringify({ error: 'session_id and prompt are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const eventBuffer: any[] = [];
  let sequence = 0;

  // Helper to log events to buffer (flushed at end)
  function logEvent(category: string, severity: string, title: string, detail: any = {}) {
    eventBuffer.push({
      event_id: crypto.randomUUID(),
      session_id,
      category,
      severity,
      title,
      detail,
      sequence: sequence++,
      created_at: new Date().toISOString(),
    });
  }

  logEvent('stream', 'info', 'message_start', { model, prompt_length: prompt.length });

  // Create a ReadableStream that proxies the LLM response
  // and injects event logging
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Call the LLM API (example with Anthropic)
        const llmResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: model || 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            stream: true,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (!llmResponse.ok || !llmResponse.body) {
          logEvent('error', 'error', 'llm_request_failed', {
            status: llmResponse.status,
          });
          controller.close();
          return;
        }

        const reader = llmResponse.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let totalOutput = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          sseBuffer += chunk;

          // Parse SSE frames
          let boundary;
          while ((boundary = sseBuffer.indexOf('\n\n')) !== -1) {
            const frame = sseBuffer.slice(0, boundary);
            sseBuffer = sseBuffer.slice(boundary + 2);

            // Extract data field
            const dataMatch = frame.match(/^data: (.+)$/m);
            if (!dataMatch) continue;

            try {
              const data = JSON.parse(dataMatch[1]);

              if (data.type === 'content_block_delta') {
                totalOutput += (data.delta?.text || '').length;
              }

              if (data.type === 'message_stop') {
                logEvent('stream', 'info', 'message_stop', {
                  total_output_chars: totalOutput,
                });
              }
            } catch {
              // Non-JSON data, skip
            }

            // Forward the frame to the client
            const encoded = new TextEncoder().encode(frame + '\n\n');
            controller.enqueue(encoded);
          }
        }

        controller.close();
      } catch (err) {
        logEvent('error', 'error', 'stream_error', {
          message: err instanceof Error ? err.message : String(err),
        });
        controller.close();
      } finally {
        // Flush all buffered events to Supabase
        if (eventBuffer.length > 0) {
          await supabase.from('system_events').insert(eventBuffer);
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});
```

### 6.3 Real-Time Event Monitoring

Clients can subscribe to live events via Supabase Realtime:

```typescript
// monitoring/live-monitor.ts

import { createClient } from '@supabase/supabase-js';

export function startLiveMonitor(
  supabaseUrl: string,
  supabaseKey: string,
  sessionId: string,
  onEvent: (event: any) => void,
): { unsubscribe: () => void } {
  const supabase = createClient(supabaseUrl, supabaseKey);

  const channel = supabase
    .channel(`system_events:${sessionId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'system_events',
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => {
        onEvent(payload.new);
      },
    )
    .subscribe();

  return {
    unsubscribe: () => {
      supabase.removeChannel(channel);
    },
  };
}

// Usage example:
// const monitor = startLiveMonitor(url, key, 'session-123', (event) => {
//   console.log(`[${event.severity}] ${event.category}: ${event.title}`);
// });
// ... later ...
// monitor.unsubscribe();
```

### 6.4 MCP Tool: Query System Events

Expose event querying as an MCP tool so AI clients can introspect their own operational history.

```typescript
// MCP tool definition (for the Edge Function MCP server)

const querySystemEventsTool = {
  name: 'query_system_events',
  description: 'Query system events for a session. Returns operational metadata about what the agent did, not conversation content. Useful for debugging, auditing, and cost analysis.',
  inputSchema: {
    type: 'object',
    properties: {
      session_id: {
        type: 'string',
        description: 'Session ID to query events for. Use "current" for the active session.',
      },
      category: {
        type: 'string',
        enum: [
          'initialization', 'registry', 'tool_selection', 'permission',
          'execution', 'stream', 'turn_complete', 'session',
          'compaction', 'usage', 'error', 'hook', 'verification',
        ],
        description: 'Filter by event category.',
      },
      min_severity: {
        type: 'string',
        enum: ['debug', 'info', 'warn', 'error', 'critical'],
        description: 'Minimum severity level to include. Default: info.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of events to return. Default: 50.',
      },
    },
    required: ['session_id'],
  },
};
```

---

## 7. Implementation Order

### Phase 1: Foundation (Day 1-2)

1. **Run the SQL schema** (Section 6.1) in Supabase SQL Editor
2. **Implement types** (Sections 2.1, 3.2) -- `types/stream-events.ts`, `logging/types.ts`
3. **Implement HistoryLog** (Section 3.3) -- pure in-memory, no external deps
4. **Implement TranscriptStore** (Section 3.4) -- pure in-memory

### Phase 2: Streaming (Day 2-3)

5. **Implement SseParser** (Section 2.2) -- with unit tests for edge cases:
   - Half-frame arrives, remainder in next chunk
   - Multiple frames in a single chunk
   - Multi-line data fields
   - Comment-only frames
6. **Implement MarkdownStreamBuffer** (Section 2.4) -- with tests:
   - Code fence spanning multiple deltas
   - Nested fences
   - Safe boundary detection
7. **Implement StreamEventDispatcher** (Section 2.3)

### Phase 3: Logging Integration (Day 3-4)

8. **Implement EventLogger** (Section 3.5) -- connects to Supabase
9. **Implement StreamPipeline** (Section 2.5) -- wires everything together
10. **Implement lifecycle emission points** (Section 3.6)

### Phase 4: Verification (Day 4-5)

11. **Implement core invariants** (Section 4.3) -- 6 invariants
12. **Implement VerificationRunner** (Section 4.4)
13. **Implement VerificationTriggerManager** (Section 4.5)

### Phase 5: OB1 Deployment (Day 5-6)

14. **Deploy Edge Function** (Section 6.2) via `supabase functions deploy agent-stream`
15. **Set up real-time monitoring** (Section 6.3)
16. **Add MCP tool** (Section 6.4) for event querying

### Phase 6: Validation

17. **Run verification harness against itself** -- bootstrap a test session, emit events at all lifecycle points, run all invariants, confirm pass
18. **Load test the SSE parser** -- feed it randomized chunk sizes
19. **Validate Supabase persistence** -- confirm events appear in `system_events`, summaries in `thoughts`

---

## File Manifest

When implemented, the following files will be created:

```
src/
  types/
    stream-events.ts          # Typed stream event union (Section 2.1)
  streaming/
    sse-parser.ts              # Incremental SSE parser (Section 2.2)
    event-dispatcher.ts        # Typed event dispatch (Section 2.3)
    markdown-buffer.ts         # Fence-aware buffering (Section 2.4)
    stream-pipeline.ts         # Integrated pipeline (Section 2.5)
  logging/
    types.ts                   # Event types and categories (Section 3.2)
    history-log.ts             # Append-only session journal (Section 3.3)
    transcript-store.ts        # Compactable transcript (Section 3.4)
    event-logger.ts            # Unified logging facade (Section 3.5)
  verification/
    invariants.ts              # Invariant type definitions (Section 4.2)
    core-invariants.ts         # 6 core invariants (Section 4.3)
    runner.ts                  # Verification runner (Section 4.4)
    triggers.ts                # Change-triggered verification (Section 4.5)
  monitoring/
    live-monitor.ts            # Real-time event subscription (Section 6.3)

supabase/
  migrations/
    003_system_events.sql      # Database schema (Section 6.1)
  functions/
    agent-stream/
      index.ts                 # Streaming Edge Function (Section 6.2)

tests/
  streaming/
    sse-parser.test.ts
    markdown-buffer.test.ts
    stream-pipeline.test.ts
  logging/
    history-log.test.ts
    event-logger.test.ts
  verification/
    core-invariants.test.ts
    runner.test.ts
```

---

## Appendix: Key Decisions

### Why a separate `system_events` table instead of only `thoughts`?

1. **Volume**: System events are high-frequency (hundreds per session). Mixing them into `thoughts` would pollute semantic search results.
2. **Schema**: Events have structured fields (category, severity, sequence) that benefit from proper columns and indexes. JSONB-only storage in `thoughts.metadata` loses query performance.
3. **Retention**: Events can be purged after 30 days. Thoughts are permanent. Different lifecycle = different table.
4. **Real-time**: We enable Supabase Realtime on `system_events` for live dashboards. Enabling it on `thoughts` would broadcast every captured thought to all subscribers.

We still write **summaries** of significant events (warnings, errors, critical) to `thoughts` with `type='system_event'` so they're discoverable via semantic search ("what went wrong in my session yesterday?").

### Why not use the extracted Rust patterns directly?

The extracted Rust patterns (`SseParser`, `MarkdownStreamState`) are reference implementations. Our TypeScript implementation:
- Preserves the same design (push/finish lifecycle, frame boundary detection, fence depth tracking)
- Adapts to the Deno/Supabase Edge Function runtime
- Adds the missing pieces identified in the gap analysis (timestamps, severity, event IDs, Supabase persistence)

### Why append-only events instead of mutable state?

From the source analysis: "Events are metadata for the operator, not input for the model." Append-only semantics provide:
- Audit trail that cannot be tampered with
- Debugging capability (replay exact sequence of events)
- Verification harness can check temporal ordering invariants
- No lost data from accidental mutation
