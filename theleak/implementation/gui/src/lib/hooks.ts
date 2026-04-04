'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiContext, useSupabase } from '@/app/providers';
import type { OB1ApiClient } from '@/lib/api-client';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// useApi  --  shortcut to get the API client
// ---------------------------------------------------------------------------

export function useApi(): OB1ApiClient {
  return useApiContext();
}

// ---------------------------------------------------------------------------
// usePolling  --  generic polling hook
// ---------------------------------------------------------------------------

export function usePolling<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  options?: { enabled?: boolean },
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const enabled = options?.enabled ?? true;

  const refresh = useCallback(async () => {
    try {
      const result = await fnRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Initial fetch
    refresh();

    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled, refresh]);

  return { data, error, loading, refresh };
}

// ---------------------------------------------------------------------------
// useRealtimeEvents  --  subscribe to system_events via Supabase Realtime
// ---------------------------------------------------------------------------

export interface SystemEvent {
  id: string;
  session_id: string;
  event_type: string;
  payload: Record<string, any>;
  created_at: string;
}

export function useRealtimeEvents(sessionId?: string) {
  const supabase = useSupabase();
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let channel: RealtimeChannel;

    const filter = sessionId
      ? `session_id=eq.${sessionId}`
      : undefined;

    channel = supabase
      .channel(`system-events-${sessionId ?? 'all'}`)
      .on(
        'postgres_changes' as any,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'system_events',
          ...(filter ? { filter } : {}),
        },
        (payload: any) => {
          const newEvent = payload.new as SystemEvent;
          setEvents((prev) => [newEvent, ...prev].slice(0, 200));
        },
      )
      .subscribe((status: string) => {
        setConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, sessionId]);

  const clear = useCallback(() => setEvents([]), []);

  return { events, connected, clear };
}

// ---------------------------------------------------------------------------
// useRealtimeAgentRuns  --  live agent run status updates
// ---------------------------------------------------------------------------

export interface AgentRunUpdate {
  id: string;
  agent_type: string;
  status: string;
  coordinator_id: string;
  updated_at: string;
  [key: string]: any;
}

export function useRealtimeAgentRuns(coordinatorId?: string) {
  const supabase = useSupabase();
  const [runs, setRuns] = useState<Map<string, AgentRunUpdate>>(new Map());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let channel: RealtimeChannel;

    const filter = coordinatorId
      ? `coordinator_id=eq.${coordinatorId}`
      : undefined;

    channel = supabase
      .channel(`agent-runs-${coordinatorId ?? 'all'}`)
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'agent_runs',
          ...(filter ? { filter } : {}),
        },
        (payload: any) => {
          const run = (payload.new ?? payload.old) as AgentRunUpdate;
          if (run?.id) {
            setRuns((prev) => {
              const next = new Map(prev);
              if (payload.eventType === 'DELETE') {
                next.delete(run.id);
              } else {
                next.set(run.id, run);
              }
              return next;
            });
          }
        },
      )
      .subscribe((status: string) => {
        setConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, coordinatorId]);

  return {
    runs: Array.from(runs.values()),
    runsMap: runs,
    connected,
  };
}

// ---------------------------------------------------------------------------
// useAsyncAction  --  fire-and-forget with loading/error tracking
// ---------------------------------------------------------------------------

export function useAsyncAction<T>(action: () => Promise<T>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<T | null>(null);

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await action();
      setData(result);
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [action]);

  return { execute, loading, error, data };
}
