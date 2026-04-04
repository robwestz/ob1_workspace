# BACOWR v6.3 — Claude Instruktioner

> **System**: Artikelgenerering med pipeline+engine-orkestrering för SEO-länkstrategi
> **Version**: 6.3 (2026-02-19)

---

## OBLIGATORISK EXEKVERINGSGATE

**Denna sektion gäller ALLTID — vid sessionsstart, efter context compaction, och innan varje jobb.**

Innan du kör NÅGOT jobb måste du:

### 1. Läs RUNBOOK.md

Läs RUNBOOK.md i sin helhet. Inte README.md, inte requirements.txt — **RUNBOOK.md**.
Det är den filen som beskriver exakt hur systemet ska köras, steg för steg.

Läs även SYSTEM.md (artikelreglerna) om du inte redan gjort det i denna session.

### 2. Producera EXECUTION CONFIRMATION

Innan första jobbet — skriv ut denna bekräftelse med dina egna ord:

```
EXECUTION CONFIRMATION
══════════════════════
Jag har läst RUNBOOK.md och SYSTEM.md. Jag bekräftar:

STEG JAG KOMMER FÖLJA (per jobb, i ordning):
  Fas 2: asyncio.run(pipe.run_preflight(job))
  Fas 3: web_search → patcha preflight.target.title + .meta_description
  Fas 4: analyzer.build_research_plan_from_metadata()
  Fas 5: web_search × 5 probes → analyzer.analyze_probe_results() per probe
         trustlinks: analyzer.build_trustlink_queries() → web_search
  Fas 6: create_blueprint_from_pipeline() → bp.to_agent_prompt()
  Fas 7: Skriv artikel STRIKT efter bp.to_agent_prompt() + SYSTEM.md
  Fas 8: validate_article() → 11/11 PASS

JAG KOMMER INTE:
  ✗ Skapa egna Python-scripts eller tempfiler (_run_job.py, _preflight.json, etc.)
  ✗ Skriva Python-kod till disk — ALL kod körs inline
  ✗ Hårdkoda SERP-data eller metadata
  ✗ Hitta på egna ämnen — engine väljer topic, inte jag
  ✗ Skriva artikeln fritt — jag följer bp.to_agent_prompt()
  ✗ Hoppa över steg eller "optimera" ordningen

PREFLIGHTS KÖRS I BATCH (run_batch_preflight). ARTIKLAR SKRIVS EN I TAGET. ENGINE STYR.
```

### 3. Invänta godkännande

**Ingen exekvering före användarens godkännande.** Inga undantag.

Om du efter context compaction inte minns att du fått godkännande — producera bekräftelsen igen.

---

## Miljöregler

- **Sökvägar**: Använd alltid `C:/` paths. Aldrig `/mnt/c/` (WSL-path fungerar inte).
- **Bash**: All Python-kod körs inline med `python -c "..."`. Inga tempfiler.
- **stderr**: Ignorera `HF_TOKEN`-varningar och embedding-modell-output — de påverkar inte resultatet.

---

## Läsordning

**CLAUDE.md (denna fil) är startpunkten.** Den laddas alltid — även efter context compaction.

Innan du kör jobb, läs dessa filer:

| Prio | Fil | Syfte | När |
|------|-----|-------|-----|
| 1 | **RUNBOOK.md** | Steg-för-steg exekvering — FÖLJ DENNA | Alltid före första jobb |
| 2 | **SYSTEM.md** | Artikelregler: ordantal, anchor, trustlinks, stil | Alltid före första jobb |
| 3 | **SKILL.md** | Hard constraints, 8-fas flöde (referens) | Vid sessionsstart |
| 4 | **INIT.md** | Crash recovery, snabbverifiering | Vid sessionsstart |

**RUNBOOK.md är exekveringsguiden.** Följ den bokstavligt, steg för steg.
**SYSTEM.md är artikelreglerna.** Alla hårda krav som artikeln måste uppfylla.
**SKILL.md är referensmaterial.** Hard constraints och arkitektur — men RUNBOOK.md har den körbara processen.

---

## Filstruktur

```
CLAUDE.md               ← DENNA FIL — startpunkt, exekveringsgate, kommandon
RUNBOOK.md              ← Steg-för-steg exekveringsguide — FÖLJ DENNA
SYSTEM.md               ← Artikelregler: ordantal, anchor, trustlinks, stil
SKILL.md                ← Hard constraints, 8 faser, gates (referens)
FLOWMAP.md              ← Swimlanes, dataflow per fas (referens)
INIT.md                 ← Sessionsstart / crash recovery
UPGRADE-PLAN.md         ← v6.4 genomförandeplan: 11 förbättringar, 4 waves

engine.py               ← Blueprint-generering: SERP-probes, topic, thesis, sections
pipeline.py             ← Preflight: publisher-profil, target-fingerprint, semantic bridge
models.py               ← Datamodeller (JobSpec, Preflight, PublisherProfile)

skills/
  editorial-overlay.md  ← Redaktionell overlay — aktiveras Fas 6→7, skärper skrivprocessen
  system-upgrade.md     ← Konsistensprocess: konsekvensmatris per kodfil, steg-för-steg

references/
  engine-api.md         ← API-referens: signaturer, anropsordning, exempel
  system-rules.md       ← Quick reference: alla hårda artikelregler (750-900 ord etc.)
  qa-template.md        ← QA-script: 11 binära checks
  diagnosis.md          ← Felsökningsguide för integration
```

### Output

```
articles/               ← Genererade artiklar (.md) — en per jobb
```

---

## Arbetssätt: Artikelproduktion

Agenten följer **RUNBOOK.md** fas för fas. Här är en kortversion (vid tveksamhet — läs RUNBOOK.md):

### Fas 1–2: Pipeline + Batch preflight

```python
from pipeline import Pipeline, PipelineConfig
import asyncio

pipe = Pipeline(PipelineConfig())
jobs = pipe.load_jobs('jobs.csv')                        # Phase 1: alla jobb
all_preflights = asyncio.run(pipe.run_batch_preflight(jobs))  # Phase 2: parallella preflights
```

### Fas 3: Metadata (agent patchar)

```python
# web_search("domän.se tjänst") → hämta title + description
preflight.target.title = "Faktisk metatitel"
preflight.target.meta_description = "Faktisk metabeskrivning"
```

### Fas 4: SERP-probes

```python
from engine import TargetIntentAnalyzer
analyzer = TargetIntentAnalyzer()
plan = analyzer.build_research_plan_from_metadata(
    url=preflight.target.url,
    title=preflight.target.title,
    description=preflight.target.meta_description
)
# plan.probes → 5 sökfrågor att köra med web_search
```

### Fas 5: SERP-exekvering + Trustlink-sökning

```python
for i, probe in enumerate(plan.probes):
    results = web_search(probe.query)      # agent kör web_search
    plan = analyzer.analyze_probe_results(plan, i+1, results)

# Trust link discovery (efter SERP-probes)
tl_queries = analyzer.build_trustlink_queries(preflight.bridge, plan, preflight.target.title)
trustlink_candidates = []
for q in tl_queries:
    trustlink_candidates.extend(web_search(q))
```

### Fas 6: Blueprint (BRIDGE-FUNKTIONEN)

```python
from engine import create_blueprint_from_pipeline
bp = create_blueprint_from_pipeline(
    job_number=job.job_number,
    publisher_domain=job.publisher_domain,
    target_url=job.target_url,
    anchor_text=job.anchor_text,
    publisher_profile=preflight.publisher,
    target_fingerprint=preflight.target,
    semantic_bridge=preflight.bridge
)
bp.target.intent_profile = plan
prompt = bp.to_agent_prompt()
```

### Fas 7–8: Skriv + QA

Agent skriver artikel till disk (`articles/job_NN.md`) med SYSTEM.md-regler, sedan kör QA (qa-template.md, 11/11 PASS).

---

## Batch-körning

### CSV-format

```csv
job_number,publication_domain,target_page,anchor_text
1,teknikbloggen.se,https://www.indoorprofessional.se/tjanster/lokalvard/,lokalvård
2,villanytt.se,https://www.rusta.com/sv/mattor,mattor
```

4 kolumner. Flexibla header-namn stöds (t.ex. `job_nummer`, `publisher_domain`, `target_url`).
Pipe-delimiter (`|`) stöds också. Malformade URL:er (t.ex. `https:/`) fixas automatiskt.

### Loop alla jobb

```python
jobs = pipe.load_jobs('jobs.csv')
all_preflights = asyncio.run(pipe.run_batch_preflight(jobs))  # Parallella preflights
for preflight in all_preflights:
    # Phase 3–8 per jobb (preflight redan klar)
    # ... metadata patch, probes, blueprint, write, QA
```

### Output-filnamn

Spara varje artikel som `articles/job_NN.md` där NN = job_number med ledande nolla.

---

## Kommando-referens

| Vill göra | Hur |
|-----------|-----|
| Starta session | Läs RUNBOOK.md → SYSTEM.md → producera EXECUTION CONFIRMATION |
| Ladda jobb | `pipe.load_jobs('jobs.csv')` |
| Köra preflights (batch) | `asyncio.run(pipe.run_batch_preflight(jobs))` |
| Köra preflight (enskilt) | `asyncio.run(pipe.run_preflight(job))` |
| Patcha metadata | `preflight.target.title = "..."` efter web_search |
| Generera probes | `analyzer.build_research_plan_from_metadata(url, title, desc)` |
| Köra SERP | `analyzer.analyze_probe_results(plan, step, results)` |
| Hitta trustlinks | `analyzer.build_trustlink_queries(preflight.bridge, plan, title)` |
| Skapa blueprint | `create_blueprint_from_pipeline(...)` — se Fas 6 ovan |
| Skriva artikel | Följ `bp.to_agent_prompt()` + SYSTEM.md regler → disk |
| Köra QA | qa-template.md: 11 checks, alla PASS |

---

## Felsökning

| Problem | Lösning |
|---------|---------|
| pipeline.py import error | `pip install aiohttp beautifulsoup4` — eller kör utan (degraderar gracefully) |
| preflight.target tom | Normalt utan aiohttp — agent patchar med web_search (Fas 3) |
| Probes ger tunn data | Kör extra web_search med varianter av probe.query |
| Artikel för kort | SYSTEM.md kräver 750–900 ord — expandera |
| Artikel för lång | SYSTEM.md max 900 ord — strama åt |
| Ankarlänk fel position | Ska vara ord 250–550, kontrollera med QA-script |
| Svag kontextbrygga | Behöver fler trustlinks — 1-2 som binder publisher→target |
| Blueprint warnings | Normalt pre-SERP — viability/anchor warnings löses av SERP-data |
| Agent kör solo | Bryter HC-9 — MÅSTE använda både pipeline.py OCH engine.py |

---

## Prioritetsordning vid konflikter

1. **Säkerhet** — Aldrig förhandlingsbart
2. **Hårda krav** — Ordantal 750–900, anchor 250–550, trustlinks 1–2, max 1 heading, no bullets
3. **SERP-fidelitet** — SERP-bekräftade entiteter, inte gissningar
4. **Kvalitet** — QA 11/11 PASS
5. **Stil** — SYSTEM.md skrivriktlinjer

---

*BACOWR v6.3 — 2026-02-19*
*Orkestrering: SKILL.md + FLOWMAP.md*
*Exekveringsguide: RUNBOOK.md*
*Artikelregler: SYSTEM.md*
