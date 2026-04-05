// =============================================================================
// agent-memory — Edge Function for OB1 Memory Operations
//
// Actions:
//   memory_store       — Create a thought with embedding + provenance metadata
//   memory_recall      — Search memories via match_thoughts_scored()
//   memory_forget      — Soft-delete a memory (metadata.deleted = true)
//   memory_update      — Version a memory (insert new, link old)
//   memory_consolidate — Merge similar memories above a similarity threshold
//   get_memory_stats   — Count memories by scope, type, age
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
// Embedding generation
// ---------------------------------------------------------------------------
async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
      }),
    });

    if (!response.ok) {
      console.error("Embedding API error:", response.status, await response.text());
      return null;
    }

    const result = await response.json();
    return result.data?.[0]?.embedding ?? null;
  } catch (err) {
    console.error("Embedding generation failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * memory_store — create a thought with embedding + provenance metadata.
 *
 * Required: content, memory_type, memory_scope
 * Optional: source_type, trust_level, tags, owner_id, team_id, project_id,
 *           agent_id, session_id, relevance_boost, pin
 */
async function handleMemoryStore(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const content = params.content as string | undefined;
  const memoryType = params.memory_type as string | undefined;
  const memoryScope = params.memory_scope as string | undefined;

  if (!content || !memoryType || !memoryScope) {
    return jsonError("Missing required fields: content, memory_type, memory_scope");
  }

  // SECURITY: Cap content length to prevent abuse (embedding API cost, storage bloat)
  if (content.length > 100_000) {
    return jsonError("content must be 100,000 characters or fewer");
  }

  // Validate enums
  const validTypes = ["fact", "preference", "decision", "instruction", "observation", "context"];
  if (!validTypes.includes(memoryType)) {
    return jsonError(`Invalid memory_type. Must be one of: ${validTypes.join(", ")}`);
  }

  const validScopes = ["personal", "team", "project", "agent"];
  if (!validScopes.includes(memoryScope)) {
    return jsonError(`Invalid memory_scope. Must be one of: ${validScopes.join(", ")}`);
  }

  const sourceType = (params.source_type as string) ?? "model_inferred";
  const validSources = ["user_stated", "model_inferred", "tool_observed", "compaction_derived"];
  if (!validSources.includes(sourceType)) {
    return jsonError(`Invalid source_type. Must be one of: ${validSources.join(", ")}`);
  }

  const trustLevel = (params.trust_level as number) ??
    (sourceType === "user_stated"
      ? 5
      : sourceType === "tool_observed"
        ? 4
        : sourceType === "model_inferred"
          ? 3
          : 2);

  const tags = (params.tags as string[]) ?? [];

  // Build provenance-aware metadata
  const metadata: Record<string, unknown> = {
    memory_scope: memoryScope,
    memory_type: memoryType,
    tags,
    provenance: {
      source_type: sourceType,
      trust_level: trustLevel,
      created_at: new Date().toISOString(),
    },
    version: 1,
    relevance_boost: (params.relevance_boost as number) ?? 1.0,
  };

  if (params.pin) metadata.pin = true;
  if (params.owner_id) metadata.owner_id = params.owner_id;
  if (params.team_id) metadata.team_id = params.team_id;
  if (params.project_id) metadata.project_id = params.project_id;
  if (params.agent_id) metadata.agent_id = params.agent_id;
  if (params.session_id) metadata.session_id = params.session_id;

  // Generate embedding
  const embedding = await generateEmbedding(content);

  // Insert the thought directly
  const insertPayload: Record<string, unknown> = {
    content,
    metadata,
  };
  if (embedding) {
    insertPayload.embedding = embedding;
  }

  const { data, error } = await supabase
    .from("thoughts")
    .insert(insertPayload)
    .select("id, content_fingerprint, created_at")
    .single();

  if (error) {
    return jsonError(error.message, 500);
  }

  return jsonOk({
    thought_id: data.id,
    content_fingerprint: data.content_fingerprint,
    memory_scope: memoryScope,
    memory_type: memoryType,
    source_type: sourceType,
    trust_level: trustLevel,
    has_embedding: embedding !== null,
    created_at: data.created_at,
  });
}

/**
 * memory_recall — search memories using match_thoughts_scored() with filters.
 *
 * Required: query
 * Optional: memory_scope, memory_type, max_results, min_similarity,
 *           include_aged_score, owner_id, team_id, project_id,
 *           min_trust_level
 */
async function handleMemoryRecall(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const query = params.query as string | undefined;
  if (!query) {
    return jsonError("Missing required field: query");
  }

  const scope = (params.memory_scope as string) ?? "all";
  const memoryType = params.memory_type as string | undefined;
  // SECURITY: Cap max_results to prevent oversized vector searches
  const maxResults = Math.min((params.max_results as number) ?? 10, 100);
  const minSimilarity = (params.min_similarity as number) ?? 0.5;
  const includeAgedScore = (params.include_aged_score as boolean) ?? true;

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) {
    return jsonError("Failed to generate query embedding. Ensure OPENAI_API_KEY is set.", 500);
  }

  // Build metadata filter for scope
  const filter: Record<string, unknown> = {};
  if (scope !== "all") {
    filter.memory_scope = scope;
  }
  if (memoryType) {
    filter.memory_type = memoryType;
  }
  if (params.owner_id) filter.owner_id = params.owner_id;
  if (params.team_id) filter.team_id = params.team_id;
  if (params.project_id) filter.project_id = params.project_id;

  // Call the scored search function
  const { data, error } = await supabase.rpc("match_thoughts_scored", {
    query_embedding: queryEmbedding,
    match_threshold: minSimilarity,
    match_count: maxResults * 2, // over-fetch to filter soft-deleted
    filter: Object.keys(filter).length > 0 ? filter : {},
    apply_aging: includeAgedScore,
  });

  if (error) {
    return jsonError(error.message, 500);
  }

  // Filter out soft-deleted memories and apply trust filtering
  const minTrust = (params.min_trust_level as number) ?? 0;

  const results = (data ?? [])
    .filter((row: Record<string, unknown>) => {
      const meta = row.metadata as Record<string, unknown> | null;
      if (meta?.deleted) return false;
      if (minTrust > 0) {
        const prov = meta?.provenance as Record<string, unknown> | undefined;
        const trust = (prov?.trust_level as number) ?? 0;
        if (trust < minTrust) return false;
      }
      return true;
    })
    .slice(0, maxResults)
    .map((row: Record<string, unknown>) => {
      const meta = row.metadata as Record<string, unknown>;
      return {
        thought_id: row.id,
        content: row.content,
        similarity: row.similarity,
        aged_score: row.aged_score,
        memory_scope: meta?.memory_scope,
        memory_type: meta?.memory_type,
        tags: meta?.tags ?? [],
        provenance: meta?.provenance,
        version: meta?.version ?? 1,
        created_at: row.created_at,
      };
    });

  return jsonOk({
    query,
    results,
    result_count: results.length,
    scope_filter: scope,
    type_filter: memoryType ?? "all",
    min_similarity: minSimilarity,
    aged_scoring: includeAgedScore,
  });
}

/**
 * memory_forget — soft-delete a memory by setting metadata.deleted = true.
 *
 * Required: thought_id, reason
 */
async function handleMemoryForget(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const thoughtId = params.thought_id as string | undefined;
  const reason = params.reason as string | undefined;

  if (!thoughtId || !reason) {
    return jsonError("Missing required fields: thought_id, reason");
  }

  // Read current metadata
  const { data: existing, error: readErr } = await supabase
    .from("thoughts")
    .select("metadata")
    .eq("id", thoughtId)
    .single();

  if (readErr || !existing) {
    return jsonError(`Thought not found: ${thoughtId}`, 404);
  }

  const metadata = (existing.metadata ?? {}) as Record<string, unknown>;

  if (metadata.deleted) {
    return jsonError("Memory is already forgotten.", 409);
  }

  // Soft-delete: set deleted flag in metadata
  const updatedMetadata = {
    ...metadata,
    deleted: true,
    deleted_at: new Date().toISOString(),
    deleted_reason: reason,
  };

  const { error: updateErr } = await supabase
    .from("thoughts")
    .update({ metadata: updatedMetadata })
    .eq("id", thoughtId);

  if (updateErr) {
    return jsonError(updateErr.message, 500);
  }

  return jsonOk({
    thought_id: thoughtId,
    forgotten: true,
    reason,
    deleted_at: updatedMetadata.deleted_at,
  });
}

/**
 * memory_update — create a new version of a memory.
 * The old version is preserved and linked via version chain + memory_versions table.
 *
 * Required: thought_id, new_content
 * Optional: reason
 */
async function handleMemoryUpdate(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const oldThoughtId = params.thought_id as string | undefined;
  const newContent = params.new_content as string | undefined;
  const reason = (params.reason as string) ?? "Updated content";

  if (!oldThoughtId || !newContent) {
    return jsonError("Missing required fields: thought_id, new_content");
  }

  // SECURITY: Cap content length to prevent abuse
  if (newContent.length > 100_000) {
    return jsonError("new_content must be 100,000 characters or fewer");
  }

  // Read the existing thought
  const { data: existing, error: readErr } = await supabase
    .from("thoughts")
    .select("*")
    .eq("id", oldThoughtId)
    .single();

  if (readErr || !existing) {
    return jsonError(`Thought not found: ${oldThoughtId}`, 404);
  }

  const oldMetadata = (existing.metadata ?? {}) as Record<string, unknown>;
  const oldVersion = (oldMetadata.version as number) ?? 1;

  if (oldMetadata.deleted) {
    return jsonError("Cannot update a forgotten memory. Restore it first.", 409);
  }

  // Build new version metadata
  const oldProvenance = (oldMetadata.provenance as Record<string, unknown>) ?? {};
  const newMetadata: Record<string, unknown> = {
    ...oldMetadata,
    version: oldVersion + 1,
    supersedes: oldThoughtId,
    provenance: {
      ...oldProvenance,
      created_at: new Date().toISOString(),
      last_validated: new Date().toISOString(),
    },
  };

  // Remove superseded_by from new version (it has none yet)
  delete newMetadata.superseded_by;

  // Generate new embedding
  const embedding = await generateEmbedding(newContent);

  const insertPayload: Record<string, unknown> = {
    content: newContent,
    metadata: newMetadata,
  };
  if (embedding) {
    insertPayload.embedding = embedding;
  }

  const { data: newThought, error: insertErr } = await supabase
    .from("thoughts")
    .insert(insertPayload)
    .select("id, created_at")
    .single();

  if (insertErr) {
    return jsonError(insertErr.message, 500);
  }

  const newThoughtId = newThought.id;

  // Update old thought metadata to point to new version
  const updatedOldMetadata = {
    ...oldMetadata,
    superseded_by: newThoughtId,
  };

  await supabase
    .from("thoughts")
    .update({ metadata: updatedOldMetadata })
    .eq("id", oldThoughtId);

  // Record in memory_versions table
  await supabase.from("memory_versions").insert({
    thought_id: newThoughtId,
    previous_thought_id: oldThoughtId,
    version_number: oldVersion + 1,
    change_reason: reason,
    previous_content: existing.content,
  });

  return jsonOk({
    new_thought_id: newThoughtId,
    previous_thought_id: oldThoughtId,
    version: oldVersion + 1,
    reason,
    created_at: newThought.created_at,
  });
}

/**
 * memory_consolidate — find similar memories by embedding and merge them.
 * Source memories are soft-deleted and linked to the consolidated result.
 *
 * Required: thought_ids (uuid[]), consolidated_content
 * Optional: resolution_notes
 */
async function handleMemoryConsolidate(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  const thoughtIds = params.thought_ids as string[] | undefined;
  const consolidatedContent = params.consolidated_content as string | undefined;
  const resolutionNotes = (params.resolution_notes as string) ?? "";

  if (!thoughtIds || !consolidatedContent) {
    return jsonError("Missing required fields: thought_ids, consolidated_content");
  }

  // SECURITY: Cap content length to prevent abuse
  if (consolidatedContent.length > 100_000) {
    return jsonError("consolidated_content must be 100,000 characters or fewer");
  }

  if (thoughtIds.length < 2) {
    return jsonError("Consolidation requires at least 2 thought IDs.");
  }

  // SECURITY: Cap array size to prevent abuse (massive IN queries, N+1 update loops)
  if (thoughtIds.length > 50) {
    return jsonError("Maximum 50 thought IDs per consolidation request.");
  }

  // Read all source thoughts
  const { data: sources, error: readErr } = await supabase
    .from("thoughts")
    .select("*")
    .in("id", thoughtIds);

  if (readErr || !sources || sources.length === 0) {
    return jsonError("Could not read source thoughts.", 500);
  }

  // Determine the most authoritative scope from sources
  const scopePriority: Record<string, number> = {
    project: 3,
    team: 2,
    personal: 1,
    agent: 0,
  };
  const bestScope = sources.reduce((best: string, s: Record<string, unknown>) => {
    const sScope = (s.metadata as Record<string, unknown>)?.memory_scope as string;
    return (scopePriority[sScope] ?? 0) > (scopePriority[best] ?? 0) ? sScope : best;
  }, "personal");

  // Use the most common type among sources
  const typeCounts = new Map<string, number>();
  for (const s of sources) {
    const t = ((s.metadata as Record<string, unknown>)?.memory_type as string) ?? "fact";
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const bestType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // Determine highest trust level
  const maxTrust = Math.max(
    ...sources.map((s: Record<string, unknown>) => {
      const p = (s.metadata as Record<string, unknown>)?.provenance as
        | Record<string, unknown>
        | undefined;
      return (p?.trust_level as number) ?? 3;
    }),
  );

  // Collect all tags from sources
  const allTags = new Set<string>(["consolidated"]);
  for (const s of sources) {
    const tags = (s.metadata as Record<string, unknown>)?.tags;
    if (Array.isArray(tags)) {
      for (const t of tags) allTags.add(t as string);
    }
  }

  // Create consolidated thought
  const metadata: Record<string, unknown> = {
    memory_scope: bestScope,
    memory_type: bestType,
    tags: [...allTags],
    provenance: {
      source_type: "compaction_derived",
      trust_level: maxTrust,
      created_at: new Date().toISOString(),
    },
    version: 1,
    consolidated_from: thoughtIds,
    resolution_notes: resolutionNotes,
  };

  const embedding = await generateEmbedding(consolidatedContent);

  const insertPayload: Record<string, unknown> = {
    content: consolidatedContent,
    metadata,
  };
  if (embedding) {
    insertPayload.embedding = embedding;
  }

  const { data: newThought, error: insertErr } = await supabase
    .from("thoughts")
    .insert(insertPayload)
    .select("id, created_at")
    .single();

  if (insertErr) {
    return jsonError(insertErr.message, 500);
  }

  const newThoughtId = newThought.id;

  // Soft-delete source thoughts, pointing to the consolidation
  for (const source of sources) {
    const sourceMeta = (source.metadata ?? {}) as Record<string, unknown>;
    await supabase
      .from("thoughts")
      .update({
        metadata: {
          ...sourceMeta,
          deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_reason: `Consolidated into ${newThoughtId}`,
          superseded_by: newThoughtId,
        },
      })
      .eq("id", source.id);
  }

  return jsonOk({
    consolidated_thought_id: newThoughtId,
    source_count: sources.length,
    sources_retired: thoughtIds,
    memory_scope: bestScope,
    memory_type: bestType,
    trust_level: maxTrust,
    resolution_notes: resolutionNotes,
    created_at: newThought.created_at,
  });
}

/**
 * get_memory_stats — count memories by scope, type, and age buckets.
 *
 * Optional: owner_id, team_id, project_id (filter counts)
 */
async function handleGetMemoryStats(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
): Promise<Response> {
  // SECURITY: Never use exec_sql with string interpolation — SQL injection risk.
  // Always use Supabase query builder (parameterized) for all stats queries.
  {
    // Fallback: use individual filtered count queries
    const scopes = ["personal", "team", "project", "agent"];
    const types = ["fact", "preference", "decision", "instruction", "observation", "context"];
    const scopeResults: Record<string, number> = {};
    const typeResults: Record<string, number> = {};

    for (const scope of scopes) {
      let query = supabase
        .from("thoughts")
        .select("id", { count: "exact", head: true })
        .eq("metadata->>memory_scope", scope)
        .neq("metadata->>deleted", "true");

      if (params.owner_id) query = query.eq("metadata->>owner_id", params.owner_id as string);
      if (params.team_id) query = query.eq("metadata->>team_id", params.team_id as string);
      if (params.project_id) query = query.eq("metadata->>project_id", params.project_id as string);

      const { count } = await query;
      scopeResults[scope] = count ?? 0;
    }

    for (const type of types) {
      let query = supabase
        .from("thoughts")
        .select("id", { count: "exact", head: true })
        .eq("metadata->>memory_type", type)
        .neq("metadata->>deleted", "true");

      if (params.owner_id) query = query.eq("metadata->>owner_id", params.owner_id as string);
      if (params.team_id) query = query.eq("metadata->>team_id", params.team_id as string);
      if (params.project_id) query = query.eq("metadata->>project_id", params.project_id as string);

      const { count } = await query;
      typeResults[type] = count ?? 0;
    }

    // Total count
    let totalQuery = supabase
      .from("thoughts")
      .select("id", { count: "exact", head: true })
      .not("metadata->>memory_scope", "is", null)
      .neq("metadata->>deleted", "true");

    if (params.owner_id) totalQuery = totalQuery.eq("metadata->>owner_id", params.owner_id as string);
    if (params.team_id) totalQuery = totalQuery.eq("metadata->>team_id", params.team_id as string);
    if (params.project_id) totalQuery = totalQuery.eq("metadata->>project_id", params.project_id as string);

    const { count: totalCount } = await totalQuery;

    // Age distribution: count by age buckets
    const ageBuckets: Record<string, number> = {};
    const bucketDefs = [
      { label: "last_24h", hours: 24 },
      { label: "last_7d", hours: 168 },
      { label: "last_30d", hours: 720 },
      { label: "last_90d", hours: 2160 },
      { label: "older", hours: Infinity },
    ];

    for (const bucket of bucketDefs) {
      if (bucket.hours === Infinity) {
        // Older than 90 days
        let q = supabase
          .from("thoughts")
          .select("id", { count: "exact", head: true })
          .not("metadata->>memory_scope", "is", null)
          .neq("metadata->>deleted", "true")
          .lt("created_at", new Date(Date.now() - 2160 * 60 * 60 * 1000).toISOString());

        if (params.owner_id) q = q.eq("metadata->>owner_id", params.owner_id as string);
        if (params.team_id) q = q.eq("metadata->>team_id", params.team_id as string);
        if (params.project_id) q = q.eq("metadata->>project_id", params.project_id as string);

        const { count } = await q;
        ageBuckets[bucket.label] = count ?? 0;
      } else {
        const since = new Date(Date.now() - bucket.hours * 60 * 60 * 1000).toISOString();
        let q = supabase
          .from("thoughts")
          .select("id", { count: "exact", head: true })
          .not("metadata->>memory_scope", "is", null)
          .neq("metadata->>deleted", "true")
          .gte("created_at", since);

        if (params.owner_id) q = q.eq("metadata->>owner_id", params.owner_id as string);
        if (params.team_id) q = q.eq("metadata->>team_id", params.team_id as string);
        if (params.project_id) q = q.eq("metadata->>project_id", params.project_id as string);

        const { count } = await q;
        ageBuckets[bucket.label] = count ?? 0;
      }
    }

    return jsonOk({
      total_memories: totalCount ?? 0,
      by_scope: scopeResults,
      by_type: typeResults,
      by_age: ageBuckets,
    });
  }
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
    case "memory_store":
      return handleMemoryStore(supabase, params);

    case "memory_recall":
      return handleMemoryRecall(supabase, params);

    case "memory_forget":
      return handleMemoryForget(supabase, params);

    case "memory_update":
      return handleMemoryUpdate(supabase, params);

    case "memory_consolidate":
      return handleMemoryConsolidate(supabase, params);

    case "get_memory_stats":
      return handleGetMemoryStats(supabase, params);

    default:
      return jsonError(
        `Unknown action: ${action}. Valid actions: memory_store, memory_recall, memory_forget, memory_update, memory_consolidate, get_memory_stats`,
      );
  }
});
