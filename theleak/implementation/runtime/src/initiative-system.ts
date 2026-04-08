// =============================================================================
// OB1 Agentic Runtime -- Initiative System (Phase 8, all 4 plans)
// =============================================================================
// Opportunity Discovery, Propose-Test-Report, Backlog Management, Metrics.
// Uses Supabase REST API directly (no SDK dependency).
// =============================================================================

import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';

// -- Types -------------------------------------------------------------------

export interface Opportunity {
  title: string; description: string; category: string;
  project?: string; file_paths?: string[];
  impact: 'low' | 'medium' | 'high' | 'critical';
  effort_hours?: number;
  risk: 'safe' | 'low_risk' | 'medium_risk' | 'risky';
  discovery_source: string;
}

export interface Proposal {
  initiative_id: string; proposal: string;
  expected_outcome: string; risk_assessment: string; test_plan: string;
}

export interface InitiativeMetrics {
  total_discovered: number; total_proposed: number;
  total_approved: number; total_completed: number; total_rejected: number;
  acceptance_rate: number; completion_rate: number;
  avg_time_to_completion_hours: number;
  by_category: Record<string, number>; by_impact: Record<string, number>;
}

interface InitiativeRow {
  id: string; identity_id: string | null; title: string; description: string;
  category: string; project: string | null; file_paths: string[];
  impact: string; effort_hours: number | null; risk: string;
  priority_score: number; status: string;
  proposal: string | null; expected_outcome: string | null;
  risk_assessment: string | null; test_branch: string | null;
  test_results: Record<string, unknown> | null;
  reviewed_by: string | null; review_notes: string | null; reviewed_at: string | null;
  executed_in_session: string | null;
  execution_results: Record<string, unknown> | null;
  value_delivered: string | null; discovered_by: string;
  discovered_in_session: string | null; discovery_source: string | null;
  created_at: string; updated_at: string;
}

// -- Supabase REST helper (same pattern as identity-store.ts) ----------------

class SupabaseRest {
  private readonly url: string;
  constructor(url: string, private readonly key: string) {
    this.url = url.replace(/\/+$/, '');
  }
  private hdrs(extra?: Record<string, string>): Record<string, string> {
    return { 'Content-Type': 'application/json', apikey: this.key,
      Authorization: `Bearer ${this.key}`, Prefer: 'return=representation', ...extra };
  }
  private async check(res: Response, label: string): Promise<void> {
    if (!res.ok) throw new Error(`Supabase ${label} failed (${res.status}): ${await res.text()}`);
  }
  async query<T>(table: string, qs: string): Promise<T[]> {
    const res = await fetch(`${this.url}/rest/v1/${table}?${qs}`, { headers: this.hdrs() });
    await this.check(res, `query ${table}`);
    return res.json() as Promise<T[]>;
  }
  async insert<T>(table: string, row: Record<string, unknown>): Promise<T[]> {
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method: 'POST', headers: this.hdrs(), body: JSON.stringify(row) });
    await this.check(res, `insert ${table}`);
    return res.json() as Promise<T[]>;
  }
  async update<T>(table: string, qs: string, data: Record<string, unknown>): Promise<T[]> {
    const res = await fetch(`${this.url}/rest/v1/${table}?${qs}`, {
      method: 'PATCH', headers: this.hdrs(), body: JSON.stringify(data) });
    await this.check(res, `update ${table}`);
    return res.json() as Promise<T[]>;
  }
  async single<T>(table: string, qs: string): Promise<T | null> {
    const res = await fetch(`${this.url}/rest/v1/${table}?${qs}`, {
      headers: this.hdrs({ Accept: 'application/vnd.pgrst.object+json' }) });
    if (res.status === 406 || res.status === 404) return null;
    await this.check(res, `single ${table}`);
    return res.json() as Promise<T>;
  }
}

// -- Shell helper ------------------------------------------------------------

function shell(cmd: string, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, timeout: 30_000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) { reject(new Error(`${cmd}: ${stderr || err.message}`)); return; }
      resolve(stdout.trim());
    });
  });
}

// -- Priority scoring constants ----------------------------------------------

const IMPACT_W: Record<string, number> = { critical: 1.0, high: 0.8, medium: 0.5, low: 0.25 };
const RISK_W: Record<string, number> = { safe: 1.0, low_risk: 0.85, medium_risk: 0.6, risky: 0.3 };
const CAT_BOOST: Record<string, number> = {
  security: 0.15, test_gap: 0.10, performance: 0.05, dead_code: 0, dependency: 0,
  documentation: -0.05, refactor: 0, feature: 0,
};

// -- InitiativeSystem --------------------------------------------------------

const TABLE = 'agent_initiatives';

export class InitiativeSystem {
  private readonly db: SupabaseRest;
  constructor(supabaseUrl: string, accessKey: string) {
    this.db = new SupabaseRest(supabaseUrl, accessKey);
  }

  /** impact * riskMultiplier * effortMultiplier + categoryBoost, clamped 0-1 */
  static calculatePriority(opp: Opportunity): number {
    const i = IMPACT_W[opp.impact] ?? 0.5;
    const r = RISK_W[opp.risk] ?? 0.6;
    const e = opp.effort_hours ? Math.min(1, 1 / opp.effort_hours) : 0.5;
    return Math.max(0, Math.min(1, i * r * e + (CAT_BOOST[opp.category] ?? 0)));
  }

  // ── Opportunity Discovery ────────────────────────────────────────────────

  /** Scan for source files that lack corresponding test files. */
  async scanTestGaps(projectPath: string): Promise<Opportunity[]> {
    const opps: Opportunity[] = [];
    try {
      const testFiles = await shell(
        'find . -type f \\( -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.spec.ts" -o -name "*.spec.tsx" \\)', projectPath);
      const testSet = new Set(testFiles.split('\n').filter(Boolean).map(
        f => f.replace(/\.(test|spec)\.(ts|tsx)$/, '').replace(/^\.\//, '')));
      const srcFiles = await shell(
        'find . -type f \\( -name "*.ts" -o -name "*.tsx" \\) -not -name "*.test.*" -not -name "*.spec.*" -not -name "*.d.ts" -not -path "*/node_modules/*" -not -path "*/dist/*"', projectPath);
      for (const f of srcFiles.split('\n').filter(Boolean)) {
        const base = f.replace(/\.(ts|tsx)$/, '').replace(/^\.\//, '');
        if (!testSet.has(base)) {
          opps.push({ title: `Missing tests: ${base}`, description: `Source file ${f} has no corresponding test file.`,
            category: 'test_gap', impact: 'medium', risk: 'safe', effort_hours: 1,
            file_paths: [f], discovery_source: 'scanner' });
        }
      }
    } catch { /* scanner failure is non-fatal */ }
    return opps;
  }

  /** Scan for exported symbols never imported elsewhere. */
  async scanDeadCode(projectPath: string): Promise<Opportunity[]> {
    const opps: Opportunity[] = [];
    try {
      const exportLines = await shell('grep -rn "export " --include="*.ts" --include="*.tsx" .', projectPath);
      const allSrc = await shell(
        'find . -type f \\( -name "*.ts" -o -name "*.tsx" \\) -not -path "*/node_modules/*" -not -path "*/dist/*"', projectPath);
      const corpus = (await Promise.all(
        allSrc.split('\n').filter(Boolean).slice(0, 200).map(async f => {
          try { return await readFile(`${projectPath}/${f.replace(/^\.\//, '')}`, 'utf-8'); }
          catch { return ''; }
        }))).join('\n');
      const seen = new Set<string>();
      for (const line of exportLines.split('\n').filter(Boolean)) {
        const m = /export\s+(?:const|function|class|type|interface|enum)\s+(\w+)/.exec(line);
        if (!m) continue;
        const name = m[1];
        if (seen.has(name)) continue;
        seen.add(name);
        const count = (corpus.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;
        if (count <= 1) {
          opps.push({ title: `Unused export: ${name}`,
            description: `"${name}" exported in ${line.split(':')[0]} but never imported.`,
            category: 'dead_code', impact: 'low', risk: 'safe', effort_hours: 0.5,
            file_paths: [line.split(':')[0]], discovery_source: 'scanner' });
        }
      }
    } catch { /* scanner failure is non-fatal */ }
    return opps;
  }

  /** Scan for package.json deps never imported in src/. */
  async scanDependencies(projectPath: string): Promise<Opportunity[]> {
    const opps: Opportunity[] = [];
    try {
      const pkg = JSON.parse(await readFile(`${projectPath}/package.json`, 'utf-8')) as
        { dependencies?: Record<string, string> };
      const src = await shell(
        'find . -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" \\) -not -path "*/node_modules/*" -not -path "*/dist/*" | head -300 | xargs cat 2>/dev/null', projectPath);
      for (const dep of Object.keys(pkg.dependencies ?? {})) {
        if (!src.includes(dep)) {
          opps.push({ title: `Unused dependency: ${dep}`,
            description: `Package "${dep}" is in dependencies but no import found.`,
            category: 'dependency', impact: 'low', risk: 'safe',
            effort_hours: 0.25, discovery_source: 'scanner' });
        }
      }
    } catch { /* scanner failure is non-fatal */ }
    return opps;
  }

  /** Scan for banned security patterns. */
  async scanSecurity(projectPath: string): Promise<Opportunity[]> {
    const opps: Opportunity[] = [];
    const rules: Array<{ pattern: string; label: string; impact: Opportunity['impact'] }> = [
      { pattern: 'eval\\(', label: 'eval() usage', impact: 'high' },
      { pattern: 'process\\.env\\.[A-Z_]+.*=', label: 'env var assignment', impact: 'medium' },
      { pattern: '(password|secret|api_key|apikey)\\s*=\\s*["\'][^"\']+["\']', label: 'hardcoded secret', impact: 'critical' },
      { pattern: 'innerHTML\\s*=', label: 'innerHTML assignment (XSS risk)', impact: 'high' },
    ];
    for (const rule of rules) {
      try {
        const hits = await shell(
          `grep -rn "${rule.pattern}" --include="*.ts" --include="*.tsx" --include="*.js" . | grep -v node_modules | grep -v dist | head -10`, projectPath);
        if (!hits) continue;
        for (const hit of hits.split('\n').filter(Boolean)) {
          opps.push({ title: `Security: ${rule.label}`,
            description: `Found ${rule.label} in ${hit.split(':')[0]}: ${hit.slice(0, 120)}`,
            category: 'security', impact: rule.impact, risk: 'low_risk',
            effort_hours: 1, file_paths: [hit.split(':')[0]], discovery_source: 'scanner' });
        }
      } catch { /* grep no-match exits non-zero */ }
    }
    return opps;
  }

  /** Run all scanners in parallel. */
  async discoverAll(projectPath: string): Promise<Opportunity[]> {
    const results = await Promise.all([
      this.scanTestGaps(projectPath), this.scanDeadCode(projectPath),
      this.scanDependencies(projectPath), this.scanSecurity(projectPath),
    ]);
    return results.flat();
  }

  /** Score and store discovered opportunities. Returns inserted IDs. */
  async storeOpportunities(opps: Opportunity[], identityName: string, sessionId?: string): Promise<string[]> {
    const identity = await this.db.single<{ id: string }>('agent_identities', `name=eq.${identityName}&select=id`);
    const identityId = identity?.id ?? null;
    const ids: string[] = [];
    for (const opp of opps) {
      const rows = await this.db.insert<{ id: string }>(TABLE, {
        identity_id: identityId, title: opp.title, description: opp.description,
        category: opp.category, project: opp.project ?? null,
        file_paths: opp.file_paths ?? [], impact: opp.impact,
        effort_hours: opp.effort_hours ?? null, risk: opp.risk,
        priority_score: InitiativeSystem.calculatePriority(opp),
        status: 'discovered', discovered_by: identityName,
        discovered_in_session: sessionId ?? null, discovery_source: opp.discovery_source,
      });
      ids.push(rows[0].id);
    }
    return ids;
  }

  // ── Propose-Test-Report ──────────────────────────────────────────────────

  /** Attach a proposal to a discovered initiative. */
  async propose(initiativeId: string, proposal: Proposal): Promise<void> {
    await this.db.update(TABLE, `id=eq.${initiativeId}`, {
      status: 'proposed', proposal: proposal.proposal,
      expected_outcome: proposal.expected_outcome, risk_assessment: proposal.risk_assessment,
    });
  }

  /** Record test results from an isolated branch test. */
  async recordTestResults(id: string, results: { passed: boolean; details: string; branch: string }): Promise<void> {
    await this.db.update(TABLE, `id=eq.${id}`, {
      test_branch: results.branch,
      test_results: { passed: results.passed, details: results.details },
    });
  }

  // ── Backlog Management ───────────────────────────────────────────────────

  /** List backlog items with optional filters. */
  async listBacklog(filter?: { status?: string; project?: string; category?: string; limit?: number }): Promise<InitiativeRow[]> {
    const p = ['select=*', 'order=priority_score.desc,created_at.desc'];
    if (filter?.status) p.push(`status=eq.${filter.status}`);
    if (filter?.project) p.push(`project=eq.${filter.project}`);
    if (filter?.category) p.push(`category=eq.${filter.category}`);
    p.push(`limit=${filter?.limit ?? 50}`);
    return this.db.query<InitiativeRow>(TABLE, p.join('&'));
  }

  /** Approve, reject, or defer an initiative. */
  async review(id: string, decision: 'approved' | 'rejected' | 'deferred', notes?: string): Promise<void> {
    await this.db.update(TABLE, `id=eq.${id}`, {
      status: decision, reviewed_by: 'robin',
      review_notes: notes ?? null, reviewed_at: new Date().toISOString(),
    });
  }

  /** Get approved items for session planning, ordered by priority. */
  async getApprovedForSession(limit = 10): Promise<InitiativeRow[]> {
    return this.db.query<InitiativeRow>(TABLE, `status=eq.approved&order=priority_score.desc&limit=${limit}&select=*`);
  }

  /** Mark initiative as executing in a specific session. */
  async markExecuting(id: string, sessionId: string): Promise<void> {
    await this.db.update(TABLE, `id=eq.${id}`, { status: 'executing', executed_in_session: sessionId });
  }

  /** Mark initiative as completed with results. */
  async markCompleted(id: string, results: Record<string, unknown>, valueDelivered?: string): Promise<void> {
    await this.db.update(TABLE, `id=eq.${id}`, {
      status: 'completed', execution_results: results, value_delivered: valueDelivered ?? null,
    });
  }

  // ── Metrics ──────────────────────────────────────────────────────────────

  /** Compute initiative metrics, optionally filtered by identity. */
  async getMetrics(identityName?: string): Promise<InitiativeMetrics> {
    const f = identityName ? `discovered_by=eq.${identityName}&` : '';
    const all = await this.db.query<InitiativeRow>(TABLE, `${f}select=*&limit=5000`);
    const byStatus: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const byImpact: Record<string, number> = {};
    let timeSum = 0, timeCount = 0;
    for (const row of all) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
      byImpact[row.impact] = (byImpact[row.impact] ?? 0) + 1;
      if (row.status === 'completed' || row.status === 'verified') {
        const dt = new Date(row.updated_at).getTime() - new Date(row.created_at).getTime();
        if (dt > 0) { timeSum += dt / 3_600_000; timeCount++; }
      }
    }
    const approved = (byStatus['approved'] ?? 0) + (byStatus['completed'] ?? 0) + (byStatus['verified'] ?? 0);
    const completed = (byStatus['completed'] ?? 0) + (byStatus['verified'] ?? 0);
    const rejected = byStatus['rejected'] ?? 0;
    const reviewed = approved + rejected;
    return {
      total_discovered: all.length, total_proposed: all.length - (byStatus['discovered'] ?? 0),
      total_approved: approved, total_completed: completed, total_rejected: rejected,
      acceptance_rate: reviewed > 0 ? approved / reviewed : 0,
      completion_rate: approved > 0 ? completed / approved : 0,
      avg_time_to_completion_hours: timeCount > 0 ? timeSum / timeCount : 0,
      by_category: byCategory, by_impact: byImpact,
    };
  }
}
