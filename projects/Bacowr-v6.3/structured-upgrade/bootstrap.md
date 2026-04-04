# Bootstrap Protocol

> This document defines the exact startup sequence for every session.
> Follow it in order. Do not skip steps.

---

## §1 Cold Start Protocol

**Trigger:** New session. No state.md exists, or state.md is empty/invalid.

### Step 1: Read Manifest
- Read `manifest.yaml`
- Verify all referenced files exist
- Identify framework version and gate registry
- **If manifest is missing or unparseable → P0-G2 FAIL → STOP**

### Step 2: Security Preflight
- Scan all project input files for:
  - Credentials (API keys, tokens, passwords, private keys)
  - PII (names + personal identifiers, email addresses in data contexts, personal numbers)
  - Sensitive client data
- **If detected → P0-G1 FAIL → STOP with instruction: "Redaction required before work can proceed"**
- Log scan result

### Step 3: Create Input Fingerprint
Record in system_truth.md header:
```yaml
input_fingerprint:
  sot_id: "[YYYY-MM-DD]-[short-hash]"
  included_files:
    - path: "relative/path"
      size: "bytes"
  excluded_patterns:
    - "node_modules/"
    - ".env*"
    - "dist/"
    - "__pycache__/"
  total_files: N
  commit_ref: "[if available]"
  fingerprint_hash: "[hash of the sorted file list]"
```

### Step 4: System Analysis
Follow the analysis method below to generate:
- **system_truth.md** — modules, dependencies, invariants, risk zones
- **contracts.md** — input/output contracts between modules
- **gates.md** — project-specific gates (added to framework P0 gates)
- **state.md** — initial entry

### Step 5: Run All P0 Gates
Execute every P0 gate from manifest.yaml with full evidence.
**If any FAIL → STOP**

### Step 6: Ready
Session is ready to accept tasks.

---

## §2 Warm Start Protocol

**Trigger:** state.md exists with valid history.

### Step 1: Read Manifest → validate file references
### Step 2: Read state.md → identify:
- Latest SOT_ID / fingerprint
- Open risks and unknowns
- Last work in progress (if any)
### Step 3: Validate SOT Consistency
- Compare current input fingerprint against SOT fingerprint
- **If they differ and no SOT_DELTA explains it → P0-G3 FAIL → STOP**
### Step 4: Run P0 Gates
### Step 5: Resume from state — do NOT change goal or scope unless state explicitly records a scope change

---

## §3 Analysis Method (for Step 4 in Cold Start)

### Phase 1: Inventory
1. Map directory structure and file types
2. Classify files: executable logic | configuration | data/schemas | tests | documentation
3. Note languages, frameworks, build tools

### Phase 2: Entrypoints
1. Identify start points: main scripts, runners, pipeline starts, API endpoints, CLI commands, build scripts
2. Mark as **Confirmed** only if directly identifiable in code/config
3. Everything else is **Proposed**

### Phase 3: Dependency Mapping
1. For each module, identify imports/calls to other modules
2. Map data flows between modules where identifiable
3. Dependencies that cannot be verified → **Proposed**
4. Output: bounded dependency graph

### Phase 4: Invariant Extraction
Extract via three evidence channels (in order of strength):

**Explicit evidence** (→ can be Confirmed directly):
- Assertions, validations, schema requirements, type constraints
- Guard clauses, "must/never" in documentation

**Implicit evidence** (→ Confirmed only with 2+ independent signals):
- Recurring patterns: same field always created before next pipeline step
- Consistent error handling patterns

**Design-intent evidence** (→ Confirmed only if code/contract trace exists):
- README/spec documents stating intent
- State history from previous iterations

Each invariant SHALL have:
- Unique ID (INV-001, INV-002, ...)
- Statement: "ALWAYS ..." or "NEVER ..."
- Scope: which modules/subsystems
- Evidence references: file/section/fragment
- Status: Confirmed | Proposed

### Phase 5: Contract Extraction
For each boundary where data passes between modules:
1. Identify the boundary (function call, serialization, file I/O, network, pipeline mutation)
2. Define: producer(s), consumer(s), data model, error behavior
3. Classify:
   - **Hard contract** (explicit validation/schema/test) → can be Confirmed
   - **Soft contract** (implicit assumption) → Proposed until evidence found

### Phase 6: Risk Zone Identification
Detect and document:

| Risk Type | What to Look For |
|-----------|-----------------|
| Boundary Hotspot | Modules with high fan-in AND fan-out |
| Contract Fragility | Unvalidated contracts with many consumers |
| Stateful Core | Global state, caches, env dependencies, implicit config |
| Side-effect Concentration | I/O, network calls, external integrations, writes |
| Silent Failure Zone | Exception swallowing, broad try/catch, fallback without logging |

Each risk zone gets: type, location (with evidence), likely impact, recommended gate/verification.

### Phase 7: Assemble SOT Files
Write system_truth.md, contracts.md, gates.md, state.md (initial entry).
Every claim has Confirmed or Proposed status.

---

## §4 Scenario-Specific Notes

### Existing Repo (Upgrade)
- Prioritize identifying existing contracts and implicit behavior
- Use Proposed heavily at first; reduce systematically through evidence
- Pay special attention to Silent Failure Zones — upgrades break these first

### New Project (From Scratch)
- system_truth.md may start mostly Proposed
- Establish at least ONE Confirmed contract and ONE Confirmed invariant as early as possible through explicit validations/fixtures
- Build the habit of SOT_DELTA from the very first iteration
