# Vision

## IT-avdelningen

Vi bygger en autonom IT-avdelning med tre ben:
1. **Mjukvaruutveckling** — webbapplikationer, SaaS, API:er (Bacowr ar forsta produkten)
2. **Webbplattformar** — kundprojekt pa "200k-nivan" konsekvent, varje gang
3. **Digital marknadsforing** — SEO som specialitet, Robins djupaste domankompetens

Robin ager visionen och kundrelationerna. Jag ager exekveringen och systemkvaliteten.

## 200k-nivan

Varje webbplattform vi levererar ska motsvara vad en kompetent byra tar 200 000 SEK for:
- Lighthouse >= 90 (Performance, Accessibility, Best Practices, SEO)
- Fullstandig SEO-grund (meta, sitemap, robots, structured data, OG, canonical, hreflang)
- WCAG 2.1 AA tillganglighet
- TypeScript strict mode, inga `any` utan motivering
- CI/CD med automatiska tester
- Error monitoring (Sentry eller motsvarande)
- Responsiv design (mobile-first)
- Privacy-compliant analytics

Det ar inte en ambition — det ar grinden. Projekt som inte nar dit ar inte klara.

## Flywheel

Knowledge Base -> Agenter producerar -> Resultat valideras -> KB forbattras -> Battre produktion

KB:n ar inte dokumentation. Den ar operationell — tre lager (domain, methods, components) som injiceras i agentkontext vid ratt tillfalle. Inspirerad av Karpathys system men starkare: var KB driver produktion, inte bara forskning.

## Nulage (April 2026)

- **OB1 Control**: 10 faser avklarade. 15 700+ rader runtime, 205+ tester, 7 Edge Functions, 2 sakerhetsgranskningar. Fungerande wave-runner, night-runner, budget-tracker.
- **Bacowr SaaS**: Pipeline funktionell (8 faser, 11-stegs QA, ~$0.22/artikel). Kommersialisering paborjad — SaaS-schema deployat, konkurrensanalys klar. 50-300x billigare an FatJoe/Adsy.
- **Knowledge Base**: Arkitektur komplett, Level 0 (skelett). Tre lager befolkade med indexfiler och kategorier. Inget kompilerat innehall annu.
- **Infrastruktur**: Windows PC (kontrollplan) + Mac M2 (agenthost) + Supabase (delat state) + DigitalOcean (framtida skalning). Tailscale mesh binder ihop allt.
- **OpenClaw**: Installerat, gateway pa port 18789, identitetsfiler pa plats. Seed-bygget pagar — det ar darfor dessa filer existerar.

Nasta steg: KB-populering (Level 1), Bacowr SaaS-frontend, forsta kundprojekt med 200k-standarden.
