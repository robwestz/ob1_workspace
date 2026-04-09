# Knowledge Base Vision

> Det auktoritativa dokumentet för hela KB-visionen. Inget lämnas åt slumpen.
> Varje agent som läser detta ska förstå: vad vi bygger, varför, hur, och exakt
> var vi befinner oss.
>
> Ägare: Robin Westerlund
> Skapad: 2026-04-09
> Status: LEVANDE DOKUMENT — uppdateras löpande

---

## Innehåll

1. [Vem bygger detta](#1-vem-bygger-detta)
2. [Det stora målet](#2-det-stora-målet)
3. [Varför en knowledge base](#3-varför-en-knowledge-base)
4. [Inspiration och validering](#4-inspiration-och-validering)
5. [Tre-lager-modellen](#5-tre-lager-modellen)
6. [Hur lagren samverkar](#6-hur-lagren-samverkar)
7. [Artikelformat och struktur](#7-artikelformat-och-struktur)
8. [Agent-integration](#8-agent-integration)
9. [Teknisk infrastruktur](#9-teknisk-infrastruktur)
10. [Affärsvisionen](#10-affärsvisionen)
11. [Skills som upprätthåller struktur](#11-skills-som-upprätthåller-struktur)
12. [Evolutionsmodell](#12-evolutionsmodell)
13. [Bekräftade principer](#13-bekräftade-principer)
14. [Forskningsplan](#14-forskningsplan)
15. [Vad som redan byggts](#15-vad-som-redan-byggts)
16. [Ordnad roadmap](#16-ordnad-roadmap)

---

## 1. Vem bygger detta

**Robin Westerlund** — bygger en agentdriven IT-verksamhet på OB1-plattformen (Open Brain).

- Kommunicerar på svenska, teknisk engelska OK
- SEO som djupaste expertisområde
- Bygger Bacowr (bacowr.com) — en SEO backlink content engine som kommersialiseras som SaaS
- Föredrar parallell agentexekvering, inte sekventiell
- Kräver produktionskvalitet som standard, MVP bara som fallback
- Kör autonoma nattskift (8h iterativa sessioner med wave-protokoll)
- Har MacBook Air M2 som dedikerad agentplattform + Windows PC som daglig maskin
- Bygger PÅ OpenClaw, inte parallellt med det
- Har GitHub Student Developer Pack med gratis infrastrukturkrediter

**Motto:** *"Produktionsfärdigt som standard. MVP är bara något vi jobbar med om det finns anledning att inte jobba mot productionsfärdigt."*

---

## 2. Det stora målet

Driva en IT-avdelning som specialiserar sig inom tre områden:

1. **Mjukvaruutveckling** — webbapplikationer, SaaS-plattformar, API:er
2. **Webbplattformar** — kundprojekt som konsekvent levereras på hög nivå
3. **Digital marknadsföring** — med SEO som största expertisområde

Agenter gör det tunga lyftet. Robin styr, granskar, bekräftar. Knowledge base:n är det som säkerställer att agenter producerar på en konsekvent kvalitetsnivå — **"200k-nivån"** — oavsett projekt, agent eller tidpunkt.

### Vad "200k-nivån" betyder

En webbplattform som skulle kosta ~200 000 SEK att beställa från en kompetent byrå. Konkret:

- Lighthouse Performance >= 90
- Fullständig SEO-grundstruktur (meta, sitemap, robots, structured data, OG)
- WCAG 2.1 AA tillgänglighet
- HTTPS med säkerhetsheaders
- CI/CD med automatiska tester
- Error monitoring
- TypeScript strict mode
- Responsiv design (mobile-first)
- Analytics (privacy-compliant)

Se `knowledge-base/methods/quality-gates/200k-standard.md` (att skriva) för den fullständiga kvalitetsgrinden.

---

## 3. Varför en knowledge base

### Problemet utan KB

En LLM "kan" webbutveckling och SEO från sin träningsdata. Men:

- Den **improviserar** varje gång — ingen garanti för konsistens
- Den **saknar kontext** om vad Robin redan vet, testat, bekräftat
- Den **har inga standarder** för vad "bra nog" innebär
- Den **kan inte arbeta autonomt** — utan prompts vet den inte vad som behöver göras
- Den **lär sig inte** — varje session börjar från noll

### Lösningen med KB

Knowledge base:n gör en LLM till en senior konsult med internaliserad erfarenhet:

- **Konsistens:** Varje projekt utgår från samma bekräftade kunskap och standarder
- **Autonomi:** Agenten vet vad som behöver göras och hur, utan att fråga
- **Ackumulering:** Varje projekt, experiment och forskning gör systemet bättre
- **Skalbarhet:** 90-95% av varje projekt är redan löst — bara 5-10% kräver anpassning

### Skillnaden mot vanlig dokumentation

| Vanlig dokumentation | Denna KB |
|---------------------|----------|
| Passiv — ligger och väntar | Aktiv — injiceras i agentens kontext vid rätt tillfälle |
| Svarar på frågor | Styr vad agenten producerar och på vilken nivå |
| Manuellt underhållen | LLM-kompilerad, LLM-lintad, LLM-utökad |
| Flat struktur | Tre lager som samverkar och förstärker varandra |
| Read-only | Flywheel — output flödar tillbaka in som ny kunskap |

---

## 4. Inspiration och validering

### 4.1 Andrej Karpathy — "LLM Knowledge Bases" (mars 2026)

Karpathy (@karpathy) beskrev sitt system:

1. **Data ingest:** `raw/` med artiklar, papers, repos. Obsidian Web Clipper.
2. **LLM kompilerar wiki:** Markdown-filer med summor, backlinks, konceptartiklar, korsreferenser. LLM skriver och underhåller allt.
3. **Obsidian som IDE:** Visar raw data, kompilerad wiki, visualiseringar. Marp för slides.
4. **Q&A:** Vid ~100 artiklar, ~400K ord kan LLM-agenten forska i wikin utan RAG — auto-underhållna indexfiler räcker.
5. **Output:** Markdown, slides, bilder → Obsidian → fileras tillbaka in i wikin. Frågor "adderar" över tid.
6. **Linting:** LLM-hälsokontroller hittar inkonsistenser, saknad data, intressanta kopplingar.
7. **Tools:** Hemmabyggd sökmotor (webb-UI + CLI som LLM-verktyg).
8. **Framtid:** Syntetisk datagenerering + finetuning.

**Karpathys slutsats:** *"I think there is room here for an incredible new product instead of a hacky collection of scripts."*

### 4.2 DAIR Papers Observatory (elvis/@omarsar0)

Videoklipp från X som visar ett agentstyrt system för att utforska AI-forskningsartiklar:

- Orchestrator (konversation) → artifact-generator → interaktiv dashboard
- Fyra vyer: Overview (statistik + trender), Insights, Connections (cross-paper teman), Papers (kortformat)
- Iterativ förfining i realtid via konversation
- 91 papers analyserade med radar-chart, tidsserier, benchmark-tabeller

**Nyckelinsikt:** On-demand view switching utan att köra om hela analysen. Orchestrator → artifact-mönstret.

### 4.3 Jian Wang — "4-Layer Context System"

Tweet om CLAUDE.md som mer än en README:

1. **Project Memory** — beslut, konventioner, edge cases
2. **Behavior Gates** — guardrails, auto-fix, blockering av riskfyllda åtgärder
3. **Specialized Workflows** — tasks triggar automatiskt, playbooks, verktyg + logik
4. **Team Orchestration** — parallella agenter, tasks delas/löses/mergas

**Nyckelcitat:** *"Most engineers are still writing prompts. The ones moving 10x faster? They're building systems."*

### 4.4 Varför Robins vision är starkare

| Karpathy | Robin |
|----------|-------|
| Personlig research-wiki | **Operationell** KB som driver produktion |
| Passiva Q&A-queries | Agenter som **bygger** med KB som kvalitetsgrind |
| Generell research | Domänspecifik (SEO, webb, marknadsföring) |
| Hacky scripts | OB1 skills-arkitektur, strukturerad |
| Ingen persistence-layer | Supabase + pgvector via OpenClaw |
| Manual ingest | deep-fetch, heavy-file-ingestion, auto-capture skills |
| Solo researcher | Agent-team med nattskift, wave-protokoll, morning reports |

---

## 5. Tre-lager-modellen

Denna modell har bekräftats och validerats av två oberoende agenter som båda tolkade den identiskt.

### Layer 1: Domain KB — "Vad vi vet" (Referensbiblioteket)

**Syfte:** Kategoriserad, korsrefererad, bekräftad kunskap. Sources of truth.

**Innehåll:**
- SEO (teknisk SEO, innehållsstrategi, länkbyggande, Core Web Vitals, lokal SEO, structured data)
- Webbutveckling (frontend-mönster, backend-arkitektur, infrastruktur, säkerhet)
- Digital marknadsföring (konverteringsoptimering, analytics, e-post, betald media)
- Design (designsystem, typografi, färgteori, UX-mönster)
- AI & Agenter (prompt engineering, agentic architecture, context engineering, evaluering)
- Affär (prismodeller, kundhantering, projektscoping)

**Egenskaper:**
- Mångsidig — samma kunskap om teknisk SEO kan användas vid sajt-build, audit, eller innehållsskrivning
- Testbar — bekräftade sanningar som kan utvecklas vidare, testas i verkligheten, experimenteras med
- Autonom utgångspunkt — om inget uppdrag finns kan agenten välja område att fördjupa baserat på vad som är tunt i coverage-map:en
- Kategoriserad med tydlig struktur — inte en platt dump av fakta

**Nyckelinsikt (Robin):** *"Mindre projekt, projekt där två eller fler kunskaper kan användas metodiskt för att sammanställa sanningar, ge kontext, användas om man arbetar med något inom en kategori — då kan det vara grund för att testa lösningar."*

### Layer 2: Method KB — "Hur man arbetar" (Processmotorn)

**Syfte:** Procedurella ramverk som gör en kunnig agent till en kompetent konsult.

**Innehåll:**
- Projektlivscykel (intake → arkitektur → setup → build → QA → deploy → handoff)
- Kvalitetsgrindar (200k-standarden, SEO-audit, performance, tillgänglighet, säkerhet, kodkvalitet)
- Forskningsprotokoll (teknik-evaluering, konkurrentanalys, litteraturöversikt, experimentdesign)
- Autonomt arbete (nattskiftsprotokoll, områdesval, självförbättring, utforskning)
- Leveransformat (klientrapporter, interna rapporter, tekniska specifikationer, förslag)

**Egenskaper:**
- Steg-för-steg — start → mitt → färdigställande, med beslutslogik vid varje steg
- Inkluderar research och avsikts-/syftesdefinition
- Gör agenten autonom utan explicita prompts
- Kvalitetsgrindar definierar vad "bra nog" innebär — mätbart, inte subjektivt

**Nyckelinsikt (Robin):** *"Hur ska en agent veta hur den ska angripa något utan att nödvändigtvis ha fått explicita prompts? Då kan en knowledge base tala om för en agent hur den ska sätta upp något i flera steg där det första är att helt enkelt bygga upp regelverket för hur start, mitten och färdigställande ska gå till, inklusive ev. research och avsikt/syfte att uppnå."*

**Andra agentens tolkning:** *"Det här lagret förvandlar en kunnig agent till en kompetent konsult — skillnaden mellan att veta vad bra SEO är och att faktiskt kunna leverera en SEO-strategi från A till Ö."*

### Layer 3: Component KB — "Bygga med" (Produktionsfabriken)

**Syfte:** Färdiga, testade beståndsdelar som utgör 90-95% av varje projekt.

**Innehåll:**
- CMS-modeller (Next.js headless, Astro static, WordPress starter — kompletta startpunkter)
- Moduler (auth, SEO foundation, analytics, checkout, kontaktformulär, bildoptimering, i18n, CI/CD)
- UI-kit (Tailwind base, shadcn base)
- Infrastruktur (Vercel setup, Cloudflare setup, Docker compose)

**Egenskaper:**
- 90-95% av en webbplattform kan bestå av beprövade, färdiga beståndsdelar
- Bara 5-10% är klientspecifikt (design, innehåll, inriktning)
- Allt ska fungera tillsammans — kompatibilitetsmatris spårar vad som går ihop
- Ju mindre som behöver skrivas om desto bättre
- Flera CMS-modeller kan finnas, men delarna ska vara kompatibla sinsemellan

**Nyckelinsikt (Robin):** *"Oavsett hur en webbplattform ska byggas så kan 90-95% av beståndsdelarna vara exakt samma grund och de sista procenten är de som gör att inget projekt är det andra likt."*

**Andra agentens tolkning:** *"Det här är den ekonomiska multiplikatorn. Varje nytt projekt handlar inte om att bygga från scratch utan om att konfigurera och anpassa."*

---

## 6. Hur lagren samverkar

### Informationsflödet

```
Layer 1 (Domain KB) ──informerar──▶ Layer 2 (Method KB)
    "Vad vi vet"                     "Hur man arbetar"
        │                                  │
        │                          ┌───────┘
        │                          ▼
        │                   Layer 3 (Component KB)
        │                     "Bygga med"
        │                          │
        ▼                          ▼
    ◀──────── Resultat flödar tillbaka ────────▶
```

- **Domain → Methods:** Kunskap styr metod. SEO-kunskap informerar hur SEO-audits ska utföras.
- **Methods → Components:** Metoden avgör vilka komponenter som väljs och hur de konfigureras.
- **Components → Domain:** Varje bygge med en komponent genererar nya insikter, mönster, pitfalls → tillbaka in i domänkunskapen.
- **Alla lager → Alla lager:** Varje projekt, experiment och forskning gör alla tre lagren bättre.

### Flywheel-effekten

```
Experiment i Domain KB
        │
        ▼
Nya eller förbättrade Methods
        │
        ▼
Bättre Components
        │
        ▼
Validerar/utökar Domain KB
        │
        └──▶ (cykeln upprepas)
```

**Detta är det som gör att systemet blir mer värdefullt ju mer det används.** Varje nattskift, varje projekt, varje experiment adderar. Inget arbete är bortkastat.

### Praktiska scenarier

**Scenario A: Nattskift utan given uppgift**
```
Agent vaknar
  → Läser: methods/autonomous-work/night-shift.md
  → Läser: _system/evolution-queue.md
  → Läser: _system/coverage-map.md
  → Identifierar: "domain/seo/local-seo.md saknas, det är ett uttalat utvecklingsområde"
  → Följer: methods/research-protocols/literature-review.md
  → Producerar: Ny artikel i rätt format
  → Uppdaterar: Index, coverage-map, compilation-log
  → Rapporterar: I morning report
```

**Scenario B: Nytt kundprojekt (webbplattform)**
```
Kund vill ha e-handelsplattform
  → Layer 3: 92% klar — CMS (nextjs-headless), moduler (auth, checkout, SEO foundation, analytics, CI/CD)
  → Layer 2: Följ methods/project-lifecycle/* steg för steg
  → Layer 1: Hämta SEO-expertis för branschen, konverteringsoptimering
  → Verifiering: Kör methods/quality-gates/200k-standard.md
  → Klientspecifikt (8%): Branding, produktkatalog, copytext, designpreferenser
```

**Scenario C: Agent vill förbättra systemet**
```
Under linting-pass
  → Layer 1: "Upptäckt: vår Next.js-mall saknar structured data för FAQ"
  → Layer 2: Följ methods/research-protocols/experiment-design.md
  → Implementera: Uppdatera components/modules/seo-foundation/
  → Verifiera: Kör kvalitetsgrind
  → Uppdatera: domain/seo/structured-data.md med nya insikter
  → Resultat: Alla framtida projekt får FAQ-structured data automatiskt
```

**Scenario D: Inget givet uppdrag — agenten hittar utvecklingsområden**
```
Agent kontrollerar vad som finns
  → _system/coverage-map.md visar: "design/ har bara 2 artiklar, låg coverage"
  → MEN: domain/seo/ har 5 bekräftade artiklar + en fungerande component
  → Beslut: "SEO-komponenten fungerar men har aldrig testats mot Core Web Vitals i produktion"
  → Agenten bygger en testsite, kör Lighthouse, dokumenterar resultat
  → Nytt: Bekräftad prestandadata → uppdaterar domain/seo/core-web-vitals.md
  → Flywheel: Bekräftad kunskap som stärker både Domain och Component
```

---

## 7. Artikelformat och struktur

### Formatöversikt

Varje artikel i KB:n använder ett av dessa format, deklarerat i frontmatter. Format upprätthålls av templates i `_templates/` och av kb-compiler-skillen.

| Format | Inspiration | Används för | Layer |
|--------|------------|-------------|-------|
| `cheat-sheet` | CNN Cheat Sheet, Data Cleaning, Data Analysis Functions | Tätpackade referenskort, scannable | Domain |
| `reference-article` | Djupgående wiki-artikel | Ämnen som kräver förklaring och kontext | Domain |
| `comparison-table` | Data Analysis Functions (Python/Excel/SQL/Power BI) | Samma operation, olika verktyg/approach | Domain |
| `method-guide` | Steg-för-steg procedurer | Processer från start till slut | Methods |
| `quality-gate` | Checklistor | Vad "bra nog" innebär, mätbart | Methods |
| `component-spec` | Modulspec | Vad en komponent gör, API, varianter | Components |
| `report` | DAIR Papers Observatory | Analytiska rapporter, audits, findings | Methods (output) |
| `index` | Career Pipeline TUI | Auto-underhållna navigeringsöversikter | Alla lager |

### Formatdetaljer

Se `ARCHITECTURE.md` sektion 4 för fullständiga exempel av varje format med all frontmatter, sektionsstruktur, och konventioner.

### Visuella inspirationer

Robin tillhandahöll specifika referensbilder:

1. **Cheat sheets** (CNN, Data Cleaning, Data Analysis): Täta, scannable, tabell-drivna. Visar att komplex kunskap kan kondenseras till ett referenskort med `Koncept | Vad | Hur | Fallgropar`-kolumner.

2. **Cross-tool comparisons** (Data Analysis Functions): Python vs Excel vs SQL vs Power BI sida vid sida. Visar att samma operation ska kunna slås upp per verktyg/stack.

3. **Interaktiva rapporter** (DAIR Observatory): Multipla vyer (Overview, Insights, Connections, Papers) med statistik, diagram, tabeller. Rapporter ska vara rika, inte bara text.

4. **Index/dashboards** (Career Pipeline TUI): Poängsatt, filterbart, kategoriserat, statusspårat. Index ska vara mer än en fillista.

5. **Projektstruktur** (Claude Code Project Structure): Hierarkisk, annoterad, dense. Visar hur hela system kan kartläggas på ett kort.

6. **Lagerbaserade system** (Jian Wang 4-Level): Progressivt — varje lager bygger på föregående. Memory → Gates → Workflows → Orchestration.

### Nyckelprincip

**Formatet ska matcha kunskapens natur.** En SEO-checklista ska vara en cheat-sheet, inte en essä. En arkitekturbeskrivning ska vara en reference-article, inte en tabell. En kvalitetsgrind ska vara en checklista, inte en berättelse.

---

## 8. Agent-integration

### Hur agenter använder KB:n

KB:n är inte dokumentation som agenten "kan läsa om den vill." Den är operationell infrastruktur som **injiceras** i agentens kontext baserat på uppgiftstyp.

```
Agent tar emot uppgift
      │
      ▼
  Klassificera uppgiftstyp
      │
      ├── Bygg projekt ──▶ Läs: methods/project-lifecycle/*
      │                      Läs: components/_compatibility.md
      │                      Välj: CMS-modell + moduler
      │                      Verifiera: methods/quality-gates/200k-standard.md
      │
      ├── Research ──▶ Läs: methods/research-protocols/*
      │                Läs: domain/[relevant-kategori]/*
      │                Output → raw/ för kompilering
      │
      ├── Audit ──▶ Läs: methods/quality-gates/*
      │             Läs: domain/[relevant-kategori]/*
      │             Output: report-format
      │
      └── Nattskift ──▶ Läs: methods/autonomous-work/night-shift.md
                         Läs: _system/evolution-queue.md
                         Läs: _system/coverage-map.md
                         Välj → arbeta → producera → kompilera
```

### Context injection — inte RAG

Detta är **inte** full-text RAG. Det är strukturerad retrieval:

1. **Alltid laddat:** `_system/coverage-map.md` (så agenten vet KB:ns tillstånd)
2. **Per uppgiftstyp:** Relevant method guide
3. **Per domän:** Relevanta domain-artiklar (cheat sheets först, reference-articles vid behov)
4. **Per build:** Kompatibla komponenter + kvalitetsgrind

Karpathy bekräftade att vid ~100 artiklar / ~400K ord behövs inte RAG — auto-underhållna indexfiler räcker.

### Nattskift-integration

KB:n är det som gör autonoma nattskift meningsfulla:

- `methods/autonomous-work/night-shift.md` definierar protokollet
- `_system/evolution-queue.md` ger arbetsbacklogen
- `_system/coverage-map.md` visar var kunskapen är tunn
- Wave-protokollet (plan → execute → verify → fix → commit → assess) styr varje session
- Morning report sammanfattar vad som gjordes, vad som lyckades, vad som misslyckades

Utan KB:n vet agenten inte vad den ska arbeta med. Med KB:n har den en prioriterad backlog, metodguider för hur arbetet ska utföras, och kvalitetsgrindar för att verifiera resultatet.

---

## 9. Teknisk infrastruktur

### Stack

| Komponent | Teknologi | Roll |
|-----------|----------|------|
| KB-lagring | Markdown-filer i katalogstruktur | Source of truth |
| Frontend | Obsidian | Visuell navigering, graph view, Marp slides |
| Persistence | OpenClaw / Supabase + pgvector | Cross-device sync, semantisk sökning |
| Agent-runtime | Claude Code / OpenClaw agents | Kompilering, linting, Q&A |
| Ingest | deep-fetch, heavy-file-ingestion, Obsidian Web Clipper | Råmaterial → raw/ |
| Struktur | OB1 Skills (kb-compiler, kb-linter, kb-gate) | Upprätthåller format och kvalitet |
| Agent-plattform | MacBook Air M2 (OpenClaw) | Nattskift, autonom exekvering |
| Daglig maskin | Windows PC | Robins arbetsstation |
| Nätverk | Tailscale mesh VPN | Mac ↔ Windows kommunikation |

### Obsidian-integration

- KB-rooten (`knowledge-base/`) är en Obsidian-vault
- Wiki-links (`[[artikel]]`) fungerar native i Obsidians graph view
- `_index.md`-filer är Obsidian-native navigation
- Marp-plugin för slide-rendering
- Dataview-plugin för dynamiska queries över artiklar
- Canvas-plugin för visuella KB-kartor
- Web Clipper för ingest av webbartiklar

### OpenClaw-integration

- Artikelmetadata synkas till `thoughts`-tabellen i Supabase
- pgvector-embeddings för semantisk sökning över artiklar
- `skill_registry`-entries för kb-compiler, kb-linter, kb-gate
- OpenClaw-agenter kan köra KB-skills som nattskiftsuppgifter
- Morning reports levereras via OpenClaw channels (Telegram, etc.)

### Filbaserad, inte databasbaserad

KB:n är **markdown-filer i en katalogstruktur** — inte en databas. Detta är ett medvetet val:

- LLM-native: agenter läser och skriver markdown direkt
- Git-versionerat: full historik, diffar, rollback
- Obsidian-kompatibelt: direkt visuellt gränssnitt
- Portabelt: ingen vendor lock-in
- Synkbart: Supabase/OpenClaw synkar metadata, inte hela filer

---

## 10. Affärsvisionen

### Kortsiktigt (6 månader)

- KB:n bygger upp domänkunskap inom SEO, webbutveckling, marknadsföring
- Första CMS-modeller och moduler testade och bekräftade
- Bacowr (bacowr.com) lanseras som SaaS — driven av KB:ns SEO-expertis
- Agenter kan leverera webbplattformar på 200k-nivån med minimal mänsklig inblandning

### Medellångt (1-2 år)

- KB:n är mogen nog att driva en hel IT-avdelning
- Kundprojekt levereras med 90-95% reuse, konsekvent kvalitet
- Nattskift producerar meningsfullt arbete varje natt
- KB:n är självförbättrande — linting och evolution körs automatiskt
- Flera CMS-modeller, fullständiga modulbibliotek, testad kompatibilitetsmatris

### Långsiktigt (2+ år)

- Systemet i sig självt har kommersiellt värde — "den kraft det ger hela systemet"
- Potentiell produktifiering av KB-systemet som verktyg/plattform
- Syntetisk datagenerering + finetuning (Karpathys framtidsvision)
- KB:n som competitive moat — ackumulerad, verifierad expertis som konkurrenter inte kan kopiera overnight

### Ekonomisk modell

```
Utan KB:  Varje projekt = 100% arbete × agentens improvisation
Med KB:   Varje projekt = 5-10% anpassning × bekräftad kvalitet

Resultat: Snabbare leverans, lägre kostnad, högre konsistens, nöjdare kunder
Bonus:    Varje projekt gör KB:n bättre → nästa projekt är ännu billigare
```

---

## 11. Skills som upprätthåller struktur

Tre skills ansvarar för KB:ns integritet och tillväxt:

### `kb-compiler`

**Vad:** Kompilerar råmaterial till strukturerade KB-artiklar.
**Trigger:** Ny fil i `raw/`, eller "kompilera detta till KB:n."
**Process:**
1. Triage — bestäm lager och kategori
2. Extrahera — dra ut kunskap (fakta, mönster, metoder, kod)
3. Formatera — applicera rätt template från `_templates/`
4. Korsreferera — hitta och lägg till links till relaterade artiklar
5. Indexera — uppdatera alla berörda `_index.md`-filer
6. Logga — registrera i `_system/compilation-log.md`

### `kb-linter`

**Vad:** Hälsokontroller och kvalitetssäkring av KB:n.
**Trigger:** Schemalagd (nattlig), eller "linta KB:n" / "hälsokontroll."
**Kontroller:**
- Korsreferensintegritet (inga brutna länkar)
- Inkonsistent data mellan artiklar
- Föråldrade artiklar (last_verified > 30 dagar)
- Täckningsgap (kategorier med < 3 artiklar)
- Nya kopplingar mellan artiklar
- Saknad data som kan imputeras via webbsökning
**Output:** Uppdaterad `_system/health-report.md`

### `kb-gate`

**Vad:** Injicerar KB-kontext i agent-workflows och verifierar output mot kvalitetsgrindar.
**Trigger:** Agent startar ett projekt eller når en kvalitetskontrollpunkt.
**Process:**
1. Klassificera uppgiften
2. Hämta relevant domänkunskap, metoder och komponenter
3. Injicera som kontext
4. Vid slutförande: verifiera mot tillämplig kvalitetsgrind
**Output:** Pass/fail med specifika kriteriereresultat

---

## 12. Evolutionsmodell

### Mognadsnivåer

| Nivå | Namn | Kriterier | Status |
|------|------|-----------|--------|
| 0 | Skeleton | Katalogstruktur, templates, < 10 artiklar | **HÄR ÄR VI NU** |
| 1 | Foundation | Kärn-domänartiklar bekräftade, primära metoder skrivna, 1 CMS-modell | Nästa mål |
| 2 | Operational | Kvalitetsgrindar upprätthålls, agenter använder KB för leverans | |
| 3 | Self-improving | kb-linter kör nattlig, evolution-queue driver utveckling | |
| 4 | Production factory | 90-95% reuse uppnått, konsekvent "200k standard" output | |

### Fyra utvecklingsmekanismer

1. **Kompilering** — Lägga till ny kunskap (raw → artikel)
2. **Linting** — Underhålla kvalitet (hitta rot, gap, motsägelser)
3. **Verifiering** — Bekräfta sanning (draft → review → confirmed → periodisk re-verifiering)
4. **Expansion** — Växa coverage (coverage-map → evolution-queue → nattskift/research → nya artiklar)

### Statusflöde för artiklar

```
draft ──▶ review ──▶ confirmed ──▶ (periodisk re-verifiering)
                                         │
                                         ▼
                                    outdated ──▶ uppdateras ──▶ confirmed
                                         │
                                         ▼
                                    deprecated (arkiveras)
```

---

## 13. Bekräftade principer

Dessa principer är hämtade från Robins feedback över flera sessioner och är icke-förhandlingsbara.

### Produktionsfärdigt som standard
MVP är en fallback, inte målet. Allt bygger mot produktion: proper error handling, monitoring, secrets management, tester, dokumentation. Bara explicita blockerare (saknade credentials, saknade dependencies, tidspress uttalad av Robin) motiverar scopecut.

### Bygg PÅ OpenClaw, inte parallellt
OpenClaw har redan agenter, skills, extensions, gateway, channels, GUI. Våra moduler (identity, dispatch, wave-runner, quality gates) blir OpenClaw-plugins, inte separata system.

### Nattskift = 8h iterativa sessioner
Inte "starta 4 agenter, committa, klart." Varje wave's resultat informerar nästa wave. Kvalitet > kvantitet. Pusha efter varje 2-3 waves. Morning report speglar djup, inte bara bredd.

### Wave-protokoll för långsessioner
Plan → execute → verify → fix → commit → assess. Iterativt intelligent, inte batch-dispatch. ASSESS-heuristik: fixa det som är trasigt > fördjupa > bredda. Sluta vid diminishing returns.

### Parallell agentexekvering
Robin föredrar parallella agenter framför sekventiella. "Slöseri med resurser" att köra en i taget.

---

## 14. Forskningsplan

### Firecrawl-research (planerad)

Innan implementering: systematisk research via Firecrawl för att förstå vad som redan finns och lära av andras erfarenheter.

#### Forskningsfrågor

1. **Existerande knowledge-base-as-code-system**
   - Hur har andra byggt liknande? (Cursor rules, Windsurf memories, Replit agents, Devin's knowledge)
   - Vilka mönster fungerar? Vilka misslyckas?

2. **Quality encoding patterns**
   - Hur formaliserar man "200k-nivån" som maskinläsbara constraints, inte bara prosa?
   - Finns det existerande ramverk för quality-as-code?

3. **Retrieval-arkitekturer**
   - RAG vs graph-based vs hybrid för agentic context injection
   - Karpathys observation: RAG behövs inte vid <100 artiklar med bra index
   - Vid vilken skala behövs RAG?

4. **Obsidian-to-agent-pipelines**
   - Existerande integrationer (synapsync/obsidian, richfrem/obsidian-graph-traversal)
   - Obsidian API möjligheter
   - Plugin-ekosystem för automation

5. **Domänspecifik knowledge engineering**
   - Hur struktureras SEO-expertis för LLM-konsumtion?
   - Hur struktureras webbutvecklingsstandards?
   - Finns det best practices från knowledge management-fältet?

6. **Kompileringspipelines**
   - Hur andra LLM-drivna wiki-system hanterar ingest → compile → verify
   - Automatiserad vs manuell triage
   - Index-underhåll vid skala

#### Potentiella Firecrawl-targets

- Karpathys GitHub repos (om publikt delade)
- Obsidian community plugins relaterade till LLM/AI
- Cursor rules repositories
- Context engineering artiklar och papers
- Knowledge management frameworks (PKM, Zettelkasten, etc.)
- SEO knowledge bases och cheat sheets (för domäninnehåll)

### Skills-ekosystem-scouting (gjord)

Skills-sökning via `npx skills find` identifierade:
- `synapsync/synapse_registry@obsidian` (69 installs) — Obsidian-integration
- `richfrem/agent-plugins-skills@obsidian-graph-traversal` (26 installs) — Graph traversal
- `borghei/claude-skills@context-engine` (28 installs) — Context engine
- `alphaonedev/openclaw-graph@obsidian` (10 installs) — OpenClaw + Obsidian

Ingen matchade den fulla visionen, men de kan vara referenspunkter.

---

## 15. Vad som redan byggts

### Knowledge Base skelett (2026-04-09)

| Artefakt | Status | Plats |
|----------|--------|-------|
| ARCHITECTURE.md | Klar | `knowledge-base/ARCHITECTURE.md` |
| VISION.md | Klar | `knowledge-base/VISION.md` (detta dokument) |
| INDEX.md | Klar (tom) | `knowledge-base/INDEX.md` |
| Katalogstruktur | Komplett | Alla mappar skapade under domain/, methods/, components/ |
| Templates (7st) | Klara | `knowledge-base/_templates/` |
| System-filer | Klara | `knowledge-base/_system/` |
| Layer-index | Klara (tomma) | `*/_index.md` |
| Kompatibilitetsmatris | Klar (tom) | `knowledge-base/components/_compatibility.md` |

### OB1 Skills (relaterade)

| Skill | Status | Plats |
|-------|--------|-------|
| deep-fetch | Klar, testad | `skills/deep-fetch/` |
| heavy-file-ingestion | Klar | `skills/heavy-file-ingestion/` |
| auto-capture | Klar | `skills/auto-capture/` |
| kb-compiler | **Ej byggd** | — |
| kb-linter | **Ej byggd** | — |
| kb-gate | **Ej byggd** | — |

### Minnen (agent-kontext)

| Minne | Fil |
|-------|-----|
| KB-vision | `memory/project_knowledge_base_vision.md` |
| Karpathy-referens | `memory/reference_karpathy_kb.md` |
| Robin profil | `memory/user_robin.md` |
| Bacowr | `memory/project_bacowr.md` |
| Produktionsfirst | `memory/feedback_production_not_mvp.md` |
| Nattskift | `memory/feedback_night_shifts.md` |
| Wave-protokoll | `memory/feedback_long_sessions.md` |
| OpenClaw-first | `memory/project_openclaw_integration.md` |
| Mac-plattform | `memory/project_mac_agent_platform.md` |
| Morning report | `memory/project_morning_report.md` |

---

## 16. Ordnad roadmap

### Fas 0: Skeleton (KLAR)
- [x] Arkitekturdokument
- [x] Visionsdokument
- [x] Katalogstruktur
- [x] 7 artikelformat-templates
- [x] System-filer (coverage-map, evolution-queue, health-report)
- [x] deep-fetch skill

### Fas 1: Research
- [ ] Firecrawl-research på KB-arkitekturer, Obsidian-workflows, quality encoding
- [ ] Analysera forskningsresultat och uppdatera arkitektur vid behov
- [ ] Installera och evaluera relevanta community-skills (Obsidian, context-engine)

### Fas 2: Foundation (Level 0 → Level 1)
- [ ] Första domänartiklar: technical-seo, core-web-vitals, nextjs-architecture
- [ ] Första kvalitetsgrind: 200k-standard
- [ ] Första method guides: project-lifecycle/01-intake, 02-architecture
- [ ] Första CMS-modell: nextjs-headless (SPEC + SETUP)
- [ ] Bygga kb-compiler skill
- [ ] Konfigurera som Obsidian vault

### Fas 3: Operational (Level 1 → Level 2)
- [ ] Fullständig SEO-kategori (6+ artiklar)
- [ ] Full projektlivscykel (7 method guides)
- [ ] Nattskiftsprotokoll (methods/autonomous-work/)
- [ ] Bygga kb-linter skill
- [ ] Bygga kb-gate skill
- [ ] Core moduler (auth, analytics, seo-foundation, ci-cd)
- [ ] OpenClaw sync-integration

### Fas 4: Self-improving (Level 2 → Level 3)
- [ ] Schemalagd nattlig kb-linter
- [ ] Auto-kompilering från raw/
- [ ] Korsreferensintegritetskontroller
- [ ] Coverage-driven area selection för nattskift
- [ ] Bacowr-integration (SEO-kunskap driver Bacowr pipeline)

### Fas 5: Production factory (Level 3 → Level 4)
- [ ] 90-95% reuse bekräftat och mätt
- [ ] Flera CMS-modeller med full kompatibilitetsmatris
- [ ] Fullständigt modulbibliotek
- [ ] Konsekvent "200k standard" verifierat över flera projekt
- [ ] Systemet självt har kommersiellt värde

---

## Appendix: Bekräftelser

### Agent-validering

Denna vision har presenterats för och tolkats av två oberoende AI-agenter. Båda producerade identiska tolkningar av tre-lager-modellen, flywheel-effekten, och agent-autonomi-konceptet. Nyckelcitat från den andra agentens analys:

> *"Lager 1 informerar Lager 2 (kunskap styr metod), Lager 2 styr hur Lager 3 sätts ihop (metoden avgör vilka komponenter som väljs och hur de konfigureras), och resultaten från varje levererat projekt flödar tillbaka in i alla tre lager. Varje projekt gör systemet bättre."*

### Extern validering

Andrej Karpathy (ex-Tesla AI, OpenAI-grundare, Stanford-professor) beskriver ett liknande men enklare system och konstaterar att det finns utrymme för "an incredible new product" — Robins vision täcker samma område men adderar operationell styrning, domänspecifik expertis, och agent-autonomi.
