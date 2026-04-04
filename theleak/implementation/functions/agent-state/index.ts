// supabase/functions/agent-state/index.ts
//
// Edge Function: Session, Workflow & Budget Operations
// Routes all actions through a single POST endpoint with JSON body { action, ...params }
//
// Actions:
//   create_session     — create a new agent session
//   get_session        — get session by session_id
//   update_session     — update session state (messages, config, usage, etc.)
//   list_sessions      — list sessions with optional status filter
//   create_checkpoint  — create a workflow checkpoint (with idempotency key)
//   get_checkpoints    — get all checkpoints for a session or workflow
//   recover_stuck      — find and requeue stuck executing steps
//   record_usage       — record token usage to the budget ledger
//   get_budget         — get current budget summary for a session
//   check_budget       — pre-turn budget check (returns can_proceed + stop_reason)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-access-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------- Helpers ----------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

// ---------- Constants ----------

/** Max retries before a stuck step is abandoned instead of requeued */
const MAX_EXECUTION_RETRIES = 3;

// ---------- Action handlers ----------

interface ActionContext {
  supabase: ReturnType<typeof createClient>;
  params: Record<string, unknown>;
}

// ========== SESSION ACTIONS ==========

/** create_session — create a new agent session */
async function createSession({ supabase, params }: ActionContext): Promise<Response> {
  const {
    session_id,
    config,
    messages,
    permission_decisions,
  } = params as {
    session_id?: string;
    config?: Record<string, unknown>;
    messages?: unknown[];
    permission_decisions?: unknown[];
  };

  const row = {
    session_id: session_id ?? crypto.randomUUID(),
    status: "active" as const,
    config_snapshot: config ?? {},
    messages: messages ?? [],
    permission_decisions: permission_decisions ?? [],
  };

  const { data, error: dbError } = await supabase
    .from("agent_sessions")
    .insert(row)
    .select()
    .single();

  if (dbError) return error(dbError.message, 500);
  return json({ session: data }, 201);
}

/** get_session — get session by session_id */
async function getSession({ supabase, params }: ActionContext): Promise<Response> {
  const { session_id } = params as { session_id: string };

  if (!session_id) {
    return error("session_id is required");
  }

  const { data, error: dbError } = await supabase
    .from("agent_sessions")
    .select("*")
    .eq("session_id", session_id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (dbError) {
    if (dbError.code === "PGRST116") return error(`Session "${session_id}" not found`, 404);
    return error(dbError.message, 500);
  }

  return json({ session: data });
}

/** update_session — update session state */
async function updateSession({ supabase, params }: ActionContext): Promise<Response> {
  const { session_id, ...updates } = params as {
    session_id: string;
  } & Record<string, unknown>;

  if (!session_id) {
    return error("session_id is required");
  }

  // Only allow updating known session columns
  const allowedFields = new Set([
    "status",
    "messages",
    "config_snapshot",
    "permission_decisions",
    "total_input_tokens",
    "total_output_tokens",
    "total_cache_write_tokens",
    "total_cache_read_tokens",
    "total_cost_usd",
    "turn_count",
    "compaction_count",
    "last_compaction_at",
    "completed_at",
    "thought_id",
  ]);

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.has(key)) {
      patch[key] = value;
    }
  }

  if (Object.keys(patch).length === 0) {
    return error("No valid fields to update. Allowed: " + [...allowedFields].join(", "));
  }

  // Auto-set completed_at when status transitions to 'completed'
  if (patch.status === "completed" && !patch.completed_at) {
    patch.completed_at = new Date().toISOString();
  }

  const { data, error: dbError } = await supabase
    .from("agent_sessions")
    .update(patch)
    .eq("session_id", session_id)
    .select()
    .single();

  if (dbError) return error(dbError.message, 500);
  if (!data) return error(`Session "${session_id}" not found`, 404);

  return json({ session: data });
}

/** list_sessions — list sessions with optional status filter */
async function listSessions({ supabase, params }: ActionContext): Promise<Response> {
  const { status, limit: rawLimit, offset: rawOffset } = params as {
    status?: string;
    limit?: number;
    offset?: number;
  };

  const pageLimit = Math.min(rawLimit ?? 50, 200);
  const pageOffset = rawOffset ?? 0;

  let query = supabase
    .from("agent_sessions")
    .select(
      "id, session_id, status, turn_count, total_cost_usd, created_at, updated_at, completed_at",
    )
    .order("updated_at", { ascending: false })
    .range(pageOffset, pageOffset + pageLimit - 1);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error: dbError } = await query;
  if (dbError) return error(dbError.message, 500);

  return json({
    sessions: data ?? [],
    meta: { count: data?.length ?? 0, limit: pageLimit, offset: pageOffset },
  });
}

// ========== WORKFLOW CHECKPOINT ACTIONS ==========

/** create_checkpoint — create a workflow checkpoint with idempotency */
async function createCheckpoint({ supabase, params }: ActionContext): Promise<Response> {
  const {
    session_id,
    workflow_id,
    step_index,
    step_type,
    step_description,
    step_input,
    idempotency_key,
    state,
  } = params as {
    session_id: string;
    workflow_id: string;
    step_index: number;
    step_type: string;
    step_description?: string;
    step_input?: Record<string, unknown>;
    idempotency_key: string;
    state?: string;
  };

  if (!session_id || !workflow_id || step_index === undefined || !step_type || !idempotency_key) {
    return error(
      "session_id, workflow_id, step_index, step_type, and idempotency_key are required",
    );
  }

  // Check idempotency: if this key already exists, return the existing checkpoint
  const { data: existing } = await supabase
    .from("workflow_checkpoints")
    .select("*")
    .eq("idempotency_key", idempotency_key)
    .maybeSingle();

  if (existing) {
    return json({
      checkpoint: existing,
      idempotent: true,
      message: "Checkpoint already exists for this idempotency key",
    });
  }

  const row = {
    session_id,
    workflow_id,
    step_index,
    state: state ?? "planned",
    step_type,
    step_description: step_description ?? null,
    step_input: step_input ?? {},
    idempotency_key,
  };

  const { data, error: dbError } = await supabase
    .from("workflow_checkpoints")
    .insert(row)
    .select()
    .single();

  if (dbError) {
    // Handle unique constraint violation on idempotency_key (race condition)
    if (dbError.code === "23505") {
      const { data: raceExisting } = await supabase
        .from("workflow_checkpoints")
        .select("*")
        .eq("idempotency_key", idempotency_key)
        .single();

      return json({
        checkpoint: raceExisting,
        idempotent: true,
        message: "Checkpoint already exists (concurrent insert)",
      });
    }
    return error(dbError.message, 500);
  }

  return json({ checkpoint: data, idempotent: false }, 201);
}

/** get_checkpoints — get checkpoints for a session or workflow */
async function getCheckpoints({ supabase, params }: ActionContext): Promise<Response> {
  const { session_id, workflow_id, state: stateFilter } = params as {
    session_id?: string;
    workflow_id?: string;
    state?: string;
  };

  if (!session_id && !workflow_id) {
    return error("Either session_id or workflow_id is required");
  }

  let query = supabase
    .from("workflow_checkpoints")
    .select("*")
    .order("step_index", { ascending: true });

  if (workflow_id) {
    query = query.eq("workflow_id", workflow_id);
  }
  if (session_id) {
    query = query.eq("session_id", session_id);
  }
  if (stateFilter) {
    query = query.eq("state", stateFilter);
  }

  const { data, error: dbError } = await query;
  if (dbError) return error(dbError.message, 500);

  const steps = data ?? [];
  const total = steps.length;
  const completed = steps.filter((s: Record<string, unknown>) => s.state === "completed").length;
  const failed = steps.filter((s: Record<string, unknown>) => s.state === "failed").length;
  const executing = steps.filter((s: Record<string, unknown>) => s.state === "executing").length;

  return json({
    checkpoints: steps,
    progress: {
      total,
      completed,
      failed,
      executing,
      pending: total - completed - failed,
    },
  });
}

/** recover_stuck — find and requeue stuck executing steps */
async function recoverStuck({ supabase, params }: ActionContext): Promise<Response> {
  const { session_id } = params as { session_id: string };

  if (!session_id) {
    return error("session_id is required");
  }

  // Find all steps stuck in 'executing' state for this session
  const { data: stuckSteps, error: queryError } = await supabase
    .from("workflow_checkpoints")
    .select("id, step_index, workflow_id, execution_count, step_type, step_description")
    .eq("session_id", session_id)
    .eq("state", "executing");

  if (queryError) return error(queryError.message, 500);

  const steps = stuckSteps ?? [];

  if (steps.length === 0) {
    return json({
      session_id,
      requeued: 0,
      abandoned: 0,
      message: "No stuck steps found",
    });
  }

  let requeued = 0;
  let abandoned = 0;
  const requeuedSteps: unknown[] = [];
  const abandonedSteps: unknown[] = [];

  for (const step of steps) {
    if ((step.execution_count as number) >= MAX_EXECUTION_RETRIES) {
      // Too many retries — mark as failed
      const { error: updateError } = await supabase
        .from("workflow_checkpoints")
        .update({
          state: "failed",
          error_detail: `Abandoned after ${step.execution_count} attempts during crash recovery`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", step.id);

      if (!updateError) {
        abandoned++;
        abandonedSteps.push({
          id: step.id,
          step_index: step.step_index,
          workflow_id: step.workflow_id,
          execution_count: step.execution_count,
        });
      }
    } else {
      // Requeue: set back to 'planned' for retry
      const { error: updateError } = await supabase
        .from("workflow_checkpoints")
        .update({ state: "planned" })
        .eq("id", step.id);

      if (!updateError) {
        requeued++;
        requeuedSteps.push({
          id: step.id,
          step_index: step.step_index,
          workflow_id: step.workflow_id,
          execution_count: step.execution_count,
        });
      }
    }
  }

  return json({
    session_id,
    requeued,
    abandoned,
    requeued_steps: requeuedSteps,
    abandoned_steps: abandonedSteps,
  });
}

// ========== BUDGET ACTIONS ==========

/** record_usage — record token usage to the budget ledger */
async function recordUsage({ supabase, params }: ActionContext): Promise<Response> {
  const {
    session_id,
    turn_number,
    input_tokens,
    output_tokens,
    cache_write_tokens,
    cache_read_tokens,
    cost_usd,
    model,
    max_turns,
    max_budget_tokens,
    max_budget_usd,
    stop_reason,
    compaction_triggered,
    compaction_messages_removed,
    consecutive_compaction_failures,
  } = params as {
    session_id: string;
    turn_number: number;
    input_tokens?: number;
    output_tokens?: number;
    cache_write_tokens?: number;
    cache_read_tokens?: number;
    cost_usd?: number;
    model?: string;
    max_turns?: number;
    max_budget_tokens?: number;
    max_budget_usd?: number;
    stop_reason?: string;
    compaction_triggered?: boolean;
    compaction_messages_removed?: number;
    consecutive_compaction_failures?: number;
  };

  if (!session_id || turn_number === undefined) {
    return error("session_id and turn_number are required");
  }

  // Compute cumulative totals from the previous entry
  const { data: prevEntry } = await supabase
    .from("budget_ledger")
    .select("cumulative_input_tokens, cumulative_output_tokens, cumulative_cost_usd, cumulative_turns")
    .eq("session_id", session_id)
    .order("turn_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevCumulativeInput = (prevEntry?.cumulative_input_tokens as number) ?? 0;
  const prevCumulativeOutput = (prevEntry?.cumulative_output_tokens as number) ?? 0;
  const prevCumulativeCost = Number(prevEntry?.cumulative_cost_usd ?? 0);
  const prevCumulativeTurns = (prevEntry?.cumulative_turns as number) ?? 0;

  const thisInputTokens = input_tokens ?? 0;
  const thisOutputTokens = output_tokens ?? 0;
  const thisCostUsd = cost_usd ?? 0;

  const row = {
    session_id,
    turn_number,
    input_tokens: thisInputTokens,
    output_tokens: thisOutputTokens,
    cache_write_tokens: cache_write_tokens ?? 0,
    cache_read_tokens: cache_read_tokens ?? 0,
    cost_usd: thisCostUsd,
    model: model ?? null,
    max_turns: max_turns ?? null,
    max_budget_tokens: max_budget_tokens ?? null,
    max_budget_usd: max_budget_usd ?? null,
    cumulative_input_tokens: prevCumulativeInput + thisInputTokens,
    cumulative_output_tokens: prevCumulativeOutput + thisOutputTokens,
    cumulative_cost_usd: prevCumulativeCost + thisCostUsd,
    cumulative_turns: prevCumulativeTurns + 1,
    stop_reason: stop_reason ?? null,
    compaction_triggered: compaction_triggered ?? false,
    compaction_messages_removed: compaction_messages_removed ?? 0,
    consecutive_compaction_failures: consecutive_compaction_failures ?? 0,
  };

  const { data, error: dbError } = await supabase
    .from("budget_ledger")
    .insert(row)
    .select()
    .single();

  if (dbError) return error(dbError.message, 500);

  // Also update the denormalized usage totals on the session
  const { error: sessionError } = await supabase
    .from("agent_sessions")
    .update({
      total_input_tokens: row.cumulative_input_tokens,
      total_output_tokens: row.cumulative_output_tokens,
      total_cost_usd: row.cumulative_cost_usd,
      turn_count: row.cumulative_turns,
    })
    .eq("session_id", session_id);

  if (sessionError) {
    console.error(
      `[agent-state] Warning: failed to update session usage for ${session_id}:`,
      sessionError.message,
    );
  }

  return json({ ledger_entry: data }, 201);
}

/** get_budget — get current budget summary for a session */
async function getBudget({ supabase, params }: ActionContext): Promise<Response> {
  const { session_id } = params as { session_id: string };

  if (!session_id) {
    return error("session_id is required");
  }

  // Get the latest ledger entry for cumulative totals
  const { data: latest, error: dbError } = await supabase
    .from("budget_ledger")
    .select("*")
    .eq("session_id", session_id)
    .order("turn_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dbError) return error(dbError.message, 500);

  if (!latest) {
    return json({
      session_id,
      turns_used: 0,
      tokens_used: 0,
      cost_usd: 0,
      entries_count: 0,
      message: "No budget entries recorded yet",
    });
  }

  const tokensUsed =
    (latest.cumulative_input_tokens as number) +
    (latest.cumulative_output_tokens as number);

  const maxTokens = latest.max_budget_tokens as number | null;
  const maxUsd = latest.max_budget_usd ? Number(latest.max_budget_usd) : null;
  const maxTurns = latest.max_turns as number | null;
  const costUsd = Number(latest.cumulative_cost_usd);
  const turnsUsed = latest.cumulative_turns as number;

  // Compute budget percentage based on most constraining limit
  const percentages: number[] = [];
  if (maxTurns) percentages.push((turnsUsed / maxTurns) * 100);
  if (maxTokens) percentages.push((tokensUsed / maxTokens) * 100);
  if (maxUsd) percentages.push((costUsd / maxUsd) * 100);

  const budgetPercent =
    percentages.length > 0
      ? Math.round(Math.max(...percentages) * 100) / 100
      : 0;

  return json({
    session_id,
    turns_used: turnsUsed,
    turns_remaining: maxTurns ? Math.max(0, maxTurns - turnsUsed) : null,
    tokens_used: tokensUsed,
    tokens_remaining: maxTokens ? Math.max(0, maxTokens - tokensUsed) : null,
    cost_usd: costUsd,
    cost_remaining_usd: maxUsd ? Math.max(0, maxUsd - costUsd) : null,
    budget_percent: budgetPercent,
    limits: {
      max_turns: maxTurns,
      max_budget_tokens: maxTokens,
      max_budget_usd: maxUsd,
    },
    last_stop_reason: latest.stop_reason ?? null,
    last_model: latest.model ?? null,
  });
}

/** check_budget — pre-turn budget check (returns can_proceed + stop_reason if exceeded) */
async function checkBudget({ supabase, params }: ActionContext): Promise<Response> {
  const { session_id, max_turns, max_budget_tokens, max_budget_usd } = params as {
    session_id: string;
    max_turns?: number;
    max_budget_tokens?: number;
    max_budget_usd?: number;
  };

  if (!session_id) {
    return error("session_id is required");
  }

  // Get the latest ledger entry for cumulative totals
  const { data: latest, error: dbError } = await supabase
    .from("budget_ledger")
    .select(
      "cumulative_input_tokens, cumulative_output_tokens, cumulative_cost_usd, cumulative_turns, max_turns, max_budget_tokens, max_budget_usd",
    )
    .eq("session_id", session_id)
    .order("turn_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dbError) return error(dbError.message, 500);

  // No entries yet — can always proceed
  if (!latest) {
    return json({
      can_proceed: true,
      stop_reason: null,
      budget_status: {
        turns_used: 0,
        tokens_used: 0,
        cost_usd: 0,
      },
    });
  }

  const turnsUsed = latest.cumulative_turns as number;
  const tokensUsed =
    (latest.cumulative_input_tokens as number) +
    (latest.cumulative_output_tokens as number);
  const costUsd = Number(latest.cumulative_cost_usd);

  // Use provided limits, falling back to the limits stored on the latest entry
  const effectiveMaxTurns = max_turns ?? (latest.max_turns as number | null);
  const effectiveMaxTokens = max_budget_tokens ?? (latest.max_budget_tokens as number | null);
  const effectiveMaxUsd =
    max_budget_usd ?? (latest.max_budget_usd ? Number(latest.max_budget_usd) : null);

  // Check 1: Turn limit
  if (effectiveMaxTurns !== null && turnsUsed >= effectiveMaxTurns) {
    return json({
      can_proceed: false,
      stop_reason: "max_turns_reached",
      budget_status: {
        turns_used: turnsUsed,
        turns_limit: effectiveMaxTurns,
        tokens_used: tokensUsed,
        cost_usd: costUsd,
      },
    });
  }

  // Check 2: Token budget
  if (effectiveMaxTokens !== null && tokensUsed >= effectiveMaxTokens) {
    return json({
      can_proceed: false,
      stop_reason: "max_budget_tokens_reached",
      budget_status: {
        turns_used: turnsUsed,
        tokens_used: tokensUsed,
        tokens_limit: effectiveMaxTokens,
        cost_usd: costUsd,
      },
    });
  }

  // Check 3: USD budget
  if (effectiveMaxUsd !== null && costUsd >= effectiveMaxUsd) {
    return json({
      can_proceed: false,
      stop_reason: "max_budget_usd_reached",
      budget_status: {
        turns_used: turnsUsed,
        tokens_used: tokensUsed,
        cost_usd: costUsd,
        cost_limit_usd: effectiveMaxUsd,
      },
    });
  }

  // All checks passed
  return json({
    can_proceed: true,
    stop_reason: null,
    budget_status: {
      turns_used: turnsUsed,
      tokens_used: tokensUsed,
      cost_usd: costUsd,
      limits: {
        max_turns: effectiveMaxTurns,
        max_budget_tokens: effectiveMaxTokens,
        max_budget_usd: effectiveMaxUsd,
      },
    },
  });
}

// ---------- Action router ----------

const ACTION_HANDLERS: Record<
  string,
  (ctx: ActionContext) => Promise<Response>
> = {
  create_session: createSession,
  get_session: getSession,
  update_session: updateSession,
  list_sessions: listSessions,
  create_checkpoint: createCheckpoint,
  get_checkpoints: getCheckpoints,
  recover_stuck: recoverStuck,
  record_usage: recordUsage,
  get_budget: getBudget,
  check_budget: checkBudget,
};

// ---------- Entry point ----------

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth: x-access-key header
  const accessKey = req.headers.get("x-access-key");
  if (accessKey !== Deno.env.get("OB1_ACCESS_KEY")) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Only accept POST
  if (req.method !== "POST") {
    return error("Method not allowed. Use POST.", 405);
  }

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Invalid JSON body");
  }

  const { action, ...params } = body;

  if (!action || typeof action !== "string") {
    return error(
      `Missing or invalid "action". Valid actions: ${Object.keys(ACTION_HANDLERS).join(", ")}`,
    );
  }

  const handler = ACTION_HANDLERS[action];
  if (!handler) {
    return error(
      `Unknown action "${action}". Valid actions: ${Object.keys(ACTION_HANDLERS).join(", ")}`,
    );
  }

  // Create Supabase client per request (uses service role — full access)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    return await handler({ supabase, params });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent-state] action=${action} error:`, message);
    return json({ error: message }, 500);
  }
});
