import { Command } from 'commander';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import type { OB1Config } from '../config.js';
import { sshExec, type SSHConfig } from '../utils/ssh.js';
import { header, success, error, warn, info, divider, table } from '../utils/output.js';

const execAsync = promisify(exec);
const HISTORY_PATH = join(homedir(), '.ob1', 'deploy-history.json');
const REMOTE_REPO = '~/workspace/OB1';

interface DeployRecord {
  timestamp: string;
  from_sha: string;
  to_sha: string;
  affected_services: string[];
  status: 'success' | 'failed' | 'rolled_back';
  duration_ms: number;
  rollback_sha: string;
}

const SERVICE_MAP: Record<string, { plist: string; dirs: string[]; buildCmd?: string; healthUrl?: string }> = {
  runtime: {
    plist: 'com.ob1.runtime',
    dirs: ['theleak/implementation/runtime/'],
    buildCmd: 'cd theleak/implementation/runtime && npm run build',
  },
  dashboard: {
    plist: 'com.ob1.dashboard',
    dirs: ['theleak/implementation/gui/'],
    buildCmd: 'cd theleak/implementation/gui && npm run build',
    healthUrl: 'http://localhost:3000',
  },
  bacowr: {
    plist: 'com.bacowr.worker',
    dirs: ['projects/Bacowr-v6.3/worker/'],
    healthUrl: 'http://localhost:8080/health',
  },
  functions: {
    plist: '',
    dirs: ['theleak/implementation/functions/'],
    buildCmd: 'supabase functions deploy',
  },
};

// --- Helpers ---

function toSSH(c: OB1Config): SSHConfig {
  return { host: c.tailscaleIp, user: c.sshUser, keyPath: c.sshKeyPath };
}

function requireTailscale(c: OB1Config): void {
  if (!c.tailscaleIp) {
    error('No Tailscale IP configured. Run: ob1 config set tailscaleIp <ip>');
    process.exit(1);
  }
}

function loadHistory(): DeployRecord[] {
  if (!existsSync(HISTORY_PATH)) return [];
  try { return JSON.parse(readFileSync(HISTORY_PATH, 'utf-8')); } catch { return []; }
}

function appendDeploy(record: DeployRecord): void {
  const dir = join(homedir(), '.ob1');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const h = loadHistory();
  h.push(record);
  if (h.length > 100) h.splice(0, h.length - 100);
  writeFileSync(HISTORY_PATH, JSON.stringify(h, null, 2) + '\n', 'utf-8');
}

function detectAffected(files: string[]): string[] {
  const hit = new Set<string>();
  for (const f of files)
    for (const [name, def] of Object.entries(SERVICE_MAP))
      if (def.dirs.some((d) => f.startsWith(d))) hit.add(name);
  return [...hit];
}

function step(label: string): void { process.stdout.write(chalk.cyan(`  -> ${label}... `)); }
function stepOk(msg = 'done'): void { console.log(chalk.green(msg)); }
function stepFail(msg = 'failed'): void { console.log(chalk.red(msg)); }

async function ssh(c: SSHConfig, cmd: string, timeout = 60_000): Promise<string> {
  const { stdout } = await sshExec(c, cmd, timeout);
  return stdout.trim();
}

async function healthPoll(c: SSHConfig, url: string): Promise<boolean> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const code = await ssh(c, `curl -s -o /dev/null -w '%{http_code}' --max-time 5 ${url}`, 10_000);
      if (code === '200') return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  return false;
}

async function restartSvc(c: SSHConfig, plist: string): Promise<void> {
  const p = `~/Library/LaunchAgents/${plist}.plist`;
  await ssh(c, `launchctl unload ${p} 2>/dev/null; launchctl load ${p}`);
}

async function doRollback(c: SSHConfig, sha: string, services: string[]): Promise<void> {
  header('ROLLBACK');
  warn(`Rolling back to ${sha.slice(0, 8)}`);
  step('Resetting to previous commit');
  await ssh(c, `cd ${REMOTE_REPO} && git reset --hard ${sha}`);
  stepOk();
  for (const svc of services) {
    const def = SERVICE_MAP[svc];
    if (!def) continue;
    if (def.buildCmd) {
      step(`Rebuilding ${svc}`);
      try { await ssh(c, `cd ${REMOTE_REPO} && ${def.buildCmd}`, 120_000); stepOk(); }
      catch { stepFail(); error(`Rebuild of ${svc} failed. Manual intervention needed.`); }
    }
    if (def.plist) {
      step(`Restarting ${svc}`);
      try { await restartSvc(c, def.plist); stepOk(); } catch { stepFail(); }
    }
  }
  success('Rollback complete.');
}

function failDeploy(
  from: string, to: string, services: string[], start: number, rollSha: string,
): void {
  appendDeploy({
    timestamp: new Date().toISOString(), from_sha: from, to_sha: to,
    affected_services: services, status: 'rolled_back',
    duration_ms: Date.now() - start, rollback_sha: rollSha,
  });
}

// --- Command registration ---

export function registerDeployCommand(program: Command, config: OB1Config): void {
  const deploy = program.command('deploy').description('Deploy code to Mac agent host');

  deploy
    .command('push')
    .description('Full deploy: push -> pull -> build -> restart -> verify')
    .option('--skip-gates', 'Skip pre-deploy quality gates')
    .option('--skip-build', 'Skip build step')
    .option('--dry-run', 'Show what would happen without executing')
    .option('--force', 'Deploy even if quality gates fail')
    .action(async (opts) => {
      requireTailscale(config);
      const sc = toSSH(config);
      const t0 = Date.now();
      let fromSha = '', toSha = '', affected: string[] = [];

      header('OB1 Deploy');

      // 1 — Quality gates
      if (!opts.skipGates) {
        step('Running quality gates (tsc)');
        try { await execAsync('npx tsc --noEmit', { cwd: process.cwd(), timeout: 60_000 }); stepOk('pass'); }
        catch (e: any) {
          stepFail();
          const out = ((e.stdout ?? '') + '\n' + (e.stderr ?? '')).trim();
          if (out) console.log(chalk.gray(out));
          if (!opts.force) { error('Gates failed. Use --force to override.'); process.exit(1); }
          warn('Continuing despite failures (--force)');
        }
      } else { info('Skipping quality gates (--skip-gates)'); }

      // 2 — Snapshot remote
      step('Snapshotting remote state');
      try { fromSha = await ssh(sc, `cd ${REMOTE_REPO} && git rev-parse HEAD`); stepOk(fromSha.slice(0, 8)); }
      catch (e: any) { stepFail(); error(`Cannot reach Mac: ${e.message ?? ''}`); process.exit(1); }

      // 3 — Push
      step('Pushing to remote');
      try {
        const { stderr } = await execAsync('git push', { timeout: 30_000 });
        stepOk(stderr.includes('Everything up-to-date') ? 'up-to-date' : 'pushed');
      } catch (e: any) { stepFail(); error(`Git push failed: ${e.message ?? ''}`); process.exit(1); }

      // 4 — Pull on Mac
      step('Pulling on Mac');
      try {
        await ssh(sc, `cd ${REMOTE_REPO} && git pull --ff-only`, 30_000);
        toSha = await ssh(sc, `cd ${REMOTE_REPO} && git rev-parse HEAD`);
        stepOk(toSha.slice(0, 8));
      } catch (e: any) { stepFail(); error(`Git pull failed: ${e.message ?? ''}`); process.exit(1); }

      // 5 — Detect affected services
      step('Detecting affected services');
      if (fromSha === toSha) { stepOk('no changes'); info('Nothing new to deploy.'); return; }
      try {
        const diff = await ssh(sc, `cd ${REMOTE_REPO} && git diff --name-only ${fromSha}..${toSha}`);
        affected = detectAffected(diff.split('\n').filter(Boolean));
        if (!affected.length) {
          stepOk('none');
          info('Changed files do not map to any managed service.');
          appendDeploy({ timestamp: new Date().toISOString(), from_sha: fromSha, to_sha: toSha,
            affected_services: [], status: 'success', duration_ms: Date.now() - t0, rollback_sha: fromSha });
          return;
        }
        stepOk(affected.join(', '));
      } catch (e: any) { stepFail(); error(`Diff failed: ${e.message ?? ''}`); process.exit(1); }

      if (opts.dryRun) {
        divider();
        info('Dry run. Would build and restart:');
        for (const s of affected) info(`  ${s}: build=${SERVICE_MAP[s].buildCmd ?? 'none'}, plist=${SERVICE_MAP[s].plist || 'none'}`);
        return;
      }

      // 6 — Build
      if (!opts.skipBuild) {
        for (const svc of affected) {
          const def = SERVICE_MAP[svc];
          if (!def.buildCmd) continue;
          step(`Building ${svc}`);
          try { await ssh(sc, `cd ${REMOTE_REPO} && ${def.buildCmd}`, 120_000); stepOk(); }
          catch { stepFail(); error(`Build failed for ${svc}.`);
            await doRollback(sc, fromSha, affected); failDeploy(fromSha, toSha, affected, t0, fromSha); process.exit(1); }
        }
      } else { info('Skipping builds (--skip-build)'); }

      // 7 — Restart
      for (const svc of affected) {
        const def = SERVICE_MAP[svc];
        if (!def.plist) continue;
        step(`Restarting ${svc}`);
        try { await restartSvc(sc, def.plist); stepOk(); }
        catch (e: any) { stepFail(); error(`Restart failed for ${svc}.`);
          await doRollback(sc, fromSha, affected); failDeploy(fromSha, toSha, affected, t0, fromSha); process.exit(1); }
      }

      // 8 — Health checks
      let healthy = true;
      for (const svc of affected) {
        const def = SERVICE_MAP[svc];
        if (!def.healthUrl) continue;
        step(`Health check: ${svc}`);
        if (await healthPoll(sc, def.healthUrl)) { stepOk('healthy'); }
        else { stepFail('unhealthy'); healthy = false; }
      }

      // 9 — Auto-rollback on failure
      if (!healthy) {
        error('Health checks failed. Initiating rollback.');
        await doRollback(sc, fromSha, affected);
        failDeploy(fromSha, toSha, affected, t0, fromSha);
        process.exit(1);
      }

      // 10 — Record success
      const dur = Date.now() - t0;
      appendDeploy({ timestamp: new Date().toISOString(), from_sha: fromSha, to_sha: toSha,
        affected_services: affected, status: 'success', duration_ms: dur, rollback_sha: fromSha });
      divider();
      success(`Deploy complete in ${(dur / 1000).toFixed(1)}s`);
      info(`${fromSha.slice(0, 8)} -> ${toSha.slice(0, 8)} | services: ${affected.join(', ')}`);
    });

  // ---- ob1 deploy rollback ----
  deploy
    .command('rollback')
    .description('Rollback to previous deploy')
    .option('--sha <sha>', 'Rollback to a specific SHA (defaults to last deploy)')
    .action(async (opts) => {
      requireTailscale(config);
      const sc = toSSH(config);
      const t0 = Date.now();
      header('OB1 Rollback');

      const history = loadHistory();
      let targetSha: string, services: string[];

      if (opts.sha) {
        targetSha = opts.sha as string;
        services = Object.keys(SERVICE_MAP).filter((s) => SERVICE_MAP[s].plist);
      } else {
        const last = [...history].reverse().find((r) => r.status === 'success');
        if (!last) { error('No previous successful deploy found in history.'); process.exit(1); }
        targetSha = last.rollback_sha;
        services = last.affected_services.length ? last.affected_services
          : Object.keys(SERVICE_MAP).filter((s) => SERVICE_MAP[s].plist);
      }

      info(`Target: ${targetSha.slice(0, 8)} | Services: ${services.join(', ')}`);
      const currentSha = await ssh(sc, `cd ${REMOTE_REPO} && git rev-parse HEAD`);
      await doRollback(sc, targetSha, services);

      appendDeploy({ timestamp: new Date().toISOString(), from_sha: currentSha, to_sha: targetSha,
        affected_services: services, status: 'rolled_back',
        duration_ms: Date.now() - t0, rollback_sha: currentSha });
      divider();
      success('Rollback recorded in deploy history.');
    });

  // ---- ob1 deploy history ----
  deploy
    .command('history')
    .description('Show deploy history')
    .option('-n, --count <n>', 'Number of deploys to show', '10')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const all = loadHistory();
      const n = Math.min(parseInt(opts.count, 10) || 10, all.length);
      const entries = all.slice(-n);
      if (!entries.length) { info('No deploy history found.'); return; }
      if (opts.json) { console.log(JSON.stringify(entries, null, 2)); return; }

      header('Deploy History');
      const rows = entries.reverse().map((r) => [
        new Date(r.timestamp).toLocaleString(),
        `${r.from_sha.slice(0, 7)}..${r.to_sha.slice(0, 7)}`,
        r.affected_services.join(', ') || '-',
        `${(r.duration_ms / 1000).toFixed(1)}s`,
        r.status === 'success' ? chalk.green(r.status) :
          r.status === 'rolled_back' ? chalk.yellow(r.status) : chalk.red(r.status),
      ]);
      table(['Date', 'SHAs', 'Services', 'Duration', 'Status'], rows);
      console.log();
    });
}
