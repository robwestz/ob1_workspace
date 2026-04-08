import { exec, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface SSHConfig {
  host: string;
  user: string;
  keyPath?: string;
}

function buildSSHArgs(config: SSHConfig): string[] {
  const args: string[] = [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=5',
  ];

  if (config.keyPath) {
    args.push('-i', config.keyPath);
  }

  args.push(`${config.user}@${config.host}`);
  return args;
}

export async function sshExec(
  config: SSHConfig,
  command: string,
  timeout = 30_000,
): Promise<{ stdout: string; stderr: string }> {
  const args = buildSSHArgs(config);
  const sshCommand = `ssh ${args.map(a => `"${a}"`).join(' ')} ${JSON.stringify(command)}`;

  const { stdout, stderr } = await execAsync(sshCommand, { timeout });
  return { stdout, stderr };
}

export function sshStream(config: SSHConfig, command: string): ChildProcess {
  const args = [...buildSSHArgs(config), command];
  return spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

export async function sshPing(
  config: SSHConfig,
): Promise<{ reachable: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    await sshExec(config, 'echo ok', 10_000);
    return { reachable: true, latencyMs: Date.now() - start };
  } catch {
    return { reachable: false, latencyMs: Date.now() - start };
  }
}
