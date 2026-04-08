// =============================================================================
// Unit Tests — StressTest
// =============================================================================

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  StressTest,
  type StressTestConfig,
  type StressTestReport,
  type SimulatedWaveResult,
} from '../src/stress-test.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseConfig(overrides?: Partial<StressTestConfig>): StressTestConfig {
  return {
    mode: 'simulation',
    contract: {
      name: 'Test Session',
      primary_goal: 'Validate harness',
      secondary_goals: ['Recovery', 'Budget'],
      budget_usd: 100,
      duration_hours: 7.5,
      model: 'sonnet',
    },
    simulation: {
      wave_duration_ms: 1,      // minimal delay for test speed
      task_success_rate: 1.0,   // all tasks succeed by default
      gate_pass_rate: 1.0,      // all gates pass by default
      crash_probability: 0,     // no crashes by default
      model_latency_ms: 1,
      waves_to_run: 5,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StressTest', () => {

  // -- Basic simulation completion ------------------------------------------

  describe('simulation completion', () => {
    it('completes with expected wave count when no failures', async () => {
      const config = baseConfig();
      const test = new StressTest(config);
      const report = await test.run();

      assert.equal(report.waves_completed, 5);
      assert.equal(report.total_waves, 5);
      assert.equal(report.crashes, 0);
      assert.equal(report.successful_resumes, 0);
    });

    it('wave_results array has one entry per completed wave', async () => {
      const config = baseConfig();
      const test = new StressTest(config);
      const report = await test.run();

      assert.equal(report.wave_results.length, 5);
      for (let i = 0; i < report.wave_results.length; i++) {
        assert.equal(report.wave_results[i].wave_id, i + 1);
      }
    });

    it('report timestamps are valid ISO strings', async () => {
      const config = baseConfig();
      const test = new StressTest(config);
      const report = await test.run();

      assert.ok(!isNaN(Date.parse(report.started_at)));
      assert.ok(!isNaN(Date.parse(report.completed_at)));
      assert.ok(report.duration_ms >= 0);
    });
  });

  // -- Budget exhaustion ----------------------------------------------------

  describe('budget exhaustion', () => {
    it('stops execution when budget is exceeded', async () => {
      // With $3 budget and $0.50-2.00 per wave, should stop within a few waves
      const config = baseConfig({
        simulation: {
          wave_duration_ms: 1,
          task_success_rate: 1.0,
          gate_pass_rate: 1.0,
          crash_probability: 0,
          model_latency_ms: 1,
          waves_to_run: 20,
        },
        contract: {
          name: 'Budget Test',
          primary_goal: 'Test budget stop',
          secondary_goals: [],
          budget_usd: 3,
          duration_hours: 7.5,
          model: 'sonnet',
        },
      });

      const test = new StressTest(config);
      const report = await test.run();

      // Should have stopped before 20 waves
      assert.ok(report.total_waves < 20, `Expected < 20 waves, got ${report.total_waves}`);

      // Last wave should be the budget-exhausted sentinel
      const lastWave = report.wave_results[report.wave_results.length - 1];
      assert.ok(lastWave.name.includes('Budget exhausted'));
      assert.equal(lastWave.usd_spent, 0);

      // Should detect BUDGET_EXHAUSTED failure mode
      assert.ok(
        report.failure_modes.some((m) => m.startsWith('BUDGET_EXHAUSTED')),
        `Expected BUDGET_EXHAUSTED in failure_modes, got: ${report.failure_modes.join(', ')}`,
      );
    });

    it('generates budget recommendation on exhaustion', async () => {
      const config = baseConfig({
        simulation: {
          wave_duration_ms: 1,
          task_success_rate: 1.0,
          gate_pass_rate: 1.0,
          crash_probability: 0,
          model_latency_ms: 1,
          waves_to_run: 20,
        },
        contract: {
          name: 'Budget Rec Test',
          primary_goal: 'Test recs',
          secondary_goals: [],
          budget_usd: 3,
          duration_hours: 7.5,
          model: 'sonnet',
        },
      });

      const test = new StressTest(config);
      const report = await test.run();

      assert.ok(
        report.recommendations.some((r) => r.includes('budget')),
        `Expected budget recommendation, got: ${report.recommendations.join('; ')}`,
      );
    });
  });

  // -- Crash and resume -----------------------------------------------------

  describe('crash and resume', () => {
    it('tracks crashes and successful resumes', async () => {
      // High crash rate to ensure at least one crash in 20 waves
      const config = baseConfig({
        simulation: {
          wave_duration_ms: 1,
          task_success_rate: 1.0,
          gate_pass_rate: 1.0,
          crash_probability: 0.5,  // 50% crash rate
          model_latency_ms: 1,
          waves_to_run: 10,
        },
      });

      // Run multiple times to account for randomness
      let foundCrash = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        const test = new StressTest(config);
        const report = await test.run();
        if (report.crashes > 0) {
          assert.equal(report.crashes, report.successful_resumes);
          foundCrash = true;
          break;
        }
      }
      assert.ok(foundCrash, 'Expected at least one crash with 50% crash rate in 10 attempts');
    });

    it('fires onCrash and onResume callbacks', async () => {
      const crashCalls: Array<{ wave: number; reason: string }> = [];
      const resumeCalls: number[] = [];

      const config = baseConfig({
        simulation: {
          wave_duration_ms: 1,
          task_success_rate: 1.0,
          gate_pass_rate: 1.0,
          crash_probability: 0.8,  // very high to ensure callbacks fire
          model_latency_ms: 1,
          waves_to_run: 10,
        },
        onCrash: (wave, reason) => crashCalls.push({ wave, reason }),
        onResume: (wave) => resumeCalls.push(wave),
      });

      let callbacksFired = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        crashCalls.length = 0;
        resumeCalls.length = 0;
        const test = new StressTest(config);
        await test.run();
        if (crashCalls.length > 0) {
          assert.equal(crashCalls.length, resumeCalls.length);
          assert.ok(crashCalls[0].reason.length > 0);
          callbacksFired = true;
          break;
        }
      }
      assert.ok(callbacksFired, 'Expected crash/resume callbacks to fire');
    });
  });

  // -- Gate failures --------------------------------------------------------

  describe('gate failures', () => {
    it('tracks gate failures in report', async () => {
      const config = baseConfig({
        simulation: {
          wave_duration_ms: 1,
          task_success_rate: 1.0,
          gate_pass_rate: 0.0,    // all gates fail
          crash_probability: 0,
          model_latency_ms: 1,
          waves_to_run: 5,
        },
      });

      const test = new StressTest(config);
      const report = await test.run();

      assert.equal(report.gate_pass_rate_actual, 0);
      assert.equal(report.waves_failed, 5);
    });

    it('detects REPEATED_GATE_FAILURES failure mode', async () => {
      const config = baseConfig({
        simulation: {
          wave_duration_ms: 1,
          task_success_rate: 1.0,
          gate_pass_rate: 0.0,
          crash_probability: 0,
          model_latency_ms: 1,
          waves_to_run: 5,
        },
      });

      const test = new StressTest(config);
      const report = await test.run();

      assert.ok(
        report.failure_modes.some((m) => m.startsWith('REPEATED_GATE_FAILURES')),
        `Expected REPEATED_GATE_FAILURES, got: ${report.failure_modes.join(', ')}`,
      );
    });

    it('detects CONSECUTIVE_GATE_FAILURES failure mode', async () => {
      const config = baseConfig({
        simulation: {
          wave_duration_ms: 1,
          task_success_rate: 1.0,
          gate_pass_rate: 0.0,
          crash_probability: 0,
          model_latency_ms: 1,
          waves_to_run: 5,
        },
      });

      const test = new StressTest(config);
      const report = await test.run();

      assert.ok(
        report.failure_modes.some((m) =>
          m.startsWith('CONSECUTIVE_GATE_FAILURES'),
        ),
        `Expected CONSECUTIVE_GATE_FAILURES, got: ${report.failure_modes.join(', ')}`,
      );
    });
  });

  // -- Report metrics -------------------------------------------------------

  describe('report metrics', () => {
    it('calculates correct task success rate', async () => {
      const config = baseConfig({
        simulation: {
          wave_duration_ms: 1,
          task_success_rate: 1.0,
          gate_pass_rate: 1.0,
          crash_probability: 0,
          model_latency_ms: 1,
          waves_to_run: 5,
        },
      });

      const test = new StressTest(config);
      const report = await test.run();

      // All tasks should succeed with 100% success rate
      assert.equal(report.task_success_rate_actual, 1.0);
    });

    it('calculates correct gate pass rate', async () => {
      const config = baseConfig({
        simulation: {
          wave_duration_ms: 1,
          task_success_rate: 1.0,
          gate_pass_rate: 1.0,
          crash_probability: 0,
          model_latency_ms: 1,
          waves_to_run: 5,
        },
      });

      const test = new StressTest(config);
      const report = await test.run();

      assert.equal(report.gate_pass_rate_actual, 1.0);
    });

    it('computes average wave duration', async () => {
      const config = baseConfig();
      const test = new StressTest(config);
      const report = await test.run();

      assert.ok(report.avg_wave_duration_ms > 0);
    });

    it('budget accuracy is between 0 and 1', async () => {
      const config = baseConfig();
      const test = new StressTest(config);
      const report = await test.run();

      assert.ok(report.budget_accuracy >= 0, `budget_accuracy ${report.budget_accuracy} < 0`);
      assert.ok(report.budget_accuracy <= 1, `budget_accuracy ${report.budget_accuracy} > 1`);
    });

    it('total_usd_simulated is sum of wave costs', async () => {
      const config = baseConfig();
      const test = new StressTest(config);
      const report = await test.run();

      const summed = report.wave_results.reduce((s, r) => s + r.usd_spent, 0);
      assert.ok(
        Math.abs(report.total_usd_simulated - summed) < 0.001,
        `Mismatch: report=${report.total_usd_simulated}, sum=${summed}`,
      );
    });
  });

  // -- Recommendations ------------------------------------------------------

  describe('recommendations', () => {
    it('generates recommendation for gate failures', async () => {
      const config = baseConfig({
        simulation: {
          wave_duration_ms: 1,
          task_success_rate: 1.0,
          gate_pass_rate: 0.0,
          crash_probability: 0,
          model_latency_ms: 1,
          waves_to_run: 5,
        },
      });

      const test = new StressTest(config);
      const report = await test.run();

      assert.ok(
        report.recommendations.some((r) => r.includes('gate')),
        `Expected gate recommendation, got: ${report.recommendations.join('; ')}`,
      );
    });

    it('generates positive recommendation when no issues', async () => {
      const config = baseConfig({
        simulation: {
          wave_duration_ms: 1,
          task_success_rate: 1.0,
          gate_pass_rate: 1.0,
          crash_probability: 0,
          model_latency_ms: 1,
          waves_to_run: 3,
        },
      });

      const test = new StressTest(config);
      const report = await test.run();

      // When no failure modes, should get the all-clear message
      if (report.failure_modes.length === 0) {
        assert.ok(
          report.recommendations.some((r) => r.includes('no issues detected')),
          `Expected positive recommendation, got: ${report.recommendations.join('; ')}`,
        );
      }
    });
  });

  // -- onWaveComplete callback ----------------------------------------------

  describe('onWaveComplete callback', () => {
    it('fires for each completed wave', async () => {
      const completedWaves: Array<{ wave: number; result: SimulatedWaveResult }> = [];

      const config = baseConfig({
        onWaveComplete: (wave, result) => {
          completedWaves.push({ wave, result });
        },
      });

      const test = new StressTest(config);
      const report = await test.run();

      // Callback should fire for each wave that has actual work (not budget-exhausted sentinel)
      const realWaves = report.wave_results.filter(
        (r) => !r.name.includes('Budget exhausted'),
      );
      assert.equal(completedWaves.length, realWaves.length);

      // Wave numbers should be sequential
      for (let i = 0; i < completedWaves.length; i++) {
        assert.equal(completedWaves[i].wave, i + 1);
        assert.equal(completedWaves[i].result.model_used, 'sonnet');
      }
    });

    it('provides correct wave result data in callback', async () => {
      const results: SimulatedWaveResult[] = [];

      const config = baseConfig({
        onWaveComplete: (_wave, result) => {
          results.push(result);
        },
      });

      const test = new StressTest(config);
      await test.run();

      for (const result of results) {
        assert.ok(result.wave_id > 0);
        assert.ok(result.duration_ms >= 0);
        assert.ok(result.usd_spent >= 0);
        assert.equal(result.model_used, 'sonnet');
        assert.ok(result.value_score >= 0 && result.value_score <= 1);
        assert.equal(result.tasks_completed + result.tasks_failed, 3);
      }
    });
  });

  // -- Live mode rejection --------------------------------------------------

  describe('live mode', () => {
    it('throws when attempting live mode', async () => {
      const config = baseConfig({ mode: 'live' });
      const test = new StressTest(config);

      await assert.rejects(
        () => test.run(),
        { message: /deployed Supabase/ },
      );
    });
  });

  // -- Diminishing returns --------------------------------------------------

  describe('diminishing returns', () => {
    it('value_score decreases over waves', async () => {
      const config = baseConfig({
        simulation: {
          wave_duration_ms: 1,
          task_success_rate: 1.0,
          gate_pass_rate: 1.0,
          crash_probability: 0,
          model_latency_ms: 1,
          waves_to_run: 8,
        },
      });

      const test = new StressTest(config);
      const report = await test.run();

      const scores = report.wave_results
        .filter((r) => !r.name.includes('Budget exhausted'))
        .map((r) => r.value_score);

      // Each score should be <= the previous (diminishing)
      for (let i = 1; i < scores.length; i++) {
        assert.ok(
          scores[i] <= scores[i - 1],
          `Wave ${i + 1} value (${scores[i]}) > wave ${i} value (${scores[i - 1]})`,
        );
      }
    });
  });
});
