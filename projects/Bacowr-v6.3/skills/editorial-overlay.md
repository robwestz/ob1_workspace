# Editorial Overlay — Premium Writing Skill

> **Version**: 1.0
> **Aktivering**: Efter Fas 6 (blueprint klar), innan Fas 7 (skrivning)
> **Concurrency**: Stateless, read-only. Oändligt antal agenter samtidigt.
> **Konfliktrisk**: Noll. Modifierar ingenting i pipeline, engine, eller delat tillstånd.
> **Beroenden**: Ingen kod, inga imports, inga filer skrivs. Ren instruktion.

---

## Vad detta är

SYSTEM.md definierar de hårda kraven (ordantal, anchor, trustlinks, struktur).
Blueprint definierar VAD som ska skrivas (topic, thesis, sections, entities).
Denna skill definierar HUR — den redaktionella processen som gör att varje text
är värd att läsa på riktigt, inte bara tekniskt korrekt.

Alla hårda krav i SYSTEM.md och blueprint gäller fortfarande utan undantag.
Denna overlay adderar — den ersätter ingenting, den överskriver ingenting.

---

## Varför detta existerar

Skillnaden mellan en artikel som passerar QA 11/11 och en artikel som är värd
premiumpriset är samma skillnad som mellan en korrekt noterad jazzsolo och en
solo som får publiken att hålla andan. Noterna är rätt i båda fallen. Men den
ena har intentionalitet — varje fras leder någonstans, varje val är medvetet,
och slutresultatet berättar något som lyssnaren inte visste att den ville höra.

Det är den standarden. Varje artikel.

---

## Aktivering

### Triggervillkor

Läs denna skill EFTER att du har:
- En färdig blueprint med `bp.to_agent_prompt()`
- Komplett SERP-data (`plan.core_entities`, `plan.cluster_entities`, `plan.lsi_terms`)
- Bekräftad intent (`plan.confirmed_intent`)
- Valda trustlinks (1–2 verifierade URL:er)
- Preflight-data (publisher-profil, target-fingerprint, semantic bridge)

### Vad du har framför dig

Vid aktivering har du samlat:

| Data | Källa | Vad det berättar |
|------|-------|------------------|
| `plan.probes[0..4]` | 5 SERP-sökningar | Hur Google förstår ämnet — vilka entiteter, vilka vinklar, vilka frågor |
| `plan.core_entities` | Probe-syntes | De begrepp som MÅSTE finnas för topical authority |
| `plan.cluster_entities` | Probe-syntes | De begrepp som stärker klustret runt core |
| `plan.lsi_terms` | Probe-syntes | Semantiskt relaterade termer som signalerar djup |
| `plan.confirmed_intent` | Probe-syntes | Typ av sökintention — men också ämnes-semantisk riktning |
| `preflight.bridge` | Pipeline | Avståndet och kopplingen mellan publisher och target |
| `bp.thesis` | Engine | Tesfrö att förfina |
| `bp.sections` | Engine | Strukturplan med roller och ordmål |
| Trustlinks | Fas 5 | Verifierade externa källor som binder narrativet |

Denna data är din research-desk. En journalist hade tillbringat dagar på att
samla in det du redan har. Nu börjar det redaktionella arbetet.

---

## Fas A: Research Mining (innan du skriver ett ord)

### A1. Hitta spänningen

Granska dina 5 probes och deras resultat. Sök efter:

**Motsägelsen** — Finns det något i SERP-datan som säger emot den uppenbara
berättelsen? Exempel: "alla top-3 för 'lokalvård' pratar om pris — men probe 4
visar att de företag som rankar bäst på 'lokalvård Stockholm' framhäver certifiering
och hälsa, inte pris."

**Trenden** — Pekar flera probes åt samma håll på ett sätt som avslöjar en
förskjutning? Exempel: "tre av fem probes returnerar resultat som nämner
hållbarhet — ett begrepp som inte fanns i top-10 för detta sökord 2024."

**Det oväntade sambandet** — Finns det en koppling mellan publisherns domän
och targetets verklighet som inte är uppenbar? Det är ofta här den bästa
artikeln gömmer sig.

**Specialistinsikten** — Vad i datan skulle en person som jobbar inom detta
fält reagera på? Inte "det visste jag" utan "det har jag inte tänkt på så".

> **Skriv ner din spänning i en mening.** Det här blir din narrativa motor.
> Om du inte hittar en spänning — gräv djupare i probe-resultaten. Den finns där.

### A2. Förfina tesen

Blueprint ger `thesis_seed`. Den är funktionell men inte redaktionell.

**Process:**
1. Ta thesis_seed
2. Filtrera den genom spänningen du hittade i A1
3. Formulera en tes som TAR STÄLLNING — något en läsare kan tycka är intressant,
   oväntat, eller värt att tänka på

**Test på tesen:**
- Kan någon som kan ämnet reagera med "hmm, stämmer det?" → Bra
- Kan den bara mötas med "ja, self klart" → Omformulera
- Går den att stödja med dina SERP-bekräftade entiteter? → Nödvändigt

**Exempel:**

Svag tes: *"Mattor bidrar till en hemtrevlig inredning."*
→ Ingen reagerar, ingen lär sig något, ingen bryr sig.

Stark tes: *"Det skandinaviska mattformatet har gått från dekorativt tillägg
till rumsdefiniering — och det syns i att sökvolymerna för 'matta som
rumsavdelare' tredubblades mellan 2024 och 2025."*
→ Specifik, datapunkt, tar ställning, gör läsaren nyfiken.

### A3. Kartlägg argumentet

Innan du skriver, planera artikeln som ett ARGUMENT, inte en översikt:

| Blueprint-sektion | Narrativ roll | Frågan den besvarar |
|-------------------|---------------|---------------------|
| Hook | Observationen | "Vad är det intressanta fenomenet?" |
| Establish | Kontexten | "Varför händer detta nu?" |
| Deepen | Komplikationen | "Vad gör detta mer intressant än det först verkar?" |
| Anchor | Konkretiseringen | "Hur ser detta ut i praktiken?" |
| Pivot | Konsekvensen | "Vad betyder det framåt?" |
| Resolve | Insikten | "Vad tar läsaren med sig som de inte hade innan?" |

Varje sektion driver argumentet framåt. Ingen sektion existerar för sin egen
skull. Om en sektion inte tjänar argumentet — tänk om vad den ska göra.

---

## Fas B: Skrivprocessen

### B1. Hook — Led med det intressanta

Första meningen avgör om texten läses. Börja ALDRIG med:
- Bakgrund ("Sedan urminnes tider...")
- Definition ("X definieras som...")
- Bred observation ("I Sverige är X vanligt...")

Börja ALLTID med:
- Den specifika observationen som väckte din tes
- En datapunkt som utmanar förväntan
- Ett fenomen som läsaren känner igen men inte har tänkt på

> **Tumregel**: Om hook-stycket fungerar som inledning till vilken artikel som
> helst inom ämnet — är det för generiskt. Det ska bara fungera för DENNA artikel.

### B2. Entities som precision, inte dekoration

Du har `core_entities`, `cluster_entities`, och `lsi_terms`. Amatörens
instinkt är att nämna dem. Proffsens teknik:

**Deploiera, introducera inte.** Skriv aldrig "Ett begrepp som blivit aktuellt
är X" — skriv en mening där X är det naturliga ordvalet. Läsaren som kan ämnet
nickar igenkännande. Läsaren som inte kan ämnet lär sig av sammanhanget.

**Använd entiteter för att vara specifik.** När du behöver vara konkret, sträck
dig efter en SERP-bekräftad entitet istället för en generisk term. "Sensorstyrda
schemaläggningssystem" istället för "modern teknik".

**Fördela över argumentet.** Hook behöver andra entiteter än Deepen. Varje del
av argumentet rör vid olika aspekter av ämnet — och olika entiteter hör hemma
i olika delar.

**LSI-termer som akustik.** LSI-termerna behöver inte vara framträdande — de
ska finnas i texten som akustiken i ett rum. Läsaren märker dem inte medvetet,
men Google och en ämnesexpert hör att texten "låter rätt".

### B3. Trustlinks som bevisföring

Trustlinks är inte fotnoter. De är bevis i ditt argument.

**Process:**
1. Identifiera vilken del av argumentet som behöver extern styrka
2. Introduera trustlinkens innehåll som ett faktum eller en observation
3. Länka så att läsaren tänker "det där vill jag läsa mer om"
4. Trustlinken ska stärka tesen ELLER komplicera den intressant

**Aldrig:** "Enligt [källa] är X viktigt." → Tomt, passivt, dekorativt.
**Alltid:** "En kartläggning av [Boverkets belysningsguide](url) visar att
60 procent av alla renoveringsprojekt underdimensionerar belysningen — och att
korrigeringen i efterhand kostar tre gånger så mycket." → Bevis, specifikt, driver argumentet.

### B4. Ankarlänken som naturlig destination

Vid ord 250–550 har ditt argument byggt en kontext. Ankarlänken ska landa i
den kontexten som det NATURLIGA nästa steget. Inte för att du ledde dit — utan
för att argumentet gick dit av sin egen logik.

**Testa:** Läs stycket utan ankarlänken. Fungerar meningen? Bra.
Läs det med. Tillför länken en naturlig resurs? Bra.
Känns det som en omväg? Skriv om kontexten.

**Stycket med ankarlänken ska vara artikelns starkaste stycke.** Det är här
ditt argument konkretiseras. Det är inte en paus för en kommersiell infogning —
det är höjdpunkten av ditt resonemang.

### B5. Röd tråd som resonemang

Varje stycke slutar med en tanke som öppnar för nästa.
Varje stycke börjar med att plocka upp den tråden.

Men det räcker inte att mekaniskt kedja stycken. Den röda tråden är ARGUMENTET
— den tes du formulerade i A2. Varje stycke antingen:
- **Underbygger** tesen (visar att den stämmer)
- **Komplicerar** tesen (visar att det är mer nyanserat)
- **Fördjupar** tesen (visar en konsekvens eller implikation)

Om ett stycke inte gör något av dessa tre — klipp det.

### B6. Avslutning som insikt

Avsluta ALDRIG med en sammanfattning. Läsaren var med — de behöver inte påminnas.

Avsluta med:
- En implikation som läsaren inte tänkt på
- En framåtblick som följer naturligt ur argumentet
- En observation som knyter tillbaka till hook:en men med ny förståelse

Sista meningen i artikeln ska vara den som stannar kvar.

---

## Fas C: Kvalitetskontroll (före QA-script)

Innan du kör `validate_article()`, gör dessa checks:

### C1. Överdrivet-betald-skribent-testet

Läs texten som om du satte ditt namn på den. Låter den som competent filler —
korrekt, strukturerad, men utbytbar? Skriv om.

### C2. Specialist-testet

Skulle en person som jobbar inom detta fält:
- Lära sig något nytt? → Bra
- Se en koppling de inte gjort? → Bra
- Tänka "standardtext" efter första stycket? → Skriv om hook:en

### C3. Röd-tråd-testet

Kan du sammanfatta artikelns argument i en mening?
Om du inte kan — tråden är bruten. Hitta var och laga.

### C4. "Och sen då?"-testet

Läs varje stycke. Fråga "och sen då?". Om svaret inte naturligt leder till
nästa stycke — övergången saknar driv.

### C5. Unikhetstestet

Kunde denna artikel ha skrivits utan den specifika SERP-datan du samlade?
Om ja — du har inte använt researchen ordentligt. Gå tillbaka till Fas A.

---

## Anti-mönster

Dessa signalerar medelmåttig text. Fånga och eliminera dem:

| Anti-mönster | Varför det är dåligt | Fix |
|--------------|---------------------|-----|
| Öppnar med historik/bakgrund | Ingen läser vidare | Led med observationen |
| "X är viktigt eftersom..." | Berättar istället för visar | Visa med specifik data |
| Stycken som beskriver istället för argumenterar | Texten blir uppslagsbok | Varje stycke driver tesen |
| Trustlinks droppade utan integration | Känns som fotnoter | Gör dem till bevis i argumentet |
| Ankarlänken som avbrott i flödet | Avslöjar att texten har ett syfte | Bygg kontexten så länken är naturlig |
| Avslutning som upprepar vad som sagts | Respektlöst mot läsarens tid | Avsluta med ny insikt |
| Generiska observationer | Kunde stå i vilken artikel som helst | Gör specifikt med SERP-data |
| Alla paragrafer ungefär lika långa | Mekaniskt, omänskligt | Variera — korta och långa |
| Meningar som alla har samma struktur | Monotont | Blanda korta, långa, led med subjekt och objekt |
| Floskler och utfyllnad | Varje mening ska bära information | Klipp obarmhärtigt |

---

## Samspel med pipeline

```
Pipeline (Fas 1-6)
  │
  ├── Preflight, SERP-probes, blueprint — OFÖRÄNDRAT
  │
  ▼
┌─────────────────────────────┐
│  EDITORIAL OVERLAY (denna)  │  ← Aktiveras här
│  Läs → Process A → B → C   │     Ren instruktion, inget tillstånd
│  Input: blueprint + SERP    │     Output: bättre text, samma format
└─────────────────────────────┘
  │
  ▼
Skrivning (Fas 7) — Följer blueprint-struktur + overlay-process
  │
  ▼
QA (Fas 8) — validate_article() — OFÖRÄNDRAT
```

Overlayen sitter mellan data och skrivning. Den rör aldrig data uppåt
(pipeline/engine) eller validering nedåt (QA). Den förändrar bara HUR
agenten tolkar och använder den data den redan har.

---

## Concurrency-garanti

Denna skill är ren text — ingen fil skrivs, inget tillstånd delas, inga
lås tas. Tio agenter kan aktivera den samtidigt på tio olika jobb.
Unikhet garanteras av att varje jobb har unik SERP-data, unik bridge,
unik publisher-profil — och att skillen lär en PROCESS, inte en mall.

Samma process + olika data = unik text varje gång.

---

*Editorial Overlay v1.0 — BACOWR v6.3*
*Aktiveras: Fas 6→7. Modifierar: ingenting. Adderar: allt.*
