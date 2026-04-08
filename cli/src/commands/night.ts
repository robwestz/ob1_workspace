import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import chalk from 'chalk';
import type { OB1Config } from '../config.js';
import { sshExec, type SSHConfig } from '../utils/ssh.js';
import { header, success, warn, error, info, divider } from '../utils/output.js';

interface SessionContract {
  name: string;
  goals: { primary: string; secondary?: string[] };
  budget_usd: number;
  duration_hours: number;
  model: string;
  quality_gates?: string[];
  boundaries?: { autonomous?: string[]; requires_approval?: string[] };
}

const REPORT_DIR = '~/workspace/OB1/theleak/implementation';
const RUNNER_DIR = '~/workspace/OB1/theleak/implementation/runtime';
const PGREP_CMD = 'pgrep -f wave-runner && echo RUNNING || echo STOPPED';

function sshCfg(config: OB1Config): SSHConfig {
  return { host: config.tailscaleIp, user: config.sshUser, keyPath: config.sshKeyPath };
}

function requireTailscale(config: OB1Config): void {
  if (!config.tailscaleIp) {
    error('tailscaleIp not configured. Run: ob1 config set tailscaleIp <ip>');
    process.exit(1);
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function isRunnerAlive(ssh: SSHConfig): Promise<boolean> {
  try {
    const { stdout } = await sshExec(ssh, PGREP_CMD, 10_000);
    return stdout.trim().includes('RUNNING');
  } catch {
    return false;
  }
}

async function readRemote(ssh: SSHConfig, cmd: string): Promise<string> {
  try {
    const { stdout } = await sshExec(ssh, cmd, 10_000);
    return stdout;
  } catch {
    return '';
  }
}

function printContract(c: SessionContract): void {
  header('Session Contract');
  info(`Name:     ${c.name}`);
  info(`Goal:     ${c.goals.primary}`);
  for (const s of c.goals.secondary ?? []) info(`          + ${s}`);
  info(`Budget:   $${c.budget_usd}`);
  info(`Duration: ${c.duration_hours}h`);
  info(`Model:    ${c.model}`);
  if (c.quality_gates?.length) info(`Gates:    ${c.quality_gates.join(', ')}`);
  divider();
}

async function buildContract(opts: {
  goal?: string; budget?: string; hours?: string; model?: string; contract?: string;
}): Promise<SessionContract> {
  if (opts.contract) {
    const raw = await readFile(resolve(opts.contract), 'utf-8');
    const c = JSON.parse(raw) as SessionContract;
    if (opts.goal) c.goals.primary = opts.goal;
    if (opts.budget) c.budget_usd = parseFloat(opts.budget);
    if (opts.hours) c.duration_hours = parseFloat(opts.hours);
    if (opts.model) c.model = opts.model;
    return c;
  }
  if (!opts.goal) { error('--goal is required (or provide --contract file)'); process.exit(1); }
  return {
    name: `Night shift ${today()}`,
    goals: { primary: opts.goal },
    budget_usd: parseFloat(opts.budget ?? '25'),
    duration_hours: parseFloat(opts.hours ?? '8'),
    model: opts.model ?? 'sonnet',
  };
}

function validateContract(c: SessionContract): boolean {
  let ok = true;
  if (!c.goals.primary) { error('Contract missing primary goal'); ok = false; }
  if (c.budget_usd <= 0 || isNaN(c.budget_usd)) { error('Budget must be positive'); ok = false; }
  if (c.duration_hours <= 0 || isNaN(c.duration_hours)) { error('Duration must be positive'); ok = false; }
  return ok;
}

export function registerNightCommand(program: Command, config: OB1Config): void {
  const night = program.command('night').description('Manage overnight autonomous sessions');

  // ── ob1 night start ──
  night
    .command('start')
    .description('Start an overnight wave-runner session on the Mac')
    .option('--goal <goal>', 'Primary goal for the session')
    .option('--budget <usd>', 'Maximum USD budget', '25')
    .option('--hours <hours>', 'Maximum duration in hours', '8')
    .option('--model <model>', 'Default model (sonnet, opus, haiku)', 'sonnet')
    .option('--contract <file>', 'Path to session contract YAML/JSON file')
    .option('--dry-run', 'Show what would be executed without starting')
    .action(async (opts) => {
      requireTailscale(config);
      const ssh = sshCfg(config);
      let contract: SessionContract;
      try { contract = await buildContract(opts); }
      catch (e: any) { error(`Failed to load contract: ${e.message}`); process.exit(1); }
      if (!validateContract(contract)) process.exit(1);
      printContract(contract);
      if (opts.dryRun) { warn('Dry run — session not started'); return; }

      const contractJson = JSON.stringify(contract, null, 2);
      try {
        info('Pushing contract to Mac...');
        await sshExec(ssh, `mkdir -p ~/.ob1 && cat > ~/.ob1/active-contract.json << 'CONTRACTEOF'\n${contractJson}\nCONTRACTEOF`, 15_000);
      } catch (e: any) { error(`Failed to push contract: ${e.message}`); process.exit(1); }

      const reportFile = `${REPORT_DIR}/MORNING_REPORT_${today()}.md`;
      const goal = contract.goals.primary.replace(/'/g, "'\\''");
      const startCmd = `cd ${RUNNER_DIR} && nohup node dist/wave-runner.js`
        + ` --goal '${goal}' --budget ${contract.budget_usd}`
        + ` --hours ${contract.duration_hours} --report ${reportFile}`
        + ` > /tmp/ob1-wave-runner.log 2>&1 &`;
      try {
        info('Starting wave-runner...');
        await sshExec(ssh, startCmd, 15_000);
        success('Night session started');
        info(`Report: ${reportFile}`);
        info('Check progress: ob1 night status');
      } catch (e: any) { error(`Failed to start wave-runner: ${e.message}`); process.exit(1); }
    });

  // ── ob1 night status ──
  night
    .command('status')
    .description('Check progress of running overnight session')
    .option('--json', 'Output as JSON')
    .option('--waves', 'Show wave-by-wave details')
    .action(async (opts) => {
      requireTailscale(config);
      const ssh = sshCfg(config);
      const running = await isRunnerAlive(ssh);
      const report = await readRemote(ssh, `cat ${REPORT_DIR}/MORNING_REPORT_${today()}.md 2>/dev/null`);
      const contractRaw = await readRemote(ssh, 'cat ~/.ob1/active-contract.json 2>/dev/null');
      const contract = contractRaw.trim() ? JSON.parse(contractRaw) as SessionContract : null;

      if (opts.json) {
        console.log(JSON.stringify({ running, contract, report: report || null }, null, 2));
        return;
      }

      header('Night Session Status');
      if (running) {
        console.log(`  ${chalk.green('\u25cf')} Wave-runner is ${chalk.green.bold('RUNNING')}`);
      } else {
        console.log(`  ${chalk.red('\u25cb')} Wave-runner is ${chalk.red.bold('STOPPED')}`);
      }
      if (contract) {
        info(`Goal:     ${contract.goals.primary}`);
        info(`Budget:   $${contract.budget_usd}  |  Duration: ${contract.duration_hours}h  |  Model: ${contract.model}`);
      }
      divider();

      if (!report) { info('No report available yet'); }
      else if (opts.waves) { console.log(report); }
      else {
        // Extract summary section or first 20 lines
        const lines = report.split('\n');
        const summary: string[] = [];
        let capturing = false;
        for (const ln of lines) {
          if (ln.startsWith('# ') || ln.startsWith('## Summary')) capturing = true;
          else if (capturing && ln.startsWith('## ')) break;
          if (capturing) summary.push(ln);
        }
        console.log(summary.length ? summary.join('\n') : lines.slice(0, 20).join('\n'));
        info('Use --waves for full wave-by-wave details');
      }
      console.log();
    });

  // ── ob1 night stop ──
  night
    .command('stop')
    .description('Gracefully stop the running overnight session')
    .option('--force', 'Kill immediately instead of graceful shutdown')
    .action(async (opts) => {
      requireTailscale(config);
      const ssh = sshCfg(config);
      if (!(await isRunnerAlive(ssh))) { warn('No wave-runner process found'); return; }

      const signal = opts.force ? '-9' : '-TERM';
      info(`${opts.force ? 'Force-killing' : 'Gracefully stopping'} wave-runner...`);
      try { await sshExec(ssh, `pkill ${signal} -f wave-runner`, 10_000); }
      catch { /* pkill exits non-zero when process already gone */ }

      if (opts.force) { success('Wave-runner killed'); return; }

      info('Waiting for graceful shutdown (up to 30s)...');
      const deadline = Date.now() + 30_000;
      let stopped = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2_000));
        if (!(await isRunnerAlive(ssh))) { stopped = true; break; }
      }
      if (stopped) success('Wave-runner stopped');
      else warn('Process did not stop within 30s. Use --force to kill immediately.');
    });

  // ── ob1 night report ──
  night
    .command('report')
    .description('View the latest morning report')
    .option('--date <date>', 'View report from specific date (YYYY-MM-DD)')
    .option('--raw', 'Show raw markdown instead of formatted output')
    .action(async (opts) => {
      requireTailscale(config);
      const ssh = sshCfg(config);
      let report: string;

      if (opts.date) {
        report = await readRemote(ssh, `cat ${REPORT_DIR}/MORNING_REPORT_${opts.date}.md`);
        if (!report) { error(`No report found for ${opts.date}`); process.exit(1); }
      } else {
        report = await readRemote(ssh, `ls -t ${REPORT_DIR}/MORNING_REPORT_*.md 2>/dev/null | head -1 | xargs cat`);
        if (!report) { error('No morning reports found'); process.exit(1); }
      }
      if (!report.trim()) { warn('Report file is empty'); return; }

      if (opts.raw) { console.log(report); return; }
      header('Morning Report');
      const fmt = report
        .replace(/^# (.+)$/gm, chalk.bold.cyan('  $1'))
        .replace(/^## (.+)$/gm, chalk.bold.white('\n  $1'))
        .replace(/^### (.+)$/gm, chalk.gray('  $1'))
        .replace(/^- \[x\]/gm, `  ${chalk.green('\u2713')}`)
        .replace(/^- \[ \]/gm, `  ${chalk.red('\u25cb')}`)
        .replace(/^- /gm, `  ${chalk.gray('\u2022')} `);
      console.log(fmt);
      console.log();
    });
}
