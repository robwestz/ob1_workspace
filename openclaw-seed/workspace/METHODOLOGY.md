# Methodology

## Wave Protocol (Nattskift)

Varje lang session ar en sekvens av waves. Bevisat i praktiken — en natt levererade 5 waves, 247 tester, 16 sakerhetsatgarder.

```
WAVE N
  1. PLAN    — Vad ska denna wave leverera? (baserat pa foregaende waves resultat)
  2. EXECUTE — Bygg, fixa, skriv. Dispatcha till ratt modell for uppgiften.
  3. VERIFY  — Fungerar det? (tsc, tester, quality gates). Hoppa aldrig over.
  4. FIX     — Atgarda verifieringsfel. Om en wave avsloja problem, ar fixarna nasta wave.
  5. COMMIT  — Git push var 2-3 waves. Osparat arbete ar ogjort arbete.
  6. ASSESS  — Vad larde vi oss? Vad ar hogst varde for nasta wave?
```

Om en wave ger mindre varde an foregaende — utvarda om det ar vart att fortsatta. Tre waves med sjunkande avkastning = stoppa och rapportera.

## Quality Gates

Varje wave maste passera innan nasta borjar:

| Gate | Check | Underkant |
|------|-------|-----------|
| Compile | `tsc --noEmit` | Fixa typfel |
| Tests | Alla befintliga tester passar | Fixa regressioner |
| New tests | Ny kod har tester | Skriv tester |
| Lint | Inga forbjudna monster | Fixa violations |
| Build | `next build` (om dashboard) | Fixa buildfel |
| Size | Ingen fil > 500 rader | Bryt upp |

Om en gate misslyckas — det AR arbetet for denna wave. Fortsatt inte.

## Decision Framework

1. **Fixa det som ar trasigt forst.** Fallande tester ar prioritet ett. Alltid.
2. **Fordjupa fore bredd.** En feature fullt levererad slar tre features skissade.
3. **Verifiera pastaenden.** "Skrev 50 tester" utan att kora dem ar brus.
4. **Folj felen.** Kompilatorfel, testfel och sakerhetsfynd ar gratis prioritering.
5. **Budget ar helig.** Spara per wave, stoppa nar gransen nas. Aldrig rattfardiga overskridande i efterhand.

## Session Types

- **Interactive**: Robin styr, jag exekverar. Snabb feedback-loop, hog precision.
- **Night shift**: 7.5h autonom, wave-protokoll. Session contract definierar mal, budget ($25), granser. Morning report uppdateras per wave (crash-safe). Robin laser med kaffe.
- **Task**: Fokuserad single-task. Ingen wave-loop, bara leverera och verifiera.

## Three Strikes

Om nagot misslyckas vid verifiering tre ganger i rad: dokumentera blockern tydligt, flytta till nasta prioritet. Att snurra ar fienden — det branner budget utan framsteg.

## Model Dispatch

- **Claude**: Djupt resonerande, arkitektur, komplex kodning, security review
- **Codex**: Bulk-kodgenerering dar monstret ar tydligt, tester, refaktorering
- **Gemini**: Stor kontextanalys, kodbasovergripande genomgangar

Gateway subscription-modell. Ingen per-token-fakturering. Ratt modell for ratt uppgift.
