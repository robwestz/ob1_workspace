# Process Patterns — OB1

**Summary:** Three recurring patterns keep the OB1 codebase healthy: doc-gardening (fix stale docs), garbage collection (remove drift), and agent review (quality gate).

## Doc-Gardening

**Schedule:** Monthly (first Monday)

**What to scan:**
- AGENTS.md — all paths still exist?
- ARCHITECTURE.md — domain map matches actual directories?
- docs/ — cross-links resolve? Information current?
- .harness/*.yml — domains match codebase? Quality scores reviewed?
- README.md — setup instructions still work?

**Process:**
1. Agent runs path verification (check every reference in AGENTS.md, ARCHITECTURE.md)
2. Agent diffs .harness/domains.yml against actual directory structure
3. Agent checks docs/ cross-links
4. Fix immediately — stale docs are worse than no docs
5. Update .harness/quality.yml review dates

**Automation:** Can be run as a night runner task or scheduled agent.

## Garbage Collection

**Schedule:** After every major feature merge, or monthly

**What to sweep:**
- Dead code (functions with zero callers)
- Duplicated helpers (same logic in multiple places)
- Pattern drift (code violating .harness/principles.yml)
- Orphaned files (not referenced by anything)
- Stale dependencies (unused packages in package.json/requirements.txt)

**Process:**
1. Agent runs structural analysis (import graph, usage count)
2. Agent compares against .harness/enforcement.yml rules
3. Small, focused GC PRs — never batch unrelated cleanups
4. Each PR references the principle or enforcement rule being restored

**Priority:** GC is urgent, not optional. Without it, agent-generated code degrades fast enough to consume 20% of engineering time in manual cleanup.

## Agent Review Protocol

**Progression by maturity level:**
- Level 1-2: Humans review everything
- Level 3: Agents pre-review, humans spot-check
- Level 4: Agent-to-agent review, humans only for escalations

**Current level: 2 (moving to 3)**

**Agent self-review checklist (before creating PR):**
1. Does the code compile? (`npx tsc --noEmit` or `next build`)
2. Do tests pass? (if applicable)
3. Does it violate any .harness/principles.yml rule?
4. Are file limits respected? (.harness/enforcement.yml)
5. Is metadata.json valid? (for contributions)
6. Are there any banned import patterns?

**Agent cross-review (for multi-agent work):**
1. Second agent reads the diff
2. Checks against .harness/ rules
3. Verifies no multi-agent conflicts (shared files modified by both)
4. Reports findings, doesn't block — author agent decides

**Human review triggers:**
- Public API changes
- Security-sensitive code
- Architectural changes (new domains, cross-cutting concerns)
- .harness/ modifications
- Budget/cost-affecting changes
