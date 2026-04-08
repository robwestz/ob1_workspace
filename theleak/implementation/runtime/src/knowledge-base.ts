// =============================================================================
// OB1 Agentic Runtime -- Knowledge Base Client
// =============================================================================
// Structured document store that agents consult before making decisions.
// Uses Supabase REST API + pgvector for semantic search.
// Phase 1, Plan 3 — Knowledge Base System
// =============================================================================

export type KnowledgeCategory =
  | 'vision' | 'architecture' | 'process' | 'project'
  | 'customer' | 'operational' | 'learning';

export interface KnowledgeEntry {
  id: string;
  category: KnowledgeCategory;
  title: string;
  content: string;
  version: number;
  tags: string[];
  relevance_score: number;
  source?: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeSearchResult extends KnowledgeEntry {
  similarity: number;
  weighted_score: number;
}

export class KnowledgeBase {
  private readonly baseUrl: string;
  private readonly accessKey: string;
  private readonly timeout: number;

  constructor(supabaseUrl: string, accessKey: string, timeoutMs = 30_000) {
    this.baseUrl = supabaseUrl.replace(/\/+$/, '');
    this.accessKey = accessKey;
    this.timeout = timeoutMs;
  }

  /** Store a new knowledge entry. Returns the new entry's ID. */
  async store(
    entry: Omit<KnowledgeEntry, 'id' | 'version' | 'created_at' | 'updated_at'>,
  ): Promise<string> {
    const embedding = await this.generateEmbedding(entry.content);
    const body: Record<string, unknown> = {
      category: entry.category, title: entry.title, content: entry.content,
      tags: entry.tags, relevance_score: entry.relevance_score,
      source: entry.source ?? null,
    };
    if (embedding) body.embedding = embedding;
    const rows = await this.rest<Array<{ id: string }>>('POST', '/rest/v1/knowledge_base', body);
    return rows[0].id;
  }

  /** Retrieve knowledge entries by category, ordered by relevance_score desc. */
  async getByCategory(category: string, limit = 20): Promise<KnowledgeEntry[]> {
    const qs = `category=eq.${category}&order=relevance_score.desc,updated_at.desc&limit=${limit}&select=*`;
    const rows = await this.rest<KnowledgeEntry[]>('GET', `/rest/v1/knowledge_base?${qs}`);
    return this.filterLatest(rows);
  }

  /** Retrieve knowledge entries that contain ALL specified tags. */
  async getByTags(tags: string[], limit = 20): Promise<KnowledgeEntry[]> {
    const qs = `tags=cs.{${tags.join(',')}}&order=relevance_score.desc,updated_at.desc&limit=${limit}&select=*`;
    const rows = await this.rest<KnowledgeEntry[]>('GET', `/rest/v1/knowledge_base?${qs}`);
    return this.filterLatest(rows);
  }

  /** Semantic search via match_knowledge RPC. Falls back to text search without OPENAI_API_KEY. */
  async search(
    query: string,
    options?: { category?: string; limit?: number; threshold?: number },
  ): Promise<KnowledgeSearchResult[]> {
    const embedding = await this.generateEmbedding(query);
    if (!embedding) return this.textSearch(query, options);

    const body: Record<string, unknown> = {
      query_embedding: embedding,
      match_threshold: options?.threshold ?? 0.5,
      match_count: options?.limit ?? 10,
    };
    if (options?.category) body.filter_category = options.category;
    return this.rest<KnowledgeSearchResult[]>('POST', '/rest/v1/rpc/match_knowledge', body);
  }

  /** Update content — creates a new version that supersedes the old entry. Returns new ID. */
  async update(id: string, content: string): Promise<string> {
    const existing = await this.rest<KnowledgeEntry[]>('GET', `/rest/v1/knowledge_base?id=eq.${id}&select=*`);
    if (existing.length === 0) throw new Error(`Knowledge entry not found: ${id}`);

    const old = existing[0];
    const embedding = await this.generateEmbedding(content);
    const body: Record<string, unknown> = {
      category: old.category, title: old.title, content,
      version: old.version + 1, supersedes: old.id,
      tags: old.tags, relevance_score: old.relevance_score, source: old.source,
    };
    if (embedding) body.embedding = embedding;
    const rows = await this.rest<Array<{ id: string }>>('POST', '/rest/v1/knowledge_base', body);
    return rows[0].id;
  }

  /** Mark a knowledge entry as verified — agent confirmed it is still accurate. */
  async markVerified(id: string): Promise<void> {
    await this.rest('PATCH', `/rest/v1/knowledge_base?id=eq.${id}`, {
      last_verified_at: new Date().toISOString(),
    });
  }

  /** Get entries not verified in N days. Entries never verified are always included. */
  async getStale(daysSinceVerification: number): Promise<KnowledgeEntry[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysSinceVerification);
    const qs = `or=(last_verified_at.is.null,last_verified_at.lt.${cutoff.toISOString()})&order=last_verified_at.asc.nullsfirst&select=*`;
    const rows = await this.rest<KnowledgeEntry[]>('GET', `/rest/v1/knowledge_base?${qs}`);
    return this.filterLatest(rows);
  }

  /** Seed from local files. Returns count of entries created. */
  async seedFromFiles(
    files: Array<{ path: string; category: string; title: string; tags: string[] }>,
    readFile: (path: string) => Promise<string>,
  ): Promise<number> {
    let created = 0;
    for (const file of files) {
      try {
        const content = await readFile(file.path);
        await this.store({
          category: file.category as KnowledgeCategory,
          title: file.title, content, tags: file.tags,
          relevance_score: 1.0, source: file.path,
        });
        created++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[knowledge-base] Failed to seed "${file.path}": ${msg}`);
      }
    }
    return created;
  }

  // ---------------------------------------------------------------------------
  // Private: unified REST helper
  // ---------------------------------------------------------------------------

  private async rest<T = void>(method: string, path: string, body?: unknown): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessKey}`,
          apikey: this.accessKey,
          Prefer: 'return=representation',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${method} ${path} failed (${res.status}): ${text}`);
      }
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('json')) return (await res.json()) as T;
      return undefined as T;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: embedding generation
  // ---------------------------------------------------------------------------

  private async generateEmbedding(text: string): Promise<number[] | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) { console.error(`[knowledge-base] Embedding API returned ${res.status}`); return null; }
      const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
      return data.data[0]?.embedding ?? null;
    } catch (err) {
      clearTimeout(timer);
      console.error(`[knowledge-base] Embedding failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: version filtering & text fallback
  // ---------------------------------------------------------------------------

  private filterLatest(entries: KnowledgeEntry[]): KnowledgeEntry[] {
    const superseded = new Set<string>();
    for (const e of entries) {
      const s = (e as KnowledgeEntry & { supersedes?: string }).supersedes;
      if (s) superseded.add(s);
    }
    return entries.filter((e) => !superseded.has(e.id));
  }

  private async textSearch(
    query: string,
    options?: { category?: string; limit?: number },
  ): Promise<KnowledgeSearchResult[]> {
    let qs = `title=ilike.*${query}*&order=relevance_score.desc,updated_at.desc&limit=${options?.limit ?? 10}&select=*`;
    if (options?.category) qs += `&category=eq.${options.category}`;
    const rows = await this.rest<KnowledgeEntry[]>('GET', `/rest/v1/knowledge_base?${qs}`);
    return this.filterLatest(rows).map((e) => ({ ...e, similarity: 0, weighted_score: e.relevance_score }));
  }
}
