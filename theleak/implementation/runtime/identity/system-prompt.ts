// =============================================================================
// system-prompt.ts -- SysAdmin Identity System Prompt Builder
//
// Constructs the full system prompt for any model (Claude, Codex, Gemini)
// by loading the SysAdmin persona, injecting dynamic session context,
// and adding model-specific and session-type-specific instructions.
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported model identifiers. */
export type ModelId = 'claude' | 'codex' | 'gemini';

/** Session types that determine behavioral adaptations. */
export type SessionType = 'interactive' | 'night_shift' | 'task';

/** Full session context required to build a system prompt. */
export interface SessionContext {
  model: ModelId;
  sessionType: SessionType;
  activeGoals: string[];
  recentDecisions: string[];
  currentProjects: string[];
  budgetRemaining: number;
  timeRemaining?: number; // minutes, for night shifts
}

// ---------------------------------------------------------------------------
// Persona loader
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PERSONA_PATH = resolve(__dirname, 'sysadmin-persona.md');

/**
 * Load the raw persona markdown from disk.
 * Cached after first read for the lifetime of the process.
 */
let personaCache: string | null = null;

export function loadPersona(path?: string): string {
  if (personaCache && !path) return personaCache;
  const content = readFileSync(path ?? PERSONA_PATH, 'utf-8');
  if (!path) personaCache = content;
  return content;
}

/** Reset the persona cache (useful for testing). */
export function resetPersonaCache(): void {
  personaCache = null;
}

// ---------------------------------------------------------------------------
// Dynamic section injection
// ---------------------------------------------------------------------------

function formatGoals(goals: string[]): string {
  if (goals.length === 0) return 'No active goals loaded for this session.';
  return goals.map((g, i) => `${i + 1}. ${g}`).join('\n');
}

function formatDecisions(decisions: string[]): string {
  if (decisions.length === 0) return 'No recent decisions loaded for this session.';
  return decisions.map((d) => `- ${d}`).join('\n');
}

function formatProjects(projects: string[]): string {
  if (projects.length === 0) return 'No active projects loaded.';
  return projects.map((p) => `- ${p}`).join('\n');
}

function formatBudget(budgetRemaining: number, timeRemaining?: number): string {
  const parts = [`Budget remaining: $${budgetRemaining.toFixed(2)} USD`];
  if (timeRemaining !== undefined) {
    const hours = Math.floor(timeRemaining / 60);
    const minutes = timeRemaining % 60;
    if (hours > 0) {
      parts.push(`Time remaining: ${hours}h ${minutes}m`);
    } else {
      parts.push(`Time remaining: ${minutes}m`);
    }
  }
  return parts.join('\n');
}

/**
 * Replace the dynamic placeholder sections in the persona with actual data.
 */
function injectDynamicSections(persona: string, context: SessionContext): string {
  // Replace Active Goals section
  const goalsPattern = /## Active Goals\n[\s\S]*?(?=\n## |$)/;
  const goalsReplacement = `## Active Goals\n\n${formatGoals(context.activeGoals)}`;

  // Replace Recent Decisions section
  const decisionsPattern = /## Recent Decisions\n[\s\S]*?(?=\n## |$)/;
  const decisionsReplacement = `## Recent Decisions\n\n${formatDecisions(context.recentDecisions)}`;

  let result = persona.replace(goalsPattern, goalsReplacement);
  result = result.replace(decisionsPattern, decisionsReplacement);

  return result;
}

// ---------------------------------------------------------------------------
// Model-specific instructions
// ---------------------------------------------------------------------------

const MODEL_INSTRUCTIONS: Record<ModelId, string> = {
  claude: `## Model-Specific Instructions (Claude)

- Use tools aggressively -- read files, run commands, search code. Don't guess when you can verify.
- Prefer structured tool use over asking the user for information you can find yourself.
- When writing code, always verify it compiles before reporting success.
- Use the full context window efficiently: load relevant files, don't summarize prematurely.
- For complex tasks, think step by step but act decisively.`,

  codex: `## Model-Specific Instructions (Codex)

- Focus on code generation and transformation. You are the bulk code engine.
- Produce complete, compilable files -- no pseudocode, no "TODO" placeholders.
- Follow the existing code style in the repository (TypeScript, ESM, strict mode).
- When generating tests, use Node.js built-in test runner (node:test).
- Minimize prose in responses. Code speaks louder.`,

  gemini: `## Model-Specific Instructions (Gemini)

- Leverage your large context window for analysis tasks: code review, architecture assessment, document synthesis.
- When given large codebases or documents, provide structured analysis with specific file/line references.
- For research tasks, be thorough and cite sources.
- Summarize findings in actionable format -- what to do, not just what you found.
- Flag contradictions and inconsistencies explicitly.`,
};

// ---------------------------------------------------------------------------
// Session-type-specific instructions
// ---------------------------------------------------------------------------

const SESSION_INSTRUCTIONS: Record<SessionType, string> = {
  interactive: `## Session Mode: Interactive

You are in a live conversation with Robin. Be conversational but efficient:
- Respond to what Robin asks, don't monologue.
- Propose actions and wait for confirmation on anything outside autonomous boundaries.
- Keep responses focused -- Robin can ask for more detail if needed.
- If Robin switches language to Swedish, switch with him.
- Remember: Robin values production-quality work over speed.`,

  night_shift: `## Session Mode: Night Shift (Autonomous)

You are running an autonomous overnight session using the wave protocol.
Every action follows the wave contract: PLAN -> EXECUTE -> VERIFY -> FIX -> COMMIT -> ASSESS.

Rules:
- Never skip VERIFY. A wave without verification is wasted work.
- Never skip COMMIT. Unpushed work is undone work.
- ASSESS is where intelligence lives -- analyze findings, pick the highest-value next wave.
- If VERIFY fails 3 times, stop the wave, document the failure, move to next priority.
- Update the morning report after EVERY wave, not just at the end.
- Monitor budget and time remaining. Stop gracefully when either runs low.
- Quality gates between waves: compile, test, lint, build, size check.
- If you detect diminishing returns (each wave less valuable than the last), stop and document.

Refer to long-session-protocol.md for the full wave protocol specification.`,

  task: `## Session Mode: Task Execution

You are executing a specific assigned task. Stay focused:
- Complete the assigned task fully before considering adjacent work.
- Verify your work meets acceptance criteria before reporting completion.
- Document any blockers or unexpected findings for the next session.
- Don't expand scope -- if you discover related issues, note them but stay on task.
- Commit and push when the task is complete.`,
};

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build the complete system prompt for a SysAdmin agent session.
 *
 * @param context - Session context including model, type, goals, decisions, and budget
 * @param personaPath - Optional override path for the persona file (useful for testing)
 * @returns The assembled system prompt as a single string
 */
export function buildSystemPrompt(
  context: SessionContext,
  personaPath?: string,
): string {
  // 1. Load persona
  const rawPersona = loadPersona(personaPath);

  // 2. Inject dynamic context
  const persona = injectDynamicSections(rawPersona, context);

  // 3. Build additional sections
  const modelSection = MODEL_INSTRUCTIONS[context.model];
  const sessionSection = SESSION_INSTRUCTIONS[context.sessionType];

  const projectsSection = `## Current Projects\n\n${formatProjects(context.currentProjects)}`;
  const budgetSection = `## Budget & Time\n\n${formatBudget(context.budgetRemaining, context.timeRemaining)}`;

  // 4. Assemble
  const sections = [
    persona,
    projectsSection,
    budgetSection,
    modelSection,
    sessionSection,
  ];

  return sections.join('\n\n---\n\n');
}
