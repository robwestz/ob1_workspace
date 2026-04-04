# System Upgrade Skill — Konsekvent koduppdatering

> **Version**: 1.0
> **Aktivering**: Innan VARJE kodändring i pipeline.py, engine.py, models.py eller article_validator.py
> **Concurrency**: Kodändringar SEKVENTIELLT (en fil i taget). Dokumentation kan uppdateras parallellt.
> **Konfliktrisk**: Låg om processen följs. Hög om steg hoppas över.

---

## Syfte

Denna skill säkerställer att VARJE kodändring i BACOWR-systemet:
1. Uppdaterar alla berörda filer konsekvent
2. Aldrig lämnar dokumentation som beskriver ett annat beteende än koden
3. Inte bryter befintlig funktionalitet
4. Verifieras med test innan nästa ändring påbörjas

---

## Berörda filer — Konsekvensmatris

Varje kodfil har dokumentationsfiler som MÅSTE uppdateras när koden ändras:

### pipeline.py
| Om du ändrar... | Uppdatera även |
|-----------------|---------------|
| `SemanticEngine.analyze()` | FLOWMAP.md (Fas 2), RUNBOOK.md (steg 3.2) |
| `_trust_link_topics()` | SKILL.md (HC-referens), RUNBOOK.md (steg 3.5), references/engine-api.md |
| `VERTICAL_BRIDGES` | engine.py `BRIDGE_PATTERNS` (eller konsolidera), SKILL.md |
| `_cosine_similarity()` | Om exponerad till engine: engine-api.md, FLOWMAP.md |
| `run_preflight()` / `run_batch_preflight()` | RUNBOOK.md (steg 3.2), CLAUDE.md (Fas 1-2) |
| Nya fält i Preflight | models.py, engine.py (create_blueprint_from_pipeline), FLOWMAP.md |
| Nya fält i SemanticBridge | models.py, engine.py, references/engine-api.md |

### engine.py
| Om du ändrar... | Uppdatera även |
|-----------------|---------------|
| `create_blueprint_from_pipeline()` | references/engine-api.md (signaturer), CLAUDE.md (Fas 6), RUNBOOK.md (steg 3.6) |
| `ArticleOrchestrator.create_blueprint()` | references/engine-api.md |
| `AgentPromptRenderer.render()` | SYSTEM.md (om nya sektioner), references/system-rules.md, SKILL.md |
| `SectionPlanner.plan()` | FLOWMAP.md (section planning), SKILL.md |
| `TargetIntentAnalyzer` | references/engine-api.md, RUNBOOK.md (steg 3.4-3.5) |
| `build_trustlink_queries()` | RUNBOOK.md (steg 3.5), references/engine-api.md |
| `BRIDGE_PATTERNS` | pipeline.py `VERTICAL_BRIDGES` (eller konsolidera) |
| `RedThreadValidator` | SKILL.md, FLOWMAP.md |
| Scoring-funktioner | SKILL.md (om scoring ändrar beteende) |

### models.py
| Om du ändrar... | Uppdatera även |
|-----------------|---------------|
| `SemanticBridge` fält | pipeline.py (populering), engine.py (konsumtion), references/engine-api.md |
| `TargetIntentProfile` fält | engine.py (render), references/engine-api.md |
| `PublisherProfile` fält | pipeline.py, engine.py, references/engine-api.md |
| Nya dataklasser | references/engine-api.md (alltid) |

### article_validator.py
| Om du ändrar... | Uppdatera även |
|-----------------|---------------|
| Nya checks | references/qa-template.md, SYSTEM.md (om ny regel), SKILL.md |
| Ändrade trösklar | references/system-rules.md, SYSTEM.md |
| Ny parameter till validate_article() | RUNBOOK.md (steg 3.8), references/engine-api.md |

---

## Process per kodändring

### Steg 1: Före ändring

```
1. Identifiera ALLA filer som berörs (använd matrisen ovan)
2. Läs nuvarande tillstånd i alla berörda filer
3. Kör smoke_test.py — baseline måste vara grön
4. Notera exakt vilka rader/sektioner i dokumentationen som beskriver
   det beteende du ska ändra
```

### Steg 2: Kodändring

```
1. Gör ändringen i kodfilen (EN fil per commit-enhet)
2. Kör inline-test som verifierar att ändringen fungerar:
   python -c "from [modul] import [klass]; [verifiering]"
3. Om testet misslyckas — fixa innan du går vidare
```

### Steg 3: Dokumentationsuppdatering

```
1. Uppdatera VARJE fil från konsekvensmatrisen
2. Säkerställ att INGEN fil beskriver det gamla beteendet
3. Specifikt kontrollera:
   - references/engine-api.md: signaturer, parametrar, returvärden
   - RUNBOOK.md: exekveringssteg som berörs
   - SKILL.md: hard constraints om berörda
   - FLOWMAP.md: dataflow om pipeline ändras
   - SYSTEM.md: artikelregler om validering ändras
   - CLAUDE.md: kommandoreferens om API ändras
```

### Steg 4: Verifiering

```
1. Kör smoke_test.py — fortfarande grönt?
2. Kör ett test-jobb genom hela pipelinen (preflight → blueprint → prompt)
3. Verifiera att agent-prompten innehåller den nya datan
4. Kör validate_article() på en befintlig artikel — 11/11?
5. Grep efter gammal terminologi i alla .md-filer:
   grep -r "gammal_term" *.md references/*.md
```

### Steg 5: Konsistenskontroll

```
1. Läs CLAUDE.md — stämmer kommandoreferensen?
2. Läs RUNBOOK.md — stämmer steg-för-steg?
3. Läs references/engine-api.md — stämmer signaturer?
4. Läs SKILL.md — stämmer hard constraints?
5. Om NÅGOT inte stämmer — fixa innan du går vidare till nästa ändring
```

---

## Regler

1. **En logisk ändring i taget.** Blanda inte punkt 1 och punkt 2 i samma pass.
2. **Kod först, docs sen.** Aldrig dokumentera en ändring du inte testat.
3. **Ingen ändring utan verifiering.** Om du inte kan testa det — gör det inte.
4. **Gammal terminologi = bugg.** Om en .md-fil fortfarande refererar till det gamla beteendet efter en ändring, är ändringen inte klar.
5. **Commit-meddelande beskriver VAD och VARFÖR.** Format: `fix(engine): pass semantic_bridge to orchestrator — pipeline data was silently dropped`

---

## Anti-mönster

- Ändra 5 filer i engine.py och sedan "fixa docs efteråt" → Garanterad inkonsistens
- Anta att en .md-fil inte berörs utan att kontrollera → Stale docs
- Testa bara den ändrade funktionen, inte hela kedjan → Regressioner
- Uppdatera RUNBOOK.md men glömma references/engine-api.md → Divergens
- Ändra modellklass i models.py utan att uppdatera konsumenterna → Runtime-fel

---

## Concurrency-garanti

- **Kodfiler**: Ändra EN kodfil per agent. Om agent A ändrar engine.py ska agent B INTE ändra engine.py samtidigt.
- **Dokumentationsfiler**: Kan uppdateras parallellt SÅ LÄNGE agenter ändrar olika sektioner.
- **Verifiering**: smoke_test.py och pipeline-test kan köras parallellt (read-only).

---

*System Upgrade Skill v1.0 — BACOWR v6.3*
*Aktiveras: Innan varje kodändring. Modifierar: ingenting. Skyddar: allt.*
