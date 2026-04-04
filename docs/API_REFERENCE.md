# OB1 Platform API Reference

All endpoints are Supabase Edge Functions accessed via POST requests:

```
POST <SUPABASE_URL>/functions/v1/<function-name>
```

All requests require the `x-access-key` header for authentication:

```
x-access-key: <OB1_ACCESS_KEY>
```

Request body format (JSON):

```json
{ "action": "<action-name>", ...params }
```

---

## Table of Contents

- [agent-tools](#agent-tools) -- Tool Registry & Permission Operations
- [agent-state](#agent-state) -- Session, Workflow & Budget Operations
- [agent-stream](#agent-stream) -- System Event Logging & Verification
- [agent-doctor](#agent-doctor) -- Health Checks, Boot Tracking & Configuration
- [agent-memory](#agent-memory) -- Memory Store, Recall, Versioning & Consolidation
- [agent-skills](#agent-skills) -- Skill, Hook & Plugin CRUD
- [agent-coordinator](#agent-coordinator) -- Agent Types, Runs & Inter-Agent Messaging

---

## agent-tools

Tool Registry & Permission Operations. Manages tool definitions, permission policies, audit logging, and filtered tool pool assembly.

### list_tools

List registered tools with optional filters.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| source_type | string | no | Filter by source: `built_in`, `plugin`, `skill`, `mcp` |
| enabled | boolean | no | Filter by enabled status |
| permission_level | string | no | Return tools at or below this level: `read_only`, `workspace_write`, `danger_full_access`, `prompt`, `allow` |

**Response:**

```json
{
  "tools": [ { ...tool_registry row } ],
  "meta": { "total": 5 }
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-tools" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "list_tools", "source_type": "built_in", "enabled": true}'
```

---

### register_tool

Register a new tool definition. Upserts on the `name` column.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | yes | Unique tool name |
| description | string | yes | Human-readable description |
| source_type | string | yes | Source: `built_in`, `plugin`, `skill`, `mcp` |
| required_permission | string | no | Permission level required. Default: `read_only` |
| input_schema | object | no | JSON Schema for tool input. Default: `{}` |
| side_effect_profile | object | no | Side effect metadata. Default: `{}` |
| enabled | boolean | no | Whether tool is active. Default: `true` |
| aliases | string[] | no | Alternative names. Default: `[]` |
| mcp_server_url | string | no | MCP server URL (for `mcp` source type). Default: `null` |
| metadata | object | no | Arbitrary metadata. Default: `{}` |

**Response (201):**

```json
{
  "tool": { ...tool_registry row }
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-tools" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "register_tool",
    "name": "web_search",
    "description": "Search the web for information",
    "source_type": "built_in",
    "required_permission": "read_only"
  }'
```

---

### update_tool

Update an existing tool's metadata. Only specified allowed fields are patched.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | yes | Tool name to identify the tool to update |
| description | string | no | Updated description |
| source_type | string | no | Updated source type |
| required_permission | string | no | Updated permission level |
| input_schema | object | no | Updated input schema |
| side_effect_profile | object | no | Updated side effect profile |
| enabled | boolean | no | Updated enabled status |
| aliases | string[] | no | Updated aliases |
| mcp_server_url | string | no | Updated MCP server URL |
| metadata | object | no | Updated metadata |

**Response:**

```json
{
  "tool": { ...updated tool_registry row }
}
```

**Error (404):** Tool not found.

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-tools" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "update_tool", "name": "web_search", "enabled": false}'
```

---

### get_policies

List all permission policies, ordered by name.

**Parameters:** None.

**Response:**

```json
{
  "policies": [ { ...permission_policies row } ]
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-tools" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_policies"}'
```

---

### set_policy

Create or update a permission policy. Upserts on the `name` column.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | yes | Unique policy name |
| description | string | no | Policy description |
| active_mode | string | no | Active permission mode |
| tool_overrides | object | no | Map of tool name to permission override |
| handler_type | string | no | Handler type |
| deny_tools | string[] | no | Explicit tool deny list |
| deny_prefixes | string[] | no | Tool name prefix deny list |
| allow_tools | string[] | no | Explicit tool allow list |
| metadata | object | no | Arbitrary metadata |

**Response (201):**

```json
{
  "policy": { ...permission_policies row }
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-tools" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "set_policy",
    "name": "read_only_default",
    "active_mode": "read_only",
    "deny_tools": ["bash", "edit_file"]
  }'
```

---

### log_audit

Log a permission decision to the audit trail.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | yes | Session ID |
| tool_name | string | yes | Name of the tool involved |
| decision | string | yes | Decision result (e.g., `allow`, `deny`) |
| decided_by | string | yes | Who/what made the decision |
| active_mode | string | yes | Permission mode that was active |
| required_mode | string | yes | Permission mode required by the tool |
| reason | string | no | Human-readable reason. Default: `null` |
| policy_id | string | no | Policy ID that was applied. Default: `null` |
| input_summary | string | no | Summary of the tool input. Default: `null` |

**Response (201):**

```json
{
  "audit_entry": { ...permission_audit_log row }
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-tools" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "log_audit",
    "session_id": "abc-123",
    "tool_name": "bash",
    "decision": "deny",
    "decided_by": "policy_engine",
    "active_mode": "read_only",
    "required_mode": "danger_full_access",
    "reason": "Session is in read_only mode"
  }'
```

---

### get_audit_summary

Get aggregated audit data for a session: total decisions, denial rate, top denied tools, and decision breakdown.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | yes | Session ID to summarize |

**Response:**

```json
{
  "session_id": "abc-123",
  "total_decisions": 42,
  "denial_count": 5,
  "denial_rate": 0.119,
  "decision_breakdown": { "allow": 37, "deny": 5 },
  "top_denied_tools": [
    { "tool": "bash", "count": 3 },
    { "tool": "edit_file", "count": 2 }
  ]
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-tools" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_audit_summary", "session_id": "abc-123"}'
```

---

### assemble_pool

Assemble a filtered tool pool for a given context. Applies multiple filter layers: simple mode, MCP exclusion, deny/allow lists, permission level ceiling, and named policy.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| simple_mode | boolean | no | If `true`, restrict to `read_file`, `edit_file`, `bash` only |
| include_mcp | boolean | no | If `false`, exclude all MCP tools. Default: `true` |
| policy_name | string | no | Named policy to load deny/allow lists from |
| deny_tools | string[] | no | Explicit tool deny list (overrides policy if provided) |
| deny_prefixes | string[] | no | Tool name prefix deny list (overrides policy if provided) |
| allow_tools | string[] | no | Explicit allow list -- if non-empty, only these tools pass (overrides policy if provided) |
| permission_level | string | no | Max permission level ceiling: `read_only`, `workspace_write`, `danger_full_access`, `prompt`, `allow` |

**Response:**

```json
{
  "tools": [ { ...tool_registry row } ],
  "meta": {
    "total_registered": 25,
    "filtered_count": 8,
    "simple_mode": false,
    "include_mcp": true,
    "policy_name": "default_policy"
  }
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-tools" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "assemble_pool",
    "policy_name": "default_policy",
    "permission_level": "workspace_write",
    "include_mcp": false
  }'
```

---

## agent-state

Session, Workflow & Budget Operations. Manages agent sessions, workflow checkpoints with idempotency, crash recovery, and budget tracking.

### create_session

Create a new agent session.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | no | Custom session ID. Default: auto-generated UUID |
| config | object | no | Configuration snapshot. Default: `{}` |
| messages | array | no | Initial messages array. Default: `[]` |
| permission_decisions | array | no | Initial permission decisions. Default: `[]` |

**Response (201):**

```json
{
  "session": { ...agent_sessions row }
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-state" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "create_session", "config": {"model": "claude-sonnet-4-20250514"}}'
```

---

### get_session

Get session by session_id.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | yes | Session ID to retrieve |

**Response:**

```json
{
  "session": { ...agent_sessions row }
}
```

**Error (404):** Session not found.

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-state" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_session", "session_id": "abc-123"}'
```

---

### update_session

Update session state. Only specified allowed fields are patched. Automatically sets `completed_at` when status transitions to `completed`.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | yes | Session ID to update |
| status | string | no | Session status (e.g., `active`, `completed`, `crashed`) |
| messages | array | no | Updated messages array |
| config_snapshot | object | no | Updated config |
| permission_decisions | array | no | Updated permission decisions |
| total_input_tokens | number | no | Cumulative input tokens |
| total_output_tokens | number | no | Cumulative output tokens |
| total_cache_write_tokens | number | no | Cumulative cache write tokens |
| total_cache_read_tokens | number | no | Cumulative cache read tokens |
| total_cost_usd | number | no | Cumulative cost in USD |
| turn_count | number | no | Turn count |
| compaction_count | number | no | Number of compactions performed |
| last_compaction_at | string | no | ISO timestamp of last compaction |
| completed_at | string | no | ISO timestamp of completion |
| thought_id | string | no | Associated thought ID |

**Response:**

```json
{
  "session": { ...updated agent_sessions row }
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-state" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "update_session", "session_id": "abc-123", "status": "completed"}'
```

---

### list_sessions

List sessions with optional status filter. Returns a summary projection (not full message arrays).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| status | string | no | Filter by session status |
| limit | number | no | Max results (1-200). Default: `50` |
| offset | number | no | Pagination offset. Default: `0` |

**Response:**

```json
{
  "sessions": [
    {
      "id": "...",
      "session_id": "...",
      "status": "active",
      "turn_count": 5,
      "total_cost_usd": 0.03,
      "created_at": "...",
      "updated_at": "...",
      "completed_at": null
    }
  ],
  "meta": { "count": 1, "limit": 50, "offset": 0 }
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-state" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "list_sessions", "status": "active", "limit": 10}'
```

---

### create_checkpoint

Create a workflow checkpoint with idempotency. If the idempotency key already exists, returns the existing checkpoint without creating a duplicate.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | yes | Session ID |
| workflow_id | string | yes | Workflow identifier |
| step_index | number | yes | Step position in the workflow |
| step_type | string | yes | Type of step (e.g., `tool_call`, `llm_turn`) |
| idempotency_key | string | yes | Unique key for idempotent creation |
| step_description | string | no | Human-readable step description. Default: `null` |
| step_input | object | no | Input data for the step. Default: `{}` |
| state | string | no | Initial state. Default: `planned` |

**Response (201):**

```json
{
  "checkpoint": { ...workflow_checkpoints row },
  "idempotent": false
}
```

If already exists:

```json
{
  "checkpoint": { ...existing row },
  "idempotent": true,
  "message": "Checkpoint already exists for this idempotency key"
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-state" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create_checkpoint",
    "session_id": "abc-123",
    "workflow_id": "wf-001",
    "step_index": 0,
    "step_type": "tool_call",
    "idempotency_key": "wf-001-step-0",
    "step_description": "Fetch project README"
  }'
```

---

### get_checkpoints

Get all checkpoints for a session or workflow, with progress summary.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | conditional | Session ID (required if no workflow_id) |
| workflow_id | string | conditional | Workflow ID (required if no session_id) |
| state | string | no | Filter by checkpoint state (e.g., `planned`, `executing`, `completed`, `failed`) |

**Response:**

```json
{
  "checkpoints": [ { ...workflow_checkpoints row } ],
  "progress": {
    "total": 5,
    "completed": 3,
    "failed": 0,
    "executing": 1,
    "pending": 1
  }
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-state" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_checkpoints", "workflow_id": "wf-001"}'
```

---

### recover_stuck

Find and requeue stuck executing steps. Steps with fewer than 3 execution attempts are requeued (set back to `planned`). Steps with 3 or more attempts are marked `failed` (abandoned).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | yes | Session ID to recover |

**Response:**

```json
{
  "session_id": "abc-123",
  "requeued": 2,
  "abandoned": 1,
  "requeued_steps": [
    { "id": "...", "step_index": 1, "workflow_id": "wf-001", "execution_count": 1 }
  ],
  "abandoned_steps": [
    { "id": "...", "step_index": 3, "workflow_id": "wf-001", "execution_count": 3 }
  ]
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-state" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "recover_stuck", "session_id": "abc-123"}'
```

---

### record_usage

Record token usage to the budget ledger. Automatically computes cumulative totals from prior entries and updates denormalized session totals.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | yes | Session ID |
| turn_number | number | yes | Turn number within the session |
| input_tokens | number | no | Input tokens for this turn. Default: `0` |
| output_tokens | number | no | Output tokens for this turn. Default: `0` |
| cache_write_tokens | number | no | Cache write tokens. Default: `0` |
| cache_read_tokens | number | no | Cache read tokens. Default: `0` |
| cost_usd | number | no | Cost in USD for this turn. Default: `0` |
| model | string | no | Model name used. Default: `null` |
| max_turns | number | no | Turn limit for the session. Default: `null` |
| max_budget_tokens | number | no | Token budget limit. Default: `null` |
| max_budget_usd | number | no | USD budget limit. Default: `null` |
| stop_reason | string | no | Why the turn stopped. Default: `null` |
| compaction_triggered | boolean | no | Whether compaction was triggered. Default: `false` |
| compaction_messages_removed | number | no | Messages removed by compaction. Default: `0` |
| consecutive_compaction_failures | number | no | Consecutive compaction failures. Default: `0` |

**Response (201):**

```json
{
  "ledger_entry": { ...budget_ledger row with cumulative fields }
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-state" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "record_usage",
    "session_id": "abc-123",
    "turn_number": 1,
    "input_tokens": 1500,
    "output_tokens": 800,
    "cost_usd": 0.012,
    "model": "claude-sonnet-4-20250514",
    "max_turns": 50,
    "max_budget_usd": 1.00
  }'
```

---

### get_budget

Get current budget summary for a session. Returns remaining budget, percentage used, and limits.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | yes | Session ID |

**Response:**

```json
{
  "session_id": "abc-123",
  "turns_used": 5,
  "turns_remaining": 45,
  "tokens_used": 12000,
  "tokens_remaining": 88000,
  "cost_usd": 0.15,
  "cost_remaining_usd": 0.85,
  "budget_percent": 15.0,
  "limits": {
    "max_turns": 50,
    "max_budget_tokens": 100000,
    "max_budget_usd": 1.0
  },
  "last_stop_reason": null,
  "last_model": "claude-sonnet-4-20250514"
}
```

If no budget entries exist yet:

```json
{
  "session_id": "abc-123",
  "turns_used": 0,
  "tokens_used": 0,
  "cost_usd": 0,
  "entries_count": 0,
  "message": "No budget entries recorded yet"
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-state" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_budget", "session_id": "abc-123"}'
```

---

### check_budget

Pre-turn budget check. Returns whether the agent can proceed and the specific stop reason if a budget limit has been reached. Checks turn limit, token budget, and USD budget in order.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | yes | Session ID |
| max_turns | number | no | Override turn limit (falls back to latest ledger entry limit) |
| max_budget_tokens | number | no | Override token limit (falls back to latest ledger entry limit) |
| max_budget_usd | number | no | Override USD limit (falls back to latest ledger entry limit) |

**Response (can proceed):**

```json
{
  "can_proceed": true,
  "stop_reason": null,
  "budget_status": {
    "turns_used": 5,
    "tokens_used": 12000,
    "cost_usd": 0.15,
    "limits": {
      "max_turns": 50,
      "max_budget_tokens": 100000,
      "max_budget_usd": 1.0
    }
  }
}
```

**Response (budget exceeded):**

```json
{
  "can_proceed": false,
  "stop_reason": "max_turns_reached",
  "budget_status": {
    "turns_used": 50,
    "turns_limit": 50,
    "tokens_used": 95000,
    "cost_usd": 0.87
  }
}
```

Possible `stop_reason` values: `max_turns_reached`, `max_budget_tokens_reached`, `max_budget_usd_reached`.

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-state" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "check_budget", "session_id": "abc-123"}'
```

---

## agent-stream

System Event Logging, Event Querying, Verification, and Cleanup.

### log_event

Log a single system event.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | yes | Session ID |
| category | string | yes | Event category (see valid values below) |
| severity | string | yes | Severity level: `debug`, `info`, `warn`, `error`, `critical` |
| title | string | yes | Event title (max 200 characters) |
| detail | object | no | Additional detail payload. Default: `{}` |
| sequence | number | no | Sequence number within the session. Default: `0` |

Valid categories: `initialization`, `registry`, `tool_selection`, `permission`, `execution`, `stream`, `turn_complete`, `session`, `compaction`, `usage`, `error`, `hook`, `verification`, `boot`, `doctor`, `config`.

**Response:**

```json
{
  "ok": true,
  "event_id": "uuid-here"
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-stream" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "log_event",
    "session_id": "abc-123",
    "category": "execution",
    "severity": "info",
    "title": "Tool call completed: web_search",
    "detail": {"tool": "web_search", "duration_ms": 450}
  }'
```

---

### log_events_batch

Log multiple system events in a single request. Maximum batch size: 500 events.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| events | array | yes | Array of event objects (same fields as `log_event`: session_id, category, severity, title, detail, sequence). If `sequence` is omitted, defaults to the event's array index. |

**Response:**

```json
{
  "ok": true,
  "inserted": 10,
  "event_ids": ["uuid-1", "uuid-2", "..."]
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-stream" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "log_events_batch",
    "events": [
      {"session_id": "abc-123", "category": "execution", "severity": "info", "title": "Step 1 done"},
      {"session_id": "abc-123", "category": "execution", "severity": "info", "title": "Step 2 done"}
    ]
  }'
```

---

### query_events

Query system events with filters and pagination.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | no | Filter by session |
| category | string | no | Filter by exact category |
| severity | string | no | Filter by exact severity |
| min_severity | string | no | Filter by minimum severity (inclusive). E.g., `warn` returns warn, error, critical |
| since | string | no | ISO timestamp lower bound (inclusive) |
| until | string | no | ISO timestamp upper bound (inclusive) |
| limit | number | no | Max results (1-1000). Default: `50` |
| offset | number | no | Pagination offset. Default: `0` |

**Response:**

```json
{
  "events": [ { ...system_events row } ],
  "count": 10,
  "offset": 0,
  "limit": 50
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-stream" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "query_events",
    "session_id": "abc-123",
    "min_severity": "warn",
    "limit": 20
  }'
```

---

### get_event_summary

Get aggregated event summary for a session (from the `session_event_summary` view).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | yes | Session ID |

**Response:**

```json
{
  "summary": { ...session_event_summary row }
}
```

If no events found:

```json
{
  "summary": null,
  "message": "No events found for session"
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-stream" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_event_summary", "session_id": "abc-123"}'
```

---

### run_verification

Run a verification suite and store results. Also creates a cross-referenced system event.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | yes | Session ID |
| trigger | string | yes | What triggered this verification. Valid: `prompt_change`, `model_swap`, `tool_change`, `routing_change`, `manual`, `post_session`, `scheduled` |
| results | array | yes | Array of check result objects (see below) |

Each result object:

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | yes | Check name |
| passed | boolean | yes | Whether the check passed |
| message | string | yes | Human-readable result message |
| severity | string | yes | `blocking`, `warning`, or `info` |
| evidence | array | no | Supporting evidence items |

**Response:**

```json
{
  "ok": true,
  "run_id": "uuid-here",
  "verdict": "pass",
  "passed": 5,
  "failed": 0,
  "warnings": 0
}
```

Verdict logic: `fail` if any blocking check failed, `warn` if any non-blocking check failed, `pass` otherwise.

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-stream" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "run_verification",
    "session_id": "abc-123",
    "trigger": "post_session",
    "results": [
      {"name": "memory_integrity", "passed": true, "message": "All memories valid", "severity": "blocking"},
      {"name": "token_budget", "passed": false, "message": "Over 90% budget used", "severity": "warning"}
    ]
  }'
```

---

### get_verification_runs

Query verification run history.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | no | Filter by session |
| verdict | string | no | Filter by verdict: `pass`, `warn`, `fail` |
| limit | number | no | Max results (1-100). Default: `20` |

**Response:**

```json
{
  "runs": [ { ...verification_runs row } ],
  "count": 3
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-stream" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_verification_runs", "session_id": "abc-123", "verdict": "fail"}'
```

---

### cleanup_events

Delete old system events beyond a retention period. Calls the `cleanup_old_system_events` database function and logs the cleanup as a system event.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| retention_days | number | no | Days of events to keep (1-365). Default: `30` |

**Response:**

```json
{
  "ok": true,
  "deleted_count": 150,
  "retention_days": 30
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-stream" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "cleanup_events", "retention_days": 14}'
```

---

## agent-doctor

Health Checks, Boot Tracking & Scoped Configuration.

### run_doctor

Run a comprehensive health check across 6 categories: workspace (required tables), configuration, credentials, connections (database ping), tools, and sessions (orphaned sessions, stuck workflows, budget anomalies, boot failures). Persists the report as a system event.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | no | Session ID to associate with the report. Default: `system` |

**Response:**

```json
{
  "run_id": "uuid-here",
  "session_id": "system",
  "timestamp": "2026-04-04T12:00:00.000Z",
  "total_duration_ms": 1500,
  "checks": [
    {
      "category": "workspace",
      "check": "table_exists_thoughts",
      "status": "pass",
      "detail": "Table 'thoughts' accessible",
      "duration_ms": 45
    },
    {
      "category": "sessions",
      "check": "orphaned_sessions",
      "status": "warn",
      "detail": "2 orphaned session(s) (active but stale >24h)",
      "fix_action": "Mark stale sessions as 'crashed' via session management",
      "duration_ms": 120
    }
  ],
  "summary": {
    "pass": 14,
    "warn": 2,
    "fail": 0,
    "auto_repaired": 0,
    "total": 16
  }
}
```

Check categories and what they verify:
- **workspace**: All 9 required tables exist and are accessible (`thoughts`, `tool_registry`, `permission_policies`, `agent_sessions`, `budget_ledger`, `system_events`, `verification_runs`, `boot_runs`, `agent_config`)
- **configuration**: Config entries exist, latest config is valid
- **credentials**: Supabase service role authentication works
- **connections**: Database ping and response time (warns if >5000ms)
- **tools**: Tool registry is populated, no orphaned permission policies
- **sessions**: Orphaned sessions (>24h stale), stuck workflows (>2h), budget anomalies, recent boot failures (last hour)

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-doctor" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "run_doctor", "session_id": "abc-123"}'
```

---

### get_doctor_report

Retrieve stored doctor reports from system events.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | no | Filter by session |
| limit | number | no | Number of reports to return (1-20). Default: `1` |

**Response:**

```json
{
  "reports": [ { ...full DoctorReport object } ],
  "count": 1
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-doctor" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_doctor_report", "limit": 5}'
```

---

### record_boot

Record a boot run with phase timings, fast-path detection, and failure details. Also logs as a system event.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | yes | Session ID |
| status | string | yes | Boot status: `running`, `completed`, `failed`, `rolled_back` |
| reached_phase | string | yes | Last phase successfully reached |
| phase_timings | object | yes | Map of phase name to timing data |
| failed_phase | string | no | Phase where failure occurred. Default: `null` |
| failure_reason | string | no | Reason for failure. Default: `null` |
| fast_path_used | string | no | Which fast path was used (if any). Default: `null` |
| config_scope_sources | object | no | Config scope source map. Default: `{}` |
| trust_mode | string | no | Trust mode active during boot. Default: `null` |
| doctor_summary | object | no | Doctor check summary from boot. Default: `{}` |
| total_duration_ms | number | no | Total boot duration in milliseconds. Default: `null` |

**Response:**

```json
{
  "ok": true,
  "run_id": "uuid-here"
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-doctor" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "record_boot",
    "session_id": "abc-123",
    "status": "completed",
    "reached_phase": "ready",
    "phase_timings": {"init": 50, "config": 120, "tools": 300, "ready": 10},
    "total_duration_ms": 480
  }'
```

---

### get_boot_history

Query boot run history.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | no | Filter by session |
| status | string | no | Filter by status: `running`, `completed`, `failed`, `rolled_back` |
| limit | number | no | Max results (1-100). Default: `20` |

**Response:**

```json
{
  "runs": [ { ...boot_runs row } ],
  "count": 5
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-doctor" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_boot_history", "status": "failed", "limit": 10}'
```

---

### get_boot_performance

Query boot performance summary data from the `boot_performance_summary` view.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | no | Filter by session |
| limit | number | no | Max results (1-100). Default: `20` |

**Response:**

```json
{
  "performance": [ { ...boot_performance_summary row } ],
  "count": 5
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-doctor" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_boot_performance"}'
```

---

### get_config

Get the latest configuration snapshot, optionally filtered by session.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | no | Filter by session (returns latest config for that session) |

**Response:**

```json
{
  "config": { ...agent_config row }
}
```

If no config found:

```json
{
  "config": null,
  "message": "No configuration found"
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-doctor" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_config", "session_id": "abc-123"}'
```

---

### save_config

Save a configuration snapshot. Also logs as a system event.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| merged_config | object | yes | The full merged configuration object |
| session_id | string | no | Associated session ID. Default: `null` |
| provenance | object | no | Config source provenance data. Default: `{}` |
| mcp_servers | array | no | MCP server configurations. Default: `[]` |
| source_files | array | no | Source file paths that contributed to config. Default: `[]` |
| valid | boolean | no | Whether config passed validation. Default: `true` |
| validation_errors | array | no | Validation error list. Default: `[]` |

**Response:**

```json
{
  "ok": true,
  "config_id": "uuid-here"
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-doctor" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "save_config",
    "session_id": "abc-123",
    "merged_config": {"model": "claude-sonnet-4-20250514", "max_turns": 50},
    "source_files": [".claude/config.json", "CLAUDE.md"],
    "valid": true
  }'
```

---

## agent-memory

Memory Store, Recall, Versioning & Consolidation. Provides CRUD+search operations for the OB1 `thoughts` table with embedding generation (via OpenAI `text-embedding-3-small`), provenance tracking, soft-delete, version chains, and memory consolidation.

### memory_store

Create a thought with auto-generated embedding and provenance metadata.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| content | string | yes | The memory content text |
| memory_type | string | yes | Type: `fact`, `preference`, `decision`, `instruction`, `observation`, `context` |
| memory_scope | string | yes | Scope: `personal`, `team`, `project`, `agent` |
| source_type | string | no | How the memory was created: `user_stated`, `model_inferred`, `tool_observed`, `compaction_derived`. Default: `model_inferred` |
| trust_level | number | no | Trust level (0-5). Default: auto-determined by source_type (user_stated=5, tool_observed=4, model_inferred=3, compaction_derived=2) |
| tags | string[] | no | Tags for categorization. Default: `[]` |
| owner_id | string | no | Owner user ID |
| team_id | string | no | Team ID |
| project_id | string | no | Project ID |
| agent_id | string | no | Agent ID |
| session_id | string | no | Session ID |
| relevance_boost | number | no | Boost factor for search ranking. Default: `1.0` |
| pin | boolean | no | Pin this memory (prevents aging decay) |

**Response:**

```json
{
  "thought_id": "uuid-here",
  "content_fingerprint": "sha256-hash",
  "memory_scope": "personal",
  "memory_type": "fact",
  "source_type": "user_stated",
  "trust_level": 5,
  "has_embedding": true,
  "created_at": "2026-04-04T12:00:00.000Z"
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-memory" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "memory_store",
    "content": "Robin prefers production-first architecture, MVP only as fallback",
    "memory_type": "preference",
    "memory_scope": "personal",
    "source_type": "user_stated",
    "tags": ["architecture", "workflow"]
  }'
```

---

### memory_recall

Search memories using vector similarity via `match_thoughts_scored()`. Supports scope, type, trust, and ownership filters. Automatically excludes soft-deleted memories.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | yes | Natural language search query |
| memory_scope | string | no | Filter by scope: `personal`, `team`, `project`, `agent`, or `all`. Default: `all` |
| memory_type | string | no | Filter by type: `fact`, `preference`, `decision`, `instruction`, `observation`, `context` |
| max_results | number | no | Maximum results to return. Default: `10` |
| min_similarity | number | no | Minimum cosine similarity threshold (0-1). Default: `0.5` |
| include_aged_score | boolean | no | Apply aging decay to scores. Default: `true` |
| owner_id | string | no | Filter by owner |
| team_id | string | no | Filter by team |
| project_id | string | no | Filter by project |
| min_trust_level | number | no | Minimum trust level (0-5). Default: `0` |

**Response:**

```json
{
  "query": "architecture preferences",
  "results": [
    {
      "thought_id": "uuid-here",
      "content": "Robin prefers production-first architecture...",
      "similarity": 0.89,
      "aged_score": 0.85,
      "memory_scope": "personal",
      "memory_type": "preference",
      "tags": ["architecture", "workflow"],
      "provenance": {
        "source_type": "user_stated",
        "trust_level": 5,
        "created_at": "2026-04-04T12:00:00.000Z"
      },
      "version": 1,
      "created_at": "2026-04-04T12:00:00.000Z"
    }
  ],
  "result_count": 1,
  "scope_filter": "all",
  "type_filter": "all",
  "min_similarity": 0.5,
  "aged_scoring": true
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-memory" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "memory_recall",
    "query": "what are the user preferences for code architecture?",
    "memory_scope": "personal",
    "max_results": 5,
    "min_trust_level": 3
  }'
```

---

### memory_forget

Soft-delete a memory by setting `metadata.deleted = true`. The thought remains in the database but is excluded from recall results.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| thought_id | string | yes | UUID of the thought to forget |
| reason | string | yes | Reason for forgetting this memory |

**Response:**

```json
{
  "thought_id": "uuid-here",
  "forgotten": true,
  "reason": "Outdated preference",
  "deleted_at": "2026-04-04T12:00:00.000Z"
}
```

**Error (404):** Thought not found.
**Error (409):** Memory is already forgotten.

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-memory" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "memory_forget",
    "thought_id": "abc-uuid-here",
    "reason": "Preference has changed"
  }'
```

---

### memory_update

Create a new version of a memory. The old version is preserved and linked via a version chain. Records the version in the `memory_versions` table.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| thought_id | string | yes | UUID of the existing thought to update |
| new_content | string | yes | Updated content text |
| reason | string | no | Reason for the update. Default: `Updated content` |

**Response:**

```json
{
  "new_thought_id": "new-uuid-here",
  "previous_thought_id": "old-uuid-here",
  "version": 2,
  "reason": "Corrected factual error",
  "created_at": "2026-04-04T12:00:00.000Z"
}
```

**Error (404):** Thought not found.
**Error (409):** Cannot update a forgotten memory.

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-memory" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "memory_update",
    "thought_id": "abc-uuid-here",
    "new_content": "Robin prefers production-first architecture with progressive enhancement",
    "reason": "Updated with more specific preference"
  }'
```

---

### memory_consolidate

Merge multiple similar memories into a single consolidated thought. Source memories are soft-deleted and linked to the new consolidated thought. Automatically inherits the best scope, most common type, highest trust level, and all tags from sources.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| thought_ids | string[] | yes | Array of thought UUIDs to consolidate (minimum 2) |
| consolidated_content | string | yes | The merged content for the new thought |
| resolution_notes | string | no | Notes explaining how conflicts were resolved. Default: `""` |

**Response:**

```json
{
  "consolidated_thought_id": "new-uuid-here",
  "source_count": 3,
  "sources_retired": ["uuid-1", "uuid-2", "uuid-3"],
  "memory_scope": "project",
  "memory_type": "fact",
  "trust_level": 5,
  "resolution_notes": "Merged three overlapping observations about deployment",
  "created_at": "2026-04-04T12:00:00.000Z"
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-memory" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "memory_consolidate",
    "thought_ids": ["uuid-1", "uuid-2", "uuid-3"],
    "consolidated_content": "The project uses Supabase for both database and edge functions, deployed via the Supabase CLI.",
    "resolution_notes": "Combined three separate observations about the tech stack"
  }'
```

---

### get_memory_stats

Get memory counts broken down by scope, type, and age buckets. Excludes soft-deleted memories.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| owner_id | string | no | Filter counts by owner |
| team_id | string | no | Filter counts by team |
| project_id | string | no | Filter counts by project |

**Response:**

```json
{
  "total_memories": 142,
  "by_scope": {
    "personal": 80,
    "project": 45,
    "team": 12,
    "agent": 5
  },
  "by_type": {
    "fact": 60,
    "preference": 25,
    "decision": 20,
    "instruction": 15,
    "observation": 12,
    "context": 10
  },
  "by_age": {
    "last_24h": 5,
    "last_7d": 20,
    "last_30d": 50,
    "last_90d": 100,
    "older": 42
  }
}
```

Note: The `by_age` field is only present when the fallback query path is used (when the `exec_sql` RPC is not available).

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-memory" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_memory_stats", "project_id": "proj-123"}'
```

---

## agent-skills

Skill, Hook & Plugin CRUD. Manages skill definitions, hook configurations (PreToolUse/PostToolUse), plugin packages, and hook execution logs.

### list_skills

List skills with optional filters.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| source_type | string | no | Filter by source: `bundled`, `user`, `ob1`, `mcp_generated` |
| enabled_only | boolean | no | Only return enabled skills. Default: `true` |
| plugin_id | string | no | Filter by parent plugin ID |
| search | string | no | Search by name or description (case-insensitive substring match) |

**Response:**

```json
{
  "skills": [ { ...skill_registry row } ],
  "count": 5
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-skills" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "list_skills", "source_type": "bundled"}'
```

---

### register_skill

Register a new skill definition. Upserts on the `slug` column.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | yes | Display name |
| slug | string | yes | Unique URL-friendly identifier |
| description | string | yes | Skill description |
| prompt_template | string | yes | The prompt template for this skill |
| version | string | no | Semantic version. Default: `1.0.0` |
| source_type | string | no | Source: `bundled`, `user`, `ob1`, `mcp_generated`. Default: `user` |
| source_path | string | no | Path to source file. Default: `null` |
| ob1_slug | string | no | OB1 community slug reference. Default: `null` |
| trigger | object | no | Trigger configuration. Default: `{}` |
| input_contract | object | no | Input contract schema. Default: `{}` |
| output_contract | object | no | Output contract schema. Default: `{}` |
| tool_requirements | array | no | Required tool names. Default: `[]` |
| plugin_id | string | no | Parent plugin ID. Default: `null` |
| trust_tier | string | no | Trust tier: `built_in`, `plugin`, `skill`. Default: `skill` |
| enabled | boolean | no | Whether skill is active. Default: `true` |
| metadata | object | no | Arbitrary metadata. Default: `{}` |

**Response:**

```json
{
  "skill": { ...skill_registry row },
  "registered": true
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-skills" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "register_skill",
    "name": "Morning Report",
    "slug": "morning-report",
    "description": "Generate a daily status summary",
    "prompt_template": "Review all agent activity from the last 24 hours and produce a summary...",
    "source_type": "user",
    "trust_tier": "skill"
  }'
```

---

### update_skill

Update an existing skill's metadata.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| slug | string | yes | Skill slug to identify the skill |
| name | string | no | Updated name |
| description | string | no | Updated description |
| version | string | no | Updated version |
| source_type | string | no | Updated source: `bundled`, `user`, `ob1`, `mcp_generated` |
| source_path | string | no | Updated source path |
| ob1_slug | string | no | Updated OB1 slug |
| prompt_template | string | no | Updated prompt template |
| trigger | object | no | Updated trigger config |
| input_contract | object | no | Updated input contract |
| output_contract | object | no | Updated output contract |
| tool_requirements | array | no | Updated tool requirements |
| plugin_id | string | no | Updated plugin ID |
| trust_tier | string | no | Updated trust tier: `built_in`, `plugin`, `skill` |
| enabled | boolean | no | Updated enabled status |
| metadata | object | no | Updated metadata |

**Response:**

```json
{
  "skill": { ...updated skill_registry row },
  "updated": true
}
```

**Error (404):** Skill not found.

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-skills" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "update_skill", "slug": "morning-report", "enabled": false}'
```

---

### delete_skill

Remove a skill by slug.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| slug | string | yes | Skill slug to delete |

**Response:**

```json
{
  "slug": "morning-report",
  "deleted": true,
  "rows_affected": 1
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-skills" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "delete_skill", "slug": "morning-report"}'
```

---

### list_hooks

List hook configurations.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| event_type | string | no | Filter by event: `PreToolUse`, `PostToolUse` |
| enabled_only | boolean | no | Only return enabled hooks. Default: `true` |
| plugin_id | string | no | Filter by parent plugin ID |

**Response:**

```json
{
  "hooks": [ { ...hook_configurations row } ],
  "count": 3
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-skills" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "list_hooks", "event_type": "PreToolUse"}'
```

---

### register_hook

Register a hook command for PreToolUse or PostToolUse events.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | yes | Hook name |
| event_type | string | yes | Event type: `PreToolUse` or `PostToolUse` |
| command | string | yes | Command to execute when hook fires |
| tool_filter | string[] | no | Only fire for these tool names. Default: `[]` (all tools) |
| priority | number | no | Execution priority (lower = earlier). Default: `100` |
| timeout_ms | number | no | Timeout in milliseconds. Default: `30000` |
| plugin_id | string | no | Parent plugin ID. Default: `null` |
| trust_tier | string | no | Trust tier: `built_in`, `plugin`, `skill`. Default: `skill` |
| enabled | boolean | no | Whether hook is active. Default: `true` |
| metadata | object | no | Arbitrary metadata. Default: `{}` |

**Response:**

```json
{
  "hook": { ...hook_configurations row },
  "registered": true
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-skills" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "register_hook",
    "name": "log_bash_commands",
    "event_type": "PreToolUse",
    "command": "echo \"Tool called: $TOOL_NAME\"",
    "tool_filter": ["bash"],
    "priority": 50
  }'
```

---

### list_plugins

List all registered plugins.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| status | string | no | Filter by status: `enabled`, `disabled`, `installing`, `error` |
| trust_tier | string | no | Filter by trust tier |

**Response:**

```json
{
  "plugins": [ { ...plugin_registry row } ],
  "count": 2
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-skills" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "list_plugins", "status": "enabled"}'
```

---

### register_plugin

Register a plugin package. Upserts on the `slug` column.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | yes | Plugin display name |
| slug | string | yes | Unique URL-friendly identifier |
| description | string | no | Plugin description. Default: `null` |
| version | string | no | Semantic version. Default: `1.0.0` |
| author_name | string | no | Author name. Default: `null` |
| author_github | string | no | Author GitHub handle. Default: `null` |
| trust_tier | string | no | Trust tier: `built_in`, `plugin`. Default: `plugin` |
| granted_permissions | object | no | Permissions granted to this plugin. Default: `{}` |
| manifest | object | no | Plugin manifest. Default: `{}` |
| source_url | string | no | URL to plugin source. Default: `null` |
| metadata | object | no | Arbitrary metadata. Default: `{}` |

**Response:**

```json
{
  "plugin": { ...plugin_registry row },
  "registered": true
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-skills" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "register_plugin",
    "name": "SEO Tools",
    "slug": "seo-tools",
    "description": "Collection of SEO analysis skills",
    "version": "1.0.0",
    "author_github": "robin"
  }'
```

---

### update_plugin_status

Enable, disable, or uninstall a plugin. Status changes cascade to associated skills and hooks. Uninstall deletes the plugin and all associated resources.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| plugin_id | string | yes | Plugin UUID |
| status | string | yes | New status: `enabled`, `disabled`, or `uninstall` |

**Response (enable/disable):**

```json
{
  "plugin": { ...plugin_registry row },
  "status": "disabled",
  "cascaded_to_skills": true,
  "cascaded_to_hooks": true
}
```

**Response (uninstall):**

```json
{
  "plugin_id": "uuid-here",
  "status": "uninstalled",
  "message": "Plugin and all associated skills/hooks have been removed."
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-skills" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "update_plugin_status", "plugin_id": "uuid-here", "status": "disabled"}'
```

---

### get_hook_log

Query hook execution history for a session.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session_id | string | yes | Session ID |
| outcome | string | no | Filter by outcome: `allow`, `warn`, `deny`, `timeout`, `error` |
| tool_name | string | no | Filter by tool name |
| hook_config_id | string | no | Filter by specific hook configuration ID |
| limit | number | no | Max results. Default: `50` |

**Response:**

```json
{
  "log": [ { ...hook_execution_log row } ],
  "count": 10
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-skills" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_hook_log", "session_id": "abc-123", "outcome": "deny"}'
```

---

## agent-coordinator

Agent Types, Runs & Inter-Agent Messaging. Manages agent type definitions, agent run lifecycle, inter-agent communication, and coordinator summaries.

### list_agent_types

List available agent types.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| source | string | no | Filter by source: `built_in`, `custom`, `skill_pack` |
| enabled_only | boolean | no | Only return enabled types. Default: `true` |

**Response:**

```json
{
  "agent_types": [ { ...agent_types row } ],
  "count": 5
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-coordinator" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "list_agent_types", "source": "custom"}'
```

---

### register_agent_type

Register a custom agent type. Upserts on the `name` column.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | yes | Unique agent type name (used as identifier) |
| display_name | string | yes | Human-readable display name |
| system_prompt | string | yes | System prompt for this agent type |
| description | string | no | Agent type description. Default: `""` |
| source | string | no | Source: `built_in`, `custom`, `skill_pack`. Default: `custom` |
| permission_mode | string | no | Permission mode: `read_only`, `workspace_write`, `danger_full_access`. Default: `read_only` |
| allowed_tools | string[] | no | Tools this agent type can use. Default: `[]` |
| denied_tools | string[] | no | Tools this agent type cannot use. Default: `[]` |
| denied_prefixes | string[] | no | Tool name prefix deny list. Default: `[]` |
| constraints | string[] | no | Behavioral constraints. Default: `[]` |
| max_iterations | number | no | Max iterations before timeout. Default: `50` |
| output_format | string | no | Expected output format: `markdown`, `json`, `structured_facts`, `plan`, `status`, `free`. Default: `markdown` |
| handler_type | string | no | Handler type: `interactive`, `coordinator`, `swarm_worker`. Default: `coordinator` |
| color | string | no | UI color hint. Default: `null` |
| icon | string | no | UI icon hint. Default: `null` |
| can_spawn | boolean | no | Whether this agent type can spawn sub-agents. Default: `false` |
| metadata | object | no | Arbitrary metadata. Default: `{}` |

**Response:**

```json
{
  "agent_type": { ...agent_types row },
  "registered": true
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-coordinator" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "register_agent_type",
    "name": "researcher",
    "display_name": "Research Agent",
    "system_prompt": "You are a research agent. Gather information and report findings.",
    "permission_mode": "read_only",
    "output_format": "structured_facts",
    "max_iterations": 20
  }'
```

---

### spawn_agent

Create an agent run record. Looks up the agent type by name, generates a unique run ID, and resolves coordinator/parent run IDs (accepts both UUID and run_id string).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| agent_type | string | yes | Agent type name (must exist and be enabled) |
| task_prompt | string | yes | The task description for this agent |
| task_context | object | no | Additional context data. Default: `{}` |
| coordinator_run_id | string | no | Parent coordinator run (UUID or run_id string). Default: `null` |
| parent_run_id | string | no | Direct parent run (UUID or run_id string). Default: `null` |
| depends_on | string[] | no | Run IDs this agent depends on. Default: `[]` |
| session_id | string | no | Associated session ID. Default: `null` |
| metadata | object | no | Arbitrary metadata. Default: `{}` |

**Response:**

```json
{
  "id": "db-uuid",
  "run_id": "agent_researcher_1712232000000_a3b4c5",
  "agent_type": "researcher",
  "status": "pending",
  "created_at": "2026-04-04T12:00:00.000Z",
  "message": "Agent spawned. Use update_agent_status to transition its lifecycle."
}
```

**Error (404):** Unknown or disabled agent type.

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-coordinator" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "spawn_agent",
    "agent_type": "researcher",
    "task_prompt": "Find the top 5 competitors for acme.com",
    "task_context": {"domain": "acme.com"},
    "session_id": "abc-123"
  }'
```

---

### update_agent_status

Update agent run status and optionally set results. Automatically sets `started_at` when transitioning to `running`, and `completed_at` + `duration_ms` when transitioning to a terminal state.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| run_id | string | yes | Agent run ID string |
| status | string | yes | New status: `pending`, `running`, `completed`, `failed`, `cancelled`, `timeout` |
| output_summary | string | no | Human-readable output summary |
| output_data | object | no | Structured output data |
| error_message | string | no | Error message (for failed/timeout) |
| thought_ids | string[] | no | Associated thought IDs |
| total_input_tokens | number | no | Total input tokens consumed |
| total_output_tokens | number | no | Total output tokens consumed |
| total_cost_usd | number | no | Total cost in USD |
| iteration_count | number | no | Number of iterations performed |

**Response:**

```json
{
  "run": { ...updated agent_runs row },
  "updated": true
}
```

**Error (404):** Agent run not found.

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-coordinator" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "update_agent_status",
    "run_id": "agent_researcher_1712232000000_a3b4c5",
    "status": "completed",
    "output_summary": "Found 5 competitors with DR > 50",
    "output_data": {"competitors": ["comp1.com", "comp2.com"]},
    "total_cost_usd": 0.05
  }'
```

---

### get_agent_run

Get agent run details by run_id.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| run_id | string | yes | Agent run ID string |

**Response:**

```json
{
  "run": { ...agent_runs row }
}
```

**Error (404):** Agent run not found.

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-coordinator" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_agent_run", "run_id": "agent_researcher_1712232000000_a3b4c5"}'
```

---

### list_agent_runs

List agent runs with optional filters.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| coordinator_run_id | string | no | Filter by coordinator (accepts UUID or run_id string) |
| status | string | no | Filter by status: `pending`, `running`, `completed`, `failed`, `cancelled`, `timeout` |
| agent_type | string | no | Filter by agent type name |
| limit | number | no | Max results. Default: `50` |
| offset | number | no | Pagination offset. Default: `0` |

**Response:**

```json
{
  "runs": [ { ...agent_runs row } ],
  "count": 3
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-coordinator" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "list_agent_runs", "status": "running", "limit": 10}'
```

---

### send_message

Send an inter-agent message. Resolves run_id strings to UUIDs for foreign key references.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| coordinator_run_id | string | yes | Coordinator run (UUID or run_id string) |
| from_run_id | string | yes | Sender agent run (UUID or run_id string) |
| content | object | yes | Message content payload |
| to_run_id | string | no | Recipient agent run (UUID or run_id string). `null` = broadcast. Default: `null` |
| channel | string | no | Message channel name. Default: `default` |
| message_type | string | no | Type: `data`, `finding`, `request`, `status_update`, `error`, `completion`. Default: `data` |
| summary | string | no | Short message summary. Default: `null` |
| thought_id | string | no | Associated thought ID. Default: `null` |

**Response:**

```json
{
  "message_id": "uuid-here",
  "sent": true,
  "created_at": "2026-04-04T12:00:00.000Z"
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-coordinator" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "send_message",
    "coordinator_run_id": "agent_coordinator_1712232000000_x1y2z3",
    "from_run_id": "agent_researcher_1712232000000_a3b4c5",
    "to_run_id": "agent_writer_1712232000000_d6e7f8",
    "content": {"competitors": ["comp1.com", "comp2.com"]},
    "message_type": "finding",
    "summary": "Top 2 competitors identified"
  }'
```

---

### get_messages

Get messages for an agent. By default returns only undelivered messages. Messages addressed to the agent directly or broadcast (to_run_id = null) are both included.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| coordinator_run_id | string | yes | Coordinator run (UUID or run_id string) |
| run_id | string | yes | Agent run receiving messages (UUID or run_id string) |
| undelivered_only | boolean | no | Only return undelivered messages. Default: `true` |
| channel | string | no | Filter by channel |
| limit | number | no | Max results. Default: `50` |

**Response:**

```json
{
  "messages": [ { ...agent_messages row } ],
  "count": 2,
  "undelivered_only": true
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-coordinator" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "get_messages",
    "coordinator_run_id": "agent_coordinator_1712232000000_x1y2z3",
    "run_id": "agent_writer_1712232000000_d6e7f8"
  }'
```

---

### mark_delivered

Mark messages as delivered.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| message_ids | string[] | yes | Array of message UUIDs to mark as delivered (must be non-empty) |

**Response:**

```json
{
  "marked_delivered": true,
  "count": 2,
  "delivered_at": "2026-04-04T12:00:00.000Z"
}
```

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-coordinator" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "mark_delivered", "message_ids": ["uuid-1", "uuid-2"]}'
```

---

### get_agent_summary

Get summary of a coordinator's agents. Returns counts by status, total cost/tokens, timing stats, and failed agent details.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| coordinator_run_id | string | yes | Coordinator run (UUID or run_id string) |

**Response:**

```json
{
  "coordinator_run_id": "agent_coordinator_1712232000000_x1y2z3",
  "overall_status": "completed_with_errors",
  "total_agents": 5,
  "by_status": {
    "pending": 0,
    "running": 0,
    "completed": 4,
    "failed": 1,
    "cancelled": 0,
    "timeout": 0
  },
  "totals": {
    "cost_usd": 0.25,
    "input_tokens": 50000,
    "output_tokens": 15000,
    "duration_ms": 120000
  },
  "failed_agents": [
    {
      "run_id": "agent_scraper_1712232000000_g9h0i1",
      "agent_type": "scraper",
      "error": "Target site returned 403"
    }
  ],
  "agents": [
    {
      "run_id": "agent_researcher_1712232000000_a3b4c5",
      "agent_type": "researcher",
      "status": "completed",
      "duration_ms": 30000,
      "cost_usd": 0.05
    }
  ]
}
```

Overall status values: `empty` (no agents), `in_progress` (any pending/running), `completed_with_errors` (any failed/timeout), `completed` (all succeeded).

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent-coordinator" \
  -H "x-access-key: $OB1_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_agent_summary", "coordinator_run_id": "agent_coordinator_1712232000000_x1y2z3"}'
```
