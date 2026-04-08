// =============================================================================
// Unit Tests — MorningReportWriter
// =============================================================================

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  MorningReportWriter,
  type MorningReportConfig,
  type WaveReportData,
} from '../src/morning-report.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<MorningReportConfig> = {}): MorningReportConfig {
  return {
    path: '/tmp/test-report.md',
    sessionName: 'night-shift-001',
    startedAt: new Date('2026-04-05T22:00:00Z'),
    budgetUsd: 10.0,
    goals: {
      primary: 'Add test coverage to runtime',
      secondary: ['Fix security issues', 'Update docs'],
    },
    ...overrides,
  };
}

function makeWave(overrides: Partial<WaveReportData> = {}): WaveReportData {
  return {
    wave_id: 1,
    wave_name: 'Tests',
    started_at: '2026-04-05T22:05:00Z',
    completed_at: '2026-04-05T22:35:00Z',
    duration_ms: 30 * 60 * 1000,
    tasks_completed: 5,
    tasks_failed: 0,
    usd_spent: 1.50,
    tokens_used: 50_000,
    quality_gates_passed: true,
    gate_details: [
      { name: 'tsc', passed: true, duration_ms: 12_000 },
      { name: 'tests', passed: true, duration_ms: 8_000 },
    ],
    fix_attempts: 0,
    committed: true,
    commit_sha: 'abc1234',
    findings: ['Added 37 tests for budget-tracker', 'Coverage now at 85%'],
    model_usage: [{ model: 'claude-opus-4', tasks: 5, cost: 1.50 }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MorningReportWriter', () => {

  describe('header', () => {
    it('includes session name and date', () => {
      const writer = new MorningReportWriter(makeConfig());
      const md = writer.render();

      assert.ok(md.includes('# Morning Report — 2026-04-05'));
      assert.ok(md.includes('night-shift-001'));
    });

    it('shows running status when not finalized', () => {
      const writer = new MorningReportWriter(makeConfig());
      const md = writer.render();

      assert.ok(md.includes('**Status:** Running'));
    });

    it('shows goals', () => {
      const writer = new MorningReportWriter(makeConfig());
      const md = writer.render();

      assert.ok(md.includes('Add test coverage to runtime'));
      assert.ok(md.includes('Fix security issues'));
      assert.ok(md.includes('Update docs'));
    });
  });

  describe('addWave', () => {
    it('includes wave details in report', async () => {
      const config = makeConfig();
      const writer = new MorningReportWriter(config);
      const wave = makeWave();

      // addWave writes to disk, but we test render() directly
      writer['waves'].push(wave);
      writer['totalUsdSpent'] += wave.usd_spent;
      writer['totalTokensUsed'] += wave.tokens_used;
      const md = writer.render();

      assert.ok(md.includes('### Wave 1: Tests'));
      assert.ok(md.includes('5/5 completed'));
      assert.ok(md.includes('PASSED'));
      assert.ok(md.includes('abc1234'));
      assert.ok(md.includes('$1.50'));
      assert.ok(md.includes('Added 37 tests for budget-tracker'));
    });

    it('shows gate details', () => {
      const writer = new MorningReportWriter(makeConfig());
      const wave = makeWave();
      writer['waves'].push(wave);
      writer['totalUsdSpent'] += wave.usd_spent;
      const md = writer.render();

      assert.ok(md.includes('tsc PASS'));
      assert.ok(md.includes('tests PASS'));
    });

    it('shows fix attempts when non-zero', () => {
      const writer = new MorningReportWriter(makeConfig());
      const wave = makeWave({ fix_attempts: 2 });
      writer['waves'].push(wave);
      writer['totalUsdSpent'] += wave.usd_spent;
      const md = writer.render();

      assert.ok(md.includes('Fix attempts:** 2'));
    });
  });

  describe('multiple waves', () => {
    it('lists waves in order', () => {
      const writer = new MorningReportWriter(makeConfig());
      const wave1 = makeWave({ wave_id: 1, wave_name: 'Tests' });
      const wave2 = makeWave({
        wave_id: 2,
        wave_name: 'Security',
        started_at: '2026-04-05T22:40:00Z',
        completed_at: '2026-04-05T23:10:00Z',
        usd_spent: 2.00,
        tokens_used: 80_000,
        commit_sha: 'def5678',
        model_usage: [{ model: 'claude-sonnet-4', tasks: 3, cost: 2.00 }],
      });

      writer['waves'].push(wave1, wave2);
      writer['totalUsdSpent'] = wave1.usd_spent + wave2.usd_spent;
      writer['totalTokensUsed'] = wave1.tokens_used + wave2.tokens_used;
      const md = writer.render();

      const idx1 = md.indexOf('### Wave 1: Tests');
      const idx2 = md.indexOf('### Wave 2: Security');
      assert.ok(idx1 >= 0, 'Wave 1 should be present');
      assert.ok(idx2 >= 0, 'Wave 2 should be present');
      assert.ok(idx1 < idx2, 'Wave 1 should come before Wave 2');
    });
  });

  describe('budget tracking', () => {
    it('accurately tracks budget across waves', () => {
      const writer = new MorningReportWriter(makeConfig({ budgetUsd: 10.0 }));
      const wave1 = makeWave({ usd_spent: 1.50, tokens_used: 50_000 });
      const wave2 = makeWave({
        wave_id: 2,
        wave_name: 'Wave 2',
        usd_spent: 3.25,
        tokens_used: 100_000,
        started_at: '2026-04-05T22:40:00Z',
        completed_at: '2026-04-05T23:10:00Z',
      });

      writer['waves'].push(wave1, wave2);
      writer['totalUsdSpent'] = 4.75;
      writer['totalTokensUsed'] = 150_000;
      const md = writer.render();

      assert.ok(md.includes('$4.75 / $10.00'));
      assert.ok(md.includes('48%'));
    });

    it('shows 0% when budget is zero', () => {
      const writer = new MorningReportWriter(makeConfig({ budgetUsd: 0 }));
      const md = writer.render();

      assert.ok(md.includes('0%'));
    });
  });

  describe('model usage aggregation', () => {
    it('aggregates model usage across waves', () => {
      const writer = new MorningReportWriter(makeConfig());
      const wave1 = makeWave({
        model_usage: [
          { model: 'claude-opus-4', tasks: 3, cost: 1.00 },
          { model: 'claude-sonnet-4', tasks: 2, cost: 0.50 },
        ],
      });
      const wave2 = makeWave({
        wave_id: 2,
        wave_name: 'Wave 2',
        started_at: '2026-04-05T22:40:00Z',
        completed_at: '2026-04-05T23:10:00Z',
        model_usage: [
          { model: 'claude-opus-4', tasks: 1, cost: 0.75 },
        ],
      });

      writer['waves'].push(wave1, wave2);
      writer['totalUsdSpent'] = wave1.usd_spent + wave2.usd_spent;
      const md = writer.render();

      assert.ok(md.includes('## Model Usage'));
      assert.ok(md.includes('claude-opus-4'));
      assert.ok(md.includes('claude-sonnet-4'));
      // claude-opus-4: 3+1=4 tasks, $1.00+$0.75=$1.75
      assert.ok(md.includes('| claude-opus-4 | 4 | $1.75 |'));
      assert.ok(md.includes('| claude-sonnet-4 | 2 | $0.50 |'));
    });

    it('omits model usage section when no models reported', () => {
      const writer = new MorningReportWriter(makeConfig());
      const wave = makeWave({ model_usage: undefined });
      writer['waves'].push(wave);
      const md = writer.render();

      assert.ok(!md.includes('## Model Usage'));
    });
  });

  describe('finalize', () => {
    it('adds stop reason to status', () => {
      const writer = new MorningReportWriter(makeConfig());
      const md = writer.render('budget exhausted');

      assert.ok(md.includes('Completed — budget exhausted'));
      assert.ok(!md.includes('Running'));
    });
  });

  describe('open items', () => {
    it('extracts findings with action prefixes', () => {
      const writer = new MorningReportWriter(makeConfig());
      const wave = makeWave({
        findings: [
          'Added 37 tests',
          'TODO: Add integration tests for dispatch',
          'FIX: Race condition in budget deduction',
          'BLOCKED: Mac deployment needs physical access',
          'APPROVE: Schema migration 003',
          'Coverage now at 85%',
        ],
      });
      writer['waves'].push(wave);
      const md = writer.render();

      assert.ok(md.includes('## Open Items'));
      assert.ok(md.includes('TODO: Add integration tests for dispatch'));
      assert.ok(md.includes('FIX: Race condition in budget deduction'));
      assert.ok(md.includes('BLOCKED: Mac deployment needs physical access'));
      assert.ok(md.includes('APPROVE: Schema migration 003'));
      // Regular findings should NOT appear in open items
      const openItemsSection = md.slice(md.indexOf('## Open Items'));
      assert.ok(!openItemsSection.includes('Added 37 tests'));
      assert.ok(!openItemsSection.includes('Coverage now at 85%'));
    });

    it('omits open items section when none found', () => {
      const writer = new MorningReportWriter(makeConfig());
      const wave = makeWave({ findings: ['All good', 'Nothing to report'] });
      writer['waves'].push(wave);
      const md = writer.render();

      assert.ok(!md.includes('## Open Items'));
    });
  });

  describe('empty waves', () => {
    it('handles no waves gracefully', () => {
      const writer = new MorningReportWriter(makeConfig());
      const md = writer.render();

      assert.ok(md.includes('# Morning Report'));
      assert.ok(md.includes('No waves completed yet'));
      assert.ok(md.includes('Waves completed | 0'));
      assert.ok(md.includes('Tasks completed | 0'));
    });
  });

  describe('disk write', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'morning-report-test-'));
    });

    it('writes report file to disk via addWave', async () => {
      const reportPath = join(tmpDir, 'sub', 'report.md');
      const writer = new MorningReportWriter(makeConfig({ path: reportPath }));

      await writer.addWave(makeWave());

      const content = await readFile(reportPath, 'utf-8');
      assert.ok(content.includes('# Morning Report'));
      assert.ok(content.includes('### Wave 1: Tests'));
    });

    it('overwrites report on each addWave', async () => {
      const reportPath = join(tmpDir, 'report.md');
      const writer = new MorningReportWriter(makeConfig({ path: reportPath }));

      await writer.addWave(makeWave({ wave_id: 1, wave_name: 'First' }));
      const first = await readFile(reportPath, 'utf-8');
      assert.ok(first.includes('Wave 1: First'));
      assert.ok(!first.includes('Wave 2'));

      await writer.addWave(makeWave({
        wave_id: 2,
        wave_name: 'Second',
        started_at: '2026-04-05T22:40:00Z',
        completed_at: '2026-04-05T23:10:00Z',
      }));
      const second = await readFile(reportPath, 'utf-8');
      assert.ok(second.includes('Wave 1: First'));
      assert.ok(second.includes('Wave 2: Second'));
    });

    it('writes finalized report to disk', async () => {
      const reportPath = join(tmpDir, 'report.md');
      const writer = new MorningReportWriter(makeConfig({ path: reportPath }));

      await writer.addWave(makeWave());
      await writer.finalize('all goals achieved');

      const content = await readFile(reportPath, 'utf-8');
      assert.ok(content.includes('Completed — all goals achieved'));
    });

    // Cleanup
    it('cleanup temp dir', async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });
  });
});
