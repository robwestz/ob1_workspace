import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import type { OB1Config } from '../config.js';
import { header, table, info, divider } from '../utils/output.js';

interface Project {
  name: string;
  path: string;
  status: 'active' | 'paused' | 'completed';
  lastActivity: string;
  health: 'healthy' | 'degraded' | 'failing' | 'unknown';
  recentDecisions: number;
  openIssues: number;
  testStatus: 'pass' | 'fail' | 'none';
}

interface ProjectsFile {
  projects: Array<{ name: string; path: string }>;
}

const OB1_DIR = join(homedir(), '.ob1');
const PROJECTS_FILE = join(OB1_DIR, 'projects.json');

const KNOWN_PROJECTS = [
  { name: 'OB1 Runtime', path: 'D:/OB1/theleak/implementation/runtime' },
  { name: 'OB1 Dashboard', path: 'D:/OB1/theleak/implementation/gui' },
  { name: 'OB1 Control', path: 'D:/OB1/cli' },
];

function loadProjectsFile(): ProjectsFile {
  if (!existsSync(PROJECTS_FILE)) return { projects: [] };
  try { return JSON.parse(readFileSync(PROJECTS_FILE, 'utf-8')); } catch { return { projects: [] }; }
}

function saveProjectsFile(data: ProjectsFile): void {
  if (!existsSync(OB1_DIR)) mkdirSync(OB1_DIR, { recursive: true });
  writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`;
}

function git(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, { cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }).toString().trim() || null;
  } catch { return null; }
}

function detectHealth(path: string): Project['health'] {
  const harness = join(path, '.harness', 'quality.yml');
  if (existsSync(harness)) {
    try {
      const c = readFileSync(harness, 'utf-8');
      if (c.includes('failing') || c.includes('critical')) return 'failing';
      if (c.includes('degraded') || c.includes('warning')) return 'degraded';
      return 'healthy';
    } catch { /* fallthrough */ }
  }
  const recent = git('git log --since="30 days ago" --oneline', path);
  return recent ? 'healthy' : 'unknown';
}

function detectTests(path: string): Project['testStatus'] {
  const pkg = join(path, 'package.json');
  if (existsSync(pkg)) {
    try {
      const s = JSON.parse(readFileSync(pkg, 'utf-8')).scripts?.test;
      if (s && !s.includes('no test specified')) return 'none'; // script exists
    } catch { /* ignore */ }
  }
  return 'none';
}

function discoverProjects(): Array<{ name: string; path: string }> {
  const found = new Map<string, string>();
  for (const p of KNOWN_PROJECTS) if (existsSync(p.path)) found.set(p.path, p.name);
  const root = 'D:/OB1/projects';
  if (existsSync(root)) {
    try {
      for (const e of readdirSync(root)) {
        const fp = join(root, e);
        try { if (statSync(fp).isDirectory() && !found.has(fp)) found.set(fp, e); } catch {}
      }
    } catch {}
  }
  for (const p of loadProjectsFile().projects) {
    if (existsSync(p.path) && !found.has(p.path)) found.set(p.path, p.name);
  }
  return Array.from(found.entries()).map(([path, name]) => ({ name, path }));
}

function resolveProject(entry: { name: string; path: string }): Project {
  const lastCommit = git('git log -1 --format=%cI', entry.path);
  const diffDays = lastCommit ? (Date.now() - new Date(lastCommit).getTime()) / 86_400_000 : Infinity;
  const recentLog = git('git log --since="7 days ago" --oneline', entry.path);
  return {
    name: entry.name,
    path: entry.path,
    status: diffDays <= 7 ? 'active' : diffDays <= 30 ? 'paused' : lastCommit ? 'paused' : 'paused',
    lastActivity: lastCommit ?? new Date().toISOString(),
    health: detectHealth(entry.path),
    recentDecisions: recentLog ? recentLog.split('\n').length : 0,
    openIssues: 0,
    testStatus: detectTests(entry.path),
  };
}

const healthLabel = (h: Project['health']) => ({
  healthy: chalk.green('● healthy'), degraded: chalk.yellow('● degraded'),
  failing: chalk.red('● failing'), unknown: chalk.gray('○ unknown'),
})[h];

const statusLabel = (s: Project['status']) => ({
  active: chalk.green(s), paused: chalk.yellow(s), completed: chalk.blue(s),
})[s];

const testLabel = (t: Project['testStatus']) => ({
  pass: chalk.green('pass'), fail: chalk.red('fail'), none: chalk.gray('none'),
})[t];

export function registerProjectsCommand(program: Command, _config: OB1Config): void {
  const cmd = program.command('projects').description('Manage OB1 projects');

  cmd.command('list').description('List all active projects')
    .option('-v, --verbose', 'Show detailed view with recent activity')
    .option('--status <status>', 'Filter by status (active, paused, completed)')
    .option('--json', 'Output as JSON')
    .action(async (opts: { verbose?: boolean; status?: string; json?: boolean }) => {
      let projects = discoverProjects().map(resolveProject);
      if (opts.status) projects = projects.filter(p => p.status === opts.status);

      projects.sort((a, b) => {
        const ord = { active: 0, paused: 1, completed: 2 };
        return ord[a.status] !== ord[b.status]
          ? ord[a.status] - ord[b.status]
          : new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
      });

      if (opts.json) { console.log(JSON.stringify(projects, null, 2)); return; }

      header('OB1 Projects');
      if (!projects.length) { info('No projects found. Use `ob1 projects add <name> <path>` to register one.'); return; }

      table(
        ['Name', 'Status', 'Last Activity', 'Health', 'Tests'],
        projects.map(p => [
          chalk.bold(p.name), statusLabel(p.status), relativeTime(p.lastActivity),
          healthLabel(p.health), testLabel(p.testStatus),
        ]),
      );

      const counts = { active: 0, paused: 0, completed: 0 };
      for (const p of projects) counts[p.status]++;
      console.log('');
      info(`${projects.length} projects (${counts.active} active, ${counts.paused} paused, ${counts.completed} completed)`);

      if (opts.verbose) {
        console.log('');
        for (const p of projects) {
          divider();
          console.log(chalk.bold.white(`  ${p.name}`) + chalk.gray(` (${p.path})`));
          const log = git('git log -3 --oneline --format="  %h %s (%cr)"', p.path);
          console.log(chalk.gray(log ?? '  (no git history)'));
        }
      }
      console.log('');
    });

  cmd.command('add <name> <path>').description('Register a project')
    .action(async (name: string, path: string) => {
      const data = loadProjectsFile();
      if (data.projects.find(p => p.name === name || p.path === path)) {
        console.log(chalk.yellow(`  Project already registered`)); return;
      }
      if (!existsSync(path)) { console.log(chalk.red(`  Path does not exist: ${path}`)); return; }
      data.projects.push({ name, path });
      saveProjectsFile(data);
      console.log(chalk.green(`  Added project: ${name} (${path})`));
    });

  cmd.command('remove <name>').description('Unregister a project')
    .action(async (name: string) => {
      const data = loadProjectsFile();
      const idx = data.projects.findIndex(p => p.name === name);
      if (idx === -1) { console.log(chalk.yellow(`  Project not found: ${name}`)); return; }
      data.projects.splice(idx, 1);
      saveProjectsFile(data);
      console.log(chalk.green(`  Removed project: ${name}`));
    });
}
