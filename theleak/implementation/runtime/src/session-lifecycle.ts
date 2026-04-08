// session-lifecycle.ts — Identity Continuity Protocol
//
// Manages start/end of every agent session. Loads identity, recent decisions,
// learnings, and knowledge on start; persists state on end.
// Uses Supabase PostgREST directly (no dependency on identity-store or knowledge-base).
// Tables: agent_identities, agent_decisions, agent_learnings, agent_session_snapshots (migration 009).

// -- Types ------------------------------------------------------------------

export interface AgentIdentity {
  id: string;
  name: string;
  persona_hash: string | null;
  active_goals: string[];
  current_priorities: string[];
  capabilities: Record<string, unknown>;
  self_assessment: string | null;
  session_count: number;
  total_runtime_minutes: number;
  last_session_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DecisionRecord {
  id: string; identity_id: string; session_id: string | null;
  decision: string; rationale: string | null; context: string | null;
  outcome: string | null; outcome_status: string; tags: string[];
  created_at: string;
}

export interface LearningRecord {
  id: string; identity_id: string; session_id: string | null;
  learning: string; category: string; confidence: number;
  source: string | null; superseded_by: string | null; tags: string[];
  created_at: string;
}

export interface KnowledgeEntry {
  id: string; title: string; content: string;
  category: string; relevance_score?: number;
}

export interface SessionStartResult {
  sessionId: string;
  identity: AgentIdentity;
  recentDecisions: DecisionRecord[];
  recentLearnings: LearningRecord[];
  activeGoals: string[];
  relevantKnowledge: KnowledgeEntry[];
  systemPrompt: string;
  bootstrapDurationMs: number;
}

export interface SessionEndData {
  sessionId: string;
  identityName: string;
  sessionType: 'interactive' | 'night_shift' | 'task';
  startedAt: Date;
  decisions: Array<{ decision: string; rationale: string; tags?: string[] }>;
  learnings: Array<{ learning: string; category: string; tags?: string[] }>;
  goalsAtEnd: string[];
  wavesCompleted?: number;
  tasksCompleted?: number;
  tasksFailed?: number;
  usdSpent?: number;
  tokensUsed?: number;
  summary: string;
}

// -- Helpers ----------------------------------------------------------------

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function hdrs(key: string): Record<string, string> {
  return {
    'apikey': key, 'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json', 'Prefer': 'return=representation',
  };
}

// -- SessionLifecycle -------------------------------------------------------

export class SessionLifecycle {
  private readonly restUrl: string;

  constructor(supabaseUrl: string, private accessKey: string) {
    this.restUrl = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1`;
  }

  /** Bootstrap a new session. Target: < 5 seconds. */
  async startSession(options: {
    identityName: string;
    sessionType: 'interactive' | 'night_shift' | 'task';
    model: string;
    budgetUsd?: number;
    timeRemainingMinutes?: number;
    currentProjects?: string[];
  }): Promise<SessionStartResult> {
    const startTime = Date.now();
    const sessionId = `${options.sessionType}_${Date.now()}_${randomSuffix()}`;

    const identity = await this.loadOrCreateIdentity(options.identityName);

    const [decisions, learnings, knowledge] = await Promise.all([
      this.loadRecentDecisions(identity.id, 10),
      this.loadRecentLearnings(identity.id, 20),
      this.loadRelevantKnowledge(5),
    ]);

    return {
      sessionId, identity,
      recentDecisions: decisions,
      recentLearnings: learnings,
      activeGoals: identity.active_goals,
      relevantKnowledge: knowledge,
      systemPrompt: this.buildSystemPrompt(identity, decisions, learnings, options),
      bootstrapDurationMs: Date.now() - startTime,
    };
  }

  /** Snapshot session state at END of every session. */
  async endSession(data: SessionEndData): Promise<void> {
    const identity = await this.loadIdentityByName(data.identityName);
    if (!identity) throw new Error(`Identity not found: ${data.identityName}`);

    const endedAt = new Date();
    const durationMinutes = (endedAt.getTime() - data.startedAt.getTime()) / 60_000;

    // Save decisions + learnings (sequential only if non-empty)
    if (data.decisions.length > 0) {
      await this.post('agent_decisions', data.decisions.map((d) => ({
        identity_id: identity.id, session_id: data.sessionId,
        decision: d.decision, rationale: d.rationale, tags: d.tags ?? [],
      })));
    }
    if (data.learnings.length > 0) {
      await this.post('agent_learnings', data.learnings.map((l) => ({
        identity_id: identity.id, session_id: data.sessionId,
        learning: l.learning, category: l.category, tags: l.tags ?? [],
      })));
    }

    // Update identity + save snapshot in parallel
    await Promise.all([
      this.patch(`agent_identities?id=eq.${identity.id}`, {
        active_goals: JSON.stringify(data.goalsAtEnd),
        session_count: identity.session_count + 1,
        total_runtime_minutes: identity.total_runtime_minutes + durationMinutes,
        last_session_at: endedAt.toISOString(),
      }),
      this.post('agent_session_snapshots', [{
        identity_id: identity.id, session_id: data.sessionId,
        session_type: data.sessionType,
        started_at: data.startedAt.toISOString(), ended_at: endedAt.toISOString(),
        duration_minutes: durationMinutes,
        waves_completed: data.wavesCompleted ?? 0,
        tasks_completed: data.tasksCompleted ?? 0,
        tasks_failed: data.tasksFailed ?? 0,
        usd_spent: data.usdSpent ?? 0, tokens_used: data.tokensUsed ?? 0,
        goals_at_end: JSON.stringify(data.goalsAtEnd),
        decisions_made: data.decisions.length,
        learnings_captured: data.learnings.length,
        summary: data.summary,
      }]),
    ]);
  }

  /** Quick context refresh mid-session (e.g., after context compaction). */
  async refreshContext(identityName: string): Promise<string> {
    const identity = await this.loadIdentityByName(identityName);
    if (!identity) return `Identity "${identityName}" not found. Operating without persistent context.`;

    const [decisions, learnings] = await Promise.all([
      this.loadRecentDecisions(identity.id, 5),
      this.loadRecentLearnings(identity.id, 10),
    ]);

    const goals = identity.active_goals.length > 0 ? identity.active_goals.join(', ') : 'none set';
    const decs = decisions.length > 0 ? decisions.map((d) => d.decision).join('; ') : 'none recent';
    const lrns = learnings.length > 0 ? learnings.map((l) => l.learning).join('; ') : 'none recent';

    return `I am ${identity.name}. My active goals: [${goals}]. Recent decisions: [${decs}]. Key learnings: [${lrns}]`;
  }

  // -- Identity CRUD --------------------------------------------------------

  private async loadIdentityByName(name: string): Promise<AgentIdentity | null> {
    const res = await this.get(`agent_identities?name=eq.${encodeURIComponent(name)}&limit=1`);
    const rows = (await res.json()) as AgentIdentity[];
    return rows.length > 0 ? rows[0] : null;
  }

  private async loadOrCreateIdentity(name: string): Promise<AgentIdentity> {
    const existing = await this.loadIdentityByName(name);
    if (existing) return existing;
    const res = await this.post('agent_identities', [{
      name,
      active_goals: JSON.stringify([]),
      current_priorities: JSON.stringify([]),
      capabilities: JSON.stringify({}),
    }]);
    const rows = (await res.json()) as AgentIdentity[];
    return rows[0];
  }

  // -- Data Loaders ---------------------------------------------------------

  private async loadRecentDecisions(identityId: string, limit: number): Promise<DecisionRecord[]> {
    const res = await this.get(`agent_decisions?identity_id=eq.${identityId}&order=created_at.desc&limit=${limit}`);
    return (await res.json()) as DecisionRecord[];
  }

  private async loadRecentLearnings(identityId: string, limit: number): Promise<LearningRecord[]> {
    const res = await this.get(`agent_learnings?identity_id=eq.${identityId}&order=created_at.desc&limit=${limit}`);
    return (await res.json()) as LearningRecord[];
  }

  private async loadRelevantKnowledge(_limit: number): Promise<KnowledgeEntry[]> {
    // Knowledge base table (migration 010) is being built in parallel.
    return [];
  }

  // -- System Prompt Builder ------------------------------------------------

  private buildSystemPrompt(
    identity: AgentIdentity, decisions: DecisionRecord[],
    learnings: LearningRecord[], options: {
      sessionType: string; model: string;
      budgetUsd?: number; timeRemainingMinutes?: number; currentProjects?: string[];
    },
  ): string {
    const s: string[] = [];
    s.push(`You are ${identity.name}. Session #${identity.session_count + 1}.`);
    s.push(`Session type: ${options.sessionType}. Model: ${options.model}.`);
    if (options.budgetUsd !== undefined) s.push(`Budget: $${options.budgetUsd} USD remaining.`);
    if (options.timeRemainingMinutes !== undefined) s.push(`Time: ${options.timeRemainingMinutes} minutes remaining.`);
    if (identity.active_goals.length > 0)
      s.push(`Active goals:\n${identity.active_goals.map((g) => `- ${g}`).join('\n')}`);
    if (options.currentProjects?.length)
      s.push(`Active projects: ${options.currentProjects.join(', ')}`);
    if (decisions.length > 0)
      s.push(`Recent decisions:\n${decisions.slice(0, 5).map((d) => `- ${d.decision}${d.rationale ? ` (${d.rationale})` : ''}`).join('\n')}`);
    if (learnings.length > 0)
      s.push(`Key learnings:\n${learnings.slice(0, 5).map((l) => `- [${l.category}] ${l.learning}`).join('\n')}`);
    if (identity.self_assessment) s.push(`Self-assessment: ${identity.self_assessment}`);
    return s.join('\n\n');
  }

  // -- Supabase REST helpers ------------------------------------------------

  private async get(path: string): Promise<Response> {
    const res = await fetch(`${this.restUrl}/${path}`, { method: 'GET', headers: hdrs(this.accessKey) });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
    return res;
  }

  private async post(path: string, body: unknown): Promise<Response> {
    const res = await fetch(`${this.restUrl}/${path}`, {
      method: 'POST', headers: hdrs(this.accessKey), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${res.statusText}`);
    return res;
  }

  private async patch(path: string, body: unknown): Promise<Response> {
    const res = await fetch(`${this.restUrl}/${path}`, {
      method: 'PATCH', headers: hdrs(this.accessKey), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status} ${res.statusText}`);
    return res;
  }
}
