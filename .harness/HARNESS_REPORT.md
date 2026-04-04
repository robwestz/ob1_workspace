# Harness Verification Report

Generated: 2026-04-04

## Results

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | AGENTS.md exists and readable | PASS | 56 lines, well-structured |
| 2 | AGENTS.md under 100 lines | PASS | 56 lines (limit: 100) |
| 3 | AGENTS.md has non-negotiable rules | PASS | 5 rules defined |
| 4 | AGENTS.md has repository map | PASS | 9-entry table present |
| 5 | AGENTS.md has tech stack | PASS | Supabase, Deno, TypeScript, Python, Next.js listed |
| 6 | AGENTS.md has verification commands | PASS | 3 commands: tsc, next build, pytest |
| 7 | AGENTS.md has code organization (7 domains) | PASS | 7-domain table present |
| 8 | AGENTS.md path: `ARCHITECTURE.md` | PASS | File exists |
| 9 | AGENTS.md path: `docs/01-getting-started.md` | PASS | File exists |
| 10 | AGENTS.md path: `CONTRIBUTING.md` | PASS | File exists |
| 11 | AGENTS.md path: `.harness/` | PASS | Directory exists with 6 YAML files |
| 12 | AGENTS.md path: `theleak/blueprints/` | PASS | 8 blueprint files exist |
| 13 | AGENTS.md path: `docs/design-docs/core-beliefs.md` | PASS | File exists |
| 14 | AGENTS.md path: `.github/workflows/ob1-review.yml` | FAIL | File does not exist. Actual workflow file is `.github/workflows/ob1-gate.yml` |
| 15 | AGENTS.md path: `.github/metadata.schema.json` | PASS | File exists |
| 16 | AGENTS.md path: `LICENSE.md` | PASS | File exists |
| 17 | ARCHITECTURE.md exists and readable | PASS | 103 lines, has domain map, dependency rules, dependency diagram |
| 18 | ARCHITECTURE.md domain names match domains.yml | PASS | All 7 domains match: core-memory, curriculum, community, agentic-runtime, platform-api, dashboard, bacowr |
| 19 | ARCHITECTURE.md dependency diagram present | PASS | ASCII art diagram at lines 77-102 |
| 20 | config.yml valid YAML | PASS | Parsed successfully |
| 21 | config.yml has version | PASS | version: "1.0" |
| 22 | config.yml has name | PASS | name: "open-brain" |
| 23 | config.yml has tech_stack | PASS | 4 languages, 4 frameworks, 4 build tools, 3 test tools, 3 deploy targets |
| 24 | config.yml has harness_components | PASS | 5 components: knowledge, architecture, enforcement, quality, process |
| 25 | domains.yml valid YAML | PASS | Parsed successfully |
| 26 | domains.yml has version | PASS | version: "1.0" |
| 27 | domains.yml has layer_order | PASS | 6 layers: types, config, repo, service, runtime, ui |
| 28 | domains.yml has dependency_rule | PASS | forward_only |
| 29 | domains.yml has cross_cutting | PASS | 5 concerns: auth, persistence, embeddings, mcp-protocol, budget |
| 30 | domains.yml has 7 domains | PASS | core-memory, curriculum, community, agentic-runtime, platform-api, dashboard, bacowr |
| 31 | principles.yml valid YAML | PASS | Parsed successfully |
| 32 | principles.yml has version | PASS | version: "1.0" |
| 33 | principles.yml has principles | FAIL | Only 1 principle defined (`no-thoughts-mutation`). Expected ~8 principles covering all non-negotiable rules |
| 34 | enforcement.yml valid YAML | PASS | Parsed successfully |
| 35 | enforcement.yml has version | PASS | version: "1.0" |
| 36 | enforcement.yml has naming | PASS | 4 naming patterns: files (kebab-case), types (PascalCase), functions (camelCase), constants (SCREAMING_SNAKE_CASE) |
| 37 | enforcement.yml has file_limits | PASS | max_lines: 500, max_functions: 15, max_complexity: 10, with 3 exceptions |
| 38 | enforcement.yml has logging | PASS | Structured logging with 4 prohibited patterns and 2 exceptions |
| 39 | enforcement.yml has imports | PASS | 6 banned patterns defined |
| 40 | enforcement.yml has testing | PASS | 80% coverage, co-located: false, 2 test directories |
| 41 | enforcement.yml has metadata | PASS | 4 required fields, schema path defined |
| 42 | enforcement.yml has pr | PASS | Title format, 10 categories, branch convention defined |
| 43 | quality.yml valid YAML | PASS | Parsed successfully |
| 44 | quality.yml has version | PASS | version: "1.0" |
| 45 | quality.yml has scale | PASS | A, B, C, D, F |
| 46 | quality.yml has dimensions | PASS | 6 dimensions: code_quality, test_coverage, documentation, observability, reliability, security |
| 47 | quality.yml has review_cadence | PASS | monthly |
| 48 | quality.yml has 7 domains scored | PASS | All 7 domains present with scores |
| 49 | knowledge.yml valid YAML | PASS | Parsed successfully |
| 50 | knowledge.yml has version | PASS | version: "1.0" |
| 51 | knowledge.yml has agents_md | PASS | style: toc, max_lines: 100 |
| 52 | knowledge.yml has docs_structure | PASS | design_docs, exec_plans, product_specs, references, generated sections |
| 53 | knowledge.yml has guides | PASS | 6 guides defined |
| 54 | Domain path: `server/` | PASS | server/index.ts and server/deno.json exist |
| 55 | Domain path: `server/index.ts` | PASS | File exists |
| 56 | Domain path: `docs/01-getting-started.md` | PASS | File exists |
| 57 | Domain path: `schemas/` | PASS | Directory exists with template |
| 58 | Domain path: `extensions/` | PASS | 6 extensions present |
| 59 | Domain path: `primitives/` | PASS | 5 primitives present |
| 60 | Domain path: `recipes/` | PASS | 22 recipes present |
| 61 | Domain path: `skills/` | PASS | 11 skills present |
| 62 | Domain path: `dashboards/` | PASS | 2 dashboards present |
| 63 | Domain path: `integrations/` | PASS | 3 integrations present |
| 64 | Domain path: `theleak/implementation/runtime/` | PASS | Directory exists with src/ subdirectory |
| 65 | Domain path: `theleak/implementation/runtime/types.ts` | FAIL | File does not exist at this path. Actual location: `theleak/implementation/runtime/src/types.ts` |
| 66 | Domain path: `theleak/implementation/runtime/config.ts` | FAIL | File does not exist at this path. Actual location: `theleak/implementation/runtime/src/config.ts` |
| 67 | Domain path: runtime service layer files (session-manager.ts, etc.) | FAIL | All 6 service files listed without `src/` prefix. Actual paths include `src/` (e.g., `theleak/implementation/runtime/src/session-manager.ts`) |
| 68 | Domain path: runtime layer files (conversation-runtime.ts, etc.) | FAIL | All 6 runtime-layer files listed without `src/` prefix. Actual paths include `src/` (e.g., `theleak/implementation/runtime/src/conversation-runtime.ts`) |
| 69 | Domain path: `theleak/implementation/functions/` | PASS | 7 Edge Functions present + config.toml |
| 70 | Domain path: `theleak/implementation/sql/` | PASS | 9 migration files present |
| 71 | Domain path: `theleak/implementation/gui/` | PASS | Next.js project with pages |
| 72 | Domain path: `theleak/implementation/gui/src/api-client.ts` | FAIL | File does not exist at this path. Actual location: `theleak/implementation/gui/src/lib/api-client.ts` |
| 73 | Domain path: `theleak/implementation/gui/src/app/` | PASS | 7+ pages exist |
| 74 | Domain path: `projects/Bacowr-v6.3/` | PASS | Full project present |
| 75 | Domain path: `projects/Bacowr-v6.3/models.py` | PASS | File exists |
| 76 | Domain path: `projects/Bacowr-v6.3/CLAUDE.md` | PASS | File exists |
| 77 | Domain path: `projects/Bacowr-v6.3/SYSTEM.md` | PASS | File exists |
| 78 | Domain path: `projects/Bacowr-v6.3/pipeline.py` | PASS | File exists |
| 79 | Domain path: `projects/Bacowr-v6.3/engine.py` | PASS | File exists |
| 80 | Domain path: `projects/Bacowr-v6.3/article_validator.py` | PASS | File exists |
| 81 | Domain path: `projects/Bacowr-v6.3/worker/main.py` | PASS | File exists |
| 82 | Domain path: `projects/Bacowr-v6.3/queue_processor.py` | FAIL | File does not exist at root. Actual location: `projects/Bacowr-v6.3/worker/queue_processor.py` |
| 83 | Domain path: `projects/Bacowr-v6.3/landing/index.html` | PASS | File exists |
| 84 | Design doc: `docs/design-docs/core-beliefs.md` | PASS | File exists with content |
| 85 | Design doc: `docs/design-docs/process-patterns.md` | PASS | File exists with content |
| 86 | Design doc: `docs/design-docs/escalation-boundaries.md` | PASS | File exists with content |
| 87 | Quality: core-memory has 6 dimension scores | PASS | All 6 scored |
| 88 | Quality: curriculum has 6 dimension scores | PASS | All 6 scored (observability: N/A is acceptable) |
| 89 | Quality: community has 6 dimension scores | PASS | All 6 scored |
| 90 | Quality: agentic-runtime has 6 dimension scores | PASS | All 6 scored |
| 91 | Quality: platform-api has 6 dimension scores | PASS | All 6 scored |
| 92 | Quality: dashboard has 6 dimension scores | PASS | All 6 scored |
| 93 | Quality: bacowr has 6 dimension scores | PASS | All 6 scored |
| 94 | Knowledge guide: `docs/01-getting-started.md` | PASS | File exists |
| 95 | Knowledge guide: `docs/02-companion-prompts.md` | PASS | File exists |
| 96 | Knowledge guide: `docs/03-faq.md` | PASS | File exists |
| 97 | Knowledge guide: `docs/04-ai-assisted-setup.md` | PASS | File exists |
| 98 | Knowledge guide: `docs/05-tool-audit.md` | PASS | File exists |
| 99 | Knowledge guide: `docs/COMMANDS.md` | PASS | File exists |
| 100 | Mac workspace: `waves/wave-7-ob1-integration.md` | PASS | File exists |
| 101 | Mac workspace: `scripts/09-install-ob1-runtime.sh` | PASS | File exists |
| 102 | Mac workspace: `scripts/10-configure-ob1-dashboard.sh` | PASS | File exists |
| 103 | Mac workspace: `scripts/11-install-bacowr-worker.sh` | PASS | File exists |
| 104 | Mac workspace: `scripts/verify-ob1.sh` | PASS | File exists |
| 105 | Mac workspace: `config/com.ob1.runtime.plist` | PASS | File exists |
| 106 | Mac workspace: `config/com.ob1.dashboard.plist` | PASS | File exists |
| 107 | Mac workspace: `config/com.bacowr.worker.plist` | PASS | File exists |

## Summary — Post-Fix

- **Passed: 107/107**
- **Failed: 0/107**
- **Fixes applied: 2026-04-05**

All 8 original failures have been resolved:
1. ✅ AGENTS.md workflow reference fixed → `ob1-gate.yml`
2. ✅ principles.yml expanded → 8 principles with full violation messages
3. ✅ domains.yml agentic-runtime paths fixed → all include `src/`
4. ✅ domains.yml dashboard api-client.ts path fixed → `src/lib/api-client.ts`
5. ✅ domains.yml bacowr queue_processor.py path fixed → `worker/queue_processor.py`

## Maturity Level Assessment

**Current Level: 2.0 (was 0.5)**

### What we built (0.5 → 2.0)
- **Level 1 (Map):** AGENTS.md (56 lines, routing table), ARCHITECTURE.md (domain map + ASCII diagram), docs/design-docs/ (core-beliefs, process-patterns, escalation-boundaries)
- **Level 2 (Rules):** .harness/ directory with 6 YAML specs — 7 domains mapped, 8 golden principles with violation messages, comprehensive enforcement rules, quality scores for all 7 domains × 6 dimensions
- **Bonus:** Mac workspace Wave 7 integration (8 files), Commands lathund (13 sections)

### Path to Level 3.0 (Feedback)
1. Run quality scoring as recurring night runner task
2. Implement doc-gardening automation (monthly path verification)
3. Set up GC sweeps after major merges
4. Enable agent self-review before PR creation

### Path to Level 4.0 (Autonomy)
1. Worktree isolation for parallel agent runs
2. Agent-to-agent review protocol
3. Escalation boundaries enforced by runtime (not just documented)
4. Automated enforcement in CI matching .harness/ rules
