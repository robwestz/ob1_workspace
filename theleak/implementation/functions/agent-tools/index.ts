// supabase/functions/agent-tools/index.ts
//
// Edge Function: Tool Registry & Permission Operations
// Routes all actions through a single POST endpoint with JSON body { action, ...params }
//
// Actions:
//   list_tools       — list tools with optional filters
//   register_tool    — register a new tool definition
//   update_tool      — update an existing tool's metadata
//   get_policies     — list all permission policies
//   set_policy       — create or update a permission policy
//   log_audit        — log a permission decision to the audit trail
//   get_audit_summary — get aggregated audit data for a session
//   assemble_pool    — assemble a filtered tool pool for a given context

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-access-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------- Permission rank (mirrors types/tool-registry.ts) ----------

type PermissionMode =
  | "read_only"
  | "workspace_write"
  | "danger_full_access"
  | "prompt"
  | "allow";

const PERMISSION_RANK: Record<PermissionMode, number> = {
  read_only: 0,
  workspace_write: 1,
  danger_full_access: 2,
  prompt: 3,
  allow: 4,
};

const SIMPLE_MODE_TOOLS = new Set(["read_file", "edit_file", "bash"]);

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

// ---------- Action handlers ----------

interface ActionContext {
  supabase: ReturnType<typeof createClient>;
  params: Record<string, unknown>;
}

/** list_tools — list tools with optional filters: source_type, enabled, permission_level */
async function listTools({ supabase, params }: ActionContext): Promise<Response> {
  const { source_type, enabled, permission_level } = params as {
    source_type?: string;
    enabled?: boolean;
    permission_level?: PermissionMode;
  };

  let query = supabase.from("tool_registry").select("*");

  if (source_type) {
    query = query.eq("source_type", source_type);
  }
  if (typeof enabled === "boolean") {
    query = query.eq("enabled", enabled);
  }

  const { data, error: dbError } = await query.order("name");
  if (dbError) return error(dbError.message, 500);

  let tools = data ?? [];

  // Client-side filter for permission_level (return tools at or below this level)
  if (permission_level && PERMISSION_RANK[permission_level] !== undefined) {
    const maxRank = PERMISSION_RANK[permission_level];
    tools = tools.filter(
      (t: Record<string, unknown>) =>
        PERMISSION_RANK[t.required_permission as PermissionMode] !== undefined &&
        PERMISSION_RANK[t.required_permission as PermissionMode] <= maxRank,
    );
  }

  return json({
    tools,
    meta: { total: tools.length },
  });
}

/** register_tool — register a new tool definition */
async function registerTool({ supabase, params }: ActionContext): Promise<Response> {
  const {
    name,
    description,
    source_type,
    required_permission,
    input_schema,
    side_effect_profile,
    enabled,
    aliases,
    mcp_server_url,
    metadata,
  } = params as {
    name: string;
    description: string;
    source_type: string;
    required_permission?: string;
    input_schema?: Record<string, unknown>;
    side_effect_profile?: Record<string, unknown>;
    enabled?: boolean;
    aliases?: string[];
    mcp_server_url?: string;
    metadata?: Record<string, unknown>;
  };

  if (!name || !description || !source_type) {
    return error("name, description, and source_type are required");
  }

  const row = {
    name,
    description,
    source_type,
    required_permission: required_permission ?? "read_only",
    input_schema: input_schema ?? {},
    side_effect_profile: side_effect_profile ?? {},
    enabled: enabled ?? true,
    aliases: aliases ?? [],
    mcp_server_url: mcp_server_url ?? null,
    metadata: metadata ?? {},
  };

  const { data, error: dbError } = await supabase
    .from("tool_registry")
    .upsert(row, { onConflict: "name" })
    .select()
    .single();

  if (dbError) return error(dbError.message, 500);
  return json({ tool: data }, 201);
}

/** update_tool — update an existing tool's metadata */
async function updateTool({ supabase, params }: ActionContext): Promise<Response> {
  const { name, ...updates } = params as { name: string } & Record<string, unknown>;

  if (!name) {
    return error("name is required to identify the tool to update");
  }

  // Only allow updating known columns
  const allowedFields = new Set([
    "description",
    "source_type",
    "required_permission",
    "input_schema",
    "side_effect_profile",
    "enabled",
    "aliases",
    "mcp_server_url",
    "metadata",
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

  const { data, error: dbError } = await supabase
    .from("tool_registry")
    .update(patch)
    .eq("name", name)
    .select()
    .single();

  if (dbError) return error(dbError.message, 500);
  if (!data) return error(`Tool "${name}" not found`, 404);

  return json({ tool: data });
}

/** get_policies — list all permission policies */
async function getPolicies({ supabase }: ActionContext): Promise<Response> {
  const { data, error: dbError } = await supabase
    .from("permission_policies")
    .select("*")
    .order("name");

  if (dbError) return error(dbError.message, 500);
  return json({ policies: data ?? [] });
}

/** set_policy — create or update a permission policy */
async function setPolicy({ supabase, params }: ActionContext): Promise<Response> {
  const {
    name,
    description,
    active_mode,
    tool_overrides,
    handler_type,
    deny_tools,
    deny_prefixes,
    allow_tools,
    metadata,
  } = params as {
    name: string;
    description?: string;
    active_mode?: string;
    tool_overrides?: Record<string, string>;
    handler_type?: string;
    deny_tools?: string[];
    deny_prefixes?: string[];
    allow_tools?: string[];
    metadata?: Record<string, unknown>;
  };

  if (!name) {
    return error("name is required for a permission policy");
  }

  const row: Record<string, unknown> = { name };
  if (description !== undefined) row.description = description;
  if (active_mode !== undefined) row.active_mode = active_mode;
  if (tool_overrides !== undefined) row.tool_overrides = tool_overrides;
  if (handler_type !== undefined) row.handler_type = handler_type;
  if (deny_tools !== undefined) row.deny_tools = deny_tools;
  if (deny_prefixes !== undefined) row.deny_prefixes = deny_prefixes;
  if (allow_tools !== undefined) row.allow_tools = allow_tools;
  if (metadata !== undefined) row.metadata = metadata;

  const { data, error: dbError } = await supabase
    .from("permission_policies")
    .upsert(row, { onConflict: "name" })
    .select()
    .single();

  if (dbError) return error(dbError.message, 500);
  return json({ policy: data }, 201);
}

/** log_audit — log a permission decision to the audit trail */
async function logAudit({ supabase, params }: ActionContext): Promise<Response> {
  const {
    session_id,
    tool_name,
    decision,
    reason,
    decided_by,
    active_mode,
    required_mode,
    policy_id,
    input_summary,
  } = params as {
    session_id: string;
    tool_name: string;
    decision: string;
    reason?: string;
    decided_by: string;
    active_mode: string;
    required_mode: string;
    policy_id?: string;
    input_summary?: string;
  };

  if (!session_id || !tool_name || !decision || !decided_by || !active_mode || !required_mode) {
    return error(
      "session_id, tool_name, decision, decided_by, active_mode, and required_mode are required",
    );
  }

  const row: Record<string, unknown> = {
    session_id,
    tool_name,
    decision,
    reason: reason ?? null,
    decided_by,
    active_mode,
    required_mode,
    policy_id: policy_id ?? null,
    input_summary: input_summary ?? null,
  };

  const { data, error: dbError } = await supabase
    .from("permission_audit_log")
    .insert(row)
    .select()
    .single();

  if (dbError) return error(dbError.message, 500);
  return json({ audit_entry: data }, 201);
}

/** get_audit_summary — aggregated audit data for a session */
async function getAuditSummary({ supabase, params }: ActionContext): Promise<Response> {
  const { session_id } = params as { session_id: string };

  if (!session_id) {
    return error("session_id is required");
  }

  const { data, error: dbError } = await supabase
    .from("permission_audit_log")
    .select("*")
    .eq("session_id", session_id)
    .order("created_at", { ascending: true });

  if (dbError) return error(dbError.message, 500);

  const entries = data ?? [];
  const totalDecisions = entries.length;
  const denials = entries.filter((e: Record<string, unknown>) => e.decision === "deny");
  const denialCount = denials.length;
  const denialRate = totalDecisions > 0 ? denialCount / totalDecisions : 0;

  // Aggregate top denied tools
  const deniedToolCounts: Record<string, number> = {};
  for (const d of denials) {
    const toolName = d.tool_name as string;
    deniedToolCounts[toolName] = (deniedToolCounts[toolName] ?? 0) + 1;
  }
  const topDeniedTools = Object.entries(deniedToolCounts)
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count);

  // Decision breakdown by type
  const decisionCounts: Record<string, number> = {};
  for (const e of entries) {
    const dec = e.decision as string;
    decisionCounts[dec] = (decisionCounts[dec] ?? 0) + 1;
  }

  return json({
    session_id,
    total_decisions: totalDecisions,
    denial_count: denialCount,
    denial_rate: Math.round(denialRate * 1000) / 1000,
    decision_breakdown: decisionCounts,
    top_denied_tools: topDeniedTools,
  });
}

/** assemble_pool — assemble a filtered tool pool for a given context */
async function assemblePool({ supabase, params }: ActionContext): Promise<Response> {
  const {
    simple_mode,
    include_mcp,
    policy_name,
    deny_tools,
    deny_prefixes,
    allow_tools,
    permission_level,
  } = params as {
    simple_mode?: boolean;
    include_mcp?: boolean;
    policy_name?: string;
    deny_tools?: string[];
    deny_prefixes?: string[];
    allow_tools?: string[];
    permission_level?: PermissionMode;
  };

  // Load all enabled tools from the registry
  const { data: allTools, error: toolsError } = await supabase
    .from("tool_registry")
    .select("*")
    .eq("enabled", true)
    .order("name");

  if (toolsError) return error(toolsError.message, 500);

  let tools = allTools ?? [];

  // Optionally load a named policy and merge its deny/allow lists
  let policyDenyTools: string[] = deny_tools ?? [];
  let policyDenyPrefixes: string[] = deny_prefixes ?? [];
  let policyAllowTools: string[] = allow_tools ?? [];

  if (policy_name) {
    const { data: policy, error: policyError } = await supabase
      .from("permission_policies")
      .select("*")
      .eq("name", policy_name)
      .single();

    if (policyError && policyError.code !== "PGRST116") {
      return error(policyError.message, 500);
    }

    if (policy) {
      // Merge policy deny/allow lists with explicit params (explicit params win)
      if (!deny_tools && policy.deny_tools?.length) {
        policyDenyTools = policy.deny_tools;
      }
      if (!deny_prefixes && policy.deny_prefixes?.length) {
        policyDenyPrefixes = policy.deny_prefixes;
      }
      if (!allow_tools && policy.allow_tools?.length) {
        policyAllowTools = policy.allow_tools;
      }
    }
  }

  const denySet = new Set(policyDenyTools.map((t: string) => t.toLowerCase()));

  // Filter 1: Simple mode — keep only read_file, edit_file, bash
  if (simple_mode) {
    tools = tools.filter((t: Record<string, unknown>) =>
      SIMPLE_MODE_TOOLS.has(t.name as string),
    );
  }

  // Filter 2: MCP exclusion
  if (include_mcp === false) {
    tools = tools.filter(
      (t: Record<string, unknown>) =>
        t.source_type !== "mcp" &&
        !(t.name as string).toLowerCase().startsWith("mcp__"),
    );
  }

  // Filter 3: Deny-list (exact name + prefix match)
  tools = tools.filter((t: Record<string, unknown>) => {
    const lowered = (t.name as string).toLowerCase();
    if (denySet.has(lowered)) return false;
    for (const prefix of policyDenyPrefixes) {
      if (lowered.startsWith(prefix.toLowerCase())) return false;
    }
    return true;
  });

  // Filter 4: Allow-list (if non-empty, keep ONLY named tools)
  if (policyAllowTools.length > 0) {
    const allowSet = new Set(policyAllowTools.map((t: string) => t.toLowerCase()));
    tools = tools.filter((t: Record<string, unknown>) =>
      allowSet.has((t.name as string).toLowerCase()),
    );
  }

  // Filter 5: Permission level ceiling
  if (permission_level && PERMISSION_RANK[permission_level] !== undefined) {
    const maxRank = PERMISSION_RANK[permission_level];
    tools = tools.filter(
      (t: Record<string, unknown>) =>
        PERMISSION_RANK[t.required_permission as PermissionMode] !== undefined &&
        PERMISSION_RANK[t.required_permission as PermissionMode] <= maxRank,
    );
  }

  return json({
    tools,
    meta: {
      total_registered: allTools?.length ?? 0,
      filtered_count: tools.length,
      simple_mode: !!simple_mode,
      include_mcp: include_mcp !== false,
      policy_name: policy_name ?? null,
    },
  });
}

// ---------- Action router ----------

const ACTION_HANDLERS: Record<
  string,
  (ctx: ActionContext) => Promise<Response>
> = {
  list_tools: listTools,
  register_tool: registerTool,
  update_tool: updateTool,
  get_policies: getPolicies,
  set_policy: setPolicy,
  log_audit: logAudit,
  get_audit_summary: getAuditSummary,
  assemble_pool: assemblePool,
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
    console.error(`[agent-tools] action=${action} error:`, message);
    return json({ error: message }, 500);
  }
});
