// =============================================================================
// agent-coordinator — Edge Function for Agent Types, Runs & Inter-Agent Messaging
//
// Actions:
//   list_agent_types    — List available agent types
//   register_agent_type — Register a custom agent type
//   spawn_agent         — Create an agent_run record (status=spawned)
//   update_agent_status — Update agent run status
//   get_agent_run       — Get agent run details
//   list_agent_runs     — List runs (filter by coordinator, status, type)
//   send_message        — Send an inter-agent message
//   get_messages        — Get messages for an agent (undelivered or all)
//   mark_delivered      — Mark messages as delivered
//   get_agent_summary   — Coordinator summary (counts by status)
//
// Auth: x-access-key header matched against OB1_ACCESS_KEY env var.
// =============================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-access-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------
function jsonOk(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// ID generation helper
// ---------------------------------------------------------------------------
function generateRunId(agentTypeName: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  return `agent_${agentTypeName}_${ts}_${rand}`;
}

// ---------------------------------------------------------------------------
// Agent Type actions
// ---------------------------------------------------------------------------

/**
 * list_agent_types — list available agent types.
 *
 * Optional: source, enabled_only (default true)
 */
async function handleListAgentTypes(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  let query = supabase.from("agent_types").select("*");

  const enabledOnly = params.enabled_only !== false;
  if (enabledOnly) {
    query = query.eq("enabled", true);
  }

  if (params.source) {
    const validSources = ["built_in", "custom", "skill_pack"];
    if (!validSources.includes(params.source as string)) {
      return jsonError(`Invalid source. Must be one of: ${validSources.join(", ")}`);
    }
    query = query.eq("source", params.source as string);
  }

  const { data, error } = await query.order("name");

  if (error) {
    return jsonError(error.message, 500);
  }

  return jsonOk({ agent_types: data, count: data?.length ?? 0 });
}

/**
 * register_agent_type — register a custom agent type.
 *
 * Required: name, display_name, system_prompt
 * Optional: description, source, permission_mode, allowed_tools, denied_tools,
 *           denied_prefixes, constraints, max_iterations, output_format,
 *           handler_type, color, icon, can_spawn, metadata
 */
async function handleRegisterAgentType(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const name = params.name as string | undefined;
  const displayName = params.display_name as string | undefined;
  const systemPrompt = params.system_prompt as string | undefined;

  if (!name || !displayName || !systemPrompt) {
    return jsonError("Missing required fields: name, display_name, system_prompt");
  }

  // Validate enums
  const permissionMode = (params.permission_mode as string) ?? "read_only";
  const validModes = ["read_only", "workspace_write", "danger_full_access"];
  if (!validModes.includes(permissionMode)) {
    return jsonError(`Invalid permission_mode. Must be one of: ${validModes.join(", ")}`);
  }

  const outputFormat = (params.output_format as string) ?? "markdown";
  const validFormats = ["markdown", "json", "structured_facts", "plan", "status", "free"];
  if (!validFormats.includes(outputFormat)) {
    return jsonError(`Invalid output_format. Must be one of: ${validFormats.join(", ")}`);
  }

  const handlerType = (params.handler_type as string) ?? "coordinator";
  const validHandlers = ["interactive", "coordinator", "swarm_worker"];
  if (!validHandlers.includes(handlerType)) {
    return jsonError(`Invalid handler_type. Must be one of: ${validHandlers.join(", ")}`);
  }

  const source = (params.source as string) ?? "custom";
  const validSources = ["built_in", "custom", "skill_pack"];
  if (!validSources.includes(source)) {
    return jsonError(`Invalid source. Must be one of: ${validSources.join(", ")}`);
  }

  const { data, error } = await supabase
    .from("agent_types")
    .upsert(
      {
        name,
        display_name: displayName,
        description: (params.description as string) ?? "",
        source,
        permission_mode: permissionMode,
        allowed_tools: (params.allowed_tools as string[]) ?? [],
        denied_tools: (params.denied_tools as string[]) ?? [],
        denied_prefixes: (params.denied_prefixes as string[]) ?? [],
        system_prompt: systemPrompt,
        constraints: (params.constraints as string[]) ?? [],
        max_iterations: (params.max_iterations as number) ?? 50,
        output_format: outputFormat,
        handler_type: handlerType,
        color: params.color ?? null,
        icon: params.icon ?? null,
        can_spawn: (params.can_spawn as boolean) ?? false,
        metadata: params.metadata ?? {},
        enabled: true,
      },
      { onConflict: "name" },
    )
    .select()
    .single();

  if (error) {
    return jsonError(error.message, 500);
  }

  return jsonOk({ agent_type: data, registered: true });
}

// ---------------------------------------------------------------------------
// Agent Run actions
// ---------------------------------------------------------------------------

/**
 * spawn_agent — create an agent_run record with status = spawned.
 *
 * Required: agent_type, task_prompt
 * Optional: task_context, coordinator_run_id, parent_run_id,
 *           depends_on, session_id, metadata
 */
async function handleSpawnAgent(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const agentTypeName = params.agent_type as string | undefined;
  const taskPrompt = params.task_prompt as string | undefined;

  if (!agentTypeName || !taskPrompt) {
    return jsonError("Missing required fields: agent_type, task_prompt");
  }

  // Look up the agent type
  const { data: agentType, error: typeError } = await supabase
    .from("agent_types")
    .select("id, name, max_iterations")
    .eq("name", agentTypeName)
    .eq("enabled", true)
    .single();

  if (typeError || !agentType) {
    return jsonError(`Unknown or disabled agent type: ${agentTypeName}`, 404);
  }

  const runId = generateRunId(agentTypeName);

  // Resolve coordinator_run_id: can be a UUID (agent_runs.id) or a run_id string
  let coordinatorRunId = params.coordinator_run_id as string | null ?? null;
  if (coordinatorRunId) {
    // Try to resolve it as a run_id first
    const { data: coordRun } = await supabase
      .from("agent_runs")
      .select("id")
      .eq("run_id", coordinatorRunId)
      .maybeSingle();

    if (coordRun) {
      coordinatorRunId = coordRun.id;
    }
    // Otherwise assume it is already a UUID
  }

  // Same for parent_run_id
  let parentRunId = params.parent_run_id as string | null ?? null;
  if (parentRunId) {
    const { data: parentRun } = await supabase
      .from("agent_runs")
      .select("id")
      .eq("run_id", parentRunId)
      .maybeSingle();

    if (parentRun) {
      parentRunId = parentRun.id;
    }
  }

  const { data, error } = await supabase
    .from("agent_runs")
    .insert({
      run_id: runId,
      agent_type_id: agentType.id,
      agent_type_name: agentTypeName,
      task_prompt: taskPrompt,
      task_context: params.task_context ?? {},
      status: "pending",
      coordinator_run_id: coordinatorRunId,
      parent_run_id: parentRunId,
      depends_on: (params.depends_on as string[]) ?? [],
      max_iterations_used: agentType.max_iterations,
      session_id: params.session_id ?? null,
      metadata: params.metadata ?? {},
    })
    .select("id, run_id, status, created_at")
    .single();

  if (error) {
    return jsonError(error.message, 500);
  }

  return jsonOk({
    id: data.id,
    run_id: data.run_id,
    agent_type: agentTypeName,
    status: data.status,
    created_at: data.created_at,
    message: "Agent spawned. Use update_agent_status to transition its lifecycle.",
  });
}

/**
 * update_agent_status — update agent run status and optionally set results.
 *
 * Required: run_id, status
 * Optional: output_summary, output_data, error_message, thought_ids,
 *           total_input_tokens, total_output_tokens, total_cost_usd,
 *           iteration_count
 */
async function handleUpdateAgentStatus(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const runId = params.run_id as string | undefined;
  const newStatus = params.status as string | undefined;

  if (!runId || !newStatus) {
    return jsonError("Missing required fields: run_id, status");
  }

  const validStatuses = ["pending", "running", "completed", "failed", "cancelled", "timeout"];
  if (!validStatuses.includes(newStatus)) {
    return jsonError(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
  }

  // Build the update payload
  const updatePayload: Record<string, unknown> = { status: newStatus };

  // Set timing fields based on status transition
  if (newStatus === "running") {
    updatePayload.started_at = new Date().toISOString();
  }

  if (["completed", "failed", "cancelled", "timeout"].includes(newStatus)) {
    updatePayload.completed_at = new Date().toISOString();

    // Calculate duration if started_at exists
    const { data: current } = await supabase
      .from("agent_runs")
      .select("started_at")
      .eq("run_id", runId)
      .single();

    if (current?.started_at) {
      const startedAt = new Date(current.started_at).getTime();
      updatePayload.duration_ms = Date.now() - startedAt;
    }
  }

  // Optional result fields
  if (params.output_summary !== undefined) updatePayload.output_summary = params.output_summary;
  if (params.output_data !== undefined) updatePayload.output_data = params.output_data;
  if (params.error_message !== undefined) updatePayload.error_message = params.error_message;
  if (params.thought_ids !== undefined) updatePayload.thought_ids = params.thought_ids;
  if (params.total_input_tokens !== undefined) updatePayload.total_input_tokens = params.total_input_tokens;
  if (params.total_output_tokens !== undefined) updatePayload.total_output_tokens = params.total_output_tokens;
  if (params.total_cost_usd !== undefined) updatePayload.total_cost_usd = params.total_cost_usd;
  if (params.iteration_count !== undefined) updatePayload.iteration_count = params.iteration_count;

  const { data, error } = await supabase
    .from("agent_runs")
    .update(updatePayload)
    .eq("run_id", runId)
    .select()
    .single();

  if (error) {
    return jsonError(error.message, 500);
  }

  if (!data) {
    return jsonError(`Agent run not found: ${runId}`, 404);
  }

  return jsonOk({ run: data, updated: true });
}

/**
 * get_agent_run — get agent run details by run_id.
 *
 * Required: run_id
 */
async function handleGetAgentRun(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const runId = params.run_id as string | undefined;
  if (!runId) {
    return jsonError("Missing required field: run_id");
  }

  const { data, error } = await supabase
    .from("agent_runs")
    .select("*")
    .eq("run_id", runId)
    .single();

  if (error) {
    return jsonError(`Agent run not found: ${runId}`, 404);
  }

  return jsonOk({ run: data });
}

/**
 * list_agent_runs — list runs with optional filters.
 *
 * Optional: coordinator_run_id, status, agent_type, limit (default 50),
 *           offset (default 0)
 */
async function handleListAgentRuns(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  // SECURITY: Cap limit to prevent unbounded result sets
  const limit = Math.min((params.limit as number) ?? 50, 200);
  const offset = Math.max((params.offset as number) ?? 0, 0);

  let query = supabase
    .from("agent_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (params.coordinator_run_id) {
    // Accept both UUID and run_id string
    const coordId = params.coordinator_run_id as string;

    // Try to find by run_id first if it looks like a run_id
    if (coordId.startsWith("agent_") || coordId.startsWith("coord_")) {
      const { data: coordRun } = await supabase
        .from("agent_runs")
        .select("id")
        .eq("run_id", coordId)
        .maybeSingle();

      if (coordRun) {
        query = query.eq("coordinator_run_id", coordRun.id);
      } else {
        query = query.eq("coordinator_run_id", coordId);
      }
    } else {
      query = query.eq("coordinator_run_id", coordId);
    }
  }

  if (params.status) {
    const validStatuses = ["pending", "running", "completed", "failed", "cancelled", "timeout"];
    if (!validStatuses.includes(params.status as string)) {
      return jsonError(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
    }
    query = query.eq("status", params.status as string);
  }

  if (params.agent_type) {
    query = query.eq("agent_type_name", params.agent_type as string);
  }

  const { data, error } = await query;

  if (error) {
    return jsonError(error.message, 500);
  }

  return jsonOk({ runs: data, count: data?.length ?? 0 });
}

// ---------------------------------------------------------------------------
// Inter-Agent Communication
// ---------------------------------------------------------------------------

/**
 * send_message — send an inter-agent message.
 *
 * Required: coordinator_run_id, from_run_id, content
 * Optional: to_run_id (null = broadcast), channel, message_type, summary, thought_id
 */
async function handleSendMessage(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const coordinatorRunId = params.coordinator_run_id as string | undefined;
  const fromRunId = params.from_run_id as string | undefined;
  const content = params.content as Record<string, unknown> | undefined;

  if (!coordinatorRunId || !fromRunId || !content) {
    return jsonError("Missing required fields: coordinator_run_id, from_run_id, content");
  }

  // Validate message_type
  const messageType = (params.message_type as string) ?? "data";
  const validTypes = ["data", "finding", "request", "status_update", "error", "completion"];
  if (!validTypes.includes(messageType)) {
    return jsonError(`Invalid message_type. Must be one of: ${validTypes.join(", ")}`);
  }

  // Resolve run_id strings to UUIDs for FK references
  const { data: coordRun } = await supabase
    .from("agent_runs")
    .select("id")
    .eq("run_id", coordinatorRunId)
    .maybeSingle();

  const resolvedCoordId = coordRun?.id ?? coordinatorRunId;

  const { data: fromRun } = await supabase
    .from("agent_runs")
    .select("id")
    .eq("run_id", fromRunId)
    .maybeSingle();

  const resolvedFromId = fromRun?.id ?? fromRunId;

  let resolvedToId: string | null = null;
  if (params.to_run_id) {
    const { data: toRun } = await supabase
      .from("agent_runs")
      .select("id")
      .eq("run_id", params.to_run_id as string)
      .maybeSingle();

    resolvedToId = toRun?.id ?? (params.to_run_id as string);
  }

  const { data, error } = await supabase
    .from("agent_messages")
    .insert({
      coordinator_run_id: resolvedCoordId,
      from_run_id: resolvedFromId,
      to_run_id: resolvedToId,
      channel: (params.channel as string) ?? "default",
      message_type: messageType,
      content,
      summary: params.summary ?? null,
      thought_id: params.thought_id ?? null,
    })
    .select("id, created_at")
    .single();

  if (error) {
    return jsonError(error.message, 500);
  }

  return jsonOk({
    message_id: data.id,
    sent: true,
    created_at: data.created_at,
  });
}

/**
 * get_messages — get messages for an agent.
 *
 * Required: coordinator_run_id, run_id
 * Optional: undelivered_only (default true), channel, limit (default 50)
 */
async function handleGetMessages(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const coordinatorRunId = params.coordinator_run_id as string | undefined;
  const runId = params.run_id as string | undefined;

  if (!coordinatorRunId || !runId) {
    return jsonError("Missing required fields: coordinator_run_id, run_id");
  }

  const undeliveredOnly = params.undelivered_only !== false;
  // SECURITY: Cap limit to prevent unbounded result sets
  const limit = Math.min((params.limit as number) ?? 50, 500);

  // Resolve run_id strings to UUIDs
  const { data: coordRun } = await supabase
    .from("agent_runs")
    .select("id")
    .eq("run_id", coordinatorRunId)
    .maybeSingle();

  const resolvedCoordId = coordRun?.id ?? coordinatorRunId;

  const { data: agentRun } = await supabase
    .from("agent_runs")
    .select("id")
    .eq("run_id", runId)
    .maybeSingle();

  const resolvedRunId = agentRun?.id ?? runId;

  let query = supabase
    .from("agent_messages")
    .select("*")
    .eq("coordinator_run_id", resolvedCoordId)
    .or(`to_run_id.eq.${resolvedRunId},to_run_id.is.null`)
    .order("created_at")
    .limit(limit);

  if (undeliveredOnly) {
    query = query.eq("delivered", false);
  }

  if (params.channel) {
    query = query.eq("channel", params.channel as string);
  }

  const { data, error } = await query;

  if (error) {
    return jsonError(error.message, 500);
  }

  return jsonOk({
    messages: data ?? [],
    count: data?.length ?? 0,
    undelivered_only: undeliveredOnly,
  });
}

/**
 * mark_delivered — mark messages as delivered.
 *
 * Required: message_ids (uuid[])
 */
async function handleMarkDelivered(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const messageIds = params.message_ids as string[] | undefined;

  if (!messageIds || messageIds.length === 0) {
    return jsonError("Missing required field: message_ids (non-empty array)");
  }

  // SECURITY: Cap array size to prevent oversized IN() queries
  if (messageIds.length > 500) {
    return jsonError("Maximum 500 message IDs per request");
  }

  const { error, count } = await supabase
    .from("agent_messages")
    .update({
      delivered: true,
      delivered_at: new Date().toISOString(),
    })
    .in("id", messageIds);

  if (error) {
    return jsonError(error.message, 500);
  }

  return jsonOk({
    marked_delivered: true,
    count: count ?? messageIds.length,
    delivered_at: new Date().toISOString(),
  });
}

/**
 * get_agent_summary — get summary of a coordinator's agents.
 * Returns counts by status, total cost, and timing stats.
 *
 * Required: coordinator_run_id
 */
async function handleGetAgentSummary(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const coordinatorRunId = params.coordinator_run_id as string | undefined;

  if (!coordinatorRunId) {
    return jsonError("Missing required field: coordinator_run_id");
  }

  // Resolve run_id string to UUID
  const { data: coordRun } = await supabase
    .from("agent_runs")
    .select("id")
    .eq("run_id", coordinatorRunId)
    .maybeSingle();

  const resolvedCoordId = coordRun?.id ?? coordinatorRunId;

  const { data, error } = await supabase
    .from("agent_runs")
    .select(
      "run_id, agent_type_name, status, started_at, completed_at, duration_ms, total_cost_usd, total_input_tokens, total_output_tokens, error_message",
    )
    .eq("coordinator_run_id", resolvedCoordId)
    .order("created_at");

  if (error) {
    return jsonError(error.message, 500);
  }

  const agents = data ?? [];

  // Compute summary
  const statusCounts: Record<string, number> = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    timeout: 0,
  };

  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalDurationMs = 0;
  const failedAgents: Array<{ run_id: string; agent_type: string; error: string | null }> = [];

  for (const agent of agents) {
    const status = agent.status as string;
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    totalCostUsd += Number(agent.total_cost_usd ?? 0);
    totalInputTokens += Number(agent.total_input_tokens ?? 0);
    totalOutputTokens += Number(agent.total_output_tokens ?? 0);
    totalDurationMs += Number(agent.duration_ms ?? 0);

    if (["failed", "timeout", "cancelled"].includes(status)) {
      failedAgents.push({
        run_id: agent.run_id,
        agent_type: agent.agent_type_name,
        error: agent.error_message,
      });
    }
  }

  // Determine overall status
  let overallStatus: string;
  if (agents.length === 0) {
    overallStatus = "empty";
  } else if (statusCounts.running > 0 || statusCounts.pending > 0) {
    overallStatus = "in_progress";
  } else if (statusCounts.failed > 0 || statusCounts.timeout > 0) {
    overallStatus = "completed_with_errors";
  } else {
    overallStatus = "completed";
  }

  return jsonOk({
    coordinator_run_id: coordinatorRunId,
    overall_status: overallStatus,
    total_agents: agents.length,
    by_status: statusCounts,
    totals: {
      cost_usd: totalCostUsd,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      duration_ms: totalDurationMs,
    },
    failed_agents: failedAgents,
    agents: agents.map((a) => ({
      run_id: a.run_id,
      agent_type: a.agent_type_name,
      status: a.status,
      duration_ms: a.duration_ms,
      cost_usd: a.total_cost_usd,
    })),
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth check
  const accessKey = req.headers.get("x-access-key");
  if (accessKey !== Deno.env.get("OB1_ACCESS_KEY")) {
    return jsonError("Unauthorized", 401);
  }

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  const { action, ...params } = body;

  // Initialize Supabase client
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Route by action
  switch (action) {
    // Agent type management
    case "list_agent_types":
      return handleListAgentTypes(supabase, params);

    case "register_agent_type":
      return handleRegisterAgentType(supabase, params);

    // Agent run lifecycle
    case "spawn_agent":
      return handleSpawnAgent(supabase, params);

    case "update_agent_status":
      return handleUpdateAgentStatus(supabase, params);

    case "get_agent_run":
      return handleGetAgentRun(supabase, params);

    case "list_agent_runs":
      return handleListAgentRuns(supabase, params);

    // Inter-agent messaging
    case "send_message":
      return handleSendMessage(supabase, params);

    case "get_messages":
      return handleGetMessages(supabase, params);

    case "mark_delivered":
      return handleMarkDelivered(supabase, params);

    // Coordinator summary
    case "get_agent_summary":
      return handleGetAgentSummary(supabase, params);

    default:
      return jsonError(
        `Unknown action: ${action}. Valid actions: list_agent_types, register_agent_type, spawn_agent, update_agent_status, get_agent_run, list_agent_runs, send_message, get_messages, mark_delivered, get_agent_summary`,
      );
  }
});
