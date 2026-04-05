import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OB1ApiClient, OB1ApiError } from '../api-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'https://example.supabase.co';
const ACCESS_KEY = 'test-access-key-123';

function makeClient(): OB1ApiClient {
  return new OB1ApiClient(BASE_URL, ACCESS_KEY);
}

/** Stub global fetch with a canned JSON response (fresh Response per call) */
function mockFetch(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

/** Inspect the last fetch call */
function lastFetchArgs(spy: ReturnType<typeof mockFetch>) {
  const [url, init] = spy.mock.calls[spy.mock.calls.length - 1] as [
    string,
    RequestInit,
  ];
  return { url, init, body: JSON.parse(init.body as string) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OB1ApiClient', () => {
  let fetchSpy: ReturnType<typeof mockFetch>;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  // -----------------------------------------------------------------------
  // Core call() plumbing
  // -----------------------------------------------------------------------

  describe('core request plumbing', () => {
    it('sends POST with correct URL, headers, and body', async () => {
      fetchSpy = mockFetch({ ok: true });
      const client = makeClient();

      await client.doctor.run();

      const { url, init, body } = lastFetchArgs(fetchSpy);
      expect(url).toBe(`${BASE_URL}/functions/v1/agent-doctor`);
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json',
      );
      expect((init.headers as Record<string, string>)['x-access-key']).toBe(
        ACCESS_KEY,
      );
      expect(body.action).toBe('run_doctor');
    });

    it('strips trailing slash from base URL', async () => {
      fetchSpy = mockFetch({ ok: true });
      const client = new OB1ApiClient(BASE_URL + '/', ACCESS_KEY);

      await client.doctor.run();

      const { url } = lastFetchArgs(fetchSpy);
      expect(url).toBe(`${BASE_URL}/functions/v1/agent-doctor`);
    });

    it('merges params into the JSON body alongside action', async () => {
      fetchSpy = mockFetch({ results: [] });
      const client = makeClient();

      await client.memory.recall('test query', {
        scope: 'personal',
        max_results: 5,
      });

      const { body } = lastFetchArgs(fetchSpy);
      expect(body).toEqual({
        action: 'memory_recall',
        query: 'test query',
        scope: 'personal',
        max_results: 5,
      });
    });
  });

  // -----------------------------------------------------------------------
  // Response parsing
  // -----------------------------------------------------------------------

  describe('response parsing', () => {
    it('returns parsed JSON on success', async () => {
      const payload = { total_thoughts: 42, thoughts_today: 3 };
      fetchSpy = mockFetch(payload);
      const client = makeClient();

      const result = await client.memory.stats();
      expect(result).toEqual(payload);
    });

    it('returns typed data from coordinator methods', async () => {
      const payload = {
        agent_types: [{ id: 'a1', name: 'researcher' }],
        count: 1,
      };
      fetchSpy = mockFetch(payload);
      const client = makeClient();

      const result = await client.coordinator.listTypes();
      expect(result.agent_types).toHaveLength(1);
      expect(result.count).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe('error handling', () => {
    it('throws OB1ApiError with status on 401', async () => {
      fetchSpy = mockFetch({ error: 'Unauthorized' }, 401);
      const client = makeClient();

      await expect(client.doctor.run()).rejects.toThrow(OB1ApiError);

      try {
        await client.doctor.run();
      } catch (e) {
        const err = e as OB1ApiError;
        expect(err.status).toBe(401);
        expect(err.message).toBe('Unauthorized');
      }
    });

    it('throws OB1ApiError with status on 500', async () => {
      fetchSpy = mockFetch({ error: 'Internal Server Error' }, 500);
      const client = makeClient();

      await expect(client.memory.stats()).rejects.toThrow(OB1ApiError);

      try {
        await client.memory.stats();
      } catch (e) {
        const err = e as OB1ApiError;
        expect(err.status).toBe(500);
        expect(err.message).toBe('Internal Server Error');
      }
    });

    it('uses message field when error field is missing', async () => {
      fetchSpy = mockFetch({ message: 'Rate limited' }, 429);
      const client = makeClient();

      try {
        await client.doctor.run();
      } catch (e) {
        const err = e as OB1ApiError;
        expect(err.status).toBe(429);
        expect(err.message).toBe('Rate limited');
      }
    });

    it('includes code when present in error response', async () => {
      fetchSpy = mockFetch(
        { error: 'Not found', code: 'RESOURCE_NOT_FOUND' },
        404,
      );
      const client = makeClient();

      try {
        await client.coordinator.getRun('nonexistent');
      } catch (e) {
        const err = e as OB1ApiError;
        expect(err.code).toBe('RESOURCE_NOT_FOUND');
      }
    });

    it('generates fallback message when body is not JSON', async () => {
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('not json', {
          status: 502,
          headers: { 'Content-Type': 'text/plain' },
        }),
      );
      const client = makeClient();

      try {
        await client.doctor.run();
      } catch (e) {
        const err = e as OB1ApiError;
        expect(err.status).toBe(502);
        expect(err.message).toContain('agent-doctor');
        expect(err.message).toContain('502');
      }
    });

    it('propagates network errors as-is', async () => {
      fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new TypeError('Failed to fetch'));
      const client = makeClient();

      await expect(client.doctor.run()).rejects.toThrow('Failed to fetch');
    });
  });

  // -----------------------------------------------------------------------
  // Namespace: tools
  // -----------------------------------------------------------------------

  describe('tools namespace', () => {
    beforeEach(() => {
      fetchSpy = mockFetch({ tools: [] });
    });

    it('list calls agent-tools with list_tools', async () => {
      const client = makeClient();
      await client.tools.list();
      const { url, body } = lastFetchArgs(fetchSpy);
      expect(url).toContain('/agent-tools');
      expect(body.action).toBe('list_tools');
    });

    it('get calls agent-tools with get_tool and tool_id', async () => {
      const client = makeClient();
      await client.tools.get('tool-abc');
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('get_tool');
      expect(body.tool_id).toBe('tool-abc');
    });

    it('register passes through tool data', async () => {
      const client = makeClient();
      await client.tools.register({ name: 'my_tool', description: 'test' });
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('register_tool');
      expect(body.name).toBe('my_tool');
    });

    it('assemblePool calls assemble_pool', async () => {
      const client = makeClient();
      await client.tools.assemblePool({ mode: 'default' });
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('assemble_pool');
      expect(body.mode).toBe('default');
    });

    it('getAuditSummary passes session_id', async () => {
      const client = makeClient();
      await client.tools.getAuditSummary('session-1');
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('get_audit_summary');
      expect(body.session_id).toBe('session-1');
    });
  });

  // -----------------------------------------------------------------------
  // Namespace: state
  // -----------------------------------------------------------------------

  describe('state namespace', () => {
    beforeEach(() => {
      fetchSpy = mockFetch({});
    });

    it('createSession calls agent-state with create_session', async () => {
      const client = makeClient();
      await client.state.createSession({ budget: 1.0 });
      const { url, body } = lastFetchArgs(fetchSpy);
      expect(url).toContain('/agent-state');
      expect(body.action).toBe('create_session');
      expect(body.budget).toBe(1.0);
    });

    it('getSession passes session_id', async () => {
      const client = makeClient();
      await client.state.getSession('sess-1');
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('get_session');
      expect(body.session_id).toBe('sess-1');
    });

    it('listSessions calls list_sessions', async () => {
      fetchSpy.mockRestore();
      fetchSpy = mockFetch([]);
      const client = makeClient();
      await client.state.listSessions();
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('list_sessions');
    });

    it('endSession passes session_id', async () => {
      const client = makeClient();
      await client.state.endSession('sess-2');
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('end_session');
      expect(body.session_id).toBe('sess-2');
    });

    it('recordCost merges cost data with session_id', async () => {
      const client = makeClient();
      await client.state.recordCost('sess-3', {
        input_tokens: 100,
        output_tokens: 50,
        cost_usd: 0.01,
      });
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('record_cost');
      expect(body.session_id).toBe('sess-3');
      expect(body.cost_usd).toBe(0.01);
    });
  });

  // -----------------------------------------------------------------------
  // Namespace: events
  // -----------------------------------------------------------------------

  describe('events namespace', () => {
    beforeEach(() => {
      fetchSpy = mockFetch([]);
    });

    it('emit calls agent-stream with emit_event', async () => {
      const client = makeClient();
      await client.events.emit({ title: 'Test', severity: 'info' });
      const { url, body } = lastFetchArgs(fetchSpy);
      expect(url).toContain('/agent-stream');
      expect(body.action).toBe('emit_event');
      expect(body.title).toBe('Test');
    });

    it('query calls query_events with filters', async () => {
      const client = makeClient();
      await client.events.query({ severity: 'error' });
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('query_events');
      expect(body.severity).toBe('error');
    });
  });

  // -----------------------------------------------------------------------
  // Namespace: doctor
  // -----------------------------------------------------------------------

  describe('doctor namespace', () => {
    beforeEach(() => {
      fetchSpy = mockFetch({ overall: 'pass', checks: [], timestamp: '' });
    });

    it('run calls agent-doctor with run_doctor', async () => {
      const client = makeClient();
      await client.doctor.run();
      const { url, body } = lastFetchArgs(fetchSpy);
      expect(url).toContain('/agent-doctor');
      expect(body.action).toBe('run_doctor');
    });

    it('getReport calls get_doctor_report', async () => {
      const client = makeClient();
      await client.doctor.getReport();
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('get_doctor_report');
    });

    it('getConfig calls get_config', async () => {
      const client = makeClient();
      await client.doctor.getConfig();
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('get_config');
    });

    it('updateConfig passes config payload', async () => {
      const client = makeClient();
      await client.doctor.updateConfig({ max_retries: 3 });
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('update_config');
      expect(body.max_retries).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Namespace: memory
  // -----------------------------------------------------------------------

  describe('memory namespace', () => {
    beforeEach(() => {
      fetchSpy = mockFetch({});
    });

    it('store calls agent-memory with memory_store', async () => {
      const client = makeClient();
      await client.memory.store('Remember this', {
        memory_scope: 'personal',
        memory_type: 'fact',
      });
      const { url, body } = lastFetchArgs(fetchSpy);
      expect(url).toContain('/agent-memory');
      expect(body.action).toBe('memory_store');
      expect(body.content).toBe('Remember this');
      expect(body.memory_scope).toBe('personal');
    });

    it('recall passes query and filters', async () => {
      fetchSpy.mockRestore();
      fetchSpy = mockFetch([]);
      const client = makeClient();
      await client.memory.recall('search term', {
        scope: 'project',
        min_trust: 3,
        max_results: 10,
      });
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('memory_recall');
      expect(body.query).toBe('search term');
      expect(body.scope).toBe('project');
      expect(body.min_trust).toBe(3);
      expect(body.max_results).toBe(10);
    });

    it('forget passes thought_id and reason', async () => {
      fetchSpy.mockRestore();
      fetchSpy = mockFetch({ success: true });
      const client = makeClient();
      await client.memory.forget('thought-1', 'outdated');
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('memory_forget');
      expect(body.thought_id).toBe('thought-1');
      expect(body.reason).toBe('outdated');
    });

    it('update passes thought_id and update fields', async () => {
      const client = makeClient();
      await client.memory.update('thought-2', {
        new_content: 'updated text',
        reason: 'correction',
      });
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('memory_update');
      expect(body.thought_id).toBe('thought-2');
      expect(body.new_content).toBe('updated text');
    });

    it('stats calls get_memory_stats with no extra params', async () => {
      const client = makeClient();
      await client.memory.stats();
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('get_memory_stats');
      expect(Object.keys(body)).toEqual(['action']);
    });
  });

  // -----------------------------------------------------------------------
  // Namespace: skills
  // -----------------------------------------------------------------------

  describe('skills namespace', () => {
    beforeEach(() => {
      fetchSpy = mockFetch({});
    });

    it('list calls agent-skills with list_skills', async () => {
      const client = makeClient();
      await client.skills.list();
      const { url, body } = lastFetchArgs(fetchSpy);
      expect(url).toContain('/agent-skills');
      expect(body.action).toBe('list_skills');
    });

    it('get passes skill_id', async () => {
      const client = makeClient();
      await client.skills.get('skill-42');
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('get_skill');
      expect(body.skill_id).toBe('skill-42');
    });

    it('listHooks calls list_hooks', async () => {
      const client = makeClient();
      await client.skills.listHooks();
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('list_hooks');
    });

    it('listPlugins calls list_plugins', async () => {
      const client = makeClient();
      await client.skills.listPlugins();
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('list_plugins');
    });
  });

  // -----------------------------------------------------------------------
  // Namespace: coordinator
  // -----------------------------------------------------------------------

  describe('coordinator namespace', () => {
    beforeEach(() => {
      fetchSpy = mockFetch({});
    });

    it('listTypes calls agent-coordinator with list_agent_types', async () => {
      fetchSpy.mockRestore();
      fetchSpy = mockFetch({ agent_types: [], count: 0 });
      const client = makeClient();
      await client.coordinator.listTypes();
      const { url, body } = lastFetchArgs(fetchSpy);
      expect(url).toContain('/agent-coordinator');
      expect(body.action).toBe('list_agent_types');
    });

    it('spawn sends full SpawnAgentRequest', async () => {
      fetchSpy.mockRestore();
      fetchSpy = mockFetch({
        id: 'new-id',
        run_id: 'run-1',
        agent_type: 'researcher',
        status: 'pending',
        created_at: '2024-01-01',
      });
      const client = makeClient();
      await client.coordinator.spawn({
        agent_type: 'researcher',
        task_prompt: 'Find info',
        task_context: { topic: 'testing' },
      });
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('spawn_agent');
      expect(body.agent_type).toBe('researcher');
      expect(body.task_prompt).toBe('Find info');
      expect(body.task_context).toEqual({ topic: 'testing' });
    });

    it('getRun passes run_id', async () => {
      const client = makeClient();
      await client.coordinator.getRun('run-123');
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('get_agent_run');
      expect(body.run_id).toBe('run-123');
    });

    it('cancelRun passes run_id and optional reason', async () => {
      const client = makeClient();
      await client.coordinator.cancelRun('run-123', 'user request');
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('cancel_agent_run');
      expect(body.run_id).toBe('run-123');
      expect(body.reason).toBe('user request');
    });

    it('updateStatus merges extra params', async () => {
      fetchSpy.mockRestore();
      fetchSpy = mockFetch({ run: {}, updated: true });
      const client = makeClient();
      await client.coordinator.updateStatus('run-1', 'completed', {
        output_summary: 'done',
      });
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('update_agent_status');
      expect(body.run_id).toBe('run-1');
      expect(body.status).toBe('completed');
      expect(body.output_summary).toBe('done');
    });

    it('getMessages passes run_id and optional coordinator_run_id', async () => {
      fetchSpy.mockRestore();
      fetchSpy = mockFetch({ messages: [], count: 0 });
      const client = makeClient();
      await client.coordinator.getMessages('run-1', 'coord-1');
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('get_messages');
      expect(body.run_id).toBe('run-1');
      expect(body.coordinator_run_id).toBe('coord-1');
    });

    it('getMessages omits coordinator_run_id when not provided', async () => {
      fetchSpy.mockRestore();
      fetchSpy = mockFetch({ messages: [], count: 0 });
      const client = makeClient();
      await client.coordinator.getMessages('run-1');
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.coordinator_run_id).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Namespace: tasks (compound operations)
  // -----------------------------------------------------------------------

  describe('tasks namespace', () => {
    beforeEach(() => {
      fetchSpy = mockFetch({});
    });

    it('list queries agent-memory with task-specific filters', async () => {
      fetchSpy.mockRestore();
      fetchSpy = mockFetch({ results: [] });
      const client = makeClient();
      await client.tasks.list();
      const { url, body } = lastFetchArgs(fetchSpy);
      expect(url).toContain('/agent-memory');
      expect(body.action).toBe('memory_recall');
      expect(body.memory_scope).toBe('project');
      expect(body.memory_type).toBe('instruction');
      expect(body.max_results).toBe(100);
    });

    it('create stores a task via agent-memory memory_store', async () => {
      fetchSpy.mockRestore();
      fetchSpy = mockFetch({ thought_id: 'new-task-id' });
      const client = makeClient();
      await client.tasks.create({
        title: 'Build tests',
        description: 'Write vitest tests',
        agent_type: 'developer',
        max_turns: 10,
        max_usd: 0.5,
        priority: 1,
        depends_on: [],
      });
      const { url, body } = lastFetchArgs(fetchSpy);
      expect(url).toContain('/agent-memory');
      expect(body.action).toBe('memory_store');
      expect(body.content).toContain('[Task] Build tests');
      expect(body.tags).toContain('task');
      expect(body.tags).toContain('night-run');
      expect(body.tags).toContain('developer');
    });

    it('remove calls memory_forget with task reason', async () => {
      fetchSpy.mockRestore();
      fetchSpy = mockFetch({ forgotten: true });
      const client = makeClient();
      await client.tasks.remove('task-1');
      const { body } = lastFetchArgs(fetchSpy);
      expect(body.action).toBe('memory_forget');
      expect(body.thought_id).toBe('task-1');
      expect(body.reason).toBe('Task removed by user');
    });

    it('startNightRun spawns a coordinator agent', async () => {
      fetchSpy.mockRestore();
      fetchSpy = mockFetch({ run_id: 'nr-1', status: 'pending' });
      const client = makeClient();
      await client.tasks.startNightRun(
        {
          total_budget_usd: 5,
          max_duration_hours: 8,
          max_concurrent_agents: 3,
          model: 'sonnet',
        },
        ['task-1', 'task-2'],
      );
      const { url, body } = lastFetchArgs(fetchSpy);
      expect(url).toContain('/agent-coordinator');
      expect(body.action).toBe('spawn_agent');
      expect(body.agent_type).toBe('coordinator');
      expect(body.task_prompt).toContain('2 tasks');
      expect(body.task_context.config.model).toBe('sonnet');
      expect(body.task_context.task_ids).toEqual(['task-1', 'task-2']);
    });
  });
});
