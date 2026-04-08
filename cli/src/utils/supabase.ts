export class SupabaseClient {
  private url: string;
  private key: string;

  constructor(url: string, key: string) {
    this.url = url.replace(/\/$/, ''); // strip trailing slash
    this.key = key;
  }

  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> ?? {}),
    };

    return fetch(`${this.url}${path}`, { ...options, headers });
  }

  async ping(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const res = await this.request('/rest/v1/', { method: 'HEAD' });
      return { healthy: res.ok, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  async query(table: string, params?: Record<string, string>): Promise<unknown[]> {
    const searchParams = new URLSearchParams(params);
    const queryString = searchParams.toString();
    const path = `/rest/v1/${table}${queryString ? `?${queryString}` : ''}`;

    const res = await this.request(path);
    if (!res.ok) {
      throw new Error(`Supabase query failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as unknown[];
  }

  async rpc(fn: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await this.request(`/rest/v1/rpc/${fn}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Supabase RPC failed: ${res.status} ${res.statusText}`);
    }
    return await res.json();
  }

  async edgeFunctionHealth(name: string): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.url}/functions/v1/${name}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.key}`,
        },
      });
      return { healthy: res.ok, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }
}
