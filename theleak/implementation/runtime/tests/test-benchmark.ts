/**
 * Tests for PerformanceBenchmarks — Node.js built-in test runner.
 *
 * Run: npx tsx --test tests/test-benchmark.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PerformanceBenchmarks,
  type BenchmarkReport,
  type BenchmarkResult,
} from '../src/benchmark.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runFull(): Promise<BenchmarkReport> {
  const suite = new PerformanceBenchmarks();
  return suite.runAll();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PerformanceBenchmarks', () => {

  describe('runAll', () => {
    it('returns report with all 8 benchmarks', async () => {
      const report = await runFull();

      assert.equal(report.total, 8, `expected 8 benchmarks, got ${report.total}`);
      assert.equal(report.results.length, 8);

      const names = report.results.map((r) => r.name);
      assert.ok(names.includes('Session bootstrap'));
      assert.ok(names.includes('Quality gates'));
      assert.ok(names.includes('Wave transition'));
      assert.ok(names.includes('CLI response'));
      assert.ok(names.includes('Dashboard build'));
      assert.ok(names.includes('Identity load'));
      assert.ok(names.includes('Knowledge search'));
      assert.ok(names.includes('Model registry'));
    });

    it('report has valid timestamp and duration', async () => {
      const report = await runFull();

      assert.ok(report.timestamp);
      assert.ok(new Date(report.timestamp).getTime() > 0);
      assert.ok(report.duration_ms >= 0);
    });

    it('passed + failed equals total', async () => {
      const report = await runFull();
      assert.equal(report.passed + report.failed, report.total);
    });
  });

  describe('Model registry lookup', () => {
    it('completes under 10ms budget (in-memory only)', async () => {
      const suite = new PerformanceBenchmarks({ only: 'Model registry' });
      const report = await suite.runAll();

      assert.equal(report.total, 1);
      const result = report.results[0];
      assert.equal(result.name, 'Model registry');
      assert.equal(result.metric, 'lookup_time');
      assert.ok(result.value <= result.budget,
        `Model registry took ${result.value}ms, budget is ${result.budget}ms`);
      assert.equal(result.passed, true);
    });
  });

  describe('BenchmarkResult shape', () => {
    it('every result includes pass/fail status', async () => {
      const report = await runFull();

      for (const r of report.results) {
        assert.equal(typeof r.passed, 'boolean', `${r.name} missing passed field`);
        assert.equal(typeof r.name, 'string');
        assert.equal(typeof r.metric, 'string');
        assert.equal(typeof r.value, 'number');
        assert.equal(typeof r.unit, 'string');
        assert.equal(typeof r.budget, 'number');
      }
    });

    it('passed is true when value <= budget', async () => {
      const report = await runFull();
      for (const r of report.results) {
        if (r.value <= r.budget) {
          assert.equal(r.passed, true, `${r.name}: value ${r.value} <= budget ${r.budget} but passed=false`);
        } else {
          assert.equal(r.passed, false, `${r.name}: value ${r.value} > budget ${r.budget} but passed=true`);
        }
      }
    });
  });

  describe('formatReport', () => {
    it('produces readable output with header and rows', async () => {
      const report = await runFull();
      const text = PerformanceBenchmarks.formatReport(report);

      assert.ok(text.includes('Performance Benchmark Report'));
      assert.ok(text.includes('Benchmark'));
      assert.ok(text.includes('Metric'));
      assert.ok(text.includes('Value'));
      assert.ok(text.includes('Budget'));
      assert.ok(text.includes('Status'));
    });

    it('shows PASS/FAIL per benchmark', async () => {
      const report = await runFull();
      const text = PerformanceBenchmarks.formatReport(report);

      // At least model registry should PASS (in-memory, sub-ms)
      assert.ok(text.includes('PASS'));

      // Each benchmark name appears in the output
      for (const r of report.results) {
        assert.ok(text.includes(r.name), `missing benchmark name: ${r.name}`);
      }
    });

    it('shows total/passed/failed summary line', async () => {
      const report = await runFull();
      const text = PerformanceBenchmarks.formatReport(report);

      assert.ok(text.includes(`Total: ${report.total}`));
      assert.ok(text.includes(`Passed: ${report.passed}`));
      assert.ok(text.includes(`Failed: ${report.failed}`));
    });

    it('reports "All benchmarks within budget" when all pass', async () => {
      // Mock a report where everything passes
      const report: BenchmarkReport = {
        timestamp: new Date().toISOString(),
        duration_ms: 100,
        total: 2,
        passed: 2,
        failed: 0,
        results: [
          { name: 'Test A', metric: 'time', value: 5, unit: 'ms', budget: 10, passed: true },
          { name: 'Test B', metric: 'time', value: 3, unit: 'ms', budget: 10, passed: true },
        ],
      };
      const text = PerformanceBenchmarks.formatReport(report);
      assert.ok(text.includes('All benchmarks within budget'));
    });

    it('lists failed benchmarks when some fail', async () => {
      const report: BenchmarkReport = {
        timestamp: new Date().toISOString(),
        duration_ms: 100,
        total: 2,
        passed: 1,
        failed: 1,
        results: [
          { name: 'Test A', metric: 'time', value: 5, unit: 'ms', budget: 10, passed: true },
          { name: 'Test B', metric: 'time', value: 15, unit: 'ms', budget: 10, passed: false, details: 'Too slow' },
        ],
      };
      const text = PerformanceBenchmarks.formatReport(report);
      assert.ok(text.includes('FAILED benchmarks'));
      assert.ok(text.includes('Test B'));
      assert.ok(text.includes('Too slow'));
    });
  });

  describe('--only filtering', () => {
    it('runs only the specified benchmark', async () => {
      const suite = new PerformanceBenchmarks({ only: 'CLI response' });
      const report = await suite.runAll();

      assert.equal(report.total, 1);
      assert.equal(report.results[0].name, 'CLI response');
      assert.equal(report.results[0].metric, 'parse_time');
    });

    it('returns empty report for unknown benchmark name', async () => {
      const suite = new PerformanceBenchmarks({ only: 'Nonexistent' });
      const report = await suite.runAll();

      assert.equal(report.total, 0);
      assert.equal(report.results.length, 0);
    });

    it('can target each benchmark individually', async () => {
      const names = [
        'Session bootstrap', 'Quality gates', 'Wave transition',
        'CLI response', 'Dashboard build', 'Identity load',
        'Knowledge search', 'Model registry',
      ];

      for (const name of names) {
        const suite = new PerformanceBenchmarks({ only: name });
        const report = await suite.runAll();
        assert.equal(report.total, 1, `--only "${name}" should return exactly 1 result`);
        assert.equal(report.results[0].name, name);
      }
    });
  });
});
