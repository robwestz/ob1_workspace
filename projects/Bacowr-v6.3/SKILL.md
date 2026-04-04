---
name: bacowr-pipeline-v62
description: |
  BACOWR v6.2 full-stack pipeline for backlink-optimized content articles.
  This skill MUST be used whenever the agent produces BACOWR articles.
  It enforces that ALL system files (pipeline.py, models.py, engine.py,
  SYSTEM.md, CLAUDE.md, INIT.md) are actively used and interconnected.
  The agent NEVER writes solo — every article requires proven data from
  pipeline preflight + engine SERP intelligence + QA verification.
  Trigger words: artiklar, jobb, preflight, blueprint, kontextlänk,
  trustlink, backlink, CSV, batch, BACOWR.
---

# BACOWR v6.2 Pipeline Skill

## Purpose

This skill ensures the BACOWR pipeline runs **end-to-end with zero bottlenecks**.
Every file must be active. Every subsystem must produce data that flows into the next.
The agent NEVER plays solo — it orchestrates pipeline.py + engine.py + SYSTEM.md rules.

## COMPOUND Integration

This skill uses COMPOUND.md as execution overlay. At every phase transition:
- **COMPOUND REGISTER** after completing each phase
- **GAP SCAN** before starting each phase  
- **CONTEXT REFRESH** after every 3rd article in batch mode

## Hard Constraints (NEVER violate)

```
HC-1: NEVER write an article without BOTH pipeline preflight AND engine blueprint
HC-2: NEVER skip SERP probe execution — all 5 probes must be searched
HC-3: NEVER assume metadata — always web_fetch/web_search the target URL first
HC-4: NEVER produce preflight with empty target title or empty probe queries
HC-5: NEVER bypass engine.py even if the agent "knows" what to write
HC-6: NEVER output article text into conversation — always write to disk
HC-7: NEVER start next job before previous article passes QA
HC-8: NEVER skip reading SYSTEM.md rules before first article in session
HC-9: NEVER use pipeline.py OR engine.py alone — both must contribute to every article
```

## File Roles — ALL MANDATORY

Every file has a specific role. An article produced without ALL files active is REJECTED.

| File | Role | What it provides | Verification |
|------|------|-----------------|--------------|
| **INIT.md** | Session bootstrap | Read order, system overview | Agent reads FIRST |
| **CLAUDE.md** | Agent instructions | Commands, batch mode, file paths | Agent reads SECOND |
| **SYSTEM.md** | Article rules | Word count, anchor rules, AI smell bans, style | Agent reads BEFORE first article |
| **pipeline.py** | Semantic orchestrator | CSV→JobSpec, publisher profiling, preflight, prompt template | `run_preflight()` called per job |
| **models.py** | Data structures | JobSpec, Preflight, PublisherProfile, TargetFingerprint | Imported by pipeline.py |
| **engine.py** | SERP intelligence | 5 probes, entity extraction, blueprint, bridges, topic discovery | `build_research_plan_from_metadata()` + `create_blueprint_from_pipeline()` |
| **SKILL.md** | Execution constraints | This file — hard constraints, phase flow, QA gates | Agent follows this flow |

### File Integration Map

```
CSV file
  ↓ pipeline.load_jobs()
JobSpec (models.py)
  ↓ pipeline.run_preflight()
Preflight (models.py) → publisher profile, bridge suggestion, prompt template
  ↓ agent web_fetch/web_search
Target metadata (title, description) → patches preflight.target
  ↓ engine.build_research_plan_from_metadata()
TargetIntentProfile → 5 probes with search queries
  ↓ agent executes 5× web_search
SERP results → fed to engine.analyze_probe_results()
  ↓ engine.create_blueprint_from_pipeline(preflight data)
ArticleBlueprint → topic, bridges, sections, agent prompt
  ↓ agent writes article following SYSTEM.md rules
Article on disk → QA verification
```

## The 8-Phase Pipeline

### Phase 0: Session Init (once per session)

```
Agent reads: INIT.md → CLAUDE.md → SYSTEM.md
Agent loads: pipeline.py, models.py, engine.py
Agent runs: integration test (if first session)
```

**Gate:** Agent must be able to state the word count rule, anchor position rule,
and at least 3 banned AI-smell phrases from SYSTEM.md. If not → re-read.

### Phase 1: Job Loading (1 tool call per batch)

```python
import sys; sys.path.insert(0, '/path/to/bacowr')
import asyncio
from pipeline import Pipeline, PipelineConfig
from models import JobSpec

pipe = Pipeline(PipelineConfig())
jobs = pipe.load_jobs('job_list.csv')
# jobs[0] = JobSpec(job_number=1, publisher_domain='...', target_url='...', anchor_text='...')
```

**Gate:** `len(jobs) >= 1` and all jobs have non-empty publisher_domain, target_url, anchor_text.

### Phase 2: Preflight (1 Python call per job)

```python
preflight = await pipe.run_preflight(job)  # or asyncio.run(pipe.run_preflight(job))
```

This produces:
- `preflight.publisher` → PublisherProfile with primary_topics, domain, language
- `preflight.target` → TargetFingerprint (EMPTY without web dependencies — agent patches this)
- `preflight.bridge` → SemanticBridge with recommended_angle, required_entities, trust_link_topics

**Gate:** `preflight.publisher` is not None and has `primary_topics`.

### Phase 3: Metadata Acquisition (1-2 tool calls)

```
Agent → web_fetch(target_url) → extract: title, meta_description
If web_fetch fails → web_search(domain + anchor) → extract from SERP snippet
```

**CRITICAL:** Patch preflight with agent-fetched data:
```python
preflight.target.title = fetched_title
preflight.target.meta_description = fetched_description
preflight.target.main_keywords = [extracted, keywords]
```

**Gate:** `preflight.target.title` is non-empty after patching.

### Phase 4: Probe Generation (1 Python call)

```python
from engine import TargetIntentAnalyzer
analyzer = TargetIntentAnalyzer()
plan = analyzer.build_research_plan_from_metadata(
    url=job.target_url,
    title=preflight.target.title,         # agent-patched
    description=preflight.target.meta_description  # agent-patched
)
```

**Gate:** `len(plan.probes) == 5` and all probes have non-empty `.query`.

### Phase 5: SERP Execution + Trust Link Discovery (5+2 web_search calls)

Execute each probe's `.query` via web_search. For each result set, feed back:

```python
for probe in plan.probes:
    results = web_search(probe.query)  # agent tool call
    serp_data = [{"title": r.title, "description": r.desc, "url": r.url} for r in results[:3]]
    plan = analyzer.analyze_probe_results(plan, probe.step, serp_data)

# Trust link discovery (after SERP probes)
tl_queries = analyzer.build_trustlink_queries(preflight.bridge, plan, preflight.target.title)
trustlink_candidates = []
for q in tl_queries:
    trustlink_candidates.extend(web_search(q))
# Use analyzer.select_trustlinks() to filter and rank candidates
```

**Gate:** `plan.probes_completed >= 3`. If thin data → `analyzer.synthesize_from_plan(plan)`.

### Phase 6: Blueprint Generation (1 Python call)

```python
from engine import create_blueprint_from_pipeline

blueprint = create_blueprint_from_pipeline(
    job_number=job.job_number,
    publisher_domain=job.publisher_domain,
    target_url=job.target_url,
    anchor_text=job.anchor_text,
    publisher_profile=preflight.publisher,      # from pipeline
    target_fingerprint=preflight.target,        # patched by agent
    semantic_bridge=preflight.bridge            # from pipeline
)
blueprint.target.intent_profile = plan  # attach SERP intelligence from engine
prompt = blueprint.to_agent_prompt()
```

**Why `create_blueprint_from_pipeline`:** This is the BRIDGE FUNCTION that converts
pipeline.py's models (PublisherProfile, TargetFingerprint, SemanticBridge) into
engine.py's models (PublisherUniverse, TargetUniverse). It ensures both systems
contribute to the blueprint. Using `ArticleOrchestrator.create_blueprint()` directly
would SKIP pipeline's semantic analysis.

**Gate:** Blueprint has `chosen_topic`, `bridges >= 1`, `sections >= 3`.

### Phase 7: Trustlinks + Article Writing

1. Search for 1-2 trustlink sources using blueprint bridge search queries
2. Write article to disk following SYSTEM.md rules (see references/system-rules.md)
3. Use entities from `plan` (SERP intelligence) woven into article text
4. Use publisher voice from `preflight.publisher.primary_topics`

```
Output: /home/claude/articles/article_{job_number:03d}.md
```

**Article rules (from SYSTEM.md):**
- 750-900 words
- Anchor link: exact text from CSV, position word 250-550, varies across articles
- Trustlinks: 1-2 as actual `[text](url)` hyperlinks, 3rd-party domains only
- Trustlinks placed BEFORE anchor in article flow
- No AI smell phrases (see references/system-rules.md)
- No bullets, no numbered lists — prose only
- Maximum 1 heading (title only), rest is flowing paragraphs
- Swedish unless specified otherwise

### Phase 8: QA Verification

Run all 11 checks. ALL must pass.

| # | Check | Rule | Fail → |
|---|-------|------|--------|
| 1 | Word count | 750-900 | Revise |
| 2 | Anchor text exact | Matches CSV | Rewrite anchor |
| 3 | Anchor position | Word 250-550 | Move anchor |
| 4 | Anchor count | Exactly 1 | Remove duplicates |
| 5 | No bullets/lists | Zero bullets or numbered lists | Rewrite as prose |
| 6 | Trustlinks | 1-2 unique 3rd-party hyperlinks | Add sources |
| 7 | AI smell | Zero banned phrases | Rewrite flagged sentences |
| 8 | Headings | ≤1 (title only) | Remove extra headings |
| 9 | Language | Swedish (unless specified) | Translate |
| 10 | SERP entities | ≥4 from probe results | Weave in entities |
| 11 | Paragraphs | ≥4 substantive paragraphs | Expand |

**Gate:** 11/11 pass. See references/qa-template.md for script format. Save QA to `/home/claude/articles/qa_{job_number:03d}.md`.

## Token Budget

```
TB-1: Article text goes to DISK, never conversation
TB-2: QA is pass/fail table only, no verbose explanations
TB-3: Target: ≤50 tokens/word in production (measured: total_tokens / word_count)
TB-4: Between jobs: only job metadata in conversation, not previous article text
```

## Batch Mode

```python
jobs = pipe.load_jobs('job_list.csv')
for job in jobs:
    # Phase 2-8 per job
    # HC-7: verify previous QA passed before starting next
    # Track progress in /home/claude/articles/batch_progress.json
```

## Error Recovery

| Error | Recovery |
|-------|----------|
| web_fetch fails | web_search fallback for metadata |
| pipeline.run_preflight() is async | Use `asyncio.run()` wrapper |
| Empty probes | Verify metadata non-empty, try `synthesize_from_plan()` |
| Blueprint has no topic | Pass publisher_domain as hint, check target metadata |
| Missing trustlinks | Expand bridge search, try related terms from plan |
| Article fails QA | Fix specific failing check ONLY, don't rewrite all |
| Dependencies missing | Expected — pipeline degrades gracefully, agent patches metadata |

## Integration Verification Test

Before production, run this Python to verify all systems connect:

```python
import sys, asyncio
sys.path.insert(0, '/path/to/bacowr')
from pipeline import Pipeline, PipelineConfig
from models import JobSpec
from engine import TargetIntentAnalyzer, create_blueprint_from_pipeline

async def verify():
    job = JobSpec(1, 'test.se', 'https://example.se/page', 'test')
    pipe = Pipeline(PipelineConfig())
    pf = await pipe.run_preflight(job)
    assert pf.publisher is not None, "FAIL: pipeline publisher"
    pf.target.title = "Test Page Title"
    pf.target.meta_description = "Test description"
    
    analyzer = TargetIntentAnalyzer()
    plan = analyzer.build_research_plan_from_metadata(
        url=job.target_url, title=pf.target.title, description=pf.target.meta_description
    )
    assert len(plan.probes) == 5, "FAIL: engine probes"
    
    bp = create_blueprint_from_pipeline(
        job.job_number, job.publisher_domain, job.target_url, job.anchor_text,
        pf.publisher, pf.target, pf.bridge
    )
    assert bp.chosen_topic is not None, "FAIL: blueprint topic"
    assert len(bp.sections) >= 3, "FAIL: blueprint sections"
    print("ALL SYSTEMS VERIFIED ✓")

asyncio.run(verify())
```

## What This Replaces

| v6.1 failure | v6.2 solution |
|-------------|---------------|
| Agent wrote solo (no engine.py) | HC-1 + HC-5: blueprint required |
| pipeline.py crashed on import | Graceful degradation, agent patches metadata |
| models.py unused | Pipeline uses models for preflight, engine converts via bridge function |
| SYSTEM.md not read | HC-8: must read before first article |
| CLAUDE.md said "skip engine.py" | Removed — engine is mandatory |
| Empty preflight files | Agent web_fetch patches target data |
| Articles in conversation | HC-6: disk only |
| No QA gates | Phase 8: 11 hard checks |
| 673 tok/word waste | TB-1-3: target ≤50 tok/word |
