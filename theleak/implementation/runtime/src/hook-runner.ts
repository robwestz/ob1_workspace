// =============================================================================
// hook-runner.ts — Pre/Post Tool Hook Execution Engine
//
// Executes shell-based hooks around tool invocations in the agentic loop.
// Hooks are external scripts (any language) that receive JSON on stdin and
// communicate outcomes via exit codes:
//
//   Exit 0 = Allow  (tool proceeds; stdout captured as feedback)
//   Exit 1 = Warn   (tool proceeds; warning from stdout/stderr)
//   Exit 2 = Deny   (tool blocked; stdout used as denial message)
//   Other  = Warn   (tool proceeds with crash/signal warning)
//
// Hooks run sequentially per event. First denial short-circuits the chain.
//
// Integration point: called by the agentic loop after permission check
// (pre-hooks) and after tool execution (post-hooks).
// =============================================================================

import { spawn, type ChildProcess } from 'node:child_process';
import { platform } from 'node:os';
import { randomUUID } from 'node:crypto';
import { OB1Client } from './ob1-client.js';
import {
  type HookConfig,
  HookEvent,
} from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Outcome of a single hook command execution. */
export type HookOutcome = 'allow' | 'warn' | 'deny' | 'timeout' | 'error';

/** JSON payload piped to hook stdin. */
export interface HookPayload {
  hook_event_name: string;
  tool_name: string;
  tool_input: unknown;
  tool_input_json: string;
  tool_output: string | null;
  tool_result_is_error: boolean;
}

/** Extended result from a single hook command execution. */
export interface HookExecutionResult {
  hook_id: string;
  hook_name: string;
  outcome: HookOutcome;
  exit_code: number | null;
  feedback: string | null;
  error_output: string | null;
  duration_ms: number;
  timed_out: boolean;
}

/** Decision from running all hooks for an event. */
export interface HookDecision {
  /** Whether the tool is allowed to proceed. */
  allowed: boolean;
  /** Feedback messages collected from all hooks (stdout). */
  feedback: string[];
  /** Individual hook results for audit. */
  results: HookExecutionResult[];
  /** The denial message if allowed is false. */
  denial_message?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_STDOUT_LENGTH = 10_000;
const MAX_STDERR_LENGTH = 5_000;

// ---------------------------------------------------------------------------
// HookRunner
// ---------------------------------------------------------------------------

export class HookRunner {
  private client: OB1Client;
  private hooks: HookConfig[];

  constructor(client: OB1Client, hooks: HookConfig[] = []) {
    this.client = client;
    this.hooks = hooks.filter((h) => h.enabled);
    this.hooks.sort((a, b) => a.priority - b.priority);
  }

  // ---- Public API ----

  /**
   * Run pre-tool hooks. Returns whether the tool is allowed to proceed.
   *
   * Pipeline:
   *   1. Filter hooks by event_type=PreToolUse and tool_filter match
   *   2. Sort by priority (lower first)
   *   3. Execute sequentially; short-circuit on first denial (exit 2)
   *   4. Collect feedback from all hooks that ran
   */
  async runPreToolHooks(
    toolName: string,
    toolInput: unknown,
    sessionId: string,
  ): Promise<HookDecision> {
    const applicable = this.getApplicableHooks(HookEvent.PreToolUse, toolName);

    if (applicable.length === 0) {
      return { allowed: true, feedback: [], results: [] };
    }

    const payload = this.buildPayload(HookEvent.PreToolUse, toolName, toolInput, null, false);
    return this.runHookChain(applicable, payload, sessionId);
  }

  /**
   * Run post-tool hooks. Can transform output by appending feedback.
   * Returns the (potentially augmented) tool output string.
   *
   * Post-hook denial marks the result as an error but cannot undo execution.
   */
  async runPostToolHooks(
    toolName: string,
    toolInput: unknown,
    toolOutput: string,
    sessionId: string,
  ): Promise<string> {
    const applicable = this.getApplicableHooks(HookEvent.PostToolUse, toolName);

    if (applicable.length === 0) {
      return toolOutput;
    }

    const payload = this.buildPayload(HookEvent.PostToolUse, toolName, toolInput, toolOutput, false);
    const decision = await this.runHookChain(applicable, payload, sessionId);

    return this.mergeHookFeedback(toolOutput, decision);
  }

  /**
   * Load hooks from OB1 via the client. Replaces the current hook set.
   */
  async loadHooks(): Promise<void> {
    try {
      const configs = await this.client.listHooks({ enabled_only: true });
      this.hooks = configs.filter((h) => h.enabled);
      this.hooks.sort((a, b) => a.priority - b.priority);
    } catch (err) {
      await this.client.logEvent({
        category: 'hook',
        severity: 'error',
        title: 'hook_load_failed',
        detail: {
          error: err instanceof Error ? err.message : String(err),
        },
      }).catch(() => {});
    }
  }

  /** Returns the current hook count (for diagnostics). */
  get hookCount(): number {
    return this.hooks.length;
  }

  // ---- Private: Execution ----

  /**
   * Execute the full hook chain for a given set of hooks.
   * Short-circuits on first denial.
   */
  private async runHookChain(
    hooks: HookConfig[],
    payload: HookPayload,
    sessionId: string,
  ): Promise<HookDecision> {
    const feedback: string[] = [];
    const results: HookExecutionResult[] = [];

    for (const hook of hooks) {
      const result = await this.executeHook(hook, payload, sessionId);
      results.push(result);

      // Log execution to OB1
      await this.logHookExecution(result, payload.hook_event_name, payload.tool_name, sessionId);

      switch (result.outcome) {
        case 'allow': {
          if (result.feedback) {
            feedback.push(result.feedback);
          }
          break;
        }

        case 'warn': {
          if (result.feedback) {
            feedback.push(`[Hook warning: ${hook.name}] ${result.feedback}`);
          } else if (result.error_output) {
            feedback.push(`[Hook warning: ${hook.name}] ${result.error_output}`);
          }
          break;
        }

        case 'deny': {
          const denialMessage =
            result.feedback ??
            `Hook "${hook.name}" denied execution of tool "${payload.tool_name}".`;
          feedback.push(denialMessage);

          return {
            allowed: false,
            feedback,
            results,
            denial_message: denialMessage,
          };
        }

        case 'timeout': {
          feedback.push(
            `[Hook warning: ${hook.name}] Timed out after ${hook.timeout_ms || DEFAULT_TIMEOUT_MS}ms`,
          );
          break;
        }

        case 'error': {
          feedback.push(
            `[Hook warning: ${hook.name}] Error: ${result.error_output ?? 'Unknown error'}`,
          );
          break;
        }
      }
    }

    return { allowed: true, feedback, results };
  }

  /**
   * Execute a single hook command.
   *
   * - Spawns a shell process (sh -lc on macOS/Linux, cmd /C on Windows)
   * - Pipes the JSON payload on stdin
   * - Sets environment variables: HOOK_EVENT, TOOL_NAME, SESSION_ID, etc.
   * - Interprets exit code as allow/warn/deny
   * - Enforces timeout, killing the process if exceeded
   */
  private executeHook(
    hook: HookConfig,
    payload: HookPayload,
    sessionId: string,
  ): Promise<HookExecutionResult> {
    const hookId = hook.id ?? randomUUID();
    const timeoutMs = hook.timeout_ms || DEFAULT_TIMEOUT_MS;
    const startTime = Date.now();

    return new Promise<HookExecutionResult>((resolve) => {
      let child: ChildProcess;
      let timedOut = false;
      let killTimer: ReturnType<typeof setTimeout> | null = null;

      try {
        // Platform-aware shell dispatch
        const isWindows = platform() === 'win32';
        const shellCmd = isWindows ? 'cmd' : 'sh';
        const shellArgs = isWindows ? ['/C', hook.command] : ['-lc', hook.command];

        // Set environment variables for the hook process
        const env: Record<string, string> = {
          ...(process.env as Record<string, string>),
          HOOK_EVENT: payload.hook_event_name,
          TOOL_NAME: payload.tool_name,
          SESSION_ID: sessionId,
          HOOK_TIMEOUT: String(timeoutMs),
          HOOK_ID: hookId,
        };

        // Add tool input as env var (truncated for safety)
        const toolInputStr =
          typeof payload.tool_input === 'string'
            ? payload.tool_input
            : JSON.stringify(payload.tool_input);
        env.HOOK_TOOL_INPUT = toolInputStr.slice(0, 8192);
        env.HOOK_TOOL_IS_ERROR = payload.tool_result_is_error ? '1' : '0';

        // Post-hooks get tool output
        if (payload.tool_output !== null) {
          env.HOOK_TOOL_OUTPUT = payload.tool_output.slice(0, 8192);
        }

        child = spawn(shellCmd, shellArgs, {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });

        // Collect stdout and stderr
        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data: Buffer) => {
          if (stdout.length < MAX_STDOUT_LENGTH) {
            stdout += data.toString('utf-8');
          }
        });

        child.stderr?.on('data', (data: Buffer) => {
          if (stderr.length < MAX_STDERR_LENGTH) {
            stderr += data.toString('utf-8');
          }
        });

        // Handle process exit
        child.on('close', (code: number | null, _signal: string | null) => {
          if (killTimer) {
            clearTimeout(killTimer);
            killTimer = null;
          }

          const duration = Date.now() - startTime;
          const trimmedStdout = stdout.trim() || null;
          const trimmedStderr = stderr.trim() || null;

          if (timedOut) {
            resolve({
              hook_id: hookId,
              hook_name: hook.name,
              outcome: 'timeout',
              exit_code: code,
              feedback: trimmedStdout,
              error_output: trimmedStderr,
              duration_ms: duration,
              timed_out: true,
            });
            return;
          }

          // Interpret exit code
          const outcome = this.interpretExitCode(code);

          resolve({
            hook_id: hookId,
            hook_name: hook.name,
            outcome,
            exit_code: code,
            feedback: trimmedStdout,
            error_output: trimmedStderr,
            duration_ms: duration,
            timed_out: false,
          });
        });

        // Handle spawn errors
        child.on('error', (err: Error) => {
          if (killTimer) {
            clearTimeout(killTimer);
            killTimer = null;
          }

          resolve({
            hook_id: hookId,
            hook_name: hook.name,
            outcome: 'error',
            exit_code: null,
            feedback: null,
            error_output: err.message,
            duration_ms: Date.now() - startTime,
            timed_out: false,
          });
        });

        // Set up timeout
        if (timeoutMs > 0) {
          killTimer = setTimeout(() => {
            timedOut = true;
            try {
              child.kill('SIGKILL');
            } catch {
              // Process may have already exited
            }
          }, timeoutMs);
        }

        // Pipe JSON payload to stdin and close it
        const payloadJson = JSON.stringify(payload);
        child.stdin?.write(payloadJson, 'utf-8');
        child.stdin?.end();
      } catch (err) {
        if (killTimer) {
          clearTimeout(killTimer);
        }

        resolve({
          hook_id: hookId,
          hook_name: hook.name,
          outcome: 'error',
          exit_code: null,
          feedback: null,
          error_output: err instanceof Error ? err.message : String(err),
          duration_ms: Date.now() - startTime,
          timed_out: false,
        });
      }
    });
  }

  // ---- Private: Helpers ----

  /**
   * Interpret a process exit code into a hook outcome.
   *
   *   0     = allow
   *   2     = deny
   *   1     = warn
   *   other = warn (crash / unexpected exit)
   *   null  = warn (killed by signal)
   */
  private interpretExitCode(code: number | null): HookOutcome {
    if (code === null) {
      return 'warn';
    }

    switch (code) {
      case 0:
        return 'allow';
      case 2:
        return 'deny';
      default:
        return 'warn';
    }
  }

  /**
   * Filter hooks by event type and tool filter. Sort by priority.
   */
  private getApplicableHooks(event: HookEvent, toolName: string): HookConfig[] {
    return this.hooks
      .filter((h) => {
        if (!h.enabled) return false;
        if (h.event_type !== event) return false;
        // If tool_filter is non-empty, the tool must be in the list
        if (h.tool_filter.length > 0 && !h.tool_filter.includes(toolName)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Build the JSON payload that gets piped to hook stdin.
   */
  private buildPayload(
    event: HookEvent,
    toolName: string,
    toolInput: unknown,
    toolOutput: string | null,
    isError: boolean,
  ): HookPayload {
    // Parse tool_input as JSON if it's a string, otherwise use as-is
    let parsedInput: unknown;
    let inputJson: string;

    if (typeof toolInput === 'string') {
      try {
        parsedInput = JSON.parse(toolInput);
        inputJson = toolInput;
      } catch {
        parsedInput = { raw: toolInput };
        inputJson = toolInput;
      }
    } else {
      parsedInput = toolInput;
      inputJson = JSON.stringify(toolInput);
    }

    return {
      hook_event_name: event,
      tool_name: toolName,
      tool_input: parsedInput,
      tool_input_json: inputJson,
      tool_output: toolOutput,
      tool_result_is_error: isError,
    };
  }

  /**
   * Merge hook feedback into tool output.
   * Appends hook messages as a labeled section.
   */
  private mergeHookFeedback(toolOutput: string, decision: HookDecision): string {
    if (decision.feedback.length === 0) {
      return toolOutput;
    }

    const sections: string[] = [];

    if (toolOutput.trim()) {
      sections.push(toolOutput);
    }

    const label = decision.allowed ? 'Hook feedback' : 'Hook feedback (denied)';
    sections.push(`${label}:\n${decision.feedback.join('\n')}`);

    return sections.join('\n\n');
  }

  /**
   * Log a hook execution event to OB1 for audit.
   */
  private async logHookExecution(
    result: HookExecutionResult,
    eventType: string,
    toolName: string,
    sessionId: string,
  ): Promise<void> {
    const severity: 'info' | 'warn' | 'error' =
      result.outcome === 'deny' || result.outcome === 'error'
        ? 'error'
        : result.outcome === 'warn' || result.outcome === 'timeout'
          ? 'warn'
          : 'info';

    try {
      await this.client.logEvent({
        category: 'hook',
        title: `hook_${result.outcome}`,
        severity,
        session_id: sessionId,
        detail: {
          hook_id: result.hook_id,
          hook_name: result.hook_name,
          event_type: eventType,
          tool_name: toolName,
          outcome: result.outcome,
          exit_code: result.exit_code,
          duration_ms: result.duration_ms,
          timed_out: result.timed_out,
          has_feedback: result.feedback !== null,
          has_error_output: result.error_output !== null,
        },
      });
    } catch {
      // Logging failure should never block hook execution
    }
  }
}
