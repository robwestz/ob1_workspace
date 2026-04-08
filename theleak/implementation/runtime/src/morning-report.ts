// morning-report.ts — Incremental morning report writer
// Updated after EVERY wave for crash-safety: if session dies at wave 4,
// Robin has waves 1-3 documented.

import { writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// -- Types ------------------------------------------------------------------

export interface MorningReportConfig {
  path: string;
  sessionName: string;
  startedAt: Date;
  budgetUsd: number;
  goals: {
    primary: string;
    secondary?: string[];
  };
}

export interface WaveReportData {
  wave_id: number;
  wave_name: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  tasks_completed: number;
  tasks_failed: number;
  usd_spent: number;
  tokens_used: number;
  quality_gates_passed: boolean;
  gate_details: Array<{ name: string; passed: boolean; duration_ms: number }>;
  fix_attempts: number;
  committed: boolean;
  commit_sha?: string;
  findings: string[];
  model_usage?: Array<{ model: string; tasks: number; cost: number }>;
}

// -- Helpers ----------------------------------------------------------------

const OPEN_ITEM_PREFIXES = ['TODO:', 'FIX:', 'BLOCKED:', 'APPROVE:'] as const;

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function pct(spent: number, budget: number): string {
  if (budget <= 0) return '0%';
  return `${Math.round((spent / budget) * 100)}%`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isoTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
}

function extractOpenItems(waves: WaveReportData[]): string[] {
  const items: string[] = [];
  for (const wave of waves) {
    for (const finding of wave.findings) {
      const trimmed = finding.trimStart();
      if (OPEN_ITEM_PREFIXES.some((p) => trimmed.startsWith(p))) {
        items.push(trimmed);
      }
    }
  }
  return items;
}

// -- Writer -----------------------------------------------------------------

export class MorningReportWriter {
  private config: MorningReportConfig;
  private waves: WaveReportData[] = [];
  private totalUsdSpent = 0;
  private totalTokensUsed = 0;

  constructor(config: MorningReportConfig) {
    this.config = config;
  }

  /** Add a completed wave and rewrite the report to disk. */
  async addWave(wave: WaveReportData): Promise<void> {
    this.waves.push(wave);
    this.totalUsdSpent += wave.usd_spent;
    this.totalTokensUsed += wave.tokens_used;
    await this.write();
  }

  /** Finalize the report with a session-end summary. */
  async finalize(stopReason: string): Promise<void> {
    await this.write(stopReason);
  }

  /** Generate and write the full report to disk. */
  private async write(stopReason?: string): Promise<void> {
    const md = this.render(stopReason);
    await mkdir(dirname(this.config.path), { recursive: true });
    await writeFile(this.config.path, md, 'utf-8');
  }

  /** Render the complete report as markdown. */
  render(stopReason?: string): string {
    const { config, waves, totalUsdSpent, totalTokensUsed } = this;
    const lines: string[] = [];
    const push = (s = '') => lines.push(s);

    // -- Header -------------------------------------------------------------
    push(`# Morning Report — ${isoDate(config.startedAt)}`);
    push();
    push(`**Session:** ${config.sessionName}`);
    push(`**Started:** ${isoTime(config.startedAt)} | **Budget:** ${formatUsd(totalUsdSpent)} / ${formatUsd(config.budgetUsd)} (${pct(totalUsdSpent, config.budgetUsd)})`);
    const status = stopReason ? `Completed — ${stopReason}` : 'Running';
    push(`**Status:** ${status}`);
    push();

    // -- Goals --------------------------------------------------------------
    push('## Goals');
    push();
    push(`**Primary:** ${config.goals.primary}`);
    if (config.goals.secondary?.length) {
      push('**Secondary:**');
      for (const g of config.goals.secondary) {
        push(`- ${g}`);
      }
    }
    push();

    // -- Waves --------------------------------------------------------------
    push('## Waves');
    push();

    if (waves.length === 0) {
      push('_No waves completed yet._');
      push();
    }

    for (const w of waves) {
      push(`### Wave ${w.wave_id}: ${w.wave_name}`);
      push();

      const totalTasks = w.tasks_completed + w.tasks_failed;
      const gatesStatus = w.quality_gates_passed ? 'PASSED' : 'FAILED';
      push(`- **Duration:** ${formatDuration(w.duration_ms)} | **Cost:** ${formatUsd(w.usd_spent)} | **Tokens:** ${w.tokens_used.toLocaleString()}`);
      push(`- **Tasks:** ${w.tasks_completed}/${totalTasks} completed | **Gates:** ${gatesStatus}`);

      if (w.gate_details.length > 0) {
        push(`- **Gate details:** ${w.gate_details.map((g) => `${g.name} ${g.passed ? 'PASS' : 'FAIL'} (${formatDuration(g.duration_ms)})`).join(', ')}`);
      }
      if (w.fix_attempts > 0) {
        push(`- **Fix attempts:** ${w.fix_attempts}`);
      }
      if (w.committed) {
        push(`- **Commit:** \`${w.commit_sha ?? 'unknown'}\``);
      }

      if (w.findings.length > 0) {
        push('- **Findings:**');
        for (const f of w.findings) {
          push(`  - ${f}`);
        }
      }

      if (w.model_usage?.length) {
        push(`- **Models:** ${w.model_usage.map((m) => `${m.model} (${m.tasks} tasks, ${formatUsd(m.cost)})`).join(', ')}`);
      }
      push();
    }

    // -- Summary table ------------------------------------------------------
    push('## Summary');
    push();

    const totalTasks = waves.reduce((s, w) => s + w.tasks_completed, 0);
    const totalFailed = waves.reduce((s, w) => s + w.tasks_failed, 0);
    const gatesPassed = waves.filter((w) => w.quality_gates_passed).length;
    const elapsed = waves.length > 0
      ? new Date(waves[waves.length - 1].completed_at).getTime() - config.startedAt.getTime()
      : 0;

    push('| Metric | Value |');
    push('|--------|-------|');
    push(`| Waves completed | ${waves.length} |`);
    push(`| Tasks completed | ${totalTasks} |`);
    push(`| Tasks failed | ${totalFailed} |`);
    push(`| Budget spent | ${formatUsd(totalUsdSpent)} / ${formatUsd(config.budgetUsd)} (${pct(totalUsdSpent, config.budgetUsd)}) |`);
    push(`| Tokens used | ${totalTokensUsed.toLocaleString()} |`);
    push(`| Quality gates | ${gatesPassed}/${waves.length} passed |`);
    push(`| Duration | ${formatDuration(elapsed)} |`);
    push();

    // -- Model usage aggregate ----------------------------------------------
    const modelMap = new Map<string, { tasks: number; cost: number }>();
    for (const w of waves) {
      for (const m of w.model_usage ?? []) {
        const entry = modelMap.get(m.model) ?? { tasks: 0, cost: 0 };
        entry.tasks += m.tasks;
        entry.cost += m.cost;
        modelMap.set(m.model, entry);
      }
    }
    if (modelMap.size > 0) {
      push('## Model Usage');
      push();
      push('| Model | Tasks | Cost |');
      push('|-------|-------|------|');
      for (const [model, data] of modelMap) {
        push(`| ${model} | ${data.tasks} | ${formatUsd(data.cost)} |`);
      }
      push();
    }

    // -- Open items ---------------------------------------------------------
    const openItems = extractOpenItems(waves);
    if (openItems.length > 0) {
      push('## Open Items');
      push();
      for (const item of openItems) {
        push(`- ${item}`);
      }
      push();
    }

    return lines.join('\n');
  }
}
