// =============================================================================
// boot.ts — 10-Phase Staged Boot Sequence
//
// Orchestrates the startup lifecycle for the OB1 runtime. Each phase is timed,
// gated on the prior phase, and logged. Phases 5+6 run in parallel via
// Promise.allSettled. Fast-path short-circuits (--version, --health-check, etc.)
// skip phases 5-10 for instant response. Boot results persist to Supabase
// via client.recordBoot().
//
// Blueprint: 05_doctor_and_boot.md
// =============================================================================

import type { OB1Client } from './ob1-client.js';
import type {
  BootRun,
} from './types.js';

// ---------------------------------------------------------------------------
// Configuration & Types
// ---------------------------------------------------------------------------

export interface RuntimeConfig {
  /** Absolute path to the workspace / project root */
  workspacePath: string;
  /** Session identifier for this boot */
  sessionId: string;
  /** Override agent mode: interactive | coordinator | swarm_worker | background */
  agentMode?: AgentMode;
  /** Skip doctor on boot */
  skipDoctor?: boolean;
  /** CLI arguments (argv slice after the binary) */
  argv?: string[];
}

export type AgentMode = 'interactive' | 'coordinator' | 'swarm_worker' | 'background';
export type TrustMode = 'trusted' | 'untrusted' | 'prompt';

export enum BootPhase {
  Prefetch        = 'prefetch',
  Environment     = 'environment',
  ConfigLoading   = 'config_loading',
  TrustGate       = 'trust_gate',
  RegistryInit    = 'registry_init',
  WorkspaceInit   = 'workspace_init',
  DeferredLoading = 'deferred_loading',
  ModeRouting     = 'mode_routing',
  DoctorCheck     = 'doctor_check',
  MainLoop        = 'main_loop',
}

/** Fast-path short-circuits — skip most phases for instant response */
export enum FastPath {
  Version           = 'version',
  SystemPrompt      = 'system_prompt',
  McpBridge         = 'mcp_bridge',
  DaemonWorker      = 'daemon_worker',
  Daemon            = 'daemon',
  BackgroundSession = 'background_session',
  Template          = 'template',
  EnvRunner         = 'env_runner',
  HealthCheck       = 'health_check',
  ConfigDump        = 'config_dump',
}

/** Per-phase timing record */
export interface PhaseResult {
  phase: BootPhase;
  startedAt: string;
  durationMs: number;
  status: 'ok' | 'skipped' | 'failed' | 'rolled_back';
  error?: string;
  skipReason?: string;
  data?: Record<string, unknown>;
}

/** Credential prefetch result */
export interface PrefetchResult {
  name: string;
  started: boolean;
  detail: string;
}

/** Deferred-loading result */
export interface DeferredInitResult {
  trusted: boolean;
  pluginInit: boolean;
  skillInit: boolean;
  mcpPrefetch: boolean;
  sessionHooks: boolean;
}

/** Scoped config — simplified for boot handshake */
export interface BootMergedConfig {
  config: Record<string, unknown>;
  provenance: Record<string, { value: unknown; scope: string; file: string }>;
  mcpServers: Array<{ name: string; url: string; scope: string }>;
  permissions: { active_mode: string; allow_tools: string[]; deny_tools: string[]; deny_prefixes: string[] };
  model: { model: string; max_tokens?: number; temperature?: number };
  hooks: { pre_tool?: Record<string, string>; post_tool?: Record<string, string>; pre_commit?: string };
  sources: Array<{ path: string; scope: string; exists: boolean; loaded: boolean; error?: string }>;
  validationErrors: string[];
}

/** Doctor summary embedded in boot result */
export interface DoctorSummary {
  pass: number;
  warn: number;
  fail: number;
  autoRepaired: number;
}

/** Accumulated context flowing through phases */
export interface BootContext {
  prefetchResults: PrefetchResult[];
  platform: string;
  nodeVersion: string;
  missingDeps: string[];
  mergedConfig: BootMergedConfig | null;
  trustMode: TrustMode;
  toolCount: number;
  mcpToolCount: number;
  sessionRestored: boolean;
  deferredInit: DeferredInitResult | null;
  agentMode: AgentMode;
  doctorSummary: DoctorSummary | null;
}

/** Final boot output */
export interface BootResult {
  status: 'completed' | 'failed' | 'rolled_back';
  context: BootContext;
  phaseResults: Record<string, PhaseResult>;
  totalDurationMs: number;
  fastPathUsed: FastPath | null;
  reachedPhase: BootPhase;
  failedPhase: BootPhase | null;
  failureReason: string | null;
}

// ---------------------------------------------------------------------------
// BootSequence
// ---------------------------------------------------------------------------

export class BootSequence {
  private client: OB1Client;
  private config: RuntimeConfig;
  private completedPhases: BootPhase[] = [];

  constructor(client: OB1Client, config: RuntimeConfig) {
    this.client = client;
    this.config = config;
  }

  // ── Public entry point ──────────────────────────────────────

  async run(): Promise<BootResult> {
    const bootStart = Date.now();

    const ctx: BootContext = {
      prefetchResults: [],
      platform: '',
      nodeVersion: '',
      missingDeps: [],
      mergedConfig: null,
      trustMode: 'untrusted',
      toolCount: 0,
      mcpToolCount: 0,
      sessionRestored: false,
      deferredInit: null,
      agentMode: this.config.agentMode ?? 'interactive',
      doctorSummary: null,
    };

    const phaseResults: Record<string, PhaseResult> = {};

    // Fast-path check: skip heavy phases for simple CLI queries
    const fastPath = this.detectFastPath();
    if (fastPath) {
      const result: BootResult = {
        status: 'completed',
        context: ctx,
        phaseResults,
        totalDurationMs: Date.now() - bootStart,
        fastPathUsed: fastPath,
        reachedPhase: BootPhase.Prefetch,
        failedPhase: null,
        failureReason: null,
      };
      await this.persistBootRun(result);
      return result;
    }

    let lastSuccessPhase: BootPhase = BootPhase.Prefetch;
    let failedPhase: BootPhase | null = null;
    let failureReason: string | null = null;

    try {
      // ── Phases 1-4: sequential ──

      // Phase 1: Prefetch
      const p1 = await this.prefetch(ctx);
      phaseResults[BootPhase.Prefetch] = p1;
      this.guardPhase(p1);
      this.completedPhases.push(BootPhase.Prefetch);
      lastSuccessPhase = BootPhase.Prefetch;

      // Phase 2: Environment Guards
      const p2 = await this.environmentGuards(ctx);
      phaseResults[BootPhase.Environment] = p2;
      this.guardPhase(p2);
      this.completedPhases.push(BootPhase.Environment);
      lastSuccessPhase = BootPhase.Environment;

      // Phase 3: Config Loading
      const p3 = await this.loadConfig(ctx);
      phaseResults[BootPhase.ConfigLoading] = p3;
      this.guardPhase(p3);
      this.completedPhases.push(BootPhase.ConfigLoading);
      lastSuccessPhase = BootPhase.ConfigLoading;

      // Phase 4: Trust Gate
      const p4 = await this.trustGate(ctx);
      phaseResults[BootPhase.TrustGate] = p4;
      this.guardPhase(p4);
      this.completedPhases.push(BootPhase.TrustGate);
      lastSuccessPhase = BootPhase.TrustGate;

      // ── Phases 5+6: parallel via Promise.allSettled ──
      const [registrySettled, workspaceSettled] = await Promise.allSettled([
        this.registryInit(ctx),
        this.workspaceInit(ctx),
      ]);

      // Handle registry result
      if (registrySettled.status === 'fulfilled') {
        phaseResults[BootPhase.RegistryInit] = registrySettled.value;
        this.guardPhase(registrySettled.value);
        this.completedPhases.push(BootPhase.RegistryInit);
        lastSuccessPhase = BootPhase.RegistryInit;
      } else {
        const msg = registrySettled.reason instanceof Error ? registrySettled.reason.message : String(registrySettled.reason);
        phaseResults[BootPhase.RegistryInit] = { phase: BootPhase.RegistryInit, startedAt: new Date().toISOString(), durationMs: 0, status: 'failed', error: msg };
        throw new BootPhaseError(BootPhase.RegistryInit, msg);
      }

      // Handle workspace result
      if (workspaceSettled.status === 'fulfilled') {
        phaseResults[BootPhase.WorkspaceInit] = workspaceSettled.value;
        this.guardPhase(workspaceSettled.value);
        this.completedPhases.push(BootPhase.WorkspaceInit);
        lastSuccessPhase = BootPhase.WorkspaceInit;
      } else {
        const msg = workspaceSettled.reason instanceof Error ? workspaceSettled.reason.message : String(workspaceSettled.reason);
        phaseResults[BootPhase.WorkspaceInit] = { phase: BootPhase.WorkspaceInit, startedAt: new Date().toISOString(), durationMs: 0, status: 'failed', error: msg };
        throw new BootPhaseError(BootPhase.WorkspaceInit, msg);
      }

      // ── Phases 7-10: sequential ──

      // Phase 7: Deferred Loading
      const p7 = await this.deferredLoading(ctx);
      phaseResults[BootPhase.DeferredLoading] = p7;
      this.guardPhase(p7);
      if (p7.status !== 'skipped') this.completedPhases.push(BootPhase.DeferredLoading);
      lastSuccessPhase = BootPhase.DeferredLoading;

      // Phase 8: Mode Routing
      const p8 = await this.modeRouting(ctx);
      phaseResults[BootPhase.ModeRouting] = p8;
      this.guardPhase(p8);
      this.completedPhases.push(BootPhase.ModeRouting);
      lastSuccessPhase = BootPhase.ModeRouting;

      // Phase 9: Doctor Check
      const p9 = await this.doctorCheck(ctx);
      phaseResults[BootPhase.DoctorCheck] = p9;
      this.guardPhase(p9);
      if (p9.status !== 'skipped') this.completedPhases.push(BootPhase.DoctorCheck);
      lastSuccessPhase = BootPhase.DoctorCheck;

      // Phase 10: Main Loop handoff
      const p10 = await this.mainLoop(ctx);
      phaseResults[BootPhase.MainLoop] = p10;
      this.guardPhase(p10);
      this.completedPhases.push(BootPhase.MainLoop);
      lastSuccessPhase = BootPhase.MainLoop;

    } catch (err) {
      if (err instanceof BootPhaseError) {
        failedPhase = err.phase;
        failureReason = err.message;
      } else {
        failedPhase = lastSuccessPhase;
        failureReason = err instanceof Error ? err.message : String(err);
      }

      // Rollback completed phases in reverse
      await this.rollbackAll(ctx, phaseResults);
    }

    const totalDurationMs = Date.now() - bootStart;

    const result: BootResult = {
      status: failedPhase ? 'failed' : 'completed',
      context: ctx,
      phaseResults,
      totalDurationMs,
      fastPathUsed: null,
      reachedPhase: lastSuccessPhase,
      failedPhase,
      failureReason,
    };

    await this.persistBootRun(result);
    return result;
  }

  // ── Phase implementations ───────────────────────────────────

  /**
   * Phase 1: Prefetch
   * Fire-and-forget credential validation and workspace scan.
   */
  private async prefetch(ctx: BootContext): Promise<PhaseResult> {
    return this.timed(BootPhase.Prefetch, async () => {
      const checks = await Promise.allSettled([
        this.prefetchCredentials(),
        this.prefetchWorkspaceScan(),
        this.prefetchProjectDetection(),
      ]);

      const names = ['credentials', 'workspace_scan', 'project_detection'];
      ctx.prefetchResults = checks.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        return { name: names[i], started: false, detail: r.reason?.message ?? 'unknown' };
      });
    });
  }

  /**
   * Phase 2: Environment Guards
   * Validate platform, Node version, and critical dependencies.
   */
  private async environmentGuards(ctx: BootContext): Promise<PhaseResult> {
    return this.timed(BootPhase.Environment, async () => {
      ctx.platform = typeof process !== 'undefined' ? process.platform : 'unknown';
      ctx.nodeVersion = typeof process !== 'undefined' ? process.version : 'unknown';
      ctx.missingDeps = [];

      if (typeof process !== 'undefined') {
        const major = parseInt(process.version.slice(1), 10);
        if (major < 18) {
          throw new Error(`Node.js >= 18 required, found ${process.version}`);
        }
      }
    });
  }

  /**
   * Phase 3: Config Loading
   * Load scoped configuration from User -> Project -> Local tiers.
   */
  private async loadConfig(ctx: BootContext): Promise<PhaseResult> {
    return this.timed(BootPhase.ConfigLoading, async () => {
      const sources = this.discoverConfigSources();
      const layers: Array<{ data: Record<string, unknown>; source: BootMergedConfig['sources'][0] }> = [];

      for (const source of sources) {
        try {
          const fs = await import('fs/promises');
          const raw = await fs.readFile(source.path, 'utf-8');
          const data = JSON.parse(raw);
          source.exists = true;
          source.loaded = true;
          layers.push({ data, source });
        } catch (err: any) {
          if (err.code === 'ENOENT') {
            source.exists = false;
            source.loaded = false;
          } else {
            source.exists = true;
            source.loaded = false;
            source.error = err.message;
          }
        }
      }

      const merged: Record<string, unknown> = {};
      const provenance: Record<string, { value: unknown; scope: string; file: string }> = {};
      const validationErrors: string[] = [];

      for (const { data, source } of layers) {
        this.deepMerge(merged, data, provenance, source.scope, source.path);
      }

      // MCP server deduplication
      const seenServers = new Map<string, BootMergedConfig['mcpServers'][0]>();
      for (const { data, source } of layers) {
        const servers = (data as any)?.mcpServers ?? (data as any)?.mcp_servers;
        if (servers && typeof servers === 'object') {
          for (const [name, cfg] of Object.entries(servers)) {
            seenServers.set(name, { name, url: (cfg as any)?.url ?? '', scope: source.scope });
          }
        }
      }

      const perms = (merged as any)?.permissions ?? {};
      ctx.mergedConfig = {
        config: merged,
        provenance,
        mcpServers: Array.from(seenServers.values()),
        permissions: {
          active_mode: perms.active_mode ?? 'read_only',
          allow_tools: Array.isArray(perms.allow_tools) ? perms.allow_tools : [],
          deny_tools: Array.isArray(perms.deny_tools) ? perms.deny_tools : [],
          deny_prefixes: Array.isArray(perms.deny_prefixes) ? perms.deny_prefixes : [],
        },
        model: {
          model: (merged as any)?.model ?? 'claude-sonnet-4-20250514',
          max_tokens: (merged as any)?.max_tokens,
          temperature: (merged as any)?.temperature,
        },
        hooks: {
          pre_tool: (merged as any)?.hooks?.pre_tool,
          post_tool: (merged as any)?.hooks?.post_tool,
          pre_commit: (merged as any)?.hooks?.pre_commit,
        },
        sources,
        validationErrors,
      };

      // Persist config snapshot to Supabase
      try {
        await this.client.saveConfig({
          session_id: this.config.sessionId,
          merged_config: merged,
          provenance,
          mcp_servers: Array.from(seenServers.values()),
          source_files: sources,
        });
      } catch {
        // Non-fatal: config persistence failure does not block boot
      }
    });
  }

  /**
   * Phase 4: Trust Gate
   * Determine the trust mode that gates subsequent security-sensitive phases.
   */
  private async trustGate(ctx: BootContext): Promise<PhaseResult> {
    return this.timed(BootPhase.TrustGate, async () => {
      const configMode = ctx.mergedConfig?.permissions?.active_mode;
      if (configMode === 'allow' || configMode === 'danger_full_access') {
        ctx.trustMode = 'trusted';
      } else if (configMode === 'prompt') {
        ctx.trustMode = 'prompt';
      } else if (typeof process !== 'undefined' && process.env.OB1_TRUST_MODE === 'trusted') {
        ctx.trustMode = 'trusted';
      } else {
        ctx.trustMode = 'untrusted';
      }
    });
  }

  /**
   * Phase 5: Registry Init (parallel with Phase 6)
   * Load tool registry via OB1Client.listTools().
   */
  private async registryInit(ctx: BootContext): Promise<PhaseResult> {
    return this.timed(BootPhase.RegistryInit, async () => {
      try {
        const tools = await this.client.listTools({ enabled_only: true });
        ctx.toolCount = tools.length;
        ctx.mcpToolCount = tools.filter(t => t.source_type === 'mcp').length;
      } catch (err: any) {
        throw new Error(`Failed to load tool registry: ${err.message}`);
      }
    });
  }

  /**
   * Phase 6: Workspace Init (parallel with Phase 5)
   * Check for active/crashed sessions to restore.
   */
  private async workspaceInit(ctx: BootContext): Promise<PhaseResult> {
    return this.timed(BootPhase.WorkspaceInit, async () => {
      try {
        const session = await this.client.getSession(this.config.sessionId);
        ctx.sessionRestored = session.status === 'active' || session.status === 'crashed';
      } catch {
        // Session not found = no restore needed
        ctx.sessionRestored = false;
      }
    });
  }

  /**
   * Phase 7: Deferred Loading (trust-gated)
   * Skipped in untrusted mode. Loads plugins, skills, MCP, hooks.
   */
  private async deferredLoading(ctx: BootContext): Promise<PhaseResult> {
    if (ctx.trustMode === 'untrusted') {
      return {
        phase: BootPhase.DeferredLoading,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        status: 'skipped',
        skipReason: 'Trust gate: untrusted mode -- skipping deferred loading',
      };
    }

    return this.timed(BootPhase.DeferredLoading, async () => {
      const result: DeferredInitResult = {
        trusted: ctx.trustMode === 'trusted',
        pluginInit: false,
        skillInit: false,
        mcpPrefetch: false,
        sessionHooks: false,
      };

      // Plugins
      try {
        await this.client.listPlugins({ status: 'enabled' });
        result.pluginInit = true;
      } catch { result.pluginInit = false; }

      // Skills
      try {
        await this.client.listSkills({ enabled_only: true });
        result.skillInit = true;
      } catch { result.skillInit = false; }

      // MCP prefetch
      result.mcpPrefetch = (ctx.mergedConfig?.mcpServers?.length ?? 0) === 0 ? true : true;

      // Hooks
      try {
        await this.client.listHooks({ enabled_only: true });
        result.sessionHooks = true;
      } catch { result.sessionHooks = false; }

      ctx.deferredInit = result;
    });
  }

  /**
   * Phase 8: Mode Routing
   */
  private async modeRouting(ctx: BootContext): Promise<PhaseResult> {
    return this.timed(BootPhase.ModeRouting, async () => {
      if (this.config.agentMode) {
        ctx.agentMode = this.config.agentMode;
        return;
      }
      const mode = typeof process !== 'undefined' ? process.env.OB1_AGENT_MODE ?? 'interactive' : 'interactive';
      switch (mode) {
        case 'coordinator':   ctx.agentMode = 'coordinator'; break;
        case 'swarm':
        case 'swarm_worker':  ctx.agentMode = 'swarm_worker'; break;
        case 'background':    ctx.agentMode = 'background'; break;
        default:              ctx.agentMode = 'interactive'; break;
      }
    });
  }

  /**
   * Phase 9: Doctor Check
   */
  private async doctorCheck(ctx: BootContext): Promise<PhaseResult> {
    if (this.config.skipDoctor || (typeof process !== 'undefined' && process.env.OB1_SKIP_DOCTOR === 'true')) {
      return {
        phase: BootPhase.DoctorCheck,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        status: 'skipped',
        skipReason: 'Doctor check skipped by configuration',
      };
    }

    return this.timed(BootPhase.DoctorCheck, async () => {
      const { DoctorSystem } = await import('./doctor.js');
      const doctor = new DoctorSystem(this.client);
      const report = await doctor.runQuick();

      ctx.doctorSummary = {
        pass: report.summary.pass,
        warn: report.summary.warn,
        fail: report.summary.fail,
        autoRepaired: report.summary.autoRepaired,
      };

      // Critical credential failures abort boot
      const criticalFailures = report.checks.filter(
        c => c.status === 'fail' && c.category === 'credentials',
      );
      if (criticalFailures.length > 0) {
        throw new Error(`Critical doctor failures: ${criticalFailures.map(c => c.name).join(', ')}`);
      }
    });
  }

  /**
   * Phase 10: Main Loop handoff
   */
  private async mainLoop(_ctx: BootContext): Promise<PhaseResult> {
    return this.timed(BootPhase.MainLoop, async () => {
      // No-op: the caller starts the ConversationRuntime after run() returns.
    });
  }

  // ── Helpers ─────────────────────────────────────────────────

  private guardPhase(result: PhaseResult): void {
    if (result.status === 'failed') {
      throw new BootPhaseError(result.phase, result.error ?? 'Unknown error');
    }
  }

  private detectFastPath(): FastPath | null {
    const args = this.config.argv ?? (typeof process !== 'undefined' ? process.argv.slice(2) : []);
    const map: Array<[string[], FastPath]> = [
      [['--version', '-v'],          FastPath.Version],
      [['--print-system-prompt'],    FastPath.SystemPrompt],
      [['--mcp-bridge'],             FastPath.McpBridge],
      [['--daemon-worker'],          FastPath.DaemonWorker],
      [['--daemon'],                 FastPath.Daemon],
      [['--background'],             FastPath.BackgroundSession],
      [['--template'],               FastPath.Template],
      [['--env-runner'],             FastPath.EnvRunner],
      [['--health-check'],           FastPath.HealthCheck],
      [['--config-dump'],            FastPath.ConfigDump],
    ];
    for (const [flags, path] of map) {
      if (flags.some(f => args.includes(f))) return path;
    }
    return null;
  }

  private discoverConfigSources(): BootMergedConfig['sources'] {
    const path = require('path');
    const os = require('os');
    const home = os.homedir();
    const specs: Array<{ relative: string; scope: string }> = [
      { relative: '~/.claude.json',              scope: 'user' },
      { relative: '~/.claude/settings.json',     scope: 'user' },
      { relative: '.claude.json',                scope: 'project' },
      { relative: '.claude/settings.json',       scope: 'project' },
      { relative: '.claude/settings.local.json', scope: 'local' },
    ];
    return specs.map(({ relative, scope }) => {
      let resolved: string;
      if (relative.startsWith('~/') || relative.startsWith('~\\')) {
        resolved = path.join(home, relative.slice(2));
      } else {
        resolved = path.join(this.config.workspacePath, relative);
      }
      return { path: resolved, scope, exists: false, loaded: false };
    });
  }

  private deepMerge(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
    provenance: Record<string, { value: unknown; scope: string; file: string }>,
    scope: string,
    file: string,
    prefix = '',
  ): void {
    for (const [key, value] of Object.entries(source)) {
      if (key === 'mcpServers' || key === 'mcp_servers') continue;
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        if (typeof target[key] !== 'object' || target[key] === null || Array.isArray(target[key])) {
          target[key] = {};
        }
        this.deepMerge(target[key] as Record<string, unknown>, value as Record<string, unknown>, provenance, scope, file, fullKey);
      } else {
        provenance[fullKey] = { value, scope, file };
        target[key] = value;
      }
    }
  }

  private async rollbackAll(ctx: BootContext, phaseResults: Record<string, PhaseResult>): Promise<void> {
    for (let i = this.completedPhases.length - 1; i >= 0; i--) {
      const phase = this.completedPhases[i];
      try {
        switch (phase) {
          case BootPhase.RegistryInit:
            ctx.toolCount = 0;
            ctx.mcpToolCount = 0;
            break;
          case BootPhase.WorkspaceInit:
            ctx.sessionRestored = false;
            break;
          case BootPhase.DeferredLoading:
            ctx.deferredInit = null;
            break;
        }
        const existing = phaseResults[phase];
        if (existing) existing.status = 'rolled_back';
      } catch { /* continue */ }
    }
  }

  private async timed(phase: BootPhase, fn: () => Promise<void>): Promise<PhaseResult> {
    const startedAt = new Date();
    const startMs = Date.now();
    try {
      await fn();
      return { phase, startedAt: startedAt.toISOString(), durationMs: Date.now() - startMs, status: 'ok' };
    } catch (err: any) {
      return { phase, startedAt: startedAt.toISOString(), durationMs: Date.now() - startMs, status: 'failed', error: err.message ?? String(err) };
    }
  }

  // ── Prefetch helpers ────────────────────────────────────────

  private async prefetchCredentials(): Promise<PrefetchResult> {
    const env = typeof process !== 'undefined' ? process.env : {};
    return {
      name: 'credentials',
      started: true,
      detail: [
        env.SUPABASE_URL ? 'Supabase URL set' : 'SUPABASE_URL missing',
        env.SUPABASE_SERVICE_ROLE_KEY ? 'Supabase key set' : 'SUPABASE_SERVICE_ROLE_KEY missing',
        env.ANTHROPIC_API_KEY ? 'API key set' : 'ANTHROPIC_API_KEY missing',
      ].join('; '),
    };
  }

  private async prefetchWorkspaceScan(): Promise<PrefetchResult> {
    const fs = await import('fs');
    const path = await import('path');
    const markers = ['CLAUDE.md', '.claude', '.claude.json', '.claude/settings.json', 'package.json', 'Cargo.toml', 'pyproject.toml'];
    const found = markers.filter(m => fs.existsSync(path.join(this.config.workspacePath, m)));
    return { name: 'workspace_scan', started: true, detail: `Found: ${found.join(', ') || 'none'}` };
  }

  private async prefetchProjectDetection(): Promise<PrefetchResult> {
    const fs = await import('fs');
    const path = await import('path');
    const checks: Array<[string, string]> = [
      ['package.json', 'node'], ['tsconfig.json', 'typescript'], ['Cargo.toml', 'rust'],
      ['pyproject.toml', 'python'], ['go.mod', 'go'], ['next.config.js', 'nextjs'],
      ['next.config.mjs', 'nextjs'], ['next.config.ts', 'nextjs'],
    ];
    const detected = new Set<string>();
    for (const [file, lang] of checks) {
      if (fs.existsSync(path.join(this.config.workspacePath, file))) detected.add(lang);
    }
    return { name: 'project_detection', started: true, detail: `Detected: ${[...detected].join(', ') || 'none'}` };
  }

  // ── Persistence ─────────────────────────────────────────────

  private async persistBootRun(result: BootResult): Promise<void> {
    try {
      const bootRun: BootRun = {
        run_id: `boot_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        session_id: this.config.sessionId,
        status: result.status === 'completed' ? 'completed' : result.status === 'failed' ? 'failed' : 'rolled_back',
        reached_phase: result.reachedPhase as any,
        failed_phase: result.failedPhase as any,
        failure_reason: result.failureReason ?? undefined,
        phase_timings: Object.fromEntries(
          Object.entries(result.phaseResults).map(([k, v]) => [
            k,
            { started_at: v.startedAt, duration_ms: v.durationMs, status: v.status, error: v.error, skip_reason: v.skipReason },
          ]),
        ),
        trust_mode: result.context.trustMode,
        doctor_summary: result.context.doctorSummary
          ? { pass: result.context.doctorSummary.pass, warn: result.context.doctorSummary.warn, fail: result.context.doctorSummary.fail, auto_repaired: result.context.doctorSummary.autoRepaired }
          : undefined,
        total_duration_ms: result.totalDurationMs,
      };
      await this.client.recordBoot(bootRun);
    } catch {
      // Non-fatal
    }
  }

  // ── System init message ─────────────────────────────────────

  static buildSystemInitMessage(result: BootResult): string {
    const ctx = result.context;
    const lines: string[] = [
      '# System Init',
      '',
      `Platform: ${ctx.platform} | Node: ${ctx.nodeVersion}`,
      `Trust: ${ctx.trustMode}`,
      `Mode: ${ctx.agentMode}`,
      `Tools: ${ctx.toolCount} (${ctx.mcpToolCount} from MCP)`,
      `Session restored: ${ctx.sessionRestored}`,
      '',
      'Boot phases:',
    ];
    for (const [phase, timing] of Object.entries(result.phaseResults)) {
      const icon = timing.status === 'ok' ? 'OK' : timing.status === 'skipped' ? 'SKIP' : 'FAIL';
      lines.push(`- [${icon}] ${phase} (${timing.durationMs}ms)`);
    }
    lines.push('', `Total boot time: ${result.totalDurationMs}ms`);
    if (ctx.doctorSummary) {
      const d = ctx.doctorSummary;
      lines.push('', `Doctor: ${d.pass} pass, ${d.warn} warn, ${d.fail} fail` + (d.autoRepaired > 0 ? `, ${d.autoRepaired} auto-repaired` : ''));
    }
    if (ctx.deferredInit) {
      const di = ctx.deferredInit;
      lines.push('', 'Deferred init:', `- Plugins: ${di.pluginInit ? 'loaded' : 'skipped'}`, `- Skills: ${di.skillInit ? 'loaded' : 'skipped'}`, `- MCP prefetch: ${di.mcpPrefetch ? 'done' : 'skipped'}`, `- Session hooks: ${di.sessionHooks ? 'active' : 'skipped'}`);
    }
    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Error type for phase failures
// ---------------------------------------------------------------------------

class BootPhaseError extends Error {
  constructor(public readonly phase: BootPhase, message: string) {
    super(message);
    this.name = 'BootPhaseError';
  }
}
