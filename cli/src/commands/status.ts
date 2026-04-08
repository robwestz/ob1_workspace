import { Command } from 'commander';
import chalk from 'chalk';
import type { OB1Config } from '../config.js';
import { statusIcon, header, divider, info } from '../utils/output.js';
import { sshPing } from '../utils/ssh.js';
import { SupabaseClient } from '../utils/supabase.js';

interface CheckResult {
  name: string;
  status: 'up' | 'down' | 'degraded';
  latency: string;
  detail?: string;
}

const EDGE_FUNCTIONS = [
  'ob1-thoughts', 'ob1-recall', 'ob1-reflect',
  'ob1-agent-gateway', 'ob1-night-shift', 'ob1-webhooks', 'ob1-sync',
];

// --- Service checks ---

async function checkSupabase(sb: SupabaseClient): Promise<CheckResult> {
  try {
    const { healthy, latencyMs } = await sb.ping();
    return { name: 'Supabase API', status: healthy ? 'up' : 'degraded', latency: `${latencyMs}ms` };
  } catch (e: any) {
    return { name: 'Supabase API', status: 'down', latency: 'error', detail: e?.message };
  }
}

async function checkMac(config: OB1Config): Promise<CheckResult> {
  if (!config.tailscaleIp) {
    return { name: 'Mac (Tailscale)', status: 'down', latency: 'n/a', detail: 'tailscaleIp not configured' };
  }
  const { reachable, latencyMs } = await sshPing({
    host: config.tailscaleIp,
    user: config.sshUser,
    keyPath: config.sshKeyPath,
  });
  return { name: 'Mac (Tailscale)', status: reachable ? 'up' : 'down', latency: reachable ? `${latencyMs}ms` : 'timeout' };
}

async function checkHttp(label: string, url: string): Promise<CheckResult> {
  try {
    const start = Date.now();
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const ms = Date.now() - start;
    return { name: label, status: res.ok ? 'up' : 'degraded', latency: `${ms}ms` };
  } catch (e: any) {
    const reason = e?.name === 'TimeoutError' ? 'timeout' : 'error';
    return { name: label, status: 'down', latency: reason, detail: e?.message };
  }
}

async function checkEdgeFunctions(sb: SupabaseClient): Promise<CheckResult> {
  const results = await Promise.allSettled(
    EDGE_FUNCTIONS.map((fn) => sb.edgeFunctionHealth(fn))
  );
  const healthy = results.filter(
    (r) => r.status === 'fulfilled' && r.value.healthy
  ).length;
  const total = EDGE_FUNCTIONS.length;
  const status = healthy === total ? 'up' : healthy === 0 ? 'down' : 'degraded';
  return { name: 'Edge Functions', status, latency: `${healthy}/${total} healthy` };
}

// --- Metadata fetchers ---

async function fetchBudget(sb: SupabaseClient): Promise<string | null> {
  try {
    const data = (await sb.rpc('get_budget_summary', {})) as any;
    if (data?.spent != null && data?.budget != null) {
      const pct = ((data.spent / data.budget) * 100).toFixed(1);
      return `$${Number(data.spent).toFixed(2)} / $${Number(data.budget).toFixed(2)} (${pct}%)`;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchLastNightRun(sb: SupabaseClient): Promise<string | null> {
  try {
    const rows = (await sb.query('agent_session_snapshots', {
      session_type: 'eq.night_shift',
      order: 'created_at.desc',
      limit: '1',
      select: 'created_at,wave_count,error_count',
    })) as any[];
    if (rows?.length) {
      const r = rows[0];
      const date = new Date(r.created_at).toISOString().slice(0, 10);
      return `${date} (${r.wave_count ?? '?'} waves, ${r.error_count ?? 0} errors)`;
    }
    return null;
  } catch {
    return null;
  }
}

// --- Formatting helpers ---

function fmtIcon(s: CheckResult['status']): string {
  return statusIcon(s === 'up');
}

function fmtLabel(s: CheckResult['status']): string {
  if (s === 'up') return chalk.green('UP');
  if (s === 'degraded') return chalk.yellow('WARN');
  return chalk.red('DOWN');
}

// --- Command registration ---

export function registerStatusCommand(program: Command, config: OB1Config): void {
  program
    .command('status')
    .description('Check health of all OB1 services')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const sb = new SupabaseClient(config.supabaseUrl, config.supabaseKey);
      const hasTailscale = !!config.tailscaleIp;

      const [checks, budget, nightRun] = await Promise.all([
        Promise.allSettled([
          checkSupabase(sb),
          checkMac(config),
          hasTailscale
            ? checkHttp(`Dashboard (:${config.dashboardPort})`, `http://${config.tailscaleIp}:${config.dashboardPort}`)
            : Promise.resolve({ name: `Dashboard (:${config.dashboardPort})`, status: 'down' as const, latency: 'n/a', detail: 'tailscaleIp not configured' }),
          hasTailscale
            ? checkHttp(`Bacowr (:${config.bacowrPort})`, `http://${config.tailscaleIp}:${config.bacowrPort}/health`)
            : Promise.resolve({ name: `Bacowr (:${config.bacowrPort})`, status: 'down' as const, latency: 'n/a', detail: 'tailscaleIp not configured' }),
          checkEdgeFunctions(sb),
        ]),
        fetchBudget(sb),
        fetchLastNightRun(sb),
      ]);

      const results: CheckResult[] = checks.map((c) =>
        c.status === 'fulfilled'
          ? c.value
          : { name: 'Unknown', status: 'down' as const, latency: 'error' }
      );

      // JSON output mode
      if (options.json) {
        console.log(JSON.stringify({ services: results, budget, lastNightRun: nightRun }, null, 2));
        return;
      }

      // Pretty table output
      header('OB1 Status');
      divider();

      for (const r of results) {
        const icon = fmtIcon(r.status);
        const name = r.name.padEnd(22);
        const label = fmtLabel(r.status).padEnd(14);
        console.log(`  ${icon} ${name}${label}${r.latency}`);
      }

      divider();
      if (budget) info(`Budget: ${budget}`);
      if (nightRun) info(`Last night run: ${nightRun}`);
      if (budget || nightRun) divider();
      console.log();
    });
}
