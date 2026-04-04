// =============================================================================
// Unit Tests — ToolPool & PermissionPolicy
// =============================================================================

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  ToolPool,
  type ToolPoolOptions,
} from '../src/tool-pool.js';
import {
  PermissionMode,
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

    it('denies DangerFullAccess tool in ReadOnly mode', async () => {
      const pool = new ToolPool(client);
      await pool.assemble({ simple_mode: false, include_mcp: true });

      const result = pool.checkPermission('bash', PermissionMode.ReadOnly);
      assert.equal(result.allowed, false);
      assert.ok(result.reason);
      assert.equal(result.active_mode, PermissionMode.ReadOnly);
      assert.equal(result.required_mode, PermissionMode.DangerFullAccess);
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
});
