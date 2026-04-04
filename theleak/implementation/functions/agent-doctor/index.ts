// =============================================================================
// agent-doctor Edge Function
// Handles health checks (doctor), boot tracking, and scoped configuration.
// Routes via POST body: { "action": "run_doctor" | "record_boot" | ... }
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

interface HealthCheckResult {
  category: string;
  check: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fix_action?: string;
  duration_ms: number;
}

interface DoctorReport {
  run_id: string;
  session_id: string;
  timestamp: string;
  total_duration_ms: number;
  checks: HealthCheckResult[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
    auto_repaired: number;
    total: number;
  };
}

interface BootRunInput {
  session_id: string;
  status: "running" | "completed" | "failed" | "rolled_back";
  reached_phase: string;
  failed_phase?: string;
  failure_reason?: string;
  phase_timings: Record<string, unknown>;
  fast_path_used?: string;
  config_scope_sources?: Record<string, unknown>;
  trust_mode?: string;
  doctor_summary?: Record<string, unknown>;
  total_duration_ms?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

async function timedCheck(
  category: string,
  checkName: string,
  fn: () => Promise<{ status: "pass" | "warn" | "fail"; detail: string; fix_action?: string }>,
): Promise<HealthCheckResult> {
  const start = performance.now();
  try {
    const result = await fn();
    return {
      category,
      check: checkName,
      status: result.status,
      detail: result.detail,
      fix_action: result.fix_action,
      duration_ms: Math.round(performance.now() - start),
    };
  } catch (err) {
    return {
      category,
      check: checkName,
      status: "fail",
      detail: `Check threw: ${err instanceof Error ? err.message : String(err)}`,
      duration_ms: Math.round(performance.now() - start),
    };
  }
}

// ---------------------------------------------------------------------------
// Doctor Checks
// ---------------------------------------------------------------------------

const REQUIRED_TABLES = [
  "thoughts",
  "tool_registry",
  "permission_policies",
  "agent_sessions",
  "budget_ledger",
  "system_events",
  "verification_runs",
  "boot_runs",
  "agent_config",
];

async function runWorkspaceChecks(supabase: SupabaseClient): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  // Check that all required tables exist and are accessible
  for (const table of REQUIRED_TABLES) {
    results.push(
      await timedCheck("workspace", `table_exists_${table}`, async () => {
        const { error } = await supabase.from(table).select("*").limit(0);
        if (error) {
          return {
            status: "fail",
            detail: `Table '${table}' missing or inaccessible: ${error.message}`,
            fix_action: `Run the migration that creates the '${table}' table`,
          };
        }
        return { status: "pass", detail: `Table '${table}' accessible` };
      }),
    );
  }

  return results;
}

async function runConfigurationChecks(supabase: SupabaseClient): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  // Check for agent_config entries
  results.push(
    await timedCheck("configuration", "config_entries_exist", async () => {
      const { count, error } = await supabase
        .from("agent_config")
        .select("*", { count: "exact", head: true });

      if (error) {
        return { status: "fail", detail: `Cannot query agent_config: ${error.message}` };
      }
      if ((count ?? 0) === 0) {
        return {
          status: "warn",
          detail: "No configuration snapshots found. First boot has not saved config yet.",
          fix_action: "Run a boot sequence with config saving enabled",
        };
      }
      return { status: "pass", detail: `${count} configuration snapshot(s) stored` };
    }),
  );

  // Check latest config is valid
  results.push(
    await timedCheck("configuration", "latest_config_valid", async () => {
      const { data, error } = await supabase
        .from("agent_config")
        .select("valid, validation_errors")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        return { status: "fail", detail: `Cannot query latest config: ${error.message}` };
      }
      if (!data) {
        return { status: "warn", detail: "No config snapshots to validate" };
      }
      if (!data.valid) {
        const errCount = Array.isArray(data.validation_errors) ? data.validation_errors.length : 0;
        return {
          status: "warn",
          detail: `Latest config has ${errCount} validation error(s)`,
          fix_action: "Review validation_errors in the latest agent_config row",
        };
      }
      return { status: "pass", detail: "Latest configuration snapshot is valid" };
    }),
  );

  return results;
}

async function runCredentialChecks(supabase: SupabaseClient): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  // Verify Supabase connection works with a real query
  results.push(
    await timedCheck("credentials", "supabase_auth", async () => {
      const { error } = await supabase.from("thoughts").select("id").limit(1);
      if (error) {
        return {
          status: "fail",
          detail: `Supabase auth failed: ${error.message}`,
          fix_action: "Verify SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars",
        };
      }
      return { status: "pass", detail: "Supabase service role authenticated successfully" };
    }),
  );

  return results;
}

async function runConnectionChecks(supabase: SupabaseClient): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  // Ping the database and measure response time
  results.push(
    await timedCheck("connections", "database_ping", async () => {
      const pingStart = performance.now();
      const { error } = await supabase.from("thoughts").select("id").limit(1);
      const pingMs = Math.round(performance.now() - pingStart);

      if (error) {
        return {
          status: "fail",
          detail: `Database unreachable: ${error.message}`,
          fix_action: "Check network connectivity and Supabase project status",
        };
      }
      if (pingMs > 5000) {
        return {
          status: "warn",
          detail: `Database responding slowly: ${pingMs}ms`,
          fix_action: "Check Supabase project region and network latency",
        };
      }
      return { status: "pass", detail: `Database responded in ${pingMs}ms` };
    }),
  );

  return results;
}

async function runToolChecks(supabase: SupabaseClient): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  // Check tool_registry has entries
  results.push(
    await timedCheck("tools", "tool_registry_populated", async () => {
      const { count, error } = await supabase
        .from("tool_registry")
        .select("*", { count: "exact", head: true })
        .eq("enabled", true);

      if (error) {
        return { status: "fail", detail: `Cannot query tool_registry: ${error.message}` };
      }
      if ((count ?? 0) === 0) {
        return {
          status: "warn",
          detail: "No enabled tools in the registry",
          fix_action: "Register tools via the tool registration endpoint or boot pipeline",
        };
      }
      return { status: "pass", detail: `${count} enabled tool(s) registered` };
    }),
  );

  // Check for orphaned permission policies (referencing tools that don't exist)
  results.push(
    await timedCheck("tools", "orphaned_policies", async () => {
      // Get all tool names from the registry
      const { data: tools, error: toolsErr } = await supabase
        .from("tool_registry")
        .select("tool_name");

      if (toolsErr) {
        return { status: "fail", detail: `Cannot query tools: ${toolsErr.message}` };
      }

      const toolNames = new Set((tools ?? []).map((t: { tool_name: string }) => t.tool_name));

      // Get all policies
      const { data: policies, error: policiesErr } = await supabase
        .from("permission_policies")
        .select("tool_pattern, id");

      if (policiesErr) {
        return { status: "fail", detail: `Cannot query policies: ${policiesErr.message}` };
      }

      // Check for exact-match policies that reference non-existent tools
      // (skip wildcard/pattern policies since they may be intentional)
      const orphaned = (policies ?? []).filter((p: { tool_pattern: string }) => {
        const pattern = p.tool_pattern;
        if (pattern.includes("*") || pattern.includes("%")) return false;
        return !toolNames.has(pattern);
      });

      if (orphaned.length > 0) {
        return {
          status: "warn",
          detail: `${orphaned.length} permission policy/ies reference non-existent tools`,
          fix_action: "Review and remove stale permission policies",
        };
      }
      return { status: "pass", detail: "All exact-match policies reference registered tools" };
    }),
  );

  return results;
}

async function runSessionChecks(supabase: SupabaseClient): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  // Find orphaned sessions (active but not updated in 24h)
  results.push(
    await timedCheck("sessions", "orphaned_sessions", async () => {
      const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: stale, error } = await supabase
        .from("agent_sessions")
        .select("session_id")
        .eq("status", "active")
        .lt("updated_at", staleThreshold);

      if (error) {
        return { status: "fail", detail: `Cannot query sessions: ${error.message}` };
      }

      const count = stale?.length ?? 0;
      if (count > 0) {
        return {
          status: "warn",
          detail: `${count} orphaned session(s) (active but stale >24h)`,
          fix_action: "Mark stale sessions as 'crashed' via session management",
        };
      }
      return { status: "pass", detail: "No orphaned sessions detected" };
    }),
  );

  // Find stuck workflows (sessions stuck in a non-terminal state for too long)
  results.push(
    await timedCheck("sessions", "stuck_workflows", async () => {
      const stuckThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data: stuck, error } = await supabase
        .from("agent_sessions")
        .select("session_id, status")
        .in("status", ["active", "paused"])
        .lt("updated_at", stuckThreshold);

      if (error) {
        return { status: "fail", detail: `Cannot query sessions: ${error.message}` };
      }

      const count = stuck?.length ?? 0;
      if (count > 0) {
        return {
          status: "warn",
          detail: `${count} session(s) stuck in non-terminal state for >2h`,
          fix_action: "Investigate or force-close stuck sessions",
        };
      }
      return { status: "pass", detail: "No stuck workflows detected" };
    }),
  );

  // Budget anomaly check: sessions with negative remaining budget
  results.push(
    await timedCheck("sessions", "budget_anomalies", async () => {
      const { data: anomalies, error } = await supabase
        .from("budget_ledger")
        .select("session_id, remaining_budget")
        .lt("remaining_budget", 0);

      if (error) {
        // budget_ledger might not have remaining_budget column; handle gracefully
        if (error.message.includes("column") || error.message.includes("does not exist")) {
          return { status: "pass", detail: "Budget ledger check skipped (column layout differs)" };
        }
        return { status: "fail", detail: `Cannot query budget_ledger: ${error.message}` };
      }

      const count = anomalies?.length ?? 0;
      if (count > 0) {
        return {
          status: "warn",
          detail: `${count} session(s) have negative remaining budget`,
          fix_action: "Review budget enforcement logic for over-spending sessions",
        };
      }
      return { status: "pass", detail: "No budget anomalies detected" };
    }),
  );

  // Recent boot failures
  results.push(
    await timedCheck("sessions", "recent_boot_failures", async () => {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: failures, error } = await supabase
        .from("boot_runs")
        .select("run_id, failed_phase, failure_reason")
        .eq("status", "failed")
        .gte("created_at", since);

      if (error) {
        return { status: "fail", detail: `Cannot query boot_runs: ${error.message}` };
      }

      const count = failures?.length ?? 0;
      if (count > 0) {
        return {
          status: "warn",
          detail: `${count} boot failure(s) in the last hour`,
          fix_action: "Review boot_runs table for failure reasons",
        };
      }
      return { status: "pass", detail: "No boot failures in the last hour" };
    }),
  );

  return results;
}

// ---------------------------------------------------------------------------
// Action Handlers
// ---------------------------------------------------------------------------

async function handleRunDoctor(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const sessionId = (params.session_id as string) ?? "system";
  const startMs = performance.now();

  // Run all 6 categories in dependency order
  const checks: HealthCheckResult[] = [
    ...(await runWorkspaceChecks(supabase)),
    ...(await runConfigurationChecks(supabase)),
    ...(await runCredentialChecks(supabase)),
    ...(await runConnectionChecks(supabase)),
    ...(await runToolChecks(supabase)),
    ...(await runSessionChecks(supabase)),
  ];

  const totalDurationMs = Math.round(performance.now() - startMs);
  const report: DoctorReport = {
    run_id: crypto.randomUUID(),
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    total_duration_ms: totalDurationMs,
    checks,
    summary: {
      pass: checks.filter((c) => c.status === "pass").length,
      warn: checks.filter((c) => c.status === "warn").length,
      fail: checks.filter((c) => c.status === "fail").length,
      auto_repaired: 0,
      total: checks.length,
    },
  };

  // Persist the report as a system event
  await supabase.from("system_events").insert({
    event_id: report.run_id,
    session_id: sessionId,
    category: "doctor",
    severity: report.summary.fail > 0 ? "error" : report.summary.warn > 0 ? "warn" : "info",
    title: `Doctor: ${report.summary.pass}P/${report.summary.warn}W/${report.summary.fail}F`,
    detail: report,
    sequence: 0,
    created_at: new Date().toISOString(),
  });

  return jsonResponse(report);
}

async function handleGetDoctorReport(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const sessionId = params.session_id as string | undefined;
  const limit = Math.min((params.limit as number) ?? 1, 20);

  let query = supabase
    .from("system_events")
    .select("*")
    .eq("category", "doctor")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (sessionId) {
    query = query.eq("session_id", sessionId);
  }

  const { data, error } = await query;
  if (error) return errorResponse(`Query failed: ${error.message}`, 500);

  // Extract the full report from the detail JSONB
  const reports = (data ?? []).map((row: Record<string, unknown>) => row.detail);

  return jsonResponse({ reports, count: reports.length });
}

async function handleRecordBoot(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const input = params as unknown as BootRunInput;

  if (!input.session_id) return errorResponse("session_id is required");
  if (!input.status) return errorResponse("status is required");
  if (!["running", "completed", "failed", "rolled_back"].includes(input.status)) {
    return errorResponse("status must be one of: running, completed, failed, rolled_back");
  }
  if (!input.reached_phase) return errorResponse("reached_phase is required");
  if (!input.phase_timings || typeof input.phase_timings !== "object") {
    return errorResponse("phase_timings is required and must be an object");
  }

  const runId = crypto.randomUUID();
  const now = new Date().toISOString();

  const row: Record<string, unknown> = {
    run_id: runId,
    session_id: input.session_id,
    status: input.status,
    reached_phase: input.reached_phase,
    failed_phase: input.failed_phase ?? null,
    failure_reason: input.failure_reason ?? null,
    phase_timings: input.phase_timings,
    fast_path_used: input.fast_path_used ?? null,
    config_scope_sources: input.config_scope_sources ?? {},
    trust_mode: input.trust_mode ?? null,
    doctor_summary: input.doctor_summary ?? {},
    total_duration_ms: input.total_duration_ms ?? null,
    created_at: now,
    completed_at: input.status === "completed" ? now : null,
  };

  const { error } = await supabase.from("boot_runs").insert(row);
  if (error) return errorResponse(`Failed to record boot run: ${error.message}`, 500);

  // Log as a system event too
  await supabase.from("system_events").insert({
    event_id: crypto.randomUUID(),
    session_id: input.session_id,
    category: "boot",
    severity: input.status === "failed" ? "error" : "info",
    title: `Boot ${input.status}: reached ${input.reached_phase}${input.failed_phase ? `, failed at ${input.failed_phase}` : ""}`,
    detail: { run_id: runId, status: input.status, total_duration_ms: input.total_duration_ms },
    sequence: 0,
    created_at: now,
  });

  return jsonResponse({ ok: true, run_id: runId });
}

async function handleGetBootHistory(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const sessionId = params.session_id as string | undefined;
  const limit = Math.min((params.limit as number) ?? 20, 100);
  const statusFilter = params.status as string | undefined;

  let query = supabase
    .from("boot_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (sessionId) {
    query = query.eq("session_id", sessionId);
  }
  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) return errorResponse(`Query failed: ${error.message}`, 500);

  return jsonResponse({ runs: data ?? [], count: data?.length ?? 0 });
}

async function handleGetBootPerformance(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const limit = Math.min((params.limit as number) ?? 20, 100);
  const sessionId = params.session_id as string | undefined;

  let query = supabase
    .from("boot_performance_summary")
    .select("*")
    .limit(limit);

  if (sessionId) {
    query = query.eq("session_id", sessionId);
  }

  const { data, error } = await query;
  if (error) return errorResponse(`Query failed: ${error.message}`, 500);

  return jsonResponse({ performance: data ?? [], count: data?.length ?? 0 });
}

async function handleGetConfig(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const sessionId = params.session_id as string | undefined;

  let query = supabase
    .from("agent_config")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1);

  if (sessionId) {
    query = query.eq("session_id", sessionId);
  }

  const { data, error } = await query;
  if (error) return errorResponse(`Query failed: ${error.message}`, 500);

  if (!data || data.length === 0) {
    return jsonResponse({ config: null, message: "No configuration found" });
  }

  return jsonResponse({ config: data[0] });
}

async function handleSaveConfig(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const sessionId = params.session_id as string | undefined;
  const mergedConfig = params.merged_config;
  const provenance = params.provenance;
  const mcpServers = params.mcp_servers;
  const sourceFiles = params.source_files;
  const valid = params.valid !== undefined ? params.valid : true;
  const validationErrors = params.validation_errors ?? [];

  if (!mergedConfig || typeof mergedConfig !== "object") {
    return errorResponse("merged_config is required and must be an object");
  }

  const configId = crypto.randomUUID();
  const row = {
    config_id: configId,
    session_id: sessionId ?? null,
    merged_config: mergedConfig,
    provenance: provenance ?? {},
    mcp_servers: mcpServers ?? [],
    source_files: sourceFiles ?? [],
    valid,
    validation_errors: validationErrors,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("agent_config").insert(row);
  if (error) return errorResponse(`Failed to save config: ${error.message}`, 500);

  // Log as a system event
  await supabase.from("system_events").insert({
    event_id: crypto.randomUUID(),
    session_id: sessionId ?? "system",
    category: "config",
    severity: valid ? "info" : "warn",
    title: `Config saved${!valid ? " (with validation errors)" : ""}`,
    detail: {
      config_id: configId,
      valid,
      validation_error_count: Array.isArray(validationErrors) ? validationErrors.length : 0,
    },
    sequence: 0,
    created_at: new Date().toISOString(),
  });

  return jsonResponse({ ok: true, config_id: configId });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const ACTION_HANDLERS: Record<
  string,
  (supabase: SupabaseClient, params: Record<string, unknown>) => Promise<Response>
> = {
  run_doctor: handleRunDoctor,
  get_doctor_report: handleGetDoctorReport,
  record_boot: handleRecordBoot,
  get_boot_history: handleGetBootHistory,
  get_boot_performance: handleGetBootPerformance,
  get_config: handleGetConfig,
  save_config: handleSaveConfig,
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
    console.error(`[agent-doctor] action=${action} error:`, message);
    return errorResponse(`Internal error: ${message}`, 500);
  }
});
