# Blueprint 02: State, Workflow & Budget Primitives

> Primitives #3 (Session Persistence), #4 (Workflow State & Idempotency), #5 (Token Budget Tracking)
>
> Status: IMPLEMENTATION BLUEPRINT
> Date: 2026-04-03
> Depends on: OB1 core `thoughts` table (id, content, embedding, metadata, content_fingerprint, created_at, updated_at)

---

## 0. Design Thesis

Claude Code persists sessions as flat JSON files on disk. It has no idempotency keys, no write-ahead log, no mid-turn crash recovery, no USD-based budget stops, and no workflow abstraction above the conversation turn. OB1's Supabase becomes the durable state layer that fills every one of these gaps.

This blueprint adds three companion tables alongside the existing `thoughts` table, plus Edge Function endpoints that expose the full lifecycle. The `thoughts` table itself is NOT modified -- we reference it via foreign keys and use its metadata JSONB for cross-linking.

### Architecture Overview

```
+---------------------------+     +-----------------------------+
|   Agent Runtime (TS/Edge) |     |   OB1 Supabase (Postgres)  |
|                           |     |                             |
|  SessionManager ----------|---->|  agent_sessions             |
|  WorkflowEngine ----------|---->|  workflow_checkpoints        |
|  BudgetTracker ---------- |---->|  budget_ledger              |
|  IdempotencyGuard --------|---->|  workflow_checkpoints.idem_key|
|                           |     |                             |
|  Thought capture ---------|---->|  thoughts (existing)        |
+---------------------------+     +-----------------------------+
```

---

## 1. Supabase Schema

### 1.1 agent_sessions

Stores complete session state. Each row is a point-in-time snapshot of one agent session.

```sql
-- Agent session persistence
-- Does NOT modify the core thoughts table
CREATE TABLE agent_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,               -- human-readable or UUID session identifier
  version INT NOT NULL DEFAULT 1,         -- schema version for future migration
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'completed', 'crashed')),

  -- Core session payload
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,          -- full conversation log
  config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,    -- frozen config at session start
  permission_decisions JSONB NOT NULL DEFAULT '[]'::jsonb, -- persisted permission grants

  -- Embedded usage summary (denormalized for fast reads)
  total_input_tokens BIGINT NOT NULL DEFAULT 0,
  total_output_tokens BIGINT NOT NULL DEFAULT 0,
  total_cache_write_tokens BIGINT NOT NULL DEFAULT 0,
  total_cache_read_tokens BIGINT NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  turn_count INT NOT NULL DEFAULT 0,

  -- Compaction tracking
  compaction_count INT NOT NULL DEFAULT 0,
  last_compaction_at TIMESTAMPTZ,

  -- Lifecycle
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,

  -- Optional link to a thought (for cross-referencing session summaries)
  thought_id UUID REFERENCES thoughts(id)
);

-- Fast lookup by session_id (most common query path)
CREATE INDEX idx_agent_sessions_session_id ON agent_sessions (session_id);

-- Find active/crashed sessions for resume
CREATE INDEX idx_agent_sessions_status ON agent_sessions (status) WHERE status IN ('active', 'crashed');

-- Temporal queries
CREATE INDEX idx_agent_sessions_created ON agent_sessions (created_at DESC);

-- Auto-update timestamp
CREATE TRIGGER agent_sessions_updated_at
  BEFORE UPDATE ON agent_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
  ON agent_sessions
  FOR ALL
  USING (auth.role() = 'service_role');
```

### 1.2 workflow_checkpoints

Every side-effecting step writes a checkpoint BEFORE execution (WAL pattern). On crash recovery, we scan for incomplete checkpoints and know exactly where to resume.

```sql
-- Workflow state machine + write-ahead log
CREATE TABLE workflow_checkpoints (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,              -- links to agent_sessions.session_id
  workflow_id TEXT NOT NULL,             -- groups steps into one logical workflow
  step_index INT NOT NULL,              -- ordinal position in the workflow

  -- State machine
  state TEXT NOT NULL DEFAULT 'planned'
    CHECK (state IN (
      'planned',
      'awaiting_approval',
      'executing',
      'waiting_on_external',
      'completed',
      'failed',
      'skipped'
    )),

  -- What this step does
  step_type TEXT NOT NULL,               -- 'tool_call', 'api_request', 'file_write', 'bash', etc.
  step_description TEXT,                 -- human-readable description
  step_input JSONB NOT NULL DEFAULT '{}'::jsonb,   -- frozen input params
  step_output JSONB,                     -- result (NULL until completed)
  error_detail TEXT,                     -- error message if failed

  -- Idempotency
  idempotency_key TEXT NOT NULL,         -- UUID per invocation, checked before execution
  execution_count INT NOT NULL DEFAULT 0, -- how many times this step has been attempted

  -- Token cost for this step
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  cost_usd NUMERIC(10,6) DEFAULT 0,

  -- Lifecycle
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Prevent double-fire: unique on idempotency_key
  CONSTRAINT uq_idempotency_key UNIQUE (idempotency_key)
);

-- Primary query path: all checkpoints for a workflow, in order
CREATE INDEX idx_wf_checkpoints_workflow ON workflow_checkpoints (workflow_id, step_index);

-- Find incomplete steps for crash recovery
CREATE INDEX idx_wf_checkpoints_incomplete
  ON workflow_checkpoints (session_id, state)
  WHERE state IN ('executing', 'awaiting_approval', 'waiting_on_external');

-- Temporal
CREATE INDEX idx_wf_checkpoints_created ON workflow_checkpoints (created_at DESC);

-- Auto-update timestamp
CREATE TRIGGER wf_checkpoints_updated_at
  BEFORE UPDATE ON workflow_checkpoints
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE workflow_checkpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
  ON workflow_checkpoints
  FOR ALL
  USING (auth.role() = 'service_role');
```

### 1.3 budget_ledger

Append-only ledger of token consumption events. Enables both real-time budget enforcement and historical cost analysis.

```sql
-- Append-only budget tracking ledger
CREATE TABLE budget_ledger (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_number INT NOT NULL,

  -- Four-category token tracking
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  cache_write_tokens INT NOT NULL DEFAULT 0,
  cache_read_tokens INT NOT NULL DEFAULT 0,

  -- USD cost for this entry
  cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  model TEXT,                             -- model used for this turn

  -- Budget config snapshot at time of entry
  max_turns INT,
  max_budget_tokens BIGINT,
  max_budget_usd NUMERIC(10,4),

  -- Running totals (denormalized for O(1) budget checks)
  cumulative_input_tokens BIGINT NOT NULL DEFAULT 0,
  cumulative_output_tokens BIGINT NOT NULL DEFAULT 0,
  cumulative_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  cumulative_turns INT NOT NULL DEFAULT 0,

  -- Stop reason if this turn triggered a stop
  stop_reason TEXT
    CHECK (stop_reason IS NULL OR stop_reason IN (
      'completed',
      'max_turns_reached',
      'max_budget_tokens_reached',
      'max_budget_usd_reached',
      'auto_compacted',
      'user_stopped',
      'error'
    )),

  -- Compaction events
  compaction_triggered BOOLEAN NOT NULL DEFAULT false,
  compaction_messages_removed INT DEFAULT 0,
  consecutive_compaction_failures INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Primary query: latest entry for a session (for cumulative reads)
CREATE INDEX idx_budget_ledger_session ON budget_ledger (session_id, turn_number DESC);

-- Cost analysis queries
CREATE INDEX idx_budget_ledger_created ON budget_ledger (created_at DESC);

-- RLS
ALTER TABLE budget_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
  ON budget_ledger
  FOR ALL
  USING (auth.role() = 'service_role');
```

### 1.4 Cross-Referencing with thoughts

The existing `thoughts` table is not modified. Instead, we use its `metadata` JSONB to link thoughts to sessions and workflows:

```sql
-- When capturing a thought that originated from an agent session,
-- include session context in the metadata:
--
-- INSERT INTO thoughts (content, metadata) VALUES (
--   'The user wants to refactor the auth module',
--   '{
--     "type": "session_insight",
--     "session_id": "ses_abc123",
--     "workflow_id": "wf_xyz789",
--     "source": "agent_session",
--     "topics": ["refactoring", "auth"]
--   }'
-- );
--
-- The agent_sessions.thought_id FK allows the reverse link:
-- given a session, find its summary thought.
```

---

## 2. Session Persistence (Primitive #3)

### 2.1 Session Data Model

```typescript
// types/session.ts

interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ContentBlock[];
  usage?: TokenUsage;           // embedded per-message
  timestamp: string;            // ISO 8601
  tool_use_id?: string;         // correlation ID for tool_use -> tool_result
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: unknown;
  is_error?: boolean;
}

interface PermissionDecision {
  tool_name: string;
  decision: 'allow' | 'deny';
  reason?: string;
  granted_at: string;
  scope: 'turn' | 'session';     // persist session-scoped grants
}

interface SessionSnapshot {
  session_id: string;
  version: number;                // schema version, currently 1
  status: 'active' | 'suspended' | 'completed' | 'crashed';
  messages: ConversationMessage[];
  config_snapshot: Record<string, unknown>;
  permission_decisions: PermissionDecision[];

  // Denormalized usage totals
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_write_tokens: number;
  total_cache_read_tokens: number;
  total_cost_usd: number;
  turn_count: number;

  // Compaction state
  compaction_count: number;
  last_compaction_at?: string;
}
```

### 2.2 SessionManager Implementation

```typescript
// lib/session-manager.ts

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

export class SessionManager {
  private snapshot: SessionSnapshot;
  private dirty: boolean = false;
  private saveDebounceMs: number = 500;
  private saveTimer: number | null = null;

  constructor(sessionId?: string) {
    this.snapshot = {
      session_id: sessionId ?? crypto.randomUUID(),
      version: 1,
      status: 'active',
      messages: [],
      config_snapshot: {},
      permission_decisions: [],
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cache_write_tokens: 0,
      total_cache_read_tokens: 0,
      total_cost_usd: 0,
      turn_count: 0,
      compaction_count: 0,
    };
  }

  // --- Lifecycle ---

  /** Create a new session and persist the initial state */
  async create(config: Record<string, unknown>): Promise<string> {
    this.snapshot.config_snapshot = config;
    await this.persistToSupabase();
    return this.snapshot.session_id;
  }

  /** Resume an existing session from Supabase */
  static async resume(sessionId: string): Promise<SessionManager> {
    const { data, error } = await supabase
      .from('agent_sessions')
      .select('*')
      .eq('session_id', sessionId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      throw new Error(`Session not found: ${sessionId}. ${error?.message ?? ''}`);
    }

    const mgr = new SessionManager(sessionId);
    mgr.snapshot = {
      session_id: data.session_id,
      version: data.version,
      status: data.status,
      messages: data.messages as ConversationMessage[],
      config_snapshot: data.config_snapshot,
      permission_decisions: data.permission_decisions as PermissionDecision[],
      total_input_tokens: data.total_input_tokens,
      total_output_tokens: data.total_output_tokens,
      total_cache_write_tokens: data.total_cache_write_tokens,
      total_cache_read_tokens: data.total_cache_read_tokens,
      total_cost_usd: Number(data.total_cost_usd),
      turn_count: data.turn_count,
      compaction_count: data.compaction_count,
      last_compaction_at: data.last_compaction_at,
    };

    // Mark as active on resume
    if (mgr.snapshot.status === 'crashed' || mgr.snapshot.status === 'suspended') {
      mgr.snapshot.status = 'active';
      await mgr.persistToSupabase();
    }

    return mgr;
  }

  // --- Message Operations ---

  /** Append a message and schedule a save */
  appendMessage(msg: ConversationMessage): void {
    this.snapshot.messages.push(msg);

    if (msg.usage) {
      this.snapshot.total_input_tokens += msg.usage.input_tokens;
      this.snapshot.total_output_tokens += msg.usage.output_tokens;
      this.snapshot.total_cache_write_tokens += msg.usage.cache_creation_input_tokens;
      this.snapshot.total_cache_read_tokens += msg.usage.cache_read_input_tokens;
    }

    if (msg.role === 'assistant') {
      this.snapshot.turn_count++;
    }

    this.markDirty();
  }

  /** Record a permission decision that persists across the session */
  recordPermission(decision: PermissionDecision): void {
    // Deduplicate: replace existing decision for same tool + scope
    this.snapshot.permission_decisions = this.snapshot.permission_decisions.filter(
      d => !(d.tool_name === decision.tool_name && d.scope === decision.scope)
    );
    this.snapshot.permission_decisions.push(decision);
    this.markDirty();
  }

  /** Check if a tool has a persisted permission grant */
  hasPermission(toolName: string): PermissionDecision | undefined {
    return this.snapshot.permission_decisions.find(
      d => d.tool_name === toolName && d.decision === 'allow'
    );
  }

  // --- Save Operations ---

  /** Mark state as dirty and schedule debounced save */
  private markDirty(): void {
    this.dirty = true;
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => this.flush(), this.saveDebounceMs);
  }

  /** Force immediate save (call after significant events) */
  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty) return;
    await this.persistToSupabase();
    this.dirty = false;
  }

  /** Complete the session */
  async complete(): Promise<void> {
    this.snapshot.status = 'completed';
    this.snapshot.completed_at = new Date().toISOString();
    await this.persistToSupabase();
  }

  /** Mark as crashed (call from error handler / shutdown hook) */
  async markCrashed(): Promise<void> {
    this.snapshot.status = 'crashed';
    this.dirty = true;
    await this.flush();
  }

  private async persistToSupabase(): Promise<void> {
    const row = {
      session_id: this.snapshot.session_id,
      version: this.snapshot.version,
      status: this.snapshot.status,
      messages: this.snapshot.messages,
      config_snapshot: this.snapshot.config_snapshot,
      permission_decisions: this.snapshot.permission_decisions,
      total_input_tokens: this.snapshot.total_input_tokens,
      total_output_tokens: this.snapshot.total_output_tokens,
      total_cache_write_tokens: this.snapshot.total_cache_write_tokens,
      total_cache_read_tokens: this.snapshot.total_cache_read_tokens,
      total_cost_usd: this.snapshot.total_cost_usd,
      turn_count: this.snapshot.turn_count,
      compaction_count: this.snapshot.compaction_count,
      last_compaction_at: this.snapshot.last_compaction_at ?? null,
      completed_at: this.snapshot.completed_at ?? null,
    };

    const { error } = await supabase
      .from('agent_sessions')
      .upsert(row, { onConflict: 'session_id' });

    if (error) {
      console.error('Session persist failed:', error.message);
      throw error;
    }
  }

  // --- Accessors ---

  get sessionId(): string { return this.snapshot.session_id; }
  get messages(): ConversationMessage[] { return this.snapshot.messages; }
  get status(): string { return this.snapshot.status; }
  get usage() {
    return {
      input_tokens: this.snapshot.total_input_tokens,
      output_tokens: this.snapshot.total_output_tokens,
      cache_write_tokens: this.snapshot.total_cache_write_tokens,
      cache_read_tokens: this.snapshot.total_cache_read_tokens,
      cost_usd: this.snapshot.total_cost_usd,
      turns: this.snapshot.turn_count,
    };
  }

  /** Reconstruct a UsageTracker-equivalent from persisted messages */
  reconstructUsage(): {
    perTurn: TokenUsage[];
    cumulative: TokenUsage;
    turns: number;
  } {
    const perTurn: TokenUsage[] = [];
    const cumulative: TokenUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };

    for (const msg of this.snapshot.messages) {
      if (msg.usage) {
        perTurn.push(msg.usage);
        cumulative.input_tokens += msg.usage.input_tokens;
        cumulative.output_tokens += msg.usage.output_tokens;
        cumulative.cache_creation_input_tokens += msg.usage.cache_creation_input_tokens;
        cumulative.cache_read_input_tokens += msg.usage.cache_read_input_tokens;
      }
    }

    return { perTurn, cumulative, turns: perTurn.length };
  }
}
```

### 2.3 Save Triggers

Save after every significant event, not just shutdown:

| Event                     | Save Strategy              |
|---------------------------|----------------------------|
| Session created           | Immediate                  |
| User message appended     | Debounced (500ms)          |
| Assistant message received| Immediate                  |
| Tool result appended      | Immediate                  |
| Permission decision       | Debounced (500ms)          |
| Auto-compaction fired     | Immediate                  |
| Session completed         | Immediate                  |
| Process signal (SIGTERM)  | Immediate (`markCrashed`)  |

### 2.4 Session Resume Flow

```
resumeSession(sessionId)
  |
  +--> Load agent_sessions row from Supabase
  |
  +--> Reconstruct UsageTracker from embedded message usage
  |
  +--> Restore permission decisions (session-scoped grants survive restart)
  |
  +--> Check workflow_checkpoints for incomplete steps (crash recovery)
  |      |
  |      +--> If found: enter WorkflowEngine crash recovery (Section 3.4)
  |
  +--> Set status = 'active'
  |
  +--> Return fully hydrated SessionManager
```

---

## 3. Workflow State & Idempotency (Primitive #4)

This is entirely new. Claude Code does not have workflow state, idempotency keys, WAL, or crash recovery. We build all of it.

### 3.1 State Machine

```
                     +-------------------+
                     |      planned      |
                     +-------------------+
                              |
                    (approval required?)
                     /                \
                   yes                 no
                   /                    \
    +---------------------+    +-------------------+
    | awaiting_approval   |    |     executing     |
    +---------------------+    +-------------------+
              |                        |
         (approved)              (side effect
              |                   completes)
              v                        |
    +-------------------+              |
    |     executing     |--------------+
    +-------------------+              |
              |                        |
     (needs external         (success)  (failure)
      response?)              /              \
         yes                 /                \
          |     +-----------------+    +----------+
          v     |    completed    |    |  failed  |
    +---------------------+-----+    +----------+
    | waiting_on_external |                |
    +---------------------+           (retry?)
              |                        /    \
         (response                   yes     no
          received)                  /        \
              |            (back to          +----------+
              v             planned)         |  skipped |
    +-------------------+                    +----------+
    |     executing     |
    +-------------------+
```

### 3.2 WorkflowEngine Implementation

```typescript
// lib/workflow-engine.ts

interface WorkflowStep {
  step_index: number;
  step_type: string;             // 'tool_call' | 'api_request' | 'file_write' | 'bash' | ...
  step_description: string;
  step_input: Record<string, unknown>;
  requires_approval: boolean;
  idempotency_key: string;       // generated UUID
}

interface WorkflowPlan {
  workflow_id: string;
  session_id: string;
  steps: WorkflowStep[];
}

export class WorkflowEngine {
  private sessionId: string;
  private workflowId: string;

  constructor(sessionId: string, workflowId?: string) {
    this.sessionId = sessionId;
    this.workflowId = workflowId ?? `wf_${crypto.randomUUID()}`;
  }

  // --- Planning Phase ---

  /** Register a workflow plan: write all steps as 'planned' checkpoints */
  async planWorkflow(steps: Omit<WorkflowStep, 'idempotency_key'>[]): Promise<WorkflowPlan> {
    const fullSteps: WorkflowStep[] = steps.map(s => ({
      ...s,
      idempotency_key: `idem_${this.workflowId}_${s.step_index}_${crypto.randomUUID()}`,
    }));

    // Batch insert all planned steps
    const rows = fullSteps.map(s => ({
      session_id: this.sessionId,
      workflow_id: this.workflowId,
      step_index: s.step_index,
      state: s.requires_approval ? 'awaiting_approval' : 'planned',
      step_type: s.step_type,
      step_description: s.step_description,
      step_input: s.step_input,
      idempotency_key: s.idempotency_key,
    }));

    const { error } = await supabase
      .from('workflow_checkpoints')
      .insert(rows);

    if (error) throw new Error(`Failed to plan workflow: ${error.message}`);

    return {
      workflow_id: this.workflowId,
      session_id: this.sessionId,
      steps: fullSteps,
    };
  }

  // --- Execution Phase ---

  /**
   * Execute the next step in the workflow.
   * Implements the WAL pattern:
   *   1. Write checkpoint state = 'executing' BEFORE the side effect
   *   2. Perform the side effect
   *   3. Write checkpoint state = 'completed' with output AFTER success
   *   4. On failure: write state = 'failed' with error detail
   */
  async executeNextStep(
    executor: (step: WorkflowStep) => Promise<unknown>
  ): Promise<{ step_index: number; state: string; output?: unknown } | null> {

    // Find next executable step
    const { data: nextStep, error: findErr } = await supabase
      .from('workflow_checkpoints')
      .select('*')
      .eq('workflow_id', this.workflowId)
      .in('state', ['planned'])
      .order('step_index', { ascending: true })
      .limit(1)
      .single();

    if (findErr || !nextStep) return null; // no more steps

    // --- IDEMPOTENCY CHECK ---
    // If a step with this idempotency_key already completed, skip it
    const { data: existing } = await supabase
      .from('workflow_checkpoints')
      .select('id, state, step_output')
      .eq('idempotency_key', nextStep.idempotency_key)
      .eq('state', 'completed')
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Already completed -- return cached result (idempotent)
      return {
        step_index: nextStep.step_index,
        state: 'completed',
        output: existing.step_output,
      };
    }

    // --- WAL WRITE: Mark as executing BEFORE the side effect ---
    const { error: walErr } = await supabase
      .from('workflow_checkpoints')
      .update({
        state: 'executing',
        started_at: new Date().toISOString(),
        execution_count: nextStep.execution_count + 1,
      })
      .eq('id', nextStep.id);

    if (walErr) throw new Error(`WAL write failed: ${walErr.message}`);

    // --- EXECUTE THE SIDE EFFECT ---
    try {
      const step: WorkflowStep = {
        step_index: nextStep.step_index,
        step_type: nextStep.step_type,
        step_description: nextStep.step_description,
        step_input: nextStep.step_input,
        requires_approval: false, // already past approval
        idempotency_key: nextStep.idempotency_key,
      };

      const output = await executor(step);

      // --- WAL COMMIT: Mark completed with output ---
      await supabase
        .from('workflow_checkpoints')
        .update({
          state: 'completed',
          step_output: output as Record<string, unknown>,
          completed_at: new Date().toISOString(),
        })
        .eq('id', nextStep.id);

      return { step_index: nextStep.step_index, state: 'completed', output };

    } catch (err) {
      // --- WAL FAIL: Mark failed with error ---
      const errorMsg = err instanceof Error ? err.message : String(err);
      await supabase
        .from('workflow_checkpoints')
        .update({
          state: 'failed',
          error_detail: errorMsg,
          completed_at: new Date().toISOString(),
        })
        .eq('id', nextStep.id);

      return { step_index: nextStep.step_index, state: 'failed', output: { error: errorMsg } };
    }
  }

  // --- Approval Flow ---

  /** Approve a step that is awaiting_approval, moving it to planned */
  async approveStep(stepIndex: number): Promise<void> {
    const { error } = await supabase
      .from('workflow_checkpoints')
      .update({ state: 'planned' })
      .eq('workflow_id', this.workflowId)
      .eq('step_index', stepIndex)
      .eq('state', 'awaiting_approval');

    if (error) throw new Error(`Approval failed: ${error.message}`);
  }

  /** Deny a step, moving it to skipped */
  async denyStep(stepIndex: number, reason: string): Promise<void> {
    const { error } = await supabase
      .from('workflow_checkpoints')
      .update({
        state: 'skipped',
        error_detail: `Denied: ${reason}`,
        completed_at: new Date().toISOString(),
      })
      .eq('workflow_id', this.workflowId)
      .eq('step_index', stepIndex)
      .eq('state', 'awaiting_approval');

    if (error) throw new Error(`Deny failed: ${error.message}`);
  }

  // --- Query ---

  /** Get full workflow state */
  async getWorkflowState(): Promise<{
    workflow_id: string;
    steps: Array<{ step_index: number; state: string; step_type: string; step_description: string }>;
    progress: { total: number; completed: number; failed: number; pending: number };
  }> {
    const { data: steps, error } = await supabase
      .from('workflow_checkpoints')
      .select('step_index, state, step_type, step_description')
      .eq('workflow_id', this.workflowId)
      .order('step_index', { ascending: true });

    if (error) throw new Error(`Query failed: ${error.message}`);

    const total = steps?.length ?? 0;
    const completed = steps?.filter(s => s.state === 'completed').length ?? 0;
    const failed = steps?.filter(s => s.state === 'failed').length ?? 0;

    return {
      workflow_id: this.workflowId,
      steps: steps ?? [],
      progress: { total, completed, failed, pending: total - completed - failed },
    };
  }
}
```

### 3.3 Idempotency Key Design

```
Format:  idem_{workflow_id}_{step_index}_{uuid}

Example: idem_wf_a1b2c3d4_003_f47ac10b-58cc-4372-a567-0e02b2c3d479
```

The `idempotency_key` has a UNIQUE constraint in the database. This means:

1. **First attempt**: INSERT succeeds, step executes.
2. **Retry after crash**: SELECT finds the existing row. If `state = 'completed'`, return cached output. If `state = 'executing'` (process died mid-execution), increment `execution_count` and re-execute.
3. **Double-fire prevention**: Two concurrent attempts to execute the same step will serialize on the unique constraint. The second attempt sees the first's result.

### 3.4 Crash Recovery Protocol

When `resumeSession()` detects a session with `status = 'crashed'`:

```typescript
// lib/crash-recovery.ts

export async function recoverCrashedWorkflows(sessionId: string): Promise<{
  recovered: number;
  requeued: number;
  abandoned: number;
}> {
  let recovered = 0, requeued = 0, abandoned = 0;

  // Find all steps that were 'executing' when the crash happened
  const { data: stuckSteps } = await supabase
    .from('workflow_checkpoints')
    .select('*')
    .eq('session_id', sessionId)
    .eq('state', 'executing');

  for (const step of stuckSteps ?? []) {
    if (step.execution_count >= 3) {
      // Too many retries -- mark as failed
      await supabase
        .from('workflow_checkpoints')
        .update({
          state: 'failed',
          error_detail: `Abandoned after ${step.execution_count} attempts (crash recovery)`,
          completed_at: new Date().toISOString(),
        })
        .eq('id', step.id);
      abandoned++;
    } else {
      // Requeue for retry
      await supabase
        .from('workflow_checkpoints')
        .update({ state: 'planned' })
        .eq('id', step.id);
      requeued++;
    }
  }

  // Also find 'waiting_on_external' steps -- these are safe, just re-check
  const { data: waitingSteps } = await supabase
    .from('workflow_checkpoints')
    .select('id')
    .eq('session_id', sessionId)
    .eq('state', 'waiting_on_external');

  recovered = (waitingSteps?.length ?? 0);
  // These stay in waiting_on_external -- the external system will respond

  return { recovered, requeued, abandoned };
}
```

### 3.5 Task State vs Conversation State

This is a critical architectural separation:

| Dimension          | Conversation State (Session)        | Task State (Workflow)               |
|--------------------|-------------------------------------|-------------------------------------|
| **Persistence**    | `agent_sessions` table              | `workflow_checkpoints` table        |
| **Unit**           | Message                             | Step                                |
| **Lifecycle**      | Append-only (with compaction)       | State machine transitions           |
| **Survives compaction?** | No -- old messages summarized | Yes -- workflow state is independent|
| **Idempotent?**    | No                                  | Yes (idempotency keys)              |
| **Crash recovery** | Resume from last saved messages     | Resume from last completed step     |
| **Purpose**        | What was said                       | What was done                       |

The workflow tracks what the agent has *accomplished*. The conversation tracks what was *communicated*. When auto-compaction removes old messages, the workflow checkpoints remain intact, so the agent always knows what work is done even if the conversation summary is lossy.

---

## 4. Token Budget Tracking (Primitive #5)

### 4.1 Budget Configuration

```typescript
// types/budget.ts

interface BudgetConfig {
  max_turns: number;                  // hard cap on conversation turns (default: 50)
  max_budget_tokens: number;          // total token ceiling (default: 1_000_000)
  max_budget_usd: number | null;      // USD hard stop -- NEW, Claude Code lacks this
  compact_after_tokens: number;       // auto-compaction threshold (default: 200_000)
  compact_preserve_recent: number;    // messages to keep after compaction (default: 4)
  max_consecutive_compact_failures: number; // NEW (default: 3)
}

const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  max_turns: 50,
  max_budget_tokens: 1_000_000,
  max_budget_usd: null,             // null = no USD limit
  compact_after_tokens: 200_000,
  compact_preserve_recent: 4,
  max_consecutive_compact_failures: 3,
};
```

### 4.2 Model Pricing Table

```typescript
// lib/pricing.ts

interface ModelPricing {
  input_per_million: number;
  output_per_million: number;
  cache_write_per_million: number;
  cache_read_per_million: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  haiku: {
    input_per_million: 1.00,
    output_per_million: 5.00,
    cache_write_per_million: 1.25,
    cache_read_per_million: 0.10,
  },
  sonnet: {
    input_per_million: 3.00,
    output_per_million: 15.00,
    cache_write_per_million: 3.75,
    cache_read_per_million: 0.30,
  },
  opus: {
    input_per_million: 15.00,
    output_per_million: 75.00,
    cache_write_per_million: 18.75,
    cache_read_per_million: 1.50,
  },
};

export function pricingForModel(model: string): ModelPricing {
  const normalized = model.toLowerCase();
  if (normalized.includes('haiku')) return MODEL_PRICING.haiku;
  if (normalized.includes('opus')) return MODEL_PRICING.opus;
  if (normalized.includes('sonnet')) return MODEL_PRICING.sonnet;
  // Default to sonnet pricing when unknown
  return MODEL_PRICING.sonnet;
}

export function computeCostUsd(usage: TokenUsage, pricing: ModelPricing): number {
  return (
    (usage.input_tokens * pricing.input_per_million) / 1_000_000 +
    (usage.output_tokens * pricing.output_per_million) / 1_000_000 +
    (usage.cache_creation_input_tokens * pricing.cache_write_per_million) / 1_000_000 +
    (usage.cache_read_input_tokens * pricing.cache_read_per_million) / 1_000_000
  );
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}
```

### 4.3 BudgetTracker Implementation

```typescript
// lib/budget-tracker.ts

type StopReason =
  | 'completed'
  | 'max_turns_reached'
  | 'max_budget_tokens_reached'
  | 'max_budget_usd_reached'
  | 'auto_compacted'
  | 'user_stopped'
  | 'error';

interface BudgetStatus {
  turns_used: number;
  turns_remaining: number | null;        // null if unlimited
  tokens_used: number;
  tokens_remaining: number | null;
  cost_usd: number;
  cost_remaining_usd: number | null;     // null if no USD limit
  budget_percent: number;                // 0-100 based on most constraining limit
  should_compact: boolean;
  stop_reason: StopReason | null;        // null = can continue
}

interface PreTurnCheckResult {
  can_proceed: boolean;
  stop_reason: StopReason | null;
  budget_status: BudgetStatus;
}

export class BudgetTracker {
  private config: BudgetConfig;
  private model: string;
  private pricing: ModelPricing;
  private sessionId: string;

  // Running state
  private cumulative: TokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  private turnCount: number = 0;
  private cumulativeCostUsd: number = 0;
  private consecutiveCompactFailures: number = 0;

  constructor(sessionId: string, config: BudgetConfig, model: string) {
    this.sessionId = sessionId;
    this.config = config;
    this.model = model;
    this.pricing = pricingForModel(model);
  }

  /** Restore state from a resumed session */
  static fromSession(
    sessionId: string,
    config: BudgetConfig,
    model: string,
    messages: ConversationMessage[]
  ): BudgetTracker {
    const tracker = new BudgetTracker(sessionId, config, model);

    for (const msg of messages) {
      if (msg.usage) {
        tracker.cumulative.input_tokens += msg.usage.input_tokens;
        tracker.cumulative.output_tokens += msg.usage.output_tokens;
        tracker.cumulative.cache_creation_input_tokens += msg.usage.cache_creation_input_tokens;
        tracker.cumulative.cache_read_input_tokens += msg.usage.cache_read_input_tokens;
        tracker.turnCount++;
      }
    }

    tracker.cumulativeCostUsd = computeCostUsd(tracker.cumulative, tracker.pricing);
    return tracker;
  }

  // --- Pre-Turn Check (CRITICAL: runs BEFORE the API call) ---

  /**
   * Check budget BEFORE making an API call.
   * This is the key difference from naive implementations that check AFTER.
   * If this returns can_proceed=false, do NOT call the API.
   */
  preTurnCheck(): PreTurnCheckResult {
    const status = this.getStatus();

    // Check 1: Turn limit
    if (this.turnCount >= this.config.max_turns) {
      return {
        can_proceed: false,
        stop_reason: 'max_turns_reached',
        budget_status: { ...status, stop_reason: 'max_turns_reached' },
      };
    }

    // Check 2: Token budget
    const totalTokens = this.cumulative.input_tokens + this.cumulative.output_tokens;
    if (totalTokens >= this.config.max_budget_tokens) {
      return {
        can_proceed: false,
        stop_reason: 'max_budget_tokens_reached',
        budget_status: { ...status, stop_reason: 'max_budget_tokens_reached' },
      };
    }

    // Check 3: USD budget (NEW -- Claude Code does not have this)
    if (this.config.max_budget_usd !== null && this.cumulativeCostUsd >= this.config.max_budget_usd) {
      return {
        can_proceed: false,
        stop_reason: 'max_budget_usd_reached',
        budget_status: { ...status, stop_reason: 'max_budget_usd_reached' },
      };
    }

    return {
      can_proceed: true,
      stop_reason: null,
      budget_status: status,
    };
  }

  // --- Post-Turn Recording ---

  /** Record usage after a turn completes. Persists to budget_ledger. */
  async recordTurn(usage: TokenUsage): Promise<{
    stop_reason: StopReason | null;
    compaction_needed: boolean;
  }> {
    // Update running state
    this.cumulative.input_tokens += usage.input_tokens;
    this.cumulative.output_tokens += usage.output_tokens;
    this.cumulative.cache_creation_input_tokens += usage.cache_creation_input_tokens;
    this.cumulative.cache_read_input_tokens += usage.cache_read_input_tokens;
    this.turnCount++;

    const turnCostUsd = computeCostUsd(usage, this.pricing);
    this.cumulativeCostUsd += turnCostUsd;

    // Determine if we should stop after this turn
    let stopReason: StopReason | null = null;
    const totalTokens = this.cumulative.input_tokens + this.cumulative.output_tokens;

    if (this.turnCount >= this.config.max_turns) {
      stopReason = 'max_turns_reached';
    } else if (totalTokens >= this.config.max_budget_tokens) {
      stopReason = 'max_budget_tokens_reached';
    } else if (this.config.max_budget_usd !== null && this.cumulativeCostUsd >= this.config.max_budget_usd) {
      stopReason = 'max_budget_usd_reached';
    }

    // Check compaction threshold
    const compactionNeeded = this.cumulative.input_tokens >= this.config.compact_after_tokens;

    // Persist to ledger
    await this.persistToLedger(usage, turnCostUsd, stopReason, compactionNeeded);

    return { stop_reason: stopReason, compaction_needed: compactionNeeded };
  }

  /** Record a compaction event outcome */
  recordCompactionResult(success: boolean, messagesRemoved: number): void {
    if (success && messagesRemoved > 0) {
      this.consecutiveCompactFailures = 0;
    } else {
      this.consecutiveCompactFailures++;
    }
  }

  /** Should we attempt auto-compaction? */
  shouldCompact(): boolean {
    if (this.consecutiveCompactFailures >= this.config.max_consecutive_compact_failures) {
      return false; // Stop trying after MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES
    }
    return this.cumulative.input_tokens >= this.config.compact_after_tokens;
  }

  // --- Status ---

  getStatus(): BudgetStatus {
    const totalTokens = this.cumulative.input_tokens + this.cumulative.output_tokens;
    const turnsRemaining = this.config.max_turns - this.turnCount;
    const tokensRemaining = this.config.max_budget_tokens - totalTokens;
    const costRemaining = this.config.max_budget_usd !== null
      ? this.config.max_budget_usd - this.cumulativeCostUsd
      : null;

    // Budget percent based on the most constraining limit
    const turnPercent = (this.turnCount / this.config.max_turns) * 100;
    const tokenPercent = (totalTokens / this.config.max_budget_tokens) * 100;
    const usdPercent = this.config.max_budget_usd !== null
      ? (this.cumulativeCostUsd / this.config.max_budget_usd) * 100
      : 0;
    const budgetPercent = Math.max(turnPercent, tokenPercent, usdPercent);

    return {
      turns_used: this.turnCount,
      turns_remaining: turnsRemaining > 0 ? turnsRemaining : 0,
      tokens_used: totalTokens,
      tokens_remaining: tokensRemaining > 0 ? tokensRemaining : 0,
      cost_usd: this.cumulativeCostUsd,
      cost_remaining_usd: costRemaining !== null ? Math.max(0, costRemaining) : null,
      budget_percent: Math.min(100, budgetPercent),
      should_compact: this.shouldCompact(),
      stop_reason: null,
    };
  }

  /** Format status for streaming to user */
  toStreamingEvent(): Record<string, unknown> {
    const status = this.getStatus();
    return {
      type: 'budget_status',
      turns: `${status.turns_used}/${this.config.max_turns}`,
      tokens: `${status.tokens_used.toLocaleString()}/${this.config.max_budget_tokens.toLocaleString()}`,
      cost: formatUsd(status.cost_usd),
      cost_limit: this.config.max_budget_usd !== null ? formatUsd(this.config.max_budget_usd) : 'unlimited',
      budget_percent: Math.round(status.budget_percent),
      compaction_status: this.shouldCompact()
        ? `pending (failures: ${this.consecutiveCompactFailures}/${this.config.max_consecutive_compact_failures})`
        : 'ok',
    };
  }

  // --- Persistence ---

  private async persistToLedger(
    usage: TokenUsage,
    costUsd: number,
    stopReason: StopReason | null,
    compactionTriggered: boolean,
  ): Promise<void> {
    const row = {
      session_id: this.sessionId,
      turn_number: this.turnCount,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_write_tokens: usage.cache_creation_input_tokens,
      cache_read_tokens: usage.cache_read_input_tokens,
      cost_usd: costUsd,
      model: this.model,
      max_turns: this.config.max_turns,
      max_budget_tokens: this.config.max_budget_tokens,
      max_budget_usd: this.config.max_budget_usd,
      cumulative_input_tokens: this.cumulative.input_tokens,
      cumulative_output_tokens: this.cumulative.output_tokens,
      cumulative_cost_usd: this.cumulativeCostUsd,
      cumulative_turns: this.turnCount,
      stop_reason: stopReason,
      compaction_triggered: compactionTriggered,
      consecutive_compaction_failures: this.consecutiveCompactFailures,
    };

    const { error } = await supabase
      .from('budget_ledger')
      .insert(row);

    if (error) {
      console.error('Budget ledger write failed:', error.message);
      // Non-fatal: budget tracking is observability, not a hard gate
    }
  }
}
```

### 4.4 Auto-Compaction with Failure Counting

Claude Code's auto-compaction has no failure counter. We add `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`:

```typescript
// lib/auto-compaction.ts

interface CompactionResult {
  success: boolean;
  messages_removed: number;
  summary_text: string;
}

export async function performAutoCompaction(
  session: SessionManager,
  budgetTracker: BudgetTracker,
  preserveRecent: number = 4,
): Promise<CompactionResult | null> {
  if (!budgetTracker.shouldCompact()) {
    return null; // Either below threshold or too many consecutive failures
  }

  const messages = session.messages;
  if (messages.length <= preserveRecent + 1) {
    // Not enough messages to compact
    budgetTracker.recordCompactionResult(false, 0);
    return { success: false, messages_removed: 0, summary_text: '' };
  }

  // Messages to summarize (all except the last `preserveRecent`)
  const toSummarize = messages.slice(0, messages.length - preserveRecent);
  const toKeep = messages.slice(messages.length - preserveRecent);

  // Generate structured summary
  const summary = generateCompactionSummary(toSummarize);

  if (!summary) {
    budgetTracker.recordCompactionResult(false, 0);
    return { success: false, messages_removed: 0, summary_text: '' };
  }

  // Replace session messages: [summary_system_message, ...recent_messages]
  const summaryMessage: ConversationMessage = {
    role: 'system',
    content: [{ type: 'text', text: summary }],
    timestamp: new Date().toISOString(),
  };

  // This mutates the session -- the SessionManager will persist on next flush
  session.replaceMessages([summaryMessage, ...toKeep]);

  const removed = toSummarize.length;
  budgetTracker.recordCompactionResult(true, removed);

  return { success: true, messages_removed: removed, summary_text: summary };
}

function generateCompactionSummary(messages: ConversationMessage[]): string {
  const userMsgs = messages.filter(m => m.role === 'user');
  const assistantMsgs = messages.filter(m => m.role === 'assistant');
  const toolMsgs = messages.filter(m => m.role === 'tool');

  // Extract tool names from tool_use blocks
  const toolNames = new Set<string>();
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'tool_use' && block.tool_name) {
        toolNames.add(block.tool_name);
      }
    }
  }

  // Extract recent user requests (last 3)
  const recentRequests = userMsgs.slice(-3).map(m => {
    const textBlock = m.content.find(b => b.type === 'text');
    return textBlock?.text?.slice(0, 200) ?? '(non-text message)';
  });

  return `<summary>
Conversation summary:
- Scope: ${messages.length} earlier messages compacted (user=${userMsgs.length}, assistant=${assistantMsgs.length}, tool=${toolMsgs.length}).
- Tools mentioned: ${[...toolNames].join(', ') || 'none'}.
- Recent user requests:
${recentRequests.map(r => `  - ${r}`).join('\n')}
- Compacted at: ${new Date().toISOString()}
</summary>`;
}
```

### 4.5 Budget Status in Streaming Events

```typescript
// The turn loop emits budget status events at three points:

// 1. BEFORE the turn (pre-check)
yield {
  type: 'budget_pre_check',
  can_proceed: preTurnResult.can_proceed,
  stop_reason: preTurnResult.stop_reason,
  budget: preTurnResult.budget_status,
};

// 2. DURING the turn (after API response with usage data)
yield {
  type: 'budget_update',
  turn_usage: { input_tokens: 1200, output_tokens: 340 },
  cumulative: budgetTracker.getStatus(),
};

// 3. AFTER the turn (final status with compaction info)
yield {
  type: 'budget_post_turn',
  stop_reason: postTurnResult.stop_reason,
  compaction: compactionResult,
  budget: budgetTracker.toStreamingEvent(),
};
```

---

## 5. Integrated Turn Loop

All three primitives wire together in the main agent turn loop:

```typescript
// lib/agent-runtime.ts

export async function runTurn(
  session: SessionManager,
  workflow: WorkflowEngine,
  budget: BudgetTracker,
  userMessage: string,
  apiClient: AnthropicClient,
): Promise<TurnResult> {

  // === PRE-TURN BUDGET CHECK (BEFORE any API call) ===
  const budgetCheck = budget.preTurnCheck();
  if (!budgetCheck.can_proceed) {
    return {
      stop_reason: budgetCheck.stop_reason!,
      message: `Budget exhausted: ${budgetCheck.stop_reason}`,
      budget_status: budgetCheck.budget_status,
    };
  }

  // === APPEND USER MESSAGE ===
  session.appendMessage({
    role: 'user',
    content: [{ type: 'text', text: userMessage }],
    timestamp: new Date().toISOString(),
  });

  // === TURN LOOP ===
  let iterations = 0;
  const MAX_ITERATIONS = 25;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // --- Call API ---
    const response = await apiClient.createMessage({
      messages: session.messages,
      max_tokens: 8192,
    });

    // --- Record usage ---
    const usage: TokenUsage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
    };

    // --- Append assistant message with embedded usage ---
    session.appendMessage({
      role: 'assistant',
      content: response.content,
      usage,
      timestamp: new Date().toISOString(),
    });

    // --- Record in budget tracker ---
    const budgetResult = await budget.recordTurn(usage);

    // --- Save session (immediate after assistant message) ---
    await session.flush();

    // --- Check for tool use blocks ---
    const toolUseBlocks = response.content.filter(
      (b: ContentBlock) => b.type === 'tool_use'
    );

    if (toolUseBlocks.length === 0) {
      // No tools to run -- turn is complete
      break;
    }

    // --- Execute tools via workflow engine (with idempotency) ---
    for (const toolBlock of toolUseBlocks) {
      const idempotencyKey = `idem_${session.sessionId}_${toolBlock.tool_use_id}`;

      // Check permission (with persistent grants)
      const existingPermission = session.hasPermission(toolBlock.tool_name);
      if (!existingPermission) {
        // Request permission from user/policy
        // ... (permission flow omitted for brevity)
      }

      // --- WAL: Write checkpoint before execution ---
      await workflow.planWorkflow([{
        step_index: 0,
        step_type: 'tool_call',
        step_description: `${toolBlock.tool_name}(${JSON.stringify(toolBlock.tool_input).slice(0, 200)})`,
        step_input: {
          tool_name: toolBlock.tool_name,
          tool_input: toolBlock.tool_input,
          tool_use_id: toolBlock.tool_use_id,
        },
        requires_approval: false,
      }]);

      // --- Execute tool ---
      const result = await workflow.executeNextStep(async (step) => {
        return await executeTool(step.step_input.tool_name, step.step_input.tool_input);
      });

      // --- Append tool result ---
      session.appendMessage({
        role: 'tool',
        content: [{
          type: 'tool_result',
          tool_result: result?.output,
          is_error: result?.state === 'failed',
        }],
        tool_use_id: toolBlock.tool_use_id,
        timestamp: new Date().toISOString(),
      });

      // --- Save session (immediate after each tool result) ---
      await session.flush();
    }

    // --- Post-turn budget check ---
    if (budgetResult.stop_reason) {
      return {
        stop_reason: budgetResult.stop_reason,
        message: `Budget limit reached: ${budgetResult.stop_reason}`,
        budget_status: budget.getStatus(),
      };
    }
  }

  // === POST-TURN AUTO-COMPACTION ===
  if (budget.shouldCompact()) {
    const compactionResult = await performAutoCompaction(
      session,
      budget,
      budget.config.compact_preserve_recent,
    );

    if (compactionResult?.success) {
      await session.flush();
    }
  }

  return {
    stop_reason: 'completed',
    message: 'Turn completed successfully',
    budget_status: budget.getStatus(),
  };
}
```

---

## 6. Edge Function Endpoints

All endpoints deploy as a single Supabase Edge Function with path-based routing.

### 6.1 Endpoint Manifest

```
POST   /agent/sessions              -- Create new session
GET    /agent/sessions/:id          -- Get session state
PUT    /agent/sessions/:id          -- Update session (save)
POST   /agent/sessions/:id/resume   -- Resume crashed/suspended session
POST   /agent/sessions/:id/complete -- Mark session completed

POST   /agent/workflows             -- Plan a workflow
GET    /agent/workflows/:id         -- Get workflow state
POST   /agent/workflows/:id/execute -- Execute next step
POST   /agent/workflows/:id/approve/:step -- Approve a step
POST   /agent/workflows/:id/deny/:step    -- Deny a step
GET    /agent/workflows/recover/:session_id -- Crash recovery

GET    /agent/budget/:session_id    -- Get current budget status
GET    /agent/budget/:session_id/history -- Full budget ledger
```

### 6.2 Edge Function Implementation

```typescript
// supabase/functions/agent-state/index.ts

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Auth check
function checkAuth(req: Request): boolean {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  return token === Deno.env.get('OB1_ACCESS_KEY');
}

serve(async (req: Request) => {
  if (!checkAuth(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace('/agent-state', '');

  try {
    // --- SESSION ENDPOINTS ---

    if (req.method === 'POST' && path === '/agent/sessions') {
      const body = await req.json();
      const { data, error } = await supabase
        .from('agent_sessions')
        .insert({
          session_id: body.session_id ?? crypto.randomUUID(),
          config_snapshot: body.config ?? {},
          status: 'active',
        })
        .select()
        .single();
      if (error) throw error;
      return json(data, 201);
    }

    if (req.method === 'GET' && path.match(/^\/agent\/sessions\/[\w-]+$/)) {
      const sessionId = path.split('/').pop()!;
      const { data, error } = await supabase
        .from('agent_sessions')
        .select('*')
        .eq('session_id', sessionId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();
      if (error) throw error;
      return json(data);
    }

    if (req.method === 'PUT' && path.match(/^\/agent\/sessions\/[\w-]+$/)) {
      const sessionId = path.split('/').pop()!;
      const body = await req.json();
      const { data, error } = await supabase
        .from('agent_sessions')
        .update(body)
        .eq('session_id', sessionId)
        .select()
        .single();
      if (error) throw error;
      return json(data);
    }

    if (req.method === 'POST' && path.match(/^\/agent\/sessions\/[\w-]+\/resume$/)) {
      const sessionId = path.split('/')[3];
      // Mark as active
      const { data, error } = await supabase
        .from('agent_sessions')
        .update({ status: 'active' })
        .eq('session_id', sessionId)
        .in('status', ['crashed', 'suspended'])
        .select()
        .single();
      if (error) throw error;

      // Run crash recovery on associated workflows
      const { data: stuckSteps } = await supabase
        .from('workflow_checkpoints')
        .select('id, execution_count')
        .eq('session_id', sessionId)
        .eq('state', 'executing');

      let requeued = 0, abandoned = 0;
      for (const step of stuckSteps ?? []) {
        if (step.execution_count >= 3) {
          await supabase.from('workflow_checkpoints')
            .update({ state: 'failed', error_detail: 'Abandoned after crash recovery' })
            .eq('id', step.id);
          abandoned++;
        } else {
          await supabase.from('workflow_checkpoints')
            .update({ state: 'planned' })
            .eq('id', step.id);
          requeued++;
        }
      }

      return json({ session: data, recovery: { requeued, abandoned } });
    }

    if (req.method === 'POST' && path.match(/^\/agent\/sessions\/[\w-]+\/complete$/)) {
      const sessionId = path.split('/')[3];
      const { data, error } = await supabase
        .from('agent_sessions')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('session_id', sessionId)
        .select()
        .single();
      if (error) throw error;
      return json(data);
    }

    // --- WORKFLOW ENDPOINTS ---

    if (req.method === 'POST' && path === '/agent/workflows') {
      const body = await req.json();
      const { steps, session_id, workflow_id } = body;
      const wfId = workflow_id ?? `wf_${crypto.randomUUID()}`;

      const rows = steps.map((s: any, i: number) => ({
        session_id,
        workflow_id: wfId,
        step_index: i,
        state: s.requires_approval ? 'awaiting_approval' : 'planned',
        step_type: s.step_type,
        step_description: s.step_description,
        step_input: s.step_input,
        idempotency_key: `idem_${wfId}_${i}_${crypto.randomUUID()}`,
      }));

      const { error } = await supabase.from('workflow_checkpoints').insert(rows);
      if (error) throw error;
      return json({ workflow_id: wfId, steps_planned: rows.length }, 201);
    }

    if (req.method === 'GET' && path.match(/^\/agent\/workflows\/[\w-]+$/)) {
      const workflowId = path.split('/').pop()!;
      const { data, error } = await supabase
        .from('workflow_checkpoints')
        .select('step_index, state, step_type, step_description, step_output, error_detail')
        .eq('workflow_id', workflowId)
        .order('step_index', { ascending: true });
      if (error) throw error;

      const total = data?.length ?? 0;
      const completed = data?.filter(s => s.state === 'completed').length ?? 0;
      const failed = data?.filter(s => s.state === 'failed').length ?? 0;

      return json({
        workflow_id: workflowId,
        steps: data,
        progress: { total, completed, failed, pending: total - completed - failed },
      });
    }

    if (req.method === 'POST' && path.match(/^\/agent\/workflows\/[\w-]+\/approve\/\d+$/)) {
      const parts = path.split('/');
      const workflowId = parts[3];
      const stepIndex = parseInt(parts[5]);
      const { error } = await supabase
        .from('workflow_checkpoints')
        .update({ state: 'planned' })
        .eq('workflow_id', workflowId)
        .eq('step_index', stepIndex)
        .eq('state', 'awaiting_approval');
      if (error) throw error;
      return json({ approved: true });
    }

    if (req.method === 'POST' && path.match(/^\/agent\/workflows\/[\w-]+\/deny\/\d+$/)) {
      const parts = path.split('/');
      const workflowId = parts[3];
      const stepIndex = parseInt(parts[5]);
      const body = await req.json();
      const { error } = await supabase
        .from('workflow_checkpoints')
        .update({
          state: 'skipped',
          error_detail: `Denied: ${body.reason ?? 'no reason given'}`,
          completed_at: new Date().toISOString(),
        })
        .eq('workflow_id', workflowId)
        .eq('step_index', stepIndex)
        .eq('state', 'awaiting_approval');
      if (error) throw error;
      return json({ denied: true });
    }

    // --- BUDGET ENDPOINTS ---

    if (req.method === 'GET' && path.match(/^\/agent\/budget\/[\w-]+$/)) {
      const sessionId = path.split('/').pop()!;
      // Get latest ledger entry for cumulative totals
      const { data, error } = await supabase
        .from('budget_ledger')
        .select('*')
        .eq('session_id', sessionId)
        .order('turn_number', { ascending: false })
        .limit(1)
        .single();
      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
      return json(data ?? { session_id: sessionId, cumulative_turns: 0, cumulative_cost_usd: 0 });
    }

    if (req.method === 'GET' && path.match(/^\/agent\/budget\/[\w-]+\/history$/)) {
      const sessionId = path.split('/')[3];
      const { data, error } = await supabase
        .from('budget_ledger')
        .select('*')
        .eq('session_id', sessionId)
        .order('turn_number', { ascending: true });
      if (error) throw error;
      return json({ session_id: sessionId, entries: data });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

---

## 7. Migration SQL (Run in Order)

Execute these in the Supabase SQL Editor, in sequence:

```sql
-- ============================================================
-- Migration: Agent State & Budget Primitives
-- Run AFTER the core OB1 setup (thoughts table must exist)
-- ============================================================

-- 0. Verify prerequisites
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'thoughts') THEN
    RAISE EXCEPTION 'thoughts table must exist before running this migration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at') THEN
    RAISE EXCEPTION 'update_updated_at() function must exist. Run core OB1 setup first.';
  END IF;
END $$;

-- 1. agent_sessions
CREATE TABLE IF NOT EXISTS agent_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'completed', 'crashed')),
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  permission_decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_input_tokens BIGINT NOT NULL DEFAULT 0,
  total_output_tokens BIGINT NOT NULL DEFAULT 0,
  total_cache_write_tokens BIGINT NOT NULL DEFAULT 0,
  total_cache_read_tokens BIGINT NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  turn_count INT NOT NULL DEFAULT 0,
  compaction_count INT NOT NULL DEFAULT 0,
  last_compaction_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  thought_id UUID REFERENCES thoughts(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_session_id ON agent_sessions (session_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions (status) WHERE status IN ('active', 'crashed');
CREATE INDEX IF NOT EXISTS idx_agent_sessions_created ON agent_sessions (created_at DESC);

CREATE TRIGGER agent_sessions_updated_at
  BEFORE UPDATE ON agent_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON agent_sessions FOR ALL USING (auth.role() = 'service_role');
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_sessions TO service_role;

-- 2. workflow_checkpoints
CREATE TABLE IF NOT EXISTS workflow_checkpoints (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  step_index INT NOT NULL,
  state TEXT NOT NULL DEFAULT 'planned'
    CHECK (state IN ('planned', 'awaiting_approval', 'executing', 'waiting_on_external', 'completed', 'failed', 'skipped')),
  step_type TEXT NOT NULL,
  step_description TEXT,
  step_input JSONB NOT NULL DEFAULT '{}'::jsonb,
  step_output JSONB,
  error_detail TEXT,
  idempotency_key TEXT NOT NULL,
  execution_count INT NOT NULL DEFAULT 0,
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  cost_usd NUMERIC(10,6) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_wf_checkpoints_workflow ON workflow_checkpoints (workflow_id, step_index);
CREATE INDEX IF NOT EXISTS idx_wf_checkpoints_incomplete ON workflow_checkpoints (session_id, state) WHERE state IN ('executing', 'awaiting_approval', 'waiting_on_external');
CREATE INDEX IF NOT EXISTS idx_wf_checkpoints_created ON workflow_checkpoints (created_at DESC);

CREATE TRIGGER wf_checkpoints_updated_at
  BEFORE UPDATE ON workflow_checkpoints
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

ALTER TABLE workflow_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON workflow_checkpoints FOR ALL USING (auth.role() = 'service_role');
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workflow_checkpoints TO service_role;

-- 3. budget_ledger
CREATE TABLE IF NOT EXISTS budget_ledger (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_number INT NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  cache_write_tokens INT NOT NULL DEFAULT 0,
  cache_read_tokens INT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  model TEXT,
  max_turns INT,
  max_budget_tokens BIGINT,
  max_budget_usd NUMERIC(10,4),
  cumulative_input_tokens BIGINT NOT NULL DEFAULT 0,
  cumulative_output_tokens BIGINT NOT NULL DEFAULT 0,
  cumulative_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  cumulative_turns INT NOT NULL DEFAULT 0,
  stop_reason TEXT
    CHECK (stop_reason IS NULL OR stop_reason IN (
      'completed', 'max_turns_reached', 'max_budget_tokens_reached',
      'max_budget_usd_reached', 'auto_compacted', 'user_stopped', 'error'
    )),
  compaction_triggered BOOLEAN NOT NULL DEFAULT false,
  compaction_messages_removed INT DEFAULT 0,
  consecutive_compaction_failures INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_ledger_session ON budget_ledger (session_id, turn_number DESC);
CREATE INDEX IF NOT EXISTS idx_budget_ledger_created ON budget_ledger (created_at DESC);

ALTER TABLE budget_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON budget_ledger FOR ALL USING (auth.role() = 'service_role');
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.budget_ledger TO service_role;
```

---

## 8. What We Built That Claude Code Lacks

| Capability                         | Claude Code | This Blueprint |
|------------------------------------|-------------|----------------|
| Session persistence                | File-based JSON on disk | Supabase with immediate saves |
| Mid-turn crash recovery            | None        | WAL + checkpoint replay |
| Idempotency keys                   | None        | UUID per step, UNIQUE constraint |
| Write-ahead log                    | None        | `workflow_checkpoints` with state=executing before execution |
| Workflow state machine             | None        | 7-state machine (planned through skipped) |
| Permission persistence             | Ephemeral   | Session-scoped grants survive restart |
| USD-based budget stop              | None        | `max_budget_usd` with pre-turn check |
| Auto-compaction failure counting   | None        | `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3` |
| Task vs conversation separation    | Same thing  | `workflow_checkpoints` independent of compaction |
| Budget streaming events            | CLI status only | `budget_status` events during streaming |
| Append-only cost ledger            | In-memory accumulator | `budget_ledger` table with full history |
| Session resume from database       | File load   | `resumeSession()` from Supabase + crash recovery |

---

## 9. Implementation Order

Execute in this sequence. Each phase is independently testable.

### Phase 1: Schema (30 min)
Run the migration SQL from Section 7 in Supabase SQL Editor. Verify all three tables appear in Table Editor.

### Phase 2: Session Persistence (2 hr)
1. Implement `SessionManager` (Section 2.2)
2. Wire save triggers (Section 2.3)
3. Test: create session, append messages, flush, resume from Supabase, verify round-trip
4. Test: `markCrashed()` then `resume()` restores to active

### Phase 3: Budget Tracking (2 hr)
1. Implement `pricingForModel()` and `computeCostUsd()` (Section 4.2)
2. Implement `BudgetTracker` (Section 4.3)
3. Test: pre-turn check blocks when turns exhausted
4. Test: pre-turn check blocks when token budget exhausted
5. Test: pre-turn check blocks when USD budget exhausted (the new capability)
6. Test: `fromSession()` accurately reconstructs cumulative usage

### Phase 4: Auto-Compaction (1 hr)
1. Implement `performAutoCompaction()` (Section 4.4)
2. Test: compaction fires at threshold, preserves recent messages
3. Test: `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES` stops retries after 3 failures
4. Test: successful compaction resets failure counter

### Phase 5: Workflow Engine (2 hr)
1. Implement `WorkflowEngine` (Section 3.2)
2. Test: plan -> execute -> complete flow
3. Test: idempotency -- same key returns cached result
4. Test: crash recovery -- executing steps requeued or abandoned based on `execution_count`

### Phase 6: Edge Function (2 hr)
1. Deploy the Edge Function (Section 6.2)
2. Test all endpoints via curl/Postman
3. Wire into Claude Desktop as a custom connector

### Phase 7: Integration (1 hr)
1. Wire all three primitives into the turn loop (Section 5)
2. End-to-end test: full session lifecycle with budget enforcement, workflow checkpoints, crash recovery, and auto-compaction

---

## 10. Testing Checklist

### Session Persistence
- [ ] Create session -> verify row in `agent_sessions`
- [ ] Append 5 messages -> flush -> read back -> all 5 present with usage
- [ ] Resume session -> usage tracker reconstructed accurately
- [ ] `markCrashed()` -> status = 'crashed' in DB
- [ ] Resume crashed session -> status = 'active', workflow recovery runs
- [ ] Permission decision persisted -> survives session resume
- [ ] Config snapshot frozen at creation time

### Workflow State & Idempotency
- [ ] Plan 3-step workflow -> 3 rows in `workflow_checkpoints` with state='planned'
- [ ] Execute step 1 -> state transitions: planned -> executing -> completed
- [ ] Retry with same idempotency_key -> returns cached output, no re-execution
- [ ] Simulate crash (leave step in 'executing') -> recovery requeues it
- [ ] Step with `execution_count >= 3` -> recovery abandons it (state='failed')
- [ ] Approval flow: awaiting_approval -> approve -> planned -> execute -> completed
- [ ] Deny flow: awaiting_approval -> deny -> skipped

### Token Budget Tracking
- [ ] Pre-turn check blocks when `turn_count >= max_turns` (NO API call made)
- [ ] Pre-turn check blocks when tokens exceed `max_budget_tokens`
- [ ] Pre-turn check blocks when cost exceeds `max_budget_usd` (NEW)
- [ ] Budget ledger has one row per turn with correct cumulative totals
- [ ] `fromSession()` reconstructs identical cumulative usage
- [ ] Four-category tracking: input, output, cache_write, cache_read all recorded
- [ ] Model pricing applied correctly (haiku vs sonnet vs opus)
- [ ] `formatUsd()` outputs `$X.XXXX` (4 decimal places)

### Auto-Compaction
- [ ] Fires when `input_tokens >= compact_after_tokens`
- [ ] Preserves last N messages (default 4)
- [ ] Summary includes scope, tools, recent requests
- [ ] Failed compaction increments `consecutive_compaction_failures`
- [ ] After 3 consecutive failures, `shouldCompact()` returns false
- [ ] Successful compaction resets failure counter to 0

### Edge Function
- [ ] POST /agent/sessions creates session
- [ ] GET /agent/sessions/:id returns session state
- [ ] PUT /agent/sessions/:id updates session
- [ ] POST /agent/sessions/:id/resume recovers crashed session
- [ ] POST /agent/workflows plans workflow
- [ ] GET /agent/workflows/:id returns progress
- [ ] GET /agent/budget/:session_id returns latest budget status
- [ ] GET /agent/budget/:session_id/history returns full ledger
- [ ] Unauthorized request returns 401
