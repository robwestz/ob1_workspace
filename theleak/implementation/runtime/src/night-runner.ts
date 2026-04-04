// =============================================================================
// night-runner.ts — Autonomous Overnight Task Executor
//
// Reads tasks from OB1 thoughts or a local JSON file, prioritizes them with
// dependency resolution, and executes them via the AgentCoordinator until
// budget runs out, time expires, or all tasks are done.
//
// The NightRunner is the user's trust — it runs while they sleep.
//
// Design principles:
//   - Shared budget pool across all tasks (not per-task)
//   - Crash recovery: requeues orphaned "running" tasks on startup
//   - Graceful shutdown on SIGTERM/SIGINT (finish current, don't start new)
//   - SIGUSR1: print current status to stdout
//   - Periodic polling for new tasks from OB1
//   - Full report stored as OB1 thought on completion
//
// Usage:
//   import { NightRunner } from './night-runner.js';
//   const runner = new NightRunner(config);
//   const report = await runner.start();
//
//   // Or standalone:
//   node night-runner.js --max-usd 20 --max-hours 8 --tasks night-tasks.json
// =============================================================================

import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { OB1Client } from './ob1-client.js';
import { BootSequence } from './boot.js';
import { DoctorSystem } from './doctor.js';
import type { BootResult } from './boot.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NightTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface NightTask {
  id: string;
  title: string;
  description: string;
  priority: number;           // 1 = highest
  agent_type?: string;        // which agent type to use (default: general_purpose)
  depends_on?: string[];      // task IDs this depends on
  max_turns?: number;
  max_usd?: number;
  status: NightTaskStatus;
}

export interface TaskResult {
  task_id: string;
  title: string;
  status: NightTaskStatus;
  agent_type: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number;
  usd_spent: number;
  tokens_used: number;
  output_summary: string;
  error: string | null;
}

export interface NightRunReport {
  started_at: string;
  completed_at: string;
  duration_minutes: number;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  skipped_tasks: number;
  total_usd_spent: number;
  total_tokens_used: number;
  task_results: TaskResult[];
  errors: string[];
}

export interface NightRunnerConfig {
  supabaseUrl: string;
  accessKey: string;
  anthropicKey: string;
  model?: string;                    // default: 'sonnet'
  maxBudgetUsd?: number;             // default: 20.00 (overnight budget)
  maxDurationMinutes?: number;       // default: 480 (8 hours)
  maxConcurrentAgents?: number;      // default: 3
  taskSource?: 'thoughts' | 'file'; // where to read tasks
  taskFile?: string;                 // path to tasks file (if taskSource='file')
  checkIntervalMinutes?: number;     // default: 5 (poll for new tasks)
  reportToMemory?: boolean;          // default: true (store report as OB1 thought)
  onTaskComplete?: (task: NightTask, result: TaskResult) => void;
  onError?: (error: Error, task?: NightTask) => void;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'sonnet';
const DEFAULT_MAX_BUDGET_USD = 20.00;
const DEFAULT_MAX_DURATION_MINUTES = 480;
const DEFAULT_MAX_CONCURRENT_AGENTS = 3;
const DEFAULT_CHECK_INTERVAL_MINUTES = 5;
const AGENT_TIMEOUT_MS = 30 * 60 * 1000;  // 30 minutes per task max
const SUPABASE_RETRY_DELAY_MS = 10_000;    // 10s between Supabase reconnect attempts
const MAX_SUPABASE_RETRIES = 5;            // give up after 5 consecutive failures
const HEARTBEAT_INTERVAL_MS = 60_000;      // log heartbeat every 60s

// ---------------------------------------------------------------------------
// NightRunner
// ---------------------------------------------------------------------------

export class NightRunner {
  private client: OB1Client;
  private config: Required<Pick<NightRunnerConfig,
    'supabaseUrl' | 'accessKey' | 'anthropicKey' | 'model' |
    'maxBudgetUsd' | 'maxDurationMinutes' | 'maxConcurrentAgents' |
    'taskSource' | 'checkIntervalMinutes' | 'reportToMemory'
  >> & Pick<NightRunnerConfig, 'taskFile' | 'onTaskComplete' | 'onError'>;

  // Task state
  private tasks: Map<string, NightTask> = new Map();
  private taskResults: Map<string, TaskResult> = new Map();
  private activeTasks: Map<string, { promise: Promise<TaskResult>; startedAt: number }> = new Map();

  // Budget tracking (shared across all tasks)
  private totalUsdSpent = 0;
  private totalTokensUsed = 0;

  // Run state
  private startedAt: Date | null = null;
  private shutdownRequested = false;
  private running = false;
  private runErrors: string[] = [];
  private consecutiveSupabaseFailures = 0;

  // Timers and signal handlers
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private signalHandlers: Array<{ signal: string; handler: () => void }> = [];

  constructor(userConfig: NightRunnerConfig) {
    this.client = new OB1Client(userConfig.supabaseUrl, userConfig.accessKey);
    this.config = {
      supabaseUrl: userConfig.supabaseUrl,
      accessKey: userConfig.accessKey,
      anthropicKey: userConfig.anthropicKey,
      model: userConfig.model ?? DEFAULT_MODEL,
      maxBudgetUsd: userConfig.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD,
      maxDurationMinutes: userConfig.maxDurationMinutes ?? DEFAULT_MAX_DURATION_MINUTES,
      maxConcurrentAgents: userConfig.maxConcurrentAgents ?? DEFAULT_MAX_CONCURRENT_AGENTS,
      taskSource: userConfig.taskSource ?? 'thoughts',
      taskFile: userConfig.taskFile,
      checkIntervalMinutes: userConfig.checkIntervalMinutes ?? DEFAULT_CHECK_INTERVAL_MINUTES,
      reportToMemory: userConfig.reportToMemory ?? true,
      onTaskComplete: userConfig.onTaskComplete,
      onError: userConfig.onError,
    };
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Start autonomous execution. Returns the final NightRunReport when done.
   *
   * Lifecycle:
   *   1. Boot — run BootSequence, run Doctor (abort if critical failures)
   *   2. Recovery — check for crashed tasks, requeue them
   *   3. Load tasks — from OB1 thoughts or local file
   *   4. Execute loop — pick tasks, spawn agents, track budget, poll for new
   *   5. Report — generate and persist NightRunReport
   *   6. Cleanup — clear timers, remove signal handlers
   */
  async start(): Promise<NightRunReport> {
    if (this.running) {
      throw new Error('NightRunner is already running');
    }
    this.running = true;
    this.startedAt = new Date();
    this.shutdownRequested = false;
    this.runErrors = [];
    this.totalUsdSpent = 0;
    this.totalTokensUsed = 0;

    this.log('info', `NightRunner starting. Budget: $${this.config.maxBudgetUsd}, Duration: ${this.config.maxDurationMinutes}min, Source: ${this.config.taskSource}`);

    try {
      // ── Phase 1: Boot ──
      await this.boot();

      // ── Phase 2: Recovery ──
      await this.recoverCrashedTasks();

      // ── Phase 3: Load tasks ──
      await this.loadTasks();

      // ── Phase 4: Install signal handlers ──
      this.installSignalHandlers();

      // ── Phase 5: Start heartbeat ──
      this.startHeartbeat();

      // ── Phase 6: Execute loop ──
      await this.executeLoop();

    } catch (err: any) {
      const errorMsg = `Fatal error: ${err.message}`;
      this.log('error', errorMsg);
      this.runErrors.push(errorMsg);
      this.config.onError?.(err);
    } finally {
      // ── Phase 7: Cleanup ──
      this.stopHeartbeat();
      this.stopPolling();
      this.removeSignalHandlers();
    }

    // ── Phase 8: Generate report ──
    const report = this.generateReport();

    // ── Phase 9: Persist report ──
    if (this.config.reportToMemory) {
      await this.persistReport(report);
    }

    this.running = false;
    this.log('info', `NightRunner complete. ${report.completed_tasks}/${report.total_tasks} tasks done, $${report.total_usd_spent.toFixed(4)} spent`);
    return report;
  }

  /**
   * Request graceful shutdown. Finishes current tasks but does not start new ones.
   */
  stop(): void {
    if (!this.running) return;
    this.log('info', 'Graceful shutdown requested');
    this.shutdownRequested = true;
  }

  /**
   * Get current status (for SIGUSR1 or programmatic introspection).
   */
  getStatus(): {
    running: boolean;
    elapsed_minutes: number;
    budget_remaining_usd: number;
    time_remaining_minutes: number;
    total_tasks: number;
    pending: number;
    active: number;
    completed: number;
    failed: number;
    skipped: number;
    usd_spent: number;
    tokens_used: number;
    active_task_ids: string[];
  } {
    const now = Date.now();
    const elapsed = this.startedAt ? (now - this.startedAt.getTime()) / 60_000 : 0;
    let pending = 0, completed = 0, failed = 0, skipped = 0;
    for (const task of this.tasks.values()) {
      switch (task.status) {
        case 'pending': pending++; break;
        case 'completed': completed++; break;
        case 'failed': failed++; break;
        case 'skipped': skipped++; break;
      }
    }
    return {
      running: this.running,
      elapsed_minutes: Math.round(elapsed * 10) / 10,
      budget_remaining_usd: Math.max(0, this.config.maxBudgetUsd - this.totalUsdSpent),
      time_remaining_minutes: Math.max(0, this.config.maxDurationMinutes - elapsed),
      total_tasks: this.tasks.size,
      pending,
      active: this.activeTasks.size,
      completed,
      failed,
      skipped,
      usd_spent: this.totalUsdSpent,
      tokens_used: this.totalTokensUsed,
      active_task_ids: Array.from(this.activeTasks.keys()),
    };
  }

  // =========================================================================
  // Phase 1: Boot
  // =========================================================================

  private async boot(): Promise<void> {
    this.log('info', 'Phase 1: Boot sequence');

    const sessionId = `night_${Date.now()}_${randomSuffix()}`;

    const bootSequence = new BootSequence(this.client, {
      workspacePath: typeof process !== 'undefined' ? process.cwd() : '.',
      sessionId,
      agentMode: 'background',
      skipDoctor: false,
    });

    const bootResult: BootResult = await bootSequence.run();

    if (bootResult.status === 'failed') {
      throw new Error(`Boot failed at phase "${bootResult.failedPhase}": ${bootResult.failureReason}`);
    }

    // Run doctor independently for more detailed checks
    const doctor = new DoctorSystem(this.client);
    const report = await doctor.runQuick();

    const criticalFailures = report.checks.filter(
      c => c.status === 'fail' && (c.category === 'credentials' || c.category === 'connections'),
    );

    if (criticalFailures.length > 0) {
      const failDetails = criticalFailures.map(c => `${c.name}: ${c.detail}`).join('; ');
      throw new Error(`Doctor critical failures — aborting night run: ${failDetails}`);
    }

    if (report.summary.warn > 0) {
      this.log('warn', `Doctor: ${report.summary.warn} warning(s) — proceeding anyway`);
    }

    this.log('info', `Boot complete (${bootResult.totalDurationMs}ms). Doctor: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`);
  }

  // =========================================================================
  // Phase 2: Crash Recovery
  // =========================================================================

  private async recoverCrashedTasks(): Promise<void> {
    this.log('info', 'Phase 2: Checking for crashed tasks');

    try {
      // Look for agent runs that are still 'running' but have no active process
      const staleRuns = await this.client.listAgentRuns({ status: 'running', limit: 50 });
      const now = Date.now();
      const orphaned = staleRuns.filter(run => {
        if (!run.started_at) return false;
        const age = now - new Date(run.started_at).getTime();
        return age > AGENT_TIMEOUT_MS;
      });

      if (orphaned.length > 0) {
        this.log('warn', `Found ${orphaned.length} orphaned agent run(s) — marking as failed`);
        for (const run of orphaned) {
          try {
            await this.client.updateAgentStatus(run.run_id, 'failed', {
              error_message: 'Marked as failed by NightRunner crash recovery (stale running state)',
            });
          } catch (err: any) {
            this.log('warn', `Failed to mark orphaned run ${run.run_id}: ${err.message}`);
          }
        }
      } else {
        this.log('info', 'No orphaned tasks found');
      }
    } catch (err: any) {
      this.log('warn', `Crash recovery check failed: ${err.message} — continuing anyway`);
    }
  }

  // =========================================================================
  // Phase 3: Load Tasks
  // =========================================================================

  private async loadTasks(): Promise<void> {
    this.log('info', `Phase 3: Loading tasks from ${this.config.taskSource}`);

    if (this.config.taskSource === 'file') {
      await this.loadTasksFromFile();
    } else {
      await this.loadTasksFromThoughts();
    }

    this.log('info', `Loaded ${this.tasks.size} task(s)`);

    if (this.tasks.size === 0) {
      this.log('warn', 'No tasks found — NightRunner will poll for new tasks');
    }
  }

  private async loadTasksFromFile(): Promise<void> {
    if (!this.config.taskFile) {
      throw new Error('taskSource is "file" but no taskFile path provided');
    }

    const filePath = resolve(this.config.taskFile);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err: any) {
      throw new Error(`Cannot read task file "${filePath}": ${err.message}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Task file "${filePath}" is not valid JSON`);
    }

    if (!Array.isArray(parsed)) {
      throw new Error('Task file must contain a JSON array of task objects');
    }

    for (const item of parsed) {
      const task = this.validateTask(item);
      this.tasks.set(task.id, task);
    }
  }

  private async loadTasksFromThoughts(): Promise<void> {
    try {
      // Query OB1 for thoughts tagged as pending tasks
      const results = await this.client.memoryRecall('pending tasks to execute', {
        tags: ['task', 'night-run'],
        limit: 100,
      });

      for (const result of results) {
        const meta = result.metadata as any;
        if (meta?.type === 'task' && meta?.status === 'pending') {
          const task: NightTask = {
            id: result.thought_id,
            title: meta.title ?? result.content.substring(0, 80),
            description: result.content,
            priority: meta.priority ?? 5,
            agent_type: meta.agent_type ?? 'general_purpose',
            depends_on: meta.depends_on ?? [],
            max_turns: meta.max_turns,
            max_usd: meta.max_usd,
            status: 'pending',
          };
          this.tasks.set(task.id, task);
        }
      }
    } catch (err: any) {
      this.log('warn', `Failed to load tasks from thoughts: ${err.message}`);
      // Not fatal — we'll poll again later
    }
  }

  private validateTask(item: unknown): NightTask {
    if (typeof item !== 'object' || item === null) {
      throw new Error('Each task must be an object');
    }
    const obj = item as Record<string, unknown>;

    if (typeof obj.id !== 'string' || !obj.id) {
      throw new Error('Each task must have a non-empty string "id"');
    }
    if (typeof obj.title !== 'string' || !obj.title) {
      throw new Error(`Task "${obj.id}": missing "title"`);
    }
    if (typeof obj.description !== 'string' || !obj.description) {
      throw new Error(`Task "${obj.id}": missing "description"`);
    }

    return {
      id: obj.id,
      title: obj.title,
      description: obj.description,
      priority: typeof obj.priority === 'number' ? obj.priority : 5,
      agent_type: typeof obj.agent_type === 'string' ? obj.agent_type : 'general_purpose',
      depends_on: Array.isArray(obj.depends_on) ? obj.depends_on.filter((d): d is string => typeof d === 'string') : [],
      max_turns: typeof obj.max_turns === 'number' ? obj.max_turns : undefined,
      max_usd: typeof obj.max_usd === 'number' ? obj.max_usd : undefined,
      status: 'pending',
    };
  }

  // =========================================================================
  // Phase 6: Execute Loop
  // =========================================================================

  private async executeLoop(): Promise<void> {
    this.log('info', 'Phase 6: Entering execution loop');

    // Schedule periodic polling for new tasks
    this.startPolling();

    while (!this.shouldStop()) {
      // Get next available tasks (respecting deps and concurrency)
      const available = this.getAvailableTasks();

      if (available.length === 0 && this.activeTasks.size === 0) {
        // No tasks available and none running. Check if we should keep polling.
        const hasPending = Array.from(this.tasks.values()).some(t => t.status === 'pending');
        if (!hasPending) {
          this.log('info', 'All tasks completed or skipped — exiting loop');
          break;
        }
        // Tasks exist but are blocked on dependencies — wait for active to complete
        // or for poll to bring new tasks
        await sleep(5_000);
        continue;
      }

      // Fill concurrency slots
      const slotsAvailable = this.config.maxConcurrentAgents - this.activeTasks.size;
      const toStart = available.slice(0, Math.max(0, slotsAvailable));

      for (const task of toStart) {
        // Final budget check before starting
        if (this.totalUsdSpent >= this.config.maxBudgetUsd) {
          this.log('warn', 'Budget exhausted — stopping new task starts');
          this.shutdownRequested = true;
          break;
        }

        // Per-task budget cap: don't start a task if its max_usd would exceed remaining budget
        const remainingBudget = this.config.maxBudgetUsd - this.totalUsdSpent;
        if (task.max_usd && task.max_usd > remainingBudget) {
          this.log('warn', `Task "${task.id}" needs $${task.max_usd} but only $${remainingBudget.toFixed(2)} remains — skipping`);
          task.status = 'skipped';
          this.taskResults.set(task.id, {
            task_id: task.id,
            title: task.title,
            status: 'skipped',
            agent_type: task.agent_type ?? 'general_purpose',
            started_at: null,
            completed_at: new Date().toISOString(),
            duration_ms: 0,
            usd_spent: 0,
            tokens_used: 0,
            output_summary: 'Skipped: insufficient budget remaining',
            error: null,
          });
          continue;
        }

        this.startTask(task, remainingBudget);
      }

      // Wait for at least one active task to complete before checking again
      if (this.activeTasks.size > 0) {
        await Promise.race([
          ...Array.from(this.activeTasks.values()).map(a => a.promise),
          sleep(10_000), // Check every 10s even if no task finishes
        ]);
      } else {
        await sleep(2_000);
      }
    }

    // Wait for all remaining active tasks to finish (graceful shutdown)
    if (this.activeTasks.size > 0) {
      this.log('info', `Waiting for ${this.activeTasks.size} active task(s) to finish...`);
      const remaining = Array.from(this.activeTasks.values()).map(a => a.promise);
      await Promise.allSettled(remaining);
    }

    // Skip remaining pending tasks
    for (const task of this.tasks.values()) {
      if (task.status === 'pending') {
        task.status = 'skipped';
        if (!this.taskResults.has(task.id)) {
          this.taskResults.set(task.id, {
            task_id: task.id,
            title: task.title,
            status: 'skipped',
            agent_type: task.agent_type ?? 'general_purpose',
            started_at: null,
            completed_at: new Date().toISOString(),
            duration_ms: 0,
            usd_spent: 0,
            tokens_used: 0,
            output_summary: this.shutdownRequested ? 'Skipped: shutdown requested' : 'Skipped: budget or time limit',
            error: null,
          });
        }
      }
    }
  }

  // =========================================================================
  // Task Execution
  // =========================================================================

  private startTask(task: NightTask, budgetCap: number): void {
    task.status = 'running';
    const startedAt = Date.now();

    this.log('info', `Starting task "${task.id}": ${task.title} (agent: ${task.agent_type ?? 'general_purpose'}, priority: ${task.priority})`);

    // Log task start to system events
    this.logEvent('coordinator', 'info', 'night_task_started', {
      task_id: task.id,
      title: task.title,
      agent_type: task.agent_type,
      priority: task.priority,
    });

    const taskBudgetUsd = Math.min(task.max_usd ?? budgetCap, budgetCap);

    const promise = this.executeTask(task, taskBudgetUsd, startedAt);
    this.activeTasks.set(task.id, { promise, startedAt });

    // Clean up when done
    promise.finally(() => {
      this.activeTasks.delete(task.id);
    });
  }

  private async executeTask(task: NightTask, budgetCap: number, startedAt: number): Promise<TaskResult> {
    const startedAtIso = new Date(startedAt).toISOString();
    let result: TaskResult;

    try {
      // Spawn agent via OB1Client
      const agentType = task.agent_type ?? 'general_purpose';

      const agentRun = await this.withSupabaseRetry(() =>
        this.client.spawnAgent(agentType, {
          task_prompt: this.buildTaskPrompt(task),
          task_context: {
            night_run: true,
            task_id: task.id,
            task_title: task.title,
            budget_usd: budgetCap,
            max_turns: task.max_turns ?? 50,
          },
          budget_config: {
            max_turns: task.max_turns ?? 50,
            max_budget_usd: budgetCap,
          },
        }),
      );

      // Poll for completion with timeout
      const agentResult = await this.pollAgentCompletion(agentRun.run_id, task);

      const durationMs = Date.now() - startedAt;
      const costUsd = Number(agentResult.total_cost_usd ?? 0);
      const tokensUsed = (agentResult.total_input_tokens ?? 0) + (agentResult.total_output_tokens ?? 0);

      // Update shared budget
      this.totalUsdSpent += costUsd;
      this.totalTokensUsed += tokensUsed;

      const succeeded = agentResult.status === 'completed';
      task.status = succeeded ? 'completed' : 'failed';

      result = {
        task_id: task.id,
        title: task.title,
        status: task.status,
        agent_type: agentType,
        started_at: startedAtIso,
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        usd_spent: costUsd,
        tokens_used: tokensUsed,
        output_summary: agentResult.output_summary ?? '',
        error: agentResult.error_message ?? null,
      };

      if (!succeeded) {
        this.log('warn', `Task "${task.id}" failed: ${agentResult.error_message ?? 'unknown error'}`);
        this.config.onError?.(new Error(agentResult.error_message ?? 'Task failed'), task);
      } else {
        this.log('info', `Task "${task.id}" completed in ${Math.round(durationMs / 1000)}s, $${costUsd.toFixed(4)}`);
      }

    } catch (err: any) {
      const durationMs = Date.now() - startedAt;
      task.status = 'failed';
      const errorMsg = `Task "${task.id}" execution error: ${err.message}`;
      this.log('error', errorMsg);
      this.runErrors.push(errorMsg);
      this.config.onError?.(err, task);

      result = {
        task_id: task.id,
        title: task.title,
        status: 'failed',
        agent_type: task.agent_type ?? 'general_purpose',
        started_at: startedAtIso,
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        usd_spent: 0,
        tokens_used: 0,
        output_summary: '',
        error: err.message,
      };
    }

    this.taskResults.set(task.id, result);

    // Log task completion to system events
    this.logEvent('coordinator', result.status === 'completed' ? 'info' : 'warn', 'night_task_completed', {
      task_id: task.id,
      status: result.status,
      duration_ms: result.duration_ms,
      usd_spent: result.usd_spent,
    });

    // Skip downstream tasks if this one failed
    if (task.status === 'failed') {
      this.skipDependentTasks(task.id);
    }

    // Notify callback
    this.config.onTaskComplete?.(task, result);

    return result;
  }

  /**
   * Build a comprehensive task prompt that gives the agent full context.
   */
  private buildTaskPrompt(task: NightTask): string {
    const lines: string[] = [
      `# Task: ${task.title}`,
      '',
      task.description,
      '',
      '## Context',
      `- Task ID: ${task.id}`,
      `- Priority: ${task.priority}`,
      `- Agent Type: ${task.agent_type ?? 'general_purpose'}`,
      `- This task is running autonomously as part of an overnight batch run.`,
      `- Complete the task fully. Do not ask for clarification — make reasonable decisions.`,
      `- If you encounter a blocker, document it clearly and move on to what you can complete.`,
    ];

    if (task.max_turns) {
      lines.push(`- Turn limit: ${task.max_turns}`);
    }
    if (task.max_usd) {
      lines.push(`- Budget limit: $${task.max_usd.toFixed(2)}`);
    }

    // Include results from completed dependencies
    if (task.depends_on && task.depends_on.length > 0) {
      const depResults: string[] = [];
      for (const depId of task.depends_on) {
        const depResult = this.taskResults.get(depId);
        if (depResult && depResult.status === 'completed') {
          depResults.push(`### ${depResult.title} (${depId})\n${depResult.output_summary}`);
        }
      }
      if (depResults.length > 0) {
        lines.push('', '## Results from prerequisite tasks', '', ...depResults);
      }
    }

    return lines.join('\n');
  }

  /**
   * Poll an agent run until it completes, fails, or times out.
   */
  private async pollAgentCompletion(
    runId: string,
    task: NightTask,
  ): Promise<{
    status: string;
    output_summary?: string;
    error_message?: string;
    total_cost_usd?: number;
    total_input_tokens?: number;
    total_output_tokens?: number;
  }> {
    const timeoutAt = Date.now() + AGENT_TIMEOUT_MS;
    let pollInterval = 5_000; // Start at 5s, back off to 15s

    while (Date.now() < timeoutAt && !this.shutdownRequested) {
      try {
        const run = await this.client.getAgentRun(runId);

        if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
          return {
            status: run.status,
            output_summary: run.output_summary ?? undefined,
            error_message: run.error_message ?? undefined,
            total_cost_usd: run.total_cost_usd ? Number(run.total_cost_usd) : 0,
            total_input_tokens: run.total_input_tokens ?? 0,
            total_output_tokens: run.total_output_tokens ?? 0,
          };
        }

        // Check if shared budget is exhausted mid-task
        if (this.totalUsdSpent >= this.config.maxBudgetUsd) {
          this.log('warn', `Budget exhausted mid-task "${task.id}" — cancelling agent ${runId}`);
          await this.client.updateAgentStatus(runId, 'cancelled', {
            error_message: 'Cancelled: night run budget exhausted',
          });
          return {
            status: 'failed',
            error_message: 'Cancelled: night run budget exhausted',
          };
        }

        this.consecutiveSupabaseFailures = 0;
      } catch (err: any) {
        this.consecutiveSupabaseFailures++;
        this.log('warn', `Poll error for agent ${runId}: ${err.message} (attempt ${this.consecutiveSupabaseFailures})`);

        if (this.consecutiveSupabaseFailures >= MAX_SUPABASE_RETRIES) {
          throw new Error(`Supabase unreachable after ${MAX_SUPABASE_RETRIES} consecutive failures — aborting task`);
        }
      }

      await sleep(pollInterval);
      pollInterval = Math.min(pollInterval + 2_000, 15_000); // Back off
    }

    // Timed out
    this.log('warn', `Agent ${runId} timed out after ${AGENT_TIMEOUT_MS / 1000}s — marking as failed`);
    try {
      await this.client.updateAgentStatus(runId, 'failed', {
        error_message: `Timed out after ${AGENT_TIMEOUT_MS / 60_000} minutes`,
      });
    } catch { /* best effort */ }

    return {
      status: 'failed',
      error_message: `Agent timed out after ${AGENT_TIMEOUT_MS / 60_000} minutes`,
    };
  }

  // =========================================================================
  // Task Scheduling
  // =========================================================================

  /**
   * Get tasks that are ready to run: pending, all dependencies completed, sorted by priority.
   */
  private getAvailableTasks(): NightTask[] {
    const available: NightTask[] = [];

    for (const task of this.tasks.values()) {
      if (task.status !== 'pending') continue;
      if (this.activeTasks.has(task.id)) continue;

      // Check dependencies
      const depsOk = (task.depends_on ?? []).every(depId => {
        const dep = this.tasks.get(depId);
        // If dependency doesn't exist in our set, treat as satisfied (external dep)
        if (!dep) return true;
        return dep.status === 'completed';
      });

      // Check if any dependency failed (skip this task)
      const depFailed = (task.depends_on ?? []).some(depId => {
        const dep = this.tasks.get(depId);
        return dep && (dep.status === 'failed' || dep.status === 'skipped');
      });

      if (depFailed) {
        // Auto-skip tasks whose dependencies failed
        task.status = 'skipped';
        this.taskResults.set(task.id, {
          task_id: task.id,
          title: task.title,
          status: 'skipped',
          agent_type: task.agent_type ?? 'general_purpose',
          started_at: null,
          completed_at: new Date().toISOString(),
          duration_ms: 0,
          usd_spent: 0,
          tokens_used: 0,
          output_summary: 'Skipped: dependency failed or was skipped',
          error: null,
        });
        continue;
      }

      if (depsOk) {
        available.push(task);
      }
    }

    // Sort by priority (1 = highest = first)
    available.sort((a, b) => a.priority - b.priority);

    return available;
  }

  /**
   * Skip all tasks that transitively depend on a failed task.
   */
  private skipDependentTasks(failedId: string): void {
    for (const task of this.tasks.values()) {
      if (task.status !== 'pending') continue;
      if (task.depends_on?.includes(failedId)) {
        this.log('info', `Skipping task "${task.id}" — depends on failed task "${failedId}"`);
        task.status = 'skipped';
        this.taskResults.set(task.id, {
          task_id: task.id,
          title: task.title,
          status: 'skipped',
          agent_type: task.agent_type ?? 'general_purpose',
          started_at: null,
          completed_at: new Date().toISOString(),
          duration_ms: 0,
          usd_spent: 0,
          tokens_used: 0,
          output_summary: `Skipped: dependency "${failedId}" failed`,
          error: null,
        });
        // Recurse — skip tasks that depend on this skipped task
        this.skipDependentTasks(task.id);
      }
    }
  }

  // =========================================================================
  // Stop Conditions
  // =========================================================================

  private shouldStop(): boolean {
    if (this.shutdownRequested) return true;

    // Budget exhausted
    if (this.totalUsdSpent >= this.config.maxBudgetUsd) {
      this.log('info', 'Budget limit reached');
      return true;
    }

    // Duration limit
    if (this.startedAt) {
      const elapsed = (Date.now() - this.startedAt.getTime()) / 60_000;
      if (elapsed >= this.config.maxDurationMinutes) {
        this.log('info', 'Duration limit reached');
        return true;
      }
    }

    return false;
  }

  // =========================================================================
  // Polling for New Tasks
  // =========================================================================

  private startPolling(): void {
    if (this.config.taskSource !== 'thoughts') return;
    const intervalMs = this.config.checkIntervalMinutes * 60_000;
    this.schedulePoll(intervalMs);
  }

  private schedulePoll(intervalMs: number): void {
    this.pollTimer = setTimeout(async () => {
      if (this.shutdownRequested || !this.running) return;
      try {
        await this.pollForNewTasks();
      } catch (err: any) {
        this.log('warn', `Poll error: ${err.message}`);
      }
      if (!this.shutdownRequested && this.running) {
        this.schedulePoll(intervalMs);
      }
    }, intervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollForNewTasks(): Promise<void> {
    this.log('debug', 'Polling for new tasks...');
    const before = this.tasks.size;
    await this.loadTasksFromThoughts();
    const added = this.tasks.size - before;
    if (added > 0) {
      this.log('info', `Poll found ${added} new task(s)`);
    }
  }

  // =========================================================================
  // Heartbeat
  // =========================================================================

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const status = this.getStatus();
      this.log('info', `Heartbeat: ${status.completed}/${status.total_tasks} done, ${status.active} active, $${status.usd_spent.toFixed(4)} spent, ${status.time_remaining_minutes.toFixed(0)}min left`);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // =========================================================================
  // Signal Handling
  // =========================================================================

  private installSignalHandlers(): void {
    if (typeof process === 'undefined') return;

    // SIGTERM / SIGINT: graceful shutdown
    const shutdownHandler = () => {
      this.log('info', 'Received shutdown signal — finishing current tasks');
      this.stop();
    };

    // SIGUSR1: print status (Unix only)
    const statusHandler = () => {
      const status = this.getStatus();
      console.log('\n--- NightRunner Status ---');
      console.log(JSON.stringify(status, null, 2));
      console.log('--- End Status ---\n');
    };

    process.on('SIGTERM', shutdownHandler);
    process.on('SIGINT', shutdownHandler);
    this.signalHandlers.push({ signal: 'SIGTERM', handler: shutdownHandler });
    this.signalHandlers.push({ signal: 'SIGINT', handler: shutdownHandler });

    // SIGUSR1 is not available on Windows
    if (process.platform !== 'win32') {
      process.on('SIGUSR1', statusHandler);
      this.signalHandlers.push({ signal: 'SIGUSR1', handler: statusHandler });
    }
  }

  private removeSignalHandlers(): void {
    if (typeof process === 'undefined') return;
    for (const { signal, handler } of this.signalHandlers) {
      process.removeListener(signal, handler);
    }
    this.signalHandlers = [];
  }

  // =========================================================================
  // Report Generation
  // =========================================================================

  private generateReport(): NightRunReport {
    const completedAt = new Date();
    const startedAt = this.startedAt ?? completedAt;
    const durationMs = completedAt.getTime() - startedAt.getTime();

    const results = Array.from(this.taskResults.values());

    return {
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      duration_minutes: Math.round((durationMs / 60_000) * 10) / 10,
      total_tasks: this.tasks.size,
      completed_tasks: results.filter(r => r.status === 'completed').length,
      failed_tasks: results.filter(r => r.status === 'failed').length,
      skipped_tasks: results.filter(r => r.status === 'skipped').length,
      total_usd_spent: Math.round(this.totalUsdSpent * 10000) / 10000,
      total_tokens_used: this.totalTokensUsed,
      task_results: results,
      errors: [...this.runErrors],
    };
  }

  private async persistReport(report: NightRunReport): Promise<void> {
    try {
      const reportContent = [
        `# Night Run Report`,
        '',
        `**Started:** ${report.started_at}`,
        `**Completed:** ${report.completed_at}`,
        `**Duration:** ${report.duration_minutes} minutes`,
        '',
        `## Summary`,
        `- Total tasks: ${report.total_tasks}`,
        `- Completed: ${report.completed_tasks}`,
        `- Failed: ${report.failed_tasks}`,
        `- Skipped: ${report.skipped_tasks}`,
        `- Total USD spent: $${report.total_usd_spent.toFixed(4)}`,
        `- Total tokens: ${report.total_tokens_used.toLocaleString()}`,
        '',
        `## Task Results`,
        '',
        ...report.task_results.map(r => {
          const icon = r.status === 'completed' ? '[DONE]' : r.status === 'failed' ? '[FAIL]' : '[SKIP]';
          const lines = [`### ${icon} ${r.title} (${r.task_id})`];
          lines.push(`- Status: ${r.status}`);
          lines.push(`- Agent: ${r.agent_type}`);
          if (r.duration_ms > 0) lines.push(`- Duration: ${Math.round(r.duration_ms / 1000)}s`);
          if (r.usd_spent > 0) lines.push(`- Cost: $${r.usd_spent.toFixed(4)}`);
          if (r.output_summary) lines.push(`- Summary: ${r.output_summary.substring(0, 500)}`);
          if (r.error) lines.push(`- Error: ${r.error}`);
          lines.push('');
          return lines.join('\n');
        }),
      ].join('\n');

      await this.client.memoryStore(reportContent, {
        type: 'night_run_report',
        memory_scope: 'project',
        memory_type: 'observation',
        tags: ['night-run', 'report', 'automated'],
        provenance: {
          source_type: 'tool_observed',
          trust_level: 5,
          created_at: new Date().toISOString(),
        },
        summary: {
          total: report.total_tasks,
          completed: report.completed_tasks,
          failed: report.failed_tasks,
          usd: report.total_usd_spent,
          duration_min: report.duration_minutes,
        },
      });

      this.log('info', 'Report stored as OB1 thought');
    } catch (err: any) {
      this.log('warn', `Failed to persist report to OB1: ${err.message}`);
    }

    // Also log to system events
    this.logEvent('coordinator', 'info', 'night_run_completed', {
      total_tasks: report.total_tasks,
      completed: report.completed_tasks,
      failed: report.failed_tasks,
      skipped: report.skipped_tasks,
      usd_spent: report.total_usd_spent,
      duration_minutes: report.duration_minutes,
    });
  }

  // =========================================================================
  // Supabase Resilience
  // =========================================================================

  /**
   * Retry a Supabase operation with exponential backoff.
   * Used for critical operations (spawn, status update) where transient
   * failures should not kill the entire run.
   */
  private async withSupabaseRetry<T>(fn: () => Promise<T>, maxRetries = MAX_SUPABASE_RETRIES): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await fn();
        this.consecutiveSupabaseFailures = 0;
        return result;
      } catch (err: any) {
        lastError = err;
        this.consecutiveSupabaseFailures++;
        if (attempt < maxRetries - 1) {
          const delay = SUPABASE_RETRY_DELAY_MS * Math.pow(2, attempt);
          this.log('warn', `Supabase call failed (attempt ${attempt + 1}/${maxRetries}): ${err.message} — retrying in ${delay / 1000}s`);
          await sleep(delay);
        }
      }
    }
    throw lastError ?? new Error('Supabase operation failed after retries');
  }

  // =========================================================================
  // Logging
  // =========================================================================

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const timestamp = new Date().toISOString();
    const prefix = `[NightRunner ${timestamp}]`;
    switch (level) {
      case 'debug':
        if (typeof process !== 'undefined' && process.env.DEBUG) {
          console.debug(`${prefix} ${message}`);
        }
        break;
      case 'info':
        console.log(`${prefix} ${message}`);
        break;
      case 'warn':
        console.warn(`${prefix} [WARN] ${message}`);
        break;
      case 'error':
        console.error(`${prefix} [ERROR] ${message}`);
        break;
    }
  }

  private logEvent(category: string, severity: string, title: string, detail: Record<string, unknown>): void {
    // Fire and forget — don't let logging failures affect the run
    this.client.logEvent({
      session_id: `night_runner_${this.startedAt?.getTime() ?? Date.now()}`,
      category: category as any,
      severity: severity as any,
      title,
      detail,
    }).catch(() => { /* non-fatal */ });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomSuffix(): string {
  return Math.random().toString(36).substring(2, 8);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Standalone CLI runner
// ---------------------------------------------------------------------------

if (typeof process !== 'undefined' && process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    const args = process.argv.slice(2);

    // Parse CLI arguments
    const getArg = (name: string): string | undefined => {
      const idx = args.indexOf(`--${name}`);
      return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
    };
    const hasFlag = (name: string): boolean => args.includes(`--${name}`);

    if (hasFlag('help') || hasFlag('h')) {
      console.log(`
Usage: node night-runner.js [options]

Options:
  --max-usd <amount>       Maximum USD budget (default: 20.00)
  --max-hours <hours>      Maximum run duration in hours (default: 8)
  --max-agents <count>     Maximum concurrent agents (default: 3)
  --tasks <file>           Path to JSON task file
  --source <type>          Task source: "thoughts" or "file" (default: thoughts)
  --model <model>          Model to use: haiku, sonnet, opus (default: sonnet)
  --poll-interval <min>    Minutes between task polls (default: 5)
  --no-report              Don't store report in OB1 memory
  --help                   Show this help message

Environment Variables:
  SUPABASE_URL             Supabase project URL (required)
  SUPABASE_SERVICE_ROLE_KEY  Supabase service role key (required)
  ANTHROPIC_API_KEY        Anthropic API key (required)

Examples:
  # Run overnight from OB1 thoughts
  node night-runner.js --max-usd 20 --max-hours 8 --source thoughts

  # Run from a task file
  node night-runner.js --max-usd 10 --tasks night-tasks.json

  # Quick run with small budget
  node night-runner.js --max-usd 5 --max-hours 1 --max-agents 1
`);
      process.exit(0);
    }

    // Validate required env vars
    const supabaseUrl = process.env.SUPABASE_URL;
    const accessKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (!supabaseUrl || !accessKey || !anthropicKey) {
      const missing: string[] = [];
      if (!supabaseUrl) missing.push('SUPABASE_URL');
      if (!accessKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
      if (!anthropicKey) missing.push('ANTHROPIC_API_KEY');
      console.error(`Missing required environment variables: ${missing.join(', ')}`);
      process.exit(1);
    }

    const maxHours = parseFloat(getArg('max-hours') ?? '8');
    const source = getArg('source') ?? (getArg('tasks') ? 'file' : 'thoughts');

    const config: NightRunnerConfig = {
      supabaseUrl,
      accessKey,
      anthropicKey,
      model: getArg('model') ?? 'sonnet',
      maxBudgetUsd: parseFloat(getArg('max-usd') ?? '20'),
      maxDurationMinutes: maxHours * 60,
      maxConcurrentAgents: parseInt(getArg('max-agents') ?? '3', 10),
      taskSource: source as 'thoughts' | 'file',
      taskFile: getArg('tasks'),
      checkIntervalMinutes: parseInt(getArg('poll-interval') ?? '5', 10),
      reportToMemory: !hasFlag('no-report'),
      onTaskComplete: (task, result) => {
        const icon = result.status === 'completed' ? '[DONE]' : result.status === 'failed' ? '[FAIL]' : '[SKIP]';
        console.log(`\n${icon} ${task.title} ($${result.usd_spent.toFixed(4)}, ${Math.round(result.duration_ms / 1000)}s)\n`);
      },
      onError: (error, task) => {
        if (task) {
          console.error(`\n[ERROR] Task "${task.id}": ${error.message}\n`);
        } else {
          console.error(`\n[ERROR] ${error.message}\n`);
        }
      },
    };

    console.log('');
    console.log('  ================================================');
    console.log('  NightRunner — Autonomous Overnight Task Executor');
    console.log('  ================================================');
    console.log(`  Budget:      $${config.maxBudgetUsd?.toFixed(2)}`);
    console.log(`  Duration:    ${maxHours}h`);
    console.log(`  Concurrency: ${config.maxConcurrentAgents} agents`);
    console.log(`  Source:      ${config.taskSource}${config.taskFile ? ` (${config.taskFile})` : ''}`);
    console.log(`  Model:       ${config.model}`);
    console.log('');

    const runner = new NightRunner(config);
    const report = await runner.start();

    // Print summary
    console.log('');
    console.log('  ====== Night Run Complete ======');
    console.log(`  Duration:  ${report.duration_minutes} minutes`);
    console.log(`  Tasks:     ${report.completed_tasks} done, ${report.failed_tasks} failed, ${report.skipped_tasks} skipped (${report.total_tasks} total)`);
    console.log(`  Cost:      $${report.total_usd_spent.toFixed(4)}`);
    console.log(`  Tokens:    ${report.total_tokens_used.toLocaleString()}`);
    if (report.errors.length > 0) {
      console.log(`  Errors:    ${report.errors.length}`);
      for (const err of report.errors.slice(0, 5)) {
        console.log(`             - ${err}`);
      }
    }
    console.log('  ================================');
    console.log('');

    process.exit(report.failed_tasks > 0 ? 1 : 0);
  })().catch(err => {
    console.error(`Fatal error: ${err.message}`);
    process.exit(2);
  });
}
