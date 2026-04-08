// Crash Recovery & Checkpoint Resume — Phase 5, Plan 2
// Persists wave state after every commit, detects crashed sessions via stale
// heartbeat, and resumes from the last checkpoint on restart.

export interface WaveCheckpoint {
  contract_id: string;
  wave_number: number;
  waves_completed: Array<{
    id: number;
    name: string;
    status: 'completed' | 'failed';
    usd_spent: number;
    commit_sha?: string;
  }>;
  remaining_goals: string[];
  usd_spent_total: number;
  tokens_used_total: number;
  next_wave_suggestions: string[];
  morning_report_path: string;
  saved_at: string;
}

export interface CrashDetectionResult {
  crashed: boolean;
  contract_id?: string;
  last_heartbeat?: string;
  minutes_since_heartbeat?: number;
  last_checkpoint?: WaveCheckpoint;
  recommendation: 'resume' | 'abort' | 'none';
  reason: string;
}

interface ContractRow {
  id: string;
  status: string;
  last_heartbeat: string;
  last_checkpoint: WaveCheckpoint | null;
  budget_usd: number;
  duration_minutes: number;
  started_at: string;
}

const HEARTBEAT_INTERVAL_MS = 60_000;
const DEFAULT_STALE_MINUTES = 5;
function minutesAgo(iso: string): number { return (Date.now() - new Date(iso).getTime()) / 60_000; }

export class CrashRecovery {
  constructor(private supabaseUrl: string, private accessKey: string) {}

  private async rpc<T>(table: string, method: 'GET' | 'PATCH', params: {
    filter?: string;
    body?: Record<string, unknown>;
    select?: string;
  }): Promise<T> {
    const url = new URL(`/rest/v1/${table}`, this.supabaseUrl);
    if (params.filter) url.searchParams.set('id', `eq.${params.filter}`);
    if (params.select) url.searchParams.set('select', params.select);

    const headers: Record<string, string> = {
      'apikey': this.accessKey,
      'Authorization': `Bearer ${this.accessKey}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'PATCH' ? 'return=minimal' : 'return=representation',
    };

    const res = await fetch(url.toString(), {
      method,
      headers,
      body: method === 'PATCH' ? JSON.stringify(params.body) : undefined,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Supabase ${method} ${table} failed (${res.status}): ${detail}`);
    }

    if (method === 'PATCH') return undefined as T;
    return res.json() as Promise<T>;
  }

  /**
   * Save checkpoint after a wave completes.
   * Called by wave-runner after every successful COMMIT step.
   */
  async saveCheckpoint(checkpoint: WaveCheckpoint): Promise<void> {
    const now = new Date().toISOString();
    await this.rpc('session_contracts', 'PATCH', {
      filter: checkpoint.contract_id,
      body: {
        last_checkpoint: checkpoint,
        last_heartbeat: now,
      },
    });
  }

  /**
   * Send heartbeat during execution.
   * Called every 60s by wave-runner.
   */
  async heartbeat(contractId: string): Promise<void> {
    await this.rpc('session_contracts', 'PATCH', {
      filter: contractId,
      body: { last_heartbeat: new Date().toISOString() },
    });
  }

  /**
   * Detect crashed sessions on startup.
   * A session is crashed if: status='active' AND last_heartbeat < (now - staleSinceMinutes).
   */
  async detectCrash(staleSinceMinutes: number = DEFAULT_STALE_MINUTES): Promise<CrashDetectionResult> {
    // Fetch active contracts — Supabase REST filter syntax
    const url = new URL('/rest/v1/session_contracts', this.supabaseUrl);
    url.searchParams.set('status', 'eq.active');
    url.searchParams.set('select', 'id,status,last_heartbeat,last_checkpoint,budget_usd,duration_minutes,started_at');

    const res = await fetch(url.toString(), {
      headers: {
        'apikey': this.accessKey,
        'Authorization': `Bearer ${this.accessKey}`,
      },
    });

    if (!res.ok) {
      return { crashed: false, recommendation: 'none', reason: `Failed to query contracts: ${res.status}` };
    }

    const rows = (await res.json()) as ContractRow[];

    for (const row of rows) {
      if (!row.last_heartbeat) continue;

      const staleMin = minutesAgo(row.last_heartbeat);

      // Still running — heartbeat is fresh
      if (staleMin < staleSinceMinutes) {
        continue;
      }

      // Stale heartbeat — crashed
      const checkpoint = row.last_checkpoint ?? undefined;

      let recommendation: 'resume' | 'abort';
      let reason: string;

      if (!checkpoint) {
        recommendation = 'abort';
        reason = 'No checkpoint found — cannot resume safely';
      } else {
        const budgetPct = checkpoint.usd_spent_total / row.budget_usd;
        recommendation = 'resume';
        reason = budgetPct > 0.5
          ? `Checkpoint exists, ${Math.round(budgetPct * 100)}% budget spent — resume with reduced budget`
          : `Checkpoint exists, ${Math.round(budgetPct * 100)}% budget spent — resume`;
      }

      return {
        crashed: true,
        contract_id: row.id,
        last_heartbeat: row.last_heartbeat,
        minutes_since_heartbeat: Math.round(staleMin),
        last_checkpoint: checkpoint,
        recommendation,
        reason,
      };
    }

    return { crashed: false, recommendation: 'none', reason: 'No crashed sessions detected' };
  }

  /**
   * Resume from checkpoint.
   * Returns the state needed to continue the wave-runner from where it left off.
   */
  async resume(contractId: string): Promise<{
    checkpoint: WaveCheckpoint;
    remaining_budget_usd: number;
    remaining_duration_minutes: number;
    resume_wave_number: number;
  } | null> {
    const url = new URL('/rest/v1/session_contracts', this.supabaseUrl);
    url.searchParams.set('id', `eq.${contractId}`);
    url.searchParams.set('select', 'id,status,last_checkpoint,budget_usd,duration_minutes,started_at');

    const res = await fetch(url.toString(), {
      headers: {
        'apikey': this.accessKey,
        'Authorization': `Bearer ${this.accessKey}`,
      },
    });

    if (!res.ok) return null;

    const rows = (await res.json()) as ContractRow[];
    const first = rows[0];
    if (!first || !first.last_checkpoint) return null;

    const checkpoint = first.last_checkpoint;

    const elapsedMin = minutesAgo(first.started_at);
    const remainingDuration = Math.max(0, first.duration_minutes - elapsedMin);
    const remainingBudget = Math.max(0, first.budget_usd - checkpoint.usd_spent_total);

    return {
      checkpoint,
      remaining_budget_usd: Math.round(remainingBudget * 100) / 100,
      remaining_duration_minutes: Math.round(remainingDuration),
      resume_wave_number: checkpoint.wave_number + 1,
    };
  }

  /**
   * Mark a crashed session as aborted.
   */
  async markAborted(contractId: string, reason: string): Promise<void> {
    await this.rpc('session_contracts', 'PATCH', {
      filter: contractId,
      body: { status: 'aborted', abort_reason: reason },
    });
  }

  /**
   * Generate a launchd-compatible restart command.
   */
  static generateRestartCommand(config: {
    runtimePath: string;
    contractId: string;
  }): string {
    return `node ${config.runtimePath}/wave-runner.js --resume --contract-id ${config.contractId}`;
  }

  /**
   * Start heartbeat interval. Returns cleanup function.
   */
  startHeartbeatInterval(contractId: string, intervalMs: number = HEARTBEAT_INTERVAL_MS): () => void {
    const id = setInterval(() => {
      this.heartbeat(contractId).catch(() => {
        // Heartbeat failure is non-fatal — will be retried next interval
      });
    }, intervalMs);

    return () => clearInterval(id);
  }
}
