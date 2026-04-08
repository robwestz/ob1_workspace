// =============================================================================
// Unit Tests -- SysAdmin System Prompt Builder
// =============================================================================

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSystemPrompt,
  resetPersonaCache,
  type SessionContext,
  type ModelId,
} from '../system-prompt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PERSONA_PATH = resolve(__dirname, '..', 'sysadmin-persona.md');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    model: 'claude',
    sessionType: 'interactive',
    activeGoals: [],
    recentDecisions: [],
    currentProjects: [],
    budgetRemaining: 25.0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildSystemPrompt', () => {
  beforeEach(() => {
    resetPersonaCache();
  });

  // ---- Persona identity across models ------------------------------------

  describe('persona identity across models', () => {
    const models: ModelId[] = ['claude', 'codex', 'gemini'];

    for (const model of models) {
      it(`includes persona identity for model: ${model}`, () => {
        const prompt = buildSystemPrompt(
          makeContext({ model }),
          PERSONA_PATH,
        );

        assert.ok(prompt.includes('SysAdmin'), `Prompt for ${model} should include SysAdmin identity`);
        assert.ok(prompt.includes('Who I Am'), `Prompt for ${model} should include Who I Am section`);
        assert.ok(prompt.includes('My Mission'), `Prompt for ${model} should include My Mission section`);
        assert.ok(prompt.includes('Decision Heuristics'), `Prompt for ${model} should include Decision Heuristics`);
        assert.ok(prompt.includes('Robin'), `Prompt for ${model} should reference Robin`);
      });
    }
  });

  // ---- Model-specific instructions ---------------------------------------

  describe('model-specific instructions', () => {
    it('includes Claude-specific tool usage instructions', () => {
      const prompt = buildSystemPrompt(
        makeContext({ model: 'claude' }),
        PERSONA_PATH,
      );
      assert.ok(prompt.includes('Model-Specific Instructions (Claude)'));
      assert.ok(prompt.includes('Use tools aggressively'));
    });

    it('includes Codex-specific code generation instructions', () => {
      const prompt = buildSystemPrompt(
        makeContext({ model: 'codex' }),
        PERSONA_PATH,
      );
      assert.ok(prompt.includes('Model-Specific Instructions (Codex)'));
      assert.ok(prompt.includes('code generation'));
    });

    it('includes Gemini-specific large context instructions', () => {
      const prompt = buildSystemPrompt(
        makeContext({ model: 'gemini' }),
        PERSONA_PATH,
      );
      assert.ok(prompt.includes('Model-Specific Instructions (Gemini)'));
      assert.ok(prompt.includes('large context window'));
    });
  });

  // ---- Active goals injection --------------------------------------------

  describe('active goals', () => {
    it('includes active goals when provided', () => {
      const prompt = buildSystemPrompt(
        makeContext({
          activeGoals: [
            'Raise test coverage from F to B',
            'Security review of Edge Functions',
            'Deploy Bacowr worker to production',
          ],
        }),
        PERSONA_PATH,
      );

      assert.ok(prompt.includes('Raise test coverage from F to B'));
      assert.ok(prompt.includes('Security review of Edge Functions'));
      assert.ok(prompt.includes('Deploy Bacowr worker to production'));
    });

    it('handles empty goals gracefully', () => {
      const prompt = buildSystemPrompt(
        makeContext({ activeGoals: [] }),
        PERSONA_PATH,
      );

      assert.ok(prompt.includes('No active goals loaded'));
      // Should not throw or produce malformed output
      assert.ok(prompt.includes('Active Goals'));
    });
  });

  // ---- Recent decisions injection ----------------------------------------

  describe('recent decisions', () => {
    it('includes recent decisions when provided', () => {
      const prompt = buildSystemPrompt(
        makeContext({
          recentDecisions: [
            'Chose wave protocol over batch dispatch for overnight sessions',
            'Selected Supabase Edge Functions over local MCP servers',
          ],
        }),
        PERSONA_PATH,
      );

      assert.ok(prompt.includes('wave protocol over batch dispatch'));
      assert.ok(prompt.includes('Supabase Edge Functions over local MCP'));
    });

    it('handles empty decisions gracefully', () => {
      const prompt = buildSystemPrompt(
        makeContext({ recentDecisions: [] }),
        PERSONA_PATH,
      );

      assert.ok(prompt.includes('No recent decisions loaded'));
      assert.ok(prompt.includes('Recent Decisions'));
    });
  });

  // ---- Session type: night shift -----------------------------------------

  describe('night shift sessions', () => {
    it('includes wave protocol reference for night shifts', () => {
      const prompt = buildSystemPrompt(
        makeContext({ sessionType: 'night_shift' }),
        PERSONA_PATH,
      );

      assert.ok(prompt.includes('Night Shift'));
      assert.ok(prompt.includes('wave protocol'));
      assert.ok(prompt.includes('PLAN'));
      assert.ok(prompt.includes('VERIFY'));
      assert.ok(prompt.includes('COMMIT'));
      assert.ok(prompt.includes('ASSESS'));
    });

    it('includes time remaining for night shifts', () => {
      const prompt = buildSystemPrompt(
        makeContext({
          sessionType: 'night_shift',
          timeRemaining: 450, // 7h 30m
        }),
        PERSONA_PATH,
      );

      assert.ok(prompt.includes('7h 30m'));
    });
  });

  // ---- Session type: interactive -----------------------------------------

  describe('interactive sessions', () => {
    it('includes conversational style instructions', () => {
      const prompt = buildSystemPrompt(
        makeContext({ sessionType: 'interactive' }),
        PERSONA_PATH,
      );

      assert.ok(prompt.includes('Interactive'));
      assert.ok(prompt.includes('conversational'));
      assert.ok(prompt.includes('Robin'));
    });
  });

  // ---- Session type: task ------------------------------------------------

  describe('task sessions', () => {
    it('includes task-focused instructions', () => {
      const prompt = buildSystemPrompt(
        makeContext({ sessionType: 'task' }),
        PERSONA_PATH,
      );

      assert.ok(prompt.includes('Task Execution'));
      assert.ok(prompt.includes('assigned task'));
    });
  });

  // ---- Budget info -------------------------------------------------------

  describe('budget info', () => {
    it('includes budget remaining in prompt', () => {
      const prompt = buildSystemPrompt(
        makeContext({ budgetRemaining: 18.5 }),
        PERSONA_PATH,
      );

      assert.ok(prompt.includes('$18.50'));
      assert.ok(prompt.includes('Budget remaining'));
    });

    it('includes zero budget correctly', () => {
      const prompt = buildSystemPrompt(
        makeContext({ budgetRemaining: 0 }),
        PERSONA_PATH,
      );

      assert.ok(prompt.includes('$0.00'));
    });

    it('includes time remaining when provided', () => {
      const prompt = buildSystemPrompt(
        makeContext({ timeRemaining: 90 }),
        PERSONA_PATH,
      );

      assert.ok(prompt.includes('1h 30m'));
    });

    it('omits time remaining when not provided', () => {
      const prompt = buildSystemPrompt(
        makeContext({ timeRemaining: undefined }),
        PERSONA_PATH,
      );

      assert.ok(!prompt.includes('Time remaining'));
    });

    it('formats minutes-only time remaining correctly', () => {
      const prompt = buildSystemPrompt(
        makeContext({ timeRemaining: 45 }),
        PERSONA_PATH,
      );

      assert.ok(prompt.includes('45m'));
      assert.ok(!prompt.includes('0h'));
    });
  });

  // ---- Current projects --------------------------------------------------

  describe('current projects', () => {
    it('includes current projects when provided', () => {
      const prompt = buildSystemPrompt(
        makeContext({
          currentProjects: ['Bacowr SaaS', 'OB1 Control', 'OpenClaw'],
        }),
        PERSONA_PATH,
      );

      assert.ok(prompt.includes('Bacowr SaaS'));
      assert.ok(prompt.includes('OB1 Control'));
      assert.ok(prompt.includes('OpenClaw'));
    });

    it('handles empty projects gracefully', () => {
      const prompt = buildSystemPrompt(
        makeContext({ currentProjects: [] }),
        PERSONA_PATH,
      );

      assert.ok(prompt.includes('No active projects loaded'));
    });
  });

  // ---- Structural integrity ----------------------------------------------

  describe('structural integrity', () => {
    it('returns a non-empty string', () => {
      const prompt = buildSystemPrompt(makeContext(), PERSONA_PATH);
      assert.ok(typeof prompt === 'string');
      assert.ok(prompt.length > 0);
    });

    it('contains all major sections', () => {
      const prompt = buildSystemPrompt(
        makeContext({
          model: 'claude',
          sessionType: 'night_shift',
          activeGoals: ['Test goal'],
          recentDecisions: ['Test decision'],
          currentProjects: ['Test project'],
          budgetRemaining: 25,
          timeRemaining: 480,
        }),
        PERSONA_PATH,
      );

      // Persona sections
      assert.ok(prompt.includes('Who I Am'));
      assert.ok(prompt.includes('My Mission'));
      assert.ok(prompt.includes('Communication Style'));
      assert.ok(prompt.includes('Decision Heuristics'));
      assert.ok(prompt.includes('What I Own'));
      assert.ok(prompt.includes('What Robin Owns'));
      assert.ok(prompt.includes('Self-Awareness'));
      assert.ok(prompt.includes('Vision Context'));

      // Dynamic sections
      assert.ok(prompt.includes('Active Goals'));
      assert.ok(prompt.includes('Recent Decisions'));
      assert.ok(prompt.includes('Current Projects'));
      assert.ok(prompt.includes('Budget & Time'));

      // Model + session sections
      assert.ok(prompt.includes('Model-Specific Instructions'));
      assert.ok(prompt.includes('Session Mode'));
    });
  });
});
