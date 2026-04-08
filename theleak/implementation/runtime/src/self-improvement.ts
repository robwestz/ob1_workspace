// =============================================================================
// OB1 Agentic Runtime -- Self-Improvement Loop
// =============================================================================
// Phase 9: The SysAdmin improves the system it runs on.
// Plan 1: Tooling Self-Assessment  |  Plan 2: Maturity Detection
// Plan 3: Automated GC Sweeps      |  Plan 4: Learning Accumulation
// =============================================================================

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const run = promisify(exec);
const shell = (cmd: string, cwd: string, ms = 15_000) =>
  run(cmd + ' 2>/dev/null', { cwd, timeout: ms, maxBuffer: 5 * 1024 * 1024 })
    .then(r => r.stdout.trim()).catch(() => '');

// -- Types ------------------------------------------------------------------

export type MaturityLevel = 'bootstrap' | 'developing' | 'stable' | 'hardened';

export interface FrictionPoint {
  area: string; description: string; severity: 'low' | 'medium' | 'high';
  occurrences: number; first_seen: string; proposed_fix?: string;
}

export interface GCResult {
  category: string; items_found: number; items_removed: number; details: string[];
}

export interface LearningEntry {
  pattern: string; domain: string; project: string;
  outcome: 'success' | 'failure' | 'mixed';
  technique: string; context: string; reusable: boolean;
}

export interface MaturityAssessment {
  project: string; current_level: MaturityLevel;
  scores: { test_coverage: number; error_rate: number; code_churn: number; doc_freshness: number; security_score: number };
  recommended_level: MaturityLevel; upgrade_actions: string[];
}

interface WaveInput { findings: string[]; duration_ms: number; fix_attempts: number }
interface LearningWaveInput { name: string; findings: string[]; all_gates_passed: boolean; tasks_completed: number; tasks_failed: number }

// -- Pattern tables ---------------------------------------------------------

const FRICTION: Array<{ test: (f: string, w: WaveInput) => boolean; area: string; desc: string; sev: FrictionPoint['severity']; fix: string }> = [
  { test: f => /timeout|timed?\s*out/i.test(f), area: 'cli', desc: 'Command timed out', sev: 'high', fix: 'Increase timeout or optimize command' },
  { test: (_f, w) => w.fix_attempts > 2, area: 'testing', desc: 'Flaky quality gate', sev: 'high', fix: 'Stabilize test or add retry logic' },
  { test: f => /not found|command not found|missing/i.test(f), area: 'cli', desc: 'Missing tool', sev: 'medium', fix: 'Install dependency or update setup script' },
  { test: f => /manually|manual step|by hand/i.test(f), area: 'deploy', desc: 'Manual step needs automation', sev: 'medium', fix: 'Create automation script' },
  { test: f => /slow|long time|performance/i.test(f), area: 'monitoring', desc: 'Slow operation', sev: 'low', fix: 'Profile and optimize' },
  { test: f => /confus|unclear|ambiguous/i.test(f), area: 'cli', desc: 'Confusing output', sev: 'low', fix: 'Improve error messages' },
  { test: (_f, w) => w.duration_ms > 300_000, area: 'monitoring', desc: 'Wave >5 min', sev: 'medium', fix: 'Parallelize or split' },
];

const LETTER: Record<string, number> = { A: 1.0, B: 0.75, C: 0.5, D: 0.25, F: 0 };
const SEV_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

const classify = (text: string, table: Array<[RegExp, string]>): string => {
  for (const [re, label] of table) if (re.test(text)) return label;
  return 'general';
};

const TECHNIQUE_TABLE: Array<[RegExp, string]> = [
  [/test|spec|coverage|assert/, 'testing'], [/refactor|extract|split|simplif/, 'refactoring'],
  [/deploy|release|ship/, 'deployment'], [/config|setup|init/, 'configuration'],
  [/fix|bug|error|patch/, 'debugging'], [/doc|readme|comment/, 'documentation'],
  [/perf|optim|fast|cache/, 'optimization'],
];

const DOMAIN_TABLE: Array<[RegExp, string]> = [
  [/api|endpoint|route|rest/, 'api'], [/ui|component|render|css|style/, 'frontend'],
  [/database|sql|query|migration/, 'database'], [/ci|cd|pipeline|deploy|build/, 'devops'],
  [/auth|token|permission|security/, 'security'], [/test|spec|coverage/, 'testing'],
];

// -- Engine -----------------------------------------------------------------

export class SelfImprovement {

  // ---- Plan 1: Tooling Self-Assessment ------------------------------------

  assessToolingFriction(waveResults: WaveInput[]): FrictionPoint[] {
    const map = new Map<string, FrictionPoint>();
    const now = new Date().toISOString();
    for (const wave of waveResults) {
      for (const finding of wave.findings) {
        for (const p of FRICTION) {
          if (!p.test(finding, wave)) continue;
          const key = `${p.area}::${p.desc}`;
          const ex = map.get(key);
          if (ex) ex.occurrences++;
          else map.set(key, { area: p.area, description: p.desc, severity: p.sev, occurrences: 1, first_seen: now, proposed_fix: p.fix });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.occurrences - a.occurrences);
  }

  proposeFixes(fps: FrictionPoint[]): Array<{ friction: FrictionPoint; proposal: string; estimated_effort_hours: number; priority: number }> {
    const effort: Record<string, number> = { cli: 2, testing: 4, deploy: 3, monitoring: 2 };
    return fps.map((fp, i) => ({
      friction: fp, proposal: fp.proposed_fix ?? `Investigate: ${fp.description}`,
      estimated_effort_hours: effort[fp.area] ?? 2, priority: fps.length - i,
    }));
  }

  // ---- Plan 2: Maturity Detection + Quality Auto-Update -------------------

  async assessMaturity(projectPath: string): Promise<MaturityAssessment> {
    const [tc, er, cc, df, ss] = await Promise.all([
      this.testCoverage(projectPath), this.errorRate(projectPath),
      this.codeChurn(projectPath), this.docFreshness(projectPath), this.securityScore(projectPath),
    ]);
    const scores = { test_coverage: tc, error_rate: er, code_churn: cc, doc_freshness: df, security_score: ss };
    const composite = tc * 0.3 + (1 - er) * 0.2 + (1 - cc) * 0.15 + df * 0.15 + ss * 0.2;
    const rec: MaturityLevel = composite >= 0.9 ? 'hardened' : composite >= 0.75 ? 'stable' : composite >= 0.5 ? 'developing' : 'bootstrap';
    const order: MaturityLevel[] = ['bootstrap', 'developing', 'stable', 'hardened'];
    const cur = order[Math.max(0, order.indexOf(rec) - 1)];
    const profile = this.getQualityProfile(rec);
    const actions: string[] = [];
    if (tc < profile.min_test_coverage) actions.push(`Increase test coverage from ${(tc * 100).toFixed(0)}% to ${(profile.min_test_coverage * 100).toFixed(0)}%`);
    if (er > 0.3) actions.push(`Reduce error-fix ratio from ${(er * 100).toFixed(0)}% to <30%`);
    if (df < 0.5) actions.push('Update documentation: key docs are stale (>30 days)');
    if (ss < 0.75) actions.push(`Improve security score from ${ss.toFixed(2)} to >=0.75`);
    if (actions.length === 0 && cur !== rec) actions.push(`Maintain metrics to confirm ${rec} level`);
    return { project: projectPath, current_level: cur, scores, recommended_level: rec, upgrade_actions: actions };
  }

  getQualityProfile(level: MaturityLevel): { min_test_coverage: number; max_file_lines: number; required_gates: string[]; optional_gates: string[] } {
    const profiles: Record<MaturityLevel, ReturnType<SelfImprovement['getQualityProfile']>> = {
      bootstrap:  { min_test_coverage: 0.5,  max_file_lines: 800, required_gates: ['tsc'], optional_gates: ['tests', 'lint'] },
      developing: { min_test_coverage: 0.7,  max_file_lines: 600, required_gates: ['tsc', 'tests'], optional_gates: ['lint', 'build'] },
      stable:     { min_test_coverage: 0.85, max_file_lines: 500, required_gates: ['tsc', 'tests', 'lint', 'build'], optional_gates: ['security-audit'] },
      hardened:   { min_test_coverage: 0.95, max_file_lines: 400, required_gates: ['tsc', 'tests', 'lint', 'build', 'security-audit'], optional_gates: [] },
    };
    return profiles[level];
  }

  // ---- Plan 3: Automated GC Sweeps ---------------------------------------

  async gcScan(projectPath: string): Promise<GCResult[]> {
    return Promise.all([this.scanDeadExports(projectPath), this.scanStaleBranches(projectPath), this.scanUnusedDeps(projectPath), this.scanOrphanedFiles(projectPath)]);
  }

  formatGCReport(results: GCResult[]): string {
    const lines = ['## GC Sweep Results', ''];
    let found = 0, removed = 0;
    for (const r of results) {
      found += r.items_found; removed += r.items_removed;
      lines.push(`### ${r.category} -- ${r.items_found === 0 ? 'Clean' : `${r.items_found} found`}`);
      for (const d of r.details.slice(0, 10)) lines.push(`- ${d}`);
      if (r.details.length > 10) lines.push(`- ... and ${r.details.length - 10} more`);
      lines.push('');
    }
    lines.push(`**Total:** ${found} found, ${removed} removed`);
    return lines.join('\n');
  }

  // ---- Plan 4: Learning Accumulation -------------------------------------

  extractLearnings(waveResults: LearningWaveInput[], project: string): LearningEntry[] {
    const entries: LearningEntry[] = [];
    for (const wave of waveResults) {
      const outcome: LearningEntry['outcome'] = wave.tasks_failed === 0 && wave.all_gates_passed ? 'success' : wave.tasks_failed > wave.tasks_completed ? 'failure' : 'mixed';
      for (const finding of wave.findings) {
        const lo = finding.toLowerCase();
        entries.push({
          pattern: finding.slice(0, 200), domain: classify(lo, DOMAIN_TABLE), project, outcome,
          technique: classify(lo, TECHNIQUE_TABLE),
          context: `Wave "${wave.name}": ${wave.tasks_completed} done, ${wave.tasks_failed} failed`,
          reusable: !/specific|one-off|workaround/.test(lo),
        });
      }
    }
    return entries;
  }

  async storeLearnings(learnings: LearningEntry[], kbUrl: string, key: string): Promise<number> {
    let stored = 0;
    for (const l of learnings) {
      try {
        const res = await fetch(`${kbUrl}/rest/v1/knowledge_base`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key, Prefer: 'return=minimal' },
          body: JSON.stringify({
            category: 'learning', title: `[${l.outcome}] ${l.pattern.slice(0, 80)}`,
            content: JSON.stringify(l), tags: [l.domain, l.project, l.technique, l.outcome],
            relevance_score: l.reusable ? 0.8 : 0.4, source: `self-improvement:${l.project}`,
          }),
        });
        if (res.ok) stored++;
      } catch { /* non-critical */ }
    }
    return stored;
  }

  async getRelevantLearnings(topic: string, project: string, kbUrl: string, key: string): Promise<LearningEntry[]> {
    try {
      const qs = `category=eq.learning&tags=cs.{${project}}&order=relevance_score.desc&limit=20&select=*`;
      const res = await fetch(`${kbUrl}/rest/v1/knowledge_base?${qs}`, {
        headers: { Authorization: `Bearer ${key}`, apikey: key },
      });
      if (!res.ok) return [];
      const rows = (await res.json()) as Array<{ content: string }>;
      const tl = topic.toLowerCase();
      return rows.flatMap(row => {
        try {
          const e = JSON.parse(row.content) as LearningEntry;
          return (e.domain.includes(tl) || e.pattern.toLowerCase().includes(tl) || e.technique.includes(tl)) ? [e] : [];
        } catch { return []; }
      });
    } catch { return []; }
  }

  // ---- Private: maturity helpers ------------------------------------------

  private async testCoverage(dir: string): Promise<number> {
    try {
      const src = await this.countFiles(dir, /\.(ts|js|tsx|jsx)$/, /\.(test|spec)\./);
      const tst = await this.countFiles(dir, /\.(test|spec)\.(ts|js|tsx|jsx)$/);
      return src === 0 ? 0 : Math.min(1, tst / src);
    } catch { return 0; }
  }

  private async errorRate(dir: string): Promise<number> {
    const out = await shell('git log --oneline --since="30 days ago"', dir);
    const lines = out.split('\n').filter(Boolean);
    if (lines.length === 0) return 0;
    return Math.min(1, lines.filter(l => /\bfix\b|\bbug\b|\berror\b|\bhotfix\b/i.test(l)).length / lines.length);
  }

  private async codeChurn(dir: string): Promise<number> {
    const total = parseInt(await shell('git ls-files -- "*.ts" "*.js" "*.tsx" "*.jsx" | wc -l', dir), 10) || 1;
    const changed = parseInt(await shell('git log --since="30 days ago" --name-only --pretty=format: -- "*.ts" "*.js" "*.tsx" "*.jsx" | sort -u | wc -l', dir), 10) || 0;
    return Math.min(1, changed / total);
  }

  private async docFreshness(dir: string): Promise<number> {
    const docs = ['AGENTS.md', 'README.md', 'CLAUDE.md', 'CONTRIBUTING.md'];
    const cutoff = Date.now() - 30 * 86_400_000;
    let found = 0, fresh = 0;
    for (const name of docs) {
      try { const s = await stat(join(dir, name)); found++; if (s.mtimeMs > cutoff) fresh++; } catch { /* missing */ }
    }
    return found === 0 ? 0 : fresh / found;
  }

  private async securityScore(dir: string): Promise<number> {
    try {
      const content = await readFile(join(dir, '.harness', 'quality.yml'), 'utf-8');
      const m = content.match(/security:\s*([A-F])/i);
      return m ? (LETTER[m[1].toUpperCase()] ?? 0.5) : 0.5;
    } catch { return 0.5; }
  }

  // ---- Private: GC scanners ----------------------------------------------

  private async scanDeadExports(dir: string): Promise<GCResult> {
    const details: string[] = [];
    const exports = await shell('grep -rn "^export " --include="*.ts" --include="*.tsx" . | head -200', dir, 30_000);
    for (const line of exports.split('\n').filter(Boolean)) {
      const m = line.match(/export\s+(?:function|class|const|let|type|interface|enum)\s+(\w+)/);
      if (!m) continue;
      const count = parseInt(await shell(`grep -rn "\\b${m[1]}\\b" --include="*.ts" --include="*.tsx" . | wc -l`, dir, 10_000), 10);
      if (count <= 1) details.push(`Unused export: ${m[1]} in ${line.split(':')[0]}`);
    }
    return { category: 'dead_code', items_found: details.length, items_removed: 0, details };
  }

  private async scanStaleBranches(dir: string): Promise<GCResult> {
    const details: string[] = [];
    const out = await shell('git for-each-ref --sort=committerdate --format="%(refname:short) %(committerdate:relative)" refs/heads/', dir);
    for (const line of out.split('\n').filter(Boolean)) {
      if (/\b(?:month|year)s?\s+ago\b/.test(line) && !/^(main|master)\b/.test(line))
        details.push(`Stale branch: ${line.trim()}`);
    }
    return { category: 'stale_branches', items_found: details.length, items_removed: 0, details };
  }

  private async scanUnusedDeps(dir: string): Promise<GCResult> {
    const details: string[] = [];
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf-8')) as { dependencies?: Record<string, string> };
      for (const dep of Object.keys(pkg.dependencies ?? {})) {
        const n = parseInt(await shell(`grep -rn "${dep}" --include="*.ts" --include="*.tsx" --include="*.js" . | grep -v node_modules | grep -v package.json | wc -l`, dir, 10_000), 10);
        if (n === 0) details.push(`Unused dependency: ${dep}`);
      }
    } catch { /* no package.json */ }
    return { category: 'unused_deps', items_found: details.length, items_removed: 0, details };
  }

  private async scanOrphanedFiles(dir: string): Promise<GCResult> {
    const details: string[] = [];
    const files = await shell('git ls-files -- "*.ts" "*.tsx" "*.js" "*.jsx" | head -200', dir);
    for (const file of files.split('\n').filter(Boolean)) {
      const base = file.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
      if (!base || base === 'index' || /\.(test|spec)$/.test(base)) continue;
      const refs = parseInt(await shell(`grep -rn "${base}" --include="*.ts" --include="*.tsx" --include="*.js" . | grep -v "^./${file}" | wc -l`, dir, 10_000), 10);
      if (refs === 0) details.push(`Orphaned file: ${file}`);
    }
    return { category: 'orphaned_files', items_found: details.length, items_removed: 0, details };
  }

  // ---- Private: file counting utility -------------------------------------

  private async countFiles(dir: string, match: RegExp, exclude?: RegExp): Promise<number> {
    let count = 0;
    try {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (/^(node_modules|dist|\.git)$/.test(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) count += await this.countFiles(full, match, exclude);
        else if (match.test(entry.name) && (!exclude || !exclude.test(entry.name))) count++;
      }
    } catch { /* unreadable */ }
    return count;
  }
}
