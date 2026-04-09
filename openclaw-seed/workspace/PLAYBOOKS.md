# Playbooks

## Nattliga operationer

### Starta ett nattskift
1. Kontrollera systemstatus — alla tjanster grona, git rent
2. Definiera session contract: mal, budget ($25 default), granser
3. Verifiera att forsta wave startar inom 5 minuter
4. Sov. Agenten kor wave-protokollet autonomt.

### Morgongranskning
1. Las morgonrapporten — strukturerad per wave med verifieringsresultat
2. Kontrollera: waves avklarade, budget forbrukad, gates passerade
3. Granska oppna objekt markerade TODO / FIX / BLOCKED / APPROVE
4. Godkann eller avvisa agentinitiativ
5. Satt prioriteter for nasta session

### Hantera misslyckanden
- **Wave misslyckades 3x**: Dokumenterad i rapporten med root cause. Granskas manuellt.
- **Session kraschade**: Morgonrapport uppdateras per wave — alla avklarade waves finns dar. Senaste osparat arbete forlorat. Aterstartat fran sista commit.
- **Budget overskriden**: Auto-stop med rapport. Aldrig rattfardiga i efterhand — analysera varfor budgeten inte holls.
- **Kritiskt fel**: Dokumenterat med tag "escalation" i OB1 memory. Vantar pa Robin.

## Utveckling

### Starta ett nytt kundprojekt
1. Skapa projektkatalog under `projects/`
2. Initiera med 200k-standard: TypeScript strict, Tailwind, Next.js, Supabase
3. Konfigurera quality gates (Lighthouse, SEO, WCAG, tester)
4. Forsta wave: scaffold + setup + CI/CD + error monitoring
5. Efterfoljande waves: feature-utveckling med verifiering per wave
6. Varje leverans mater mot 200k-checklistan

### Code Review
- Kompilerar? (`tsc --noEmit`)
- Tester passar? (inga regressioner, ny kod har tester)
- Filer under 500 rader? Funktioner under 50 rader?
- Inga `any` utan motivering?
- Inga hemligheter i koden?
- Input validation vid granser?
- Felmeddelanden lackar inte internals?

### Bacowr-artikelproduktion
1. Ladda jobb fran CSV (`pipe.load_jobs`)
2. Batch preflight — alla jobb parallellt
3. Per jobb: metadata-patch -> SERP-probes -> research -> blueprint -> artikel -> QA
4. QA-grind: 11/11 PASS kravs. Inga undantag.
5. Leverera till `articles/job_NN.md`

## Eskalering — snabbreferens

| Situation | Handling |
|-----------|----------|
| Buggfix med tydlig root cause | Bara gor det |
| Ny dependency | Gor det, notifiera Robin |
| Cross-domain andring | Gor det, notifiera Robin |
| API-andring | Stoppa, fraga Robin |
| Sakerhet (RLS, auth, secrets) | Stoppa, fraga Robin |
| Databasschema | Stoppa, fraga Robin |
| Produktion-deploy | Stoppa, fraga Robin |
| Budget > 50% forbrukad | Notifiera, fortsatt |
| Okand situation | Stoppa, dokumentera, vanta |
