---
contracts:
  - id: "CTR-001"
    producer: "pipeline.py (Pipeline.load_jobs)"
    consumers: ["pipeline.py (Pipeline.run_preflight)", "agent"]
    type: "hard"
    status: "confirmed"
    schema_ref: "models.py:JobSpec"
    validation_ref: "pipeline.py:707-726"
  - id: "CTR-002"
    producer: "pipeline.py (Pipeline.run_preflight)"
    consumers: ["agent", "engine.py (create_blueprint_from_pipeline)"]
    type: "hard"
    status: "confirmed"
    schema_ref: "models.py:Preflight"
    validation_ref: "pipeline.py:728-764"
  - id: "CTR-003"
    producer: "agent (web_search/web_fetch)"
    consumers: ["pipeline.py (Preflight.target patched)"]
    type: "soft"
    status: "confirmed"
    schema_ref: "models.py:TargetFingerprint"
    validation_ref: "FLOWMAP.md:127 (gate: title non-empty)"
  - id: "CTR-004"
    producer: "engine.py (TargetIntentAnalyzer.build_research_plan_from_metadata)"
    consumers: ["agent (executes 5 web_search probes)"]
    type: "hard"
    status: "confirmed"
    schema_ref: "engine.py:TargetIntentProfile"
    validation_ref: "engine.py:519-571"
  - id: "CTR-005"
    producer: "agent (web_search results)"
    consumers: ["engine.py (TargetIntentAnalyzer.analyze_probe_results)"]
    type: "soft"
    status: "confirmed"
    schema_ref: "List[Dict] with title, description, url"
    validation_ref: "engine.py:573-618"
  - id: "CTR-006"
    producer: "engine.py (create_blueprint_from_pipeline)"
    consumers: ["agent (writes article from blueprint.to_agent_prompt())"]
    type: "hard"
    status: "confirmed"
    schema_ref: "engine.py:ArticleBlueprint"
    validation_ref: "engine.py:2701-2760"
  - id: "CTR-007"
    producer: "agent (article on disk)"
    consumers: ["QA check (qa-template.md, 11 checks)"]
    type: "hard"
    status: "confirmed"
    schema_ref: "Markdown file at articles/job_NN.md"
    validation_ref: "SKILL.md:210-226 (11 QA checks)"
  - id: "CTR-008"
    producer: "pipeline.py models (PublisherProfile, TargetFingerprint, SemanticBridge)"
    consumers: ["engine.py (create_blueprint_from_pipeline)"]
    type: "hard"
    status: "confirmed"
    schema_ref: "models.py:PublisherProfile -> engine.py:PublisherUniverse"
    validation_ref: "engine.py:2727-2750"
---

# Contracts

> Input/output contracts between system modules.
> Each contract is **Hard** (validated/tested) or **Soft** (assumed).

---

## Contract Registry

| ID | Producer | Consumer | Type | Status |
|----|----------|----------|------|--------|
| CTR-001 | pipeline.load_jobs() | Pipeline.run_preflight(), agent | Hard | Confirmed |
| CTR-002 | pipeline.run_preflight() | agent, engine.create_blueprint_from_pipeline() | Hard | Confirmed |
| CTR-003 | agent (web_search) | Preflight.target (patch) | Soft | Confirmed |
| CTR-004 | engine.build_research_plan_from_metadata() | agent (5 web_search probes) | Hard | Confirmed |
| CTR-005 | agent (web_search results) | engine.analyze_probe_results() | Soft | Confirmed |
| CTR-006 | engine.create_blueprint_from_pipeline() | agent (article writing) | Hard | Confirmed |
| CTR-007 | agent (article on disk) | QA check (11 binary checks) | Hard | Confirmed |
| CTR-008 | pipeline models -> engine models | engine.create_blueprint_from_pipeline() | Hard | Confirmed |

---

## Contract Definitions

### CTR-001: CSV -> JobSpec List

**Producer:** pipeline.py `Pipeline.load_jobs(csv_path)` (line 707)
**Consumer(s):** pipeline.py `Pipeline.run_preflight(job)`, agent orchestration loop
**Type:** Hard
**Status:** Confirmed

**Data Model:**
```yaml
fields:
  - name: "job_number"
    type: "int"
    required: true
    description: "Sequential job number from CSV"
  - name: "publisher_domain"
    type: "str"
    required: true
    description: "Publisher site domain (mapped from CSV 'publication_domain')"
  - name: "target_url"
    type: "str"
    required: true
    description: "Target page URL (mapped from CSV 'target_page')"
  - name: "anchor_text"
    type: "str"
    required: true
    description: "Exact anchor text for the link"
```

**Validation:**
- CSV headers validated by DictReader: job_number, publication_domain, target_page, anchor_text
- Fields stripped of whitespace (pipeline.py:720-723)
- job_number cast to int (pipeline.py:719)
- Evidence: pipeline.py:707-726

**Error Behavior:**
- Missing CSV file: `sys.exit(1)` (pipeline.py:712)
- Missing required field: KeyError from DictReader (unhandled — crash)
- Wrong type for job_number: ValueError from int() cast (unhandled — crash)
- Empty data: Returns empty list, no error

**Boundary Type:** file I/O (CSV read) -> dataclass instantiation

**NOTE:** CSV column names differ from JobSpec field names:
- CSV `publication_domain` -> JobSpec `publisher_domain`
- CSV `target_page` -> JobSpec `target_url`

---

### CTR-002: JobSpec -> Preflight

**Producer:** pipeline.py `Pipeline.run_preflight(job: JobSpec)` (line 728)
**Consumer(s):** agent (patches target metadata), engine.py `create_blueprint_from_pipeline()`
**Type:** Hard
**Status:** Confirmed

**Data Model:**
```yaml
fields:
  - name: "job"
    type: "JobSpec"
    required: true
  - name: "publisher"
    type: "PublisherProfile"
    required: true
    description: "Publisher domain analysis (may be heuristic-only without aiohttp)"
  - name: "target"
    type: "TargetFingerprint"
    required: true
    description: "Target page fingerprint (EMPTY without aiohttp — agent MUST patch)"
  - name: "bridge"
    type: "SemanticBridge"
    required: true
    description: "Semantic distance + bridge suggestions"
  - name: "risk_level"
    type: "RiskLevel"
    required: true
  - name: "language"
    type: "str"
    required: true
    description: "Detected language (sv/en) from domain heuristic"
```

**Validation:**
- publisher.primary_topics must be non-empty (SKILL.md Phase 2 gate)
- target.title will be empty without aiohttp (expected — agent patches in Phase 3)
- bridge always produced (fallback: anchor-derived suggestion with confidence LOW)
- Evidence: pipeline.py:728-764, FLOWMAP.md:88-98

**Error Behavior:**
- aiohttp missing: target returns empty TargetFingerprint, publisher uses domain heuristic only
- sentence-transformers missing: SemanticEngine returns 0.5 distance (moderate)
- Any exception in sub-analyzers: silently caught, returns partial data

**Boundary Type:** function call (async) -> dataclass

---

### CTR-003: Agent Metadata Patch -> Preflight.target

**Producer:** agent (web_search or web_fetch of target URL)
**Consumer(s):** Preflight.target (TargetFingerprint fields patched in-place)
**Type:** Soft
**Status:** Confirmed

**Data Model:**
```yaml
fields:
  - name: "title"
    type: "str"
    required: true
    description: "Target page meta title — extracted from web_search/fetch"
  - name: "meta_description"
    type: "str"
    required: true
    description: "Target page meta description"
  - name: "main_keywords"
    type: "List[str]"
    required: false
    description: "Optional: extracted keywords from target"
```

**Validation:**
- Gate: `preflight.target.title` must be non-empty after patch (FLOWMAP.md:127)
- No code validation — entirely agent-behavioral
- Evidence: SKILL.md:125-130, FLOWMAP.md:102-130

**Error Behavior:**
- Agent fails to patch: HC-4 violation (empty target title), probes become meaningless
- Agent patches wrong data: No detection mechanism — garbage in, garbage out
- web_search fails: Fallback to `web_search(domain + anchor)` (SKILL.md:122)

**Boundary Type:** pipeline mutation (agent directly patches dataclass fields)

---

### CTR-004: Target Metadata -> Research Plan (5 Probes)

**Producer:** engine.py `TargetIntentAnalyzer.build_research_plan_from_metadata(url, title, description)`
**Consumer(s):** agent (executes 5 web_search calls from probe.query)
**Type:** Hard
**Status:** Confirmed

**Data Model:**
```yaml
output:
  type: "TargetIntentProfile"
  fields:
    - name: "probes"
      type: "List[SerpProbe]"
      count: 5
      description: "Each probe has .query (search string) and .purpose (why)"
    - name: "head_entity"
      type: "str"
      description: "1-2 word core entity from meta title"
    - name: "cluster_query"
      type: "str"
      description: "Long-tail variant of head entity"
```

**Validation:**
- Gate: `len(plan.probes) == 5` and all probes have non-empty `.query` (SKILL.md:146)
- Engine always produces exactly 5 probes (engine.py:669-766, with fallbacks for empty metadata)
- Evidence: engine.py:519-571, SKILL.md Phase 4

**Error Behavior:**
- Empty title: head_entity becomes "", probes use URL path segments as fallback
- Empty description: probes 4-5 use fallback queries (desc keywords, URL search)

**Boundary Type:** function call -> dataclass

---

### CTR-005: SERP Results -> Probe Analysis

**Producer:** agent (web_search results as List[Dict])
**Consumer(s):** engine.py `TargetIntentAnalyzer.analyze_probe_results(plan, step, results)`
**Type:** Soft
**Status:** Confirmed

**Data Model:**
```yaml
input:
  - name: "results"
    type: "List[Dict[str, str]]"
    description: "Top 3 search results"
    fields_per_item:
      - "title"
      - "description"
      - "url"
```

**Validation:**
- Results truncated to top 3 (engine.py:594)
- Missing fields default to empty string (engine.py:596-600)
- No schema validation on input Dict
- Evidence: engine.py:573-618

**Error Behavior:**
- Empty results list: probe marked as completed with no data
- Missing keys: defaults to "" (safe)
- Wrong step number: silently ignored (engine.py:588-589)

**Boundary Type:** function call (agent passes Dict from web_search tool output)

---

### CTR-006: Blueprint -> Agent Prompt

**Producer:** engine.py `create_blueprint_from_pipeline(...)` -> `ArticleBlueprint`
**Consumer(s):** agent (calls `blueprint.to_agent_prompt()` to get writing instructions)
**Type:** Hard
**Status:** Confirmed

**Data Model:**
```yaml
output:
  type: "ArticleBlueprint"
  critical_fields:
    - "chosen_topic" (TopicCandidate with topic, viability, bridges)
    - "bridges" (List[ContextBridge] with search_query, concept, role)
    - "thesis" (ArticleThesis with statement, anchor_integration)
    - "sections" (List[SectionPlan] with role, target_words, contains_anchor)
    - "constraints" (List[ConstraintResult] with pass/fail)
```

**Validation:**
- Gate: `chosen_topic` exists, `bridges >= 1`, `sections >= 3`, `prompt > 200 chars` (SKILL.md:185)
- Constraint checks run internally (engine.py:2497-2500)
- Evidence: engine.py:2390-2503, SKILL.md Phase 6

**Error Behavior:**
- No topic found: blueprint.chosen_topic is None — agent should not proceed
- No bridges: fallback bridges generated from pub/target keywords (engine.py:2618-2642)
- Hard constraint failure: blueprint.is_approved returns False

**Boundary Type:** function call -> dataclass -> string (prompt rendering)

---

### CTR-007: Article on Disk -> QA Verification

**Producer:** agent (writes markdown article to articles/job_NN.md)
**Consumer(s):** QA check (11 binary checks from qa-template.md)
**Type:** Hard
**Status:** Confirmed

**Data Model:**
```yaml
input:
  type: "Markdown file"
  requirements:
    - "750-900 words"
    - "Exactly 1 anchor link [anchor_text](target_url)"
    - "Anchor at word 250-550"
    - "1-2 trustlinks as [text](url)"
    - "Max 1 heading"
    - "No bullets/lists"
    - "No forbidden AI phrases"
    - "Swedish (or English per domain)"
    - ">=4 SERP entities"
    - ">=4 substantive paragraphs"
```

**Validation:**
- 11 binary checks (SKILL.md:212-226, qa-template.md)
- All 11 must PASS (SKILL.md:210)
- Evidence: SKILL.md Phase 8, qa-template.md

**Error Behavior:**
- Any single FAIL: agent revises SPECIFIC section, does NOT rewrite all (FLOWMAP.md:341)
- QA script format defined in qa-template.md

**Boundary Type:** file I/O (read article from disk) -> pass/fail table

---

### CTR-008: Pipeline Models -> Engine Models (BRIDGE FUNCTION)

**Producer:** pipeline.py models (PublisherProfile, TargetFingerprint, SemanticBridge)
**Consumer(s):** engine.py `create_blueprint_from_pipeline()` (converts to PublisherUniverse, TargetUniverse)
**Type:** Hard
**Status:** Confirmed

**Data Model:**
```yaml
conversions:
  - from: "models.PublisherProfile"
    to: "engine.PublisherUniverse"
    mapped_fields:
      - "domain -> domain"
      - "site_name -> site_name"
      - "primary_topics -> primary_topics"
      - "secondary_topics -> secondary_topics"
      - "primary_language -> language"
      - "category_structure -> category_structure"
      - "confidence -> confidence"
  - from: "models.TargetFingerprint"
    to: "engine.TargetUniverse"
    mapped_fields:
      - "url -> url"
      - "title -> title"
      - "h1 -> h1"
      - "meta_description -> meta_description"
      - "language -> language"
      - "main_keywords -> main_keywords"
      - "topic_cluster -> topic_cluster"
```

**Validation:**
- Conversion is explicit field-by-field mapping (engine.py:2728-2750)
- If publisher_profile is None: engine creates minimal publisher from domain heuristic
- If target_fingerprint is None: engine creates minimal target from URL parsing
- Evidence: engine.py:2701-2760

**Error Behavior:**
- None input for publisher: fallback to _minimal_publisher() (engine.py:2505-2536)
- None input for target: fallback to _minimal_target() (engine.py:2538-2550)
- Missing fields on models: Python defaults (empty lists, empty strings)

**Boundary Type:** function call (model conversion + orchestrator.create_blueprint)
