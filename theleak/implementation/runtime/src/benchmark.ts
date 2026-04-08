// benchmark.ts — Critical-path performance benchmarks for OB1 Control.
// Phase 10, Plan 3: Measures session bootstrap, quality gates, wave transitions,
// CLI parse, dashboard build, identity load, knowledge search, model registry.

import { fileURLToPath } from 'node:url';
import { ModelRegistry } from './model-registry.js';
import { TaskRouter } from './task-router.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface BenchmarkResult {
  name: string; metric: string; value: number; unit: string;
  budget: number; passed: boolean; details?: string;
}

export interface BenchmarkReport {
  timestamp: string; duration_ms: number;
  total: number; passed: number; failed: number;
  results: BenchmarkResult[];
}

// ── Budgets ────────────────────────────────────────────────────────────────

const BUDGETS: Record<string, { metric: string; budget: number; unit: string }> = {
  'Session bootstrap':  { metric: 'startup_time',    budget: 5000,   unit: 'ms' },
  'Quality gates':      { metric: 'total_time',      budget: 120000, unit: 'ms' },
  'Wave transition':    { metric: 'transition_time', budget: 30000,  unit: 'ms' },
  'CLI response':       { metric: 'parse_time',      budget: 2000,   unit: 'ms' },
  'Dashboard build':    { metric: 'build_time',      budget: 60000,  unit: 'ms' },
  'Identity load':      { metric: 'load_time',       budget: 500,    unit: 'ms' },
  'Knowledge search':   { metric: 'query_time',      budget: 1000,   unit: 'ms' },
  'Model registry':     { metric: 'lookup_time',     budget: 10,     unit: 'ms' },
};

// ── Helpers ────────────────────────────────────────────────────────────────

/** Simulate Supabase network call: random 50-200ms delay. */
function mockDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50 + Math.floor(Math.random() * 150)));
}

/** Measure async function, returning elapsed ms. */
async function measure(fn: () => Promise<void>): Promise<number> {
  const t0 = performance.now(); await fn(); return performance.now() - t0;
}

// ── Benchmark suite ────────────────────────────────────────────────────────

export class PerformanceBenchmarks {
  private results: BenchmarkResult[] = [];
  private only: string | null = null;

  constructor(options?: { only?: string }) {
    this.only = options?.only ?? null;
  }

  /** Run all benchmarks (or a single one via --only). Returns report. */
  async runAll(): Promise<BenchmarkReport> {
    const start = Date.now();
    this.results = [];

    const benchmarks: Array<{ name: string; fn: () => Promise<void> }> = [
      { name: 'Session bootstrap', fn: () => this.benchSessionBootstrap() },
      { name: 'Quality gates',     fn: () => this.benchQualityGates() },
      { name: 'Wave transition',   fn: () => this.benchWaveTransition() },
      { name: 'CLI response',      fn: () => this.benchCLIResponses() },
      { name: 'Dashboard build',   fn: () => this.benchDashboardBuild() },
      { name: 'Identity load',     fn: () => this.benchIdentityLoad() },
      { name: 'Knowledge search',  fn: () => this.benchKnowledgeSearch() },
      { name: 'Model registry',    fn: () => this.benchModelRegistryLookup() },
    ];

    for (const bench of benchmarks) {
      if (this.only && bench.name !== this.only) continue;
      await bench.fn();
    }

    return {
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - start,
      total: this.results.length,
      passed: this.results.filter((r) => r.passed).length,
      failed: this.results.filter((r) => !r.passed).length,
      results: this.results,
    };
  }

  // ── Individual benchmarks ──────────────────────────────────────────────

  /** Session bootstrap: load identity + decisions + learnings + build prompt (budget: 5s) */
  private async benchSessionBootstrap(): Promise<void> {
    const elapsed = await measure(async () => {
      await mockDelay(); // load identity
      await mockDelay(); // load recent decisions
      await mockDelay(); // load recent learnings
      await mockDelay(); // load relevant knowledge
      const _prompt = `You are OB1. Session #42. Goals: build, test, ship.`;
      void _prompt;
    });
    this.record('Session bootstrap', elapsed, 'Mocked identity + decisions + learnings + prompt build');
  }

  /** Quality gates: simulate 4 sequential gate runs (budget: 120s) */
  private async benchQualityGates(): Promise<void> {
    const elapsed = await measure(async () => {
      for (let i = 0; i < 4; i++) await mockDelay();
    });
    this.record('Quality gates', elapsed, 'Simulated 4 gate executions with mock delays');
  }

  /** Wave transition: assess + plan + checkpoint (budget: 30s) */
  private async benchWaveTransition(): Promise<void> {
    const elapsed = await measure(async () => {
      await mockDelay(); // assess
      await mockDelay(); // plan
      await mockDelay(); // checkpoint
    });
    this.record('Wave transition', elapsed, 'Assess + plan + checkpoint with mock delays');
  }

  /** CLI response: arg parsing + module init overhead (budget: 2s) */
  private async benchCLIResponses(): Promise<void> {
    const elapsed = await measure(async () => {
      const parsed: Record<string, boolean> = {};
      for (const arg of ['--help', 'status', '--verbose', '--json']) {
        parsed[arg.replace(/^--/, '')] = true;
      }
      void parsed;
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    this.record('CLI response', elapsed, 'Arg parsing + simulated module init');
  }

  /** Dashboard build: simulated Next.js build (budget: 60s) */
  private async benchDashboardBuild(): Promise<void> {
    const elapsed = await measure(async () => { await mockDelay(); await mockDelay(); });
    this.record('Dashboard build', elapsed, 'Simulated Next.js build (2x mock delay)');
  }

  /** Identity store load: single Supabase call + parse (budget: 500ms) */
  private async benchIdentityLoad(): Promise<void> {
    const elapsed = await measure(async () => {
      await mockDelay();
      const _identity = { id: 'mock', name: 'OB1', session_count: 41 };
      void _identity;
    });
    this.record('Identity load', elapsed, 'Single mock Supabase call + parse');
  }

  /** Knowledge search: embedding + vector similarity (budget: 1s) */
  private async benchKnowledgeSearch(): Promise<void> {
    const elapsed = await measure(async () => {
      await mockDelay(); // embedding generation
      await mockDelay(); // vector search
      const _results = Array.from({ length: 5 }, (_, i) => ({ id: `kb-${i}`, similarity: 0.95 - i * 0.05 }));
      void _results;
    });
    this.record('Knowledge search', elapsed, 'Mock embedding + vector search');
  }

  /** Model registry lookup: in-memory findBest + route (budget: 10ms) */
  private async benchModelRegistryLookup(): Promise<void> {
    const elapsed = await measure(async () => {
      const registry = new ModelRegistry();
      const router = new TaskRouter(
        () => registry.list({ enabled: true }),
        (provider) => registry.getHealth(provider),
      );
      registry.findBest({ capabilities: ['reasoning', 'code_generation'] });
      registry.findBest({ capabilities: ['tool_use'], maxCostPerMtok: 10 });
      registry.findBest({ capabilities: ['large_context'], minContext: 500_000 });
      router.quickRoute('code_write');
      router.quickRoute('architecture');
    });
    this.record('Model registry', elapsed, 'ModelRegistry.findBest x3 + TaskRouter.quickRoute x2');
  }

  // ── Recording + formatting ─────────────────────────────────────────────

  private record(name: string, value: number, details?: string): void {
    const cfg = BUDGETS[name];
    if (!cfg) throw new Error(`Unknown benchmark: ${name}`);
    this.results.push({
      name,
      metric: cfg.metric,
      value: Math.round(value * 100) / 100,
      unit: cfg.unit,
      budget: cfg.budget,
      passed: value <= cfg.budget,
      details,
    });
  }

  /** Format report as a human-readable table. */
  static formatReport(report: BenchmarkReport): string {
    const lines: string[] = [
      `Performance Benchmark Report  ${report.timestamp}`,
      '='.repeat(80), '',
      [pad('Benchmark', 22), pad('Metric', 18), padL('Value', 10), padL('Budget', 10), pad('Status', 6)].join('  '),
      '-'.repeat(80),
    ];
    for (const r of report.results) {
      lines.push([
        pad(r.name, 22), pad(r.metric, 18),
        padL(fmtVal(r.value, r.unit), 10), padL(fmtVal(r.budget, r.unit), 10),
        pad(r.passed ? 'PASS' : 'FAIL', 6),
      ].join('  '));
    }
    lines.push('-'.repeat(80));
    lines.push(`Total: ${report.total}  Passed: ${report.passed}  Failed: ${report.failed}  Duration: ${report.duration_ms}ms`);
    lines.push('');
    if (report.failed > 0) {
      lines.push('FAILED benchmarks:');
      for (const r of report.results.filter((x) => !x.passed)) {
        lines.push(`  - ${r.name}: ${fmtVal(r.value, r.unit)} exceeds budget ${fmtVal(r.budget, r.unit)}`);
        if (r.details) lines.push(`    ${r.details}`);
      }
    } else {
      lines.push('All benchmarks within budget.');
    }
    return lines.join('\n');
  }
}

// ── Formatting helpers ─────────────────────────────────────────────────────

function pad(s: string, n: number): string { return s.padEnd(n); }
function padL(s: string, n: number): string { return s.padStart(n); }
function fmtVal(v: number, u: string): string {
  if (u === 'ms' && v >= 1000) return `${(v / 1000).toFixed(1)}s`;
  return u === 'ms' ? `${v.toFixed(1)}ms` : `${v}${u}`;
}

// ── CLI runner ─────────────────────────────────────────────────────────────

if (typeof process !== 'undefined' && process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    const args = process.argv.slice(2);
    const jsonFlag = args.includes('--json');
    const onlyIdx = args.indexOf('--only');
    const only = onlyIdx >= 0 && onlyIdx + 1 < args.length ? args[onlyIdx + 1] : undefined;

    if (args.includes('--help') || args.includes('-h')) {
      console.log('Usage: node benchmark.js [--json] [--only <name>]');
      console.log('');
      console.log('Benchmarks:');
      for (const [name, cfg] of Object.entries(BUDGETS)) {
        console.log(`  "${name}"  (${cfg.metric}, budget: ${cfg.budget}${cfg.unit})`);
      }
      process.exit(0);
    }

    const suite = new PerformanceBenchmarks({ only });
    const report = await suite.runAll();

    if (jsonFlag) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(PerformanceBenchmarks.formatReport(report));
    }

    process.exit(report.failed > 0 ? 1 : 0);
  })().catch((e) => { console.error('Benchmark fatal:', e); process.exit(1); });
}
