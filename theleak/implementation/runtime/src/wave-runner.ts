// wave-runner.ts — Long Session Protocol: PLAN-EXECUTE-VERIFY-FIX-COMMIT-ASSESS
// WaveRunner COMPOSES NightRunner for task execution within each wave.

import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NightRunner } from './night-runner.js';
import type { NightTask, NightRunnerConfig, TaskResult } from './night-runner.js';

// -- Types ------------------------------------------------------------------

export interface SessionContract {
  name: string;
  duration_hours: number;
  budget_usd: number;
  goals: { primary: string; secondary?: string[]; stretch?: string[] };
  boundaries: { autonomous: string[]; requires_approval: string[] };
  quality_gates: QualityGateConfig[];
  git_checkpoint: boolean;
  report_path: string;
}

export interface QualityGateConfig {
  name: string;
  command: string;
  success_pattern?: string;
  failure_pattern?: string;
  timeout_ms?: number;
  required: boolean;
}

export interface WaveDefinition {
  id: number;
  name: string;
  description: string;
  tasks: WaveTask[];
  estimated_value: 'high' | 'medium' | 'low';
}

export interface WaveTask {
  id: string;
  title: string;
  description: string;
  agent_type?: string;
  max_usd?: number;
  max_turns?: number;
  verify_command?: string;
}

export interface WaveResult {
  wave_id: number;
  wave_name: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  tasks_completed: number;
  tasks_failed: number;
  usd_spent: number;
  quality_gate_results: QualityGateResult[];
  all_gates_passed: boolean;
  fix_attempts: number;
  committed: boolean;
  commit_sha?: string;
  findings: string[];
  next_wave_suggestions: string[];
}

export interface QualityGateResult {
  name: string;
  passed: boolean;
  output: string;
  duration_ms: number;
}

export interface WaveRunReport {
  session_name: string;
  started_at: string;
  completed_at: string;
  duration_minutes: number;
  total_waves: number;
  waves_completed: number;
  total_usd_spent: number;
  budget_remaining_usd: number;
  stop_reason: string;
  wave_results: WaveResult[];
  goals_status: {
    primary: { goal: string; status: 'achieved' | 'partial' | 'not_started' };
    secondary: Array<{ goal: string; status: string }>;
  };
}

// -- Default quality gates --------------------------------------------------

const DEFAULT_GATES: QualityGateConfig[] = [
  { name: 'typescript-runtime', command: 'cd theleak/implementation/runtime && npx tsc --noEmit', failure_pattern: 'error TS', timeout_ms: 120_000, required: true },
  { name: 'typescript-dashboard', command: 'cd theleak/implementation/gui && npx tsc --noEmit', failure_pattern: 'error TS', timeout_ms: 120_000, required: true },
  { name: 'tests-runtime', command: 'cd theleak/implementation/runtime && npm test', failure_pattern: 'fail [1-9]', success_pattern: 'fail 0', timeout_ms: 120_000, required: true },
  { name: 'tests-dashboard', command: 'cd theleak/implementation/gui && npx vitest run', success_pattern: 'Tests.*passed', failure_pattern: 'Tests.*failed', timeout_ms: 120_000, required: true },
];

// -- WaveRunner -------------------------------------------------------------

export class WaveRunner {
  static readonly DEFAULT_GATES = DEFAULT_GATES;
  private contract: SessionContract;
  private waveResults: WaveResult[] = [];
  private totalUsdSpent = 0;
  private startedAt: Date | null = null;
  private stopReason = 'completed';

  constructor(contract: SessionContract) {
    this.contract = { ...contract, quality_gates: contract.quality_gates.length > 0 ? contract.quality_gates : DEFAULT_GATES };
  }

  async start(): Promise<WaveRunReport> {
    this.startedAt = new Date();
    this.waveResults = [];
    this.totalUsdSpent = 0;
    this.stopReason = 'completed';
    this.log(`Session "${this.contract.name}" starting. Budget: $${this.contract.budget_usd}, Duration: ${this.contract.duration_hours}h`);

    let waveNumber = 0;
    while (!this.shouldStop()) {
      waveNumber++;
      const wave = this.planNextWave(waveNumber);
      if (!wave) { this.log('No more high-value work. Stopping.'); this.stopReason = 'no_valuable_work'; break; }

      this.log(`=== Wave ${waveNumber}: ${wave.name} ===`);
      const waveStart = new Date();

      // EXECUTE
      const taskResults = await this.executeWave(wave);
      const waveUsd = taskResults.reduce((s, r) => s + r.usd_spent, 0);
      this.totalUsdSpent += waveUsd;

      // VERIFY + FIX loop
      let gateResults = await this.runQualityGates();
      let allPassed = this.allGatesPassed(gateResults);
      let fixAttempts = 0;
      while (!allPassed && fixAttempts < 3) {
        fixAttempts++;
        this.log(`Gate failed. Fix attempt ${fixAttempts}/3...`);
        const fixResults = await this.executeWave({ ...wave, tasks: this.generateFixTasks(gateResults), name: `${wave.name} (fix ${fixAttempts})` });
        this.totalUsdSpent += fixResults.reduce((s, r) => s + r.usd_spent, 0);
        gateResults = await this.runQualityGates();
        allPassed = this.allGatesPassed(gateResults);
      }
      if (!allPassed) this.log(`Gates still failing after ${fixAttempts} attempts. Moving on.`);

      // COMMIT
      const commitSha = this.contract.git_checkpoint ? await this.gitCheckpoint(wave, allPassed) : undefined;

      // ASSESS
      const assessment = this.assess(wave, taskResults, gateResults);
      const waveEnd = new Date();

      this.waveResults.push({
        wave_id: waveNumber, wave_name: wave.name,
        started_at: waveStart.toISOString(), completed_at: waveEnd.toISOString(),
        duration_ms: waveEnd.getTime() - waveStart.getTime(),
        tasks_completed: taskResults.filter(r => r.status === 'completed').length,
        tasks_failed: taskResults.filter(r => r.status === 'failed').length,
        usd_spent: waveUsd, quality_gate_results: gateResults,
        all_gates_passed: allPassed, fix_attempts: fixAttempts,
        committed: !!commitSha, commit_sha: commitSha,
        findings: assessment.findings, next_wave_suggestions: assessment.suggestions,
      });

      await this.updateMorningReport();
      if (this.detectDiminishingReturns()) { this.log('Diminishing returns. Stopping.'); this.stopReason = 'diminishing_returns'; break; }
    }

    return this.generateFinalReport();
  }

  // -- PLAN -----------------------------------------------------------------

  private planNextWave(n: number): WaveDefinition | null {
    const prev = this.waveResults.length > 0 ? this.waveResults[this.waveResults.length - 1] : null;

    if (n === 1) return this.makeWave(n, 'Primary Goal', this.contract.goals.primary, 'high',
      [{ id: 'wave-1-primary', title: this.contract.goals.primary, description: this.prompt(this.contract.goals.primary, 'primary') }]);

    if (prev && !prev.all_gates_passed) {
      const names = prev.quality_gate_results.filter(g => !g.passed).map(g => g.name).join(', ');
      return this.makeWave(n, `Fix Gates (${names})`, `Fix gates from wave ${n - 1}`, 'high', this.generateFixTasks(prev.quality_gate_results));
    }

    if (prev && prev.next_wave_suggestions.length > 0) {
      const s = prev.next_wave_suggestions[0];
      return this.makeWave(n, s, `Follow-up: ${s}`, 'medium',
        [{ id: `wave-${n}-followup`, title: s, description: `# Follow-up: ${s}\n\nPrevious findings:\n${prev.findings.map(f => `- ${f}`).join('\n')}\n\nComplete fully without asking for clarification.` }]);
    }

    if (!this.isPrimaryAchieved()) return this.makeWave(n, 'Continue Primary', this.contract.goals.primary, 'high',
      [{ id: `wave-${n}-cont`, title: `Continue: ${this.contract.goals.primary}`, description: this.prompt(this.contract.goals.primary, 'primary') }]);

    const nextGoal = (goals: string[], tier: 'secondary' | 'stretch', value: 'medium' | 'low') => {
      const done = this.completedGoals(tier);
      const next = goals.find(g => !done.has(g));
      if (!next) return null;
      return this.makeWave(n, `${tier}: ${next.substring(0, 40)}`, next, value,
        [{ id: `wave-${n}-${tier}`, title: next, description: this.prompt(next, tier) }]);
    };

    return nextGoal(this.contract.goals.secondary ?? [], 'secondary', 'medium')
      ?? nextGoal(this.contract.goals.stretch ?? [], 'stretch', 'low')
      ?? null;
  }

  private makeWave(id: number, name: string, desc: string, value: 'high' | 'medium' | 'low', tasks: WaveTask[]): WaveDefinition {
    return { id, name, description: desc, tasks, estimated_value: value };
  }

  // -- EXECUTE --------------------------------------------------------------

  private async executeWave(wave: WaveDefinition): Promise<TaskResult[]> {
    const nightTasks: NightTask[] = wave.tasks.map((t, i) => ({
      id: t.id, title: t.title, description: t.description,
      priority: i + 1, agent_type: t.agent_type ?? 'general_purpose', depends_on: [],
      max_turns: t.max_turns ?? 30, max_usd: t.max_usd ?? Math.min(5, this.budgetLeft()),
      status: 'pending' as const,
    }));

    const taskFile = resolve(`.wave-${wave.id}-tasks.json`);
    await writeFile(taskFile, JSON.stringify(nightTasks, null, 2), 'utf-8');

    const config: NightRunnerConfig = {
      supabaseUrl: process.env.SUPABASE_URL ?? 'http://localhost:54321',
      accessKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'local',
      anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
      model: process.env.OB1_MODEL ?? 'sonnet',
      maxBudgetUsd: Math.min(this.budgetLeft(), wave.tasks.reduce((s, t) => s + (t.max_usd ?? 5), 0)),
      maxDurationMinutes: Math.min(60, this.minutesLeft()),
      maxConcurrentAgents: 2,
      taskSource: 'file', taskFile, reportToMemory: false,
    };

    try { return (await new NightRunner(config).start()).task_results; }
    catch (e) { this.log(`Wave ${wave.id} error: ${e instanceof Error ? e.message : e}`); return []; }
  }

  // -- VERIFY ---------------------------------------------------------------

  async runQualityGates(): Promise<QualityGateResult[]> {
    const results: QualityGateResult[] = [];
    for (const gate of this.contract.quality_gates) {
      const t0 = Date.now();
      let passed = false;
      let output = '';
      try {
        output = await this.sh(gate.command, gate.timeout_ms ?? 120_000);
        passed = !(gate.failure_pattern && new RegExp(gate.failure_pattern, 'i').test(output))
          && !(gate.success_pattern && !new RegExp(gate.success_pattern, 'i').test(output));
      } catch (e) { output = e instanceof Error ? e.message : String(e); }
      results.push({ name: gate.name, passed, output: output.substring(0, 2000), duration_ms: Date.now() - t0 });
      this.log(`  Gate "${gate.name}": ${passed ? 'PASS' : 'FAIL'} (${Date.now() - t0}ms)`);
    }
    return results;
  }

  private allGatesPassed(results: QualityGateResult[]): boolean {
    return results.every(g => g.passed || !this.contract.quality_gates.find(c => c.name === g.name)?.required);
  }

  // -- FIX ------------------------------------------------------------------

  private generateFixTasks(gateResults: QualityGateResult[]): WaveTask[] {
    return gateResults.filter(g => !g.passed).filter(g => {
      const cfg = this.contract.quality_gates.find(c => c.name === g.name);
      return !cfg || cfg.required;
    }).map(g => {
      const kind = g.name.startsWith('typescript') ? 'TypeScript compilation' : g.name.startsWith('test') ? 'test' : g.name;
      return {
        id: `fix-${g.name}-${Date.now()}`, title: `Fix: ${g.name}`, max_turns: 20,
        description: `Fix ${kind} errors. Gate "${g.name}" output:\n\n${g.output}\n\nFix the root cause.`,
      };
    });
  }

  // -- COMMIT ---------------------------------------------------------------

  private async gitCheckpoint(wave: WaveDefinition, passed: boolean): Promise<string | undefined> {
    const msg = `[night-shift] Wave ${wave.id}: ${wave.name} (${passed ? 'verified' : 'unverified'})`;
    try {
      await this.sh('git add -A', 30_000);
      const diff = await this.sh('git diff --cached --stat', 10_000).catch(() => '');
      if (!diff.trim()) { this.log('  No changes to commit.'); return undefined; }
      await this.sh(`git commit -m "${msg.replace(/"/g, '\\"')}"`, 30_000);
      const sha = (await this.sh('git rev-parse --short HEAD', 10_000)).trim();
      await this.sh('git push', 60_000).catch(() => this.log('  Push failed (non-fatal).'));
      this.log(`  Committed: ${sha}`);
      return sha;
    } catch (e) { this.log(`  Git checkpoint failed: ${e instanceof Error ? e.message : e}`); return undefined; }
  }

  // -- ASSESS ---------------------------------------------------------------

  private assess(wave: WaveDefinition, taskResults: TaskResult[], gateResults: QualityGateResult[]): { findings: string[]; suggestions: string[] } {
    const findings: string[] = [];
    const suggestions: string[] = [];
    const ok = taskResults.filter(r => r.status === 'completed');
    const bad = taskResults.filter(r => r.status === 'failed');

    findings.push(`Wave "${wave.name}": ${ok.length}/${taskResults.length} tasks completed`);
    if (bad.length > 0) findings.push(`Failed: ${bad.map(f => f.title).join(', ')}`);

    const failedGates = gateResults.filter(g => !g.passed);
    if (failedGates.length > 0) {
      findings.push(`Gates failing: ${failedGates.map(g => g.name).join(', ')}`);
      for (const g of failedGates) {
        suggestions.push(g.name.includes('typescript') ? 'Fix TypeScript errors' : g.name.includes('test') ? 'Fix failing tests' : `Fix ${g.name}`);
      }
    }

    for (const r of ok) {
      const s = r.output_summary.toLowerCase();
      if (s.includes('security') || s.includes('vulnerability')) { findings.push('Security issue found'); suggestions.push('Address security findings'); }
      if (s.includes('todo') || s.includes('fixme')) { findings.push('TODOs remain'); suggestions.push('Address remaining TODOs'); }
    }
    if (bad.length > 0 && ok.length > 0) suggestions.push('Retry failed tasks before new work');

    return { findings, suggestions: [...new Set(suggestions)] };
  }

  // -- Stop conditions ------------------------------------------------------

  private shouldStop(): boolean {
    if (this.totalUsdSpent >= this.contract.budget_usd) { this.stopReason = 'budget_exhausted'; return true; }
    if (this.startedAt && (Date.now() - this.startedAt.getTime()) / 3_600_000 >= this.contract.duration_hours) { this.stopReason = 'time_limit'; return true; }
    return false;
  }

  private detectDiminishingReturns(): boolean {
    if (this.waveResults.length < 3) return false;
    const v = this.waveResults.slice(-3).map(w => w.tasks_completed * (w.all_gates_passed ? 1 : 0.5));
    return v[0] > v[1] && v[1] > v[2] && v[2] < 0.5;
  }

  // -- Morning report -------------------------------------------------------

  private async updateMorningReport(): Promise<void> {
    const r = this.generateFinalReport();
    const lines = [
      `# Morning Report: ${r.session_name}`, '',
      `**Started:** ${r.started_at}  **Updated:** ${new Date().toISOString()}`,
      `**Budget:** $${r.total_usd_spent.toFixed(2)} / $${this.contract.budget_usd.toFixed(2)}`,
      `**Waves:** ${r.waves_completed}  **Stop:** ${r.stop_reason}`, '',
      `## Goals`, `- **Primary:** ${r.goals_status.primary.goal} -- ${r.goals_status.primary.status}`,
      ...r.goals_status.secondary.map(s => `- ${s.goal} -- ${s.status}`), '',
      '## Waves', '',
      ...r.wave_results.map(w => [
        `### Wave ${w.wave_id}: ${w.wave_name} ${w.all_gates_passed ? '[PASS]' : '[FAIL]'}`,
        `${w.tasks_completed} done, ${w.tasks_failed} failed | $${w.usd_spent.toFixed(4)} | ${Math.round(w.duration_ms / 1000)}s`,
        w.committed ? `Commit: ${w.commit_sha ?? 'yes'}` : '',
        w.findings.length > 0 ? `Findings: ${w.findings.join('; ')}` : '', '',
      ].filter(Boolean).join('\n')),
    ];
    try { await writeFile(resolve(this.contract.report_path), lines.join('\n'), 'utf-8'); }
    catch (e) { this.log(`Report write failed: ${e instanceof Error ? e.message : e}`); }
  }

  // -- Final report ---------------------------------------------------------

  private generateFinalReport(): WaveRunReport {
    const now = new Date();
    const started = this.startedAt ?? now;
    return {
      session_name: this.contract.name,
      started_at: started.toISOString(), completed_at: now.toISOString(),
      duration_minutes: Math.round((now.getTime() - started.getTime()) / 60_000),
      total_waves: this.waveResults.length,
      waves_completed: this.waveResults.filter(w => w.tasks_completed > 0).length,
      total_usd_spent: this.totalUsdSpent,
      budget_remaining_usd: Math.max(0, this.contract.budget_usd - this.totalUsdSpent),
      stop_reason: this.stopReason, wave_results: this.waveResults,
      goals_status: {
        primary: { goal: this.contract.goals.primary, status: this.isPrimaryAchieved() ? 'achieved' : this.waveResults.length > 0 ? 'partial' : 'not_started' },
        secondary: (this.contract.goals.secondary ?? []).map(g => ({ goal: g, status: this.completedGoals('secondary').has(g) ? 'achieved' : 'not_started' })),
      },
    };
  }

  // -- Helpers --------------------------------------------------------------

  private budgetLeft(): number { return Math.max(0, this.contract.budget_usd - this.totalUsdSpent); }

  private minutesLeft(): number {
    if (!this.startedAt) return this.contract.duration_hours * 60;
    return Math.max(0, this.contract.duration_hours * 60 - (Date.now() - this.startedAt.getTime()) / 60_000);
  }

  private isPrimaryAchieved(): boolean {
    return this.waveResults.some(w => w.tasks_completed > 0 && w.tasks_failed === 0 && w.all_gates_passed);
  }

  private completedGoals(tier: 'secondary' | 'stretch'): Set<string> {
    const goals = (tier === 'secondary' ? this.contract.goals.secondary : this.contract.goals.stretch) ?? [];
    const done = new Set<string>();
    for (const w of this.waveResults) for (const g of goals) {
      if (w.wave_name.includes(g.substring(0, 30)) && w.tasks_completed > 0 && w.all_gates_passed) done.add(g);
    }
    return done;
  }

  private prompt(goal: string, tier: string): string {
    const prev = this.waveResults.length > 0
      ? `\n\nPrevious waves:\n${this.waveResults.map(w => `- Wave ${w.wave_id} (${w.wave_name}): ${w.findings.join('; ')}`).join('\n')}` : '';
    return `# Goal (${tier}): ${goal}\n\nAutonomous night shift. Complete fully.\n- Boundaries: ${this.contract.boundaries.autonomous.join(', ')}\n- DO NOT: ${this.contract.boundaries.requires_approval.join(', ')}${prev}`;
  }

  private sh(cmd: string, timeout: number): Promise<string> {
    return new Promise((res, rej) => {
      exec(cmd, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        err ? rej(new Error(`${stdout}\n${stderr}\n${err.message}`)) : res(`${stdout}\n${stderr}`);
      });
    });
  }

  private log(msg: string): void { console.log(`[WaveRunner ${new Date().toISOString()}] ${msg}`); }
}

// -- CLI --------------------------------------------------------------------

if (typeof process !== 'undefined' && process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    const args = process.argv.slice(2);
    const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined; };
    const flag = (n: string) => args.includes(`--${n}`);

    if (flag('help') || flag('h')) {
      console.log(`Usage: node wave-runner.js [--goal <goal>] [--budget <usd>] [--hours <h>] [--contract <file>] [--report <path>] [--no-git] [--secondary <g1,g2>] [--name <name>]`);
      process.exit(0);
    }

    let contract: SessionContract;
    if (arg('contract')) {
      contract = JSON.parse(await readFile(resolve(arg('contract')!), 'utf-8')) as SessionContract;
    } else {
      const goal = arg('goal');
      if (!goal) { console.error('--goal required (or --contract)'); process.exit(1); }
      contract = {
        name: arg('name') ?? `Night shift ${new Date().toISOString().split('T')[0]}`,
        duration_hours: parseFloat(arg('hours') ?? '8'), budget_usd: parseFloat(arg('budget') ?? '25'),
        goals: { primary: goal, secondary: arg('secondary')?.split(',').map(s => s.trim()).filter(Boolean) },
        boundaries: { autonomous: ['Write code', 'Write tests', 'Fix bugs', 'Docs', 'Git'], requires_approval: ['API changes', 'New deps', 'Schema changes'] },
        quality_gates: DEFAULT_GATES, git_checkpoint: !flag('no-git'),
        report_path: arg('report') ?? 'morning-report.md',
      };
    }

    console.log(`\n  WaveRunner | ${contract.name} | $${contract.budget_usd} | ${contract.duration_hours}h | ${contract.goals.primary}\n`);
    const report = await new WaveRunner(contract).start();
    console.log(`\n  Done: ${report.waves_completed}/${report.total_waves} waves, $${report.total_usd_spent.toFixed(2)}, ${report.stop_reason}\n`);
    process.exit(report.stop_reason === 'completed' || report.stop_reason === 'no_valuable_work' ? 0 : 1);
  })().catch(e => { console.error('Fatal:', e); process.exit(1); });
}
