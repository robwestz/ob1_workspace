import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface OB1Config {
  supabaseUrl: string;
  supabaseKey: string;
  tailscaleIp: string;       // Mac's Tailscale IP
  sshUser: string;            // SSH username on Mac (default: 'openclaw')
  sshKeyPath?: string;        // path to SSH key
  dashboardPort: number;      // default 3000
  bacowrPort: number;         // default 8080
  gatewayPort: number;        // default 18789
  ob1AccessKey: string;
}

const CONFIG_DIR = join(homedir(), '.ob1');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULTS: OB1Config = {
  supabaseUrl: '',
  supabaseKey: '',
  tailscaleIp: '',
  sshUser: 'openclaw',
  dashboardPort: 3000,
  bacowrPort: 8080,
  gatewayPort: 18789,
  ob1AccessKey: '',
};

export function loadConfig(): OB1Config {
  // 1. Try ~/.ob1/config.json
  let fileConfig: Partial<OB1Config> = {};
  if (existsSync(CONFIG_FILE)) {
    try {
      const raw = readFileSync(CONFIG_FILE, 'utf-8');
      fileConfig = JSON.parse(raw) as Partial<OB1Config>;
    } catch {
      // Ignore malformed config file, fall through to defaults
    }
  }

  // 2. Override with environment variables where set
  const envConfig: Partial<OB1Config> = {};
  if (process.env.OB1_SUPABASE_URL) envConfig.supabaseUrl = process.env.OB1_SUPABASE_URL;
  if (process.env.OB1_SUPABASE_KEY) envConfig.supabaseKey = process.env.OB1_SUPABASE_KEY;
  if (process.env.OB1_TAILSCALE_IP) envConfig.tailscaleIp = process.env.OB1_TAILSCALE_IP;
  if (process.env.OB1_SSH_USER) envConfig.sshUser = process.env.OB1_SSH_USER;
  if (process.env.OB1_SSH_KEY_PATH) envConfig.sshKeyPath = process.env.OB1_SSH_KEY_PATH;
  if (process.env.OB1_DASHBOARD_PORT) envConfig.dashboardPort = parseInt(process.env.OB1_DASHBOARD_PORT, 10);
  if (process.env.OB1_BACOWR_PORT) envConfig.bacowrPort = parseInt(process.env.OB1_BACOWR_PORT, 10);
  if (process.env.OB1_GATEWAY_PORT) envConfig.gatewayPort = parseInt(process.env.OB1_GATEWAY_PORT, 10);
  if (process.env.OB1_ACCESS_KEY) envConfig.ob1AccessKey = process.env.OB1_ACCESS_KEY;

  // 3. Merge: defaults < file < env
  return { ...DEFAULTS, ...fileConfig, ...envConfig };
}

export function saveConfig(config: Partial<OB1Config>): void {
  // Ensure config directory exists
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Merge with existing config if present
  let existing: Partial<OB1Config> = {};
  if (existsSync(CONFIG_FILE)) {
    try {
      const raw = readFileSync(CONFIG_FILE, 'utf-8');
      existing = JSON.parse(raw) as Partial<OB1Config>;
    } catch {
      // Overwrite malformed file
    }
  }

  const merged = { ...existing, ...config };
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}
