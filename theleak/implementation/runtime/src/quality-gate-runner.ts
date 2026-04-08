// quality-gate-runner.ts — Real verification commands between waves.
// Standalone module called by WaveRunner to verify code quality.

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface QualityGateConfig {
  name: string;
  command: string;
  success_pattern?: string;    // regex — output must match for pass
  failure_pattern?: string;    // regex — if matched, gate fails
  timeout_ms: number;          // default 120000
  required: boolean;           // if false, warn but don't block
  working_dir?: string;        // cwd for the command
}

export interface QualityGateResult {
  name: string;
  passed: boolean;
  required: boolean;
  output: string;              // stdout + stderr (truncated to 2000 chars)
  duration_ms: number;
  error?: string;              // if the command itself failed
}

export interface GateRunSummary {
  all_required_passed: boolean;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  results: QualityGateResult[];
}

export class QualityGateRunner {
  private gates: QualityGateConfig[];

  constructor(gates?: QualityGateConfig[]) {
    this.gates = gates ?? QualityGateRunner.defaultGates();
  }

  /**
   * Run all quality gates sequentially. Returns summary.
   * Sequential because gates may depend on each other (tsc before tests).
   */
  async runAll(): Promise<GateRunSummary> {
    const results: QualityGateResult[] = [];
    const startTime = Date.now();

    for (const gate of this.gates) {
      const result = await this.runGate(gate);
      results.push(result);

      // If a required gate fails, skip remaining gates
      if (!result.passed && gate.required) {
        for (const remaining of this.gates.slice(results.length)) {
          results.push({
            name: remaining.name,
            passed: false,
            required: remaining.required,
            output: 'Skipped: previous required gate failed',
            duration_ms: 0,
          });
        }
        break;
      }
    }

    return {
      all_required_passed: results.filter(r => r.required).every(r => r.passed),
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed && r.output !== 'Skipped: previous required gate failed').length,
      skipped: results.filter(r => r.output === 'Skipped: previous required gate failed').length,
      duration_ms: Date.now() - startTime,
      results,
    };
  }

  /**
   * Run a single gate.
   */
  async runGate(gate: QualityGateConfig): Promise<QualityGateResult> {
    const startTime = Date.now();

    try {
      const { stdout, stderr } = await execAsync(gate.command, {
        timeout: gate.timeout_ms || 120000,
        cwd: gate.working_dir,
        maxBuffer: 10 * 1024 * 1024,  // 10MB
      });

      const output = (stdout + '\n' + stderr).trim();
      const truncated = output.length > 2000 ? output.slice(-2000) + '\n...(truncated)' : output;

      let passed = true;

      if (gate.failure_pattern) {
        const regex = new RegExp(gate.failure_pattern, 'i');
        if (regex.test(output)) passed = false;
      }

      if (gate.success_pattern) {
        const regex = new RegExp(gate.success_pattern, 'i');
        if (!regex.test(output)) passed = false;
      }

      return {
        name: gate.name,
        passed,
        required: gate.required,
        output: truncated,
        duration_ms: Date.now() - startTime,
      };

    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; killed?: boolean; message: string };
      const output = ((e.stdout ?? '') + '\n' + (e.stderr ?? '')).trim();
      const truncated = output.length > 2000 ? output.slice(-2000) + '\n...(truncated)' : output;

      return {
        name: gate.name,
        passed: false,
        required: gate.required,
        output: truncated,
        duration_ms: Date.now() - startTime,
        error: e.killed ? `Timeout after ${gate.timeout_ms}ms` : e.message,
      };
    }
  }

  /** Default quality gates for the OB1 project. */
  static defaultGates(): QualityGateConfig[] {
    const tsc = (name: string, dir: string, ms = 120000): QualityGateConfig =>
      ({ name, command: 'npx tsc --noEmit', failure_pattern: 'error TS', timeout_ms: ms, required: true, working_dir: dir });
    return [
      tsc('tsc-runtime', 'theleak/implementation/runtime'),
      tsc('tsc-dashboard', 'theleak/implementation/gui'),
      tsc('tsc-cli', 'cli', 60000),
      { name: 'tests-runtime', command: 'npm test', success_pattern: 'fail 0', failure_pattern: 'fail [1-9]',
        timeout_ms: 120000, required: true, working_dir: 'theleak/implementation/runtime' },
      { name: 'tests-dashboard', command: 'npx vitest run', success_pattern: 'Tests.*passed', failure_pattern: 'Tests.*failed',
        timeout_ms: 120000, required: true, working_dir: 'theleak/implementation/gui' },
      { name: 'build-dashboard', command: 'npx next build', failure_pattern: 'Build error|Failed to compile',
        timeout_ms: 180000, required: false, working_dir: 'theleak/implementation/gui' },
    ];
  }

  /**
   * Format results for logging/display.
   */
  static formatSummary(summary: GateRunSummary): string {
    const lines: string[] = ['Quality Gates:'];
    for (const r of summary.results) {
      const icon = r.passed ? 'PASS' : r.output.startsWith('Skipped') ? 'SKIP' : 'FAIL';
      const suffix = r.required ? '' : ' (optional)';
      const time = r.duration_ms > 0 ? ` (${(r.duration_ms / 1000).toFixed(1)}s)` : '';
      lines.push(`  [${icon}] ${r.name}${suffix}${time}`);
      if (!r.passed && r.error) {
        lines.push(`    Error: ${r.error}`);
      }
    }
    lines.push(`  ${summary.passed}/${summary.total} passed in ${(summary.duration_ms / 1000).toFixed(1)}s`);
    return lines.join('\n');
  }
}
