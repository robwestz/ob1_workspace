# BACOWR v6.2

**Bridge-Anchored Content Orchestration with Research** — an AI-agent pipeline that produces SERP-backed, editorially natural articles with embedded anchor links and verified trust sources.

BACOWR takes a CSV job list (publisher domain, target URL, anchor text) and orchestrates a multi-phase pipeline that profiles the publisher, fingerprints the target page, discovers semantic bridges between them, executes SERP research, and generates a structured blueprint. An AI agent then writes the article following strict editorial constraints — verified by an automated 11-check QA gate.

---

## Architecture

```
CSV Job List
    │
    ▼
┌──────────────┐     ┌──────────────┐
│  pipeline.py │────▶│   models.py  │
│  Preflight   │     │  Data Models │
└──────┬───────┘     └──────────────┘
       │
       │  PublisherProfile + TargetFingerprint + SemanticBridge
       ▼
┌──────────────┐
│  engine.py   │
│  Blueprint   │──▶ TopicDiscovery ──▶ BridgeGravity ──▶ ThesisForge
│  Generation  │──▶ SectionPlanner ──▶ ConstraintEnforcer
└──────┬───────┘
       │
       │  ArticleBlueprint + AgentPrompt
       ▼
┌──────────────────┐     ┌─────────────────────┐
│  Agent writes    │────▶│ article_validator.py │
│  article to disk │     │ 11-check QA gate     │
└──────────────────┘     └─────────────────────┘
```

**No component works alone.** Pipeline and engine must both contribute to every article (HC-1, HC-9).

---

## 8-Phase Pipeline

| Phase | Name | What Happens |
|:-----:|------|-------------|
| 0 | **Session Init** | Load modules, read SYSTEM.md rules |
| 1 | **Job Loading** | Parse CSV → `JobSpec` objects |
| 2 | **Preflight** | Profile publisher, fingerprint target, compute semantic bridge |
| 3 | **Metadata Patch** | Agent fetches real target metadata via web search |
| 4 | **Probe Generation** | Engine creates 5 SERP research queries |
| 5 | **SERP Execution** | Agent runs probes + discovers trust link candidates |
| 6 | **Blueprint** | Engine builds topic, thesis, section plan, constraints |
| 7 | **Article Writing** | Agent writes article following blueprint + SYSTEM.md rules |
| 8 | **QA Verification** | 11 binary checks — all must PASS |

---

## Hard Constraints

| ID | Rule |
|----|------|
| HC-1 | Always use BOTH pipeline.py AND engine.py — never solo |
| HC-2 | Always execute all 5 SERP probes before blueprint generation |
| HC-3 | Never assume metadata — always fetch the target URL first |
| HC-4 | Never produce preflight with empty target title |
| HC-5 | Never bypass engine.py even if the agent "knows" what to write |
| HC-6 | Never output article text into conversation — write to disk |
| HC-7 | Never start next job before previous article passes QA |
| HC-8 | Always read SYSTEM.md before first article in session |
| HC-9 | Never use pipeline.py OR engine.py alone — both contribute |

---

## Article Rules

| Requirement | Value |
|-------------|-------|
| Word count | 750–900 |
| Anchor link | Exactly 1, at word position 250–550 |
| Trust links | 1–2 verified third-party sources, placed before anchor |
| Structure | Max 1 heading (title), no bullets/lists, flowing prose |
| Paragraphs | Minimum 4 substantive (100–200 words each) |
| SERP entities | Minimum 4 from probe results, woven naturally |
| Forbidden phrases | Zero AI-smell patterns ("I en värld där...", "Sammanfattningsvis", etc.) |
| Language | Swedish for .se/.nu domains, English for .co.uk/.com |

---

## Quick Start

```bash
# Clone
git clone https://github.com/robwestz/Bacowr-v6.3.git
cd Bacowr-v6.3

# Install dependencies
pip install -r requirements.txt

# Run tests
python -m pytest tests/ -v
```

### Produce an article

```python
from pipeline import Pipeline, PipelineConfig
from engine import create_blueprint_from_pipeline, TargetIntentAnalyzer
import asyncio

# Phase 1–2: Load job and run preflight
pipe = Pipeline(PipelineConfig())
jobs = pipe.load_jobs('textjobs_list.csv')
job = jobs[0]
preflight = asyncio.run(pipe.run_preflight(job))

# Phase 3: Patch metadata (agent does web_search)
preflight.target.title = "Actual Page Title"
preflight.target.meta_description = "Actual meta description"

# Phase 4: Generate SERP probes
analyzer = TargetIntentAnalyzer()
plan = analyzer.build_research_plan_from_metadata(
    url=preflight.target.url,
    title=preflight.target.title,
    description=preflight.target.meta_description,
)
# plan.probes → 5 queries for the agent to search

# Phase 6: Create blueprint
bp = create_blueprint_from_pipeline(
    job_number=job.job_number,
    publisher_domain=job.publisher_domain,
    target_url=job.target_url,
    anchor_text=job.anchor_text,
    publisher_profile=preflight.publisher,
    target_fingerprint=preflight.target,
    semantic_bridge=preflight.bridge,
)
prompt = bp.to_agent_prompt()

# Phase 7–8: Agent writes article, then validates with article_validator.py
```

---

## QA Validation

The `article_validator.py` module runs 11 binary checks on every article:

| # | Check | Criteria |
|---|-------|----------|
| 1 | Word count | 750–900 words |
| 2 | Anchor present | `[anchor_text](target_url)` exists |
| 3 | Anchor count | Exactly 1 occurrence |
| 4 | Anchor position | Between word 250 and 550 |
| 5 | Trust links | 1–2 external links, before anchor, not to target domain |
| 6 | No bullets | Zero bullet points or numbered lists |
| 7 | Headings | Maximum 1 heading (title only) |
| 8 | Forbidden phrases | Zero AI-smell patterns |
| 9 | Language | Matches expected language (sv/en) |
| 10 | SERP entities | Minimum 4 domain-specific entities |
| 11 | Paragraphs | Minimum 4 substantive paragraphs |

All 11 must PASS before an article is accepted.

---

## Project Structure

```
├── engine.py                  # SERP intelligence + blueprint generation (~2800 lines)
├── pipeline.py                # Semantic orchestration + preflight (~966 lines)
├── models.py                  # Data models: JobSpec, Preflight, SemanticBridge, etc.
├── article_validator.py       # 11-check QA validation
├── textjobs_list.csv          # Job data (20 jobs)
├── requirements.txt           # Dependencies
│
├── SKILL.md                   # Master orchestration: hard constraints + 8 phases
├── SYSTEM.md                  # Article rules: word count, anchor, style
├── CLAUDE.md                  # Agent instructions + command reference
├── INIT.md                    # Session bootstrap + crash recovery
├── FLOWMAP.md                 # Swimlane execution flow
├── RUNBOOK.md                 # Zero-context agent step-by-step guide
├── qa-template.md             # QA script specification
│
├── structured-upgrade/        # SOT (Source of Truth) framework
│   ├── manifest.yaml          # Framework configuration
│   ├── system_truth.md        # System invariants + risk zones
│   ├── contracts.md           # 8 module boundary contracts
│   ├── gates.md               # P0/P1/P2 stop-rules
│   ├── state.md               # Iteration log + session memory
│   ├── bootstrap.md           # Cold/warm start protocol
│   └── system_protocol.md     # Agent operating rules
│
└── tests/                     # 222 tests
    ├── conftest.py            # Shared fixtures
    ├── test_engine.py         # Engine unit tests
    ├── test_engine_components.py  # Engine sub-component tests
    ├── test_pipeline.py       # Pipeline unit tests
    ├── test_pipeline_integration.py  # Pipeline integration tests
    ├── test_models.py         # Data model tests
    ├── test_article_validator.py  # QA validator tests
    └── test_e2e_pipeline.py   # End-to-end: CSV → Blueprint
```

---

## Test Suite

```
222 tests | 220 passed | 2 skipped
```

The 2 skipped tests expect gibberish article fixtures in `text-output/` (excluded from repo).

```bash
# Run all tests
python -m pytest tests/ -v

# Run specific module
python -m pytest tests/test_engine.py -v

# Run with coverage summary
python -m pytest tests/ --tb=short
```

---

## Dependencies

| Package | Required | Purpose |
|---------|----------|---------|
| `pytest` | Yes | Test framework |
| `aiohttp` | Optional | HTTP for publisher/target profiling |
| `beautifulsoup4` | Optional | HTML parsing |
| `sentence-transformers` | Optional | Semantic similarity for bridge analysis |

The pipeline **degrades gracefully** without optional dependencies — publisher profiling uses domain heuristics, semantic distance defaults to 0.5, and the agent patches target metadata manually.

---

## Structured Upgrade Framework

The `structured-upgrade/` directory contains a **Source of Truth (SOT) framework** for systematic upgrades:

- **18 confirmed invariants** with evidence citations
- **8 module boundary contracts** with data models and error behavior
- **6 P0 gates** (mandatory stop-rules) + P1/P2 advisory gates
- **Iteration protocol** with SOT deltas and gate verification

Any agent modifying the system follows `system_protocol.md` to ensure changes don't silently break contracts or invariants.

---

## License

Proprietary. All rights reserved.
