// =============================================================================
// agent-stream Edge Function
// Handles system event logging, event querying, verification, and cleanup.
// Routes via POST body: { "action": "log_event" | "log_events_batch" | ... }
// =============================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-access-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SystemEventInput {
  session_id: string;
  category: string;
  severity: string;
  title: string;
  detail?: Record<string, unknown>;
  sequence?: number;
}

interface QueryEventsParams {
  session_id?: string;
  category?: string;
  severity?: string;
  min_severity?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

interface VerificationInput {
  session_id: string;
  trigger: string;
  results: Array<{
    name: string;
    passed: boolean;
    message: string;
    severity: "blocking" | "warning" | "info";
    evidence?: unknown[];
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEVERITY_LEVELS = ["debug", "info", "warn", "error", "critical"] as const;

const VALID_CATEGORIES = new Set([
  "initialization", "registry", "tool_selection", "permission",
  "execution", "stream", "turn_complete", "session",
  "compaction", "usage", "error", "hook", "verification",
  "boot", "doctor", "config",
]);

const VALID_TRIGGERS = new Set([
  "prompt_change", "model_swap", "tool_change",
  "routing_change", "manual", "post_session", "scheduled",
]);

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

function validateEvent(event: SystemEventInput): string | null {
  if (!event.session_id) return "session_id is required";
  if (!event.category) return "category is required";
  if (!VALID_CATEGORIES.has(event.category)) {
    return `Invalid category: ${event.category}`;
  }
  if (!event.severity) return "severity is required";
  if (!SEVERITY_LEVELS.includes(event.severity as typeof SEVERITY_LEVELS[number])) {
    return `Invalid severity: ${event.severity}`;
  }
  if (!event.title) return "title is required";
  if (event.title.length > 200) return "title must be 200 characters or fewer";
  return null;
}

function severityIndex(s: string): number {
  return SEVERITY_LEVELS.indexOf(s as typeof SEVERITY_LEVELS[number]);
}

// ---------------------------------------------------------------------------
// Action Handlers
// ---------------------------------------------------------------------------

async function handleLogEvent(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const event = params as unknown as SystemEventInput;
  const validationError = validateEvent(event);
  if (validationError) return errorResponse(validationError);

  const row = {
    event_id: crypto.randomUUID(),
    session_id: event.session_id,
    category: event.category,
    severity: event.severity,
    title: event.title,
    detail: event.detail ?? {},
    sequence: event.sequence ?? 0,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("system_events").insert(row);
  if (error) return errorResponse(`Failed to insert event: ${error.message}`, 500);

  return jsonResponse({ ok: true, event_id: row.event_id });
}

async function handleLogEventsBatch(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const events = params.events as SystemEventInput[] | undefined;
  if (!Array.isArray(events) || events.length === 0) {
    return errorResponse("events array is required and must not be empty");
  }
  if (events.length > 500) {
    return errorResponse("Maximum batch size is 500 events");
  }

  const errors: string[] = [];
  const rows = events.map((event, idx) => {
    const validationError = validateEvent(event);
    if (validationError) {
      errors.push(`Event[${idx}]: ${validationError}`);
    }
    return {
      event_id: crypto.randomUUID(),
      session_id: event.session_id,
      category: event.category,
      severity: event.severity,
      title: event.title,
      detail: event.detail ?? {},
      sequence: event.sequence ?? idx,
      created_at: new Date().toISOString(),
    };
  });

  if (errors.length > 0) {
    return errorResponse(`Validation errors: ${errors.join("; ")}`);
  }

  const { error } = await supabase.from("system_events").insert(rows);
  if (error) return errorResponse(`Failed to insert batch: ${error.message}`, 500);

  return jsonResponse({
    ok: true,
    inserted: rows.length,
    event_ids: rows.map((r) => r.event_id),
  });
}

async function handleQueryEvents(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const p = params as unknown as QueryEventsParams;
  const limit = Math.min(p.limit ?? 50, 1000);
  const offset = p.offset ?? 0;

  let query = supabase
    .from("system_events")
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (p.session_id) {
    query = query.eq("session_id", p.session_id);
  }
  if (p.category) {
    query = query.eq("category", p.category);
  }
  if (p.severity) {
    query = query.eq("severity", p.severity);
  }
  if (p.min_severity) {
    const minIdx = severityIndex(p.min_severity);
    if (minIdx >= 0) {
      const allowed = SEVERITY_LEVELS.slice(minIdx);
      query = query.in("severity", [...allowed]);
    }
  }
  if (p.since) {
    query = query.gte("created_at", p.since);
  }
  if (p.until) {
    query = query.lte("created_at", p.until);
  }

  const { data, error, count } = await query;
  if (error) return errorResponse(`Query failed: ${error.message}`, 500);

  return jsonResponse({ events: data ?? [], count: data?.length ?? 0, offset, limit });
}

async function handleGetEventSummary(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const sessionId = params.session_id as string | undefined;
  if (!sessionId) return errorResponse("session_id is required");

  const { data, error } = await supabase
    .from("session_event_summary")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (error) return errorResponse(`Query failed: ${error.message}`, 500);
  if (!data) return jsonResponse({ summary: null, message: "No events found for session" });

  return jsonResponse({ summary: data });
}

async function handleRunVerification(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const input = params as unknown as VerificationInput;

  if (!input.session_id) return errorResponse("session_id is required");
  if (!input.trigger) return errorResponse("trigger is required");
  if (!VALID_TRIGGERS.has(input.trigger)) {
    return errorResponse(`Invalid trigger: ${input.trigger}. Must be one of: ${[...VALID_TRIGGERS].join(", ")}`);
  }
  if (!Array.isArray(input.results) || input.results.length === 0) {
    return errorResponse("results array is required and must not be empty");
  }

  const passed = input.results.filter((r) => r.passed).length;
  const failed = input.results.filter((r) => !r.passed && r.severity === "blocking").length;
  const warnings = input.results.filter((r) => !r.passed && r.severity !== "blocking").length;

  let verdict: "pass" | "fail" | "warn";
  if (failed > 0) {
    verdict = "fail";
  } else if (warnings > 0) {
    verdict = "warn";
  } else {
    verdict = "pass";
  }

  const runId = crypto.randomUUID();
  const row = {
    run_id: runId,
    session_id: input.session_id,
    trigger: input.trigger,
    verdict,
    passed,
    failed,
    warnings,
    results: input.results,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("verification_runs").insert(row);
  if (error) return errorResponse(`Failed to store verification run: ${error.message}`, 500);

  // Also log as a system event for cross-referencing
  await supabase.from("system_events").insert({
    event_id: crypto.randomUUID(),
    session_id: input.session_id,
    category: "verification",
    severity: verdict === "fail" ? "error" : verdict === "warn" ? "warn" : "info",
    title: `Verification: ${passed}P/${failed}F/${warnings}W (${input.trigger})`,
    detail: { run_id: runId, verdict, passed, failed, warnings, trigger: input.trigger },
    sequence: 0,
    created_at: new Date().toISOString(),
  });

  return jsonResponse({ ok: true, run_id: runId, verdict, passed, failed, warnings });
}

async function handleGetVerificationRuns(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const sessionId = params.session_id as string | undefined;
  const limit = Math.min((params.limit as number) ?? 20, 100);
  const verdictFilter = params.verdict as string | undefined;

  let query = supabase
    .from("verification_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (sessionId) {
    query = query.eq("session_id", sessionId);
  }
  if (verdictFilter) {
    query = query.eq("verdict", verdictFilter);
  }

  const { data, error } = await query;
  if (error) return errorResponse(`Query failed: ${error.message}`, 500);

  return jsonResponse({ runs: data ?? [], count: data?.length ?? 0 });
}

async function handleCleanupEvents(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const retentionDays = (params.retention_days as number) ?? 30;
  if (retentionDays < 1 || retentionDays > 365) {
    return errorResponse("retention_days must be between 1 and 365");
  }

  // Call the cleanup_old_system_events database function
  const { data, error } = await supabase.rpc("cleanup_old_system_events", {
    retention_days: retentionDays,
  });

  if (error) return errorResponse(`Cleanup failed: ${error.message}`, 500);

  // Log the cleanup as a system event
  await supabase.from("system_events").insert({
    event_id: crypto.randomUUID(),
    session_id: "system",
    category: "session",
    severity: "info",
    title: `Event cleanup: ${data ?? 0} events removed (retention: ${retentionDays}d)`,
    detail: { deleted_count: data ?? 0, retention_days: retentionDays },
    sequence: 0,
    created_at: new Date().toISOString(),
  });

  return jsonResponse({ ok: true, deleted_count: data ?? 0, retention_days: retentionDays });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const ACTION_HANDLERS: Record<
  string,
  (supabase: SupabaseClient, params: Record<string, unknown>) => Promise<Response>
> = {
  log_event: handleLogEvent,
  log_events_batch: handleLogEventsBatch,
  query_events: handleQueryEvents,
  get_event_summary: handleGetEventSummary,
  run_verification: handleRunVerification,
  get_verification_runs: handleGetVerificationRuns,
  cleanup_events: handleCleanupEvents,
};

// ---------------------------------------------------------------------------
// Entry Point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== "POST") {
    return errorResponse("Method not allowed. Use POST.", 405);
  }

  // Auth: x-access-key header
  const accessKey = req.headers.get("x-access-key");
  if (accessKey !== Deno.env.get("OB1_ACCESS_KEY")) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const { action, ...params } = body;
  if (!action || typeof action !== "string") {
    return errorResponse(
      `action is required. Valid actions: ${Object.keys(ACTION_HANDLERS).join(", ")}`,
    );
  }

  const handler = ACTION_HANDLERS[action];
  if (!handler) {
    return errorResponse(
      `Unknown action: ${action}. Valid actions: ${Object.keys(ACTION_HANDLERS).join(", ")}`,
    );
  }

  // Create Supabase client
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    return await handler(supabase, params);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent-stream] action=${action} error:`, message);
    return errorResponse(`Internal error: ${message}`, 500);
  }
});
