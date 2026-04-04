"""BACOWR v6.3 — Smoke test for session startup.

Verifies that all core modules load, key functions exist,
and the system is ready to produce articles. Takes <1 second.

Run: python smoke_test.py
"""

import sys
from pathlib import Path

PASS = 0
FAIL = 0


def check(name, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  OK  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}{': ' + detail if detail else ''}")


# ── 1. Core files exist ─────────────────────────────────────
root = Path(__file__).resolve().parent

check("pipeline.py exists", (root / "pipeline.py").exists())
check("engine.py exists", (root / "engine.py").exists())
check("models.py exists", (root / "models.py").exists())
check("article_validator.py exists", (root / "article_validator.py").exists())
check("SYSTEM.md exists", (root / "SYSTEM.md").exists())
check("RUNBOOK.md exists", (root / "RUNBOOK.md").exists())

# ── 2. Core imports work ────────────────────────────────────
try:
    from pipeline import Pipeline, PipelineConfig, detect_language
    check("pipeline imports", True)
except Exception as e:
    check("pipeline imports", False, str(e))

try:
    from engine import (
        create_blueprint_from_pipeline,
        TargetIntentAnalyzer,
        ArticleOrchestrator,
    )
    check("engine imports", True)
except Exception as e:
    check("engine imports", False, str(e))

try:
    from models import JobSpec, Preflight
    check("models imports", True)
except Exception as e:
    check("models imports", False, str(e))

try:
    from article_validator import validate_article
    check("article_validator imports", True)
except Exception as e:
    check("article_validator imports", False, str(e))

# ── 3. Key functions callable ────────────────────────────────
try:
    pipe = Pipeline(PipelineConfig())
    check("Pipeline instantiates", True)
    check("run_batch_preflight exists", hasattr(pipe, "run_batch_preflight"))
except Exception as e:
    check("Pipeline instantiates", False, str(e))

try:
    analyzer = TargetIntentAnalyzer()
    check("TargetIntentAnalyzer instantiates", True)
except Exception as e:
    check("TargetIntentAnalyzer instantiates", False, str(e))

try:
    lang = detect_language("testbloggen.se")
    check("detect_language works", lang == "sv", f"got '{lang}'")
except Exception as e:
    check("detect_language works", False, str(e))

# ── 4. CSV loadable ─────────────────────────────────────────
csv_path = root / "textjobs_list.csv"
if csv_path.exists():
    try:
        jobs = pipe.load_jobs(str(csv_path))
        check(f"CSV loads ({len(jobs)} jobs)", len(jobs) > 0)
    except Exception as e:
        check("CSV loads", False, str(e))
else:
    check("CSV exists", False, "textjobs_list.csv not found")

# ── Result ───────────────────────────────────────────────────
print(f"\n{'='*40}")
total = PASS + FAIL
if FAIL == 0:
    print(f"SMOKE TEST PASSED ({PASS}/{total})")
    print("System ready for article production.")
    sys.exit(0)
else:
    print(f"SMOKE TEST FAILED ({FAIL} failures out of {total})")
    print("Fix issues before running jobs.")
    sys.exit(1)
