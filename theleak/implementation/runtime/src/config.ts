// =============================================================================
// OB1 Agentic Runtime -- Scoped Configuration System
// =============================================================================
// Loads configuration from 3 tiers (User -> Project -> Local) with deep merge
// and provenance tracking. Designed for the local MacBook runtime.
// =============================================================================

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type {
  ConfigScope,
  ConfigProvenance,
  ConfigSource,
  McpServerEntry,
  MergedConfig,
} from './types.js';

// ---------------------------------------------------------------------------
// Discovery paths
// ---------------------------------------------------------------------------

/** Default config file discovery order: 5 files, 3 scopes. */
const DEFAULT_SOURCES: ReadonlyArray<{ relative: string; scope: ConfigScope }> = [
  { relative: '~/.ob1/config.json', scope: 'user' },
  { relative: '.ob1/config.json', scope: 'project' },
  { relative: '.ob1/config.local.json', scope: 'local' },
];

// ---------------------------------------------------------------------------
// ScopedConfigLoader
// ---------------------------------------------------------------------------

/**
 * Loads configuration from the 3-tier hierarchy:
 *   1. User   (~/.ob1/config.json)
 *   2. Project (.ob1/config.json relative to project root)
 *   3. Local  (.ob1/config.local.json -- gitignored, machine-specific overrides)
 *
 * Later tiers override earlier ones. Every leaf value is tracked with provenance
 * so you can answer "where did this setting come from?" at runtime.
 */
export class ScopedConfigLoader {
  private readonly projectRoot: string;
  private readonly customSources: ReadonlyArray<{ relative: string; scope: ConfigScope }> | null;

  constructor(projectRoot: string, customSources?: ReadonlyArray<{ relative: string; scope: ConfigScope }>) {
    this.projectRoot = resolve(projectRoot);
    this.customSources = customSources ?? null;
  }

  /**
   * Load and merge all config tiers.
   * Never throws -- parse/IO errors are captured in `validationErrors`.
   */
  async load(): Promise<MergedConfig> {
    const sources = this.discoverSources();
    const layers: Array<{ data: Record<string, unknown>; source: ConfigSource }> = [];

    // Load each source file
    for (const source of sources) {
      try {
        const raw = await readFile(source.path, 'utf-8');
        const data = JSON.parse(raw) as Record<string, unknown>;
        source.exists = true;
        source.loaded = true;
        layers.push({ data, source });
      } catch (err: unknown) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'ENOENT') {
          source.exists = false;
          source.loaded = false;
        } else {
          source.exists = true;
          source.loaded = false;
          source.error = error.message ?? String(err);
        }
      }
    }

    // Deep merge with provenance tracking
    const merged: Record<string, unknown> = {};
    const provenance: Record<string, ConfigProvenance> = {};
    const allMcpServers = new Map<string, McpServerEntry>();
    const validationErrors: string[] = [];

    for (const { data, source } of layers) {
      this.deepMergeWithProvenance(
        merged,
        data,
        provenance,
        source.scope,
        source.path,
        '',
      );

      // Extract MCP servers for deduplication
      const servers = (data as Record<string, unknown>).mcpServers ??
        (data as Record<string, unknown>).mcp_servers;
      if (servers && typeof servers === 'object' && !Array.isArray(servers)) {
        for (const [name, serverConfig] of Object.entries(servers as Record<string, unknown>)) {
          const existing = allMcpServers.get(name);
          const cfg = serverConfig as Record<string, unknown> | null;
          const entry: McpServerEntry = {
            name,
            url: (cfg?.url as string) ?? '',
            scope: source.scope,
            headers: cfg?.headers as Record<string, string> | undefined,
          };

          if (existing) {
            entry.deduplicated_from = [
              ...(existing.deduplicated_from ?? [existing.scope]),
              source.scope,
            ];
          }

          allMcpServers.set(name, entry);
        }
      }
    }

    // Report source files with parse errors as validation errors
    for (const source of sources) {
      if (source.error) {
        validationErrors.push(
          `[${source.scope}] Failed to load ${source.path}: ${source.error}`,
        );
      }
    }

    return {
      config: merged,
      provenance,
      mcpServers: Array.from(allMcpServers.values()),
      sources,
      validationErrors,
    };
  }

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------

  /** Resolve ~ and relative paths into absolute paths. */
  private discoverSources(): ConfigSource[] {
    const templates = this.customSources ?? DEFAULT_SOURCES;
    return templates.map(({ relative, scope }) => {
      let path: string;
      if (relative.startsWith('~/') || relative.startsWith('~\\')) {
        path = join(homedir(), relative.slice(2));
      } else {
        path = join(this.projectRoot, relative);
      }
      return { path, scope, exists: false, loaded: false };
    });
  }

  // -------------------------------------------------------------------------
  // Deep merge with provenance
  // -------------------------------------------------------------------------

  /**
   * Deep-merge `source` into `target`, recording provenance for every leaf.
   * Objects are recursively merged. Arrays and primitives are replaced (last wins).
   */
  private deepMergeWithProvenance(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
    provenance: Record<string, ConfigProvenance>,
    scope: ConfigScope,
    file: string,
    prefix: string,
  ): void {
    for (const [key, value] of Object.entries(source)) {
      // MCP servers handled separately for deduplication
      if (key === 'mcpServers' || key === 'mcp_servers') continue;

      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        // Recursive merge for nested objects
        if (
          typeof target[key] !== 'object' ||
          target[key] === null ||
          Array.isArray(target[key])
        ) {
          target[key] = {};
        }
        this.deepMergeWithProvenance(
          target[key] as Record<string, unknown>,
          value as Record<string, unknown>,
          provenance,
          scope,
          file,
          fullKey,
        );
      } else {
        // Leaf value -- record provenance
        const existing = provenance[fullKey];
        if (existing) {
          existing.overridden_by = { scope, file };
        }
        provenance[fullKey] = { value, scope, file };
        target[key] = value;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience export
// ---------------------------------------------------------------------------

/**
 * Load the merged OB1 configuration for the given project root.
 * Defaults to the current working directory.
 *
 * @param projectRoot  Absolute path to the project root (defaults to cwd)
 */
export async function loadConfig(projectRoot?: string): Promise<MergedConfig> {
  const root = projectRoot ?? process.cwd();
  const loader = new ScopedConfigLoader(root);
  return loader.load();
}
