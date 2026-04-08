// Unit Tests — CrashRecovery

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CrashRecovery, type WaveCheckpoint } from '../src/crash-recovery.js';

type MockResponse = { ok: boolean; status: number; body: unknown };
let fetchCalls: Array<{ url: string; method: string; body?: unknown }> = [];
let nextResponse: MockResponse = { ok: true, status: 200, body: [] };

const mockFetch = mock.fn(async (url: string, init?: RequestInit) => {
  fetchCalls.push({
    url,
    method: init?.method ?? 'GET',
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  });
  return {
    ok: nextResponse.ok,
    status: nextResponse.status,
    json: async () => nextResponse.body,
    text: async () => JSON.stringify(nextResponse.body),
  };
});

function makeCheckpoint(overrides: Partial<WaveCheckpoint> = {}): WaveCheckpoint {
  return {
    contract_id: 'contract-1',
    wave_number: 3,
    waves_completed: [
      { id: 1, name: 'Tests', status: 'completed', usd_spent: 1.5, commit_sha: 'abc123' },
      { id: 2, name: 'Security', status: 'completed', usd_spent: 2.0, commit_sha: 'def456' },
      { id: 3, name: 'Docs', status: 'failed', usd_spent: 0.5 },
    ],
    remaining_goals: ['Performance audit'],
    usd_spent_total: 4.0,
    tokens_used_total: 150_000,
    next_wave_suggestions: ['Wave 4: Performance'],
    morning_report_path: '/reports/morning-001.md',
    saved_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeContractRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'contract-1',
    status: 'active',
    last_heartbeat: new Date(Date.now() - 10 * 60_000).toISOString(), // 10 min ago
    last_checkpoint: makeCheckpoint(),
    budget_usd: 10.0,
    duration_minutes: 450,
    started_at: new Date(Date.now() - 60 * 60_000).toISOString(), // 1 hour ago
    ...overrides,
  };
}

let recovery: CrashRecovery;
const originalFetch = globalThis.fetch;

describe('CrashRecovery', () => {
  beforeEach(() => {
    fetchCalls = [];
    nextResponse = { ok: true, status: 200, body: [] };
    (globalThis as any).fetch = mockFetch;
    mockFetch.mock.resetCalls();
    recovery = new CrashRecovery('https://test.supabase.co', 'test-key');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('saveCheckpoint', () => {
    it('persists checkpoint to Supabase', async () => {
      nextResponse = { ok: true, status: 200, body: undefined };
      const cp = makeCheckpoint();

      await recovery.saveCheckpoint(cp);

      assert.equal(fetchCalls.length, 1);
      assert.equal(fetchCalls[0].method, 'PATCH');
      assert.ok(fetchCalls[0].url.includes('session_contracts'));
      assert.deepEqual(fetchCalls[0].body!.last_checkpoint, cp);
      assert.ok(fetchCalls[0].body!.last_heartbeat); // also updates heartbeat
    });
  });

  describe('heartbeat', () => {
    it('updates timestamp via PATCH', async () => {
      nextResponse = { ok: true, status: 200, body: undefined };

      await recovery.heartbeat('contract-1');

      assert.equal(fetchCalls.length, 1);
      assert.equal(fetchCalls[0].method, 'PATCH');
      assert.ok(fetchCalls[0].body!.last_heartbeat);
    });
  });

  describe('detectCrash', () => {
    it('returns crashed=true for stale heartbeat', async () => {
      nextResponse = { ok: true, status: 200, body: [makeContractRow()] };

      const result = await recovery.detectCrash();

      assert.equal(result.crashed, true);
      assert.equal(result.contract_id, 'contract-1');
      assert.ok(result.minutes_since_heartbeat! >= 9); // ~10 min ago
    });

    it('returns crashed=false for fresh heartbeat', async () => {
      nextResponse = {
        ok: true,
        status: 200,
        body: [makeContractRow({ last_heartbeat: new Date().toISOString() })],
      };

      const result = await recovery.detectCrash();

      assert.equal(result.crashed, false);
      assert.equal(result.recommendation, 'none');
    });

    it('recommends resume when checkpoint exists with budget remaining', async () => {
      // 4 of 10 USD spent = 40%
      nextResponse = { ok: true, status: 200, body: [makeContractRow()] };

      const result = await recovery.detectCrash();

      assert.equal(result.recommendation, 'resume');
      assert.ok(result.reason.includes('40%'));
    });

    it('recommends resume with reduced budget note when > 50% spent', async () => {
      const cp = makeCheckpoint({ usd_spent_total: 7.0 });
      nextResponse = {
        ok: true,
        status: 200,
        body: [makeContractRow({ last_checkpoint: cp })],
      };

      const result = await recovery.detectCrash();

      assert.equal(result.recommendation, 'resume');
      assert.ok(result.reason.includes('reduced budget'));
    });

    it('recommends abort when no checkpoint exists', async () => {
      nextResponse = {
        ok: true,
        status: 200,
        body: [makeContractRow({ last_checkpoint: null })],
      };

      const result = await recovery.detectCrash();

      assert.equal(result.recommendation, 'abort');
      assert.ok(result.reason.includes('cannot resume'));
    });

    it('returns crashed=false when no active contracts', async () => {
      nextResponse = { ok: true, status: 200, body: [] };

      const result = await recovery.detectCrash();

      assert.equal(result.crashed, false);
    });
  });

  describe('resume', () => {
    it('returns checkpoint with remaining budget and time', async () => {
      nextResponse = { ok: true, status: 200, body: [makeContractRow()] };

      const state = await recovery.resume('contract-1');

      assert.ok(state !== null);
      assert.equal(state!.checkpoint.contract_id, 'contract-1');
      assert.equal(state!.remaining_budget_usd, 6.0); // 10 - 4
      assert.equal(state!.resume_wave_number, 4); // checkpoint.wave_number + 1
      assert.ok(state!.remaining_duration_minutes > 0);
      assert.ok(state!.remaining_duration_minutes <= 450);
    });

    it('returns null for unknown contract', async () => {
      nextResponse = { ok: true, status: 200, body: [] };

      const state = await recovery.resume('unknown-id');

      assert.equal(state, null);
    });

    it('returns null when fetch fails', async () => {
      nextResponse = { ok: false, status: 500, body: 'Internal error' };

      const state = await recovery.resume('contract-1');

      assert.equal(state, null);
    });
  });

  describe('markAborted', () => {
    it('updates contract status to aborted', async () => {
      nextResponse = { ok: true, status: 200, body: undefined };

      await recovery.markAborted('contract-1', 'No checkpoint available');

      assert.equal(fetchCalls.length, 1);
      assert.equal(fetchCalls[0].method, 'PATCH');
      assert.deepEqual(fetchCalls[0].body!.status, 'aborted');
      assert.deepEqual(fetchCalls[0].body!.abort_reason, 'No checkpoint available');
    });
  });

  describe('startHeartbeatInterval', () => {
    it('calls heartbeat periodically and can be stopped', async () => {
      nextResponse = { ok: true, status: 200, body: undefined };

      const stop = recovery.startHeartbeatInterval('contract-1', 50); // 50ms for test speed

      // Wait for 2-3 heartbeats
      await new Promise(r => setTimeout(r, 160));
      stop();

      // Should have fired at least twice
      const heartbeatCalls = fetchCalls.filter(c => c.method === 'PATCH');
      assert.ok(heartbeatCalls.length >= 2, `Expected >= 2 heartbeats, got ${heartbeatCalls.length}`);
    });
  });

  describe('generateRestartCommand', () => {
    it('produces valid command string', () => {
      const cmd = CrashRecovery.generateRestartCommand({
        runtimePath: '/opt/ob1/runtime/dist',
        contractId: 'contract-42',
      });

      assert.ok(cmd.includes('node'));
      assert.ok(cmd.includes('wave-runner.js'));
      assert.ok(cmd.includes('--resume'));
      assert.ok(cmd.includes('--contract-id contract-42'));
      assert.equal(cmd, 'node /opt/ob1/runtime/dist/wave-runner.js --resume --contract-id contract-42');
    });
  });
});
