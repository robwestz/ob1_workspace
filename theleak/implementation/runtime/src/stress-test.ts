// stress-test.ts — 7.5-Hour Overnight Session Stress Test Harness
//
// Simulates a full overnight wave-based session to validate crash recovery,
// budget tracking, gate failure patterns, diminishing returns, and reporting.
//
// Usage:
//   const test = new StressTest(config);
//   const report = await test.run();
//
//   // CLI: node stress-test.js --waves 10 --budget 25 --crash-rate 0.05

import { fileURLToPath } from 'node:url';

// -- Types ------------------------------------------------------------------

export interface StressTestConfig {
  mode: 'simulation' | 'live';
  contract: {
    name: string; primary_goal: string; secondary_goals: string[];
    budget_usd: number; duration_hours: number; model: string;
  };
  simulation?: SimulationSettings;
  onWaveComplete?: (wave: number, result: SimulatedWaveResult) => void;
  onCrash?: (wave: number, reason: string) => void;
  onResume?: (wave: number) => void;
}

export interface SimulationSettings {
  wave_duration_ms: number; task_success_rate: number; gate_pass_rate: number;
  crash_probability: number; model_latency_ms: number; waves_to_run: number;
}

export interface SimulatedWaveResult {
  wave_id: number; name: string; duration_ms: number;
  tasks_completed: number; tasks_failed: number; gates_passed: boolean;
  usd_spent: number; model_used: string;
  crashed: boolean; resumed: boolean; value_score: number;
}

export interface StressTestReport {
  config: StressTestConfig; started_at: string; completed_at: string; duration_ms: number;
  total_waves: number; waves_completed: number; waves_failed: number;
  crashes: number; successful_resumes: number;
  total_usd_simulated: number; budget_accuracy: number;
  wave_results: SimulatedWaveResult[];
  gate_pass_rate_actual: number; task_success_rate_actual: number; avg_wave_duration_ms: number;
  failure_modes: string[]; recommendations: string[];
}

// -- Constants --------------------------------------------------------------

const DEFAULT_SIM: SimulationSettings = {
  wave_duration_ms: 5000, task_success_rate: 0.9, gate_pass_rate: 0.85,
  crash_probability: 0.05, model_latency_ms: 2000, waves_to_run: 10,
};
const TASKS_PER_WAVE = 3;
const COST_BASE = 0.50;
const COST_RANGE = 1.50;
const DIM_DECAY = 0.08;
const DIM_THRESHOLD = 0.3;
const DIM_STOP_COUNT = 3;

// -- StressTest -------------------------------------------------------------

export class StressTest {
  private readonly sim: SimulationSettings;
  constructor(private readonly config: StressTestConfig) {
    this.sim = { ...DEFAULT_SIM, ...config.simulation };
  }

  async run(): Promise<StressTestReport> {
    if (this.config.mode === 'live')
      throw new Error('Live stress test requires deployed Supabase. Use simulation mode.');
    return this.runSimulation();
  }

  private async runSimulation(): Promise<StressTestReport> {
    const startedAt = new Date();
    const results: SimulatedWaveResult[] = [];
    let crashes = 0, resumes = 0, usdSpent = 0, lowValueRun = 0, wi = 1;

    while (wi <= this.sim.waves_to_run) {
      // Crash simulation (never on wave 1)
      if (wi > 1 && Math.random() < this.sim.crash_probability) {
        crashes++; resumes++;
        this.config.onCrash?.(wi, 'Simulated process crash');
        this.config.onResume?.(wi);
        continue; // retry same wave
      }
      // Diminishing returns
      const valueScore = Math.max(0, 1.0 - DIM_DECAY * (wi - 1));
      lowValueRun = valueScore < DIM_THRESHOLD ? lowValueRun + 1 : 0;
      if (lowValueRun >= DIM_STOP_COUNT) break;

      // Tasks
      let ok = 0;
      for (let t = 0; t < TASKS_PER_WAVE; t++) if (Math.random() < this.sim.task_success_rate) ok++;
      const gatesPassed = Math.random() < this.sim.gate_pass_rate;
      const waveCost = COST_BASE + Math.random() * COST_RANGE;
      usdSpent += waveCost;

      // Budget exhaustion
      if (usdSpent > this.config.contract.budget_usd) {
        results.push(this.makeWave(wi, 'Budget exhausted', 0, 0, 0, true, 0, false, false, 0));
        break;
      }
      const dur = this.sim.wave_duration_ms + Math.random() * this.sim.wave_duration_ms;
      results.push(this.makeWave(wi, 'Simulated task batch', dur, ok, TASKS_PER_WAVE - ok, gatesPassed, waveCost, false, false, valueScore));
      this.config.onWaveComplete?.(wi, results[results.length - 1]);
      await sleep(Math.min(this.sim.wave_duration_ms, 50));
      wi++;
    }
    return this.buildReport(results, crashes, resumes, startedAt, new Date());
  }

  private makeWave(
    id: number, label: string, dur: number, ok: number, fail: number,
    gates: boolean, cost: number, crashed: boolean, resumed: boolean, value: number,
  ): SimulatedWaveResult {
    return {
      wave_id: id, name: `Wave ${id}: ${label}`, duration_ms: dur,
      tasks_completed: ok, tasks_failed: fail, gates_passed: gates,
      usd_spent: cost, model_used: this.config.contract.model,
      crashed, resumed, value_score: value,
    };
  }

  private buildReport(
    results: SimulatedWaveResult[], crashes: number, resumes: number,
    start: Date, end: Date,
  ): StressTestReport {
    const totalTasks = results.reduce((s, r) => s + r.tasks_completed + r.tasks_failed, 0);
    const totalOk = results.reduce((s, r) => s + r.tasks_completed, 0);
    const realWaves = results.filter(r => r.tasks_completed + r.tasks_failed > 0);
    const gatesOk = results.filter(r => r.gates_passed).length;
    const totalUsd = results.reduce((s, r) => s + r.usd_spent, 0);
    const durs = results.filter(r => r.duration_ms > 0);
    const avgDur = durs.length ? durs.reduce((s, r) => s + r.duration_ms, 0) / durs.length : 0;
    const expected = (this.config.contract.budget_usd / this.sim.waves_to_run) * realWaves.length;
    const budgetAcc = expected > 0 ? Math.max(0, 1 - Math.abs(totalUsd - expected) / expected) : 1;
    const modes = this.detectFailures(results, crashes);
    const recs = this.makeRecs(crashes, modes);
    return {
      config: this.config, started_at: start.toISOString(), completed_at: end.toISOString(),
      duration_ms: end.getTime() - start.getTime(), total_waves: results.length,
      waves_completed: realWaves.length, waves_failed: results.filter(r => !r.gates_passed).length,
      crashes, successful_resumes: resumes, total_usd_simulated: totalUsd,
      budget_accuracy: budgetAcc, wave_results: results,
      gate_pass_rate_actual: realWaves.length ? gatesOk / realWaves.length : 0,
      task_success_rate_actual: totalTasks ? totalOk / totalTasks : 0,
      avg_wave_duration_ms: avgDur, failure_modes: modes, recommendations: recs,
    };
  }

  private detectFailures(results: SimulatedWaveResult[], crashes: number): string[] {
    const m: string[] = [];
    if (results.some(r => r.name.includes('Budget exhausted')))
      m.push('BUDGET_EXHAUSTED: Session stopped due to budget overshoot');
    const tot = results.length + crashes;
    if (tot > 0 && crashes / tot > 0.1)
      m.push(`HIGH_CRASH_RATE: ${crashes} crashes in ${tot} attempts (${((crashes / tot) * 100).toFixed(1)}%)`);
    const gf = results.filter(r => !r.gates_passed);
    if (gf.length >= 3) m.push(`REPEATED_GATE_FAILURES: ${gf.length} waves failed quality gates`);
    let maxC = 0, cur = 0;
    for (const r of results) { if (!r.gates_passed) { cur++; maxC = Math.max(maxC, cur); } else cur = 0; }
    if (maxC >= 3) m.push(`CONSECUTIVE_GATE_FAILURES: ${maxC} consecutive waves failed gates`);
    const vs = results.filter(r => r.value_score > 0).map(r => r.value_score);
    if (vs.length >= 3 && vs.slice(-3).every(v => v < DIM_THRESHOLD))
      m.push('DIMINISHING_RETURNS: Last 3 waves produced below-threshold value');
    const zp = results.filter(r => r.tasks_completed === 0 && r.tasks_failed > 0);
    if (zp.length >= 2) m.push(`ZERO_PROGRESS_WAVES: ${zp.length} waves completed zero tasks`);
    return m;
  }

  private makeRecs(crashes: number, modes: string[]): string[] {
    const r: string[] = [];
    const map: Record<string, string> = {
      BUDGET_EXHAUSTED: 'Increase budget or reduce wave count to avoid premature session termination',
      HIGH_CRASH_RATE: 'Investigate crash frequency — consider adding heartbeat monitoring and auto-restart',
      REPEATED_GATE_FAILURES: 'Review quality gate thresholds — too strict gates waste budget on retries',
      CONSECUTIVE_GATE_FAILURES: 'Add progressive gate relaxation or skip-and-revisit strategy for stuck waves',
      DIMINISHING_RETURNS: 'Enable early stopping when value drops below threshold to conserve budget',
      ZERO_PROGRESS_WAVES: 'Add task decomposition — large tasks that fail completely should be split',
    };
    for (const mode of modes) {
      const key = mode.split(':')[0];
      if (map[key]) r.push(map[key]);
    }
    if (crashes > 0 && !modes.some(m => m.startsWith('HIGH_CRASH')))
      r.push('Crash recovery worked but consider adding pre-emptive checkpointing');
    if (r.length === 0) r.push('Session completed within normal parameters — no issues detected');
    return r;
  }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// CLI runner — node stress-test.js --waves 10 --budget 25 --crash-rate 0.05
// ---------------------------------------------------------------------------

if (typeof process !== 'undefined' && process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    const args = process.argv.slice(2);
    const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined; };
    const flag = (n: string) => args.includes(`--${n}`);

    if (flag('help') || flag('h')) {
      console.log(`
Usage: node stress-test.js [options]

Options:
  --waves <count>      Waves to simulate (default: 10)
  --budget <usd>       Budget in USD (default: 25)
  --crash-rate <0-1>   Crash probability per wave (default: 0.05)
  --gate-rate <0-1>    Gate pass probability (default: 0.85)
  --task-rate <0-1>    Task success probability (default: 0.90)
  --wave-ms <ms>       Simulated wave delay ms (default: 50)
  --model <name>       Model name for report (default: sonnet)
  --help               Show this help

Examples:
  node stress-test.js --waves 10 --budget 25 --crash-rate 0.05
  node stress-test.js --waves 20 --budget 5`);
      process.exit(0);
    }

    const waves = parseInt(arg('waves') ?? '10', 10);
    const budget = parseFloat(arg('budget') ?? '25');
    const cr = parseFloat(arg('crash-rate') ?? '0.05');
    const gr = parseFloat(arg('gate-rate') ?? '0.85');
    const tr = parseFloat(arg('task-rate') ?? '0.90');
    const wms = parseInt(arg('wave-ms') ?? '50', 10);
    const model = arg('model') ?? 'sonnet';

    const cfg: StressTestConfig = {
      mode: 'simulation',
      contract: { name: `Stress Test ${new Date().toISOString().slice(0, 10)}`,
        primary_goal: 'Validate 7.5h overnight session reliability',
        secondary_goals: ['Crash recovery', 'Budget tracking', 'Gate enforcement'],
        budget_usd: budget, duration_hours: 7.5, model },
      simulation: { wave_duration_ms: wms, task_success_rate: tr, gate_pass_rate: gr,
        crash_probability: cr, model_latency_ms: 100, waves_to_run: waves },
      onWaveComplete: (w, r) => console.log(`  ${r.gates_passed ? '[PASS]' : '[FAIL]'} Wave ${w}: ${r.tasks_completed}/${TASKS_PER_WAVE} tasks, $${r.usd_spent.toFixed(2)}, value=${r.value_score.toFixed(2)}`),
      onCrash: (w, reason) => console.log(`  [CRASH] Wave ${w}: ${reason}`),
      onResume: (w) => console.log(`  [RESUME] Wave ${w}: Recovered`),
    };

    console.log('\n  ============================================');
    console.log('  StressTest — Overnight Session Stress Harness');
    console.log('  ============================================');
    console.log(`  Waves: ${waves}  Budget: $${budget}  Crash: ${(cr * 100).toFixed(0)}%  Gate: ${(gr * 100).toFixed(0)}%  Task: ${(tr * 100).toFixed(0)}%\n`);

    const rpt = await new StressTest(cfg).run();

    console.log('\n  ====== Stress Test Complete ======');
    console.log(`  Waves: ${rpt.waves_completed} ok, ${rpt.waves_failed} failed (${rpt.total_waves} total)`);
    console.log(`  Crashes: ${rpt.crashes} (${rpt.successful_resumes} recovered)`);
    console.log(`  Cost: $${rpt.total_usd_simulated.toFixed(2)}  Budget acc: ${(rpt.budget_accuracy * 100).toFixed(1)}%`);
    console.log(`  Gate pass: ${(rpt.gate_pass_rate_actual * 100).toFixed(1)}%  Task success: ${(rpt.task_success_rate_actual * 100).toFixed(1)}%`);
    if (rpt.failure_modes.length) { console.log('  Failure modes:'); rpt.failure_modes.forEach(m => console.log(`    - ${m}`)); }
    if (rpt.recommendations.length) { console.log('  Recommendations:'); rpt.recommendations.forEach(r => console.log(`    - ${r}`)); }
    console.log('  =================================\n');
    process.exit(rpt.failure_modes.length > 0 ? 1 : 0);
  })().catch((e: Error) => { console.error(`Fatal: ${e.message}`); process.exit(2); });
}
