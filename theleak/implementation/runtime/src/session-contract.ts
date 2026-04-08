// =============================================================================
// OB1 Agentic Runtime -- Session Contract Manager
// =============================================================================
// Read/write layer for session contracts (migration 011).
// Formalizes the pre-sleep agreement between Robin and the SysAdmin:
// goals, budget, boundaries, stop conditions, and progress tracking.
// Uses direct Supabase REST API calls with service_role key.
// =============================================================================

export interface ContractGoals { primary: string; secondary: string[]; stretch: string[]; }
export interface ContractBoundaries { autonomous: string[]; requires_approval: string[]; }

export interface ContractConfig {
  name: string;
  identityName?: string;
  goals: ContractGoals;
  budget_usd: number;
  duration_hours: number;
  max_concurrent_agents?: number;
  model?: string;
  quality_gates?: string[];
  boundaries: ContractBoundaries;
}

export type ContractStatus = 'draft' | 'active' | 'completed' | 'aborted' | 'paused';

export interface SessionContractRecord {
  id: string;
  identity_id?: string;
  name: string;
  status: ContractStatus;
  goals: ContractGoals;
  budget_usd: number;
  duration_hours: number;
  model: string;
  boundaries: ContractBoundaries;
  quality_gates: string[];
  current_wave: number;
  waves_completed: number;
  usd_spent: number;
  tokens_used: number;
  last_heartbeat?: string;
  last_checkpoint?: Record<string, unknown>;
  stop_reason?: string;
  goals_achieved: Record<string, string>;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

// -- Supabase REST helper (same pattern as identity-store.ts) ----------------

class SB {
  private readonly url: string;
  constructor(url: string, private readonly key: string) { this.url = url.replace(/\/+$/, ''); }

  private h(extra?: Record<string, string>): Record<string, string> {
    return { 'Content-Type': 'application/json', apikey: this.key, Authorization: `Bearer ${this.key}`, Prefer: 'return=representation', ...extra };
  }
  private async chk(r: Response, l: string): Promise<void> {
    if (!r.ok) throw new Error(`Supabase ${l} failed (${r.status}): ${await r.text()}`);
  }
  async query<T>(t: string, qs: string): Promise<T[]> {
    const r = await fetch(`${this.url}/rest/v1/${t}?${qs}`, { headers: this.h() });
    await this.chk(r, `query ${t}`); return r.json() as Promise<T[]>;
  }
  async insert<T>(t: string, row: Record<string, unknown>): Promise<T[]> {
    const r = await fetch(`${this.url}/rest/v1/${t}`, { method: 'POST', headers: this.h(), body: JSON.stringify(row) });
    await this.chk(r, `insert ${t}`); return r.json() as Promise<T[]>;
  }
  async update<T>(t: string, qs: string, data: Record<string, unknown>): Promise<T[]> {
    const r = await fetch(`${this.url}/rest/v1/${t}?${qs}`, { method: 'PATCH', headers: this.h(), body: JSON.stringify(data) });
    await this.chk(r, `update ${t}`); return r.json() as Promise<T[]>;
  }
  async single<T>(t: string, qs: string): Promise<T | null> {
    const r = await fetch(`${this.url}/rest/v1/${t}?${qs}`, { headers: this.h({ Accept: 'application/vnd.pgrst.object+json' }) });
    if (r.status === 406 || r.status === 404) return null;
    await this.chk(r, `single ${t}`); return r.json() as Promise<T>;
  }
}

// -- Raw DB row (maps 1:1 to SQL columns) ------------------------------------

interface ContractRow {
  id: string; identity_id: string | null; name: string; status: ContractStatus;
  primary_goal: string; secondary_goals: string[]; stretch_goals: string[];
  budget_usd: number; duration_hours: number; max_concurrent_agents: number; model: string;
  autonomous_actions: string[]; requires_approval: string[]; quality_gates: string[];
  current_wave: number; waves_completed: number; waves_failed: number;
  usd_spent: number; tokens_used: number;
  last_heartbeat: string | null; last_checkpoint: Record<string, unknown> | null;
  morning_report_path: string | null; stop_reason: string | null;
  goals_achieved: Record<string, string>;
  started_at: string | null; completed_at: string | null;
  created_at: string; updated_at: string;
}

function toRecord(r: ContractRow): SessionContractRecord {
  return {
    id: r.id, identity_id: r.identity_id ?? undefined, name: r.name, status: r.status,
    goals: { primary: r.primary_goal, secondary: r.secondary_goals, stretch: r.stretch_goals },
    budget_usd: Number(r.budget_usd), duration_hours: Number(r.duration_hours), model: r.model,
    boundaries: { autonomous: r.autonomous_actions, requires_approval: r.requires_approval },
    quality_gates: r.quality_gates ?? [], current_wave: r.current_wave,
    waves_completed: r.waves_completed, usd_spent: Number(r.usd_spent),
    tokens_used: Number(r.tokens_used), last_heartbeat: r.last_heartbeat ?? undefined,
    last_checkpoint: r.last_checkpoint ?? undefined, stop_reason: r.stop_reason ?? undefined,
    goals_achieved: r.goals_achieved ?? {}, started_at: r.started_at ?? undefined,
    completed_at: r.completed_at ?? undefined, created_at: r.created_at,
  };
}

// -- SessionContractManager ---------------------------------------------------

const T = 'session_contracts';

export class SessionContractManager {
  private readonly db: SB;
  constructor(supabaseUrl: string, accessKey: string) {
    this.db = new SB(supabaseUrl, accessKey);
  }
  private enc(v: string): string { return encodeURIComponent(v); }

  /** Create a new contract (status: draft). */
  async create(config: ContractConfig): Promise<SessionContractRecord> {
    let identity_id: string | undefined;
    if (config.identityName) {
      const row = await this.db.single<{ id: string }>(
        'agent_identities', `name=eq.${this.enc(config.identityName)}&select=id`,
      );
      if (row) identity_id = row.id;
    }
    const rows = await this.db.insert<ContractRow>(T, {
      identity_id: identity_id ?? null, name: config.name, status: 'draft',
      primary_goal: config.goals.primary, secondary_goals: config.goals.secondary,
      stretch_goals: config.goals.stretch, budget_usd: config.budget_usd,
      duration_hours: config.duration_hours,
      max_concurrent_agents: config.max_concurrent_agents ?? 3,
      model: config.model ?? 'sonnet',
      autonomous_actions: config.boundaries.autonomous,
      requires_approval: config.boundaries.requires_approval,
      quality_gates: config.quality_gates ?? [],
    });
    return toRecord(rows[0]);
  }

  /** Activate a contract (draft -> active, set started_at). */
  async activate(contractId: string): Promise<void> {
    await this.db.update(T, `id=eq.${this.enc(contractId)}`, {
      status: 'active', started_at: new Date().toISOString(),
    });
  }

  /** Update progress (wave count, budget spent). */
  async updateProgress(contractId: string, data: {
    current_wave: number; waves_completed: number; waves_failed?: number;
    usd_spent: number; tokens_used: number;
  }): Promise<void> {
    await this.db.update(T, `id=eq.${this.enc(contractId)}`, {
      current_wave: data.current_wave, waves_completed: data.waves_completed,
      waves_failed: data.waves_failed ?? 0, usd_spent: data.usd_spent,
      tokens_used: data.tokens_used,
    });
  }

  /** Heartbeat (called every 60s during execution). */
  async heartbeat(contractId: string): Promise<void> {
    await this.db.update(T, `id=eq.${this.enc(contractId)}`, {
      last_heartbeat: new Date().toISOString(),
    });
  }

  /** Save checkpoint (full state for resume after crash). */
  async saveCheckpoint(contractId: string, checkpoint: Record<string, unknown>): Promise<void> {
    await this.db.update(T, `id=eq.${this.enc(contractId)}`, { last_checkpoint: checkpoint });
  }

  /** Complete contract (active -> completed). */
  async complete(contractId: string, stopReason: string, goalsAchieved: Record<string, string>): Promise<void> {
    await this.db.update(T, `id=eq.${this.enc(contractId)}`, {
      status: 'completed', stop_reason: stopReason, goals_achieved: goalsAchieved,
      completed_at: new Date().toISOString(),
    });
  }

  /** Abort contract (any -> aborted). */
  async abort(contractId: string, reason: string): Promise<void> {
    await this.db.update(T, `id=eq.${this.enc(contractId)}`, {
      status: 'aborted', stop_reason: reason, completed_at: new Date().toISOString(),
    });
  }

  /** Find interrupted contracts (active + stale heartbeat). */
  async findInterrupted(staleSinceMinutes = 5): Promise<SessionContractRecord[]> {
    const cutoff = new Date(Date.now() - staleSinceMinutes * 60_000).toISOString();
    const rows = await this.db.query<ContractRow>(
      T, `status=eq.active&last_heartbeat=lt.${this.enc(cutoff)}&order=created_at.desc`,
    );
    return rows.map(toRecord);
  }

  /** Get the currently active contract (most recent). */
  async getActive(): Promise<SessionContractRecord | null> {
    const row = await this.db.single<ContractRow>(T, `status=eq.active&order=created_at.desc&limit=1`);
    return row ? toRecord(row) : null;
  }

  /** Get contract by ID. */
  async get(contractId: string): Promise<SessionContractRecord | null> {
    const row = await this.db.single<ContractRow>(T, `id=eq.${this.enc(contractId)}`);
    return row ? toRecord(row) : null;
  }

  /** List recent contracts. */
  async listRecent(limit = 10): Promise<SessionContractRecord[]> {
    const rows = await this.db.query<ContractRow>(T, `order=created_at.desc&limit=${limit}`);
    return rows.map(toRecord);
  }

  /**
   * Check if an action is within autonomous boundaries.
   * IMPORTANT: requiresApproval is checked first — if an action matches both
   * autonomous and requires_approval, the approval requirement wins.
   */
  isAutonomous(action: string, contract: SessionContractRecord): boolean {
    if (this.requiresApproval(action, contract)) return false;
    const lower = action.toLowerCase();
    return contract.boundaries.autonomous.some(a => lower.includes(a.toLowerCase()));
  }

  /** Check if an action requires Robin's approval. */
  requiresApproval(action: string, contract: SessionContractRecord): boolean {
    const lower = action.toLowerCase();
    return contract.boundaries.requires_approval.some(a => lower.includes(a.toLowerCase()));
  }

  /** Check if budget is exhausted. */
  isBudgetExhausted(contract: SessionContractRecord): boolean {
    return contract.usd_spent >= contract.budget_usd;
  }

  /** Get remaining budget in USD. */
  getBudgetRemaining(contract: SessionContractRecord): number {
    return Math.max(0, contract.budget_usd - contract.usd_spent);
  }

  /** Check if duration is exhausted. */
  isDurationExhausted(contract: SessionContractRecord): boolean {
    return this.getTimeRemaining(contract) <= 0;
  }

  /** Get remaining time in minutes. */
  getTimeRemaining(contract: SessionContractRecord): number {
    if (!contract.started_at) return contract.duration_hours * 60;
    const elapsed = Date.now() - new Date(contract.started_at).getTime();
    const totalMs = contract.duration_hours * 60 * 60_000;
    return Math.max(0, Math.round((totalMs - elapsed) / 60_000));
  }

  /** Update the status of a specific goal. */
  async updateGoalStatus(
    contractId: string, goalType: 'primary' | 'secondary', index: number, status: string,
  ): Promise<void> {
    const contract = await this.get(contractId);
    if (!contract) throw new Error(`Contract not found: ${contractId}`);
    const achieved = { ...contract.goals_achieved };
    achieved[goalType === 'primary' ? 'primary' : `secondary_${index}`] = status;
    await this.db.update(T, `id=eq.${this.enc(contractId)}`, { goals_achieved: achieved });
  }
}
