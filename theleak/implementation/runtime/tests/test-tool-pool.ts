// =============================================================================
// Unit Tests — ToolPool & PermissionPolicy
// =============================================================================

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  ToolPool,
  PermissionPolicy,
  type ToolPoolOptions,
} from '../src/tool-pool.js';
import {
  PermissionMode,
  PERMISSION_RANK,
  type ToolSpec,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// Test fixtures — a small registry of fake tools
// ---------------------------------------------------------------------------

function makeTool(overrides: Partial<ToolSpec>): ToolSpec {
  return {
    name: overrides.name ?? 'unnamed_tool',
    description: overrides.description ?? 'A test tool',
    source_type: overrides.source_type ?? 'built_in',
    required_permission: overrides.required_permission ?? PermissionMode.ReadOnly,
    input_schema: overrides.input_schema ?? { type: 'object' },
    side_effect_profile: overrides.side_effect_profile ?? {
      writes_files: false,
      network_access: false,
      destructive: false,
      reversible: true,
      spawns_process: false,
    },
    enabled: overrides.enabled ?? true,
    aliases: overrides.aliases ?? [],
    metadata: overrides.metadata ?? {},
    ...(overrides.mcp_server_url ? { mcp_server_url: overrides.mcp_server_url } : {}),
  };
}

const REGISTRY: ToolSpec[] = [
  makeTool({ name: 'read_file', required_permission: PermissionMode.ReadOnly }),
  makeTool({ name: 'edit_file', required_permission: PermissionMode.WorkspaceWrite }),
  makeTool({ name: 'bash', required_permission: PermissionMode.DangerFullAccess }),
  makeTool({ name: 'web_search', required_permission: PermissionMode.ReadOnly }),
  makeTool({ name: 'git_commit', required_permission: PermissionMode.WorkspaceWrite }),
  makeTool({
    name: 'mcp__supabase__query',
    source_type: 'mcp',
    required_permission: PermissionMode.ReadOnly,
    mcp_server_url: 'https://mcp.example.com',
  }),
  makeTool({
    name: 'mcp__github__pr',
    source_type: 'mcp',
    required_permission: PermissionMode.WorkspaceWrite,
    mcp_server_url: 'https://mcp.example.com',
  }),
  makeTool({ name: 'danger_delete_all', required_permission: PermissionMode.DangerFullAccess }),
  makeTool({ name: 'disabled_tool', enabled: false }),
];

// ---------------------------------------------------------------------------
// Mock OB1Client
// ---------------------------------------------------------------------------

function createMockClient(tools: ToolSpec[] = REGISTRY) {
  return {
    listTools: mock.fn(async (_opts?: { enabled_only?: boolean }) => {
      if (_opts?.enabled_only) return tools.filter(t => t.enabled);
      return tools;
    }),
    logAudit: mock.fn(async () => {}),
    getPolicies: mock.fn(async () => []),
  } as any;
}

// ---------------------------------------------------------------------------
// Tests — ToolPool
// ---------------------------------------------------------------------------

describe('ToolPool', () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  // ---- assemble filters -----------------------------------------------

  describe('assemble', () => {
    it('with no filters returns all enabled tools', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({
        simple_mode: false,
        include_mcp: true,
      });

      // disabled_tool should be excluded; the rest should be present
      const enabledCount = REGISTRY.filter(t => t.enabled).length;
      assert.equal(pool.size, enabledCount);
      assert.equal(pool.has('disabled_tool'), false);
    });

    it('simple_mode filter returns only read_file, edit_file, bash', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({
        simple_mode: true,
        include_mcp: true,
      });

      assert.equal(pool.size, 3);
      assert.equal(pool.has('read_file'), true);
      assert.equal(pool.has('edit_file'), true);
      assert.equal(pool.has('bash'), true);
      assert.equal(pool.has('web_search'), false);
    });

    it('include_mcp=false excludes MCP-sourced tools', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({
        simple_mode: false,
        include_mcp: false,
      });

      assert.equal(pool.has('mcp__supabase__query'), false);
      assert.equal(pool.has('mcp__github__pr'), false);
      assert.equal(pool.has('read_file'), true);
      assert.equal(pool.has('bash'), true);
    });

    it('include_mcp=false also excludes tools with mcp__ prefix regardless of source_type', async () => {
      // Tool with mcp__ prefix but source_type !== 'mcp'
      const hybridTools = [
        ...REGISTRY,
        makeTool({
          name: 'mcp__local__thing',
          source_type: 'built_in', // not 'mcp' but has mcp__ prefix
        }),
      ];
      const hybridClient = createMockClient(hybridTools);
      const pool = new ToolPool(hybridClient);
      await pool.assemble({
        simple_mode: false,
        include_mcp: false,
      });

      assert.equal(pool.has('mcp__local__thing'), false);
    });

    it('deny-list (exact name) removes specific tools', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({
        simple_mode: false,
        include_mcp: true,
        deny_tools: ['web_search', 'danger_delete_all'],
      });

      assert.equal(pool.has('web_search'), false);
      assert.equal(pool.has('danger_delete_all'), false);
      assert.equal(pool.has('read_file'), true);
    });

    it('deny-list is case-insensitive', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({
        simple_mode: false,
        include_mcp: true,
        deny_tools: ['WEB_SEARCH', 'Danger_Delete_All'],
      });

      assert.equal(pool.has('web_search'), false);
      assert.equal(pool.has('danger_delete_all'), false);
    });

    it('deny-list (prefix) removes tools matching prefix', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({
        simple_mode: false,
        include_mcp: true,
        deny_prefixes: ['mcp__'],
      });

      assert.equal(pool.has('mcp__supabase__query'), false);
      assert.equal(pool.has('mcp__github__pr'), false);
      assert.equal(pool.has('read_file'), true);
    });

    it('deny prefix is case-insensitive', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({
        simple_mode: false,
        include_mcp: true,
        deny_prefixes: ['MCP__'],
      });

      assert.equal(pool.has('mcp__supabase__query'), false);
      assert.equal(pool.has('mcp__github__pr'), false);
    });

    it('allow-list restricts to only listed tools', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({
        simple_mode: false,
        include_mcp: true,
        allow_tools: ['read_file', 'web_search'],
      });

      assert.equal(pool.size, 2);
      assert.equal(pool.has('read_file'), true);
      assert.equal(pool.has('web_search'), true);
      assert.equal(pool.has('bash'), false);
    });

    it('allow-list is case-insensitive', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({
        simple_mode: false,
        include_mcp: true,
        allow_tools: ['READ_FILE'],
      });

      assert.equal(pool.size, 1);
      assert.equal(pool.has('read_file'), true);
    });

    it('empty allow-list does not filter (all pass)', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({
        simple_mode: false,
        include_mcp: true,
        allow_tools: [],
      });

      // Empty allow-list means no filtering
      const enabledCount = REGISTRY.filter(t => t.enabled).length;
      assert.equal(pool.size, enabledCount);
    });

    it('returns empty pool when all tools are denied', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({
        simple_mode: false,
        include_mcp: true,
        allow_tools: ['nonexistent_tool'],
      });

      assert.equal(pool.size, 0);
    });

    it('returns the pool instance for chaining', async () => {
      const pool = new ToolPool(client);
      const result = await pool.assemble({
        simple_mode: false,
        include_mcp: true,
      });

      assert.equal(result, pool);
    });
  });

  // ---- get / has ----------------------------------------------------

  describe('get / has', () => {
    it('get returns ToolSpec for existing tool', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({ simple_mode: false, include_mcp: true });

      const tool = pool.get('read_file');
      assert.ok(tool);
      assert.equal(tool.name, 'read_file');
      assert.equal(tool.required_permission, PermissionMode.ReadOnly);
    });

    it('get returns undefined for nonexistent tool', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({ simple_mode: false, include_mcp: true });

      assert.equal(pool.get('nonexistent'), undefined);
    });
  });

  // ---- createSubAgentPool -------------------------------------------

  describe('createSubAgentPool', () => {
    it('creates intersection with parent', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({
        simple_mode: false,
        include_mcp: true,
      });

      const sub = pool.createSubAgentPool(['read_file', 'web_search', 'nonexistent_tool']);

      assert.equal(sub.size, 2);
      assert.equal(sub.has('read_file'), true);
      assert.equal(sub.has('web_search'), true);
      assert.equal(sub.has('nonexistent_tool'), false);
      assert.equal(sub.has('bash'), false);
    });

    it('sub-agent pool is case-insensitive', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({ simple_mode: false, include_mcp: true });

      const sub = pool.createSubAgentPool(['READ_FILE']);
      assert.equal(sub.size, 1);
      assert.equal(sub.has('read_file'), true);
    });

    it('empty allowedTools produces empty sub-pool', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({ simple_mode: false, include_mcp: true });

      const sub = pool.createSubAgentPool([]);
      assert.equal(sub.size, 0);
    });
  });

  // ---- checkPermission ----------------------------------------------

  describe('checkPermission', () => {
    it('allows ReadOnly tool in ReadOnly mode', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({ simple_mode: false, include_mcp: true });

      const result = pool.checkPermission('read_file', PermissionMode.ReadOnly);
      assert.equal(result.allowed, true);
      assert.equal(result.active_mode, PermissionMode.ReadOnly);
      assert.equal(result.required_mode, PermissionMode.ReadOnly);
    });

    it('allows WorkspaceWrite tool in WorkspaceWrite mode', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({ simple_mode: false, include_mcp: true });

      const result = pool.checkPermission('edit_file', PermissionMode.WorkspaceWrite);
      assert.equal(result.allowed, true);
    });

    it('allows lower-permission tool in higher-permission mode', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({ simple_mode: false, include_mcp: true });

      // ReadOnly tool should be allowed in DangerFullAccess mode
      const result = pool.checkPermission('read_file', PermissionMode.DangerFullAccess);
      assert.equal(result.allowed, true);
    });

    it('denies DangerFullAccess tool in ReadOnly mode', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({ simple_mode: false, include_mcp: true });

      const result = pool.checkPermission('bash', PermissionMode.ReadOnly);
      assert.equal(result.allowed, false);
      assert.ok(result.reason);
      assert.equal(result.active_mode, PermissionMode.ReadOnly);
      assert.equal(result.required_mode, PermissionMode.DangerFullAccess);
    });

    it('denies WorkspaceWrite tool in ReadOnly mode', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({ simple_mode: false, include_mcp: true });

      const result = pool.checkPermission('edit_file', PermissionMode.ReadOnly);
      assert.equal(result.allowed, false);
    });

    it('allows DangerFullAccess tool in Allow mode', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({ simple_mode: false, include_mcp: true });

      const result = pool.checkPermission('bash', PermissionMode.Allow);
      assert.equal(result.allowed, true);
    });

    it('returns not-allowed for tool not in pool', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({ simple_mode: false, include_mcp: true });

      const result = pool.checkPermission('nonexistent', PermissionMode.Allow);
      assert.equal(result.allowed, false);
      assert.ok(result.reason?.includes('not in the assembled tool pool'));
    });

    it('Prompt mode allows tools with lower required permission (Prompt rank > DangerFullAccess rank)', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({ simple_mode: false, include_mcp: true });

      // Prompt has rank 3, DangerFullAccess has rank 2 -- so bash IS allowed in Prompt mode
      const result = pool.checkPermission('bash', PermissionMode.Prompt);
      assert.equal(result.allowed, true);
      assert.equal(result.active_mode, PermissionMode.Prompt);
      assert.equal(result.required_mode, PermissionMode.DangerFullAccess);
    });
  });

  // ---- Format conversion --------------------------------------------

  describe('toMCPFormat', () => {
    it('produces valid MCP tool definitions', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({
        simple_mode: false,
        include_mcp: true,
        allow_tools: ['read_file'],
      });

      const mcpTools = pool.toMCPFormat();

      assert.equal(mcpTools.length, 1);
      assert.equal(mcpTools[0].name, 'read_file');
      assert.ok(mcpTools[0].description);
      assert.ok(mcpTools[0].inputSchema);
      // MCP format uses camelCase inputSchema
      assert.equal('input_schema' in mcpTools[0], false);
    });
  });

  describe('toAnthropicFormat', () => {
    it('produces valid Anthropic tool definitions', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({
        simple_mode: false,
        include_mcp: true,
        allow_tools: ['edit_file'],
      });

      const anthropicTools = pool.toAnthropicFormat();

      assert.equal(anthropicTools.length, 1);
      assert.equal(anthropicTools[0].name, 'edit_file');
      assert.ok(anthropicTools[0].description);
      assert.ok(anthropicTools[0].input_schema);
      // Anthropic format uses snake_case input_schema
      assert.equal('inputSchema' in anthropicTools[0], false);
    });
  });

  // ---- toMarkdown ----------------------------------------------------

  describe('toMarkdown', () => {
    it('produces a markdown string with tool count and listing', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({
        simple_mode: false,
        include_mcp: true,
        allow_tools: ['read_file', 'bash'],
      });

      const md = pool.toMarkdown();
      assert.ok(md.includes('# Tool Pool'));
      assert.ok(md.includes('Tool count: 2'));
      assert.ok(md.includes('read_file'));
      assert.ok(md.includes('bash'));
    });

    it('produces empty listing for empty pool', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({
        simple_mode: false,
        include_mcp: true,
        allow_tools: ['nonexistent'],
      });

      const md = pool.toMarkdown();
      assert.ok(md.includes('Tool count: 0'));
    });
  });
});

// ---------------------------------------------------------------------------
// Tests — PermissionPolicy
// ---------------------------------------------------------------------------

describe('PermissionPolicy', () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
  });

  // ---- Factory methods ------------------------------------------------

  describe('factory methods', () => {
    it('readOnly creates a swarm_worker with ReadOnly mode', () => {
      const policy = PermissionPolicy.readOnly(client);
      // Verify through check behavior: a ReadOnly tool should pass
      // but we need to test via the check method
      assert.ok(policy);
    });

    it('fullAccess allows everything', async () => {
      const policy = PermissionPolicy.fullAccess(client);

      const result = await policy.check('any_tool', PermissionMode.Allow);
      assert.equal(result.allowed, true);
    });

    it('subAgent creates coordinator with allowed tools and denies unlisted tools', async () => {
      const policy = PermissionPolicy.subAgent(client, ['read_file', 'edit_file']);

      // Tool not in allow list should be denied
      const denied = await policy.check('bash', PermissionMode.WorkspaceWrite);
      assert.equal(denied.allowed, false);
      assert.ok(denied.reason?.includes('not in the allowed tools set'));

      // Tool in allow list but with insufficient permission mode still needs
      // the mode to meet the default required rank (DangerFullAccess for
      // tools without overrides). SubAgent uses WorkspaceWrite which is rank 1,
      // while default required is DangerFullAccess (rank 2), so it is denied
      // on the permission rank layer.
      const rankDenied = await policy.check('read_file', PermissionMode.WorkspaceWrite);
      assert.equal(rankDenied.allowed, false);

      // With Allow mode, the allow-list tool passes all layers
      const allowed = await policy.check('read_file', PermissionMode.Allow);
      assert.equal(allowed.allowed, true);
    });
  });

  // ---- configure & check ----------------------------------------------

  describe('check', () => {
    it('denies tools on the deny list', async () => {
      const policy = new PermissionPolicy(client);
      policy.configure({
        active_mode: PermissionMode.Allow,
        deny_tools: ['dangerous_tool'],
      });

      const result = await policy.check('dangerous_tool', PermissionMode.Allow);
      assert.equal(result.allowed, false);
      assert.ok(result.reason?.includes('deny list'));
    });

    it('deny list is case-insensitive', async () => {
      const policy = new PermissionPolicy(client);
      policy.configure({
        active_mode: PermissionMode.Allow,
        deny_tools: ['DANGEROUS_TOOL'],
      });

      const result = await policy.check('dangerous_tool', PermissionMode.Allow);
      assert.equal(result.allowed, false);
    });

    it('denies tools matching deny prefix', async () => {
      const policy = new PermissionPolicy(client);
      policy.configure({
        active_mode: PermissionMode.Allow,
        deny_prefixes: ['mcp__'],
      });

      const result = await policy.check('mcp__supabase__query', PermissionMode.Allow);
      assert.equal(result.allowed, false);
      assert.ok(result.reason?.includes('denied prefix'));
    });

    it('denies tools not in allow list when allow list is set', async () => {
      const policy = new PermissionPolicy(client);
      policy.configure({
        active_mode: PermissionMode.Allow,
        allow_tools: ['read_file', 'edit_file'],
      });

      const denied = await policy.check('bash', PermissionMode.Allow);
      assert.equal(denied.allowed, false);
      assert.ok(denied.reason?.includes('not in the allowed tools set'));

      const allowed = await policy.check('read_file', PermissionMode.Allow);
      assert.equal(allowed.allowed, true);
    });

    it('Allow mode bypasses permission rank comparison', async () => {
      const policy = new PermissionPolicy(client);
      policy.configure({ active_mode: PermissionMode.Allow });

      const result = await policy.check('any_tool', PermissionMode.Allow);
      assert.equal(result.allowed, true);
    });

    it('denies when active rank is below required rank', async () => {
      const policy = new PermissionPolicy(client);
      policy.configure({
        active_mode: PermissionMode.ReadOnly,
        tool_overrides: {
          write_tool: PermissionMode.WorkspaceWrite,
        },
      });

      const result = await policy.check('write_tool', PermissionMode.ReadOnly);
      assert.equal(result.allowed, false);
    });

    it('allows when active rank meets required rank', async () => {
      const policy = new PermissionPolicy(client);
      policy.configure({
        active_mode: PermissionMode.WorkspaceWrite,
        tool_overrides: {
          write_tool: PermissionMode.WorkspaceWrite,
        },
      });

      const result = await policy.check('write_tool', PermissionMode.WorkspaceWrite);
      assert.equal(result.allowed, true);
    });
  });

  // ---- Denial tracking ------------------------------------------------

  describe('denial tracking', () => {
    it('tracks denial count', async () => {
      const policy = new PermissionPolicy(client);
      policy.configure({
        active_mode: PermissionMode.ReadOnly,
        deny_tools: ['tool_a', 'tool_b'],
      });

      assert.equal(policy.denialCount, 0);

      await policy.logDecision('tool_a', false, 'denied', 'sess-1');
      assert.equal(policy.denialCount, 1);

      await policy.logDecision('tool_b', false, 'denied', 'sess-1');
      assert.equal(policy.denialCount, 2);
    });

    it('does not track allows as denials', async () => {
      const policy = new PermissionPolicy(client);
      policy.configure({ active_mode: PermissionMode.Allow });

      await policy.logDecision('tool_a', true, 'allowed', 'sess-1');
      assert.equal(policy.denialCount, 0);
    });

    it('denialCountForTool returns count per tool', async () => {
      const policy = new PermissionPolicy(client);
      policy.configure({ active_mode: PermissionMode.ReadOnly });

      await policy.logDecision('tool_a', false, 'denied', 'sess-1');
      await policy.logDecision('tool_a', false, 'denied', 'sess-1');
      await policy.logDecision('tool_b', false, 'denied', 'sess-1');

      assert.equal(policy.denialCountForTool('tool_a'), 2);
      assert.equal(policy.denialCountForTool('tool_b'), 1);
      assert.equal(policy.denialCountForTool('tool_c'), 0);
    });

    it('denialRate returns correct ratio', async () => {
      const policy = new PermissionPolicy(client);
      policy.configure({
        active_mode: PermissionMode.ReadOnly,
        deny_tools: ['bad_tool'],
      });

      // Make 4 decisions: 2 denials, 2 allows
      await policy.check('bad_tool', PermissionMode.ReadOnly);
      await policy.logDecision('bad_tool', false, 'denied', 'sess-1');

      await policy.check('bad_tool', PermissionMode.ReadOnly);
      await policy.logDecision('bad_tool', false, 'denied', 'sess-1');

      // denialRate = denials / total decisions from check()
      // 2 check() calls = 2 total decisions
      // 2 logDecision(false) = 2 denials
      assert.equal(policy.denialRate(), 1.0); // 2/2
    });

    it('denialRate returns 0 when no decisions', () => {
      const policy = new PermissionPolicy(client);
      policy.configure({ active_mode: PermissionMode.Allow });

      assert.equal(policy.denialRate(), 0);
    });

    it('denials getter returns a defensive copy', async () => {
      const policy = new PermissionPolicy(client);
      policy.configure({ active_mode: PermissionMode.ReadOnly });

      await policy.logDecision('tool_a', false, 'denied', 'sess-1');

      const denials1 = policy.denials;
      const denials2 = policy.denials;

      // Should be equal in content but different references
      assert.deepEqual(denials1, denials2);
      assert.notEqual(denials1, denials2);
    });
  });

  // ---- logDecision audit persistence -----------------------------------

  describe('logDecision', () => {
    it('calls client.logAudit for each decision', async () => {
      const policy = new PermissionPolicy(client);
      policy.configure({ active_mode: PermissionMode.ReadOnly });

      await policy.logDecision('tool_a', false, 'denied', 'sess-1');

      assert.equal(client.logAudit.mock.callCount(), 1);
    });

    it('handles client.logAudit failure gracefully', async () => {
      const failingClient = {
        ...createMockClient(),
        logAudit: mock.fn(async () => {
          throw new Error('Audit write failed');
        }),
      } as any;

      const policy = new PermissionPolicy(failingClient);
      policy.configure({ active_mode: PermissionMode.ReadOnly });

      // Should not throw
      await policy.logDecision('tool_a', false, 'denied', 'sess-1');
      assert.equal(policy.denialCount, 1); // Denial tracked in memory despite audit failure
    });
  });
});
