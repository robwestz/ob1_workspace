#!/usr/bin/env node
// =============================================================================
// cli.ts — OB1 Agent CLI Entry Point
//
// Polished CLI for the OB1 agentic architecture. Uses Node's built-in
// parseArgs (Node 18.3+). No external CLI framework dependencies.
//
// Usage: ob1-agent <command> [options]
// =============================================================================

import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OB1Client } from './ob1-client.js';
import { BootSequence } from './boot.js';
import { DoctorSystem } from './doctor.js';
import { SessionManager } from './session-manager.js';
import { BudgetTracker, formatUsd } from './budget-tracker.js';
import { ToolPool } from './tool-pool.js';
import { AnthropicApiClient } from './anthropic-client.js';

import type { BootResult } from './boot.js';
import type { DoctorReport, DoctorCheckResult } from './doctor.js';

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

async function getVersion(): Promise<string> {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(__dirname, '..', 'package.json');
    const raw = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { version: string };
    return pkg.version;
  } catch {
    return '0.1.0';
  }
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';

function isColor(): boolean {
  return process.env.NO_COLOR === undefined && process.stdout.isTTY === true;
}

function c(color: string, text: string): string {
  return isColor() ? `${color}${text}${RESET}` : text;
}

function heading(text: string): void {
  console.log();
  console.log(c(BOLD + CYAN, `  ${text}`));
  console.log(c(DIM, `  ${'─'.repeat(text.length)}`));
}

function keyValue(key: string, value: string, indent = 4): void {
  const pad = ' '.repeat(indent);
  console.log(`${pad}${c(DIM, key + ':')} ${value}`);
}

function statusIcon(status: 'pass' | 'warn' | 'fail' | 'ok' | 'error'): string {
  switch (status) {
    case 'pass':
    case 'ok':
      return c(GREEN, 'PASS');
    case 'warn':
      return c(YELLOW, 'WARN');
    case 'fail':
    case 'error':
      return c(RED, 'FAIL');
  }
}

function progressBar(percent: number, width = 20): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const color = percent > 80 ? RED : percent > 50 ? YELLOW : GREEN;
  return `${c(color, bar)} ${percent.toFixed(1)}%`;
}

function table(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );

  const headerLine = headers
    .map((h, i) => c(BOLD, h.padEnd(widths[i])))
    .join('  ');
  const separator = widths.map((w) => '─'.repeat(w)).join('──');

  console.log(`    ${headerLine}`);
  console.log(`    ${c(DIM, separator)}`);
  for (const row of rows) {
    const line = row.map((cell, i) => (cell ?? '').padEnd(widths[i])).join('  ');
    console.log(`    ${line}`);
  }
}

function die(message: string): never {
  console.error(c(RED, `\n  Error: ${message}\n`));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Environment & client setup
// ---------------------------------------------------------------------------

interface CLIOptions {
  config?: string;
  session?: string;
  model: string;
  maxTurns: number;
  maxTokens: number;
  maxUsd: number;
  simple: boolean;
  verbose: boolean;
  json: boolean;
}

function loadEnvFile(): void {
  // Best-effort .env loading without external dependencies
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf-8') as string;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env loading is best-effort
  }
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    die(`Missing required environment variable: ${key}\n  See .env.example for the required variables.`);
  }
  return value;
}

function createClient(): OB1Client {
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return new OB1Client(url, key);
}

function createAnthropicClient(model: string): AnthropicApiClient {
  const apiKey = requireEnv('ANTHROPIC_API_KEY');
  return new AnthropicApiClient(apiKey, model);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdBoot(opts: CLIOptions): Promise<void> {
  const client = createClient();
  const sessionId = opts.session ?? `session_${Date.now()}`;

  heading('Boot Sequence');
  console.log();

  const boot = new BootSequence(client, {
    workspacePath: process.cwd(),
    sessionId,
    skipDoctor: false,
  });

  const spinner = ['|', '/', '-', '\\'];
  let spinIdx = 0;
  const spinTimer = setInterval(() => {
    if (process.stdout.isTTY) {
      process.stdout.write(`\r    ${c(CYAN, spinner[spinIdx++ % 4])} Running boot sequence...`);
    }
  }, 100);

  let result: BootResult;
  try {
    result = await boot.run();
  } finally {
    clearInterval(spinTimer);
    if (process.stdout.isTTY) {
      process.stdout.write('\r' + ' '.repeat(50) + '\r');
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Print phase timings
  const statusColor = result.status === 'completed' ? GREEN : RED;
  console.log(`    ${c(BOLD, 'Status:')} ${c(statusColor, result.status.toUpperCase())}`);
  console.log(`    ${c(BOLD, 'Duration:')} ${result.totalDurationMs}ms`);

  if (result.fastPathUsed) {
    console.log(`    ${c(DIM, `Fast-path: ${result.fastPathUsed}`)}`);
  }

  console.log();
  console.log(`    ${c(BOLD, 'Phase Timings:')}`);
  console.log();

  const phaseRows: string[][] = [];
  for (const [phase, timing] of Object.entries(result.phaseResults)) {
    phaseRows.push([
      phase,
      statusIcon(timing.status as 'pass' | 'warn' | 'fail' | 'ok'),
      `${timing.durationMs}ms`,
      timing.error ?? timing.skipReason ?? '',
    ]);
  }
  table(['Phase', 'Status', 'Duration', 'Detail'], phaseRows);

  if (result.failureReason) {
    console.log();
    console.log(`    ${c(RED, 'Failure:')} ${result.failureReason}`);
  }

  if (result.context.doctorSummary) {
    const ds = result.context.doctorSummary;
    console.log();
    console.log(`    ${c(BOLD, 'Doctor:')} ${c(GREEN, `${ds.pass} pass`)}  ${c(YELLOW, `${ds.warn} warn`)}  ${c(RED, `${ds.fail} fail`)}  ${c(BLUE, `${ds.autoRepaired} repaired`)}`);
  }

  console.log();
  keyValue('Session', sessionId);
  keyValue('Agent Mode', result.context.agentMode);
  keyValue('Trust Mode', result.context.trustMode);
  keyValue('Tools', `${result.context.toolCount} (${result.context.mcpToolCount} MCP)`);
  console.log();
}

async function cmdDoctor(opts: CLIOptions): Promise<void> {
  const client = createClient();

  heading('Doctor Health Checks');
  console.log();

  const doctor = new DoctorSystem(client);

  let report: DoctorReport;
  try {
    report = await doctor.runFull();
  } catch (err: unknown) {
    die(`Doctor failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Print results as table
  const rows: string[][] = report.checks.map((check: DoctorCheckResult) => [
    check.category,
    check.name,
    statusIcon(check.status),
    check.detail.slice(0, 60),
    check.autoRepaired ? c(BLUE, 'repaired') : '',
    `${check.durationMs}ms`,
  ]);

  table(
    ['Category', 'Check', 'Status', 'Detail', 'Repair', 'Time'],
    rows,
  );

  console.log();
  const s = report.summary;
  console.log(
    `    ${c(BOLD, 'Summary:')} ${c(GREEN, `${s.pass} pass`)}  ${c(YELLOW, `${s.warn} warn`)}  ${c(RED, `${s.fail} fail`)}  ${c(BLUE, `${s.autoRepaired} repaired`)}  ${c(DIM, `(${report.totalDurationMs}ms)`)}`,
  );
  console.log();

  if (s.fail > 0) {
    process.exitCode = 1;
  }
}

async function cmdRun(opts: CLIOptions): Promise<void> {
  const client = createClient();
  const anthropic = createAnthropicClient(opts.model);

  heading('OB1 Agentic Loop');
  console.log();
  keyValue('Model', opts.model);
  keyValue('Max turns', String(opts.maxTurns));
  keyValue('Budget', `${opts.maxTokens.toLocaleString()} tokens / ${formatUsd(opts.maxUsd)}`);
  keyValue('Mode', opts.simple ? 'simple' : 'full');
  console.log();

  // Create session
  const sessionMgr = new SessionManager(client);
  const session = await sessionMgr.create({
    max_turns: opts.maxTurns,
    max_budget_tokens: opts.maxTokens,
    max_budget_usd: opts.maxUsd,
  });

  console.log(`    ${c(DIM, 'Session:')} ${session.session_id}`);
  console.log();

  // Set up budget tracker
  const budget = new BudgetTracker(client, {
    max_turns: opts.maxTurns,
    max_budget_tokens: opts.maxTokens,
    max_budget_usd: opts.maxUsd,
  });
  budget.setModel(opts.model);

  // Interactive readline loop
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: c(CYAN, '  > '),
    terminal: process.stdin.isTTY === true,
  });

  console.log(`    ${c(DIM, 'Type your message and press Enter. Type /quit to exit.')}`);
  console.log();

  rl.prompt();

  rl.on('line', async (line: string) => {
    const input = line.trim();

    // Handle special commands
    if (input === '/quit' || input === '/exit' || input === '/q') {
      console.log();
      console.log(`    ${c(DIM, 'Session ended.')}`);
      await printBudgetSummary(budget, sessionMgr.sessionId);
      rl.close();
      return;
    }

    if (input === '/budget') {
      printBudgetInline(budget);
      rl.prompt();
      return;
    }

    if (input === '/status') {
      keyValue('Session', sessionMgr.sessionId);
      keyValue('Status', sessionMgr.status);
      keyValue('Turns', String(budget.turnsUsed));
      keyValue('Cost', formatUsd(budget.usdUsed));
      console.log();
      rl.prompt();
      return;
    }

    if (!input) {
      rl.prompt();
      return;
    }

    // Add user message
    sessionMgr.addMessage({
      role: 'user',
      content: [{ type: 'text', text: input }],
    });

    // Call the LLM
    console.log();
    try {
      let fullText = '';

      const messages = sessionMgr.getMessages().map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      // Use the streaming API
      const toolPool = new ToolPool(client);
      await toolPool.assemble({
        simple_mode: opts.simple,
        include_mcp: !opts.simple,
      });
      const tools = toolPool.toAnthropicFormat();

      const systemPrompt = [
        'You are OB1, a helpful AI assistant with persistent memory and tool access.',
        'You are running inside the OB1 agentic runtime.',
        `Session: ${sessionMgr.sessionId}`,
      ].join('\n');

      for await (const event of anthropic.stream(messages as any, tools, systemPrompt)) {
        switch (event.type) {
          case 'content_block_start': {
            if (event.content_block?.type === 'tool_use') {
              console.log(`    ${c(MAGENTA, `[tool: ${event.content_block.name}]`)}`);
            }
            break;
          }
          case 'content_block_delta': {
            if (event.delta?.text) {
              process.stdout.write(event.delta.text);
              fullText += event.delta.text;
            }
            break;
          }
          case 'message_delta': {
            // Extract usage from the final event
            if (event.usage) {
              const usage = {
                input_tokens: event.message?.usage?.input_tokens ?? 0,
                output_tokens: event.usage.output_tokens ?? 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              };
              await budget.recordUsage(sessionMgr.sessionId, usage);
            }
            break;
          }
          case 'message_stop':
            break;
          case 'error': {
            console.error(
              `\n    ${c(RED, `API Error: ${event.error?.message ?? 'Unknown'}`)}`,
            );
            break;
          }
        }
      }

      if (fullText) {
        console.log();
      }

      // Add assistant response to session
      sessionMgr.addMessage({
        role: 'assistant',
        content: [{ type: 'text', text: fullText }],
      });

      console.log();

      // Budget warning
      const pct = budget.percentUsed;
      const maxPct = Math.max(pct.turns, pct.tokens, pct.usd);
      if (maxPct > 80) {
        console.log(
          `    ${c(YELLOW, `Budget: ${maxPct.toFixed(0)}% used (${formatUsd(budget.usdUsed)})`)}`,
        );
        console.log();
      }
    } catch (err: unknown) {
      console.error(
        `\n    ${c(RED, `Error: ${err instanceof Error ? err.message : String(err)}`)}`,
      );
      console.log();
    }

    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

async function cmdStatus(opts: CLIOptions): Promise<void> {
  const client = createClient();

  if (!opts.session) {
    die('--session <id> is required for the status command.');
  }

  heading('Session Status');
  console.log();

  try {
    const session = await client.getSession(opts.session);

    if (opts.json) {
      console.log(JSON.stringify(session, null, 2));
      return;
    }

    const statusColor =
      session.status === 'active' ? GREEN :
      session.status === 'completed' ? BLUE :
      session.status === 'crashed' ? RED :
      YELLOW;

    keyValue('Session ID', session.session_id);
    keyValue('Status', c(statusColor, session.status));
    keyValue('Version', String(session.version));
    keyValue('Turns', String(session.turn_count));
    keyValue('Messages', String(session.messages.length));
    keyValue('Compactions', String(session.compaction_count));
    console.log();

    heading('Token Usage');
    console.log();
    keyValue('Input tokens', session.total_input_tokens.toLocaleString());
    keyValue('Output tokens', session.total_output_tokens.toLocaleString());
    keyValue('Cache write', session.total_cache_write_tokens.toLocaleString());
    keyValue('Cache read', session.total_cache_read_tokens.toLocaleString());
    keyValue('Total cost', formatUsd(session.total_cost_usd));
    console.log();
  } catch (err: unknown) {
    die(`Failed to fetch session: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function cmdResume(opts: CLIOptions): Promise<void> {
  const client = createClient();

  if (!opts.session) {
    die('--session <id> is required for the resume command.');
  }

  heading('Resuming Session');
  console.log();

  const sessionMgr = new SessionManager(client);
  const session = await sessionMgr.resume(opts.session);

  keyValue('Session ID', session.session_id);
  keyValue('Status', session.status);
  keyValue('Turns', String(session.turn_count));
  keyValue('Messages', String(session.messages.length));
  keyValue('Cost so far', formatUsd(session.total_cost_usd));
  console.log();

  // Hydrate budget tracker from existing messages
  const budget = BudgetTracker.fromMessages(
    client,
    {
      max_turns: opts.maxTurns,
      max_budget_tokens: opts.maxTokens,
      max_budget_usd: opts.maxUsd,
    },
    opts.model,
    session.messages,
  );

  // Enter interactive loop (same as cmdRun but with existing session)
  const anthropic = createAnthropicClient(opts.model);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: c(CYAN, '  > '),
    terminal: process.stdin.isTTY === true,
  });

  console.log(`    ${c(DIM, 'Session resumed. Type your message and press Enter. Type /quit to exit.')}`);
  console.log();

  rl.prompt();

  rl.on('line', async (line: string) => {
    const input = line.trim();

    if (input === '/quit' || input === '/exit' || input === '/q') {
      console.log();
      console.log(`    ${c(DIM, 'Session suspended.')}`);
      await printBudgetSummary(budget, sessionMgr.sessionId);
      rl.close();
      return;
    }

    if (input === '/budget') {
      printBudgetInline(budget);
      rl.prompt();
      return;
    }

    if (!input) {
      rl.prompt();
      return;
    }

    sessionMgr.addMessage({
      role: 'user',
      content: [{ type: 'text', text: input }],
    });

    console.log();
    try {
      let fullText = '';
      const messages = sessionMgr.getMessages().map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const systemPrompt = [
        'You are OB1, a helpful AI assistant with persistent memory.',
        `Session: ${sessionMgr.sessionId} (resumed)`,
      ].join('\n');

      for await (const event of anthropic.stream(messages as any, [], systemPrompt)) {
        if (event.type === 'content_block_delta' && event.delta?.text) {
          process.stdout.write(event.delta.text);
          fullText += event.delta.text;
        }
        if (event.type === 'error') {
          console.error(`\n    ${c(RED, `API Error: ${event.error?.message ?? 'Unknown'}`)}`);
        }
      }

      if (fullText) console.log();

      sessionMgr.addMessage({
        role: 'assistant',
        content: [{ type: 'text', text: fullText }],
      });

      console.log();
    } catch (err: unknown) {
      console.error(`\n    ${c(RED, `Error: ${err instanceof Error ? err.message : String(err)}`)}`);
      console.log();
    }

    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

async function cmdBudget(opts: CLIOptions): Promise<void> {
  const client = createClient();

  if (!opts.session) {
    die('--session <id> is required for the budget command.');
  }

  heading('Budget Usage');
  console.log();

  try {
    const session = await client.getSession(opts.session);

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            session_id: session.session_id,
            turns: session.turn_count,
            input_tokens: session.total_input_tokens,
            output_tokens: session.total_output_tokens,
            cache_write_tokens: session.total_cache_write_tokens,
            cache_read_tokens: session.total_cache_read_tokens,
            total_cost_usd: session.total_cost_usd,
          },
          null,
          2,
        ),
      );
      return;
    }

    const totalTokens = session.total_input_tokens + session.total_output_tokens;
    const maxTurns = opts.maxTurns;
    const maxTokens = opts.maxTokens;
    const maxUsd = opts.maxUsd;

    keyValue('Turns', `${session.turn_count} / ${maxTurns}`);
    console.log(`      ${progressBar((session.turn_count / maxTurns) * 100)}`);
    console.log();

    keyValue('Tokens', `${totalTokens.toLocaleString()} / ${maxTokens.toLocaleString()}`);
    console.log(`      ${progressBar((totalTokens / maxTokens) * 100)}`);
    console.log();

    keyValue('Cost', `${formatUsd(session.total_cost_usd)} / ${formatUsd(maxUsd)}`);
    console.log(`      ${progressBar((session.total_cost_usd / maxUsd) * 100)}`);
    console.log();

    heading('Token Breakdown');
    console.log();
    table(
      ['Category', 'Tokens', 'Share'],
      [
        ['Input', session.total_input_tokens.toLocaleString(), `${((session.total_input_tokens / Math.max(totalTokens, 1)) * 100).toFixed(1)}%`],
        ['Output', session.total_output_tokens.toLocaleString(), `${((session.total_output_tokens / Math.max(totalTokens, 1)) * 100).toFixed(1)}%`],
        ['Cache Write', session.total_cache_write_tokens.toLocaleString(), '-'],
        ['Cache Read', session.total_cache_read_tokens.toLocaleString(), '-'],
      ],
    );
    console.log();
  } catch (err: unknown) {
    die(`Failed to fetch session: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function cmdTools(opts: CLIOptions): Promise<void> {
  const client = createClient();

  heading('Tool Pool');
  console.log();

  try {
    const pool = new ToolPool(client);
    await pool.assemble({
      simple_mode: opts.simple,
      include_mcp: !opts.simple,
    });

    if (opts.json) {
      console.log(JSON.stringify(pool.tools, null, 2));
      return;
    }

    if (pool.size === 0) {
      console.log(`    ${c(DIM, 'No tools registered. Run migrations and register tools first.')}`);
      console.log();
      return;
    }

    const rows = pool.tools.map((t) => [
      t.name,
      t.source_type,
      t.required_permission,
      t.enabled ? c(GREEN, 'yes') : c(RED, 'no'),
      t.description.slice(0, 50),
    ]);

    table(['Name', 'Source', 'Permission', 'Enabled', 'Description'], rows);
    console.log();
    console.log(`    ${c(DIM, `${pool.size} tools in pool (mode: ${opts.simple ? 'simple' : 'full'})`)}`);
    console.log();
  } catch (err: unknown) {
    die(`Failed to list tools: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function cmdAgents(opts: CLIOptions): Promise<void> {
  const client = createClient();

  heading('Agent Types');
  console.log();

  try {
    const types = await client.listAgentTypes();

    if (opts.json) {
      console.log(JSON.stringify(types, null, 2));
      return;
    }

    if (types.length === 0) {
      console.log(`    ${c(DIM, 'No agent types registered.')}`);
      console.log();
      return;
    }

    const rows = types.map((t) => [
      t.name,
      t.display_name ?? t.name,
      t.permission_mode,
      String(t.max_iterations),
      t.output_format,
      t.source ?? '-',
    ]);

    table(['Name', 'Display', 'Permission', 'Max Iter', 'Output', 'Source'], rows);
    console.log();
    console.log(`    ${c(DIM, `${types.length} agent types registered`)}`);
    console.log();
  } catch (err: unknown) {
    die(`Failed to list agents: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function cmdSessions(opts: CLIOptions): Promise<void> {
  const client = createClient();

  heading('Recent Sessions');
  console.log();

  try {
    // Query recent events to discover sessions
    const events = await client.queryEvents({
      category: 'session',
      limit: 20,
    });

    if (opts.json) {
      console.log(JSON.stringify(events, null, 2));
      return;
    }

    if (events.length === 0) {
      console.log(`    ${c(DIM, 'No session events found.')}`);
      console.log();
      return;
    }

    // Deduplicate by session_id
    const seen = new Set<string>();
    const sessionRows: string[][] = [];

    for (const event of events) {
      if (seen.has(event.session_id)) continue;
      seen.add(event.session_id);

      sessionRows.push([
        event.session_id.slice(0, 20) + '...',
        event.title,
        event.severity,
        event.timestamp,
      ]);
    }

    table(['Session', 'Last Event', 'Severity', 'Timestamp'], sessionRows);
    console.log();
  } catch (err: unknown) {
    die(`Failed to list sessions: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function cmdMemory(opts: CLIOptions, subArgs: string[]): Promise<void> {
  const client = createClient();

  const subCommand = subArgs[0];
  const rest = subArgs.slice(1).join(' ');

  if (!subCommand) {
    die('Usage: ob1-agent memory <recall|store|stats> [args]');
  }

  switch (subCommand) {
    case 'recall': {
      if (!rest) {
        die('Usage: ob1-agent memory recall <query>');
      }

      heading('Memory Recall');
      console.log();
      keyValue('Query', rest);
      console.log();

      try {
        const results = await client.memoryRecall(rest, { limit: 10 });

        if (opts.json) {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        if (results.length === 0) {
          console.log(`    ${c(DIM, 'No matching memories found.')}`);
          console.log();
          return;
        }

        for (const mem of results) {
          const scoreColor = mem.final_score > 0.7 ? GREEN : mem.final_score > 0.4 ? YELLOW : DIM;
          console.log(`    ${c(BOLD, mem.thought_id.slice(0, 12))}  ${c(scoreColor, `score: ${mem.final_score.toFixed(3)}`)}`);
          console.log(`    ${c(DIM, `similarity: ${mem.similarity.toFixed(3)}  age_factor: ${mem.age_factor.toFixed(3)}`)}`);
          console.log(`    ${mem.content.slice(0, 120)}${mem.content.length > 120 ? '...' : ''}`);
          console.log();
        }

        console.log(`    ${c(DIM, `${results.length} memories retrieved`)}`);
        console.log();
      } catch (err: unknown) {
        die(`Memory recall failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case 'store': {
      if (!rest) {
        die('Usage: ob1-agent memory store <content>');
      }

      heading('Memory Store');
      console.log();

      try {
        const thoughtId = await client.memoryStore(rest, {
          memory_scope: 'personal',
          memory_type: 'observation',
          tags: ['cli'],
          provenance: {
            source_type: 'user_stated',
            trust_level: 4,
            created_at: new Date().toISOString(),
          },
          version: 1,
        });

        if (opts.json) {
          console.log(JSON.stringify({ thought_id: thoughtId }, null, 2));
          return;
        }

        console.log(`    ${c(GREEN, 'Stored successfully')}`);
        keyValue('Thought ID', thoughtId);
        keyValue('Content', rest.slice(0, 80));
        console.log();
      } catch (err: unknown) {
        die(`Memory store failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case 'stats': {
      heading('Memory Stats');
      console.log();

      try {
        // Attempt to recall a broad query to estimate memory volume
        const results = await client.memoryRecall('', {
          limit: 1,
          min_similarity: 0,
        });

        if (opts.json) {
          console.log(JSON.stringify({ estimated_count: results.length > 0 ? 'available' : 'empty' }, null, 2));
          return;
        }

        keyValue('Status', results.length > 0 ? c(GREEN, 'Memories available') : c(DIM, 'No memories stored'));
        console.log();
        console.log(`    ${c(DIM, 'Use "ob1-agent memory recall <query>" to search memories.')}`);
        console.log();
      } catch (err: unknown) {
        die(`Memory stats failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    default:
      die(`Unknown memory sub-command: ${subCommand}\n  Available: recall, store, stats`);
  }
}

async function cmdVersion(): Promise<void> {
  const version = await getVersion();
  console.log();
  console.log(`  ${c(BOLD + CYAN, 'OB1 Agentic Runtime')} ${c(DIM, `v${version}`)}`);
  console.log(`  ${c(DIM, '@ob1/runtime — persistent AI memory + agentic architecture')}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Budget display helpers
// ---------------------------------------------------------------------------

function printBudgetInline(budget: BudgetTracker): void {
  const pct = budget.percentUsed;
  console.log();
  keyValue('Turns', `${budget.turnsUsed} (${pct.turns.toFixed(1)}%)`);
  const tokens = budget.tokensUsed;
  keyValue('Tokens', `${(tokens.input + tokens.output).toLocaleString()} (${pct.tokens.toFixed(1)}%)`);
  keyValue('Cost', `${formatUsd(budget.usdUsed)} (${pct.usd.toFixed(1)}%)`);
  console.log();
}

async function printBudgetSummary(budget: BudgetTracker, sessionId: string): Promise<void> {
  console.log();
  heading('Session Summary');
  console.log();
  keyValue('Session', sessionId);
  keyValue('Turns', String(budget.turnsUsed));
  const tokens = budget.tokensUsed;
  keyValue('Input tokens', tokens.input.toLocaleString());
  keyValue('Output tokens', tokens.output.toLocaleString());
  keyValue('Cache write', tokens.cache_write.toLocaleString());
  keyValue('Cache read', tokens.cache_read.toLocaleString());
  keyValue('Total cost', formatUsd(budget.usdUsed));
  console.log();
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
  ${c(BOLD + CYAN, 'OB1 Agentic Runtime')}

  ${c(BOLD, 'Usage:')} ob1-agent <command> [options]

  ${c(BOLD, 'Commands:')}
    boot        Run boot sequence and validate system
    doctor      Run health checks
    run         Start the agentic loop (interactive mode)
    status      Show current session status
    sessions    List recent sessions
    resume      Resume a previous session
    budget      Show budget usage for a session
    tools       List available tools
    agents      List agent types
    memory      Query memory (recall, store, stats)
    version     Show version

  ${c(BOLD, 'Options:')}
    --config <path>      Config file path
    --session <id>       Session ID (for resume/status/budget)
    --model <name>       Model to use (haiku/sonnet/opus, default: sonnet)
    --max-turns <n>      Max turns (default: 50)
    --max-tokens <n>     Max budget tokens (default: 1000000)
    --max-usd <n>        Max budget USD (default: 10.00)
    --simple             Simple mode (limited tools)
    --verbose            Verbose logging
    --json               JSON output

  ${c(BOLD, 'Interactive Commands:')}
    /quit, /exit, /q     End the session
    /budget              Show current budget usage
    /status              Show session status

  ${c(BOLD, 'Examples:')}
    ob1-agent boot
    ob1-agent doctor
    ob1-agent run --model opus --max-usd 5.00
    ob1-agent status --session sess_abc123
    ob1-agent memory recall "project architecture decisions"
    ob1-agent memory store "The API uses REST, not GraphQL"
    ob1-agent resume --session sess_abc123
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Load .env before anything else
  loadEnvFile();

  // Parse CLI arguments
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: false,
    options: {
      config: { type: 'string', short: 'c' },
      session: { type: 'string', short: 's' },
      model: { type: 'string', short: 'm', default: process.env.OB1_MODEL ?? 'sonnet' },
      'max-turns': { type: 'string', default: process.env.OB1_MAX_TURNS ?? '50' },
      'max-tokens': { type: 'string', default: process.env.OB1_MAX_BUDGET_TOKENS ?? '1000000' },
      'max-usd': { type: 'string', default: process.env.OB1_MAX_BUDGET_USD ?? '10.00' },
      simple: { type: 'boolean', default: false },
      verbose: { type: 'boolean', short: 'v', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    printHelp();
    return;
  }

  const command = positionals[0];
  const subArgs = positionals.slice(1);

  const opts: CLIOptions = {
    config: values.config as string | undefined,
    session: values.session as string | undefined,
    model: values.model as string,
    maxTurns: parseInt(values['max-turns'] as string, 10),
    maxTokens: parseInt(values['max-tokens'] as string, 10),
    maxUsd: parseFloat(values['max-usd'] as string),
    simple: values.simple as boolean,
    verbose: values.verbose as boolean,
    json: values.json as boolean,
  };

  // Validate parsed numbers
  if (isNaN(opts.maxTurns) || opts.maxTurns < 1) die('--max-turns must be a positive integer');
  if (isNaN(opts.maxTokens) || opts.maxTokens < 1) die('--max-tokens must be a positive integer');
  if (isNaN(opts.maxUsd) || opts.maxUsd < 0) die('--max-usd must be a non-negative number');

  // Dispatch to command handler
  switch (command) {
    case 'boot':
      await cmdBoot(opts);
      break;
    case 'doctor':
      await cmdDoctor(opts);
      break;
    case 'run':
      await cmdRun(opts);
      break;
    case 'status':
      await cmdStatus(opts);
      break;
    case 'sessions':
      await cmdSessions(opts);
      break;
    case 'resume':
      await cmdResume(opts);
      break;
    case 'budget':
      await cmdBudget(opts);
      break;
    case 'tools':
      await cmdTools(opts);
      break;
    case 'agents':
      await cmdAgents(opts);
      break;
    case 'memory':
      await cmdMemory(opts, subArgs);
      break;
    case 'version':
      await cmdVersion();
      break;
    case 'help':
      printHelp();
      break;
    default:
      die(`Unknown command: ${command}\n  Run "ob1-agent --help" for usage.`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error(c(RED, `\n  Fatal: ${err instanceof Error ? err.message : String(err)}\n`));
  if (process.env.OB1_DEBUG) {
    console.error(err);
  }
  process.exit(1);
});
