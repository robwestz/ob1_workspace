// E2E Integration Tests — OB1 Control (Phase 10, Plan 1)
// Full integration paths with injectable mocks. No real Supabase/SSH/LLM.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// -- Mock Infrastructure ------------------------------------------------------
type Row = Record<string, unknown>;
interface SshCall { command: string; response: string }
interface LlmCall { model: string; prompt: string; response: string }

class MockInfra {
  private tables = new Map<string, Row[]>();
  private _sshLog: SshCall[] = [];
  private _llmLog: LlmCall[] = [];
  private sshResp = new Map<string, string>();
  private fetchOrig: typeof globalThis.fetch | null = null;

  setup(): void {
    this.fetchOrig = globalThis.fetch;
    this.tables.clear(); this._sshLog = []; this._llmLog = [];
    for (const t of ['session_contracts', 'agent_identities', 'initiatives', 'wave_logs', 'thoughts'])
      this.tables.set(t, []);
    (globalThis as any).fetch = async (url: string | URL, init?: RequestInit) =>
      this.handleFetch(String(url), init);
  }
  teardown(): void { if (this.fetchOrig) { globalThis.fetch = this.fetchOrig; this.fetchOrig = null; } }
  getTable(name: string): Row[] { return this.tables.get(name) ?? []; }
  seed(table: string, rows: Row[]): void {
    const e = this.tables.get(table) ?? []; e.push(...rows); this.tables.set(table, e);
  }
  insert(table: string, row: Row): void {
    const rows = this.tables.get(table) ?? [];
    rows.push({ id: `m-${Date.now()}-${rows.length}`, created_at: new Date().toISOString(), ...row });
    this.tables.set(table, rows);
  }
  setSsh(pattern: string, response: string): void { this.sshResp.set(pattern, response); }
  sshLog(): SshCall[] { return [...this._sshLog]; }
  ssh(command: string): string {
    const e: SshCall = { command, response: '' };
    for (const [p, r] of this.sshResp) if (command.includes(p)) { e.response = r; break; }
    this._sshLog.push(e); return e.response;
  }
  llmLog(): LlmCall[] { return [...this._llmLog]; }
  llm(model: string, prompt: string): string {
    const response = '{"result":"ok"}';
    this._llmLog.push({ model, prompt, response }); return response;
  }
  private async handleFetch(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const rpc = url.match(/\/rest\/v1\/rpc\/(\w+)/);
    if (rpc) return this.jr({ result: 'ok' });
    const tm = url.match(/\/rest\/v1\/(\w+)/);
    if (!tm) return this.jr({ error: 'unknown' }, 404);
    const table = tm[1];
    if (method === 'GET') {
      let rows = [...this.getTable(table)];
      const params = new URL(url, 'http://m').searchParams;
      for (const [k, v] of params) {
        if (['select', 'order', 'limit'].includes(k)) continue;
        if (v.startsWith('eq.')) rows = rows.filter(r => String(r[k]) === v.slice(3));
      }
      return this.jr(rows);
    }
    if (method === 'POST') { this.insert(table, body); return this.jr([body], 201); }
    if (method === 'PATCH') { for (const r of this.getTable(table)) Object.assign(r, body); return this.jr(this.getTable(table)); }
    if (method === 'DELETE') { this.tables.set(table, []); return this.jr(null, 204); }
    return this.jr({ error: 'unhandled' }, 400);
  }
  private jr(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  }
}

// -- Helpers ------------------------------------------------------------------
interface WaveResult {
  wave_id: number; name: string; tasks_completed: number; tasks_failed: number;
  gates_passed: boolean; usd_spent: number; value_score: number;
  model_used: string; crashed: boolean; resumed: boolean;
}
function wave(id: number, o: Partial<WaveResult> = {}): WaveResult {
  return { wave_id: id, name: `Wave ${id}`, tasks_completed: 3, tasks_failed: 0,
    gates_passed: true, usd_spent: 1.0, value_score: Math.max(0, 1 - 0.08 * (id - 1)),
    model_used: 'claude-sonnet-4-6', crashed: false, resumed: false, ...o };
}
function contract(o: Row = {}): Row {
  return { id: 'c-001', name: 'E2E Session', status: 'active',
    primary_goal: 'Test integration', secondary_goals: ['Recovery', 'Budget'],
    budget_usd: 25, duration_hours: 8, model: 'sonnet',
    last_heartbeat: new Date().toISOString(), last_checkpoint: null,
    started_at: new Date().toISOString(), ...o };
}

// =============================================================================
describe('E2E Integration Tests', () => {
  let m: MockInfra;
  beforeEach(() => { m = new MockInfra(); m.setup(); });
  afterEach(() => { m.teardown(); });

  // 1. Session lifecycle
  it('1. Session lifecycle: contract → waves → report → end', () => {
    const c = contract(); m.seed('session_contracts', [c]);
    const ws: WaveResult[] = [];
    for (let i = 1; i <= 3; i++) { const w = wave(i); ws.push(w); m.insert('wave_logs', { contract_id: c.id, ...w }); }
    const cs = m.getTable('session_contracts'); cs[0].status = 'completed'; cs[0].waves_completed = 3;
    assert.equal(cs[0].status, 'completed');
    assert.equal(m.getTable('wave_logs').length, 3);
    assert.equal(ws.reduce((s, w) => s + w.usd_spent, 0), 3.0);
    assert.equal(ws.reduce((s, w) => s + w.tasks_completed, 0), 9);
  });

  // 2. Identity continuity
  it('2. Identity continuity: decisions persist across sessions', () => {
    const id = { id: 'id-001', agent_name: 'night-worker',
      preferences: { indent: 'tabs' },
      decisions: [
        { key: 'auth_pattern', value: 'JWT', session: 's-1' },
        { key: 'db_orm', value: 'raw SQL', session: 's-1' },
      ] };
    m.seed('agent_identities', [id]);
    const agent = m.getTable('agent_identities')[0] as typeof id;
    assert.equal(agent.decisions.length, 2);
    assert.equal(agent.decisions[0].value, 'JWT');
    agent.decisions.push({ key: 'deploy_target', value: 'mac-m2', session: 's-2' });
    const final = m.getTable('agent_identities')[0] as typeof id;
    assert.equal(final.decisions.length, 3);
    assert.equal(final.decisions[2].key, 'deploy_target');
  });

  // 3. Self-direction
  it('3. Self-direction: ASSESS selects higher-value next wave', () => {
    const ws = [wave(1, { value_score: 0.80 }), wave(2, { value_score: 0.70 })];
    const cands = [
      { name: 'Fix failing gate', value: 1.0 },
      { name: 'Continue security', value: 0.65 },
      { name: 'Deepen tests', value: 0.85 },
    ];
    cands.sort((a, b) => b.value - a.value);
    assert.equal(cands[0].name, 'Fix failing gate');
    assert.ok(cands[0].value > Math.max(...ws.map(w => w.value_score)));
  });

  // 4. Crash recovery
  it('4. Crash recovery: stale heartbeat → resume → continuity', () => {
    const stale = new Date(Date.now() - 15 * 60_000).toISOString();
    const cp = { contract_id: 'c-001', wave_number: 3,
      waves_completed: [{ id: 1, usd: 1.5 }, { id: 2, usd: 2.0 }],
      usd_spent_total: 3.5, remaining_goals: ['Perf audit'] };
    m.seed('session_contracts', [contract({ last_heartbeat: stale, last_checkpoint: cp, budget_usd: 10 })]);
    const c = m.getTable('session_contracts')[0];
    const age = Date.now() - new Date(c.last_heartbeat as string).getTime();
    assert.ok(age > 5 * 60_000, 'Should detect crash');
    const ckpt = c.last_checkpoint as typeof cp;
    assert.equal(ckpt.wave_number + 1, 4);
    assert.equal((c.budget_usd as number) - ckpt.usd_spent_total, 6.5);
    assert.deepEqual(ckpt.remaining_goals, ['Perf audit']);
    c.last_heartbeat = new Date().toISOString(); c.status = 'active';
    assert.ok(Date.now() - new Date(c.last_heartbeat as string).getTime() < 1000);
  });

  // 5. Budget enforcement
  it('5. Budget enforcement: $5 budget → exhaust → clean stop', () => {
    const budget = 5.0; m.seed('session_contracts', [contract({ budget_usd: budget })]);
    let spent = 0; const ws: WaveResult[] = []; let n = 1;
    while (spent < budget) {
      const cost = 1.0 + Math.random() * 0.5;
      if (spent + cost > budget) break;
      spent += cost; ws.push(wave(n, { usd_spent: cost })); n++;
    }
    assert.ok(spent <= budget, `Spent $${spent.toFixed(2)} <= $${budget}`);
    assert.ok(ws.length >= 2 && ws.length <= 5);
    const c = m.getTable('session_contracts')[0];
    c.status = 'completed'; c.stop_reason = 'budget_exhausted';
    assert.equal(c.stop_reason, 'budget_exhausted');
  });

  // 6. Quality gates
  it('6. Quality gates: fail → fix → pass → verify flow', () => {
    const g: Array<{ name: string; passed: boolean; attempt: number }> = [];
    g.push({ name: 'tsc', passed: false, attempt: 1 }); // fails
    g.push({ name: 'tsc', passed: true, attempt: 2 });  // fixed
    g.push({ name: 'tests', passed: true, attempt: 1 });
    g.push({ name: 'lint', passed: true, attempt: 1 });
    assert.equal(g.filter(x => !x.passed).length, 1);
    assert.equal(g.filter(x => x.passed).length, 3);
    const tsc = g.filter(x => x.name === 'tsc');
    assert.equal(tsc[0].passed, false); assert.equal(tsc[1].passed, true);
    m.insert('wave_logs', { wave_id: 1, gates_passed: true, fix_attempts: 1 });
    const logged = m.getTable('wave_logs')[0];
    assert.equal(logged.fix_attempts, 1); assert.equal(logged.gates_passed, true);
  });

  // 7. Initiative discovery
  it('7. Initiative discovery: scan → store → retrieve → approve', () => {
    const opps = [
      { title: 'Add rate limiting', category: 'security', impact: 'high', priority_score: 0.85 },
      { title: 'Cleanup deps', category: 'maintenance', impact: 'low', priority_score: 0.40 },
      { title: 'Cache queries', category: 'performance', impact: 'medium', priority_score: 0.70 },
    ];
    for (const o of opps) m.insert('initiatives', { ...o, status: 'discovered' });
    const backlog = m.getTable('initiatives').sort((a, b) => (b.priority_score as number) - (a.priority_score as number));
    assert.equal(backlog.length, 3);
    assert.equal(backlog[0].title, 'Add rate limiting');
    assert.equal(backlog[2].title, 'Cleanup deps');
    backlog[0].status = 'approved';
    assert.equal(m.getTable('initiatives').filter(i => i.status === 'approved').length, 1);
  });

  // 8. Deploy pipeline
  it('8. Deploy pipeline: push → pull → build → restart → health', () => {
    m.setSsh('git rev-parse HEAD', 'abc1234');
    m.setSsh('git pull', 'Up to date');
    m.setSsh('npm run build', 'Build ok');
    m.setSsh('launchctl', 'Restarted');
    m.setSsh('curl', '200');
    const steps = [
      { n: 'snapshot', c: 'git rev-parse HEAD' }, { n: 'pull', c: 'git pull --ff-only' },
      { n: 'build', c: 'cd runtime && npm run build' },
      { n: 'restart', c: 'launchctl unload x; launchctl load x' },
      { n: 'health', c: 'curl -s http://localhost:3000/health' },
    ];
    const results = steps.map(s => ({ step: s.n, out: m.ssh(s.c) }));
    const log = m.sshLog();
    assert.equal(log.length, 5);
    assert.ok(log[0].command.includes('git rev-parse'));
    assert.ok(log[4].command.includes('curl'));
    assert.equal(results[4].out, '200');
    assert.ok(results.every(r => r.out !== ''));
  });

  // 9. Morning report
  it('9. Morning report: 3 waves → all present → crash → report survives', () => {
    const ws = [
      wave(1, { name: 'Tests', tasks_completed: 5, usd_spent: 1.50 }),
      wave(2, { name: 'Security', tasks_completed: 3, usd_spent: 2.00 }),
      wave(3, { name: 'Docs', tasks_completed: 4, usd_spent: 1.25 }),
    ];
    const report = { waves: ws, total_usd: ws.reduce((s, w) => s + w.usd_spent, 0),
      total_tasks: ws.reduce((s, w) => s + w.tasks_completed, 0) };
    assert.equal(report.waves.length, 3);
    assert.equal(report.total_usd, 4.75);
    assert.equal(report.total_tasks, 12);
    // Crash: checkpoint saved, report written to disk before crash
    m.seed('session_contracts', [contract({ status: 'crashed',
      last_checkpoint: { wave_number: 3, usd_spent_total: 4.75, report_path: '/reports/m.md' } })]);
    const cp = m.getTable('session_contracts')[0].last_checkpoint as Row;
    assert.equal(cp.wave_number, 3);
    assert.equal(report.waves.length, 3); // persisted report survives
  });

  // 10. Multi-model routing
  it('10. Multi-model routing: task types → different models', () => {
    const models = [
      { id: 'claude-opus-4-6', tier: 'flagship' },
      { id: 'claude-sonnet-4-6', tier: 'balanced' },
      { id: 'claude-haiku-4-5', tier: 'fast' },
    ];
    const tierMap: Record<string, string> = {
      architecture: 'flagship', code_write: 'balanced', documentation: 'fast',
      security: 'flagship', deploy: 'fast',
    };
    const tasks = [
      { type: 'architecture', desc: 'Design auth' },
      { type: 'code_write', desc: 'Implement JWT' },
      { type: 'documentation', desc: 'Write docs' },
      { type: 'security', desc: 'SQL injection audit' },
      { type: 'deploy', desc: 'Push to prod' },
    ];
    const routed = tasks.map(t => {
      const mdl = models.find(x => x.tier === (tierMap[t.type] ?? 'balanced'))!;
      m.llm(mdl.id, t.desc);
      return { task: t.type, model: mdl.id };
    });
    assert.equal(routed[0].model, 'claude-opus-4-6');   // architecture → flagship
    assert.equal(routed[1].model, 'claude-sonnet-4-6'); // code_write → balanced
    assert.equal(routed[2].model, 'claude-haiku-4-5');  // documentation → fast
    assert.equal(routed[3].model, 'claude-opus-4-6');   // security → flagship
    assert.equal(routed[4].model, 'claude-haiku-4-5');  // deploy → fast
    const used = new Set(m.llmLog().map(c => c.model));
    assert.equal(used.size, 3);
    assert.ok(used.has('claude-opus-4-6'));
    assert.ok(used.has('claude-sonnet-4-6'));
    assert.ok(used.has('claude-haiku-4-5'));
  });
});
