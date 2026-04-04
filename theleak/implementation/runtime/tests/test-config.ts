// =============================================================================
// Unit Tests — ScopedConfigLoader
// =============================================================================

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ScopedConfigLoader } from '../src/config.js';
import type { ConfigScope } from '../src/types.js';

// ---------------------------------------------------------------------------
// Test scaffold
//
// The ScopedConfigLoader discovers files in two ways:
//   - Paths starting with ~/ are resolved from homedir()
//   - All other paths are resolved relative to projectRoot
//
// For testing we use customSources with paths relative to a temp directory
// that acts as the projectRoot. This avoids touching the real home directory.
// ---------------------------------------------------------------------------

let testDir: string;

/** Write a JSON file, creating parent dirs as needed. */
async function writeJson(filepath: string, data: unknown): Promise<void> {
  const dir = filepath.replace(/[\\/][^\\/]+$/, '');
  await mkdir(dir, { recursive: true });
  await writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Build a ScopedConfigLoader using the temp test directory as project root.
 *
 * Custom sources use paths relative to testDir (the project root) so that
 * discoverSources' `join(projectRoot, relative)` resolves correctly.
 */
function buildLoader(): ScopedConfigLoader {
  const sources: Array<{ relative: string; scope: ConfigScope }> = [
    { relative: 'user/config.json', scope: 'user' },
    { relative: 'project/config.json', scope: 'project' },
    { relative: 'local/config.local.json', scope: 'local' },
  ];

  return new ScopedConfigLoader(testDir, sources);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function setup() {
  testDir = join(tmpdir(), `ob1-config-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(testDir, { recursive: true });
}

async function cleanup() {
  await rm(testDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScopedConfigLoader', () => {
  beforeEach(async () => {
    await setup();
  });

  afterEach(async () => {
    await cleanup();
  });

  // ---- Loads user config -------------------------------------------

  it('loads user config from ~/.ob1/config.json', async () => {
    await writeJson(join(testDir, 'user', 'config.json'), {
      model: 'sonnet',
      maxTurns: 50,
    });

    const loader = buildLoader();
    const result = await loader.load();

    assert.equal(result.config.model, 'sonnet');
    assert.equal(result.config.maxTurns, 50);
  });

  // ---- Project overrides user ---------------------------------------

  it('project config overrides user config', async () => {
    await writeJson(join(testDir, 'user', 'config.json'), {
      model: 'sonnet',
      maxTurns: 50,
    });
    await writeJson(join(testDir, 'project', 'config.json'), {
      model: 'haiku',
    });

    const loader = buildLoader();
    const result = await loader.load();

    assert.equal(result.config.model, 'haiku');
    // maxTurns from user scope is preserved
    assert.equal(result.config.maxTurns, 50);
  });

  // ---- Local overrides project --------------------------------------

  it('local config overrides project config', async () => {
    await writeJson(join(testDir, 'user', 'config.json'), {
      model: 'sonnet',
    });
    await writeJson(join(testDir, 'project', 'config.json'), {
      model: 'haiku',
      debug: false,
    });
    await writeJson(join(testDir, 'local', 'config.local.json'), {
      model: 'opus',
    });

    const loader = buildLoader();
    const result = await loader.load();

    assert.equal(result.config.model, 'opus');
    // debug from project scope is preserved
    assert.equal(result.config.debug, false);
  });

  // ---- Deep merge ---------------------------------------------------

  it('deep merge works for nested objects', async () => {
    await writeJson(join(testDir, 'user', 'config.json'), {
      budget: {
        max_turns: 50,
        max_tokens: 100_000,
      },
    });
    await writeJson(join(testDir, 'project', 'config.json'), {
      budget: {
        max_turns: 20,
        compact_after: 10,
      },
    });

    const loader = buildLoader();
    const result = await loader.load();

    const budget = result.config.budget as Record<string, unknown>;
    // project overrides max_turns
    assert.equal(budget.max_turns, 20);
    // user's max_tokens is preserved
    assert.equal(budget.max_tokens, 100_000);
    // project adds compact_after
    assert.equal(budget.compact_after, 10);
  });

  // ---- Provenance tracking ------------------------------------------

  it('provenance tracks which scope provided each value', async () => {
    await writeJson(join(testDir, 'user', 'config.json'), {
      model: 'sonnet',
      color: 'blue',
    });
    await writeJson(join(testDir, 'project', 'config.json'), {
      model: 'haiku',
    });

    const loader = buildLoader();
    const result = await loader.load();

    // 'model' was set by user, then overridden by project
    const modelProv = result.provenance['model'];
    assert.ok(modelProv, 'provenance for "model" should exist');
    assert.equal(modelProv.scope, 'project');
    assert.equal(modelProv.value, 'haiku');

    // 'color' was only set by user
    const colorProv = result.provenance['color'];
    assert.ok(colorProv, 'provenance for "color" should exist');
    assert.equal(colorProv.scope, 'user');
    assert.equal(colorProv.value, 'blue');
  });

  // ---- MCP server deduplication -------------------------------------

  it('MCP servers are deduplicated by name (last scope wins)', async () => {
    await writeJson(join(testDir, 'user', 'config.json'), {
      mcpServers: {
        supabase: {
          url: 'https://user.supabase.co/functions/v1/mcp',
          headers: { Authorization: 'Bearer user-token' },
        },
        github: {
          url: 'https://github.mcp.example.com',
        },
      },
    });
    await writeJson(join(testDir, 'project', 'config.json'), {
      mcpServers: {
        supabase: {
          url: 'https://project.supabase.co/functions/v1/mcp',
          headers: { Authorization: 'Bearer project-token' },
        },
      },
    });

    const loader = buildLoader();
    const result = await loader.load();

    // Two unique server names
    assert.equal(result.mcpServers.length, 2);

    const supabase = result.mcpServers.find(s => s.name === 'supabase');
    assert.ok(supabase, 'supabase server should be present');
    // Project scope wins (last scope)
    assert.equal(supabase.url, 'https://project.supabase.co/functions/v1/mcp');
    assert.equal(supabase.scope, 'project');
    assert.ok(
      supabase.deduplicated_from,
      'deduplicated_from should be populated when overridden',
    );

    const github = result.mcpServers.find(s => s.name === 'github');
    assert.ok(github, 'github server should be present');
    assert.equal(github.url, 'https://github.mcp.example.com');
    assert.equal(github.scope, 'user');
  });

  // ---- Missing files are non-fatal ----------------------------------

  it('handles missing config files gracefully', async () => {
    // No files written -- all sources are ENOENT
    const loader = buildLoader();
    const result = await loader.load();

    assert.deepEqual(result.config, {});
    assert.deepEqual(result.mcpServers, []);
    assert.equal(result.validationErrors.length, 0);
  });

  // ---- Malformed JSON is captured as validation error ----------------

  it('captures parse errors as validation errors', async () => {
    const dir = join(testDir, 'user');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'config.json'),
      '{ broken json !!!',
      'utf-8',
    );

    const loader = buildLoader();
    const result = await loader.load();

    assert.ok(result.validationErrors.length >= 1);
    assert.ok(result.validationErrors[0].includes('[user]'));
  });
});
