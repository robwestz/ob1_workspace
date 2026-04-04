# BACOWR v6.4 — Upgrade Plan

> **Skapad**: 2026-03-26
> **Scope**: 11 identifierade förbättringar, prioriterade efter impact/effort
> **Skill**: `skills/system-upgrade.md` styr konsistensprocessen per ändring
> **Mål**: Varje ändring testad, verifierad, dokumenterad. Inga inkonsistenser.
>
> ## STATUS
> - **Wave 1**: KLAR (2026-03-26) — Punkt 1, 4, 10 + bonus: target_intent-bugg fixad i 4 .md-filer
>> - **Wave 2**: KLAR (2026-03-26) — Punkt 2, 9 + punkt 3 rendering (redan i Wave 1)
> - **Wave 3**: Ej påbörjad
> - **Wave 4**: Ej påbörjad

---

## Beroendekarta

```
                    ┌──────────────────┐
                    │  Wave 1: Buggar  │
                    │   (inga deps)    │
                    └────────┬─────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
     ┌─────────┐      ┌──────────┐      ┌──────────┐
     │ Punkt 1 │      │ Punkt 4  │      │ Punkt 10 │
     │ bridge  │      │ intent   │      │ entities │
     │ passthru│      │ gap      │      │ _to_avoid│
     └────┬────┘      └──────────┘      └──────────┘
          │
          ▼
┌──────────────────────┐
│  Wave 2: Bridge-data │
│  (kräver punkt 1)    │
└──────────┬───────────┘
           │
     ┌─────┼─────┐
     ▼     ▼     ▼
  ┌────┐┌────┐┌────┐
  │ P2 ││ P3 ││ P9 │
  │ TL ││comp││ TL │
  │tops││ent ││suff│
  └────┘└────┘└────┘
           │
           ▼
┌──────────────────────┐
│  Wave 3: Scoring     │
│  (kräver wave 1-2)   │
└──────────┬───────────┘
           │
     ┌─────┼─────┐
     ▼     ▼     ▼
  ┌────┐┌────┐┌────┐
  │ P5 ││ P7 ││ P8 │
  │sect││ red ││dup │
  │ent ││thrd││brge│
  └────┘└────┘└────┘
           │
           ▼
┌──────────────────────┐
│  Wave 4: Embeddings  │
│  (kräver wave 1-3)   │
└──────────────────────┘
           │
           ▼
        ┌────┐
        │ P6 │
        │embd│
        └────┘
```

---

## Wave 1: Bugfixar (inga beroenden)

Dessa tre kan köras parallellt. Varje punkt fixar data som genereras men kastas bort.

---

### Punkt 1: Skicka semantic_bridge till orchestratorn
**Typ**: Bug | **Impact**: Kritisk | **Effort**: ~5 rader kod + ~20 rader docs

**Kodfiler**:
- `engine.py`: `create_blueprint_from_pipeline()` (rad 2816-2875)
- `engine.py`: `ArticleOrchestrator.create_blueprint()` (rad 2505-2514)

**Vad som ändras**:
1. Lägg till `semantic_bridge` parameter i `create_blueprint()` signatur
2. Skicka `semantic_bridge` från `create_blueprint_from_pipeline()` → `create_blueprint()`
3. I `create_blueprint()`: använd `semantic_bridge.recommended_angle` som input till TopicDiscovery
4. Använd `semantic_bridge.required_entities` för att berika entities_to_weave
5. Använd `semantic_bridge.forbidden_entities` för entities_to_avoid
6. Använd `semantic_bridge.suggestions` för bridge-candidates

**Dokumentation att uppdatera**:
- `references/engine-api.md`: Uppdatera `create_blueprint()` signatur
- `FLOWMAP.md`: Visa att bridge-data flödar från pipeline → engine
- `SKILL.md`: Notera att bridge-data nu används (ej kastad)

**Verifiering**:
```python
bp = create_blueprint_from_pipeline(..., semantic_bridge=preflight.bridge)
# Verifiera: bp.sections[0].entities_to_cover inkluderar bridge-entiteter
# Verifiera: bp.chosen_topic.reasoning refererar bridge.recommended_angle
```

---

### Punkt 4: Rendera intent_gap i agent-prompten
**Typ**: Bug | **Impact**: Hög | **Effort**: ~5 rader kod + ~10 rader docs

**Kodfiler**:
- `engine.py`: `AgentPromptRenderer.render()` (rad 2264-2413)

**Vad som ändras**:
1. I render(), efter SERP INTELLIGENCE-sektionen, lägg till:
   ```python
   if bp.target.intent_profile and bp.target.intent_profile.intent_gap:
       lines.append(f"\n### INTENT GAP (VIKTIGT)")
       lines.append(bp.target.intent_profile.intent_gap)
       lines.append("Artikeln MÅSTE ta hänsyn till detta gap — skriv mot den intention Google faktiskt visar.")
   ```

**Dokumentation att uppdatera**:
- `references/engine-api.md`: Dokumentera ny sektion i agent-prompten
- `SKILL.md`: Notera att intent_gap nu syns för agenten

**Verifiering**:
```python
prompt = bp.to_agent_prompt()
assert "INTENT GAP" in prompt  # (om gap existerar)
```

---

### Punkt 10: Populera entities_to_avoid
**Typ**: Bug | **Impact**: Medel | **Effort**: ~3 rader kod + ~5 rader docs

**Kodfiler**:
- `engine.py`: `_synthesize()` (rad 885)

**Vad som ändras**:
1. Ändra `profile.entities_to_avoid = []` till:
   ```python
   profile.entities_to_avoid = [e for e in profile.competitor_entities
                                 if e not in profile.core_entities
                                 and e not in profile.cluster_entities][:5]
   ```
   (Entiteter som konkurrenter använder men som INTE är core/cluster = sannolikt irrelevanta eller misvisande)

**Dokumentation att uppdatera**:
- `references/engine-api.md`: Dokumentera att entities_to_avoid nu populeras

**Verifiering**:
```python
assert len(profile.entities_to_avoid) >= 0  # Kan vara 0 om competitor_entities ⊂ core+cluster
```

---

## Wave 2: Bridge-data (kräver punkt 1)

Dessa tre kan köras parallellt efter att punkt 1 är klar.

---

### Punkt 2: Intelligent _trust_link_topics()
**Typ**: Förbättring | **Impact**: Kritisk | **Effort**: ~20 rader kod + ~15 rader docs

**Kodfiler**:
- `pipeline.py`: `_trust_link_topics()` (rad 559-561)

**Vad som ändras**:
1. Ersätt trivial implementation med:
   ```python
   def _trust_link_topics(self, pub, target, bridge_concept=None, anchor_text=None):
       topics = []
       # Primär: bridge-konceptet (semantiska bryggan)
       if bridge_concept:
           topics.append(bridge_concept)
       # Sekundär: skärningspunkt publisher + target
       overlap = set(pub.primary_topics) & set(getattr(target, 'main_keywords', []))
       topics.extend(list(overlap)[:2])
       # Tertiär: anchor-kontext
       if anchor_text and anchor_text not in topics:
           topics.append(f"{anchor_text} guide")
       # Fallback
       if not topics:
           topics = pub.primary_topics[:2]
       return topics[:4]
   ```
2. Uppdatera anropet i `analyze()` att skicka bridge_concept och anchor_text

**Dokumentation att uppdatera**:
- `references/engine-api.md`: Ny signatur
- `RUNBOOK.md`: Steg 3.5 — trustlink-sökning nu mer intelligent
- `FLOWMAP.md`: Visa att bridge-concept matar trustlink-generering

**Verifiering**: Kör preflight, kontrollera att trust_link_topics INTE är `["statistik", "forskning"]`.

---

### Punkt 3: Rendera competitor_entities i prompten
**Typ**: Förbättring | **Impact**: Hög | **Effort**: ~10 rader kod + ~10 rader docs

**Kodfiler**:
- `engine.py`: `AgentPromptRenderer.render()` (rad 2264-2413)

**Vad som ändras**:
1. I SERP INTELLIGENCE-sektionen, lägg till:
   ```python
   if bp.target.intent_profile and bp.target.intent_profile.competitor_entities:
       lines.append(f"\n**TA-GAP ENTITIES** (entiteter konkurrenter rankar med men som target saknar — väv in dessa):")
       lines.append(", ".join(bp.target.intent_profile.competitor_entities))
   ```

**Dokumentation att uppdatera**:
- `references/engine-api.md`: Ny sektion i prompt
- `SKILL.md`: Dokumentera TA-gap entity weaving
- `SYSTEM.md`: Ev. ny riktlinje om TA-gap entiteter

**Verifiering**: prompt innehåller "TA-GAP ENTITIES".

---

### Punkt 9: Fix build_trustlink_queries() suffix
**Typ**: Förbättring | **Impact**: Medel | **Effort**: ~15 rader kod + ~5 rader docs

**Kodfiler**:
- `engine.py`: `build_trustlink_queries()` (rad 1027-1050)

**Vad som ändras**:
1. Ersätt `"{t} rapport forskning"` med intelligentare formatering:
   ```python
   if len(t.split()) >= 3:
       queries.append(t)  # Redan specifik nog
   else:
       queries.append(f"{t} guide studie")  # Bredare än "rapport forskning"
   ```
2. Lägg till variant-query med plan.head_entity + bridge-concept

**Dokumentation att uppdatera**:
- `references/engine-api.md`: Uppdatera build_trustlink_queries() beteende

**Verifiering**: Sökfrågor ger relevanta trustlink-kandidater istället för generiska "rapport forskning"-resultat.

---

## Wave 3: Scoring & validering (kräver wave 1-2)

---

### Punkt 5: Fördela entities_to_cover över sektioner
**Typ**: Förbättring | **Impact**: Medel | **Effort**: ~30 rader kod + ~10 rader docs

**Kodfiler**:
- `engine.py`: `SectionPlanner.plan()` (rad 1895-1980)

**Vad som ändras**:
1. Ta emot `entities_to_weave` och `core_entities` som input
2. Fördela:
   - HOOK: 2 core entities (attention-grabbing)
   - ESTABLISH: 2-3 core entities (grounding)
   - DEEPEN: 2-3 cluster entities (nyanser)
   - ANCHOR: 1-2 entities nära anchor_text semantiskt
   - PIVOT: 2 cluster entities
   - RESOLVE: 1 core entity (knyter ihop)

**Dokumentation att uppdatera**:
- `FLOWMAP.md`: Visa entity-distribution i section planning
- `SKILL.md`: Notera att entities nu fördelas medvetet
- `references/engine-api.md`: SectionPlan.entities_to_cover nu populerad

**Verifiering**: Varje sektion har minst 1 entity.

---

### Punkt 7: Stärk RedThreadValidator
**Typ**: Förbättring | **Impact**: Medel | **Effort**: ~30 rader kod + ~10 rader docs

**Kodfiler**:
- `engine.py`: `RedThreadValidator.validate()` (rad 1999-2057)

**Vad som ändras**:
1. Ordöverlapp-check: `connects_to_next[N]` och `connects_to_previous[N+1]` måste dela minst 1 substantivt ord
2. Role-progression: verifiera att roles inte hoppar (HOOK→DEEPEN utan ESTABLISH = varning)
3. Thesis-alignment: varje sections purpose måste referera till thesis-nyckelord

**Dokumentation att uppdatera**:
- `SKILL.md`: RedThreadValidator nu semantisk
- `FLOWMAP.md`: Validering av röd tråd

**Verifiering**: En avsiktligt dålig sektionsplan ska FAILA.

---

### Punkt 8: Konsolidera bridge-tabeller
**Typ**: Cleanup | **Impact**: Låg | **Effort**: ~20 rader kod + ~10 rader docs

**Kodfiler**:
- Ny fil: `bridge_patterns.py` (eller sektion i models.py)
- `pipeline.py`: Importera istället för hårdkoda
- `engine.py`: Importera istället för hårdkoda

**Vad som ändras**:
1. Skapa enhetlig datastruktur med alla vertikaler
2. Merge pipeline.py:s 14 par och engine.py:s par — ta det bästa från båda
3. Båda filer importerar från samma källa

**Dokumentation att uppdatera**:
- `references/engine-api.md`: Referera ny källa
- `FLOWMAP.md`: Visa gemensam datakälla

**Verifiering**: `from bridge_patterns import BRIDGE_MAP` fungerar i båda modulerna.

---

## Wave 4: Embeddings i engine (kräver wave 1-3)

---

### Punkt 6: Exponera embedding-modell till engine.py
**Typ**: Arkitektur | **Impact**: Hög/Transformativ | **Effort**: ~50 rader kod + ~20 rader docs

**Kodfiler**:
- `pipeline.py`: Exponera `_cosine_similarity()` eller modellen
- `engine.py`: `_calc_semantic_pull()`, `_assess_anchor_naturalness()`, `RedThreadValidator`
- Ev. `shared_embeddings.py` som båda importerar

**Vad som ändras**:
1. Extrahera embedding-logiken till en delad modul eller exponera via interface
2. I `create_blueprint_from_pipeline()`: skicka med en `similarity_fn` callback
3. Ersätt ordöverlapp i:
   - `_calc_semantic_pull()` → cosine similarity
   - `_assess_anchor_naturalness()` → cosine similarity
   - `RedThreadValidator` (punkt 7) → embedding-validering av röd tråd

**Dokumentation att uppdatera**:
- `references/engine-api.md`: Scoring nu embedding-baserad
- `FLOWMAP.md`: Embedding-modell delad mellan pipeline och engine
- `SKILL.md`: Scoring-funktioner uppdaterade
- `context/stack.md`: Notera embedding-beroende

**Verifiering**:
```python
# "belysningsplanering" vs "ljussättning" ska ge >0.5 similarity
assert engine._calc_semantic_pull(bridge_with_belysning, pub_with_ljussattning) > 0.3
```

---

## Punkt 11 (ny): overlap_entities/gap_entities
**Typ**: Förbättring | **Impact**: Medel | **Effort**: ~10 rader (ingår i punkt 1)

Löses automatiskt av punkt 1 — när semantic_bridge skickas vidare har orchestratorn tillgång till `bridge.overlap_entities` och `bridge.gap_entities`. Dessa kan användas direkt som input till entity-distribution (punkt 5).

---

## Exekveringsordning

```
Pass 1 (parallellt):   Punkt 1 + Punkt 4 + Punkt 10
                        ↓ verifiering
Pass 2 (parallellt):   Punkt 2 + Punkt 3 + Punkt 9
                        ↓ verifiering
Pass 3 (parallellt):   Punkt 5 + Punkt 7 + Punkt 8
                        ↓ verifiering
Pass 4 (sekventiellt): Punkt 6
                        ↓ verifiering

Mellan varje pass:
  1. smoke_test.py
  2. Kör testjobb (Fas 2-6) — verifiera att prompten förbättrats
  3. Grep alla .md-filer för gammal terminologi
  4. Läs RUNBOOK.md + SKILL.md + references/engine-api.md — stämmer allt?
```

---

## Definition of Done (per punkt)

- [ ] Kod ändrad och testad inline
- [ ] smoke_test.py passerar
- [ ] Test-jobb genom pipeline ger korrekt output
- [ ] ALLA berörda .md-filer uppdaterade (se konsekvensmatrisen i skills/system-upgrade.md)
- [ ] Grep efter gammal terminologi = 0 träffar
- [ ] Agent-prompt verifierad (ny data syns / gammal bugg borta)

---

## Versionshantering

Efter alla 4 waves:
- Uppdatera version i CLAUDE.md: v6.3 → v6.4
- Uppdatera datum
- Skapa sammanfattning i memory/log.md
- Git commit med detaljerad changelog

---

*UPGRADE-PLAN.md — BACOWR v6.3→v6.4*
*Skill: skills/system-upgrade.md*
*11 punkter, 4 waves, fullständig konsekvensmatris*
