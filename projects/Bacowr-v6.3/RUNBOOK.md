# BACOWR v6.3 — RUNBOOK

> Fristående guide för en zero-context agent att producera artiklar.
> Varje steg innehåller exakt Python-kod som kan kopieras och köras.
> Agenten behöver bara fylla i web_search-resultat.

---

## Förutsättningar

```
Python 3.10+
pip install aiohttp beautifulsoup4   # (valfritt — degraderar gracefully utan)
```

Filer som måste finnas i projektrooten:

| Fil | Syfte |
|-----|-------|
| `pipeline.py` | Preflight: publisher-profil, target-fingerprint, semantisk brygga |
| `engine.py` | Blueprint: SERP-probes, topic, thesis, sections |
| `models.py` | Datamodeller (JobSpec, Preflight, PublisherProfile, etc.) |
| `article_validator.py` | 11-checks QA-validering |
| `SYSTEM.md` | Artikelregler (ordantal, anchor, trustlinks, stil) |
| `jobs.csv` | Jobblista (eller annan CSV) |

---

## Steg 0: Systemverifiering

Kör smoke test för att verifiera att systemet är redo:

```bash
python smoke_test.py
```

Förväntat: `SMOKE TEST PASSED`. Om det failar, fixa innan du fortsätter.

> **Full testsvit** (222 tester, ~2 min) behöver bara köras vid installation eller kodändringar:
> `python -m pytest tests/ -v --tb=short`

---

## Steg 1: Sessionsinit

Läs följande filer i ordning för att förstå systemet:

1. **SKILL.md** — Hard constraints, 8-fas flöde, file roles
2. **INIT.md** — Sessionsstart, crash recovery
3. **CLAUDE.md** — Kommandon, filstruktur, batch, felsökning
4. **SYSTEM.md** — Artikelregler: ordantal, anchor, trustlinks, stil

Dessa filer styr hela sessionen. SKILL.md är den styrande filen.

---

## Steg 2: Ladda jobb

```python
from pipeline import Pipeline, PipelineConfig
import asyncio

pipe = Pipeline(PipelineConfig())
jobs = pipe.load_jobs('jobs.csv')

# Visa laddade jobb
for job in jobs:
    print(f"Jobb {job.job_number}: {job.publisher_domain} → {job.anchor_text}")
```

### CSV-format

```csv
job_number,publication_domain,target_page,anchor_text
1,teknikbloggen.se,https://www.indoorprofessional.se/tjanster/lokalvard/,lokalvård
2,villanytt.se,https://www.rusta.com/sv/mattor,mattor
```

Flexibla header-namn stöds (t.ex. `job_nummer`, `publisher_domain`, `target_url`).
Pipe-delimiter (`|`) stöds. Malformade URL:er fixas automatiskt.

---

## Steg 2b: Batch preflight (alla jobb samtidigt)

Kör alla preflights parallellt (upp till 10 samtidigt). Detta laddar embedding-modellen
en gång och kör sedan publisher/target-analys concurrent.

```python
all_preflights = asyncio.run(pipe.run_batch_preflight(jobs))

# Resultat: lista av Preflight-objekt, ett per jobb
for pf in all_preflights:
    print(f"Jobb {pf.job.job_number}: {pf.bridge.distance_category.value} ({pf.bridge.raw_distance:.3f})")
```

> **Varför batch?** Embedding-modellen laddas en gång med `pipe.warmup()` internt.
> Publisher- och target-analys är I/O-bundna (HTTP) och körs parallellt via `asyncio.gather`.
> 10 jobb tar ungefär lika lång tid som 1 jobb.

---

## Steg 3: Per-jobb exekvering

Kör steg 3.1–3.7 för varje jobb. Använd preflight från batch-steget ovan.

### 3.1 Fas 2: Preflight

Preflight är redan klar från steg 2b. Hämta rätt preflight:

```python
# Om batch: preflight finns redan i all_preflights
preflight = all_preflights[0]  # eller loop

# Om enskilt jobb:
# preflight = asyncio.run(pipe.run_preflight(job))
```

### 3.2 Fas 3: Metadata-patch

Hämta target-sidans faktiska metatitel och metabeskrivning via web_search eller web_fetch.
**Anta aldrig metadata — verifiera alltid.**

```python
# Agent kör: web_search("indoorprofessional.se lokalvård")
# eller: web_fetch("https://www.indoorprofessional.se/tjanster/lokalvard/")
# Extrahera title och meta description från resultatet.

preflight.target.title = "Faktisk metatitel från web_search"
preflight.target.meta_description = "Faktisk metabeskrivning från web_search"
```

### 3.3 Fas 4: Probe-generering

```python
from engine import TargetIntentAnalyzer

analyzer = TargetIntentAnalyzer()
plan = analyzer.build_research_plan_from_metadata(
    url=preflight.target.url,
    title=preflight.target.title,
    description=preflight.target.meta_description,
)

# plan.probes → 5 sökfrågor att köra med web_search
for probe in plan.probes:
    print(f"Steg {probe.step} ({probe.step_name}): {probe.query}")
    print(f"  Syfte: {probe.purpose[:80]}...")
```

### 3.4 Fas 5: SERP-exekvering + trustlinks

Kör alla 5 probes med web_search. För varje probe, läs metatitel + metabeskrivning
för position 1-3 och mata tillbaka till analysen.

```python
for i, probe in enumerate(plan.probes):
    # Agent kör: results = web_search(probe.query)
    # results ska vara en lista av dicts:
    #   [{"title": "...", "description": "...", "url": "..."}, ...]

    results = web_search(probe.query)  # ← agent fyller i

    # Mata tillbaka top-3 resultat
    top3 = results[:3]
    plan = analyzer.analyze_probe_results(plan, i + 1, top3)

# Kontrollera syntesresultat
print(f"Core entities: {plan.core_entities}")
print(f"Cluster entities: {plan.cluster_entities}")
print(f"LSI terms: {plan.lsi_terms}")
print(f"Confirmed intent: {plan.confirmed_intent}")
```

**Trust link discovery** (efter SERP-probes):

```python
tl_queries = analyzer.build_trustlink_queries(
    preflight.bridge, plan, preflight.target.title
)

trustlink_candidates = []
for q in tl_queries:
    # Agent kör: results = web_search(q)
    results = web_search(q)  # ← agent fyller i
    trustlink_candidates.extend(results)

# Filtrera och ranka
selected = analyzer.select_trustlinks(
    candidates=trustlink_candidates,
    trust_topics=preflight.bridge.trust_link_topics if preflight.bridge else [],
    avoid_domains=preflight.bridge.trust_link_avoid if preflight.bridge else [],
    target_domain=job.target_url.split("/")[2].replace("www.", ""),
    publisher_domain=job.publisher_domain,
)

# Välj 1-2 bästa trustlinks
for tl in selected[:2]:
    print(f"Trustlink: {tl['title']} → {tl['url']}")
```

### 3.5 Fas 6: Blueprint

```python
from engine import create_blueprint_from_pipeline

bp = create_blueprint_from_pipeline(
    job_number=job.job_number,
    publisher_domain=job.publisher_domain,
    target_url=job.target_url,
    anchor_text=job.anchor_text,
    publisher_profile=preflight.publisher,
    target_fingerprint=preflight.target,
    semantic_bridge=preflight.bridge,
)

# Koppla SERP-data till blueprint
bp.target.intent_profile = plan

# Generera agent-prompt
prompt = bp.to_agent_prompt()
print(prompt[:500])
```

### 3.6 Fas 7: Skriv artikel

**Innan du skriver:** Läs `skills/editorial-overlay.md` och följ Fas A (Research Mining)
för att hitta spänning, förfina tes, och kartlägga argumentet. Overlayen adderar redaktionell
kvalitet utan att ändra hårda krav eller pipeline-flöde.

Skriv artikeln till disk med SYSTEM.md-regler, blueprintens prompt, och editorial overlay.

**Hårda krav:**

| Krav | Värde |
|------|-------|
| Ordantal | 750–900 |
| Ankarlänk | Exakt 1, format `[anchor_text](target_url)` |
| Ankarposition | Ord 250–550 |
| Trustlänkar | 1–2, FÖRE ankarlänken |
| Headings | Max 1 (titeln) |
| Punktlistor | Inga |
| Förbjudna fraser | Se SYSTEM.md §6 |
| Stycken | Minst 4, vardera 100–200 ord |

```python
from pathlib import Path

articles_dir = Path("articles")
articles_dir.mkdir(exist_ok=True)

# Agent skriver artikeltexten baserat på prompt + SYSTEM.md regler
article_text = """[Agent skriver artikeln här baserat på bp.to_agent_prompt()]"""

# Spara med nollpaddat jobbnummer
output_path = articles_dir / f"job_{job.job_number:02d}.md"
output_path.write_text(article_text, encoding="utf-8")
print(f"Artikel sparad: {output_path}")
```

### 3.7 Fas 8: QA

Kör 11 binära checks. Alla måste passera.

```python
from article_validator import validate_article

article_text = output_path.read_text(encoding="utf-8")

result = validate_article(
    article_text=article_text,
    anchor_text=job.anchor_text,
    target_url=job.target_url,
    publisher_domain=job.publisher_domain,
    language=preflight.language,
    serp_entities=plan.core_entities + plan.cluster_entities if plan else None,
)

# Skriv ut resultat
passed = sum(1 for c in result.checks if c.passed)
total = len(result.checks)
print(f"\nQA: {passed}/{total} PASS")
for check in result.checks:
    status = "PASS" if check.passed else "FAIL"
    print(f"  [{status}] {check.name}: {check.message}")

# Artikeln är godkänd om alla checks passerar
assert result.passed, f"QA failed: {passed}/{total}"
```

**Om QA failar:** Fixa problemen och kör QA igen. Vanliga fixes:

| Check | Vanlig fix |
|-------|-----------|
| word_count | Expandera (för kort) eller strama åt (för lång) |
| anchor_position | Flytta ankarlänken till ord 250–550 |
| trustlinks | Lägg till 1–2 verifierade trustlänkar FÖRE ankarlänken |
| no_bullets | Ta bort alla punktlistor |
| headings | Behåll bara titeln, ta bort H2/H3 |
| forbidden_phrases | Ersätt AI-fraser med naturligt språk |
| paragraphs | Se till att minst 4 stycken har 100–200 ord |

---

## Batch-mode

Kör batch preflight först, sedan steg 3.2–3.7 per jobb.

```python
jobs = pipe.load_jobs('jobs.csv')

# Kör alla preflights parallellt (steg 2b)
all_preflights = asyncio.run(pipe.run_batch_preflight(jobs))

for preflight in all_preflights:
    job = preflight.job
    print(f"\n{'='*60}")
    print(f"JOBB {job.job_number}: {job.publisher_domain} → {job.anchor_text}")
    print(f"{'='*60}")

    # Fas 3: Metadata-patch (agent kör web_search/web_fetch)
    # preflight.target.title = "..."
    # preflight.target.meta_description = "..."

    # Fas 4: Probes
    analyzer = TargetIntentAnalyzer()
    plan = analyzer.build_research_plan_from_metadata(
        url=preflight.target.url,
        title=preflight.target.title,
        description=preflight.target.meta_description,
    )

    # Fas 5: SERP (agent kör 5× web_search + trustlink-sökning)
    # for i, probe in enumerate(plan.probes): ...
    # tl_queries = analyzer.build_trustlink_queries(...)

    # Fas 6: Blueprint
    bp = create_blueprint_from_pipeline(
        job_number=job.job_number,
        publisher_domain=job.publisher_domain,
        target_url=job.target_url,
        anchor_text=job.anchor_text,
        publisher_profile=preflight.publisher,
        target_fingerprint=preflight.target,
        semantic_bridge=preflight.bridge,
    )
    bp.target.intent_profile = plan
    prompt = bp.to_agent_prompt()

    # Fas 7: Skriv artikel → articles/job_NN.md
    # Fas 8: QA (validate_article → 11/11 PASS)
```

---

## Felhantering

| Problem | Lösning |
|---------|---------|
| `pipeline.py` import error | `pip install aiohttp beautifulsoup4` — eller kör utan (degraderar gracefully) |
| `preflight.target` tom | Normalt utan aiohttp — agent patchar med web_search (Fas 3) |
| Probes ger tunn data | Kör extra web_search med varianter av `probe.query` |
| Artikel för kort (< 750) | Expandera stycken, lägg till fördjupning |
| Artikel för lång (> 900) | Strama åt, ta bort upprepning |
| Ankarlänk fel position | Flytta till ord 250–550, kontrollera med QA |
| Svag kontextbrygga | Behöver fler trustlinks — 1–2 som binder publisher→target |
| Blueprint warnings | Normalt pre-SERP — viability/anchor warnings löses av SERP-data |
| `validate_article` import error | `from article_validator import validate_article` |
| Trustlinks avvisade i QA | Verifiera med web_fetch att URL:erna är djuplänkar och inte target/publisher-domäner |

---

## Quick-ref: Hårda krav (checklista)

- [ ] **Ordantal**: 750–900
- [ ] **Ankarlänk**: Exakt 1, `[anchor_text](target_url)`, ord 250–550
- [ ] **Ankar EJ i intro**: Inte i första 250 orden
- [ ] **Ankar EJ i outro**: Inte i sista 100 orden
- [ ] **Trustlänkar**: 1–2, FÖRE ankarlänken, djuplänkar, ej target/publisher
- [ ] **Headings**: Max 1 (titeln)
- [ ] **Punktlistor**: Inga
- [ ] **Förbjudna fraser**: Inga (se SYSTEM.md §6)
- [ ] **Språk**: Matchar publisher-domänens språk (sv/en)
- [ ] **SERP-entiteter**: Minst 4 unika invävda
- [ ] **Stycken**: Minst 4, vardera 100–200 ord
- [ ] **Fil**: Sparad som `articles/job_NN.md`

---

*BACOWR v6.2 — RUNBOOK*
*Genererad 2026-02-19*
