// =============================================================================
// Unit Tests — QualityGateRunner
// =============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  QualityGateRunner,
  type QualityGateConfig,
  type GateRunSummary,
} from '../src/quality-gate-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gate(overrides: Partial<QualityGateConfig> & { name: string }): QualityGateConfig {
  return {
    command: 'echo ok',
    timeout_ms: 10000,
    required: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QualityGateRunner', () => {

  // ---- Passing gate -------------------------------------------------

  describe('runGate', () => {
    it('passing gate returns passed=true', async () => {
      const runner = new QualityGateRunner([]);
      const result = await runner.runGate(gate({ name: 'echo-ok', command: 'echo ok' }));

      assert.equal(result.passed, true);
      assert.equal(result.name, 'echo-ok');
      assert.equal(result.required, true);
      assert.ok(result.duration_ms >= 0);
      assert.ok(result.output.includes('ok'));
      assert.equal(result.error, undefined);
    });

    // ---- Failing gate (non-zero exit) --------------------------------

    it('failing gate (non-zero exit) returns passed=false', async () => {
      const runner = new QualityGateRunner([]);
      const result = await runner.runGate(gate({ name: 'exit-1', command: 'exit 1' }));

      assert.equal(result.passed, false);
      assert.equal(result.name, 'exit-1');
      assert.ok(typeof result.error === 'string');
    });

    // ---- Failure pattern match returns passed=false even with exit 0 -

    it('failure pattern match returns passed=false even with exit 0', async () => {
      const runner = new QualityGateRunner([]);
      const result = await runner.runGate(gate({
        name: 'pattern-fail',
        command: 'echo "error TS1234: something broke"',
        failure_pattern: 'error TS',
      }));

      assert.equal(result.passed, false);
      assert.equal(result.error, undefined); // command succeeded (exit 0)
    });

    // ---- Success pattern required but missing returns passed=false ----

    it('success pattern required but missing returns passed=false', async () => {
      const runner = new QualityGateRunner([]);
      const result = await runner.runGate(gate({
        name: 'missing-pattern',
        command: 'echo "some other output"',
        success_pattern: 'all tests passed',
      }));

      assert.equal(result.passed, false);
      assert.equal(result.error, undefined); // command succeeded (exit 0)
    });

    // ---- Timeout kills command and returns error ---------------------

    it('timeout kills command and returns error', async () => {
      const runner = new QualityGateRunner([]);
      const result = await runner.runGate(gate({
        name: 'timeout-test',
        command: 'sleep 30',
        timeout_ms: 500,
      }));

      assert.equal(result.passed, false);
      assert.ok(result.error?.includes('Timeout after 500ms'));
    });
  });

  // ---- runAll --------------------------------------------------------

  describe('runAll', () => {

    // ---- Required gate failure skips remaining gates -----------------

    it('required gate failure skips remaining gates', async () => {
      const runner = new QualityGateRunner([
        gate({ name: 'gate-1', command: 'exit 1', required: true }),
        gate({ name: 'gate-2', command: 'echo ok', required: true }),
        gate({ name: 'gate-3', command: 'echo ok', required: false }),
      ]);

      const summary = await runner.runAll();

      assert.equal(summary.total, 3);
      assert.equal(summary.failed, 1);
      assert.equal(summary.skipped, 2);
      assert.equal(summary.passed, 0);
      assert.equal(summary.all_required_passed, false);

      // gate-2 and gate-3 should be skipped
      assert.ok(summary.results[1].output.startsWith('Skipped'));
      assert.ok(summary.results[2].output.startsWith('Skipped'));
    });

    // ---- Optional gate failure doesn't skip remaining ----------------

    it('optional gate failure does not skip remaining gates', async () => {
      const runner = new QualityGateRunner([
        gate({ name: 'gate-1', command: 'echo ok', required: true }),
        gate({ name: 'gate-2', command: 'exit 1', required: false }),
        gate({ name: 'gate-3', command: 'echo ok', required: true }),
      ]);

      const summary = await runner.runAll();

      assert.equal(summary.total, 3);
      assert.equal(summary.passed, 2);
      assert.equal(summary.failed, 1);
      assert.equal(summary.skipped, 0);
      // gate-2 failed (optional), gate-3 still ran and passed
      assert.equal(summary.results[0].passed, true);
      assert.equal(summary.results[1].passed, false);
      assert.equal(summary.results[2].passed, true);
      // all_required_passed should be true because gate-2 is optional
      assert.equal(summary.all_required_passed, true);
    });

    // ---- runAll returns correct summary counts ----------------------

    it('returns correct summary counts for all-passing gates', async () => {
      const runner = new QualityGateRunner([
        gate({ name: 'a', command: 'echo ok' }),
        gate({ name: 'b', command: 'echo ok' }),
        gate({ name: 'c', command: 'echo ok' }),
      ]);

      const summary = await runner.runAll();

      assert.equal(summary.total, 3);
      assert.equal(summary.passed, 3);
      assert.equal(summary.failed, 0);
      assert.equal(summary.skipped, 0);
      assert.equal(summary.all_required_passed, true);
      assert.ok(summary.duration_ms >= 0);
    });
  });

  // ---- defaultGates ---------------------------------------------------

  describe('defaultGates', () => {
    it('returns 6 gates', () => {
      const gates = QualityGateRunner.defaultGates();
      assert.equal(gates.length, 6);
    });

    it('every gate has a name, command, and timeout_ms', () => {
      for (const g of QualityGateRunner.defaultGates()) {
        assert.ok(g.name.length > 0, `gate name empty`);
        assert.ok(g.command.length > 0, `gate command empty`);
        assert.ok(g.timeout_ms > 0, `gate timeout_ms not positive`);
        assert.equal(typeof g.required, 'boolean');
      }
    });
  });

  // ---- formatSummary --------------------------------------------------

  describe('formatSummary', () => {
    it('produces readable output', () => {
      const summary: GateRunSummary = {
        all_required_passed: false,
        total: 3,
        passed: 1,
        failed: 1,
        skipped: 1,
        duration_ms: 5400,
        results: [
          { name: 'tsc', passed: true, required: true, output: 'ok', duration_ms: 2000 },
          { name: 'tests', passed: false, required: true, output: 'fail 2', duration_ms: 3000, error: 'exit code 1' },
          { name: 'lint', passed: false, required: false, output: 'Skipped: previous required gate failed', duration_ms: 0 },
        ],
      };

      const text = QualityGateRunner.formatSummary(summary);

      assert.ok(text.includes('Quality Gates:'));
      assert.ok(text.includes('[PASS] tsc'));
      assert.ok(text.includes('[FAIL] tests'));
      assert.ok(text.includes('[SKIP] lint'));
      assert.ok(text.includes('(optional)'));
      assert.ok(text.includes('1/3 passed'));
      assert.ok(text.includes('5.4s'));
      assert.ok(text.includes('Error: exit code 1'));
    });
  });
});
