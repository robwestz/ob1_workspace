#!/usr/bin/env node
// =============================================================================
// OB1 Agentic Runtime -- Knowledge Base Seed Script
// =============================================================================
// Populates the knowledge base with initial structured documents from the
// OB1 repository: vision docs, architecture, escalation boundaries, process
// patterns, core beliefs, agent routing, and harness principles.
//
// Usage:
//   npx ts-node knowledge-base-seed.ts
//   node --loader ts-node/esm knowledge-base-seed.ts
//   npx tsx knowledge-base-seed.ts
//
// Requires environment variables:
//   SUPABASE_URL       — Supabase project URL
//   SUPABASE_KEY       — Supabase service-role key
//   OPENAI_API_KEY     — (optional) For embedding generation
//
// Phase 1, Plan 3 — Knowledge Base System
// =============================================================================

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KnowledgeBase } from './knowledge-base.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Seed entries: the initial knowledge that agents need
// ---------------------------------------------------------------------------

export const SEED_ENTRIES = [
  {
    path: '.planning/PROJECT.md',
    category: 'vision' as const,
    title: 'OB1 Control — Project Definition',
    tags: ['vision', 'requirements', 'scope'],
  },
  {
    path: 'ARCHITECTURE.md',
    category: 'architecture' as const,
    title: 'OB1 Domain Architecture — 7 Domains',
    tags: ['domains', 'layers', 'dependencies'],
  },
  {
    path: 'docs/design-docs/escalation-boundaries.md',
    category: 'process' as const,
    title: 'Escalation Boundaries — Autonomous vs Approval',
    tags: ['autonomy', 'approval', 'boundaries'],
  },
  {
    path: 'docs/design-docs/long-session-protocol.md',
    category: 'process' as const,
    title: 'Long Session Protocol — Wave Contract',
    tags: ['waves', 'overnight', 'protocol'],
  },
  {
    path: 'docs/design-docs/process-patterns.md',
    category: 'process' as const,
    title: 'Process Patterns — Doc Gardening, GC, Review',
    tags: ['maintenance', 'quality', 'review'],
  },
  {
    path: 'docs/design-docs/core-beliefs.md',
    category: 'vision' as const,
    title: 'Core Beliefs — Agent-First Engineering',
    tags: ['principles', 'beliefs', 'agent-first'],
  },
  {
    path: 'AGENTS.md',
    category: 'operational' as const,
    title: 'Agent Routing Table — 5 Rules, Domain Map',
    tags: ['routing', 'rules', 'navigation'],
  },
  {
    path: '.harness/principles.yml',
    category: 'process' as const,
    title: '8 Golden Principles with Violation Messages',
    tags: ['principles', 'enforcement', 'golden-rules'],
  },
];

// ---------------------------------------------------------------------------
// Seed function
// ---------------------------------------------------------------------------

/**
 * Seed the knowledge base with initial documents from the repository.
 *
 * @param kb          KnowledgeBase client instance
 * @param repoRoot    Absolute path to the OB1 repository root
 * @returns           Count of entries successfully created
 */
export async function seedKnowledgeBase(
  kb: KnowledgeBase,
  repoRoot?: string,
): Promise<number> {
  const root = repoRoot ?? findRepoRoot();

  console.log(`[seed] Repository root: ${root}`);
  console.log(`[seed] Seeding ${SEED_ENTRIES.length} knowledge entries...`);

  const readFileFromDisk = async (relativePath: string): Promise<string> => {
    const absolutePath = join(root, relativePath);
    return readFile(absolutePath, 'utf-8');
  };

  const created = await kb.seedFromFiles(SEED_ENTRIES, readFileFromDisk);

  console.log(`[seed] Complete: ${created}/${SEED_ENTRIES.length} entries created`);

  if (created < SEED_ENTRIES.length) {
    console.warn(
      `[seed] ${SEED_ENTRIES.length - created} entries failed — check logs above`,
    );
  }

  return created;
}

// ---------------------------------------------------------------------------
// Repo root discovery
// ---------------------------------------------------------------------------

/**
 * Find the OB1 repository root by walking up from __dirname or cwd.
 * Looks for ARCHITECTURE.md as the marker file.
 */
function findRepoRoot(): string {
  // Try common locations
  const candidates = [
    // Running from runtime/src/ or runtime/dist/
    resolve(__dirname, '..', '..', '..', '..'),
    // Running from runtime/
    resolve(__dirname, '..', '..', '..'),
    // Running from repo root
    resolve('.'),
    // Windows default
    'D:/OB1',
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'ARCHITECTURE.md'))) {
      return candidate;
    }
  }

  // Fall back to cwd
  return process.cwd();
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('[seed] Missing required environment variables:');
    if (!supabaseUrl) console.error('  - SUPABASE_URL');
    if (!supabaseKey) console.error('  - SUPABASE_KEY');
    console.error('');
    console.error('Usage:');
    console.error('  SUPABASE_URL=https://xyz.supabase.co \\');
    console.error('  SUPABASE_KEY=your-service-role-key \\');
    console.error('  OPENAI_API_KEY=sk-... \\');
    console.error('  npx tsx knowledge-base-seed.ts');
    process.exit(1);
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      '[seed] OPENAI_API_KEY not set — entries will be stored without embeddings.',
    );
    console.warn(
      '[seed] Semantic search will fall back to text-based search.',
    );
    console.warn('');
  }

  const kb = new KnowledgeBase(supabaseUrl, supabaseKey);
  const repoRoot = process.env.OB1_REPO_ROOT ?? undefined;

  try {
    const count = await seedKnowledgeBase(kb, repoRoot);
    console.log(`\n[seed] Done. ${count} entries seeded.`);
    process.exit(count > 0 ? 0 : 1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[seed] Fatal error: ${msg}`);
    process.exit(1);
  }
}

// Run if executed directly (ESM entry point detection)
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('knowledge-base-seed') ||
    process.argv[1].endsWith('seed'));

if (isDirectRun) {
  main();
}
