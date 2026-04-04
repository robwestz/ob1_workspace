# BACOWR v6.2 — Session Init / Crash Recovery

> Läs denna fil FÖRST om du tar över sessionen.

---

## Systemet

BACOWR v6.2 är en artikelgenereringspipeline som tar en CSV-jobblista och producerar SEO-artiklar med ankarlänk, trustlänkar och kvalitetskontroll. Systemet använder pipeline.py + engine.py i samverkan — agenten orkestrerar, aldrig spelar solo.

**Systemet är generiskt.** Det är inte låst till en specifik jobblista.

---

## Filöversikt

| Fil | Roll | Läs när |
|-----|------|---------|
| **SKILL.md** | Hard constraints, 8-fas flöde, file roles | ALLTID först |
| **INIT.md** | Denna fil — sessionsstart, crash recovery | Vid sessionsstart |
| **CLAUDE.md** | Kommandon, filstruktur, batch, felsökning | Referens |
| **SYSTEM.md** | Artikelregler: ordantal, anchor, trustlinks, stil | Före första artikel |
| **engine.py** | Blueprint: SERP-probes, topic, thesis, sections | Anropas Phase 4+6 |
| **pipeline.py** | Preflight: publisher, target, bridge | Anropas Phase 1+2 |
| **models.py** | Datamodeller (JobSpec, Preflight) | Används av pipeline |
| **references/** | engine-api.md, system-rules.md, qa-template.md | Vid behov |

---

## Snabbstart: ett jobb

```python
# Phase 1-2: Pipeline
from pipeline import Pipeline, PipelineConfig
import asyncio
pipe = Pipeline(PipelineConfig())
jobs = pipe.load_jobs('jobs.csv')
job = jobs[0]
preflight = asyncio.run(pipe.run_preflight(job))

# Phase 3: Patch metadata (agent kör web_search)
preflight.target.title = "Metatitel från web_search"
preflight.target.meta_description = "Metabeskrivning"

# Phase 4: Probes
from engine import TargetIntentAnalyzer
analyzer = TargetIntentAnalyzer()
plan = analyzer.build_research_plan_from_metadata(
    url=job.target_url, title=preflight.target.title,
    description=preflight.target.meta_description
)

# Phase 5: SERP (agent kör 5× web_search + analyze_probe_results)

# Phase 6: Blueprint
from engine import create_blueprint_from_pipeline
bp = create_blueprint_from_pipeline(
    job_number=job.job_number, publisher_domain=job.publisher_domain,
    target_url=job.target_url, anchor_text=job.anchor_text,
    publisher_profile=preflight.publisher,
    target_fingerprint=preflight.target,
    semantic_bridge=preflight.bridge
)
bp.target.intent_profile = plan
prompt = bp.to_agent_prompt()

# Phase 7: Skriv artikel (SYSTEM.md regler) → articles/job_01.md
# Phase 8: QA (qa-template.md, 11/11 PASS)
```

---

## Hårda krav (från SKILL.md)

- 750–900 ord
- Ankarlänk vid ord 250–550, exakt 1, exakt text från CSV
- 1-2 trustlänkar (FÖRE ankarlänken)
- Max 1 heading (titeln), inga H2/H3
- Inga punktlistor i artikeln
- Artikel till disk (`articles/job_NN.md`)
- QA 11/11 PASS
- ALDRIG pipeline ELLER engine ensam — båda måste bidra

---

## Crash recovery

Om sessionen avbryts mitt i:

1. Kolla vilka artiklar som redan finns i `articles/`
2. Fortsätt från nästa jobb i CSV-listan
3. Läs SKILL.md → SYSTEM.md innan du skriver
4. Varje jobb är oberoende — ingen state behöver överföras

---

## CSV-format

```csv
job_number,publication_domain,target_page,anchor_text
1,teknikbloggen.se,https://www.indoorprofessional.se/tjanster/lokalvard/,lokalvård
```

4 kolumner. Om headers avviker: mappa kolumn 1=publisher, 2=target_url, 3=anchor_text.

---

*BACOWR v6.2 — 2026-02-14*
