// =============================================================================
// agent-skills — Edge Function for Skill, Hook & Plugin CRUD
//
// Actions:
//   list_skills          — List skills (filter by source, enabled, plugin)
//   register_skill       — Register a new skill definition
//   update_skill         — Update skill metadata
//   delete_skill         — Remove a skill
//   list_hooks           — List hook configurations
//   register_hook        — Register a hook (PreToolUse / PostToolUse)
//   list_plugins         — List plugins
//   register_plugin      — Register a plugin package
//   update_plugin_status — Enable / disable / uninstall plugin (CASCADE)
//   get_hook_log         — Query hook execution history
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
// Skill actions
// ---------------------------------------------------------------------------

/**
 * list_skills — list skills with optional filters.
 *
 * Optional: source_type, enabled_only (default true), plugin_id, search
 */
async function handleListSkills(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  let query = supabase.from("skill_registry").select("*");

  const enabledOnly = params.enabled_only !== false;
  if (enabledOnly) {
    query = query.eq("enabled", true);
  }

  if (params.source_type) {
    const validSources = ["bundled", "user", "ob1", "mcp_generated"];
    if (!validSources.includes(params.source_type as string)) {
      return jsonError(`Invalid source_type. Must be one of: ${validSources.join(", ")}`);
    }
    query = query.eq("source_type", params.source_type as string);
  }

  if (params.plugin_id) {
    query = query.eq("plugin_id", params.plugin_id as string);
  }

  if (params.search) {
    // SECURITY: Sanitize search input — escape PostgREST filter metacharacters
    // to prevent filter injection via crafted search strings.
    const raw = String(params.search).slice(0, 200); // cap length
    const safe = raw.replace(/[%_\\,.()"']/g, ""); // strip wildcards and filter syntax
    if (safe.length > 0) {
      query = query.or(
        `name.ilike.%${safe}%,description.ilike.%${safe}%`,
      );
    }
  }

  const { data, error } = await query.order("name");

  if (error) {
    return jsonError(error.message, 500);
  }

  return jsonOk({ skills: data, count: data?.length ?? 0 });
}

/**
 * register_skill — register a new skill definition.
 *
 * Required: name, slug, description, prompt_template
 * Optional: version, source_type, source_path, ob1_slug, trigger,
 *           input_contract, output_contract, tool_requirements,
 *           plugin_id, trust_tier, enabled, metadata
 */
async function handleRegisterSkill(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const name = params.name as string | undefined;
  const slug = params.slug as string | undefined;
  const description = params.description as string | undefined;
  const promptTemplate = params.prompt_template as string | undefined;

  if (!name || !slug || !description || !promptTemplate) {
    return jsonError("Missing required fields: name, slug, description, prompt_template");
  }

  const sourceType = (params.source_type as string) ?? "user";
  const validSources = ["bundled", "user", "ob1", "mcp_generated"];
  if (!validSources.includes(sourceType)) {
    return jsonError(`Invalid source_type. Must be one of: ${validSources.join(", ")}`);
  }

  const trustTier = (params.trust_tier as string) ?? "skill";
  const validTiers = ["built_in", "plugin", "skill"];
  if (!validTiers.includes(trustTier)) {
    return jsonError(`Invalid trust_tier. Must be one of: ${validTiers.join(", ")}`);
  }

  const { data, error } = await supabase
    .from("skill_registry")
    .upsert(
      {
        name,
        slug,
        description,
        version: (params.version as string) ?? "1.0.0",
        source_type: sourceType,
        source_path: params.source_path ?? null,
        ob1_slug: params.ob1_slug ?? null,
        prompt_template: promptTemplate,
        trigger: params.trigger ?? {},
        input_contract: params.input_contract ?? {},
        output_contract: params.output_contract ?? {},
        tool_requirements: params.tool_requirements ?? [],
        plugin_id: params.plugin_id ?? null,
        trust_tier: trustTier,
        enabled: params.enabled !== false,
        metadata: params.metadata ?? {},
      },
      { onConflict: "slug" },
    )
    .select()
    .single();

  if (error) {
    return jsonError(error.message, 500);
  }

  return jsonOk({ skill: data, registered: true });
}

/**
 * update_skill — update an existing skill's metadata.
 *
 * Required: slug
 * Optional: any field from the skill_registry table
 */
async function handleUpdateSkill(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const slug = params.slug as string | undefined;
  if (!slug) {
    return jsonError("Missing required field: slug");
  }

  // Build the update payload from allowed fields
  const allowedFields = [
    "name",
    "description",
    "version",
    "source_type",
    "source_path",
    "ob1_slug",
    "prompt_template",
    "trigger",
    "input_contract",
    "output_contract",
    "tool_requirements",
    "plugin_id",
    "trust_tier",
    "enabled",
    "metadata",
  ];

  const updatePayload: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (params[field] !== undefined) {
      updatePayload[field] = params[field];
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return jsonError("No fields provided to update.");
  }

  // Validate enums if present
  if (updatePayload.source_type) {
    const validSources = ["bundled", "user", "ob1", "mcp_generated"];
    if (!validSources.includes(updatePayload.source_type as string)) {
      return jsonError(`Invalid source_type. Must be one of: ${validSources.join(", ")}`);
    }
  }
  if (updatePayload.trust_tier) {
    const validTiers = ["built_in", "plugin", "skill"];
    if (!validTiers.includes(updatePayload.trust_tier as string)) {
      return jsonError(`Invalid trust_tier. Must be one of: ${validTiers.join(", ")}`);
    }
  }

  const { data, error } = await supabase
    .from("skill_registry")
    .update(updatePayload)
    .eq("slug", slug)
    .select()
    .single();

  if (error) {
    return jsonError(error.message, 500);
  }

  if (!data) {
    return jsonError(`Skill not found: ${slug}`, 404);
  }

  return jsonOk({ skill: data, updated: true });
}

/**
 * delete_skill — remove a skill by slug.
 *
 * Required: slug
 */
async function handleDeleteSkill(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const slug = params.slug as string | undefined;
  if (!slug) {
    return jsonError("Missing required field: slug");
  }

  const { error, count } = await supabase
    .from("skill_registry")
    .delete()
    .eq("slug", slug);

  if (error) {
    return jsonError(error.message, 500);
  }

  return jsonOk({ slug, deleted: true, rows_affected: count ?? 1 });
}

// ---------------------------------------------------------------------------
// Hook actions
// ---------------------------------------------------------------------------

/**
 * list_hooks — list hook configurations.
 *
 * Optional: event_type, enabled_only (default true), plugin_id
 */
async function handleListHooks(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  let query = supabase.from("hook_configurations").select("*");

  const enabledOnly = params.enabled_only !== false;
  if (enabledOnly) {
    query = query.eq("enabled", true);
  }

  if (params.event_type) {
    const validEvents = ["PreToolUse", "PostToolUse"];
    if (!validEvents.includes(params.event_type as string)) {
      return jsonError(`Invalid event_type. Must be one of: ${validEvents.join(", ")}`);
    }
    query = query.eq("event_type", params.event_type as string);
  }

  if (params.plugin_id) {
    query = query.eq("plugin_id", params.plugin_id as string);
  }

  const { data, error } = await query.order("priority");

  if (error) {
    return jsonError(error.message, 500);
  }

  return jsonOk({ hooks: data, count: data?.length ?? 0 });
}

/**
 * register_hook — register a hook command for PreToolUse or PostToolUse.
 *
 * Required: name, event_type, command
 * Optional: tool_filter, priority, timeout_ms, plugin_id, trust_tier, enabled, metadata
 */
async function handleRegisterHook(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const name = params.name as string | undefined;
  const eventType = params.event_type as string | undefined;
  const command = params.command as string | undefined;

  if (!name || !eventType || !command) {
    return jsonError("Missing required fields: name, event_type, command");
  }

  const validEvents = ["PreToolUse", "PostToolUse"];
  if (!validEvents.includes(eventType)) {
    return jsonError(`Invalid event_type. Must be one of: ${validEvents.join(", ")}`);
  }

  const trustTier = (params.trust_tier as string) ?? "skill";
  const validTiers = ["built_in", "plugin", "skill"];
  if (!validTiers.includes(trustTier)) {
    return jsonError(`Invalid trust_tier. Must be one of: ${validTiers.join(", ")}`);
  }

  const { data, error } = await supabase
    .from("hook_configurations")
    .insert({
      name,
      event_type: eventType,
      command,
      tool_filter: (params.tool_filter as string[]) ?? [],
      priority: (params.priority as number) ?? 100,
      timeout_ms: (params.timeout_ms as number) ?? 30000,
      plugin_id: params.plugin_id ?? null,
      trust_tier: trustTier,
      enabled: params.enabled !== false,
      metadata: params.metadata ?? {},
    })
    .select()
    .single();

  if (error) {
    return jsonError(error.message, 500);
  }

  return jsonOk({ hook: data, registered: true });
}

// ---------------------------------------------------------------------------
// Plugin actions
// ---------------------------------------------------------------------------

/**
 * list_plugins — list all registered plugins.
 *
 * Optional: status, trust_tier
 */
async function handleListPlugins(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  let query = supabase.from("plugin_registry").select("*");

  if (params.status) {
    const validStatuses = ["enabled", "disabled", "installing", "error"];
    if (!validStatuses.includes(params.status as string)) {
      return jsonError(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
    }
    query = query.eq("status", params.status as string);
  }

  if (params.trust_tier) {
    query = query.eq("trust_tier", params.trust_tier as string);
  }

  const { data, error } = await query.order("name");

  if (error) {
    return jsonError(error.message, 500);
  }

  return jsonOk({ plugins: data, count: data?.length ?? 0 });
}

/**
 * register_plugin — register a plugin package.
 *
 * Required: name, slug
 * Optional: description, version, author_name, author_github,
 *           trust_tier, granted_permissions, manifest, source_url, metadata
 */
async function handleRegisterPlugin(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const name = params.name as string | undefined;
  const slug = params.slug as string | undefined;

  if (!name || !slug) {
    return jsonError("Missing required fields: name, slug");
  }

  const trustTier = (params.trust_tier as string) ?? "plugin";
  const validTiers = ["built_in", "plugin"];
  if (!validTiers.includes(trustTier)) {
    return jsonError(`Invalid trust_tier. Must be one of: ${validTiers.join(", ")}`);
  }

  const { data, error } = await supabase
    .from("plugin_registry")
    .upsert(
      {
        name,
        slug,
        description: (params.description as string) ?? null,
        version: (params.version as string) ?? "1.0.0",
        author_name: params.author_name ?? null,
        author_github: params.author_github ?? null,
        trust_tier: trustTier,
        status: "enabled",
        granted_permissions: params.granted_permissions ?? {},
        manifest: params.manifest ?? {},
        source_url: params.source_url ?? null,
        metadata: params.metadata ?? {},
      },
      { onConflict: "slug" },
    )
    .select()
    .single();

  if (error) {
    return jsonError(error.message, 500);
  }

  return jsonOk({ plugin: data, registered: true });
}

/**
 * update_plugin_status — enable, disable, or uninstall a plugin.
 * On uninstall, CASCADE deletes associated skills and hooks via FK.
 *
 * Required: plugin_id, status
 * status must be: enabled | disabled | uninstall
 */
async function handleUpdatePluginStatus(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const pluginId = params.plugin_id as string | undefined;
  const newStatus = params.status as string | undefined;

  if (!pluginId || !newStatus) {
    return jsonError("Missing required fields: plugin_id, status");
  }

  const validStatuses = ["enabled", "disabled", "uninstall"];
  if (!validStatuses.includes(newStatus)) {
    return jsonError(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
  }

  if (newStatus === "uninstall") {
    // CASCADE: delete associated skills and hooks first (FK ON DELETE CASCADE
    // should handle this, but we also explicitly disable them for safety)

    // Disable all skills owned by this plugin
    await supabase
      .from("skill_registry")
      .update({ enabled: false })
      .eq("plugin_id", pluginId);

    // Disable all hooks owned by this plugin
    await supabase
      .from("hook_configurations")
      .update({ enabled: false })
      .eq("plugin_id", pluginId);

    // Delete the plugin (CASCADE will remove skills and hooks)
    const { error } = await supabase
      .from("plugin_registry")
      .delete()
      .eq("id", pluginId);

    if (error) {
      return jsonError(error.message, 500);
    }

    return jsonOk({
      plugin_id: pluginId,
      status: "uninstalled",
      message: "Plugin and all associated skills/hooks have been removed.",
    });
  }

  // Enable or disable
  const { data, error } = await supabase
    .from("plugin_registry")
    .update({ status: newStatus })
    .eq("id", pluginId)
    .select()
    .single();

  if (error) {
    return jsonError(error.message, 500);
  }

  if (!data) {
    return jsonError(`Plugin not found: ${pluginId}`, 404);
  }

  // Also enable/disable associated skills and hooks
  const skillEnabled = newStatus === "enabled";

  await supabase
    .from("skill_registry")
    .update({ enabled: skillEnabled })
    .eq("plugin_id", pluginId);

  await supabase
    .from("hook_configurations")
    .update({ enabled: skillEnabled })
    .eq("plugin_id", pluginId);

  return jsonOk({
    plugin: data,
    status: newStatus,
    cascaded_to_skills: true,
    cascaded_to_hooks: true,
  });
}

// ---------------------------------------------------------------------------
// Hook log
// ---------------------------------------------------------------------------

/**
 * get_hook_log — query hook execution history.
 *
 * Required: session_id
 * Optional: outcome, tool_name, hook_config_id, limit (default 50)
 */
async function handleGetHookLog(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const sessionId = params.session_id as string | undefined;
  if (!sessionId) {
    return jsonError("Missing required field: session_id");
  }

  // SECURITY: Cap limit to prevent unbounded result sets
  const limit = Math.min((params.limit as number) ?? 50, 500);

  let query = supabase
    .from("hook_execution_log")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (params.outcome) {
    const validOutcomes = ["allow", "warn", "deny", "timeout", "error"];
    if (!validOutcomes.includes(params.outcome as string)) {
      return jsonError(`Invalid outcome. Must be one of: ${validOutcomes.join(", ")}`);
    }
    query = query.eq("outcome", params.outcome as string);
  }

  if (params.tool_name) {
    query = query.eq("tool_name", params.tool_name as string);
  }

  if (params.hook_config_id) {
    query = query.eq("hook_config_id", params.hook_config_id as string);
  }

  const { data, error } = await query;

  if (error) {
    return jsonError(error.message, 500);
  }

  return jsonOk({ log: data, count: data?.length ?? 0 });
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
    // Skill operations
    case "list_skills":
      return handleListSkills(supabase, params);

    case "register_skill":
      return handleRegisterSkill(supabase, params);

    case "update_skill":
      return handleUpdateSkill(supabase, params);

    case "delete_skill":
      return handleDeleteSkill(supabase, params);

    // Hook operations
    case "list_hooks":
      return handleListHooks(supabase, params);

    case "register_hook":
      return handleRegisterHook(supabase, params);

    // Plugin operations
    case "list_plugins":
      return handleListPlugins(supabase, params);

    case "register_plugin":
      return handleRegisterPlugin(supabase, params);

    case "update_plugin_status":
      return handleUpdatePluginStatus(supabase, params);

    // Hook execution log
    case "get_hook_log":
      return handleGetHookLog(supabase, params);

    default:
      return jsonError(
        `Unknown action: ${action}. Valid actions: list_skills, register_skill, update_skill, delete_skill, list_hooks, register_hook, list_plugins, register_plugin, update_plugin_status, get_hook_log`,
      );
  }
});
