# BACOWR v6.2 — Flowmap (Technical Specification)

> Self-contained reference for the article generation pipeline.
> Any agent — zero-context or deep-context — can reproduce the workflow from this document alone.

---

## 1. System Overview

BACOWR generates SEO articles that link a **publisher** site to a **target** page via a natural anchor link. The system takes a CSV of jobs (publisher, target URL, anchor text) and produces one article per job, each with verified trust links and SERP-confirmed entities.

Three Python files divide responsibility:

| File | Owns | Does NOT do |
|------|------|-------------|
| **pipeline.py** | CSV parsing, publisher profiling, target fingerprinting, semantic bridge calculation | Topic discovery, section planning, blueprint generation |
| **engine.py** | SERP probe planning, topic discovery, bridge scoring, thesis forging, section planning, blueprint generation, agent prompt rendering | CSV parsing, HTTP fetching, web searching |
| **models.py** | All shared dataclasses (`JobSpec`, `Preflight`, `PublisherProfile`, `TargetFingerprint`, `SemanticBridge`) | No logic — pure data structures |

**Design principle:** engine plans, agent executes, pipeline provides data. The engine cannot call web_search or web_fetch — it generates queries for the agent to run, then analyzes the results the agent feeds back.

---

## 2. Data Models Quick Reference

Four objects flow through the pipeline. Each is created in one phase and consumed downstream.

### JobSpec (models.py)
```
job_number: int          publisher_domain: str
target_url: str          anchor_text: str
```
Created: Phase 1 (`pipe.load_jobs`). Consumed: Phase 2, 6.

### Preflight (models.py)
```
job: JobSpec
publisher: PublisherProfile    # .domain, .primary_topics, .confidence
target: TargetFingerprint      # .url, .title, .meta_description, .main_keywords, .topic_cluster
bridge: SemanticBridge         # .raw_distance, .distance_category, .recommended_angle,
                               #  .required_entities, .trust_link_topics, .trust_link_avoid
risk_level: RiskLevel
language: str                  # "sv" or "en"
warnings: List[str]
```
Created: Phase 2 (`pipe.run_preflight`). Patched: Phase 3 (agent adds target metadata). Consumed: Phase 4, 5, 6.

### TargetIntentProfile (engine.py)
```
target_url: str
meta_title: str                meta_description: str
head_entity: str               cluster_query: str
meta_desc_predicate: str
probes: List[SerpProbe]        # 5 probes, each with .query, .step_name, .purpose, .top_results
probes_completed: int
core_entities: List[str]       # Entities that DEFINE target's topical authority
cluster_entities: List[str]    # Related entities for TA
lsi_terms: List[str]           # LSI terms from SERP analysis
entities_to_weave: List[str]   # Entities to include in article
ideal_bridge_direction: str    # What the context link should conceptually achieve
confidence: float
```
Created: Phase 4 (`analyzer.build_research_plan_from_metadata`). Enriched: Phase 5 (after each `analyze_probe_results` call). Consumed: Phase 6, 7.

### ArticleBlueprint (engine.py)
```
job_number: int                publisher_domain: str
target_url: str                anchor_text: str
publisher: PublisherUniverse   target: TargetUniverse
gap: GapAnalysis               chosen_topic: TopicCandidate
bridges: List[ContextBridge]   thesis: ArticleThesis
sections: List[SectionPlan]    # Each has .role, .target_words, .contains_anchor, .entities_to_cover
red_thread: RedThread          constraints: List[ConstraintResult]
phase: ArticlePhase            overall_risk: RiskLevel
```
Created: Phase 6 (`create_blueprint_from_pipeline`). Consumed: Phase 7 (via `bp.to_agent_prompt()`).

---

## 3. Phase-by-Phase Specification

### Phase 0 — Session Init

**Owner:** Agent
**Input:** Project directory files
**Action:** Read SKILL.md, INIT.md, CLAUDE.md, SYSTEM.md (in that order). Import pipeline.py, models.py, engine.py.
**Output:** Agent has all rules and constraints in context
**Contract:** Agent can state: word count 750–900, anchor position 250–550, at least 3 forbidden AI phrases
**Failure mode:** Agent produces articles that violate hard constraints

---

### Phase 1 — Load Jobs

**Owner:** pipeline.py
**Input:** CSV file path (string)
**Call:**
```python
from pipeline import Pipeline, PipelineConfig
pipe = Pipeline(PipelineConfig())
jobs = pipe.load_jobs('jobs.csv')  # → List[JobSpec]
```
**Output:** `List[JobSpec]` — one per CSV row
**Contract:** Every JobSpec has all four fields non-empty. Malformed rows are skipped with a warning.
**Failure mode:** Missing CSV → `sys.exit(1)`. Malformed rows → skipped, count printed.

Column name normalization handles variants: `job_id`/`job_Id`/`job_number`/`job_nummer`, `publication_domain`/`publisher_domain`/`publisher`, `link_target_page`/`target_page`/`target_url`, `anchor_text`/`anchor`. Pipe delimiters (`|`) and malformed URLs (`https:/` → `https://`) are auto-fixed.

---

### Phase 2 — Preflight

**Owner:** pipeline.py (async)
**Input:** `JobSpec`
**Call:**
```python
import asyncio
preflight = asyncio.run(pipe.run_preflight(job))  # → Preflight
```
**Output:** `Preflight` with three sub-analyses:

| Sub-step | Class | What it does |
|----------|-------|-------------|
| `PublisherProfiler.analyze(domain)` | `PublisherProfile` | Domain name heuristics + optional homepage fetch → primary_topics |
| `TargetAnalyzer.analyze(url)` | `TargetFingerprint` | HTTP fetch + HTML parse → title, description, keywords. **Empty without aiohttp.** |
| `SemanticEngine.analyze(publisher, target, anchor)` | `SemanticBridge` | Cosine similarity (or 0.5 fallback) → distance, bridge suggestions, trust_link_topics |

**Contract:** `preflight.publisher.primary_topics` is non-empty. `preflight.target.title` may be empty (patched in Phase 3).
**Failure mode:** Without `aiohttp`/`beautifulsoup4`, target is empty and distance defaults to 0.5. This is expected — Phase 3 compensates.

---

### Phase 3 — Metadata Acquisition

**Owner:** Agent (manual)
**Input:** `preflight.target.url` from Phase 2
**Action:**
```
1. web_fetch(target_url)  — or if blocked:
2. web_search("domain.se anchor_text")
3. Extract: title, meta_description, url from result
4. Patch preflight:
     preflight.target.title = fetched_title
     preflight.target.meta_description = fetched_description
     preflight.target.url = fetched_url  # if canonical differs
```
**Output:** `preflight.target` with `.title` and `.meta_description` populated
**Contract:** `preflight.target.title` is non-empty after this phase. Without it, Phase 4 produces meaningless probes.
**Failure mode:** If agent skips this, all downstream SERP research is based on empty strings.

---

### Phase 4 — Probe Generation

**Owner:** engine.py
**Input:** `url`, `title`, `description` — all from patched `preflight.target`
**Call:**
```python
from engine import TargetIntentAnalyzer
analyzer = TargetIntentAnalyzer()
plan = analyzer.build_research_plan_from_metadata(
    url=preflight.target.url,
    title=preflight.target.title,
    description=preflight.target.meta_description,
    h1=""  # optional, defaults to title if empty
)
# plan.probes → List[SerpProbe], exactly 5 items
```
**Output:** `TargetIntentProfile` with 5 `SerpProbe` objects, each containing `.query` and `.purpose`

**The 5 probes and why each exists:**

| # | step_name | Query source | Purpose |
|---|-----------|-------------|---------|
| 1 | `head_entity` | 1–2 core words extracted from meta title | Establish Google's head intent for the target's main entity |
| 2 | `cluster_search` | Long-tail variant derived from meta title + description | Map cluster/related entities Google associates with the head entity |
| 3 | `literal_title` | Exact meta title string | Verify target's intent alignment — does Google agree with the target's positioning? |
| 4 | `desc_predicate` | Action/predicate extracted from meta description | Understand the transactional/commercial intent layer |
| 5 | `literal_description` | First 150 chars of meta description (or URL fallback) | Complete the entity/cluster map with final cross-reference |

**Contract:** Exactly 5 probes, all with non-empty `.query`.
**Failure mode:** Empty metadata → probes contain empty or URL-derived queries, producing thin SERP data.

---

### Phase 5 — SERP Execution + Trust Link Discovery

**Owner:** Agent (executes searches) + engine.py (analyzes results)

This is the most complex phase. It has two sub-protocols.

#### Sub-protocol A: SERP Probes (5 searches)

For each of the 5 probes from Phase 4:

```python
# Agent executes:
results = web_search(plan.probes[i].query)

# Agent feeds results back to engine:
plan = analyzer.analyze_probe_results(
    plan,                    # TargetIntentProfile (mutated in place)
    i + 1,                   # probe_step: int (1-indexed)
    results                  # List[Dict] with keys: title, description, url
)
```

`analyze_probe_results` does:
1. Parses top 3 results into `SerpSnapshot` objects
2. Extracts entities from each result's title and description
3. Computes entity overlap between SERP results and target metadata
4. Discovers new entities not on the target page
5. After `probes_completed >= 3`, runs `_synthesize()` which populates:
   - `core_entities` — entities that define the target's topical authority
   - `cluster_entities` — related entities for TA
   - `lsi_terms` — terms Google expects to see
   - `entities_to_weave` — entities the article should include
   - `ideal_bridge_direction` — what the context link should conceptually achieve

#### Sub-protocol B: Trust Link Discovery (2 searches)

After all 5 SERP probes:

```python
# Step 1: Generate trust link search queries
tl_queries = analyzer.build_trustlink_queries(
    preflight.bridge,           # SemanticBridge (has .trust_link_topics)
    plan,                       # TargetIntentProfile (has .head_entity)
    preflight.target.title      # str — fallback if bridge/plan are thin
)
# Returns: List[str], max 3 queries
# Query pattern: bridge-aware — combines trust_link_topics with SERP core/cluster entities
# (v6.4: no longer hardcodes "rapport forskning" suffix)

# Step 2: Agent searches
trustlink_candidates = []
for q in tl_queries:
    trustlink_candidates.extend(web_search(q))

# Step 3: Filter and rank (@staticmethod — can also call as TargetIntentAnalyzer.select_trustlinks)
selected = analyzer.select_trustlinks(
    candidates=trustlink_candidates,     # List[Dict] with title, description, url
    trust_topics=preflight.bridge.trust_link_topics,
    avoid_domains=preflight.bridge.trust_link_avoid,
    target_domain=target_domain,         # extracted from job.target_url
    publisher_domain=job.publisher_domain
)
# Returns: List[Dict] sorted by score (best first)
```

`select_trustlinks` filters out: target domain, publisher domain, avoid-list domains, root-only URLs (non-deeplinks). Remaining candidates are scored by topic keyword overlap + deeplink bonus, sorted best-first.

**Contract:** `plan.probes_completed >= 3`. Trust link candidates are filtered and ranked.
**Fallback:** If SERP data is thin, call `analyzer.synthesize_from_plan(plan)` — generates guidance from metadata alone (confidence=0.5).
**Failure mode:** Skipping this phase means the article lacks SERP-confirmed entities and has no verified trust links.

---

### Phase 6 — Blueprint Generation (The Bridge Function)

**Owner:** engine.py
**Input:** Pipeline data (publisher, target, bridge) + job identifiers
**Call:**
```python
from engine import create_blueprint_from_pipeline
bp = create_blueprint_from_pipeline(
    job_number=job.job_number,
    publisher_domain=job.publisher_domain,
    target_url=job.target_url,
    anchor_text=job.anchor_text,
    publisher_profile=preflight.publisher,       # PublisherProfile (models.py)
    target_fingerprint=preflight.target,         # TargetFingerprint (models.py)
    semantic_bridge=preflight.bridge             # SemanticBridge (models.py)
)

# Attach SERP data from Phase 5:
bp.target.intent_profile = plan  # TargetIntentProfile

# Get the writing prompt:
prompt = bp.to_agent_prompt()  # → str (complete agent instructions)
```

**What happens inside `create_blueprint_from_pipeline`:**

1. **Model conversion** — Converts pipeline models to engine models:
   - `PublisherProfile` (models.py) → `PublisherUniverse` (engine.py)
   - `TargetFingerprint` (models.py) → `TargetUniverse` (engine.py)
2. **Delegates to `ArticleOrchestrator.create_blueprint()`** which runs:
   - SERP intelligence synthesis (if not already attached)
   - Gap analysis (semantic distance + overlap entities)
   - Topic discovery (bridge concepts → topic candidates → best pick)
   - Bridge scoring (gravity-weighted: semantic_pull 0.35 + factual_mass 0.25 + topic_fit 0.25 + uniqueness 0.15)
   - Thesis forging (one sentence driving the article)
   - Section planning (HOOK → ESTABLISH → DEEPEN → ANCHOR → PIVOT → RESOLVE)
   - Red thread validation (narrative coherence)
   - Constraint checking (hard/soft/forbidden)

**Output:** `ArticleBlueprint` with topic, thesis, bridges, sections, constraints, and a complete agent prompt.
**Contract:** `chosen_topic` exists, `bridges >= 1`, `sections >= 3`, `prompt > 200 chars`.
**Failure mode:** Without pipeline data, the engine falls back to minimal profiles (domain-name heuristics only, confidence=0.5). The article will work but lack publisher-specific nuance.

---

### Phase 7 — Article Writing

**Owner:** Agent
**Input:** `bp.to_agent_prompt()` + SYSTEM.md rules + SERP entities from Phase 5 + trust links from Phase 5
**Action:**
1. Follow the blueprint prompt for topic, thesis, section structure
2. Weave in SERP-confirmed entities from `plan.entities_to_weave`
3. Place 1–2 trust links as `[text](url)` **before** the anchor link, **never** in the same paragraph
4. Place exactly 1 anchor link `[anchor_text](target_url)` at word position 250–550
5. Follow SYSTEM.md: 750–900 words, max 1 heading, no bullets, no AI-smell phrases, Swedish, >=4 paragraphs
6. Save to `articles/job_NN.md` (NN = zero-padded job_number)

**Contract:** File exists on disk, contains exactly 1 anchor link at correct position, contains 1–2 trust link hyperlinks.
**Failure mode:** Article violates hard constraints → caught in Phase 8 QA.

---

### Phase 8 — QA Verification

**Owner:** Agent
**Input:** Article file + anchor_text + target_url
**Action:** Run qa-template.md script — 11 binary checks:

| # | Check | Pass criteria |
|---|-------|--------------|
| 1 | Word count | 750–900 |
| 2 | Anchor text exact match | Found in article |
| 3 | Anchor position | Word 250–550 |
| 4 | Anchor count | Exactly 1 |
| 5 | No bullets/lists | True |
| 6 | Trust links | 1–2 count |
| 7 | AI smell | 0 forbidden phrases |
| 8 | Headings | Max 1 |
| 9 | Language | Swedish |
| 10 | SERP entities | >= 4 woven in |
| 11 | Paragraphs | >= 4 |

**Contract:** 11/11 PASS.
**On failure:** Agent revises the **specific failing section**, not the entire article. Then re-runs QA.
**After pass:** Proceed to next job (loop back to Phase 2 with `jobs[i+1]`).

---

## 4. The Bridge Function

`create_blueprint_from_pipeline()` in engine.py exists because pipeline.py and engine.py use **different data models** for the same concepts:

| Concept | pipeline.py / models.py | engine.py |
|---------|------------------------|-----------|
| Publisher | `PublisherProfile` | `PublisherUniverse` |
| Target | `TargetFingerprint` | `TargetUniverse` |
| Bridge suggestion | `BridgeSuggestion` | `ContextBridge` |

The bridge function converts pipeline models → engine models, then delegates to `ArticleOrchestrator.create_blueprint()`. Without it:

- Engine gets no publisher topics, no semantic distance, no bridge suggestions from the pipeline
- Pipeline's analysis is wasted — never reaches the blueprint
- The article topic will be based on domain-name heuristics alone instead of actual publisher profiling

**Never skip this function.** Never call `ArticleOrchestrator.create_blueprint()` directly unless you are deliberately bypassing pipeline data.

---

## 5. Upgrade Guide

### "I want to change how SERP probes work"
Modify **only**: `TargetIntentAnalyzer._build_probes()` in engine.py (line ~669).
Do **not** touch: `build_research_plan_from_metadata`, `analyze_probe_results`, pipeline.py.
The probe structure (`SerpProbe` dataclass) is stable — add fields if needed, never remove existing ones.

### "I want to add a new CSV column"
Modify **only**: `_normalize_job()` in pipeline.py (add new `pick()` call), `JobSpec` in models.py (add field).
Do **not** touch: engine.py, `_parse_textjobs()` (it's delimiter-agnostic and forwards all columns).

### "I want to change trust link logic"
Modify: `TargetIntentAnalyzer.build_trustlink_queries()` and `select_trustlinks()` in engine.py.
Also consider: `SemanticEngine._trust_link_topics()` in pipeline.py (generates bridge-aware topics using anchor_text and bridge_concept).
The contract: `build_trustlink_queries` returns `List[str]` (max 3), `select_trustlinks` returns `List[Dict]` sorted best-first.

### "I want to change the article structure (sections)"
Modify **only**: `SectionPlanner.plan()` in engine.py.
Do **not** touch: `ArticleBlueprint` fields, `to_agent_prompt()`, pipeline.py.
Section roles are defined in `SectionRole` enum: HOOK, ESTABLISH, DEEPEN, BRIDGE, ANCHOR, PIVOT, RESOLVE.

### "I want to change publisher profiling"
Modify **only**: `PublisherProfiler` in pipeline.py (domain heuristics, homepage fetch).
Do **not** touch: `PublisherUniverse` in engine.py (it receives converted data via the bridge function).
Also update `ArticleOrchestrator._minimal_publisher()` in engine.py if you add new topic categories — it has a duplicate `domain_hints` dict.

### "I want to change article constraints (word count, anchor position, etc.)"
Modify **only**: `ConstraintEnforcer` in engine.py + SYSTEM.md.
Both must agree. The QA template (qa-template.md) also checks these — keep all three in sync.

---

*BACOWR v6.2 — 2026-02-14*
*Specification, not narrative. Every signature verified against source code.*
