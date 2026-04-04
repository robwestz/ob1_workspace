// =============================================================================
// Unit Tests — Shared Type Definitions
// =============================================================================
// Tests for enums, constants, type guards, and serialization of the types
// exported from types.ts. These tests verify the runtime behavior of the
// TypeScript type system — enum values, constant integrity, and data
// structure shapes.
// =============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PermissionMode,
  PERMISSION_RANK,
  StopReason,
  WorkflowState,
  BootPhase,
  BOOT_PHASE_ORDER,
  StreamEventType,
  HookEvent,
  MemoryScope,
  MemoryType,
  type ToolSpec,
  type SideEffectProfile,
  type BudgetConfig,
  type BudgetStatus,
  type TokenUsage,
  type SessionState,
  type Message,
  type ContentBlock,
  type ContextFragment,
  type ConfigProvenance,
  type McpServerEntry,
  type AgentType,
  type AgentRun,
  type DoctorCheckResult,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// PermissionMode enum
// ---------------------------------------------------------------------------

describe('PermissionMode', () => {
  it('has exactly 5 members', () => {
    const values = Object.values(PermissionMode);
    assert.equal(values.length, 5);
  });

  it('has the expected string values', () => {
    assert.equal(PermissionMode.ReadOnly, 'read_only');
    assert.equal(PermissionMode.WorkspaceWrite, 'workspace_write');
    assert.equal(PermissionMode.DangerFullAccess, 'danger_full_access');
    assert.equal(PermissionMode.Prompt, 'prompt');
    assert.equal(PermissionMode.Allow, 'allow');
  });

  it('supports reverse lookup from string value', () => {
    const found = Object.entries(PermissionMode).find(
      ([_key, val]) => val === 'read_only'
    );
    assert.ok(found);
    assert.equal(found[0], 'ReadOnly');
  });
});

// ---------------------------------------------------------------------------
// PERMISSION_RANK constant
// ---------------------------------------------------------------------------

describe('PERMISSION_RANK', () => {
  it('has a rank entry for every PermissionMode value', () => {
    for (const mode of Object.values(PermissionMode)) {
      assert.ok(
        PERMISSION_RANK[mode] !== undefined,
        `PERMISSION_RANK should have entry for "${mode}"`,
      );
    }
  });

  it('ranks are in strictly ascending order: ReadOnly < WorkspaceWrite < DangerFullAccess < Prompt < Allow', () => {
    assert.ok(PERMISSION_RANK[PermissionMode.ReadOnly] < PERMISSION_RANK[PermissionMode.WorkspaceWrite]);
    assert.ok(PERMISSION_RANK[PermissionMode.WorkspaceWrite] < PERMISSION_RANK[PermissionMode.DangerFullAccess]);
    assert.ok(PERMISSION_RANK[PermissionMode.DangerFullAccess] < PERMISSION_RANK[PermissionMode.Prompt]);
    assert.ok(PERMISSION_RANK[PermissionMode.Prompt] < PERMISSION_RANK[PermissionMode.Allow]);
  });

  it('ReadOnly has rank 0', () => {
    assert.equal(PERMISSION_RANK[PermissionMode.ReadOnly], 0);
  });

  it('Allow has the highest rank (4)', () => {
    assert.equal(PERMISSION_RANK[PermissionMode.Allow], 4);
  });

  it('all ranks are non-negative integers', () => {
    for (const rank of Object.values(PERMISSION_RANK)) {
      assert.ok(Number.isInteger(rank));
      assert.ok(rank >= 0);
    }
  });
});

// ---------------------------------------------------------------------------
// StopReason enum
// ---------------------------------------------------------------------------

describe('StopReason', () => {
  it('has all expected stop reasons', () => {
    const expected = [
      'completed',
      'max_turns_reached',
      'max_budget_tokens_reached',
      'max_budget_usd_reached',
      'user_cancelled',
      'error',
      'timeout',
      'context_overflow',
    ];
    const actual = Object.values(StopReason);
    assert.equal(actual.length, expected.length);
    for (const exp of expected) {
      assert.ok(actual.includes(exp as StopReason), `Missing StopReason: ${exp}`);
    }
  });

  it('has string values (not numeric)', () => {
    for (const value of Object.values(StopReason)) {
      assert.equal(typeof value, 'string');
    }
  });
});

// ---------------------------------------------------------------------------
// WorkflowState enum
// ---------------------------------------------------------------------------

describe('WorkflowState', () => {
  it('has 7 states', () => {
    const values = Object.values(WorkflowState);
    assert.equal(values.length, 7);
  });

  it('includes expected terminal states', () => {
    assert.equal(WorkflowState.Completed, 'completed');
    assert.equal(WorkflowState.Failed, 'failed');
    assert.equal(WorkflowState.Skipped, 'skipped');
  });

  it('includes expected in-progress states', () => {
    assert.equal(WorkflowState.Planned, 'planned');
    assert.equal(WorkflowState.AwaitingApproval, 'awaiting_approval');
    assert.equal(WorkflowState.Executing, 'executing');
    assert.equal(WorkflowState.WaitingOnExternal, 'waiting_on_external');
  });
});

// ---------------------------------------------------------------------------
// BootPhase enum & BOOT_PHASE_ORDER
// ---------------------------------------------------------------------------

describe('BootPhase', () => {
  it('has exactly 10 phases', () => {
    const values = Object.values(BootPhase);
    assert.equal(values.length, 10);
  });

  it('BOOT_PHASE_ORDER has matching length', () => {
    assert.equal(BOOT_PHASE_ORDER.length, 10);
  });

  it('BOOT_PHASE_ORDER contains each BootPhase exactly once', () => {
    const orderSet = new Set(BOOT_PHASE_ORDER);
    assert.equal(orderSet.size, 10);
    for (const phase of Object.values(BootPhase)) {
      assert.ok(orderSet.has(phase), `BOOT_PHASE_ORDER missing phase: ${phase}`);
    }
  });

  it('starts with Prefetch and ends with MainLoop', () => {
    assert.equal(BOOT_PHASE_ORDER[0], BootPhase.Prefetch);
    assert.equal(BOOT_PHASE_ORDER[BOOT_PHASE_ORDER.length - 1], BootPhase.MainLoop);
  });

  it('DoctorCheck comes before MainLoop', () => {
    const doctorIdx = BOOT_PHASE_ORDER.indexOf(BootPhase.DoctorCheck);
    const mainIdx = BOOT_PHASE_ORDER.indexOf(BootPhase.MainLoop);
    assert.ok(doctorIdx < mainIdx);
  });

  it('ConfigLoading comes before TrustGate', () => {
    const configIdx = BOOT_PHASE_ORDER.indexOf(BootPhase.ConfigLoading);
    const trustIdx = BOOT_PHASE_ORDER.indexOf(BootPhase.TrustGate);
    assert.ok(configIdx < trustIdx);
  });
});

// ---------------------------------------------------------------------------
// StreamEventType enum
// ---------------------------------------------------------------------------

describe('StreamEventType', () => {
  it('has exactly 6 event types', () => {
    const values = Object.values(StreamEventType);
    assert.equal(values.length, 6);
  });

  it('has expected event type values', () => {
    assert.equal(StreamEventType.MessageStart, 'message_start');
    assert.equal(StreamEventType.ToolMatch, 'tool_match');
    assert.equal(StreamEventType.PermissionDenial, 'permission_denial');
    assert.equal(StreamEventType.MessageDelta, 'message_delta');
    assert.equal(StreamEventType.MessageStop, 'message_stop');
    assert.equal(StreamEventType.ToolExecution, 'tool_execution');
  });
});

// ---------------------------------------------------------------------------
// HookEvent enum
// ---------------------------------------------------------------------------

describe('HookEvent', () => {
  it('has PreToolUse and PostToolUse', () => {
    assert.equal(HookEvent.PreToolUse, 'PreToolUse');
    assert.equal(HookEvent.PostToolUse, 'PostToolUse');
    assert.equal(Object.values(HookEvent).length, 2);
  });
});

// ---------------------------------------------------------------------------
// MemoryScope enum
// ---------------------------------------------------------------------------

describe('MemoryScope', () => {
  it('has 5 scopes', () => {
    const values = Object.values(MemoryScope);
    assert.equal(values.length, 5);
  });

  it('has expected string values', () => {
    assert.equal(MemoryScope.Personal, 'personal');
    assert.equal(MemoryScope.Team, 'team');
    assert.equal(MemoryScope.Project, 'project');
    assert.equal(MemoryScope.Session, 'session');
    assert.equal(MemoryScope.Agent, 'agent');
  });
});

// ---------------------------------------------------------------------------
// MemoryType enum
// ---------------------------------------------------------------------------

describe('MemoryType', () => {
  it('has 6 types', () => {
    const values = Object.values(MemoryType);
    assert.equal(values.length, 6);
  });

  it('has expected string values', () => {
    assert.equal(MemoryType.Fact, 'fact');
    assert.equal(MemoryType.Preference, 'preference');
    assert.equal(MemoryType.Decision, 'decision');
    assert.equal(MemoryType.Instruction, 'instruction');
    assert.equal(MemoryType.Observation, 'observation');
    assert.equal(MemoryType.Context, 'context');
  });
});

// ---------------------------------------------------------------------------
// Interface shape validation (runtime structural checks)
// ---------------------------------------------------------------------------

describe('Interface shapes', () => {
  it('SideEffectProfile has all required boolean fields', () => {
    const profile: SideEffectProfile = {
      writes_files: true,
      network_access: false,
      destructive: true,
      reversible: false,
      spawns_process: true,
    };

    assert.equal(typeof profile.writes_files, 'boolean');
    assert.equal(typeof profile.network_access, 'boolean');
    assert.equal(typeof profile.destructive, 'boolean');
    assert.equal(typeof profile.reversible, 'boolean');
    assert.equal(typeof profile.spawns_process, 'boolean');
  });

  it('ToolSpec can be serialized to JSON and back', () => {
    const spec: ToolSpec = {
      name: 'test_tool',
      description: 'A test tool',
      source_type: 'built_in',
      required_permission: PermissionMode.ReadOnly,
      input_schema: { type: 'object', properties: { path: { type: 'string' } } },
      side_effect_profile: {
        writes_files: false,
        network_access: false,
        destructive: false,
        reversible: true,
        spawns_process: false,
      },
      enabled: true,
      aliases: ['tt', 'test'],
      metadata: { version: '1.0' },
    };

    const json = JSON.stringify(spec);
    const parsed = JSON.parse(json) as ToolSpec;

    assert.equal(parsed.name, spec.name);
    assert.equal(parsed.required_permission, PermissionMode.ReadOnly);
    assert.deepEqual(parsed.aliases, ['tt', 'test']);
    assert.deepEqual(parsed.side_effect_profile, spec.side_effect_profile);
  });

  it('TokenUsage zero-initializes correctly', () => {
    const usage: TokenUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };

    const total = usage.input_tokens + usage.output_tokens +
      usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
    assert.equal(total, 0);
  });

  it('BudgetConfig allows all fields to be optional', () => {
    const emptyConfig: BudgetConfig = {};
    assert.equal(emptyConfig.max_turns, undefined);
    assert.equal(emptyConfig.max_budget_tokens, undefined);
    assert.equal(emptyConfig.max_budget_usd, undefined);
    assert.equal(emptyConfig.compact_after_turns, undefined);
  });

  it('BudgetStatus can be constructed with all fields', () => {
    const status: BudgetStatus = {
      turns_used: 5,
      tokens_used: 10000,
      usd_used: 0.15,
      can_proceed: true,
    };

    assert.equal(status.can_proceed, true);
    assert.equal(status.stop_reason, undefined);

    const stoppedStatus: BudgetStatus = {
      turns_used: 50,
      tokens_used: 1000000,
      usd_used: 10.0,
      can_proceed: false,
      stop_reason: StopReason.MaxTurnsReached,
    };

    assert.equal(stoppedStatus.can_proceed, false);
    assert.equal(stoppedStatus.stop_reason, StopReason.MaxTurnsReached);
  });

  it('Message with usage can be serialized and deserialized', () => {
    const msg: Message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Hello!' },
        { type: 'tool_use', tool_name: 'read_file', tool_input: { path: '/foo.ts' } },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      },
      timestamp: '2025-01-01T00:00:00Z',
    };

    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json) as Message;

    assert.equal(parsed.role, 'assistant');
    assert.equal(parsed.content.length, 2);
    assert.equal(parsed.content[0].type, 'text');
    assert.equal(parsed.content[0].text, 'Hello!');
    assert.equal(parsed.content[1].type, 'tool_use');
    assert.equal(parsed.content[1].tool_name, 'read_file');
    assert.equal(parsed.usage?.input_tokens, 100);
  });

  it('ContentBlock supports all block types', () => {
    const textBlock: ContentBlock = { type: 'text', text: 'Hello' };
    assert.equal(textBlock.type, 'text');

    const toolUseBlock: ContentBlock = {
      type: 'tool_use',
      tool_name: 'bash',
      tool_input: { command: 'ls' },
    };
    assert.equal(toolUseBlock.type, 'tool_use');

    const toolResultBlock: ContentBlock = {
      type: 'tool_result',
      tool_result: 'file1.ts\nfile2.ts',
      is_error: false,
    };
    assert.equal(toolResultBlock.type, 'tool_result');
    assert.equal(toolResultBlock.is_error, false);
  });

  it('SessionState serializes with all required fields', () => {
    const state: SessionState = {
      session_id: 'test-session-123',
      version: 1,
      status: 'active',
      messages: [],
      config_snapshot: { model: 'sonnet' },
      permission_decisions: [],
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cache_write_tokens: 0,
      total_cache_read_tokens: 0,
      total_cost_usd: 0,
      turn_count: 0,
      compaction_count: 0,
    };

    const json = JSON.stringify(state);
    const parsed = JSON.parse(json) as SessionState;

    assert.equal(parsed.session_id, 'test-session-123');
    assert.equal(parsed.status, 'active');
    assert.equal(parsed.version, 1);
    assert.deepEqual(parsed.messages, []);
    assert.equal(parsed.total_cost_usd, 0);
  });

  it('AgentType contains minimum required fields for type safety', () => {
    const agentType: AgentType = {
      name: 'researcher',
      permission_mode: PermissionMode.ReadOnly,
      system_prompt: 'You are a research agent.',
      allowed_tools: ['read_file', 'web_search'],
      denied_tools: ['bash'],
      max_iterations: 10,
      output_format: 'markdown',
    };

    assert.equal(agentType.name, 'researcher');
    assert.equal(agentType.permission_mode, PermissionMode.ReadOnly);
    assert.equal(agentType.max_iterations, 10);
    assert.equal(agentType.output_format, 'markdown');
    assert.deepEqual(agentType.allowed_tools, ['read_file', 'web_search']);
  });
});

// ---------------------------------------------------------------------------
// Cross-type compatibility
// ---------------------------------------------------------------------------

describe('Cross-type compatibility', () => {
  it('PermissionMode values work as Record keys in PERMISSION_RANK', () => {
    // Verifies the enum can be used as an object key -- critical for runtime logic
    for (const mode of Object.values(PermissionMode)) {
      const rank = PERMISSION_RANK[mode];
      assert.equal(typeof rank, 'number');
    }
  });

  it('StopReason values can be assigned to BudgetStatus.stop_reason', () => {
    for (const reason of Object.values(StopReason)) {
      const status: BudgetStatus = {
        turns_used: 0,
        tokens_used: 0,
        usd_used: 0,
        can_proceed: false,
        stop_reason: reason,
      };
      assert.equal(status.stop_reason, reason);
    }
  });

  it('SessionState status union accepts all valid values', () => {
    const validStatuses: SessionState['status'][] = [
      'active', 'suspended', 'completed', 'crashed',
    ];

    for (const status of validStatuses) {
      const state: SessionState = {
        session_id: '',
        version: 1,
        status,
        messages: [],
        config_snapshot: {},
        permission_decisions: [],
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cache_write_tokens: 0,
        total_cache_read_tokens: 0,
        total_cost_usd: 0,
        turn_count: 0,
        compaction_count: 0,
      };
      assert.equal(state.status, status);
    }
  });
});
