# Blueprint 08: Skills & Extensibility

> Primitive #18 (Skills & Extensibility) for the OB1 agentic architecture.
>
> Status: IMPLEMENTATION BLUEPRINT
> Date: 2026-04-03
> Depends on:
>   - Blueprint 01 (Tool Registry & Permissions) -- skills register tools, permissions gate hook execution
>   - Blueprint 02 (State & Budget) -- session context drives skill routing
>   - Blueprint 03 (Streaming, Logging, Verification) -- hook audit events logged to system_events
>   - Blueprint 05 (Doctor & Boot) -- skills discovered and loaded during boot, config hierarchy governs hooks

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Database Schema](#2-database-schema)
3. [Skill System Architecture](#3-skill-system-architecture)
4. [Hook Architecture](#4-hook-architecture)
5. [Plugin System](#5-plugin-system)
6. [Skill Creation & Distribution](#6-skill-creation--distribution)
7. [OB1 Integration](#7-ob1-integration)
8. [Edge Function Endpoints](#8-edge-function-endpoints)
9. [Build Order](#9-build-order)
10. [File Map](#10-file-map)

---

## 1. Architecture Overview

The Skills & Extensibility layer is the top of the agentic architecture stack. Everything below it (tools, permissions, state, streaming, config, boot) provides infrastructure. This layer provides _behavior_: what the agent can do, how it reacts to tool execution, and how third parties extend it.

Three subsystems compose this layer:

```
+-----------------------------------------------------------------------+
|                        Skills & Extensibility                         |
|                                                                       |
|  1. Skill System                                                      |
|     Definition, discovery, routing, execution                         |
|     Sources: bundled, user-defined (.claude/skills/), OB1 Supabase    |
|                                                                       |
|  2. Hook System                                                       |
|     Pre/post tool execution hooks (shell-based, any language)         |
|     JSON payload on stdin, exit codes control flow                    |
|     Integrates after permission check, around tool execution          |
|                                                                       |
|  3. Plugin System                                                     |
|     Packages of skills + hooks + tools + config                       |
|     Trust tiers, lifecycle management, scoped permissions             |
+-----------------------------------+-----------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------+
|                    OB1 Supabase Persistence                           |
|                                                                       |
|  skill_registry      -- skill definitions with prompt templates       |
|  hook_configurations  -- registered hook commands per event           |
|  hook_execution_log   -- audit trail of every hook invocation         |
|  plugin_registry      -- installed plugins with trust tiers           |
|  tool_registry        -- tools registered by skills/plugins (BP01)    |
|  system_events        -- all events (BP03)                            |
|  thoughts             -- skill content synced for cross-device access |
+-----------------------------------------------------------------------+
```

### Data Flow: Skill Execution

```
User Message / Agent Turn
      |
      v
  Skill Router
      |-- Match message against skill triggers
      |-- Load matching skill definition(s)
      |-- Inject prompt template into system context
      |-- Resolve tool_requirements (register if missing)
      |
      v
  Tool Execution (with hooks)
      |
      +-- Permission Check (BP01)
      |     |
      |     v
      +-- Pre-Hook Pipeline
      |     |-- For each PreToolUse hook:
      |     |     pipe JSON to stdin, read exit code
      |     |-- Exit 2 from any hook -> DENY (short-circuit)
      |     |-- Exit 0 -> ALLOW, capture stdout as feedback
      |     |-- Exit 1 -> WARN, continue with warning
      |     |
      |     v
      +-- Tool Executor (BP01)
      |     |
      |     v
      +-- Post-Hook Pipeline
      |     |-- Same pattern, but tool_output available
      |     |-- Exit 2 -> mark result as error (too late to prevent)
      |     |
      |     v
      +-- Merge hook feedback into tool result
      |
      v
  Return to Conversation
```

### Key Insight: The 104-Hook Clarification

The reference codebase lists 104 modules under `hooks/`. Analysis reveals these are **not** 104 pre/post tool hooks. They break down as:

| Category | Count | What They Are |
|----------|-------|---------------|
| Tool Permission Hooks | 4 | `PermissionContext`, `coordinatorHandler`, `interactiveHandler`, `swarmWorkerHandler` |
| Permission Logging | 1 | `permissionLogging` |
| React UI Hooks | ~95 | `useAutoModeUnavailableNotification`, `useMcpConnectivityStatus`, etc. |
| UI Suggestion Hooks | 3 | `fileSuggestions`, `unifiedSuggestions`, `renderPlaceholder` |
| Lifecycle Hooks | 1 | `useAfterFirstRender` |

The shell-based hook system (PreToolUse / PostToolUse) is the **only** extensibility mechanism for external users. The React hooks are internal framework plumbing for the terminal UI. Our architecture implements the shell-based system and adds what the reference lacks: timeouts, conditional hooks, and observability.

---

## 2. Database Schema

Run these migrations after Blueprints 01-05 tables exist.

### 2.1 Skill Registry Table

```sql
-- Skill definitions: prompt templates, triggers, and tool requirements
CREATE TABLE skill_registry (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text NOT NULL,
  version text NOT NULL DEFAULT '1.0.0',

  -- Skill source: where this skill was loaded from
  source_type text NOT NULL CHECK (source_type IN ('bundled', 'user', 'ob1', 'mcp_generated')),
  -- For user skills: the file path on disk where the SKILL.md lives
  source_path text,
  -- For OB1 skills: the community skill slug from OB1/skills/
  ob1_slug text,

  -- The prompt template injected when this skill activates
  -- Supports {{variable}} interpolation from input_contract
  prompt_template text NOT NULL,

  -- Trigger conditions (evaluated by the skill router)
  trigger jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Trigger schema:
  -- {
  --   "phrases": ["pan for gold", "brain dump"],
  --   "file_patterns": ["*.transcript", "*.dump"],
  --   "tool_context": ["after:bash", "before:write_file"],
  --   "always": false
  -- }

  -- What the skill expects as input
  input_contract jsonb DEFAULT '{}'::jsonb,
  -- Input contract schema:
  -- {
  --   "required": ["source_text"],
  --   "optional": ["output_format", "depth"],
  --   "defaults": {"output_format": "markdown", "depth": "standard"}
  -- }

  -- What the skill produces
  output_contract jsonb DEFAULT '{}'::jsonb,
  -- Output contract schema:
  -- {
  --   "produces": ["synthesis_file", "inventory_file"],
  --   "side_effects": ["writes_files", "captures_thoughts"]
  -- }

  -- Tools this skill needs in the tool pool to function
  tool_requirements text[] DEFAULT '{}',

  -- Plugin that owns this skill (NULL for standalone skills)
  plugin_id uuid REFERENCES plugin_registry(id) ON DELETE CASCADE,

  -- Trust tier inherited from source
  trust_tier text NOT NULL DEFAULT 'skill'
    CHECK (trust_tier IN ('built_in', 'plugin', 'skill')),

  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_skill_source ON skill_registry (source_type);
CREATE INDEX idx_skill_enabled ON skill_registry (enabled) WHERE enabled = true;
CREATE INDEX idx_skill_slug ON skill_registry (slug);
CREATE INDEX idx_skill_plugin ON skill_registry (plugin_id) WHERE plugin_id IS NOT NULL;

-- Full-text search on skill name + description for discovery
CREATE INDEX idx_skill_fts ON skill_registry
  USING gin(to_tsvector('english', name || ' ' || description));

CREATE TRIGGER skill_registry_updated_at
  BEFORE UPDATE ON skill_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

### 2.2 Hook Configurations Table

```sql
-- Hook commands registered per event type
CREATE TABLE hook_configurations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('PreToolUse', 'PostToolUse')),

  -- The shell command to execute
  command text NOT NULL,

  -- Optional: only run this hook for specific tools (empty = all tools)
  tool_filter text[] DEFAULT '{}',
  -- Example: {"bash", "write_file"} means only trigger for these tools

  -- Execution priority (lower = runs first)
  priority integer NOT NULL DEFAULT 100,

  -- Timeout in milliseconds (0 = no timeout, reference has none, we add this)
  timeout_ms integer NOT NULL DEFAULT 30000,

  -- Plugin that owns this hook (NULL for user-defined hooks)
  plugin_id uuid REFERENCES plugin_registry(id) ON DELETE CASCADE,

  -- Trust tier determines execution context
  trust_tier text NOT NULL DEFAULT 'skill'
    CHECK (trust_tier IN ('built_in', 'plugin', 'skill')),

  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_hook_event ON hook_configurations (event_type);
CREATE INDEX idx_hook_enabled ON hook_configurations (enabled) WHERE enabled = true;
CREATE INDEX idx_hook_plugin ON hook_configurations (plugin_id) WHERE plugin_id IS NOT NULL;

CREATE TRIGGER hook_configurations_updated_at
  BEFORE UPDATE ON hook_configurations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

### 2.3 Hook Execution Log Table

```sql
-- Audit trail of every hook invocation
CREATE TABLE hook_execution_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id text NOT NULL,
  hook_config_id uuid REFERENCES hook_configurations(id),
  event_type text NOT NULL,
  tool_name text NOT NULL,

  -- Outcome: what the hook decided
  outcome text NOT NULL CHECK (outcome IN ('allow', 'warn', 'deny', 'timeout', 'error')),
  exit_code integer,

  -- Hook feedback (stdout captured)
  feedback text,
  -- Error output (stderr captured)
  error_output text,

  -- Timing
  duration_ms integer NOT NULL,
  timed_out boolean NOT NULL DEFAULT false,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_hook_log_session ON hook_execution_log (session_id, created_at DESC);
CREATE INDEX idx_hook_log_tool ON hook_execution_log (tool_name, created_at DESC);
CREATE INDEX idx_hook_log_outcome ON hook_execution_log (outcome);
```

### 2.4 Plugin Registry Table

```sql
-- Installed plugins: packages of skills + hooks + tools + config
CREATE TABLE plugin_registry (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  description text,
  version text NOT NULL DEFAULT '1.0.0',
  author_name text,
  author_github text,

  -- Trust tier assigned at install time
  trust_tier text NOT NULL DEFAULT 'plugin'
    CHECK (trust_tier IN ('built_in', 'plugin')),

  -- Plugin state
  status text NOT NULL DEFAULT 'enabled'
    CHECK (status IN ('enabled', 'disabled', 'installing', 'error')),

  -- Scoped permissions: what this plugin's skills and hooks can do
  granted_permissions jsonb DEFAULT '{}'::jsonb,
  -- Schema:
  -- {
  --   "tools": ["bash", "write_file"],
  --   "hooks": ["PreToolUse", "PostToolUse"],
  --   "file_access": ["/project/**"],
  --   "network": false
  -- }

  -- Plugin manifest (full package.json-like definition)
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Where the plugin was installed from
  source_url text,

  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_plugin_status ON plugin_registry (status);
CREATE INDEX idx_plugin_trust ON plugin_registry (trust_tier);

CREATE TRIGGER plugin_registry_updated_at
  BEFORE UPDATE ON plugin_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

### 2.5 Grants

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.skill_registry TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hook_configurations TO service_role;
GRANT SELECT, INSERT ON TABLE public.hook_execution_log TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.plugin_registry TO service_role;
```

---

## 3. Skill System Architecture

### 3.1 Skill Definition

A skill is a named, triggerable behavior with a prompt template, tool requirements, and input/output contracts. Skills do not execute code themselves -- they inject context and instructions into the agent's system prompt, then the agent uses its existing tool set to carry out the work.

```typescript
// skills/types.ts

export interface SkillDefinition {
  id: string;
  name: string;
  slug: string;
  description: string;
  version: string;

  source_type: 'bundled' | 'user' | 'ob1' | 'mcp_generated';
  source_path?: string;  // Filesystem path for user skills
  ob1_slug?: string;     // OB1 community slug for synced skills

  prompt_template: string;
  trigger: SkillTrigger;
  input_contract: SkillInputContract;
  output_contract: SkillOutputContract;
  tool_requirements: string[];

  plugin_id?: string;
  trust_tier: 'built_in' | 'plugin' | 'skill';
  enabled: boolean;
  metadata: Record<string, unknown>;
}

export interface SkillTrigger {
  /** Phrases that activate this skill (fuzzy matched against user message) */
  phrases: string[];
  /** File patterns that activate this skill when present in context */
  file_patterns: string[];
  /** Tool context triggers: "after:bash" means activate after bash runs */
  tool_context: string[];
  /** If true, this skill is always active (injected into every turn) */
  always: boolean;
}

export interface SkillInputContract {
  required: string[];
  optional: string[];
  defaults: Record<string, unknown>;
}

export interface SkillOutputContract {
  produces: string[];
  side_effects: string[];
}
```

### 3.2 Three Skill Sources

Skills enter the system from three paths:

```
+------------------+     +---------------------+     +---------------------+
|  Bundled Skills  |     |  User-Defined Skills |     |  OB1 Community     |
|  (built-in)      |     |  (.claude/skills/)   |     |  (Supabase)        |
+--------+---------+     +---------+-----------+     +---------+-----------+
         |                         |                           |
         v                         v                           v
    Hard-coded in           Discovered at boot          Fetched via MCP
    source code             from filesystem             from OB1 server
         |                         |                           |
         +-------------------------+---------------------------+
                                   |
                                   v
                          Skill Registry (DB)
                          Unified query surface
```

**Bundled skills** are shipped with the agent. They have `trust_tier: 'built_in'` and cannot be disabled by plugins.

**User-defined skills** live in `.claude/skills/` as markdown files (matching the OB1 `SKILL.md` pattern). They are discovered during boot by scanning the directory tree. Each `.skill.md` or `SKILL.md` file is parsed for frontmatter (trigger, requirements) and body (prompt template).

**OB1 community skills** are fetched from the OB1 Supabase instance via MCP. They are cached locally and synced periodically. The `skills/` directory in the OB1 repo (panning-for-gold, auto-capture, claudeception, etc.) maps directly to this source.

A fourth implicit source exists: **MCP-generated skills**. When an MCP server connects, its tool definitions can be auto-wrapped into skills with generated triggers and prompt templates.

### 3.3 Skill Discovery and Loading

```typescript
// skills/skill-loader.ts

import { SkillDefinition, SkillTrigger } from './types';
import { parseFrontmatter } from '../util/frontmatter';

// Paths scanned at boot for user skills
const SKILL_DIRECTORIES = [
  '~/.claude/skills',       // User-global skills
  '.claude/skills',         // Project skills
  '.claude/skills.local',   // Local-only skills (gitignored)
];

const SKILL_FILE_PATTERNS = [
  'SKILL.md',
  '*.skill.md',
  '*-skill.md',
];

export class SkillLoader {
  /**
   * Discover all skills from all three sources.
   * Called during boot Phase 5 (after config, before workspace init).
   */
  async discoverAll(
    supabaseUrl: string,
    supabaseKey: string,
  ): Promise<SkillDefinition[]> {
    const [bundled, user, ob1] = await Promise.all([
      this.loadBundledSkills(),
      this.discoverUserSkills(),
      this.fetchOB1Skills(supabaseUrl, supabaseKey),
    ]);

    // Bundled skills win on slug collision; user skills override OB1 skills
    const merged = this.mergeBySlug(bundled, user, ob1);
    return merged;
  }

  /**
   * Scan filesystem directories for .skill.md and SKILL.md files.
   * Parse frontmatter for trigger/requirements, body becomes prompt_template.
   */
  async discoverUserSkills(): Promise<SkillDefinition[]> {
    const skills: SkillDefinition[] = [];

    for (const dir of SKILL_DIRECTORIES) {
      const resolvedDir = this.resolvePath(dir);
      if (!await this.directoryExists(resolvedDir)) continue;

      const files = await this.globSkillFiles(resolvedDir);
      for (const file of files) {
        try {
          const content = await this.readFile(file);
          const skill = this.parseSkillFile(content, file);
          skills.push(skill);
        } catch (err) {
          // Log warning but don't fail boot on a bad skill file
          console.warn(`[skill-loader] Failed to parse ${file}: ${err.message}`);
        }
      }
    }

    return skills;
  }

  /**
   * Parse a SKILL.md file into a SkillDefinition.
   *
   * Expected format:
   * ---
   * name: Panning for Gold
   * trigger: ["pan for gold", "brain dump"]
   * tools: [search_thoughts, capture_thought]
   * ---
   * # Prompt template body follows...
   */
  parseSkillFile(content: string, sourcePath: string): SkillDefinition {
    const { frontmatter, body } = parseFrontmatter(content);

    const slug = this.slugify(frontmatter.name ?? sourcePath);

    const trigger: SkillTrigger = {
      phrases: Array.isArray(frontmatter.trigger)
        ? frontmatter.trigger
        : typeof frontmatter.trigger === 'string'
          ? [frontmatter.trigger]
          : [],
      file_patterns: frontmatter.file_patterns ?? [],
      tool_context: frontmatter.tool_context ?? [],
      always: frontmatter.always ?? false,
    };

    return {
      id: crypto.randomUUID(),
      name: frontmatter.name ?? slug,
      slug,
      description: frontmatter.description ?? '',
      version: frontmatter.version ?? '1.0.0',
      source_type: 'user',
      source_path: sourcePath,
      prompt_template: body,
      trigger,
      input_contract: {
        required: frontmatter.input_required ?? [],
        optional: frontmatter.input_optional ?? [],
        defaults: frontmatter.input_defaults ?? {},
      },
      output_contract: {
        produces: frontmatter.produces ?? [],
        side_effects: frontmatter.side_effects ?? [],
      },
      tool_requirements: frontmatter.tools ?? [],
      trust_tier: 'skill',
      enabled: true,
      metadata: {},
    };
  }

  /**
   * Fetch skills from OB1 Supabase. These map to the OB1/skills/ directory
   * entries that have been synced to the database.
   */
  async fetchOB1Skills(
    supabaseUrl: string,
    supabaseKey: string,
  ): Promise<SkillDefinition[]> {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/ob1-skills?method=skills/list`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ enabled_only: true }),
      },
    );

    if (!response.ok) {
      console.warn('[skill-loader] Failed to fetch OB1 skills, using cached');
      return this.loadCachedOB1Skills();
    }

    const data = await response.json();
    // Cache for offline use
    await this.cacheOB1Skills(data.skills);
    return data.skills;
  }

  /**
   * Merge skills by slug. Priority: bundled > user > ob1.
   * Later sources only fill in slugs that earlier sources didn't claim.
   */
  private mergeBySlug(...sources: SkillDefinition[][]): SkillDefinition[] {
    const seen = new Map<string, SkillDefinition>();
    for (const source of sources) {
      for (const skill of source) {
        if (!seen.has(skill.slug)) {
          seen.set(skill.slug, skill);
        }
      }
    }
    return Array.from(seen.values());
  }

  private slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  private resolvePath(path: string): string {
    if (path.startsWith('~')) {
      return path.replace('~', process.env.HOME ?? process.env.USERPROFILE ?? '');
    }
    return path;
  }

  // File system helpers (implementation depends on runtime)
  private async directoryExists(path: string): Promise<boolean> { /* fs.stat */ return false; }
  private async globSkillFiles(dir: string): Promise<string[]> { /* glob */ return []; }
  private async readFile(path: string): Promise<string> { /* fs.readFile */ return ''; }
  private async loadCachedOB1Skills(): Promise<SkillDefinition[]> { return []; }
  private async cacheOB1Skills(skills: SkillDefinition[]): Promise<void> { /* write cache */ }
  private async loadBundledSkills(): Promise<SkillDefinition[]> { return []; }
}
```

### 3.4 Skill Router with Progressive Disclosure

The skill router evaluates every incoming message against registered skill triggers. It loads only matching skills into the system prompt, keeping context lean.

```typescript
// skills/skill-router.ts

import { SkillDefinition, SkillTrigger } from './types';

export interface SkillMatch {
  skill: SkillDefinition;
  match_reason: string;
  confidence: number;  // 0.0 - 1.0
}

export class SkillRouter {
  private skills: SkillDefinition[] = [];
  private alwaysActiveSkills: SkillDefinition[] = [];

  constructor(skills: SkillDefinition[]) {
    this.skills = skills.filter(s => s.enabled);
    this.alwaysActiveSkills = this.skills.filter(s => s.trigger.always);
  }

  /**
   * Route a user message to matching skills.
   * Returns skills sorted by confidence (highest first).
   *
   * Progressive disclosure: only matched skills are injected into context.
   * Always-active skills are always included but listed last.
   */
  route(
    userMessage: string,
    activeFiles: string[],
    recentToolUses: Array<{ tool_name: string }>,
  ): SkillMatch[] {
    const matches: SkillMatch[] = [];

    for (const skill of this.skills) {
      if (skill.trigger.always) continue; // handled separately

      const match = this.evaluateTrigger(
        skill, userMessage, activeFiles, recentToolUses,
      );
      if (match) {
        matches.push(match);
      }
    }

    // Sort by confidence descending
    matches.sort((a, b) => b.confidence - a.confidence);

    // Append always-active skills at the end
    for (const skill of this.alwaysActiveSkills) {
      matches.push({
        skill,
        match_reason: 'always_active',
        confidence: 1.0,
      });
    }

    return matches;
  }

  /**
   * Evaluate a skill's trigger against current context.
   * Returns null if no match.
   */
  private evaluateTrigger(
    skill: SkillDefinition,
    userMessage: string,
    activeFiles: string[],
    recentToolUses: Array<{ tool_name: string }>,
  ): SkillMatch | null {
    const messageLower = userMessage.toLowerCase();
    let bestConfidence = 0;
    let bestReason = '';

    // Check phrase triggers (fuzzy match)
    for (const phrase of skill.trigger.phrases) {
      if (messageLower.includes(phrase.toLowerCase())) {
        const confidence = phrase.length / messageLower.length;
        if (confidence > bestConfidence) {
          bestConfidence = Math.min(confidence * 2, 1.0); // Boost short phrases
          bestReason = `phrase:"${phrase}"`;
        }
      }
    }

    // Check file pattern triggers
    for (const pattern of skill.trigger.file_patterns) {
      for (const file of activeFiles) {
        if (this.matchGlob(file, pattern)) {
          const confidence = 0.8;
          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestReason = `file_pattern:"${pattern}" matched "${file}"`;
          }
        }
      }
    }

    // Check tool context triggers
    for (const ctx of skill.trigger.tool_context) {
      const [position, toolName] = ctx.split(':');
      if (position === 'after') {
        const used = recentToolUses.some(t => t.tool_name === toolName);
        if (used) {
          const confidence = 0.7;
          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestReason = `tool_context:"${ctx}"`;
          }
        }
      }
    }

    if (bestConfidence < 0.1) return null;

    return {
      skill,
      match_reason: bestReason,
      confidence: bestConfidence,
    };
  }

  /**
   * Build the skill injection for the system prompt.
   * Only injects matched skills, respecting a token budget.
   */
  buildInjection(
    matches: SkillMatch[],
    maxTokenBudget: number = 4000,
  ): string {
    if (matches.length === 0) return '';

    const sections: string[] = [];
    let estimatedTokens = 0;

    sections.push('## Active Skills\n');

    for (const match of matches) {
      const template = match.skill.prompt_template;
      const templateTokens = this.estimateTokens(template);

      if (estimatedTokens + templateTokens > maxTokenBudget) {
        sections.push(
          `\n_Skill "${match.skill.name}" available but deferred (token budget)._`,
        );
        continue;
      }

      sections.push(`### ${match.skill.name}\n`);
      sections.push(`_Activated by: ${match.match_reason}_\n`);
      sections.push(template);
      sections.push('');

      estimatedTokens += templateTokens;
    }

    return sections.join('\n');
  }

  /**
   * Ensure all tool requirements for matched skills are in the tool pool.
   * Returns tools that need to be dynamically loaded.
   */
  resolveToolRequirements(
    matches: SkillMatch[],
    currentPoolToolNames: Set<string>,
  ): string[] {
    const needed = new Set<string>();
    for (const match of matches) {
      for (const tool of match.skill.tool_requirements) {
        if (!currentPoolToolNames.has(tool)) {
          needed.add(tool);
        }
      }
    }
    return Array.from(needed);
  }

  private matchGlob(filename: string, pattern: string): boolean {
    // Simple glob: *.ext matching
    if (pattern.startsWith('*.')) {
      return filename.endsWith(pattern.slice(1));
    }
    return filename.includes(pattern);
  }

  private estimateTokens(text: string): number {
    // Rough estimate: 4 chars per token
    return Math.ceil(text.length / 4);
  }
}
```

### 3.5 How OB1's Existing skills/ Directory Maps to This System

The OB1 repository `skills/` directory contains community-contributed skill packs. Each follows the `README.md` + `metadata.json` + `SKILL.md` pattern. Here is the mapping:

| OB1 Pattern | System Mapping |
|-------------|---------------|
| `skills/panning-for-gold/SKILL.md` | Parsed into `SkillDefinition` with `source_type: 'ob1'` |
| `skills/panning-for-gold/metadata.json` | Populates `name`, `description`, `version`, `tags` fields |
| `skills/panning-for-gold/README.md` | Human documentation; not loaded into agent context |
| `metadata.json.requires.tools` | Maps to `tool_requirements` array |
| `metadata.json.tags` | Used for skill discovery search |
| `metadata.json.category: "skills"` | Confirms `source_type` mapping |

The `_template/` directory provides the canonical structure for new skills. When a user creates a skill via the system, it generates files matching this template.

```typescript
// skills/ob1-mapper.ts

import { SkillDefinition } from './types';

interface OB1Metadata {
  name: string;
  description: string;
  category: string;
  author: { name: string; github?: string };
  version: string;
  requires: { open_brain: boolean; services: string[]; tools: string[] };
  tags: string[];
  difficulty: string;
  estimated_time: string;
}

/**
 * Map an OB1 community skill (metadata.json + SKILL.md) into a SkillDefinition.
 */
export function mapOB1Skill(
  metadata: OB1Metadata,
  skillMarkdown: string,
  slug: string,
): SkillDefinition {
  const { frontmatter, body } = parseFrontmatter(skillMarkdown);

  return {
    id: crypto.randomUUID(),
    name: metadata.name,
    slug,
    description: metadata.description,
    version: metadata.version,
    source_type: 'ob1',
    ob1_slug: slug,
    prompt_template: body,
    trigger: {
      phrases: frontmatter.trigger ?? [],
      file_patterns: frontmatter.file_patterns ?? [],
      tool_context: frontmatter.tool_context ?? [],
      always: frontmatter.always ?? false,
    },
    input_contract: {
      required: frontmatter.input_required ?? [],
      optional: frontmatter.input_optional ?? [],
      defaults: frontmatter.input_defaults ?? {},
    },
    output_contract: {
      produces: frontmatter.produces ?? [],
      side_effects: frontmatter.side_effects ?? [],
    },
    tool_requirements: metadata.requires.tools,
    trust_tier: 'skill',
    enabled: true,
    metadata: {
      author: metadata.author,
      tags: metadata.tags,
      difficulty: metadata.difficulty,
      estimated_time: metadata.estimated_time,
    },
  };
}
```

---

## 4. Hook Architecture

### 4.1 The Real Hook System: PreToolUse / PostToolUse

The shell-based hook system intercepts tool execution at two points:
- **PreToolUse**: After permission check, before tool execution. Can block the tool.
- **PostToolUse**: After tool execution. Can mark the result as an error but cannot undo execution.

Hooks are shell commands. They receive a JSON payload on stdin, environment variables for quick access, and communicate decisions via exit codes. Any language works: bash, Python, Go, Rust, Node.js.

### 4.2 JSON Payload

```typescript
// hooks/types.ts

export interface HookPayload {
  hook_event_name: 'PreToolUse' | 'PostToolUse';
  tool_name: string;
  tool_input: Record<string, unknown> | { raw: string };
  tool_input_json: string;    // Always the raw string form
  tool_output: string | null; // Only set for PostToolUse
  tool_result_is_error: boolean;
}

export type HookEvent = 'PreToolUse' | 'PostToolUse';

export interface HookCommandOutcome {
  status: 'allow' | 'warn' | 'deny';
  message?: string;
  exit_code: number;
  duration_ms: number;
  timed_out: boolean;
}

export interface HookRunResult {
  denied: boolean;
  messages: string[];
  outcomes: HookCommandOutcome[];
}
```

### 4.3 Environment Variables

Every hook invocation sets these environment variables, providing quick access without JSON parsing:

| Variable | Value | Available |
|----------|-------|-----------|
| `HOOK_EVENT` | `"PreToolUse"` or `"PostToolUse"` | Always |
| `HOOK_TOOL_NAME` | Tool name (e.g., `"bash"`) | Always |
| `HOOK_TOOL_INPUT` | Raw tool input string | Always |
| `HOOK_TOOL_IS_ERROR` | `"0"` or `"1"` | Always |
| `HOOK_TOOL_OUTPUT` | Tool output string | PostToolUse only |

### 4.4 Exit Code Semantics

| Exit Code | Outcome | Behavior |
|-----------|---------|----------|
| 0 | Allow | Tool proceeds; stdout captured as feedback |
| 1 | Warn | Tool proceeds; warning message from stdout/stderr |
| 2 | Deny | Tool blocked (pre) or result marked error (post); stdout is denial message |
| Other | Warn | Tool proceeds with a crash/signal warning |
| Signal/Crash | Warn | Tool proceeds with termination warning |

### 4.5 Hook Runner Implementation

```typescript
// hooks/hook-runner.ts

import { spawn } from 'child_process';
import { HookPayload, HookEvent, HookCommandOutcome, HookRunResult } from './types';

interface HookConfig {
  command: string;
  tool_filter: string[];
  priority: number;
  timeout_ms: number;
  name: string;
}

export class HookRunner {
  private preToolUseHooks: HookConfig[] = [];
  private postToolUseHooks: HookConfig[] = [];

  constructor(hooks: HookConfig[], event: HookEvent) {
    const sorted = [...hooks]
      .filter(h => h.tool_filter.length === 0 || true) // filter applied per-call
      .sort((a, b) => a.priority - b.priority);

    // Separate by event type is done at construction from hook_configurations
  }

  static fromDatabaseConfigs(configs: Array<{
    name: string;
    event_type: string;
    command: string;
    tool_filter: string[];
    priority: number;
    timeout_ms: number;
  }>): { preRunner: HookRunner; postRunner: HookRunner } {
    const preHooks = configs
      .filter(c => c.event_type === 'PreToolUse')
      .sort((a, b) => a.priority - b.priority);
    const postHooks = configs
      .filter(c => c.event_type === 'PostToolUse')
      .sort((a, b) => a.priority - b.priority);

    return {
      preRunner: new HookRunner(preHooks, 'PreToolUse'),
      postRunner: new HookRunner(postHooks, 'PostToolUse'),
    };
  }

  /**
   * Run pre-tool hooks. First denial short-circuits.
   */
  async runPreToolUse(
    toolName: string,
    toolInput: string,
  ): Promise<HookRunResult> {
    return this.runHooks(
      'PreToolUse',
      this.preToolUseHooks,
      toolName,
      toolInput,
      null,
      false,
    );
  }

  /**
   * Run post-tool hooks. Denials mark result as error but cannot undo execution.
   */
  async runPostToolUse(
    toolName: string,
    toolInput: string,
    toolOutput: string,
    isError: boolean,
  ): Promise<HookRunResult> {
    return this.runHooks(
      'PostToolUse',
      this.postToolUseHooks,
      toolName,
      toolInput,
      toolOutput,
      isError,
    );
  }

  private async runHooks(
    event: HookEvent,
    hooks: HookConfig[],
    toolName: string,
    toolInput: string,
    toolOutput: string | null,
    isError: boolean,
  ): Promise<HookRunResult> {
    const messages: string[] = [];
    const outcomes: HookCommandOutcome[] = [];

    // Filter hooks by tool_filter
    const applicable = hooks.filter(
      h => h.tool_filter.length === 0 || h.tool_filter.includes(toolName),
    );

    for (const hook of applicable) {
      const outcome = await this.runCommand(
        hook, event, toolName, toolInput, toolOutput, isError,
      );
      outcomes.push(outcome);

      if (outcome.status === 'deny') {
        messages.push(outcome.message ?? `Hook "${hook.name}" denied execution`);
        return { denied: true, messages, outcomes }; // SHORT CIRCUIT
      }

      if (outcome.message) {
        messages.push(outcome.message);
      }
    }

    return { denied: false, messages, outcomes };
  }

  /**
   * Execute a single hook command with timeout.
   *
   * Key difference from reference: we add a configurable timeout.
   * The reference codebase has NO hook timeout -- a hanging hook
   * blocks the agent indefinitely. We default to 30 seconds.
   */
  private async runCommand(
    hook: HookConfig,
    event: HookEvent,
    toolName: string,
    toolInput: string,
    toolOutput: string | null,
    isError: boolean,
  ): Promise<HookCommandOutcome> {
    const start = Date.now();

    // Build JSON payload
    const payload = this.buildPayload(event, toolName, toolInput, toolOutput, isError);

    // Platform-aware shell dispatch
    const shell = process.platform === 'win32'
      ? { cmd: 'cmd', args: ['/C', hook.command] }
      : { cmd: 'sh', args: ['-lc', hook.command] };

    return new Promise<HookCommandOutcome>((resolve) => {
      const child = spawn(shell.cmd, shell.args, {
        env: {
          ...process.env,
          HOOK_EVENT: event,
          HOOK_TOOL_NAME: toolName,
          HOOK_TOOL_INPUT: toolInput,
          HOOK_TOOL_IS_ERROR: isError ? '1' : '0',
          ...(toolOutput !== null ? { HOOK_TOOL_OUTPUT: toolOutput } : {}),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      // TIMEOUT: Kill the hook process if it exceeds timeout_ms
      // This is a gap in the reference -- we add it.
      let timedOut = false;
      const timer = hook.timeout_ms > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            // Give it 5s to clean up, then SIGKILL
            setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
          }, hook.timeout_ms)
        : null;

      // Pipe JSON payload to stdin
      child.stdin.write(payload);
      child.stdin.end();

      child.on('close', (code: number | null) => {
        if (timer) clearTimeout(timer);
        const duration_ms = Date.now() - start;

        if (timedOut) {
          resolve({
            status: 'warn',
            message: `Hook "${hook.name}" timed out after ${hook.timeout_ms}ms`,
            exit_code: -1,
            duration_ms,
            timed_out: true,
          });
          return;
        }

        const message = stdout.trim() || stderr.trim() || undefined;

        switch (code) {
          case 0:
            resolve({ status: 'allow', message, exit_code: 0, duration_ms, timed_out: false });
            break;
          case 2:
            resolve({ status: 'deny', message, exit_code: 2, duration_ms, timed_out: false });
            break;
          default:
            resolve({
              status: 'warn',
              message: message ?? `Hook "${hook.name}" exited with code ${code}`,
              exit_code: code ?? -1,
              duration_ms,
              timed_out: false,
            });
            break;
        }
      });

      child.on('error', (err: Error) => {
        if (timer) clearTimeout(timer);
        resolve({
          status: 'warn',
          message: `Hook "${hook.name}" failed to spawn: ${err.message}`,
          exit_code: -1,
          duration_ms: Date.now() - start,
          timed_out: false,
        });
      });
    });
  }

  /**
   * Build the JSON payload sent to hook stdin.
   * Tool input is parsed as JSON if possible, wrapped in {"raw": ...} otherwise.
   */
  private buildPayload(
    event: HookEvent,
    toolName: string,
    toolInput: string,
    toolOutput: string | null,
    isError: boolean,
  ): string {
    let parsedInput: Record<string, unknown>;
    try {
      parsedInput = JSON.parse(toolInput);
    } catch {
      parsedInput = { raw: toolInput };
    }

    const payload: HookPayload = {
      hook_event_name: event,
      tool_name: toolName,
      tool_input: parsedInput,
      tool_input_json: toolInput,
      tool_output: toolOutput,
      tool_result_is_error: isError,
    };

    return JSON.stringify(payload);
  }
}
```

### 4.6 Integration Sequence

The hooks integrate into the agentic loop at precise points. The full sequence:

```
For each tool_use in pending_tool_uses:

  1. PERMISSION CHECK (BP01 PermissionPolicy.authorize)
     |
     +-- Denied? --> return tool_result with error, log to audit
     |
     v
  2. PRE-HOOK PIPELINE (HookRunner.runPreToolUse)
     |
     +-- For each PreToolUse hook (sorted by priority):
     |     a. Filter: does this hook apply to this tool? (tool_filter check)
     |     b. Spawn shell command with env vars
     |     c. Pipe JSON payload to stdin
     |     d. Wait for exit (with timeout)
     |     e. Interpret exit code
     |     f. If exit 2 (deny): SHORT CIRCUIT, return denial
     |     g. If exit 0/1: collect feedback, continue
     |
     +-- Any denial? --> return tool_result with denial message
     |
     v
  3. TOOL EXECUTION (BP01 ToolExecutor.execute)
     |
     v
  4. MERGE PRE-HOOK FEEDBACK
     |-- Prepend any pre-hook stdout to tool output
     |
     v
  5. POST-HOOK PIPELINE (HookRunner.runPostToolUse)
     |
     +-- Same pattern as pre-hooks, but:
     |     - tool_output is available in payload
     |     - Exit 2 marks result as error (cannot undo execution)
     |
     v
  6. MERGE POST-HOOK FEEDBACK
     |-- Append any post-hook stdout to tool output
     |-- If post-hook denied, set is_error = true
     |
     v
  7. LOG TO hook_execution_log (all outcomes)
     |
     v
  8. RETURN tool_result to conversation
```

```typescript
// runtime/hook-integration.ts

import { HookRunner, HookRunResult } from '../hooks/hook-runner';

/**
 * Merge hook feedback into tool output.
 * Matches the reference implementation pattern.
 */
export function mergeHookFeedback(
  hookMessages: string[],
  toolOutput: string,
  denied: boolean,
): string {
  if (hookMessages.length === 0) return toolOutput;

  const sections: string[] = [];

  if (toolOutput.trim().length > 0) {
    sections.push(toolOutput);
  }

  const label = denied ? 'Hook feedback (denied)' : 'Hook feedback';
  sections.push(`${label}:\n${hookMessages.join('\n')}`);

  return sections.join('\n\n');
}

/**
 * Full hook-integrated tool execution.
 * Called from ConversationRuntime.run_turn() after permission check passes.
 */
export async function executeWithHooks(
  toolName: string,
  toolInput: string,
  toolExecutor: { execute: (name: string, input: string) => Promise<{ output: string; is_error: boolean }> },
  hookRunner: { preRunner: HookRunner; postRunner: HookRunner },
  auditLogger: { log: (entry: HookAuditEntry) => Promise<void> },
  sessionId: string,
): Promise<{ output: string; is_error: boolean }> {
  // Step 2: Pre-hooks
  const preResult = await hookRunner.preRunner.runPreToolUse(toolName, toolInput);

  // Log all pre-hook outcomes
  for (const outcome of preResult.outcomes) {
    await auditLogger.log({
      session_id: sessionId,
      event_type: 'PreToolUse',
      tool_name: toolName,
      outcome: outcome.status,
      exit_code: outcome.exit_code,
      feedback: outcome.message ?? null,
      duration_ms: outcome.duration_ms,
      timed_out: outcome.timed_out,
    });
  }

  if (preResult.denied) {
    return {
      output: mergeHookFeedback(preResult.messages, '', true),
      is_error: true,
    };
  }

  // Step 3: Execute tool
  let { output, is_error } = await toolExecutor.execute(toolName, toolInput);

  // Step 4: Merge pre-hook feedback
  output = mergeHookFeedback(preResult.messages, output, false);

  // Step 5: Post-hooks
  const postResult = await hookRunner.postRunner.runPostToolUse(
    toolName, toolInput, output, is_error,
  );

  // Log all post-hook outcomes
  for (const outcome of postResult.outcomes) {
    await auditLogger.log({
      session_id: sessionId,
      event_type: 'PostToolUse',
      tool_name: toolName,
      outcome: outcome.status,
      exit_code: outcome.exit_code,
      feedback: outcome.message ?? null,
      duration_ms: outcome.duration_ms,
      timed_out: outcome.timed_out,
    });
  }

  // Step 6: Merge post-hook feedback
  if (postResult.denied) {
    is_error = true;
  }
  output = mergeHookFeedback(postResult.messages, output, postResult.denied);

  return { output, is_error };
}

interface HookAuditEntry {
  session_id: string;
  event_type: string;
  tool_name: string;
  outcome: string;
  exit_code: number;
  feedback: string | null;
  duration_ms: number;
  timed_out: boolean;
}
```

### 4.7 Hook Configuration Sources

Hooks can be configured from three places, merged using the scoped config system (BP05):

```typescript
// hooks/hook-config-loader.ts

interface HookConfigSource {
  /** From settings.json (matches reference pattern) */
  fromSettings(settings: {
    hooks?: {
      PreToolUse?: string[];
      PostToolUse?: string[];
    };
  }): HookConfig[];

  /** From hook_configurations table (OB1 persistence) */
  fromDatabase(configs: DatabaseHookConfig[]): HookConfig[];

  /** From plugin manifests */
  fromPlugin(pluginId: string, manifest: PluginManifest): HookConfig[];
}

/**
 * settings.json hook format (matches the reference codebase):
 *
 * {
 *   "hooks": {
 *     "PreToolUse": ["./security-check.sh", "python3 audit.py"],
 *     "PostToolUse": ["./log-execution.sh"]
 *   }
 * }
 *
 * These are loaded as HookConfigs with default priority (100) and timeout (30s).
 * Database configs can override priority and timeout.
 */
export function loadHooksFromSettings(settings: Record<string, unknown>): HookConfig[] {
  const hooks = (settings as any)?.hooks ?? {};
  const configs: HookConfig[] = [];

  for (const command of (hooks.PreToolUse ?? [])) {
    configs.push({
      name: `settings:pre:${command}`,
      command,
      tool_filter: [],
      priority: 100,
      timeout_ms: 30000,
    });
  }

  for (const command of (hooks.PostToolUse ?? [])) {
    configs.push({
      name: `settings:post:${command}`,
      command,
      tool_filter: [],
      priority: 100,
      timeout_ms: 30000,
    });
  }

  return configs;
}
```

### 4.8 Example Hook Scripts

**Security guardrail (blocks dangerous bash commands):**

```bash
#!/bin/bash
# hooks/security-check.sh
# PreToolUse hook: deny dangerous commands

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r .tool_name)

if [[ "$TOOL" == "bash" ]]; then
  CMD=$(echo "$INPUT" | jq -r .tool_input.command)

  # Block destructive patterns
  if [[ "$CMD" == *"rm -rf /"* ]] || \
     [[ "$CMD" == *"DROP TABLE"* ]] || \
     [[ "$CMD" == *"DROP DATABASE"* ]] || \
     [[ "$CMD" == *"TRUNCATE"* ]]; then
    echo "BLOCKED: Destructive command detected: $CMD" >&2
    exit 2  # DENY
  fi
fi

exit 0  # ALLOW
```

**Audit logger (records every tool execution):**

```bash
#!/bin/bash
# hooks/audit-log.sh
# PostToolUse hook: log every execution to a file

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r .tool_name)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
IS_ERROR=$(echo "$INPUT" | jq -r .tool_result_is_error)

echo "$TIMESTAMP | tool=$TOOL | error=$IS_ERROR" >> ~/.claude/audit.log
exit 0  # ALLOW (just logging, never block)
```

**Python cost control hook:**

```python
#!/usr/bin/env python3
# hooks/cost-control.py
# PreToolUse hook: block after budget exceeded

import json
import sys
import os

payload = json.load(sys.stdin)
budget_file = os.path.expanduser("~/.claude/budget.json")

try:
    with open(budget_file) as f:
        budget = json.load(f)

    if budget.get("remaining_cents", 100) <= 0:
        print(f"Budget exhausted. Remaining: ${budget['remaining_cents']/100:.2f}")
        sys.exit(2)  # DENY
except FileNotFoundError:
    pass  # No budget file = no limit

sys.exit(0)  # ALLOW
```

---

## 5. Plugin System

### 5.1 Plugin as a Package

A plugin is a distributable package that bundles related skills, hooks, tools, and configuration into a single installable unit.

```typescript
// plugins/types.ts

export interface PluginManifest {
  name: string;
  slug: string;
  version: string;
  description: string;
  author: {
    name: string;
    github?: string;
  };

  /** Skills this plugin provides */
  skills: PluginSkillEntry[];

  /** Hooks this plugin registers */
  hooks: PluginHookEntry[];

  /** Tools this plugin registers (via BP01 tool_registry) */
  tools: PluginToolEntry[];

  /** Permissions this plugin requests */
  permissions: PluginPermissions;

  /** Configuration schema this plugin contributes */
  config_schema?: Record<string, unknown>;
}

export interface PluginSkillEntry {
  slug: string;
  skill_file: string;  // Relative path to SKILL.md within plugin package
}

export interface PluginHookEntry {
  name: string;
  event_type: 'PreToolUse' | 'PostToolUse';
  command: string;
  tool_filter: string[];
  priority: number;
  timeout_ms: number;
}

export interface PluginToolEntry {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  required_permission: string;
  handler: string;  // Relative path to handler script within plugin
}

export interface PluginPermissions {
  tools: string[];                // Tools the plugin's skills/hooks can interact with
  hooks: ('PreToolUse' | 'PostToolUse')[];
  file_access: string[];          // Glob patterns for file access
  network: boolean;               // Whether the plugin can make network requests
}
```

### 5.2 Plugin Trust Tiers

Three trust tiers determine what a plugin's components can do:

```
+-------------------+------------------+-------------------+
|    Built-in       |    Plugin         |    Skill          |
|    (highest)      |    (medium)       |    (lowest)       |
+-------------------+------------------+-------------------+
| Shipped with      | Installed from    | User-defined or   |
| agent source      | verified source   | community SKILL.md|
|                   |                   |                   |
| All permissions   | Scoped to         | Prompt injection  |
| Full tool access  | granted_perms     | only. No hooks,   |
| Can register      | Can register      | no tool reg.      |
| hooks & tools     | hooks & tools     | Cannot register   |
|                   | within scope      | hooks or tools.   |
|                   |                   |                   |
| Cannot disable    | Can be disabled   | Can be disabled   |
| Cannot uninstall  | Can be uninstalled| Can be removed    |
+-------------------+------------------+-------------------+
```

### 5.3 Plugin Lifecycle

```typescript
// plugins/plugin-manager.ts

import { PluginManifest } from './types';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type PluginStatus = 'enabled' | 'disabled' | 'installing' | 'error';

export class PluginManager {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Install a plugin from a manifest.
   * Registers skills, hooks, and tools in their respective tables.
   */
  async install(manifest: PluginManifest, sourceUrl?: string): Promise<string> {
    // 1. Validate manifest
    this.validateManifest(manifest);

    // 2. Check for conflicts (name/slug collision)
    const existing = await this.getBySlug(manifest.slug);
    if (existing) {
      throw new Error(`Plugin "${manifest.slug}" already installed (v${existing.version})`);
    }

    // 3. Insert into plugin_registry
    const { data: plugin, error } = await this.supabase
      .from('plugin_registry')
      .insert({
        name: manifest.name,
        slug: manifest.slug,
        description: manifest.description,
        version: manifest.version,
        author_name: manifest.author.name,
        author_github: manifest.author.github,
        trust_tier: 'plugin',
        status: 'installing',
        granted_permissions: manifest.permissions,
        manifest,
        source_url: sourceUrl,
      })
      .select('id')
      .single();

    if (error) throw new Error(`Failed to register plugin: ${error.message}`);
    const pluginId = plugin.id;

    try {
      // 4. Register skills
      for (const skillEntry of manifest.skills) {
        await this.registerPluginSkill(pluginId, skillEntry, manifest);
      }

      // 5. Register hooks
      for (const hookEntry of manifest.hooks) {
        await this.registerPluginHook(pluginId, hookEntry);
      }

      // 6. Register tools (via BP01 tool_registry)
      for (const toolEntry of manifest.tools) {
        await this.registerPluginTool(pluginId, toolEntry);
      }

      // 7. Mark as enabled
      await this.supabase
        .from('plugin_registry')
        .update({ status: 'enabled' })
        .eq('id', pluginId);

      return pluginId;
    } catch (err) {
      // Rollback: mark as error, cascading delete will clean up children
      await this.supabase
        .from('plugin_registry')
        .update({ status: 'error', metadata: { install_error: err.message } })
        .eq('id', pluginId);
      throw err;
    }
  }

  /**
   * Enable a disabled plugin. Reactivates its skills and hooks.
   */
  async enable(pluginSlug: string): Promise<void> {
    const plugin = await this.getBySlug(pluginSlug);
    if (!plugin) throw new Error(`Plugin "${pluginSlug}" not found`);

    // Enable all plugin's skills
    await this.supabase
      .from('skill_registry')
      .update({ enabled: true })
      .eq('plugin_id', plugin.id);

    // Enable all plugin's hooks
    await this.supabase
      .from('hook_configurations')
      .update({ enabled: true })
      .eq('plugin_id', plugin.id);

    // Enable all plugin's tools
    await this.supabase
      .from('tool_registry')
      .update({ enabled: true })
      .match({ metadata: { plugin_id: plugin.id } });

    // Update plugin status
    await this.supabase
      .from('plugin_registry')
      .update({ status: 'enabled' })
      .eq('id', plugin.id);
  }

  /**
   * Disable a plugin. Deactivates its skills, hooks, and tools without removing them.
   */
  async disable(pluginSlug: string): Promise<void> {
    const plugin = await this.getBySlug(pluginSlug);
    if (!plugin) throw new Error(`Plugin "${pluginSlug}" not found`);
    if (plugin.trust_tier === 'built_in') {
      throw new Error('Built-in plugins cannot be disabled');
    }

    // Disable all plugin's skills
    await this.supabase
      .from('skill_registry')
      .update({ enabled: false })
      .eq('plugin_id', plugin.id);

    // Disable all plugin's hooks
    await this.supabase
      .from('hook_configurations')
      .update({ enabled: false })
      .eq('plugin_id', plugin.id);

    // Update plugin status
    await this.supabase
      .from('plugin_registry')
      .update({ status: 'disabled' })
      .eq('id', plugin.id);
  }

  /**
   * Uninstall a plugin. Removes all associated skills, hooks, and tools.
   * CASCADE on plugin_id foreign key handles cleanup.
   */
  async uninstall(pluginSlug: string): Promise<void> {
    const plugin = await this.getBySlug(pluginSlug);
    if (!plugin) throw new Error(`Plugin "${pluginSlug}" not found`);
    if (plugin.trust_tier === 'built_in') {
      throw new Error('Built-in plugins cannot be uninstalled');
    }

    // CASCADE will remove associated skills and hooks
    await this.supabase
      .from('plugin_registry')
      .delete()
      .eq('id', plugin.id);
  }

  /**
   * List all installed plugins with their status.
   */
  async list(): Promise<Array<{
    name: string;
    slug: string;
    version: string;
    status: PluginStatus;
    trust_tier: string;
    skill_count: number;
    hook_count: number;
  }>> {
    const { data: plugins } = await this.supabase
      .from('plugin_registry')
      .select('*')
      .order('name');

    if (!plugins) return [];

    const result = [];
    for (const p of plugins) {
      const { count: skillCount } = await this.supabase
        .from('skill_registry')
        .select('id', { count: 'exact', head: true })
        .eq('plugin_id', p.id);

      const { count: hookCount } = await this.supabase
        .from('hook_configurations')
        .select('id', { count: 'exact', head: true })
        .eq('plugin_id', p.id);

      result.push({
        name: p.name,
        slug: p.slug,
        version: p.version,
        status: p.status as PluginStatus,
        trust_tier: p.trust_tier,
        skill_count: skillCount ?? 0,
        hook_count: hookCount ?? 0,
      });
    }

    return result;
  }

  // --- Private helpers ---

  private async registerPluginSkill(
    pluginId: string,
    entry: { slug: string; skill_file: string },
    manifest: PluginManifest,
  ): Promise<void> {
    // Read and parse the skill file from the plugin package
    // In production, skill_file is a path relative to the plugin archive
    const skillContent = await this.readPluginFile(entry.skill_file, manifest);
    const parsed = this.parseSkillFile(skillContent);

    await this.supabase.from('skill_registry').insert({
      name: parsed.name,
      slug: entry.slug,
      description: parsed.description,
      version: manifest.version,
      source_type: 'user',
      prompt_template: parsed.prompt_template,
      trigger: parsed.trigger,
      input_contract: parsed.input_contract,
      output_contract: parsed.output_contract,
      tool_requirements: parsed.tool_requirements,
      plugin_id: pluginId,
      trust_tier: 'plugin',
    });
  }

  private async registerPluginHook(
    pluginId: string,
    entry: PluginManifest['hooks'][number],
  ): Promise<void> {
    await this.supabase.from('hook_configurations').insert({
      name: entry.name,
      event_type: entry.event_type,
      command: entry.command,
      tool_filter: entry.tool_filter,
      priority: entry.priority,
      timeout_ms: entry.timeout_ms,
      plugin_id: pluginId,
      trust_tier: 'plugin',
    });
  }

  private async registerPluginTool(
    pluginId: string,
    entry: PluginManifest['tools'][number],
  ): Promise<void> {
    await this.supabase.from('tool_registry').insert({
      name: entry.name,
      description: entry.description,
      source_type: 'plugin',
      required_permission: entry.required_permission,
      input_schema: entry.input_schema,
      metadata: { plugin_id: pluginId },
    });
  }

  private async getBySlug(slug: string) {
    const { data } = await this.supabase
      .from('plugin_registry')
      .select('*')
      .eq('slug', slug)
      .single();
    return data;
  }

  private validateManifest(manifest: PluginManifest): void {
    if (!manifest.name) throw new Error('Plugin manifest missing name');
    if (!manifest.slug) throw new Error('Plugin manifest missing slug');
    if (!manifest.version) throw new Error('Plugin manifest missing version');
    if (!manifest.permissions) throw new Error('Plugin manifest missing permissions');
  }

  // Stub: read a file from a plugin package
  private async readPluginFile(path: string, manifest: PluginManifest): Promise<string> {
    return '';
  }
  private parseSkillFile(content: string): any { return {}; }
}
```

### 5.4 Plugin Isolation

Each plugin gets scoped permissions that limit what its skills and hooks can access:

```typescript
// plugins/plugin-sandbox.ts

import { PluginPermissions } from './types';

/**
 * Enforces plugin permission boundaries.
 * Used by the hook runner and tool executor to gate plugin component access.
 */
export class PluginSandbox {
  constructor(
    private pluginId: string,
    private permissions: PluginPermissions,
  ) {}

  /**
   * Check if a plugin hook is allowed to run for a given tool.
   * Plugin hooks can only observe/control tools listed in their permissions.
   */
  canHookTool(toolName: string): boolean {
    if (this.permissions.tools.length === 0) return true; // No restriction
    return this.permissions.tools.includes(toolName);
  }

  /**
   * Check if a plugin skill can require a given tool.
   */
  canRequireTool(toolName: string): boolean {
    if (this.permissions.tools.length === 0) return true;
    return this.permissions.tools.includes(toolName);
  }

  /**
   * Check if a plugin can register a hook for a given event.
   */
  canRegisterHook(eventType: 'PreToolUse' | 'PostToolUse'): boolean {
    return this.permissions.hooks.includes(eventType);
  }

  /**
   * Check if a plugin can access a file path.
   */
  canAccessFile(filePath: string): boolean {
    if (this.permissions.file_access.length === 0) return false;
    return this.permissions.file_access.some(
      pattern => this.matchGlob(filePath, pattern),
    );
  }

  /**
   * Check if a plugin can make network requests.
   */
  canAccessNetwork(): boolean {
    return this.permissions.network;
  }

  private matchGlob(path: string, pattern: string): boolean {
    if (pattern === '**' || pattern === '**/*') return true;
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3);
      return path.startsWith(prefix);
    }
    return path === pattern;
  }
}
```

---

## 6. Skill Creation & Distribution

### 6.1 Creating a New Skill

The skill template follows OB1's established `_template/` pattern with the addition of frontmatter-based trigger metadata:

**Directory structure:**

```
skills/
  my-new-skill/
    README.md        # Human documentation (required by OB1)
    metadata.json    # OB1 metadata (required by OB1)
    SKILL.md         # Agent-readable skill file (the actual behavior)
```

**SKILL.md template with frontmatter:**

```markdown
---
name: My New Skill
description: Brief description of what this skill does.
trigger:
  - "activate phrase one"
  - "activate phrase two"
file_patterns:
  - "*.special"
tools:
  - search_thoughts
  - capture_thought
input_required:
  - source_text
input_optional:
  - output_format
input_defaults:
  output_format: markdown
produces:
  - analysis_file
side_effects:
  - captures_thoughts
---

# My New Skill

You are now operating in My New Skill mode.

## When This Activates

This skill activates when the user says "activate phrase one" or provides a *.special file.

## What To Do

1. First step of the behavior
2. Second step of the behavior
3. Save results using capture_thought

## Output Format

Always produce a structured {{output_format}} file with:
- Section A
- Section B
- Section C
```

**metadata.json (matches OB1 schema at `.github/metadata.schema.json`):**

```json
{
  "name": "My New Skill",
  "description": "Brief description of what this skill does.",
  "category": "skills",
  "author": {
    "name": "Your Name",
    "github": "your-github-username"
  },
  "version": "1.0.0",
  "requires": {
    "open_brain": true,
    "services": [],
    "tools": ["Claude Code or similar AI client"]
  },
  "tags": ["skill", "analysis", "workflow"],
  "difficulty": "beginner",
  "estimated_time": "5 minutes",
  "created": "2026-04-03",
  "updated": "2026-04-03"
}
```

### 6.2 Skill Validation

```typescript
// skills/skill-validator.ts

import { SkillDefinition } from './types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSkill(skill: SkillDefinition): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!skill.name) errors.push('Missing required field: name');
  if (!skill.slug) errors.push('Missing required field: slug');
  if (!skill.prompt_template) errors.push('Missing required field: prompt_template');
  if (skill.prompt_template.length < 50) {
    warnings.push('Prompt template is very short (< 50 chars)');
  }

  // Trigger validation
  const hasTrigger = (
    skill.trigger.phrases.length > 0 ||
    skill.trigger.file_patterns.length > 0 ||
    skill.trigger.tool_context.length > 0 ||
    skill.trigger.always
  );
  if (!hasTrigger) {
    errors.push('Skill has no trigger conditions and always=false; it can never activate');
  }

  // Tool requirements must be valid tool names
  for (const tool of skill.tool_requirements) {
    if (tool.includes(' ')) {
      errors.push(`Invalid tool requirement: "${tool}" contains spaces`);
    }
  }

  // Slug format
  if (!/^[a-z0-9-]+$/.test(skill.slug)) {
    errors.push(`Invalid slug format: "${skill.slug}" must be lowercase alphanumeric with hyphens`);
  }

  // Version format
  if (!/^\d+\.\d+\.\d+$/.test(skill.version)) {
    warnings.push(`Version "${skill.version}" is not semver format`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
```

### 6.3 Sharing Skills via OB1 Community

Skills flow through the OB1 community via the existing PR-based contribution process. The system adds programmatic publishing:

```typescript
// skills/skill-publisher.ts

import { SkillDefinition } from './types';

/**
 * Publish a local skill to the OB1 Supabase instance for cross-device access.
 * This does NOT create a PR -- it makes the skill available to the user's
 * own other devices via the OB1 MCP server.
 *
 * For community sharing, users still follow the CONTRIBUTING.md PR process.
 */
export class SkillPublisher {
  constructor(
    private supabaseUrl: string,
    private supabaseKey: string,
  ) {}

  async publishToOB1(skill: SkillDefinition): Promise<void> {
    const response = await fetch(
      `${this.supabaseUrl}/functions/v1/ob1-skills`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.supabaseKey}`,
        },
        body: JSON.stringify({
          method: 'skills/upsert',
          params: {
            slug: skill.slug,
            name: skill.name,
            description: skill.description,
            version: skill.version,
            prompt_template: skill.prompt_template,
            trigger: skill.trigger,
            input_contract: skill.input_contract,
            output_contract: skill.output_contract,
            tool_requirements: skill.tool_requirements,
            metadata: skill.metadata,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to publish skill: ${await response.text()}`);
    }
  }

  /**
   * Generate the OB1 contribution file set for a skill.
   * Produces README.md + metadata.json + SKILL.md matching OB1's _template pattern.
   */
  generateContributionFiles(skill: SkillDefinition): {
    readme: string;
    metadata: string;
    skillFile: string;
  } {
    const readme = [
      `# ${skill.name}`,
      '',
      `> ${skill.description}`,
      '',
      '## What It Does',
      '',
      skill.description,
      '',
      '## Supported Clients',
      '',
      '- Claude Code',
      '- Codex',
      '- Cursor',
      '',
      '## Prerequisites',
      '',
      '- Working Open Brain setup ([guide](../../docs/01-getting-started.md))',
      '- AI client that supports reusable skills',
      '',
      '## Installation',
      '',
      '1. Copy `SKILL.md` into `~/.claude/skills/' + skill.slug + '/SKILL.md`',
      '2. Restart or reload your AI client',
      '',
      '## Trigger Conditions',
      '',
      ...skill.trigger.phrases.map(p => `- User says "${p}"`),
      ...skill.trigger.file_patterns.map(p => `- File matching \`${p}\` is present`),
      '',
      '## Expected Outcome',
      '',
      ...skill.output_contract.produces.map(p => `- Produces: ${p}`),
    ].join('\n');

    const metadata = JSON.stringify({
      name: skill.name,
      description: skill.description,
      category: 'skills',
      author: skill.metadata.author ?? { name: 'Unknown' },
      version: skill.version,
      requires: {
        open_brain: true,
        services: [],
        tools: skill.tool_requirements,
      },
      tags: (skill.metadata.tags as string[]) ?? ['skill'],
      difficulty: (skill.metadata.difficulty as string) ?? 'intermediate',
      estimated_time: (skill.metadata.estimated_time as string) ?? '5 minutes',
      created: new Date().toISOString().split('T')[0],
      updated: new Date().toISOString().split('T')[0],
    }, null, 2);

    // Build SKILL.md with frontmatter
    const frontmatter = [
      '---',
      `name: ${skill.name}`,
      `description: ${skill.description}`,
      `trigger:`,
      ...skill.trigger.phrases.map(p => `  - "${p}"`),
      skill.trigger.file_patterns.length > 0
        ? `file_patterns:\n${skill.trigger.file_patterns.map(p => `  - "${p}"`).join('\n')}`
        : '',
      skill.tool_requirements.length > 0
        ? `tools:\n${skill.tool_requirements.map(t => `  - ${t}`).join('\n')}`
        : '',
      '---',
    ].filter(Boolean).join('\n');

    const skillFile = `${frontmatter}\n\n${skill.prompt_template}`;

    return { readme, metadata, skillFile };
  }
}
```

### 6.4 Auto-Generation of Skills from MCP Server Capabilities

When an MCP server connects, its tool definitions can be wrapped into skills automatically:

```typescript
// skills/mcp-skill-generator.ts

import { SkillDefinition } from './types';

interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Auto-generate skill definitions from MCP server tool listings.
 * Each MCP tool becomes a minimal skill with:
 * - A prompt template describing the tool's purpose
 * - Trigger phrases derived from the tool name and description
 * - The MCP tool as the sole tool_requirement
 */
export function generateSkillsFromMCPTools(
  serverName: string,
  tools: MCPToolDefinition[],
): SkillDefinition[] {
  return tools.map(tool => {
    const slug = `mcp-${serverName}-${tool.name}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // Extract keywords from description for trigger phrases
    const keywords = extractKeywords(tool.description);
    const phrases = keywords.length > 0
      ? keywords.slice(0, 3)
      : [tool.name.replace(/_/g, ' ')];

    // Generate a minimal prompt template
    const promptTemplate = [
      `# MCP Tool: ${tool.name}`,
      '',
      `This skill provides access to the \`${tool.name}\` tool from the ${serverName} MCP server.`,
      '',
      `## Description`,
      tool.description,
      '',
      `## Input Schema`,
      '```json',
      JSON.stringify(tool.inputSchema, null, 2),
      '```',
      '',
      `When the user's request matches this tool's capability, use \`${tool.name}\` to fulfill it.`,
    ].join('\n');

    return {
      id: crypto.randomUUID(),
      name: `${serverName}: ${tool.name}`,
      slug,
      description: tool.description,
      version: '1.0.0',
      source_type: 'mcp_generated' as const,
      prompt_template: promptTemplate,
      trigger: {
        phrases,
        file_patterns: [],
        tool_context: [],
        always: false,
      },
      input_contract: {
        required: Object.keys(
          (tool.inputSchema as any)?.properties ?? {},
        ).filter(k =>
          ((tool.inputSchema as any)?.required ?? []).includes(k),
        ),
        optional: Object.keys(
          (tool.inputSchema as any)?.properties ?? {},
        ).filter(k =>
          !((tool.inputSchema as any)?.required ?? []).includes(k),
        ),
        defaults: {},
      },
      output_contract: {
        produces: [],
        side_effects: [],
      },
      tool_requirements: [tool.name],
      trust_tier: 'skill' as const,
      enabled: true,
      metadata: { mcp_server: serverName },
    };
  });
}

function extractKeywords(description: string): string[] {
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'and', 'or', 'not', 'this', 'that', 'it', 'its',
  ]);

  return description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
    .slice(0, 5);
}
```

---

## 7. OB1 Integration

### 7.1 Skills Stored in Supabase for Cross-Device Access

Skills are persisted in the `skill_registry` table and synced to the local filesystem cache. This enables cross-device access: install a skill on your laptop, use it from your desktop.

```typescript
// ob1/skill-sync.ts

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SkillDefinition } from '../skills/types';

/**
 * Two-way sync between local skill files and OB1 Supabase.
 *
 * Sync strategy:
 * - On boot: pull remote skills not present locally
 * - On skill install: push to remote
 * - On skill edit: push updated version to remote
 * - Conflict resolution: newer version wins (semver comparison)
 */
export class SkillSync {
  private supabase: SupabaseClient;
  private localCachePath: string;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.localCachePath = this.resolvePath('~/.claude/cache/ob1-skills');
  }

  /**
   * Pull skills from OB1 that are newer than local versions.
   * Called during boot Phase 5.
   */
  async pullRemoteSkills(localSkills: SkillDefinition[]): Promise<SkillDefinition[]> {
    const { data: remoteSkills, error } = await this.supabase
      .from('skill_registry')
      .select('*')
      .eq('enabled', true);

    if (error || !remoteSkills) {
      console.warn('[skill-sync] Failed to pull remote skills:', error?.message);
      return [];
    }

    const localSlugs = new Map(localSkills.map(s => [s.slug, s]));
    const newSkills: SkillDefinition[] = [];

    for (const remote of remoteSkills) {
      const local = localSlugs.get(remote.slug);

      if (!local) {
        // New skill from remote -- add it
        newSkills.push(this.mapDatabaseRow(remote));
      } else if (this.isNewer(remote.version, local.version)) {
        // Remote is newer -- update local
        newSkills.push(this.mapDatabaseRow(remote));
      }
    }

    // Cache pulled skills locally for offline access
    await this.cacheSkills(newSkills);

    return newSkills;
  }

  /**
   * Push a local skill to OB1 Supabase.
   */
  async pushSkill(skill: SkillDefinition): Promise<void> {
    const { error } = await this.supabase
      .from('skill_registry')
      .upsert(
        {
          slug: skill.slug,
          name: skill.name,
          description: skill.description,
          version: skill.version,
          source_type: skill.source_type,
          source_path: skill.source_path,
          prompt_template: skill.prompt_template,
          trigger: skill.trigger,
          input_contract: skill.input_contract,
          output_contract: skill.output_contract,
          tool_requirements: skill.tool_requirements,
          trust_tier: skill.trust_tier,
          enabled: skill.enabled,
          metadata: skill.metadata,
        },
        { onConflict: 'slug' },
      );

    if (error) {
      throw new Error(`Failed to push skill "${skill.slug}": ${error.message}`);
    }
  }

  private isNewer(remoteVersion: string, localVersion: string): boolean {
    const [rMajor, rMinor, rPatch] = remoteVersion.split('.').map(Number);
    const [lMajor, lMinor, lPatch] = localVersion.split('.').map(Number);
    if (rMajor !== lMajor) return rMajor > lMajor;
    if (rMinor !== lMinor) return rMinor > lMinor;
    return rPatch > lPatch;
  }

  private mapDatabaseRow(row: Record<string, unknown>): SkillDefinition {
    return {
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      description: row.description as string,
      version: row.version as string,
      source_type: row.source_type as SkillDefinition['source_type'],
      source_path: row.source_path as string | undefined,
      ob1_slug: row.ob1_slug as string | undefined,
      prompt_template: row.prompt_template as string,
      trigger: row.trigger as SkillDefinition['trigger'],
      input_contract: row.input_contract as SkillDefinition['input_contract'],
      output_contract: row.output_contract as SkillDefinition['output_contract'],
      tool_requirements: row.tool_requirements as string[],
      plugin_id: row.plugin_id as string | undefined,
      trust_tier: row.trust_tier as SkillDefinition['trust_tier'],
      enabled: row.enabled as boolean,
      metadata: row.metadata as Record<string, unknown>,
    };
  }

  private async cacheSkills(skills: SkillDefinition[]): Promise<void> {
    // Write to ~/.claude/cache/ob1-skills/<slug>.json
  }

  private resolvePath(path: string): string {
    if (path.startsWith('~')) {
      return path.replace('~', process.env.HOME ?? process.env.USERPROFILE ?? '');
    }
    return path;
  }
}
```

### 7.2 Connection to OB1's Existing Patterns

The system preserves OB1's established conventions:

| OB1 Convention | How This System Honors It |
|----------------|--------------------------|
| `README.md` + `metadata.json` per contribution | `SkillPublisher.generateContributionFiles()` produces both |
| `metadata.json` validates against `.github/metadata.schema.json` | Generated metadata matches the schema exactly |
| Skills are plain-text and reviewable | `SKILL.md` files are markdown with YAML frontmatter |
| MCP servers are remote (Edge Functions) | Skill CRUD runs as an Edge Function, not local |
| No credentials in files | Supabase keys come from environment variables |
| `skills/` directory structure | Loaded by `SkillLoader.discoverUserSkills()` |
| PR-based contribution process | `SkillPublisher` generates PR-ready file sets |

---

## 8. Edge Function Endpoints

### 8.1 Skill CRUD Edge Function

```typescript
// supabase/functions/ob1-skills/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req: Request) => {
  const accessKey = req.headers.get('x-access-key') ?? req.headers.get('authorization')?.replace('Bearer ', '');
  if (accessKey !== Deno.env.get('MCP_ACCESS_KEY')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body = await req.json();
  const { method, params } = body;

  switch (method) {
    // --- Skill Operations ---
    case 'skills/list': {
      const query = supabase.from('skill_registry').select('*');
      if (params?.enabled_only) query.eq('enabled', true);
      if (params?.source_type) query.eq('source_type', params.source_type);
      if (params?.search) {
        query.textSearch('name', params.search, { type: 'websearch' });
      }
      const { data, error } = await query.order('name');
      if (error) return jsonError(error.message);
      return jsonOk({ skills: data });
    }

    case 'skills/get': {
      const { data, error } = await supabase
        .from('skill_registry')
        .select('*')
        .eq('slug', params.slug)
        .single();
      if (error) return jsonError(error.message);
      return jsonOk({ skill: data });
    }

    case 'skills/upsert': {
      const { data, error } = await supabase
        .from('skill_registry')
        .upsert(
          {
            slug: params.slug,
            name: params.name,
            description: params.description,
            version: params.version,
            source_type: params.source_type ?? 'user',
            prompt_template: params.prompt_template,
            trigger: params.trigger,
            input_contract: params.input_contract ?? {},
            output_contract: params.output_contract ?? {},
            tool_requirements: params.tool_requirements ?? [],
            trust_tier: 'skill',
            enabled: true,
            metadata: params.metadata ?? {},
          },
          { onConflict: 'slug' },
        )
        .select()
        .single();
      if (error) return jsonError(error.message);
      return jsonOk({ skill: data });
    }

    case 'skills/delete': {
      const { error } = await supabase
        .from('skill_registry')
        .delete()
        .eq('slug', params.slug);
      if (error) return jsonError(error.message);
      return jsonOk({ deleted: params.slug });
    }

    case 'skills/search': {
      // Full-text search across name + description
      const { data, error } = await supabase
        .from('skill_registry')
        .select('slug, name, description, version, tags:metadata->tags')
        .textSearch('name', params.query, { type: 'websearch' })
        .eq('enabled', true)
        .limit(params.limit ?? 20);
      if (error) return jsonError(error.message);
      return jsonOk({ results: data });
    }

    // --- Hook Operations ---
    case 'hooks/list': {
      const query = supabase.from('hook_configurations').select('*');
      if (params?.event_type) query.eq('event_type', params.event_type);
      if (params?.enabled_only) query.eq('enabled', true);
      const { data, error } = await query.order('priority');
      if (error) return jsonError(error.message);
      return jsonOk({ hooks: data });
    }

    case 'hooks/register': {
      const { data, error } = await supabase
        .from('hook_configurations')
        .insert({
          name: params.name,
          event_type: params.event_type,
          command: params.command,
          tool_filter: params.tool_filter ?? [],
          priority: params.priority ?? 100,
          timeout_ms: params.timeout_ms ?? 30000,
          trust_tier: 'skill',
        })
        .select()
        .single();
      if (error) return jsonError(error.message);
      return jsonOk({ hook: data });
    }

    case 'hooks/log': {
      // Query hook execution history
      const query = supabase
        .from('hook_execution_log')
        .select('*')
        .eq('session_id', params.session_id)
        .order('created_at', { ascending: false })
        .limit(params.limit ?? 50);
      if (params?.outcome) query.eq('outcome', params.outcome);
      const { data, error } = await query;
      if (error) return jsonError(error.message);
      return jsonOk({ log: data });
    }

    // --- Plugin Operations ---
    case 'plugins/list': {
      const { data, error } = await supabase
        .from('plugin_registry')
        .select('*')
        .order('name');
      if (error) return jsonError(error.message);
      return jsonOk({ plugins: data });
    }

    case 'plugins/install': {
      // Delegated to PluginManager -- this endpoint accepts a manifest
      // and triggers the install lifecycle
      return jsonOk({ status: 'use PluginManager.install() locally' });
    }

    default:
      return jsonError(`Unknown method: ${method}`, 400);
  }
});

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

### 8.2 Endpoint Summary

| Endpoint | Method | Description |
|----------|--------|-------------|
| `skills/list` | POST | List skills (filter by enabled, source_type, search) |
| `skills/get` | POST | Get a single skill by slug |
| `skills/upsert` | POST | Create or update a skill |
| `skills/delete` | POST | Delete a skill by slug |
| `skills/search` | POST | Full-text search across skill names and descriptions |
| `hooks/list` | POST | List hook configurations (filter by event_type) |
| `hooks/register` | POST | Register a new hook command |
| `hooks/log` | POST | Query hook execution audit log |
| `plugins/list` | POST | List installed plugins |
| `plugins/install` | POST | Install a plugin from manifest |

### 8.3 MCP Tool Definitions for Claude Desktop

These MCP tools are exposed through the Edge Function for use in Claude Desktop:

```typescript
// MCP tool definitions returned by tools/list

const OB1_SKILL_TOOLS = [
  {
    name: 'list_skills',
    description: 'List all registered skills with their triggers and status',
    inputSchema: {
      type: 'object',
      properties: {
        source_type: {
          type: 'string',
          enum: ['bundled', 'user', 'ob1', 'mcp_generated'],
          description: 'Filter by skill source',
        },
        search: {
          type: 'string',
          description: 'Search skills by name or description',
        },
      },
    },
  },
  {
    name: 'get_skill',
    description: 'Get full details of a skill including prompt template and trigger conditions',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Skill slug' },
      },
      required: ['slug'],
    },
  },
  {
    name: 'create_skill',
    description: 'Create a new skill from a name, trigger phrases, and prompt template',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        trigger_phrases: { type: 'array', items: { type: 'string' } },
        prompt_template: { type: 'string' },
        tool_requirements: { type: 'array', items: { type: 'string' } },
      },
      required: ['name', 'description', 'trigger_phrases', 'prompt_template'],
    },
  },
  {
    name: 'search_skills',
    description: 'Search the OB1 community skill library for reusable behaviors',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: ['query'],
    },
  },
];
```

---

## 9. Build Order

Execute in this order. Each step is independently testable before proceeding.

### Phase 1: Schema (30 min)

1. Run the `plugin_registry` table migration (Section 2.4) -- must be first because `skill_registry` and `hook_configurations` reference it
2. Run the `skill_registry` table migration (Section 2.1)
3. Run the `hook_configurations` table migration (Section 2.2)
4. Run the `hook_execution_log` table migration (Section 2.3)
5. Run the grants (Section 2.5)
6. Verify all four tables exist in Supabase Table Editor

### Phase 2: Types (30 min)

7. Create `skills/types.ts` with all type definitions (Section 3.1)
8. Create `hooks/types.ts` with hook payload and outcome types (Section 4.2)
9. Create `plugins/types.ts` with plugin manifest types (Section 5.1)

### Phase 3: Skill Loader (1 hr)

10. Create `skills/skill-loader.ts` with filesystem discovery (Section 3.3)
11. Create `skills/ob1-mapper.ts` with OB1 metadata mapping (Section 3.5)
12. Create `skills/skill-validator.ts` (Section 6.2)
13. Test: place a SKILL.md in `~/.claude/skills/test/`, verify it is discovered and parsed
14. Test: validate a well-formed skill, verify no errors
15. Test: validate a malformed skill (no triggers), verify error reported

### Phase 4: Skill Router (45 min)

16. Create `skills/skill-router.ts` with trigger evaluation and prompt injection (Section 3.4)
17. Test: route a message containing a trigger phrase, verify skill matched
18. Test: route a message with no matches, verify empty result
19. Test: verify always-active skills appear in every route result
20. Test: verify token budget enforcement truncates long skill lists

### Phase 5: Hook Runner (1 hr)

21. Create `hooks/hook-runner.ts` with shell dispatch and timeout (Section 4.5)
22. Create `hooks/hook-config-loader.ts` with settings.json loading (Section 4.7)
23. Create `runtime/hook-integration.ts` with agentic loop integration (Section 4.6)
24. Test: create a PreToolUse hook that exits 0, verify tool proceeds
25. Test: create a PreToolUse hook that exits 2, verify tool blocked
26. Test: create a hook that sleeps 60s, verify timeout fires at 30s
27. Test: verify multiple hooks run in priority order, first deny short-circuits
28. Test: verify environment variables are set correctly (write a hook that echoes them)

### Phase 6: Plugin Manager (1 hr)

29. Create `plugins/plugin-manager.ts` with install/enable/disable/uninstall lifecycle (Section 5.3)
30. Create `plugins/plugin-sandbox.ts` with permission enforcement (Section 5.4)
31. Test: install a plugin with 1 skill and 1 hook, verify both registered
32. Test: disable the plugin, verify skill and hook are disabled
33. Test: re-enable the plugin, verify restoration
34. Test: uninstall the plugin, verify cascading cleanup

### Phase 7: Edge Function (1 hr)

35. Create the Edge Function at `supabase/functions/ob1-skills/index.ts` (Section 8.1)
36. Set Supabase secrets: `MCP_ACCESS_KEY`
37. Deploy: `supabase functions deploy ob1-skills`
38. Test: `skills/list` returns empty array initially
39. Test: `skills/upsert` creates a skill, `skills/get` retrieves it
40. Test: `skills/search` finds the skill by keyword
41. Test: `hooks/register` creates a hook configuration
42. Test: `hooks/log` returns empty array for a new session

### Phase 8: Skill Sync (45 min)

43. Create `ob1/skill-sync.ts` with two-way sync (Section 7.1)
44. Create `skills/skill-publisher.ts` with contribution file generation (Section 6.3)
45. Test: push a local skill to OB1, verify it appears in `skills/list`
46. Test: pull remote skills, verify new skills appear locally
47. Test: verify version conflict resolution (newer wins)

### Phase 9: MCP Skill Generation (30 min)

48. Create `skills/mcp-skill-generator.ts` (Section 6.4)
49. Test: generate skills from a mock MCP tool list, verify trigger phrases extracted
50. Test: verify generated skills have correct tool_requirements

### Phase 10: Integration Tests (45 min)

51. End-to-end: boot with skills in `~/.claude/skills/`, verify discovery and routing
52. End-to-end: send a message matching a skill trigger, verify prompt injection
53. End-to-end: execute a tool with PreToolUse hook, verify hook runs and feedback merges
54. End-to-end: install a plugin, verify its skill activates on correct trigger
55. End-to-end: publish a skill to OB1, pull it on a clean install, verify it works
56. Connect to Claude Desktop via Settings > Connectors > Add custom connector

---

## 10. File Map

```
supabase/
  functions/
    ob1-skills/
      index.ts                    -- Edge Function: skill/hook/plugin CRUD (Section 8.1)

src/
  skills/
    types.ts                      -- SkillDefinition, SkillTrigger, contracts (Section 3.1)
    skill-loader.ts               -- Filesystem + OB1 discovery (Section 3.3)
    skill-router.ts               -- Trigger evaluation + prompt injection (Section 3.4)
    skill-validator.ts            -- Validation rules (Section 6.2)
    skill-publisher.ts            -- Publish to OB1 + generate PR files (Section 6.3)
    ob1-mapper.ts                 -- Map OB1 metadata.json to SkillDefinition (Section 3.5)
    mcp-skill-generator.ts        -- Auto-generate skills from MCP tools (Section 6.4)

  hooks/
    types.ts                      -- HookPayload, HookEvent, HookRunResult (Section 4.2)
    hook-runner.ts                -- Shell dispatch, timeout, exit codes (Section 4.5)
    hook-config-loader.ts         -- Load from settings.json + DB (Section 4.7)

  plugins/
    types.ts                      -- PluginManifest, PluginPermissions (Section 5.1)
    plugin-manager.ts             -- Install/enable/disable/uninstall (Section 5.3)
    plugin-sandbox.ts             -- Permission boundary enforcement (Section 5.4)

  runtime/
    hook-integration.ts           -- mergeHookFeedback + executeWithHooks (Section 4.6)

  ob1/
    skill-sync.ts                 -- Two-way sync with OB1 Supabase (Section 7.1)
```

---

## Quick Reference: Skill Sources

| Source | Trust Tier | Discovery | Persistence | Editable |
|--------|-----------|-----------|-------------|----------|
| Bundled | built_in | Hard-coded | In source | No |
| User (.claude/skills/) | skill | Boot scan | Filesystem | Yes |
| OB1 Community | skill | MCP fetch | Supabase + cache | Via PR |
| MCP Generated | skill | On MCP connect | Memory only | No |
| Plugin | plugin | Plugin install | Supabase | Via plugin update |

## Quick Reference: Hook Exit Codes

| Exit Code | Outcome | PreToolUse Effect | PostToolUse Effect |
|-----------|---------|-------------------|-------------------|
| 0 | Allow | Tool proceeds, stdout = feedback | Result unchanged, stdout = feedback |
| 1 | Warn | Tool proceeds, warning shown | Result unchanged, warning shown |
| 2 | Deny | Tool BLOCKED, stdout = reason | Result marked as error |
| Other | Warn | Tool proceeds, crash warning | Result unchanged, crash warning |
| Timeout | Warn | Tool proceeds, timeout warning | Result unchanged, timeout warning |

## Quick Reference: Plugin Lifecycle

```
Install  -->  enabled   -->  Disable  -->  disabled  -->  Enable  -->  enabled
                                                                       |
                                                          Uninstall <--+
                                                              |
                                                           deleted
                                                     (CASCADE cleans up
                                                      skills, hooks, tools)
```
