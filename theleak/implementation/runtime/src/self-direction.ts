// Self-Direction Engine — The brain of the overnight session
// Implements the 6 self-direction heuristics from long-session-protocol.md

// -- Types --------------------------------------------------------------------

export interface DirectionContext {
  goals: { primary: string; secondary: string[]; stretch: string[] };
  completed_waves: CompletedWaveInfo[];
  remaining_budget_usd: number;
  remaining_time_minutes: number;
  quality_gate_status: { all_passing: boolean; failing_gates: string[] };
  knowledge_base_insights?: string[];
}

export interface CompletedWaveInfo {
  id: number; name: string;
  tasks_completed: number; tasks_failed: number;
  all_gates_passed: boolean; usd_spent: number;
  findings: string[]; suggestions: string[];
}

export interface WaveProposal {
  name: string; description: string;
  tasks: ProposedTask[];
  estimated_value: number;
  reasoning: string;
  heuristic_scores: HeuristicScore[];
  estimated_cost_usd: number;
  estimated_duration_minutes: number;
}

export interface ProposedTask {
  title: string; description: string;
  task_type: string; estimated_tokens: number;
}

export interface HeuristicScore {
  heuristic: string; score: number; reasoning: string;
}

// -- Constants & keyword sets -------------------------------------------------

const MIN_VALUE = 0.15;
const DR_COUNT = 3;   // diminishing-returns window
const DR_THRESHOLD = 1.0;

const ERROR_KW = ['error', 'fail', 'exception', 'crash', 'broken', 'bug', 'fatal'];
const WARN_KW  = ['warn', 'deprecated', 'todo', 'fixme', 'hack', 'workaround'];
const TEST_KW  = ['test', 'spec', 'coverage', 'assert', 'expect', 'vitest', 'jest'];
const BUILD_KW = ['added', 'created', 'wrote', 'generated', 'implemented', 'built'];
const DOG_KW   = ['dog', 'use it', 'try it', 'user test', 'end-to-end', 'integration test', 'smoke test'];

const has = (text: string, kws: string[]) => kws.some(k => text.includes(k));

// -- Engine -------------------------------------------------------------------

export class SelfDirectionEngine {

  /** Propose next wave or null if no valuable work remains. */
  proposeNextWave(ctx: DirectionContext): WaveProposal | null {
    if (this.detectDiminishingReturns(ctx)) return null;
    if (ctx.remaining_budget_usd <= 0 || ctx.remaining_time_minutes <= 0) return null;

    const candidates = this.applyHeuristics(ctx);
    if (candidates.length === 0) return null;

    const scored = candidates
      .map(c => ({ p: c, s: this.scoreProposal(c, ctx) }))
      .sort((a, b) => b.s - a.s);

    return scored[0].s >= MIN_VALUE ? scored[0].p : null;
  }

  private applyHeuristics(ctx: DirectionContext): WaveProposal[] {
    return [
      ...this.heuristicFixBroken(ctx),
      ...this.heuristicDeepen(ctx),
      ...this.heuristicVerifyClaims(ctx),
      ...this.heuristicFollowErrors(ctx),
      ...this.heuristicDogFood(ctx),
      ...this.heuristicGoalProgression(ctx),
    ];
  }

  // H1: Fix what's broken first
  private heuristicFixBroken(ctx: DirectionContext): WaveProposal[] {
    if (ctx.quality_gate_status.all_passing) return [];
    const gates = ctx.quality_gate_status.failing_gates;
    return [{
      name: 'Fix failing quality gates',
      description: `Gates failing: ${gates.join(', ')}`,
      tasks: gates.map(g => ({
        title: `Fix ${g}`, description: `Quality gate "${g}" is failing. Investigate and fix.`,
        task_type: 'code_fix', estimated_tokens: 30_000,
      })),
      estimated_value: 1.0,
      reasoning: 'Quality gates must pass before any other work (H1: fix broken first)',
      heuristic_scores: [{ heuristic: 'fix_broken', score: 1.0, reasoning: 'Gates failing' }],
      estimated_cost_usd: Math.max(0.50, gates.length * 0.25),
      estimated_duration_minutes: Math.max(15, gates.length * 10),
    }];
  }

  // H2: Deepen before broadening
  private heuristicDeepen(ctx: DirectionContext): WaveProposal[] {
    if (ctx.completed_waves.length === 0) return [];
    const last = ctx.completed_waves[ctx.completed_waves.length - 1];
    const testRelated =
      last.findings.some(f => has(f.toLowerCase(), TEST_KW)) ||
      last.suggestions.some(s => has(s.toLowerCase(), TEST_KW));
    if (!testRelated) return [];

    const tasks: ProposedTask[] = [{
      title: 'Run and verify new tests',
      description: 'Execute all tests added in the previous wave and fix any failures.',
      task_type: 'testing', estimated_tokens: 25_000,
    }];
    if (last.tasks_failed > 0) tasks.push({
      title: 'Fix failures from previous wave',
      description: `${last.tasks_failed} task(s) failed in wave "${last.name}". Fix before moving on.`,
      task_type: 'code_fix', estimated_tokens: 30_000,
    });
    return [{
      name: 'Deepen: verify and fix test results',
      description: `Previous wave "${last.name}" involved tests. Verify before broadening.`,
      tasks, estimated_value: 0.85,
      reasoning: 'H2: Last wave involved testing. Deepen by verifying results before moving on.',
      heuristic_scores: [{ heuristic: 'deepen_before_broaden', score: 0.85, reasoning: 'Last wave touched tests' }],
      estimated_cost_usd: 0.40, estimated_duration_minutes: 12,
    }];
  }

  // H3: Verify claims
  private heuristicVerifyClaims(ctx: DirectionContext): WaveProposal[] {
    if (ctx.completed_waves.length === 0) return [];
    const last = ctx.completed_waves[ctx.completed_waves.length - 1];
    const claims = last.findings.filter(f => has(f.toLowerCase(), BUILD_KW));
    if (claims.length === 0) return [];
    return [{
      name: 'Verify claims from previous wave',
      description: `Wave "${last.name}" claimed: ${claims.slice(0, 3).join('; ')}`,
      tasks: claims.slice(0, 5).map(c => ({
        title: `Verify: ${c.slice(0, 80)}`,
        description: `Previous wave claimed "${c}". Run verification to confirm.`,
        task_type: 'verification', estimated_tokens: 15_000,
      })),
      estimated_value: 0.75,
      reasoning: 'H3: Previous wave made verifiable claims. Trust but verify.',
      heuristic_scores: [{ heuristic: 'verify_claims', score: 0.75, reasoning: `${claims.length} claim(s) to verify` }],
      estimated_cost_usd: 0.30, estimated_duration_minutes: 10,
    }];
  }

  // H4: Follow the errors
  private heuristicFollowErrors(ctx: DirectionContext): WaveProposal[] {
    if (ctx.completed_waves.length === 0) return [];
    const recent = ctx.completed_waves.slice(-2);
    const errs: Array<{ w: string; f: string }> = [];
    const warns: Array<{ w: string; f: string }> = [];

    for (const wave of recent) {
      for (const finding of wave.findings) {
        const lo = finding.toLowerCase();
        if (has(lo, ERROR_KW)) errs.push({ w: wave.name, f: finding });
        else if (has(lo, WARN_KW)) warns.push({ w: wave.name, f: finding });
      }
    }
    if (errs.length === 0 && warns.length === 0) return [];

    const tasks: ProposedTask[] = [
      ...errs.slice(0, 3).map(e => ({
        title: `Fix error: ${e.f.slice(0, 60)}`,
        description: `Error found in wave "${e.w}": ${e.f}`,
        task_type: 'code_fix' as const, estimated_tokens: 30_000,
      })),
      ...warns.slice(0, 2).map(w => ({
        title: `Address warning: ${w.f.slice(0, 60)}`,
        description: `Warning found in wave "${w.w}": ${w.f}`,
        task_type: 'code_fix' as const, estimated_tokens: 20_000,
      })),
    ];
    const value = errs.length > 0 ? 0.90 : 0.60;
    return [{
      name: 'Follow errors and warnings from recent waves',
      description: `Found ${errs.length} error(s) and ${warns.length} warning(s) in recent waves.`,
      tasks, estimated_value: value,
      reasoning: `H4: ${errs.length} error(s), ${warns.length} warning(s) found. Errors are free prioritization.`,
      heuristic_scores: [{ heuristic: 'follow_errors', score: value, reasoning: `${errs.length} errors, ${warns.length} warnings` }],
      estimated_cost_usd: tasks.length * 0.20,
      estimated_duration_minutes: tasks.length * 8,
    }];
  }

  // H6: Dog-food the product
  private heuristicDogFood(ctx: DirectionContext): WaveProposal[] {
    if (ctx.completed_waves.length < 2) return [];
    const allSugg = ctx.completed_waves.flatMap(w => w.suggestions);
    const dogSugg = allSugg.filter(s => has(s.toLowerCase(), DOG_KW));
    const recent3 = ctx.completed_waves.slice(-3);
    const allBuilding = recent3.length >= 3 &&
      recent3.every(w => w.findings.some(f => has(f.toLowerCase(), BUILD_KW)));

    if (dogSugg.length === 0 && !allBuilding) return [];
    const reason = dogSugg.length > 0
      ? `Suggestions mention end-to-end verification: ${dogSugg[0].slice(0, 60)}`
      : 'Three consecutive waves of building without integration testing';
    return [{
      name: 'Dog-food: end-to-end verification',
      description: 'Test the product as a real user would. Run integration tests or manual verification.',
      tasks: [
        { title: 'Run end-to-end smoke test', description: 'Execute the product flow as a user would.', task_type: 'integration_test', estimated_tokens: 40_000 },
        { title: 'Document dog-food findings', description: 'Record issues and improvements discovered.', task_type: 'documentation', estimated_tokens: 10_000 },
      ],
      estimated_value: 0.70,
      reasoning: `H6: ${reason}`,
      heuristic_scores: [{ heuristic: 'dog_food', score: 0.70, reasoning: reason }],
      estimated_cost_usd: 0.60, estimated_duration_minutes: 20,
    }];
  }

  // Goal progression: primary -> secondary -> stretch
  private heuristicGoalProgression(ctx: DirectionContext): WaveProposal[] {
    const names = new Set(ctx.completed_waves.map(w => w.name.toLowerCase()));
    const findings = ctx.completed_waves.flatMap(w => w.findings).map(f => f.toLowerCase());
    const done = (goal: string) => {
      const lo = goal.toLowerCase();
      return names.has(lo) || findings.some(f => f.includes(lo.slice(0, 30)));
    };

    if (!done(ctx.goals.primary)) {
      return [this.goalWave('Primary', ctx.goals.primary, 0.80, 'Primary goal pending', 50_000, 0.70, 20)];
    }
    const sec = ctx.goals.secondary.filter(g => !done(g));
    if (sec.length > 0) {
      return [this.goalWave('Secondary', sec[0], 0.60, `${sec.length} secondary goal(s) remaining`, 40_000, 0.50, 15)];
    }
    const str = ctx.goals.stretch.filter(g => !done(g));
    if (str.length > 0) {
      return [this.goalWave('Stretch', str[0], 0.40, `${str.length} stretch goal(s) remaining`, 35_000, 0.40, 12)];
    }
    return [];
  }

  private goalWave(
    tier: string, goal: string, value: number, reason: string,
    tokens: number, cost: number, mins: number,
  ): WaveProposal {
    return {
      name: `${tier} goal: ${goal.slice(0, 60)}`,
      description: `Work toward ${tier.toLowerCase()} goal: ${goal}`,
      tasks: [{ title: goal, description: `Execute ${tier.toLowerCase()} goal: ${goal}`, task_type: 'code_write', estimated_tokens: tokens }],
      estimated_value: value,
      reasoning: `Goal progression: ${reason}.`,
      heuristic_scores: [{ heuristic: 'goal_progression', score: value, reasoning: reason }],
      estimated_cost_usd: cost, estimated_duration_minutes: mins,
    };
  }

  // Diminishing returns: true if last 3 waves all scored below threshold
  detectDiminishingReturns(ctx: DirectionContext): boolean {
    if (ctx.completed_waves.length < DR_COUNT) return false;
    return ctx.completed_waves.slice(-DR_COUNT).every(w =>
      w.tasks_completed * (w.all_gates_passed ? 1 : 0.5) < DR_THRESHOLD
    );
  }

  private scoreProposal(proposal: WaveProposal, ctx: DirectionContext): number {
    let s = proposal.estimated_value;
    if (ctx.remaining_budget_usd > 0 && proposal.estimated_cost_usd > ctx.remaining_budget_usd * 0.5) s *= 0.5;
    if (ctx.remaining_time_minutes > 0 && proposal.estimated_duration_minutes > ctx.remaining_time_minutes * 0.5) s *= 0.5;
    return s;
  }
}
