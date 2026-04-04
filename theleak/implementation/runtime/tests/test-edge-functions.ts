// =============================================================================
// Integration Tests: Edge Function APIs
//
// Validates the OB1 Edge Functions (agent-tools, agent-state, agent-doctor,
// agent-coordinator) respond correctly to valid and invalid requests.
//
// Env vars required:
//   SUPABASE_URL   — project URL (e.g. https://xxx.supabase.co)
//   OB1_ACCESS_KEY — the shared access key configured in Edge Function secrets
//
// Run:
//   npx tsx tests/test-edge-functions.ts
//   # or
//   node --import tsx tests/test-edge-functions.ts
// =============================================================================

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL;
const ACCESS_KEY = process.env.OB1_ACCESS_KEY;

if (!SUPABASE_URL || !ACCESS_KEY) {
  console.error("Missing env vars. Set SUPABASE_URL and OB1_ACCESS_KEY.");
  process.exit(1);
}

/** Build the full Edge Function URL for a given function name. */
function fnUrl(name: string): string {
  return `${SUPABASE_URL}/functions/v1/${name}`;
}

/** POST to an Edge Function with the access key. */
async function postFn(
  functionName: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(fnUrl(functionName), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-key": ACCESS_KEY!,
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
}

/** POST to an Edge Function WITHOUT the access key (for auth tests). */
async function postFnNoAuth(
  functionName: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(fnUrl(functionName), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
}

// Test-scoped IDs for cleanup
const TEST_SESSION_ID = `test_ef_${Date.now()}`;
const TEST_IDEM_KEY = `idem_ef_${Date.now()}`;
const TEST_WORKFLOW_ID = `wf_ef_${Date.now()}`;

// Stored between tests for cross-referencing
let createdSessionId: string | undefined;
let createdCheckpointId: string | undefined;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ==========================================================================
// agent-tools
// ==========================================================================
describe("agent-tools Edge Function", () => {
  describe("Auth", () => {
    it("returns 401 without x-access-key", async () => {
      const { status, data } = await postFnNoAuth("agent-tools", {
        action: "list_tools",
      });

      assert.equal(status, 401, `Expected 401, got ${status}`);
      assert.ok(data.error, "Should have error field");
    });

    it("returns 401 with wrong x-access-key", async () => {
      const res = await fetch(fnUrl("agent-tools"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-access-key": "wrong_key_" + Date.now(),
        },
        body: JSON.stringify({ action: "list_tools" }),
      });

      assert.equal(res.status, 401);
    });
  });

  describe("Invalid action", () => {
    it("returns 400 for missing action", async () => {
      const { status, data } = await postFn("agent-tools", {});
      assert.equal(status, 400);
      assert.ok(data.error, "Should have error message");
    });

    it("returns 400 for unknown action", async () => {
      const { status, data } = await postFn("agent-tools", {
        action: "nonexistent_action",
      });
      assert.equal(status, 400);
      assert.ok(
        (data.error as string).includes("Unknown action"),
        `Error should mention unknown action: ${data.error}`,
      );
    });
  });

  describe("list_tools", () => {
    it("returns 200 with tools array", async () => {
      const { status, data } = await postFn("agent-tools", {
        action: "list_tools",
      });

      assert.equal(status, 200);
      assert.ok(Array.isArray(data.tools), "Should return tools array");
      assert.ok(data.meta, "Should return meta object");
    });

    it("returns the 9 seeded built-in tools", async () => {
      const { status, data } = await postFn("agent-tools", {
        action: "list_tools",
        source_type: "built_in",
      });

      assert.equal(status, 200);
      const tools = data.tools as Array<{ name: string }>;
      assert.equal(tools.length, 9, `Expected 9 built-in tools, got ${tools.length}`);

      const names = tools.map((t) => t.name).sort();
      const expected = [
        "agent",
        "bash",
        "edit_file",
        "glob_search",
        "grep_search",
        "read_file",
        "tool_search",
        "web_fetch",
        "write_file",
      ];

      assert.deepEqual(names, expected);
    });

    it("filters by source_type", async () => {
      const { status, data } = await postFn("agent-tools", {
        action: "list_tools",
        source_type: "plugin",
      });

      assert.equal(status, 200);
      const tools = data.tools as Array<{ source_type: string }>;
      for (const tool of tools) {
        assert.equal(tool.source_type, "plugin");
      }
    });

    it("filters by permission_level", async () => {
      const { status, data } = await postFn("agent-tools", {
        action: "list_tools",
        permission_level: "read_only",
      });

      assert.equal(status, 200);
      const tools = data.tools as Array<{ required_permission: string }>;
      for (const tool of tools) {
        assert.equal(
          tool.required_permission,
          "read_only",
          `Tool should be read_only, got "${tool.required_permission}"`,
        );
      }
    });
  });
});

// ==========================================================================
// agent-state
// ==========================================================================
describe("agent-state Edge Function", () => {
  describe("Auth", () => {
    it("returns 401 without x-access-key", async () => {
      const { status } = await postFnNoAuth("agent-state", {
        action: "create_session",
      });
      assert.equal(status, 401);
    });
  });

  describe("Invalid action", () => {
    it("returns 400 for unknown action", async () => {
      const { status, data } = await postFn("agent-state", {
        action: "bogus_action",
      });
      assert.equal(status, 400);
      assert.ok(data.error);
    });
  });

  describe("create_session -> get_session roundtrip", () => {
    it("creates a session and retrieves it", async () => {
      // Create
      const { status: createStatus, data: createData } = await postFn(
        "agent-state",
        {
          action: "create_session",
          session_id: TEST_SESSION_ID,
          config: { model: "test-model" },
        },
      );

      assert.equal(createStatus, 201, `Create failed: ${JSON.stringify(createData)}`);
      assert.ok(createData.session, "Should return session object");

      const session = createData.session as Record<string, unknown>;
      createdSessionId = session.session_id as string;
      assert.equal(createdSessionId, TEST_SESSION_ID);
      assert.equal(session.status, "active");

      // Get
      const { status: getStatus, data: getData } = await postFn("agent-state", {
        action: "get_session",
        session_id: TEST_SESSION_ID,
      });

      assert.equal(getStatus, 200, `Get failed: ${JSON.stringify(getData)}`);
      assert.ok(getData.session, "Should return session object");
      const fetched = getData.session as Record<string, unknown>;
      assert.equal(fetched.session_id, TEST_SESSION_ID);
      assert.equal(fetched.status, "active");
    });

    it("returns 404 for nonexistent session", async () => {
      const { status } = await postFn("agent-state", {
        action: "get_session",
        session_id: "definitely_does_not_exist_" + Date.now(),
      });
      assert.equal(status, 404);
    });
  });

  describe("create_checkpoint with idempotency_key", () => {
    it("first create returns idempotent=false", async () => {
      const { status, data } = await postFn("agent-state", {
        action: "create_checkpoint",
        session_id: TEST_SESSION_ID,
        workflow_id: TEST_WORKFLOW_ID,
        step_index: 0,
        step_type: "test_step",
        idempotency_key: TEST_IDEM_KEY,
      });

      assert.equal(status, 201, `Create checkpoint failed: ${JSON.stringify(data)}`);
      assert.equal(data.idempotent, false, "First insert should not be idempotent");
      assert.ok(data.checkpoint, "Should return checkpoint object");

      createdCheckpointId = (data.checkpoint as Record<string, unknown>).id as string;
    });

    it("retry with same idempotency_key returns idempotent=true and same record", async () => {
      const { status, data } = await postFn("agent-state", {
        action: "create_checkpoint",
        session_id: TEST_SESSION_ID,
        workflow_id: TEST_WORKFLOW_ID,
        step_index: 0,
        step_type: "test_step",
        idempotency_key: TEST_IDEM_KEY,
      });

      assert.equal(status, 200, `Idempotent retry failed: ${JSON.stringify(data)}`);
      assert.equal(data.idempotent, true, "Retry should be idempotent");

      const checkpoint = data.checkpoint as Record<string, unknown>;
      assert.equal(
        checkpoint.id,
        createdCheckpointId,
        "Should return the same checkpoint ID",
      );
      assert.equal(checkpoint.idempotency_key, TEST_IDEM_KEY);
    });
  });

  describe("check_budget", () => {
    it("returns can_proceed=true for a fresh session", async () => {
      const freshSession = `test_budget_fresh_${Date.now()}`;

      const { status, data } = await postFn("agent-state", {
        action: "check_budget",
        session_id: freshSession,
      });

      assert.equal(status, 200, `check_budget failed: ${JSON.stringify(data)}`);
      assert.equal(data.can_proceed, true, "Fresh session should be able to proceed");
      assert.equal(data.stop_reason, null, "No stop reason for fresh session");
    });

    it("returns budget_status with zero counters for fresh session", async () => {
      const freshSession = `test_budget_counters_${Date.now()}`;

      const { status, data } = await postFn("agent-state", {
        action: "check_budget",
        session_id: freshSession,
      });

      assert.equal(status, 200);
      const budgetStatus = data.budget_status as Record<string, unknown>;
      assert.equal(budgetStatus.turns_used, 0);
      assert.equal(budgetStatus.tokens_used, 0);
      assert.equal(budgetStatus.cost_usd, 0);
    });
  });
});

// ==========================================================================
// agent-doctor
// ==========================================================================
describe("agent-doctor Edge Function", () => {
  describe("Auth", () => {
    it("returns 401 without x-access-key", async () => {
      const { status } = await postFnNoAuth("agent-doctor", {
        action: "run_doctor",
      });
      assert.equal(status, 401);
    });
  });

  describe("Invalid action", () => {
    it("returns 400 for unknown action", async () => {
      const { status, data } = await postFn("agent-doctor", {
        action: "not_a_real_action",
      });
      assert.equal(status, 400);
      assert.ok(data.error);
    });
  });

  describe("run_doctor", () => {
    it("returns a complete doctor report", async () => {
      const { status, data } = await postFn("agent-doctor", {
        action: "run_doctor",
        session_id: "test_doctor_run",
      });

      assert.equal(status, 200, `run_doctor failed: ${JSON.stringify(data)}`);

      // Validate report structure
      assert.ok(data.run_id, "Should have run_id");
      assert.ok(data.session_id, "Should have session_id");
      assert.ok(data.timestamp, "Should have timestamp");
      assert.ok(typeof data.total_duration_ms === "number", "Should have total_duration_ms");
      assert.ok(Array.isArray(data.checks), "Should have checks array");
      assert.ok(data.summary, "Should have summary object");

      const summary = data.summary as Record<string, number>;
      assert.ok(typeof summary.pass === "number", "summary.pass should be a number");
      assert.ok(typeof summary.warn === "number", "summary.warn should be a number");
      assert.ok(typeof summary.fail === "number", "summary.fail should be a number");
      assert.ok(typeof summary.total === "number", "summary.total should be a number");
      assert.ok(summary.total > 0, "Should have at least 1 check");
    });

    it("includes checks for all 6 categories", async () => {
      const { status, data } = await postFn("agent-doctor", {
        action: "run_doctor",
        session_id: "test_doctor_categories",
      });

      assert.equal(status, 200);

      const checks = data.checks as Array<{ category: string }>;
      const categories = new Set(checks.map((c) => c.category));

      const expectedCategories = [
        "workspace",
        "configuration",
        "credentials",
        "connections",
        "tools",
        "sessions",
      ];

      for (const cat of expectedCategories) {
        assert.ok(
          categories.has(cat),
          `Doctor should check category "${cat}". Found: ${[...categories].join(", ")}`,
        );
      }
    });

    it("each check has required fields", async () => {
      const { data } = await postFn("agent-doctor", {
        action: "run_doctor",
        session_id: "test_doctor_fields",
      });

      const checks = data.checks as Array<Record<string, unknown>>;
      for (const check of checks) {
        assert.ok(check.category, `Check missing category: ${JSON.stringify(check)}`);
        assert.ok(check.check, `Check missing check name: ${JSON.stringify(check)}`);
        assert.ok(
          ["pass", "warn", "fail"].includes(check.status as string),
          `Check has invalid status "${check.status}": ${JSON.stringify(check)}`,
        );
        assert.ok(check.detail, `Check missing detail: ${JSON.stringify(check)}`);
        assert.ok(
          typeof check.duration_ms === "number",
          `Check missing duration_ms: ${JSON.stringify(check)}`,
        );
      }
    });
  });
});

// ==========================================================================
// agent-coordinator
// ==========================================================================
describe("agent-coordinator Edge Function", () => {
  describe("Auth", () => {
    it("returns 401 without x-access-key", async () => {
      const { status } = await postFnNoAuth("agent-coordinator", {
        action: "list_agent_types",
      });
      assert.equal(status, 401);
    });
  });

  describe("Invalid action", () => {
    it("returns 400 for unknown action", async () => {
      const { status, data } = await postFn("agent-coordinator", {
        action: "totally_fake_action",
      });
      assert.equal(status, 400);
      assert.ok(data.error);
    });
  });

  describe("list_agent_types", () => {
    it("returns 200 with agent_types array", async () => {
      const { status, data } = await postFn("agent-coordinator", {
        action: "list_agent_types",
      });

      assert.equal(status, 200, `list_agent_types failed: ${JSON.stringify(data)}`);
      assert.ok(Array.isArray(data.agent_types), "Should return agent_types array");
      assert.ok(typeof data.count === "number", "Should return count");
    });

    it("returns the 6 built-in agent types", async () => {
      const { status, data } = await postFn("agent-coordinator", {
        action: "list_agent_types",
        source: "built_in",
      });

      assert.equal(status, 200);
      const types = data.agent_types as Array<{ name: string }>;
      assert.equal(
        types.length,
        6,
        `Expected 6 built-in types, got ${types.length}: ${types.map((t) => t.name).join(", ")}`,
      );

      const expectedNames = [
        "explore",
        "plan",
        "verification",
        "guide",
        "general_purpose",
        "statusline",
      ];

      const names = types.map((t) => t.name).sort();
      for (const expected of expectedNames) {
        assert.ok(
          names.includes(expected),
          `Missing agent type "${expected}". Found: ${names.join(", ")}`,
        );
      }
    });

    it("each built-in type has expected fields", async () => {
      const { data } = await postFn("agent-coordinator", {
        action: "list_agent_types",
        source: "built_in",
      });

      const types = data.agent_types as Array<Record<string, unknown>>;
      for (const t of types) {
        assert.ok(t.name, "Should have name");
        assert.ok(t.display_name, `${t.name}: should have display_name`);
        assert.ok(t.system_prompt, `${t.name}: should have system_prompt`);
        assert.ok(t.permission_mode, `${t.name}: should have permission_mode`);
        assert.ok(t.source, `${t.name}: should have source`);
        assert.equal(t.enabled, true, `${t.name}: should be enabled`);
      }
    });
  });
});

// ==========================================================================
// Cleanup
// ==========================================================================
describe("Cleanup", () => {
  after(async () => {
    // Best-effort cleanup via edge functions. If these fail, test data
    // persists but doesn't affect future runs (unique session IDs).

    // Delete the test session
    if (createdSessionId) {
      await postFn("agent-state", {
        action: "update_session",
        session_id: TEST_SESSION_ID,
        status: "completed",
      });
    }

    // Delete doctor system events created during tests
    // (Cleanup via direct Supabase if service key is available, otherwise
    // test data is harmless and timestamped.)
  });

  it("cleanup marker (always passes)", () => {
    assert.ok(true);
  });
});
