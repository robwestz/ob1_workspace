// =============================================================================
// OB1 Agentic Runtime -- Identity Store
// =============================================================================
// Read/write layer for agent identity persistence (migration 009).
// Uses direct Supabase REST API calls with service_role key.
// No external dependencies beyond built-in fetch (Node 20+).
// =============================================================================

// -- Interfaces ---------------------------------------------------------------

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
  id?: string;
  session_id?: string;
  decision: string;
  rationale?: string;
  context?: string;
  outcome?: string;
  outcome_status?: 'pending' | 'good' | 'revisit' | 'reversed';
  tags?: string[];
  created_at?: string;
}

export interface LearningRecord {
  id?: string;
  session_id?: string;
  learning: string;
  category: 'technical' | 'process' | 'architecture' | 'debugging'
    | 'robin_preference' | 'performance' | 'security';
  confidence?: number;
  source?: string;
  superseded_by?: string;
  tags?: string[];
  created_at?: string;
}

export interface SessionSnapshot {
  id?: string;
  identity_name: string;
  session_id: string;
  session_type: 'interactive' | 'night_shift' | 'task';
  started_at: string;
  ended_at: string;
  duration_minutes: number;
  waves_completed?: number;
  tasks_completed?: number;
  tasks_failed?: number;
  usd_spent?: number;
  tokens_used?: number;
  goals_at_start?: string[];
  goals_at_end?: string[];
  decisions_made?: number;
  learnings_captured?: number;
  morning_report_path?: string;
  summary?: string;
  created_at?: string;
}

export interface BootstrapContext {
  identity: AgentIdentity;
  recent_decisions: DecisionRecord[];
  recent_learnings: LearningRecord[];
  recent_sessions: SessionSnapshot[];
}

// -- Supabase REST helper -----------------------------------------------------

class SupabaseRest {
  constructor(private readonly url: string, private readonly key: string) {
    this.url = url.replace(/\/+$/, '');
  }

  private hdrs(extra?: Record<string, string>): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      Prefer: 'return=representation',
      ...extra,
    };
  }

  private async check(res: Response, label: string): Promise<void> {
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase ${label} failed (${res.status}): ${body}`);
    }
  }

  async query<T>(table: string, qs: string): Promise<T[]> {
    const res = await fetch(`${this.url}/rest/v1/${table}?${qs}`, { headers: this.hdrs() });
    await this.check(res, `query ${table}`);
    return res.json() as Promise<T[]>;
  }

  async insert<T>(table: string, rows: Record<string, unknown>): Promise<T[]> {
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method: 'POST', headers: this.hdrs(), body: JSON.stringify(rows),
    });
    await this.check(res, `insert ${table}`);
    return res.json() as Promise<T[]>;
  }

  async update<T>(table: string, qs: string, data: Record<string, unknown>): Promise<T[]> {
    const res = await fetch(`${this.url}/rest/v1/${table}?${qs}`, {
      method: 'PATCH', headers: this.hdrs(), body: JSON.stringify(data),
    });
    await this.check(res, `update ${table}`);
    return res.json() as Promise<T[]>;
  }

  async single<T>(table: string, qs: string): Promise<T | null> {
    const res = await fetch(`${this.url}/rest/v1/${table}?${qs}`, {
      headers: this.hdrs({ Accept: 'application/vnd.pgrst.object+json' }),
    });
    if (res.status === 406 || res.status === 404) return null;
    await this.check(res, `single ${table}`);
    return res.json() as Promise<T>;
  }
}

// -- IdentityStore ------------------------------------------------------------

export class IdentityStore {
  private readonly db: SupabaseRest;

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.db = new SupabaseRest(supabaseUrl, serviceRoleKey);
  }

  private async requireIdentity(name: string): Promise<AgentIdentity> {
    const id = await this.getIdentity(name);
    if (!id) throw new Error(`Identity not found: ${name}`);
    return id;
  }

  private enc(v: string): string { return encodeURIComponent(v); }

  // -- Identity CRUD ----------------------------------------------------------

  async getIdentity(name: string): Promise<AgentIdentity | null> {
    return this.db.single<AgentIdentity>('agent_identities', `name=eq.${this.enc(name)}`);
  }

  async createIdentity(
    name: string,
    data: Partial<Omit<AgentIdentity, 'id' | 'name' | 'created_at' | 'updated_at'>>,
  ): Promise<AgentIdentity> {
    const rows = await this.db.insert<AgentIdentity>('agent_identities', { name, ...data });
    return rows[0];
  }

  async updateGoals(name: string, goals: string[]): Promise<void> {
    await this.db.update('agent_identities', `name=eq.${this.enc(name)}`, { active_goals: goals });
  }

  async updateSelfAssessment(name: string, assessment: string): Promise<void> {
    await this.db.update('agent_identities', `name=eq.${this.enc(name)}`, { self_assessment: assessment });
  }

  async incrementSessionCount(name: string, runtimeMinutes: number): Promise<void> {
    const identity = await this.requireIdentity(name);
    await this.db.update('agent_identities', `name=eq.${this.enc(name)}`, {
      session_count: identity.session_count + 1,
      total_runtime_minutes: identity.total_runtime_minutes + runtimeMinutes,
      last_session_at: new Date().toISOString(),
    });
  }

  // -- Decisions --------------------------------------------------------------

  async recordDecision(identityName: string, decision: DecisionRecord): Promise<string> {
    const identity = await this.requireIdentity(identityName);
    const rows = await this.db.insert<{ id: string }>('agent_decisions', {
      identity_id: identity.id, session_id: decision.session_id,
      decision: decision.decision, rationale: decision.rationale,
      context: decision.context, outcome: decision.outcome,
      outcome_status: decision.outcome_status ?? 'pending',
      tags: decision.tags ?? [],
    });
    return rows[0].id;
  }

  async getRecentDecisions(identityName: string, limit = 10): Promise<DecisionRecord[]> {
    const identity = await this.requireIdentity(identityName);
    return this.db.query<DecisionRecord>(
      'agent_decisions',
      `identity_id=eq.${identity.id}&order=created_at.desc&limit=${limit}`,
    );
  }

  async updateDecisionOutcome(
    decisionId: string, outcome: string,
    status: 'pending' | 'good' | 'revisit' | 'reversed',
  ): Promise<void> {
    await this.db.update('agent_decisions', `id=eq.${this.enc(decisionId)}`, {
      outcome, outcome_status: status,
    });
  }

  // -- Learnings --------------------------------------------------------------

  async recordLearning(identityName: string, learning: LearningRecord): Promise<string> {
    const identity = await this.requireIdentity(identityName);
    const rows = await this.db.insert<{ id: string }>('agent_learnings', {
      identity_id: identity.id, session_id: learning.session_id,
      learning: learning.learning, category: learning.category,
      confidence: learning.confidence ?? 0.8, source: learning.source,
      tags: learning.tags ?? [],
    });
    return rows[0].id;
  }

  async getLearnings(identityName: string, category?: string, limit = 20): Promise<LearningRecord[]> {
    const identity = await this.requireIdentity(identityName);
    let qs = `identity_id=eq.${identity.id}&superseded_by=is.null&order=created_at.desc&limit=${limit}`;
    if (category) qs += `&category=eq.${this.enc(category)}`;
    return this.db.query<LearningRecord>('agent_learnings', qs);
  }

  async supersedeLearning(oldId: string, newLearning: LearningRecord): Promise<string> {
    const old = await this.db.single<{ identity_id: string }>(
      'agent_learnings', `id=eq.${this.enc(oldId)}&select=identity_id`,
    );
    if (!old) throw new Error(`Learning not found: ${oldId}`);
    const rows = await this.db.insert<{ id: string }>('agent_learnings', {
      identity_id: old.identity_id, session_id: newLearning.session_id,
      learning: newLearning.learning, category: newLearning.category,
      confidence: newLearning.confidence ?? 0.8, source: newLearning.source,
      tags: newLearning.tags ?? [],
    });
    const newId = rows[0].id;
    await this.db.update('agent_learnings', `id=eq.${this.enc(oldId)}`, { superseded_by: newId });
    return newId;
  }

  // -- Session Snapshots ------------------------------------------------------

  async saveSessionSnapshot(snapshot: SessionSnapshot): Promise<string> {
    const identity = await this.requireIdentity(snapshot.identity_name);
    const rows = await this.db.insert<{ id: string }>('agent_session_snapshots', {
      identity_id: identity.id, session_id: snapshot.session_id,
      session_type: snapshot.session_type,
      started_at: snapshot.started_at, ended_at: snapshot.ended_at,
      duration_minutes: snapshot.duration_minutes,
      waves_completed: snapshot.waves_completed ?? 0,
      tasks_completed: snapshot.tasks_completed ?? 0,
      tasks_failed: snapshot.tasks_failed ?? 0,
      usd_spent: snapshot.usd_spent ?? 0,
      tokens_used: snapshot.tokens_used ?? 0,
      goals_at_start: snapshot.goals_at_start ?? [],
      goals_at_end: snapshot.goals_at_end ?? [],
      decisions_made: snapshot.decisions_made ?? 0,
      learnings_captured: snapshot.learnings_captured ?? 0,
      morning_report_path: snapshot.morning_report_path,
      summary: snapshot.summary,
    });
    return rows[0].id;
  }

  async getRecentSessions(identityName: string, limit = 5): Promise<SessionSnapshot[]> {
    const identity = await this.requireIdentity(identityName);
    return this.db.query<SessionSnapshot>(
      'agent_session_snapshots',
      `identity_id=eq.${identity.id}&order=created_at.desc&limit=${limit}`,
    );
  }

  // -- Bootstrap (session start) ----------------------------------------------

  /** Load identity + last 10 decisions + last 20 learnings + last 3 sessions. */
  async loadBootstrapContext(identityName: string): Promise<BootstrapContext> {
    const identity = await this.getIdentity(identityName);
    if (!identity) throw new Error(`Identity not found: ${identityName}`);
    const [recent_decisions, recent_learnings, recent_sessions] = await Promise.all([
      this.getRecentDecisions(identityName, 10),
      this.getLearnings(identityName, undefined, 20),
      this.getRecentSessions(identityName, 3),
    ]);
    return { identity, recent_decisions, recent_learnings, recent_sessions };
  }
}
