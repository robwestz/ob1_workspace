# System Truth

> Authoritative description of the system. Generated and maintained by the agent.
> Every claim is either **Confirmed** or **Proposed**. No exceptions.

---

## Input Fingerprint

```yaml
input_fingerprint:
  sot_id: "2026-02-18-4ffc6a4"
  included_files:
    - path: "models.py"
      size: "275 lines"
    - path: "pipeline.py"
      size: "966 lines"
    - path: "engine.py"
      size: "~2800 lines"
    - path: "article_validator.py"
      size: "~470 lines"
  excluded_patterns:
    - "node_modules/"
    - ".env*"
    - "dist/"
    - "__pycache__/"
  total_files: 12
  commit_ref: "4ffc6a4"
  fingerprint_hash: "bacowr-v62-cold-start-2026-02-18"
```

---

## System Overview

**Purpose:** BACOWR v6.2 is an article generation pipeline that takes a CSV job list (publisher domain, target URL, anchor text) and produces SEO-optimized articles with anchor links, trust links, and quality verification. The system uses pipeline.py (semantic orchestration) + engine.py (SERP intelligence) in cooperation — the agent orchestrates both, never plays solo. Articles strengthen topical authority for the target page through SERP-confirmed entities and semantically bridged context links.

**Status:** Confirmed
**Evidence:** SKILL.md:1-12 (YAML frontmatter + purpose), INIT.md:9 (system description), CLAUDE.md:1-10, engine.py:1-34 (docstring), pipeline.py:1-19 (docstring)

---

## Module Structure

| Module | Path | Responsibility | Entrypoint | Status |
|--------|------|---------------|------------|--------|
| models | models.py | Data structures: JobSpec, Preflight, PublisherProfile, TargetFingerprint, SemanticBridge, VerifiedSource, SourceVerificationResult | No (imported by others) | Confirmed |
| pipeline | pipeline.py | Semantic orchestrator: CSV load, publisher profiling, target analysis, semantic distance, bridge suggestions, preflight generation | Yes: `Pipeline.run_preflight(job)`, `Pipeline.load_jobs(csv)`, CLI `main()` | Confirmed |
| engine | engine.py | SERP intelligence: TargetIntentAnalyzer (5-probe research), TopicDiscovery, BridgeGravity, ThesisForge, SectionPlanner, ConstraintEnforcer, ArticleOrchestrator, AgentPromptRenderer | Yes: `create_blueprint_from_pipeline(...)`, `TargetIntentAnalyzer.build_research_plan_from_metadata(...)` | Confirmed |
| article_validator | article_validator.py | 11-check QA validation: word count, anchor presence/count/position, trustlinks, bullets, headings, forbidden phrases, language, SERP entities, paragraphs | Yes: `validate_article(...)` | Confirmed |
| SKILL | SKILL.md | Master orchestration: hard constraints HC-1 to HC-9, 8-phase flow, file roles, integration test | No (documentation) | Confirmed |
| SYSTEM | SYSTEM.md | Article rules: word count 750-900, anchor 250-550, trustlinks 1-2, forbidden AI phrases, style guide | No (documentation) | Confirmed |
| FLOWMAP | FLOWMAP.md | Swimlane execution flow: who does what in each phase, data flow diagram | No (documentation) | Confirmed |

### Dependency Graph

```
CSV file
  |
  v
pipeline.py ----imports----> models.py (JobSpec, Preflight, PublisherProfile, etc.)
  |                               ^
  | run_preflight()               |
  v                               |
Preflight data --------------------+
  |                               |
  | (agent patches metadata)      |
  v                               |
engine.py -----imports----------> models.py (PublisherProfile, TargetFingerprint)
  |
  | create_blueprint_from_pipeline()
  |   converts: PublisherProfile -> PublisherUniverse
  |   converts: TargetFingerprint -> TargetUniverse
  |
  v
ArticleBlueprint
  |
  | .to_agent_prompt()
  v
Agent writes article (SYSTEM.md rules) -> disk
  |
  v
article_validator.py -> validate_article() -> 11/11 PASS
```

---

## Invariants

| ID | Statement | Scope | Evidence | Status |
|----|-----------|-------|----------|--------|
| INV-001 | ALWAYS use BOTH pipeline.py AND engine.py for every article — never solo | pipeline, engine, agent | SKILL.md:HC-1, HC-5, HC-9; FLOWMAP.md:411-427 (anti-solo table) | Confirmed |
| INV-002 | ALWAYS execute all 5 SERP probes before blueprint generation | engine | SKILL.md:HC-2; engine.py:459-499 (5-probe design); FLOWMAP.md:204-208 (gate: probes_completed >= 3) | Confirmed |
| INV-003 | NEVER assume target metadata — always web_fetch/web_search first | agent, pipeline | SKILL.md:HC-3; FLOWMAP.md:128 (forbidden: agent hittar på metadata) | Confirmed |
| INV-004 | NEVER produce preflight with empty target title | pipeline, agent | SKILL.md:HC-4; FLOWMAP.md:127 (gate: title non-empty after patch) | Confirmed |
| INV-005 | NEVER output article text into conversation — always write to disk | agent | SKILL.md:HC-6, TB-1; FLOWMAP.md:315 (forbidden) | Confirmed |
| INV-006 | NEVER start next job before previous article passes QA | agent | SKILL.md:HC-7; FLOWMAP.md:349 (forbidden: gå till nästa utan QA) | Confirmed |
| INV-007 | ALWAYS read SYSTEM.md before first article in session | agent | SKILL.md:HC-8; FLOWMAP.md:34 (forbidden: starta jobb utan SYSTEM.md) | Confirmed |
| INV-008 | Article word count ALWAYS 750-900 words | article output | SYSTEM.md:13 (hårda gränser); SKILL.md:199; qa-template.md check 1; pipeline.py:237 (constraints) | Confirmed |
| INV-009 | Anchor text ALWAYS placed at word 250-550, exactly 1 occurrence | article output | SYSTEM.md:119-121; SKILL.md:200; pipeline.py:238-239 (constraints) | Confirmed |
| INV-010 | Trustlinks ALWAYS 1-2 verified external sources, placed BEFORE anchor in flow | article output | SYSTEM.md:128-133; SKILL.md:201-202 | Confirmed |
| INV-011 | Article structure ALWAYS max 1 heading (title only), no bullets/lists, flowing prose | article output | SYSTEM.md:97-101; SKILL.md:204-205 | Confirmed |
| INV-012 | NEVER use forbidden AI phrases (15+ banned patterns) | article output | SYSTEM.md:165-184 (full list); engine.py:1983-2008 (FORBIDDEN_PHRASES_SV/EN) | Confirmed |
| INV-013 | create_blueprint_from_pipeline() ALWAYS converts pipeline models to engine models | engine | engine.py:2701-2760; SKILL.md:179-183 (why bridge function is critical); FLOWMAP.md:278-281 | Confirmed |
| INV-014 | Pipeline degrades gracefully when aiohttp/beautifulsoup4/sentence-transformers missing | pipeline | pipeline.py:35-49 (try/except imports, HTTP_AVAILABLE, EMBEDDINGS_AVAILABLE flags) | Confirmed |
| INV-015 | ALWAYS minimum 4 substantive paragraphs (100-200 words each) | article output | SYSTEM.md:100; pipeline.py:244 | Confirmed |
| INV-016 | NEVER link to competitors, affiliate sites, or sites ranking same keywords as target | article output | SYSTEM.md:155-161 | Confirmed |
| INV-017 | SemanticEngine cosine similarity ALWAYS returns 0.5 fallback when embeddings unavailable | pipeline | pipeline.py:462-465 (model is None -> return 0.5) | Confirmed |
| INV-018 | PROPOSED: Trustlinks must always be deep links (not root domain) | article output | SYSTEM.md:130 says "DJUPLÄNK (ej rotdomän)"; pipeline.py:673 says "Varje trustlänk ska vara en DJUPLÄNK" | Proposed |

---

## Risk Zones

| ID | Type | Location | Impact | Recommended Gate | Status |
|----|------|----------|--------|-----------------|--------|
| RISK-001 | Boundary Hotspot | engine.py `create_blueprint_from_pipeline()` :2701-2760 | Bridge function is THE critical integration point. If conversion from pipeline models to engine models breaks, entire system disconnects. | P0-G5 (Contract Compatibility) | Active |
| RISK-002 | Contract Fragility | pipeline.py Preflight -> engine.py (agent patches target metadata in between) | Agent must manually patch `preflight.target.title` and `.meta_description`. If patch is wrong/empty, probes become meaningless. Gate in FLOWMAP.md but enforcement is agent-behavioral, not code. | P1 (target_metadata_non_empty check) | Active |
| RISK-003 | Silent Failure Zone | pipeline.py:35-49 optional imports (aiohttp, sentence-transformers) | System degrades silently — PublisherProfiler returns heuristic-only, SemanticEngine returns 0.5, TargetAnalyzer returns empty. No explicit error raised. Agent must know to patch. | P2 (degraded_mode_awareness) | Active |
| RISK-004 | Side-effect Concentration | pipeline.py PublisherProfiler._cache, TargetAnalyzer._cache | File I/O for caching. Cache corruption could return stale/wrong profiles. Cache uses MD5 of domain/URL as filename. | P2 (cache_integrity) | Active |
| RISK-005 | Stateful Core | engine.py ArticleOrchestrator uses internal state (phases tracked on blueprint) | Blueprint phases are tracked but not persisted. If orchestrator crashes mid-pipeline, no recovery. | P2 (blueprint_recovery) | Active |
| RISK-006 | Contract Fragility | engine.py AgentPromptRenderer.render() :2337 says "Minst 2, max 4" trustlinks | INCONSISTENCY: SYSTEM.md says 1-2 trustlinks, pipeline.py says 1-2, qa-template.md says 1-2. But AgentPromptRenderer says "Minst 2, max 4". This is a conflict. | P0-G4 (invariant preservation) | Active |
| RISK-007 | Boundary Hotspot | serp_provider.py requires aiohttp (hard import) | Unlike pipeline.py which gracefully degrades, serp_provider.py does `import aiohttp` at top level — will crash on import if aiohttp missing. Only used by runner.py. | P1 (import_safety) | Active |
| RISK-008 | Contract Fragility | CSV column headers ("publication_domain" vs "publisher_domain", "target_page" vs "target_url") | pipeline.py load_jobs() expects: job_number, publication_domain, target_page, anchor_text. But JobSpec fields are: job_number, publisher_domain, target_url, anchor_text. Mapping happens in load_jobs(). | P1 (csv_header_consistency) | Active |

---

## Confirmed vs Proposed Summary

| Category | Confirmed | Proposed | Total |
|----------|-----------|----------|-------|
| Invariants | 17 | 1 | 18 |
| Contracts | 8 | 0 | 8 |
| Module classifications | 8 | 0 | 8 |
| Risk zones | 8 | 0 | 8 |
