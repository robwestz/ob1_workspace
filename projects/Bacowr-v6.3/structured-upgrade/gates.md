---
# YAML Frontmatter — machine-readable gate definitions (for CI/pipeline)
gates:
  - id: "P0-G1"
    severity: "P0"
    name: "Secrets/PII Gate"
    trigger: "Suspected secret or PII in input or output"
    evidence_required: "Scan result CLEAN, or explicit redaction description + rescan"
    verification: "automated_scan"
  - id: "P0-G2"
    severity: "P0"
    name: "SOT Integrity Gate"
    trigger: "Manifest/SOT files missing, inconsistent, or unparseable"
    evidence_required: "Manifest refs match existing files + valid structure + SOT_ID present"
    verification: "structural_check"
  - id: "P0-G3"
    severity: "P0"
    name: "SOT Sync Gate"
    trigger: "Input fingerprint differs from SOT without explanatory SOT_DELTA"
    evidence_required: "Fingerprint match OR SOT_DELTA with updated system_truth/contracts"
    verification: "fingerprint_comparison"
  - id: "P0-G4"
    severity: "P0"
    name: "Invariant Preservation Gate"
    trigger: "Change breaks a Confirmed invariant"
    evidence_required: "Evidence invariant still holds (code/test/fixture cite) OR explicit reclassification via SOT_DELTA with rationale"
    verification: "evidence_review"
  - id: "P0-G5"
    severity: "P0"
    name: "Contract Compatibility Gate"
    trigger: "Contract changed without SOT_DELTA + consumer/producer update"
    evidence_required: "Updated contract + updated dependents + verification (test/fixture/logic)"
    verification: "contract_diff"
  - id: "P0-G6"
    severity: "P0"
    name: "Non-Exfiltration Gate"
    trigger: "Agent proposes or executes data exfiltration"
    evidence_required: "Action plan keeping data within approved classification + redaction proof if needed"
    verification: "manual_review"
---

# Gates

> Stop-rules that prevent the agent from producing locally brilliant
> but systemically destructive solutions.
> A gate is not a checkbox. It is a reasoned evaluation with evidence.

---

## Gate Execution Format

Every gate check SHALL follow this structure:

```
GATE CHECK: [Gate ID]
━━━━━━━━━━━━━━━━━━━━━
Statement:  [What is being checked]
Evidence:   [Specific reference — file:section, test output, contract ID]
Reasoning:  "Requirement: [X]. Evidence shows: [Y]. Therefore: [PASS/FAIL]."
Decision:   PASS | FAIL
Action:     [If FAIL: minimal remediation, or STOP + request decision]
━━━━━━━━━━━━━━━━━━━━━
```

**NEVER mark PASS with an empty Evidence field.**

---

## P0 Gates (Mandatory Stop)

### P0-G1: Secrets/PII Gate
**Trigger:** Suspected secret or PII detected in input files or agent output.
**When:** Cold start preflight, and before any output that includes file content.
**Evidence for PASS:**
- Automated or manual scan result: CLEAN
- OR: Explicit redaction log (what was removed, where) + clean rescan
**On FAIL:** Stop immediately. Instruct: "Redaction required before work proceeds."

### P0-G2: SOT Integrity Gate
**Trigger:** Framework files missing, inconsistent, or structurally invalid.
**When:** Every session start.
**Evidence for PASS:**
- All manifest.yaml file references resolve to existing files
- All files have valid structure (parseable, expected sections present)
- SOT_ID exists in system_truth.md
**On FAIL:** Stop. Regenerate missing/broken files before proceeding.

### P0-G3: SOT Sync Gate
**Trigger:** Input fingerprint differs from the fingerprint stored in system_truth.md, and no SOT_DELTA accounts for the difference.
**When:** Warm start validation.
**Evidence for PASS:**
- Fingerprints match, OR
- SOT_DELTA exists that explains and accounts for the difference + system_truth.md and contracts.md are updated accordingly
**On FAIL:** Stop. Require full or partial re-analysis before proceeding.

### P0-G4: Invariant Preservation Gate
**Trigger:** A proposed change would break a Confirmed invariant.
**When:** Before declaring any iteration complete.
**Evidence for PASS:**
- Cite code/test/fixture proving invariant still holds post-change, OR
- Invariant is explicitly reclassified via SOT_DELTA with rationale + new evidence for the updated invariant
**On FAIL:** Stop. Do not merge/finalize. Remediate or request human decision.

### P0-G5: Contract Compatibility Gate
**Trigger:** A contract is changed without updated SOT_DELTA and updated consumer/producer documentation.
**When:** Before declaring any iteration complete that modifies data flow.
**Evidence for PASS:**
- Updated contract definition in contracts.md
- All consumers/producers verified compatible (test/fixture/logic review)
- SOT_DELTA documents the change
**On FAIL:** Stop. Update contracts + dependents before proceeding.

### P0-G6: Non-Exfiltration Gate
**Trigger:** Agent proposes sharing credentials, copying confidential data to public locations, or similar.
**When:** Whenever agent generates output or suggests actions involving data movement.
**Evidence for PASS:**
- Action plan that keeps all data within its approved classification
- Redaction proof if sensitive data was handled
**On FAIL:** Stop immediately. Do not execute the proposed action.

---

## P1 Gates (Warn, Can Continue)

### P1-G1: Trustlink Count Consistency
**Trigger:** AgentPromptRenderer (engine.py:2337) says "Minst 2, max 4" but SYSTEM.md, SKILL.md, qa-template.md all say "1-2".
**When:** Before any iteration that modifies trustlink logic.
**Evidence for PASS:**
- All files agree on trustlink count (currently INCONSISTENT — RISK-006)
- OR: Explicit decision logged in state.md for which value is canonical
**On WARN:** Log inconsistency, use SYSTEM.md value (1-2) as canonical per priority order.

### P1-G2: Target Metadata Non-Empty
**Trigger:** Agent proceeds to Phase 4 (probe generation) without patching target metadata.
**When:** After Phase 3, before Phase 4.
**Evidence for PASS:**
- `preflight.target.title` is non-empty string
- `preflight.target.meta_description` is non-empty string
**On WARN:** Agent must web_search/web_fetch before proceeding. Do not skip.

### P1-G3: Import Safety
**Trigger:** serp_provider.py imported in an environment without aiohttp.
**When:** When runner.py or any code imports serp_provider.py.
**Evidence for PASS:**
- aiohttp is installed, OR
- serp_provider.py is not imported in current execution path
**On WARN:** serp_provider.py will crash on import. Only runner.py uses it — pipeline.py and engine.py are safe.

### P1-G4: CSV Header Mapping
**Trigger:** New CSV file with non-standard headers used.
**When:** Phase 1 (job loading).
**Evidence for PASS:**
- CSV has exact headers: job_number, publication_domain, target_page, anchor_text
**On WARN:** pipeline.py:718-723 will KeyError on wrong headers. Fix CSV or adapt load_jobs().

---

## P2 Gates (Info)

### P2-G1: Degraded Mode Awareness
**Trigger:** aiohttp or sentence-transformers missing at runtime.
**When:** Session start / Phase 0.
**Evidence for PASS:**
- Agent acknowledges degraded mode in session log
- Agent knows to patch target metadata manually (Phase 3)
**On INFO:** Log which dependencies are missing and their impact.

### P2-G2: Cache Integrity
**Trigger:** Stale or corrupted cache files in .cache/publisher/ or .cache/target/.
**When:** When preflight returns unexpectedly fast or with stale data.
**Evidence for PASS:**
- Cache TTL respected (72h publisher, 24h target — pipeline.py:86-87)
**On INFO:** Clear cache and re-run if data seems wrong.

### P2-G3: Blueprint Recovery
**Trigger:** Orchestrator crashes mid-pipeline (between Phase 4-6).
**When:** After any unexpected error during engine execution.
**Evidence for PASS:**
- Blueprint phases are logged, agent can identify last completed phase
**On INFO:** Re-run from the failed phase with same input data.
