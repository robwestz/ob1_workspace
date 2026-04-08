import { Command } from 'commander';
import { existsSync } from 'node:fs';
import type { OB1Config } from '../config.js';
import { sshExec, sshStream, type SSHConfig } from '../utils/ssh.js';
import { header, error, warn, info } from '../utils/output.js';
import chalk from 'chalk';

type LogService = 'runtime' | 'dashboard' | 'bacowr' | 'gateway' | 'system';

const LOG_PATHS: Record<LogService, string> = {
  runtime: '/tmp/ob1-runtime.log',
  dashboard: '/tmp/ob1-dashboard.log',
  bacowr: '/tmp/bacowr-worker.log',
  gateway: '/tmp/openclaw-gateway.log',
  system: '/var/log/system.log',
};

const VALID_LEVELS = ['error', 'warn', 'info', 'debug'] as const;

function toSSHConfig(config: OB1Config): SSHConfig {
  return { host: config.tailscaleIp, user: config.sshUser, keyPath: config.sshKeyPath };
}

function validateConfig(config: OB1Config): boolean {
  if (!config.tailscaleIp) {
    error('No Tailscale IP configured. Run: ob1 config set tailscaleIp <ip>');
    return false;
  }
  if (config.sshKeyPath && !existsSync(config.sshKeyPath)) {
    error(`SSH key not found: ${config.sshKeyPath}`);
    info('Check OB1_SSH_KEY_PATH or ~/.ob1/config.json sshKeyPath');
    return false;
  }
  return true;
}

function colorizeLogLine(line: string): string {
  if (/\berror\b/i.test(line)) return chalk.red(line);
  if (/\bwarn(ing)?\b/i.test(line)) return chalk.yellow(line);
  if (/\bdebug\b/i.test(line)) return chalk.gray(line);
  return line;
}

function filterByLevel(text: string, level?: string): string {
  if (!level) return text;
  const lvl = level.toLowerCase();
  return text
    .split('\n')
    .filter((line) => {
      if (!line.trim()) return false;
      return new RegExp(`\\b${lvl}\\b`, 'i').test(line);
    })
    .join('\n');
}

function buildSinceFilter(since: string, logPath: string): string {
  // Duration format: "1h", "30m", "2d"
  const durationMatch = since.match(/^(\d+)([smhd])$/);
  if (durationMatch) {
    const [, amount, unit] = durationMatch;
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    const seconds = parseInt(amount, 10) * (multipliers[unit] ?? 60);
    // Use perl for portable date math on macOS
    return `perl -e 'use POSIX; my $cutoff=time()-${seconds}; while(<>){if(/^(\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2})/){my $t=$1; $t=~s/T/ /; my @p=split(/[- :]/, $t); my $e=mktime($p[5],$p[4],$p[3],$p[2],$p[1]-1,$p[0]-1900); print if $e>=$cutoff}else{print}}' ${logPath}`;
  }
  // Assume ISO-ish date — grep lines after that timestamp
  return `awk '/${since.replace(/\//g, '\\/')}/{found=1} found' ${logPath}`;
}

export function registerLogsCommand(program: Command, config: OB1Config): void {
  program
    .command('logs [service]')
    .description('Stream logs from Mac agent host')
    .option('-f, --follow', 'Follow log output (like tail -f)')
    .option('--since <time>', 'Show logs since duration or timestamp (e.g., "1h", "2024-01-01")')
    .option('--level <level>', 'Filter by log level (error, warn, info, debug)')
    .option('-n, --lines <count>', 'Number of lines to show', '50')
    .option('--all', 'Show logs from all services')
    .action(async (service: string | undefined, options) => {
      if (!validateConfig(config)) process.exit(1);

      // Validate service name
      if (service && !LOG_PATHS[service as LogService]) {
        error(`Unknown service: ${service}`);
        info(`Available: ${Object.keys(LOG_PATHS).join(', ')}`);
        process.exit(1);
      }

      // Validate level
      if (options.level && !VALID_LEVELS.includes(options.level.toLowerCase() as any)) {
        error(`Invalid level: ${options.level}`);
        info(`Available: ${VALID_LEVELS.join(', ')}`);
        process.exit(1);
      }

      const ssh = toSSHConfig(config);
      const lines = parseInt(options.lines, 10) || 50;

      if (options.all) {
        header('All Service Logs');
        for (const [svc, path] of Object.entries(LOG_PATHS)) {
          console.log(chalk.bold.cyan(`\n-- ${svc} --`));
          try {
            const { stdout } = await sshExec(ssh, `tail -n ${lines} ${path} 2>/dev/null || echo '(no logs)'`, 10_000);
            const filtered = filterByLevel(stdout, options.level);
            if (filtered.trim()) {
              console.log(colorizeLogLine(filtered));
            } else {
              info('(empty)');
            }
          } catch {
            warn('(unreachable or no log file)');
          }
        }
        return;
      }

      // Default to runtime
      const targetService = (service || 'runtime') as LogService;
      const logPath = LOG_PATHS[targetService];

      if (options.follow) {
        // Streaming mode
        header(`Following ${targetService} logs`);
        info('Press Ctrl+C to stop.\n');

        const tailCmd = options.level
          ? `tail -f ${logPath} 2>/dev/null | grep --line-buffered -i '${options.level}'`
          : `tail -f ${logPath} 2>/dev/null`;

        const child = sshStream(ssh, tailCmd);

        child.stdout?.on('data', (data: Buffer) => {
          process.stdout.write(colorizeLogLine(data.toString()));
        });

        child.stderr?.on('data', (data: Buffer) => {
          const msg = data.toString().trim();
          if (msg) process.stderr.write(chalk.red(msg) + '\n');
        });

        child.on('error', (err) => {
          error(`SSH connection failed: ${err.message}`);
          info('Is the Mac agent host reachable via Tailscale?');
          process.exit(1);
        });

        child.on('close', (code) => {
          if (code !== 0 && code !== null) {
            error(`SSH exited with code ${code}. Is the Mac reachable?`);
          }
        });

        process.on('SIGINT', () => {
          child.kill();
          console.log('\nStopped following logs.');
          process.exit(0);
        });
      } else {
        // Static mode
        header(`${targetService} logs`);

        const remoteCmd = options.since
          ? buildSinceFilter(options.since, logPath)
          : `tail -n ${lines} ${logPath} 2>/dev/null || echo '(no logs)'`;

        try {
          const { stdout } = await sshExec(ssh, remoteCmd, 15_000);
          const filtered = filterByLevel(stdout, options.level);
          if (filtered.trim()) {
            console.log(colorizeLogLine(filtered));
          } else {
            info(options.level ? `No ${options.level}-level entries found.` : '(empty)');
          }
        } catch (err: any) {
          const msg: string = err.message ?? '';
          if (msg.includes('Connection refused') || msg.includes('timed out')) {
            error('Mac agent host is unreachable via Tailscale.');
            info(`Tried: ${config.sshUser}@${config.tailscaleIp}`);
            info('Check that Tailscale is running on both machines.');
          } else if (msg.includes('Permission denied')) {
            error('SSH authentication failed.');
            info('Check your SSH key and user configuration.');
          } else {
            error(`Failed to fetch logs: ${msg}`);
          }
          process.exit(1);
        }
      }
    });
}
