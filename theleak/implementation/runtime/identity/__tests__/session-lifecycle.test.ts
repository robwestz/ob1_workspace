// =============================================================================
// session-lifecycle.test.ts — Tests for the Identity Continuity Protocol
//
// Uses Node.js built-in test runner with an in-memory Supabase mock.
// No real network calls.
// =============================================================================

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { SessionLifecycle } from '../../src/session-lifecycle.js';
import type {
  AgentIdentity,
  DecisionRecord,
  LearningRecord,
  SessionStartResult,
} from '../../src/session-lifecycle.js';

// ---------------------------------------------------------------------------
// In-memory Supabase mock
// ---------------------------------------------------------------------------

interface MockStore {
  agent_identities: Record<string, unknown>[];
  agent_decisions: Record<string, unknown>[];
  agent_learnings: Record<string, unknown>[];
  agent_session_snapshots: Record<string, unknown>[];
}

let store: MockStore;
let fetchCallCount: number;
const originalFetch = globalThis.fetch;

function resetStore(): void {
  store = {
    agent_identities: [],
    agent_decisions: [],
    agent_learnings: [],
    agent_session_snapshots: [],
  };
  fetchCallCount = 0;
}

/**
 * Parse PostgREST query parameters from a URL path like:
 *   agent_decisions?identity_id=eq.abc&order=created_at.desc&limit=10
 */
function parsePostgREST(path: string): {
  table: string;
  filters: Record<string, string>;
  order?: string;
  limit?: number;
} {
  const [tablePart, queryString] = path.split('?');
  const table = tablePart.replace(/^\/rest\/v1\//, '');
  const filters: Record<string, string> = {};
  let order: string | undefined;
  let limit: number | undefined;

  if (queryString) {
    for (const param of queryString.split('&')) {
      const eqIdx = param.indexOf('=');
      if (eqIdx === -1) continue;
      const key = param.slice(0, eqIdx);
      const val = param.slice(eqIdx + 1);
      if (key === 'order') {
        order = val;
      } else if (key === 'limit') {
        limit = parseInt(val, 10);
      } else {
        filters[key] = val;
      }
    }
  }

  return { table, filters, order, limit };
}

function matchesFilters(
  row: Record<string, unknown>,
  filters: Record<string, string>,
): boolean {
  for (const [key, rawVal] of Object.entries(filters)) {
    if (rawVal.startsWith('eq.')) {
      const expected = decodeURIComponent(rawVal.slice(3));
      if (String(row[key]) !== expected) return false;
    }
  }
  return true;
}

function applyOrder(
  rows: Record<string, unknown>[],
  order?: string,
): Record<string, unknown>[] {
  if (!order) return rows;
  const desc = order.endsWith('.desc');
  const field = order.replace(/\.(asc|desc)$/, '');
  return [...rows].sort((a, b) => {
    const av = String(a[field] ?? '');
    const bv = String(b[field] ?? '');
    const cmp = av.localeCompare(bv);
    return desc ? -cmp : cmp;
  });
}

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetchMock(): void {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    fetchCallCount++;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const pathname = url.replace('https://test.supabase.co', '');
    const method = init?.method ?? 'GET';

    const { table, filters, order, limit } = parsePostgREST(pathname);
    const tableKey = table as keyof MockStore;

    if (!(tableKey in store)) {
      return mockResponse({ error: `Unknown table: ${table}` }, 404);
    }

    if (method === 'GET') {
      let rows = store[tableKey].filter((r) => matchesFilters(r, filters));
      rows = applyOrder(rows, order);
      if (limit !== undefined) rows = rows.slice(0, limit);
      return mockResponse(rows);
    }

    if (method === 'POST') {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>[];
      const created: Record<string, unknown>[] = [];
      for (const row of body) {
        const withDefaults: Record<string, unknown> = {
          id: `${tableKey}_${store[tableKey].length + 1}`,
          created_at: new Date().toISOString(),
          ...row,
        };
        // Parse stringified JSON for identity fields
        if (tableKey === 'agent_identities') {
          if (typeof withDefaults.active_goals === 'string') {
            withDefaults.active_goals = JSON.parse(withDefaults.active_goals as string);
          }
          if (typeof withDefaults.current_priorities === 'string') {
            withDefaults.current_priorities = JSON.parse(withDefaults.current_priorities as string);
          }
          if (typeof withDefaults.capabilities === 'string') {
            withDefaults.capabilities = JSON.parse(withDefaults.capabilities as string);
          }
          withDefaults.session_count = withDefaults.session_count ?? 0;
          withDefaults.total_runtime_minutes = withDefaults.total_runtime_minutes ?? 0;
          withDefaults.persona_hash = withDefaults.persona_hash ?? null;
          withDefaults.self_assessment = withDefaults.self_assessment ?? null;
          withDefaults.last_session_at = withDefaults.last_session_at ?? null;
          withDefaults.updated_at = new Date().toISOString();
        }
        store[tableKey].push(withDefaults);
        created.push(withDefaults);
      }
      return mockResponse(created, 201);
    }

    if (method === 'PATCH') {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      let patched = 0;
      for (const row of store[tableKey]) {
        if (matchesFilters(row, filters)) {
          for (const [key, val] of Object.entries(body)) {
            if (key === 'active_goals' && typeof val === 'string') {
              row[key] = JSON.parse(val);
            } else {
              row[key] = val;
            }
          }
          patched++;
        }
      }
      return mockResponse(patched > 0 ? [store[tableKey].find((r) => matchesFilters(r, filters))] : []);
    }

    return mockResponse({ error: 'Unhandled method' }, 400);
  };
}

function restoreFetch(): void {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

const SUPABASE_URL = 'https://test.supabase.co';
const ACCESS_KEY = 'test-key-123';

describe('SessionLifecycle', () => {
  let lifecycle: SessionLifecycle;

  beforeEach(() => {
    resetStore();
    installFetchMock();
    lifecycle = new SessionLifecycle(SUPABASE_URL, ACCESS_KEY);
  });

  // Restore after all tests (best-effort — node:test does not have global afterAll)
  // Each test re-installs mock in beforeEach, so leakage is safe.

  // -------------------------------------------------------------------------
  // 1. startSession returns all required fields
  // -------------------------------------------------------------------------

  describe('startSession', () => {
    it('returns all required fields', async () => {
      const result = await lifecycle.startSession({
        identityName: 'sysadmin',
        sessionType: 'interactive',
        model: 'claude-opus-4-20250514',
      });

      assert.ok(result.sessionId, 'sessionId should be set');
      assert.ok(result.sessionId.startsWith('interactive_'), 'sessionId should start with session type');
      assert.ok(result.identity, 'identity should be set');
      assert.equal(result.identity.name, 'sysadmin');
      assert.ok(Array.isArray(result.recentDecisions), 'recentDecisions should be an array');
      assert.ok(Array.isArray(result.recentLearnings), 'recentLearnings should be an array');
      assert.ok(Array.isArray(result.activeGoals), 'activeGoals should be an array');
      assert.ok(Array.isArray(result.relevantKnowledge), 'relevantKnowledge should be an array');
      assert.ok(typeof result.systemPrompt === 'string', 'systemPrompt should be a string');
      assert.ok(result.systemPrompt.length > 0, 'systemPrompt should not be empty');
      assert.ok(typeof result.bootstrapDurationMs === 'number', 'bootstrapDurationMs should be a number');

      restoreFetch();
    });

    // -----------------------------------------------------------------------
    // 2. startSession creates identity if it doesn't exist
    // -----------------------------------------------------------------------

    it('creates identity if it does not exist', async () => {
      assert.equal(store.agent_identities.length, 0, 'store should start empty');

      const result = await lifecycle.startSession({
        identityName: 'new-agent',
        sessionType: 'task',
        model: 'gpt-4o',
      });

      assert.equal(result.identity.name, 'new-agent');
      assert.equal(store.agent_identities.length, 1, 'identity should be created in store');
      assert.equal(
        (store.agent_identities[0] as Record<string, unknown>).name,
        'new-agent',
      );

      restoreFetch();
    });

    // -----------------------------------------------------------------------
    // 3. startSession completes in under 5 seconds (no N+1)
    // -----------------------------------------------------------------------

    it('completes in under 5 seconds with no N+1 queries', async () => {
      // Pre-seed an identity with decisions and learnings
      const identity = {
        id: 'id-perf',
        name: 'perf-agent',
        active_goals: ['goal1', 'goal2'],
        current_priorities: [],
        capabilities: {},
        persona_hash: null,
        self_assessment: null,
        session_count: 10,
        total_runtime_minutes: 500,
        last_session_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.agent_identities.push(identity);

      for (let i = 0; i < 15; i++) {
        store.agent_decisions.push({
          id: `dec-${i}`,
          identity_id: 'id-perf',
          session_id: `session-${i}`,
          decision: `Decision ${i}`,
          rationale: `Reason ${i}`,
          context: null,
          outcome: null,
          outcome_status: 'pending',
          tags: [],
          created_at: new Date(Date.now() - i * 60_000).toISOString(),
        });
      }

      for (let i = 0; i < 25; i++) {
        store.agent_learnings.push({
          id: `lrn-${i}`,
          identity_id: 'id-perf',
          session_id: `session-${i}`,
          learning: `Learning ${i}`,
          category: 'technical',
          confidence: 0.8,
          source: null,
          superseded_by: null,
          tags: [],
          created_at: new Date(Date.now() - i * 60_000).toISOString(),
        });
      }

      const start = Date.now();
      fetchCallCount = 0;

      const result = await lifecycle.startSession({
        identityName: 'perf-agent',
        sessionType: 'night_shift',
        model: 'claude-opus-4-20250514',
      });

      const elapsed = Date.now() - start;

      assert.ok(elapsed < 5000, `Bootstrap should be < 5s, was ${elapsed}ms`);
      // Should be exactly 4 fetch calls: identity lookup, decisions, learnings, knowledge
      // (identity exists so no create call)
      assert.ok(
        fetchCallCount <= 4,
        `Should use <= 4 fetch calls (parallel), used ${fetchCallCount}`,
      );
      assert.equal(result.recentDecisions.length, 10, 'Should limit decisions to 10');
      assert.equal(result.recentLearnings.length, 20, 'Should limit learnings to 20');

      restoreFetch();
    });
  });

  // -------------------------------------------------------------------------
  // endSession
  // -------------------------------------------------------------------------

  describe('endSession', () => {
    let seedIdentity: Record<string, unknown>;

    beforeEach(() => {
      seedIdentity = {
        id: 'id-end',
        name: 'sysadmin',
        active_goals: ['ship feature X'],
        current_priorities: [],
        capabilities: {},
        persona_hash: null,
        self_assessment: null,
        session_count: 5,
        total_runtime_minutes: 300,
        last_session_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.agent_identities.push(seedIdentity);
    });

    // -----------------------------------------------------------------------
    // 4. endSession persists decisions
    // -----------------------------------------------------------------------

    it('persists decisions', async () => {
      await lifecycle.endSession({
        sessionId: 'test-session-1',
        identityName: 'sysadmin',
        sessionType: 'interactive',
        startedAt: new Date(Date.now() - 3_600_000),
        decisions: [
          { decision: 'Use Supabase Edge Functions', rationale: 'Better cold start' },
          { decision: 'Skip Redis cache', rationale: 'Premature optimization', tags: ['architecture'] },
        ],
        learnings: [],
        goalsAtEnd: ['ship feature X'],
        summary: 'Productive session.',
      });

      assert.equal(store.agent_decisions.length, 2);
      assert.equal(
        (store.agent_decisions[0] as Record<string, unknown>).decision,
        'Use Supabase Edge Functions',
      );
      assert.equal(
        (store.agent_decisions[1] as Record<string, unknown>).decision,
        'Skip Redis cache',
      );
      assert.deepStrictEqual(
        (store.agent_decisions[1] as Record<string, unknown>).tags,
        ['architecture'],
      );

      restoreFetch();
    });

    // -----------------------------------------------------------------------
    // 5. endSession persists learnings
    // -----------------------------------------------------------------------

    it('persists learnings', async () => {
      await lifecycle.endSession({
        sessionId: 'test-session-2',
        identityName: 'sysadmin',
        sessionType: 'night_shift',
        startedAt: new Date(Date.now() - 7_200_000),
        decisions: [],
        learnings: [
          { learning: 'PostgREST supports bulk inserts', category: 'technical' },
          { learning: 'Robin prefers short morning reports', category: 'robin_preference', tags: ['ux'] },
        ],
        goalsAtEnd: [],
        wavesCompleted: 3,
        summary: 'Night shift done.',
      });

      assert.equal(store.agent_learnings.length, 2);
      assert.equal(
        (store.agent_learnings[0] as Record<string, unknown>).learning,
        'PostgREST supports bulk inserts',
      );
      assert.equal(
        (store.agent_learnings[0] as Record<string, unknown>).category,
        'technical',
      );
      assert.deepStrictEqual(
        (store.agent_learnings[1] as Record<string, unknown>).tags,
        ['ux'],
      );

      restoreFetch();
    });

    // -----------------------------------------------------------------------
    // 6. endSession updates session count on identity
    // -----------------------------------------------------------------------

    it('updates session count on identity', async () => {
      const before = seedIdentity.session_count as number;

      await lifecycle.endSession({
        sessionId: 'test-session-3',
        identityName: 'sysadmin',
        sessionType: 'task',
        startedAt: new Date(Date.now() - 600_000),
        decisions: [],
        learnings: [],
        goalsAtEnd: ['next goal'],
        summary: 'Quick task.',
      });

      assert.equal(
        seedIdentity.session_count,
        before + 1,
        'session_count should increment by 1',
      );
      assert.ok(
        seedIdentity.last_session_at !== null,
        'last_session_at should be updated',
      );

      restoreFetch();
    });

    // -----------------------------------------------------------------------
    // 7. endSession saves session snapshot
    // -----------------------------------------------------------------------

    it('saves session snapshot', async () => {
      await lifecycle.endSession({
        sessionId: 'snap-session',
        identityName: 'sysadmin',
        sessionType: 'night_shift',
        startedAt: new Date(Date.now() - 3_600_000),
        decisions: [{ decision: 'd1', rationale: 'r1' }],
        learnings: [{ learning: 'l1', category: 'technical' }],
        goalsAtEnd: ['goal-a', 'goal-b'],
        wavesCompleted: 5,
        tasksCompleted: 8,
        tasksFailed: 1,
        usdSpent: 2.5,
        tokensUsed: 150_000,
        summary: 'Completed 5 waves.',
      });

      assert.equal(store.agent_session_snapshots.length, 1);
      const snapshot = store.agent_session_snapshots[0] as Record<string, unknown>;
      assert.equal(snapshot.session_id, 'snap-session');
      assert.equal(snapshot.session_type, 'night_shift');
      assert.equal(snapshot.waves_completed, 5);
      assert.equal(snapshot.tasks_completed, 8);
      assert.equal(snapshot.tasks_failed, 1);
      assert.equal(snapshot.usd_spent, 2.5);
      assert.equal(snapshot.tokens_used, 150_000);
      assert.equal(snapshot.decisions_made, 1);
      assert.equal(snapshot.learnings_captured, 1);
      assert.equal(snapshot.summary, 'Completed 5 waves.');

      restoreFetch();
    });
  });

  // -------------------------------------------------------------------------
  // 8. refreshContext
  // -------------------------------------------------------------------------

  describe('refreshContext', () => {
    it('returns condensed identity string', async () => {
      store.agent_identities.push({
        id: 'id-refresh',
        name: 'sysadmin',
        active_goals: ['deploy v2', 'fix flaky tests'],
        current_priorities: [],
        capabilities: {},
        persona_hash: null,
        self_assessment: null,
        session_count: 3,
        total_runtime_minutes: 120,
        last_session_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      store.agent_decisions.push({
        id: 'dec-r1',
        identity_id: 'id-refresh',
        decision: 'Chose PostgREST over Edge Functions',
        rationale: 'simplicity',
        session_id: 's1',
        context: null,
        outcome: null,
        outcome_status: 'pending',
        tags: [],
        created_at: new Date().toISOString(),
      });
      store.agent_learnings.push({
        id: 'lrn-r1',
        identity_id: 'id-refresh',
        learning: 'Parallel fetches reduce bootstrap time',
        category: 'performance',
        confidence: 0.9,
        source: null,
        superseded_by: null,
        tags: [],
        session_id: 's1',
        created_at: new Date().toISOString(),
      });

      const result = await lifecycle.refreshContext('sysadmin');

      assert.ok(result.startsWith('I am sysadmin'), 'Should start with identity name');
      assert.ok(result.includes('deploy v2'), 'Should include goals');
      assert.ok(result.includes('fix flaky tests'), 'Should include goals');
      assert.ok(result.includes('Chose PostgREST over Edge Functions'), 'Should include decisions');
      assert.ok(result.includes('Parallel fetches reduce bootstrap time'), 'Should include learnings');

      restoreFetch();
    });

    it('returns fallback string for unknown identity', async () => {
      const result = await lifecycle.refreshContext('unknown-agent');
      assert.ok(result.includes('not found'), 'Should indicate identity not found');

      restoreFetch();
    });
  });

  // -------------------------------------------------------------------------
  // 9. Multiple start/end cycles maintain continuity
  // -------------------------------------------------------------------------

  describe('continuity across sessions', () => {
    it('decisions from session 1 are visible in session 2', async () => {
      // Session 1: start, make decisions, end
      const session1 = await lifecycle.startSession({
        identityName: 'sysadmin',
        sessionType: 'interactive',
        model: 'claude-opus-4-20250514',
      });

      assert.equal(session1.recentDecisions.length, 0, 'No decisions in first session');

      await lifecycle.endSession({
        sessionId: session1.sessionId,
        identityName: 'sysadmin',
        sessionType: 'interactive',
        startedAt: new Date(Date.now() - 1_800_000),
        decisions: [
          { decision: 'Adopted wave protocol', rationale: 'Proven in OB1' },
          { decision: 'Set budget to $20', rationale: 'Conservative for first run' },
        ],
        learnings: [
          { learning: 'Wave protocol works best with 45-min waves', category: 'process' },
        ],
        goalsAtEnd: ['complete phase 1', 'write tests'],
        summary: 'Session 1 complete.',
      });

      // Session 2: start and verify continuity
      const session2 = await lifecycle.startSession({
        identityName: 'sysadmin',
        sessionType: 'night_shift',
        model: 'claude-opus-4-20250514',
      });

      // Decisions from session 1 should be visible
      assert.equal(
        session2.recentDecisions.length, 2,
        'Session 2 should see decisions from session 1',
      );
      const decisionTexts = session2.recentDecisions.map((d) => d.decision);
      assert.ok(
        decisionTexts.includes('Adopted wave protocol'),
        'Should include first decision',
      );
      assert.ok(
        decisionTexts.includes('Set budget to $20'),
        'Should include second decision',
      );

      // Learnings from session 1 should be visible
      assert.equal(
        session2.recentLearnings.length, 1,
        'Session 2 should see learnings from session 1',
      );
      assert.equal(
        session2.recentLearnings[0].learning,
        'Wave protocol works best with 45-min waves',
      );

      // Goals should be carried over
      assert.deepStrictEqual(
        session2.activeGoals,
        ['complete phase 1', 'write tests'],
        'Goals from session 1 end should be active in session 2',
      );

      // Session count should have incremented
      assert.equal(
        session2.identity.session_count, 1,
        'Session count should be 1 after first session ended',
      );

      // System prompt should reference decisions and learnings
      assert.ok(
        session2.systemPrompt.includes('Adopted wave protocol'),
        'System prompt should include past decisions',
      );
      assert.ok(
        session2.systemPrompt.includes('Wave protocol works best'),
        'System prompt should include past learnings',
      );

      restoreFetch();
    });
  });
});
