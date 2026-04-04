// =============================================================================
// coordinator.ts — Agent Coordinator
//
// Manages multi-agent execution with dependency resolution, wave-based parallel
// scheduling, inter-agent communication, and durable state persistence.
//
// The coordinator is the orchestration layer that Claude Code lacks:
//   - DAG-based dependency graph with cycle detection
//   - Wave scheduling: agents grouped into parallel batches
//   - Message passing between agents via Supabase (agent_messages table)
//   - Full lifecycle tracking persisted to agent_runs table
//
// Uses OB1Client.spawnAgent(), updateAgentStatus(), sendMessage(), etc.
//
// Blueprint: 06_agent_type_system.md, Sections 5-7
// =============================================================================

import type { OB1Client } from './ob1-client.js';
import type { AgentRun as AgentRunRecord, AgentRunStatus, BudgetConfig } from './types.js';
import type { ConversationRuntime } from './conversation-runtime.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for spawning a sub-agent */
export interface SpawnOptions {
  taskContext?: Record<string, unknown>;
  dependsOn?: string[];
  budgetOverride?: BudgetConfig;
  model?: string;
  parentRunId?: string;
}

/** A job in the execution plan */
export interface AgentJob {
  /** Unique identifier — assigned by plan() or provided upfront */
  runId: string;
  /** Agent type name to use */
  agentType: string;
  /** The task prompt */
  task: string;
  /** Additional structured context */
  taskContext?: Record<string, unknown>;
  /** Run IDs that must complete first */
  dependsOn: string[];
}

/** Coordinator-level result of a single agent execution */
export interface AgentRun {
  runId: string;
  agentType: string;
  status: AgentRunStatus;
  outputSummary: string;
  outputData: Record<string, unknown>;
  errorMessage: string | null;
  durationMs: number;
  totalCostUsd: number;
  iterationCount: number;
  thoughtIds: string[];
}

/** Result of a single wave execution */
export interface WaveResult {
  waveIndex: number;
  agents: AgentRun[];
  durationMs: number;
}

/** Inter-agent message (coordinator-level view) */
export interface AgentMessage {
  id: string;
  fromRunId: string;
  toRunId: string | null;
  channel: string;
  messageType: string;
  content: Record<string, unknown>;
  summary: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Dependency Graph
// ---------------------------------------------------------------------------

interface DagNode {
  runId: string;
  agentType: string;
  dependsOn: string[];
  status: AgentRunStatus;
}

class DependencyGraph {
  private nodes: Map<string, DagNode> = new Map();

  addNode(node: DagNode): void {
    this.nodes.set(node.runId, node);
  }

  getNode(runId: string): DagNode | undefined {
    return this.nodes.get(runId);
  }

  /** Agents ready to run (all deps completed) */
  getReady(): DagNode[] {
    const ready: DagNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.status !== 'pending') continue;
      if (node.dependsOn.every(d => { const dep = this.nodes.get(d); return dep && dep.status === 'completed'; })) {
        ready.push(node);
      }
    }
    return ready;
  }

  markComplete(runId: string): DagNode[] {
    const node = this.nodes.get(runId);
    if (node) node.status = 'completed';
    return this.getReady();
  }

  markFailed(runId: string): DagNode[] {
    const node = this.nodes.get(runId);
    if (node) node.status = 'failed';
    const blocked: DagNode[] = [];
    for (const n of this.nodes.values()) {
      if (n.status !== 'pending') continue;
      if (this.transitivelyDependsOn(n.runId, runId)) blocked.push(n);
    }
    return blocked;
  }

  detectCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const dfs = (nodeId: string, path: string[]): void => {
      if (inStack.has(nodeId)) { cycles.push(path.slice(path.indexOf(nodeId))); return; }
      if (visited.has(nodeId)) return;
      visited.add(nodeId); inStack.add(nodeId);
      const node = this.nodes.get(nodeId);
      if (node) for (const depId of node.dependsOn) dfs(depId, [...path, nodeId]);
      inStack.delete(nodeId);
    };
    for (const nodeId of this.nodes.keys()) dfs(nodeId, []);
    return cycles;
  }

  toWaves(): DagNode[][] {
    const waves: DagNode[][] = [];
    const completed = new Set<string>();
    const remaining = new Set(this.nodes.keys());
    while (remaining.size > 0) {
      const wave: DagNode[] = [];
      for (const nodeId of remaining) {
        const node = this.nodes.get(nodeId)!;
        if (node.dependsOn.every(d => completed.has(d))) wave.push(node);
      }
      if (wave.length === 0 && remaining.size > 0) {
        throw new Error(`Dependency deadlock: ${remaining.size} nodes cannot be scheduled. Stuck: ${[...remaining].join(', ')}`);
      }
      for (const node of wave) { remaining.delete(node.runId); completed.add(node.runId); }
      waves.push(wave);
    }
    return waves;
  }

  getSummary(): { total: number; pending: number; running: number; completed: number; failed: number } {
    let pending = 0, running = 0, completed = 0, failed = 0;
    for (const node of this.nodes.values()) {
      switch (node.status) {
        case 'pending': pending++; break;
        case 'running': running++; break;
        case 'completed': completed++; break;
        default: failed++; break;
      }
    }
    return { total: this.nodes.size, pending, running, completed, failed };
  }

  private transitivelyDependsOn(nodeId: string, targetId: string, visited = new Set<string>()): boolean {
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    for (const depId of node.dependsOn) {
      if (depId === targetId) return true;
      if (this.transitivelyDependsOn(depId, targetId, visited)) return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// AgentCoordinator
// ---------------------------------------------------------------------------

export class AgentCoordinator {
  private client: OB1Client;
  private runtime: ConversationRuntime;
  private coordinatorRunId: string;
  private dag: DependencyGraph = new DependencyGraph();
  private activeRuntimes: Map<string, Promise<AgentRun>> = new Map();
  private results: Map<string, AgentRun> = new Map();
  private agentJobs: Map<string, AgentJob> = new Map();

  constructor(client: OB1Client, runtime: ConversationRuntime) {
    this.client = client;
    this.runtime = runtime;
    this.coordinatorRunId = `coord_${Date.now()}_${randomSuffix()}`;
  }

  // ── Spawn ───────────────────────────────────────────────────

  /**
   * Spawn a sub-agent with an isolated runtime.
   * Persists the run to agent_runs via OB1Client.spawnAgent(),
   * then executes the agent and collects results.
   */
  async spawn(agentType: string, task: string, options?: SpawnOptions): Promise<AgentRun> {
    const startMs = Date.now();

    // Wait for dependencies first
    if (options?.dependsOn && options.dependsOn.length > 0) {
      await this.awaitDependencies(options.dependsOn);
    }

    // Create the run via OB1Client (persists to agent_runs table)
    let runRecord: AgentRunRecord;
    try {
      runRecord = await this.client.spawnAgent(agentType, {
        task_prompt: task,
        task_context: options?.taskContext,
        coordinator_run_id: this.coordinatorRunId,
        parent_run_id: options?.parentRunId,
        depends_on: options?.dependsOn,
        budget_config: options?.budgetOverride,
      });
    } catch (err: any) {
      return {
        runId: `failed_${Date.now()}`,
        agentType,
        status: 'failed',
        outputSummary: '',
        outputData: {},
        errorMessage: `Failed to spawn agent: ${err.message}`,
        durationMs: Date.now() - startMs,
        totalCostUsd: 0,
        iterationCount: 0,
        thoughtIds: [],
      };
    }

    const runId = runRecord.run_id;
    this.agentJobs.set(runId, { runId, agentType, task, taskContext: options?.taskContext, dependsOn: options?.dependsOn ?? [] });

    // Add to DAG
    this.dag.addNode({ runId, agentType, dependsOn: options?.dependsOn ?? [], status: 'running' });

    // Execute the agent using a forked runtime
    try {
      const forkedRuntime = this.runtime.fork({
        name: agentType,
        display_name: agentType,
        permission_mode: 'read_only' as any,
        system_prompt: '',
        allowed_tools: [],
        denied_tools: [],
        max_iterations: 50,
        output_format: 'markdown',
      } as any);

      const runResult = await forkedRuntime.run(task);

      const agentRun: AgentRun = {
        runId,
        agentType,
        status: runResult.stopReason === 'error' ? 'failed' : 'completed',
        outputSummary: runResult.lastAssistantMessage?.substring(0, 2000) ?? '',
        outputData: runResult.metadata ?? {},
        errorMessage: runResult.stopReason === 'error' ? (runResult.error ?? null) : null,
        durationMs: Date.now() - startMs,
        totalCostUsd: runResult.totalCostUsd ?? 0,
        iterationCount: runResult.turnCount ?? 0,
        thoughtIds: [],
      };

      this.results.set(runId, agentRun);
      this.dag.markComplete(runId);

      // Update status in Supabase
      await this.client.updateAgentStatus(runId, agentRun.status as AgentRunStatus, {
        output_summary: agentRun.outputSummary,
        output_data: agentRun.outputData,
        error_message: agentRun.errorMessage ?? undefined,
      });

      return agentRun;
    } catch (err: any) {
      const failRun: AgentRun = {
        runId,
        agentType,
        status: 'failed',
        outputSummary: '',
        outputData: {},
        errorMessage: err.message,
        durationMs: Date.now() - startMs,
        totalCostUsd: 0,
        iterationCount: 0,
        thoughtIds: [],
      };

      this.results.set(runId, failRun);
      this.dag.markFailed(runId);

      await this.client.updateAgentStatus(runId, 'failed', { error_message: err.message });

      return failRun;
    }
  }

  // ── Wave-based execution ────────────────────────────────────

  /**
   * Run multiple agents in dependency order using wave-based parallel execution.
   */
  async executeWaves(agents: AgentJob[]): Promise<WaveResult[]> {
    // Build graph
    const graph = this.buildDependencyGraph(agents);

    // Cycle check
    const cycles = graph.detectCycles();
    if (cycles.length > 0) {
      throw new Error(`Dependency cycles detected: ${cycles.map(c => c.join(' -> ')).join('; ')}`);
    }

    const waves = graph.toWaves();
    const waveResults: WaveResult[] = [];

    for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
      const wave = waves[waveIdx];
      const waveStart = Date.now();

      // Log wave start
      await this.logEvent('coordinator', {
        event: 'wave_started',
        waveIndex: waveIdx,
        waveSize: wave.length,
        agents: wave.map(n => ({ runId: n.runId, type: n.agentType })),
      });

      // Execute all agents in this wave concurrently
      const wavePromises = wave.map(async (node) => {
        const job = agents.find(a => a.runId === node.runId)!;

        // Inject results from completed dependencies
        const depResults = this.gatherDependencyResults(node.dependsOn);
        const taskWithContext = Object.keys(depResults).length > 0
          ? `${job.task}\n\n## Results from prior agents\n\n${JSON.stringify(depResults, null, 2)}`
          : job.task;

        return this.spawn(job.agentType, taskWithContext, {
          taskContext: job.taskContext,
        });
      });

      const settled = await Promise.allSettled(wavePromises);
      const waveAgents: AgentRun[] = settled.map((result, i) => {
        if (result.status === 'fulfilled') {
          graph.markComplete(wave[i].runId);
          return result.value;
        } else {
          graph.markFailed(wave[i].runId);
          return {
            runId: wave[i].runId,
            agentType: wave[i].agentType,
            status: 'failed' as AgentRunStatus,
            outputSummary: '',
            outputData: {},
            errorMessage: result.reason?.message ?? 'Unknown error',
            durationMs: 0,
            totalCostUsd: 0,
            iterationCount: 0,
            thoughtIds: [],
          };
        }
      });

      waveResults.push({ waveIndex: waveIdx, agents: waveAgents, durationMs: Date.now() - waveStart });
    }

    return waveResults;
  }

  // ── Fire and forget ─────────────────────────────────────────

  /**
   * Spawn an agent without waiting for completion.
   */
  async fireAndForget(agentType: string, task: string): Promise<string> {
    const runRecord = await this.client.spawnAgent(agentType, {
      task_prompt: task,
      coordinator_run_id: this.coordinatorRunId,
    });

    const runId = runRecord.run_id;

    const promise = (async (): Promise<AgentRun> => {
      try {
        const forkedRuntime = this.runtime.fork({
          name: agentType,
          display_name: agentType,
          permission_mode: 'read_only' as any,
          system_prompt: '',
          allowed_tools: [],
          denied_tools: [],
          max_iterations: 50,
          output_format: 'markdown',
        } as any);

        const runResult = await forkedRuntime.run(task);
        const agentRun: AgentRun = {
          runId,
          agentType,
          status: runResult.stopReason === 'error' ? 'failed' : 'completed',
          outputSummary: runResult.lastAssistantMessage?.substring(0, 2000) ?? '',
          outputData: runResult.metadata ?? {},
          errorMessage: runResult.stopReason === 'error' ? (runResult.error ?? null) : null,
          durationMs: 0,
          totalCostUsd: runResult.totalCostUsd ?? 0,
          iterationCount: runResult.turnCount ?? 0,
          thoughtIds: [],
        };
        this.results.set(runId, agentRun);
        await this.client.updateAgentStatus(runId, agentRun.status as AgentRunStatus, {
          output_summary: agentRun.outputSummary,
          output_data: agentRun.outputData,
          error_message: agentRun.errorMessage ?? undefined,
        });
        return agentRun;
      } catch (err: any) {
        const failRun: AgentRun = { runId, agentType, status: 'failed', outputSummary: '', outputData: {}, errorMessage: err.message, durationMs: 0, totalCostUsd: 0, iterationCount: 0, thoughtIds: [] };
        this.results.set(runId, failRun);
        await this.client.updateAgentStatus(runId, 'failed', { error_message: err.message });
        return failRun;
      }
    })();

    this.activeRuntimes.set(runId, promise);
    promise.finally(() => this.activeRuntimes.delete(runId));

    return runId;
  }

  // ── Wait for completion ─────────────────────────────────────

  async awaitAgent(runId: string, timeoutMs = 300_000): Promise<AgentRun> {
    // Already completed?
    const existing = this.results.get(runId);
    if (existing) return existing;

    // Still running locally?
    const active = this.activeRuntimes.get(runId);
    if (active) {
      return Promise.race([active, timeoutPromise(timeoutMs, runId)]);
    }

    // Check database
    const record = await this.client.getAgentRun(runId);
    return {
      runId: record.run_id,
      agentType: record.agent_type,
      status: record.status,
      outputSummary: record.output_summary ?? '',
      outputData: record.output_data ?? {},
      errorMessage: record.error_message ?? null,
      durationMs: record.duration_ms ?? 0,
      totalCostUsd: Number(record.total_cost_usd ?? 0),
      iterationCount: record.iteration_count ?? 0,
      thoughtIds: record.thought_ids ?? [],
    };
  }

  // ── Inter-agent communication ───────────────────────────────

  async sendMessage(fromRunId: string, toRunId: string, content: any): Promise<void> {
    await this.client.sendMessage(
      fromRunId,
      toRunId,
      typeof content === 'string' ? { text: content } : content,
      {
        coordinator_run_id: this.coordinatorRunId,
        channel: 'default',
        message_type: 'data',
        summary: typeof content === 'string' ? content.substring(0, 200) : JSON.stringify(content).substring(0, 200),
      },
    );
  }

  async getMessages(runId: string): Promise<AgentMessage[]> {
    const messages = await this.client.getMessages(runId, true);
    return messages.map(m => ({
      id: m.id ?? '',
      fromRunId: m.from_run_id,
      toRunId: m.to_run_id ?? null,
      channel: m.channel ?? 'default',
      messageType: m.message_type,
      content: m.content,
      summary: m.summary ?? '',
      createdAt: m.created_at ?? '',
    }));
  }

  // ── Status ──────────────────────────────────────────────────

  getStatus(): {
    coordinatorRunId: string;
    agents: Array<{ runId: string; agentType: string; status: AgentRunStatus; durationMs?: number }>;
    activeCount: number;
    completedCount: number;
    dagSummary: ReturnType<DependencyGraph['getSummary']>;
  } {
    const agents: Array<{ runId: string; agentType: string; status: AgentRunStatus; durationMs?: number }> = [];
    for (const [runId, job] of this.agentJobs) {
      const result = this.results.get(runId);
      agents.push({ runId, agentType: job.agentType, status: (result?.status ?? 'running') as AgentRunStatus, durationMs: result?.durationMs });
    }
    return { coordinatorRunId: this.coordinatorRunId, agents, activeCount: this.activeRuntimes.size, completedCount: this.results.size, dagSummary: this.dag.getSummary() };
  }

  async awaitAll(): Promise<void> {
    await Promise.allSettled(Array.from(this.activeRuntimes.values()));
  }

  async cancel(runId: string): Promise<void> {
    await this.client.updateAgentStatus(runId, 'cancelled');
    this.dag.markFailed(runId);
  }

  // ── Private ─────────────────────────────────────────────────

  private buildDependencyGraph(agents: AgentJob[]): DependencyGraph {
    const graph = new DependencyGraph();
    for (const agent of agents) {
      graph.addNode({ runId: agent.runId, agentType: agent.agentType, dependsOn: agent.dependsOn, status: 'pending' });
    }
    return graph;
  }

  private async awaitDependencies(dependsOn: string[]): Promise<void> {
    const promises = dependsOn.map(depId => {
      const active = this.activeRuntimes.get(depId);
      if (active) return active;
      const existing = this.results.get(depId);
      if (existing) return Promise.resolve(existing);
      return Promise.resolve(null);
    });
    await Promise.allSettled(promises);
  }

  private gatherDependencyResults(depRunIds: string[]): Record<string, unknown> {
    const results: Record<string, unknown> = {};
    for (const depId of depRunIds) {
      const result = this.results.get(depId);
      if (result && result.status === 'completed') {
        results[depId] = { agentType: result.agentType, summary: result.outputSummary, data: result.outputData };
      }
    }
    return results;
  }

  private async logEvent(category: string, data: Record<string, unknown>): Promise<void> {
    try {
      await this.client.logEvent({
        session_id: this.coordinatorRunId,
        category: category as any,
        severity: 'info',
        title: typeof data.event === 'string' ? data.event : category,
        detail: data,
      });
    } catch { /* non-fatal */ }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomSuffix(): string {
  return Math.random().toString(36).substring(2, 8);
}

function timeoutPromise(ms: number, runId: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Agent "${runId}" timed out after ${ms}ms`)), ms);
  });
}
