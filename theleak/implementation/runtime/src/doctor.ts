// =============================================================================
// doctor.ts — Health-Check System
//
// Six-category validation system with auto-repair capabilities.
// Runs workspace, configuration, credentials, connections, tools, and session
// checks. Each check produces a structured result with pass/warn/fail status.
// Repairable failures are automatically fixed when possible.
//
// Uses OB1Client methods (listTools, runDoctor, getSession, checkBudget, etc.)
// for all Supabase interactions. No raw database access.
//
// Blueprint: 05_doctor_and_boot.md, Section 5
// =============================================================================

import type { OB1Client } from './ob1-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DoctorCategory =
  | 'workspace'
  | 'configuration'
  | 'credentials'
  | 'connections'
  | 'tools'
  | 'sessions';

/** Individual check result */
export interface DoctorCheckResult {
  category: DoctorCategory;
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  autoRepairable: boolean;
  autoRepaired: boolean;
  fixAction?: string;
  durationMs: number;
}

/** Repair attempt result */
export interface RepairResult {
  checkName: string;
  attempted: boolean;
  success: boolean;
  action: string;
  error?: string;
}

/** Complete doctor report */
export interface DoctorReport {
  runId: string;
  timestamp: string;
  totalDurationMs: number;
  mode: 'full' | 'quick';
  checks: DoctorCheckResult[];
  repairs: RepairResult[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
    autoRepaired: number;
    total: number;
  };
}

/** Category execution order — dependencies flow top to bottom */
const CATEGORY_ORDER: DoctorCategory[] = [
  'workspace',
  'configuration',
  'credentials',
  'connections',
  'tools',
  'sessions',
];

/** Quick-mode categories — subset for boot-time checks */
const QUICK_CATEGORIES: DoctorCategory[] = [
  'workspace',
  'credentials',
  'connections',
];

// ---------------------------------------------------------------------------
// Check function signature
// ---------------------------------------------------------------------------

type CheckFn = (client: OB1Client) => Promise<DoctorCheckResult>;

// ---------------------------------------------------------------------------
// DoctorSystem
// ---------------------------------------------------------------------------

export class DoctorSystem {
  private client: OB1Client;
  private checks: Map<DoctorCategory, CheckFn[]> = new Map();

  constructor(client: OB1Client) {
    this.client = client;
    this.registerDefaultChecks();
  }

  // ── Public API ──────────────────────────────────────────────

  /** Run the full doctor check — all 6 categories in dependency order. */
  async runFull(): Promise<DoctorReport> {
    return this.execute(CATEGORY_ORDER, 'full');
  }

  /** Run a quick doctor check — subset for boot-time validation. */
  async runQuick(): Promise<DoctorReport> {
    return this.execute(QUICK_CATEGORIES, 'quick');
  }

  // ── Core execution ──────────────────────────────────────────

  private async execute(categories: DoctorCategory[], mode: 'full' | 'quick'): Promise<DoctorReport> {
    const startMs = Date.now();
    const checks: DoctorCheckResult[] = [];
    const repairs: RepairResult[] = [];

    for (const category of categories) {
      const categoryChecks = this.checks.get(category) ?? [];

      for (const checkFn of categoryChecks) {
        try {
          const result = await checkFn(this.client);
          checks.push(result);

          // Attempt auto-repair for repairable failures
          if (result.status === 'fail' && result.autoRepairable) {
            const repair = await this.attemptRepair(result);
            repairs.push(repair);

            if (repair.success) {
              result.autoRepaired = true;
              result.status = 'warn';
              result.detail += ` (auto-repaired: ${repair.action})`;
            }
          }
        } catch (err: any) {
          checks.push({
            category,
            name: `${category}_check_error`,
            status: 'fail',
            detail: `Check threw unexpectedly: ${err.message}`,
            autoRepairable: false,
            autoRepaired: false,
            durationMs: 0,
          });
        }
      }
    }

    return {
      runId: `doctor_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: new Date().toISOString(),
      totalDurationMs: Date.now() - startMs,
      mode,
      checks,
      repairs,
      summary: {
        pass: checks.filter(c => c.status === 'pass').length,
        warn: checks.filter(c => c.status === 'warn').length,
        fail: checks.filter(c => c.status === 'fail').length,
        autoRepaired: checks.filter(c => c.autoRepaired).length,
        total: checks.length,
      },
    };
  }

  // ── Category check methods (callable independently) ─────────

  async checkWorkspace(): Promise<DoctorCheckResult[]> {
    return this.runCategory('workspace');
  }

  async checkConfiguration(): Promise<DoctorCheckResult[]> {
    return this.runCategory('configuration');
  }

  async checkCredentials(): Promise<DoctorCheckResult[]> {
    return this.runCategory('credentials');
  }

  async checkConnections(): Promise<DoctorCheckResult[]> {
    return this.runCategory('connections');
  }

  async checkTools(): Promise<DoctorCheckResult[]> {
    return this.runCategory('tools');
  }

  async checkSessions(): Promise<DoctorCheckResult[]> {
    return this.runCategory('sessions');
  }

  private async runCategory(category: DoctorCategory): Promise<DoctorCheckResult[]> {
    const fns = this.checks.get(category) ?? [];
    const results: DoctorCheckResult[] = [];
    for (const fn of fns) {
      results.push(await fn(this.client));
    }
    return results;
  }

  // ── Auto-repair ─────────────────────────────────────────────

  private async attemptRepair(check: DoctorCheckResult): Promise<RepairResult> {
    try {
      switch (check.name) {
        case 'claude_md_presence': {
          const fs = await import('fs/promises');
          const path = await import('path');
          const cwd = typeof process !== 'undefined' ? process.cwd() : '.';
          const claudeMdPath = path.join(cwd, 'CLAUDE.md');
          await fs.writeFile(claudeMdPath, [
            '# CLAUDE.md', '', '## Project', '', 'Describe your project here.', '',
            '## Instructions', '', 'Add agent instructions here.', '',
          ].join('\n'), 'utf-8');
          return { checkName: check.name, attempted: true, success: true, action: `Created ${claudeMdPath}` };
        }

        case 'claude_directory': {
          const fs = await import('fs/promises');
          const path = await import('path');
          const cwd = typeof process !== 'undefined' ? process.cwd() : '.';
          await fs.mkdir(path.join(cwd, '.claude'), { recursive: true });
          return { checkName: check.name, attempted: true, success: true, action: 'Created .claude/ directory' };
        }

        default:
          return { checkName: check.name, attempted: false, success: false, action: `No auto-repair handler for "${check.name}"` };
      }
    } catch (err: any) {
      return { checkName: check.name, attempted: true, success: false, action: `Repair failed: ${err.message}`, error: err.message };
    }
  }

  // ── Default check registration ──────────────────────────────

  private registerDefaultChecks(): void {
    // --- Workspace checks ---

    this.addCheck('workspace', async (): Promise<DoctorCheckResult> => {
      const startMs = Date.now();
      try {
        const fs = await import('fs');
        const path = await import('path');
        const cwd = typeof process !== 'undefined' ? process.cwd() : '.';
        const exists = fs.existsSync(path.join(cwd, 'CLAUDE.md'));
        return {
          category: 'workspace', name: 'claude_md_presence',
          status: exists ? 'pass' : 'fail',
          detail: exists ? 'CLAUDE.md found in workspace root' : 'CLAUDE.md not found',
          autoRepairable: !exists, autoRepaired: false,
          fixAction: exists ? undefined : 'Create CLAUDE.md in workspace root',
          durationMs: Date.now() - startMs,
        };
      } catch (err: any) {
        return { category: 'workspace', name: 'claude_md_presence', status: 'fail', detail: `Check failed: ${err.message}`, autoRepairable: false, autoRepaired: false, durationMs: Date.now() - startMs };
      }
    });

    this.addCheck('workspace', async (): Promise<DoctorCheckResult> => {
      const startMs = Date.now();
      try {
        const fs = await import('fs');
        const path = await import('path');
        const cwd = typeof process !== 'undefined' ? process.cwd() : '.';
        const exists = fs.existsSync(path.join(cwd, '.claude'));
        return {
          category: 'workspace', name: 'claude_directory',
          status: exists ? 'pass' : 'warn',
          detail: exists ? '.claude/ directory exists' : '.claude/ directory not found',
          autoRepairable: !exists, autoRepaired: false,
          fixAction: exists ? undefined : 'mkdir .claude',
          durationMs: Date.now() - startMs,
        };
      } catch (err: any) {
        return { category: 'workspace', name: 'claude_directory', status: 'warn', detail: `Check failed: ${err.message}`, autoRepairable: false, autoRepaired: false, durationMs: Date.now() - startMs };
      }
    });

    this.addCheck('workspace', async (): Promise<DoctorCheckResult> => {
      const startMs = Date.now();
      try {
        const { execSync } = await import('child_process');
        const result = execSync('git rev-parse --is-inside-work-tree', { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        return {
          category: 'workspace', name: 'git_state',
          status: result === 'true' ? 'pass' : 'warn',
          detail: result === 'true' ? 'Inside a git repository' : 'Not inside a git repository',
          autoRepairable: false, autoRepaired: false, durationMs: Date.now() - startMs,
        };
      } catch {
        return { category: 'workspace', name: 'git_state', status: 'warn', detail: 'Git not available or not inside a git repository', autoRepairable: false, autoRepaired: false, durationMs: Date.now() - startMs };
      }
    });

    // --- Configuration checks ---

    this.addCheck('configuration', async (): Promise<DoctorCheckResult> => {
      const startMs = Date.now();
      const fs = await import('fs');
      const path = await import('path');
      const cwd = typeof process !== 'undefined' ? process.cwd() : '.';
      const configPaths = [path.join(cwd, '.claude.json'), path.join(cwd, '.claude/settings.json')];
      const found = configPaths.filter(p => fs.existsSync(p));
      return {
        category: 'configuration', name: 'config_files_present',
        status: found.length > 0 ? 'pass' : 'warn',
        detail: found.length > 0 ? `Found ${found.length} config file(s)` : 'No project config files found (using defaults)',
        autoRepairable: false, autoRepaired: false, durationMs: Date.now() - startMs,
      };
    });

    this.addCheck('configuration', async (): Promise<DoctorCheckResult> => {
      const startMs = Date.now();
      const fs = await import('fs');
      const path = await import('path');
      const cwd = typeof process !== 'undefined' ? process.cwd() : '.';
      const hasRoot = fs.existsSync(path.join(cwd, '.claude.json'));
      const hasNested = fs.existsSync(path.join(cwd, '.claude/settings.json'));
      if (hasRoot && hasNested) {
        return { category: 'configuration', name: 'config_conflicts', status: 'warn', detail: 'Both .claude.json and .claude/settings.json exist. Deep merge applies.', autoRepairable: false, autoRepaired: false, durationMs: Date.now() - startMs };
      }
      return { category: 'configuration', name: 'config_conflicts', status: 'pass', detail: 'No config file conflicts', autoRepairable: false, autoRepaired: false, durationMs: Date.now() - startMs };
    });

    // --- Credential checks ---

    this.addCheck('credentials', async (): Promise<DoctorCheckResult> => {
      const startMs = Date.now();
      const env = typeof process !== 'undefined' ? process.env : {};
      const url = !!env.SUPABASE_URL;
      const key = !!env.SUPABASE_SERVICE_ROLE_KEY;
      if (url && key) {
        return { category: 'credentials', name: 'supabase_credentials', status: 'pass', detail: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set', autoRepairable: false, autoRepaired: false, durationMs: Date.now() - startMs };
      }
      const missing: string[] = [];
      if (!url) missing.push('SUPABASE_URL');
      if (!key) missing.push('SUPABASE_SERVICE_ROLE_KEY');
      return { category: 'credentials', name: 'supabase_credentials', status: 'fail', detail: `Missing: ${missing.join(', ')}`, autoRepairable: false, autoRepaired: false, fixAction: 'Set the missing environment variables', durationMs: Date.now() - startMs };
    });

    this.addCheck('credentials', async (): Promise<DoctorCheckResult> => {
      const startMs = Date.now();
      const env = typeof process !== 'undefined' ? process.env : {};
      const key = !!env.ANTHROPIC_API_KEY;
      return {
        category: 'credentials', name: 'api_key',
        status: key ? 'pass' : 'fail',
        detail: key ? 'ANTHROPIC_API_KEY is set' : 'ANTHROPIC_API_KEY is not set',
        autoRepairable: false, autoRepaired: false,
        fixAction: key ? undefined : 'Set ANTHROPIC_API_KEY environment variable',
        durationMs: Date.now() - startMs,
      };
    });

    // --- Connection checks ---

    this.addCheck('connections', async (client): Promise<DoctorCheckResult> => {
      const startMs = Date.now();
      try {
        // Use a lightweight API call to verify Supabase connectivity
        await client.getConfig();
        return { category: 'connections', name: 'supabase_connection', status: 'pass', detail: 'Supabase connection verified', autoRepairable: false, autoRepaired: false, durationMs: Date.now() - startMs };
      } catch (err: any) {
        return { category: 'connections', name: 'supabase_connection', status: 'fail', detail: `Connection error: ${err.message}`, autoRepairable: false, autoRepaired: false, fixAction: 'Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY', durationMs: Date.now() - startMs };
      }
    });

    // --- Tool checks ---

    this.addCheck('tools', async (client): Promise<DoctorCheckResult> => {
      const startMs = Date.now();
      try {
        const tools = await client.listTools({ enabled_only: true });
        return {
          category: 'tools', name: 'tool_registry_loaded',
          status: tools.length > 0 ? 'pass' : 'warn',
          detail: tools.length > 0 ? `${tools.length} enabled tools in registry` : 'Tool registry is empty',
          autoRepairable: false, autoRepaired: false, durationMs: Date.now() - startMs,
        };
      } catch (err: any) {
        return { category: 'tools', name: 'tool_registry_loaded', status: 'fail', detail: `Tool registry check failed: ${err.message}`, autoRepairable: false, autoRepaired: false, durationMs: Date.now() - startMs };
      }
    });

    this.addCheck('tools', async (client): Promise<DoctorCheckResult> => {
      const startMs = Date.now();
      const requiredTools = ['read_file', 'write_file', 'edit_file', 'bash', 'glob_search', 'grep_search'];
      try {
        const tools = await client.listTools({ enabled_only: true });
        const availableNames = new Set(tools.map(t => t.name));
        const missing = requiredTools.filter(t => !availableNames.has(t));
        return {
          category: 'tools', name: 'required_tools_available',
          status: missing.length === 0 ? 'pass' : 'warn',
          detail: missing.length === 0 ? 'All required core tools are available' : `Missing core tools: ${missing.join(', ')}`,
          autoRepairable: false, autoRepaired: false, durationMs: Date.now() - startMs,
        };
      } catch (err: any) {
        return { category: 'tools', name: 'required_tools_available', status: 'warn', detail: `Check failed: ${err.message}`, autoRepairable: false, autoRepaired: false, durationMs: Date.now() - startMs };
      }
    });

    // --- Session checks ---

    this.addCheck('sessions', async (client): Promise<DoctorCheckResult> => {
      const startMs = Date.now();
      try {
        // Use listAgentRuns to check for stuck agents
        const runs = await client.listAgentRuns({ status: 'running', limit: 10 });
        const now = Date.now();
        const stale = runs.filter(r => {
          if (!r.started_at) return false;
          return now - new Date(r.started_at).getTime() > 60 * 60 * 1000;
        });
        if (stale.length === 0) {
          return { category: 'sessions', name: 'orphaned_sessions', status: 'pass', detail: 'No orphaned sessions found', autoRepairable: false, autoRepaired: false, durationMs: Date.now() - startMs };
        }
        return {
          category: 'sessions', name: 'orphaned_sessions', status: 'warn',
          detail: `${stale.length} agent run(s) active but not updated in over 1 hour`,
          autoRepairable: false, autoRepaired: false,
          fixAction: 'Manually cancel stale runs or wait for timeout',
          durationMs: Date.now() - startMs,
        };
      } catch (err: any) {
        return { category: 'sessions', name: 'orphaned_sessions', status: 'warn', detail: `Session check failed: ${err.message}`, autoRepairable: false, autoRepaired: false, durationMs: Date.now() - startMs };
      }
    });

    this.addCheck('sessions', async (client): Promise<DoctorCheckResult> => {
      const startMs = Date.now();
      try {
        const events = await client.queryEvents({ category: 'usage', limit: 1 });
        return { category: 'sessions', name: 'budget_ledger_consistency', status: 'pass', detail: `Budget ledger accessible (${events.length} recent entries)`, autoRepairable: false, autoRepaired: false, durationMs: Date.now() - startMs };
      } catch (err: any) {
        return { category: 'sessions', name: 'budget_ledger_consistency', status: 'warn', detail: `Budget ledger check failed: ${err.message}`, autoRepairable: false, autoRepaired: false, durationMs: Date.now() - startMs };
      }
    });
  }

  // ── Check registration ──────────────────────────────────────

  private addCheck(category: DoctorCategory, fn: CheckFn): void {
    const existing = this.checks.get(category) ?? [];
    existing.push(fn);
    this.checks.set(category, existing);
  }

  // ── Report rendering ────────────────────────────────────────

  static renderReport(report: DoctorReport): string {
    const lines: string[] = [
      '# Doctor Report', '',
      `Run: ${report.runId}`, `Mode: ${report.mode}`, `Time: ${report.timestamp}`, `Duration: ${report.totalDurationMs}ms`, '',
      `## Summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`, '',
    ];

    if (report.summary.autoRepaired > 0) {
      lines.push(`Auto-repaired: ${report.summary.autoRepaired}`, '');
    }

    const grouped = new Map<string, DoctorCheckResult[]>();
    for (const check of report.checks) {
      const group = grouped.get(check.category) ?? [];
      group.push(check);
      grouped.set(check.category, group);
    }

    for (const [category, checks] of grouped) {
      lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}`, '');
      for (const check of checks) {
        const icon = check.status === 'pass' ? '[PASS]' : check.status === 'warn' ? '[WARN]' : '[FAIL]';
        const repaired = check.autoRepaired ? ' (auto-repaired)' : '';
        lines.push(`- ${icon} **${check.name}**: ${check.detail}${repaired}`);
        if (check.fixAction && check.status !== 'pass') {
          lines.push(`  - Fix: ${check.fixAction}`);
        }
      }
      lines.push('');
    }

    if (report.repairs.length > 0) {
      lines.push('### Repair Log', '');
      for (const repair of report.repairs) {
        const status = repair.success ? '[OK]' : '[FAILED]';
        lines.push(`- ${status} ${repair.checkName}: ${repair.action}`);
        if (repair.error) lines.push(`  - Error: ${repair.error}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
