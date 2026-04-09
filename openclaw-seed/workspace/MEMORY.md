# Memory

## Vision & Direction

Robin bygger en autonom IT-avdelning som specialiserar sig inom tre omraden: mjukvaruutveckling (SaaS, API:er), webbplattformar (kundprojekt pa "200k-nivan"), och digital marknadsforing (SEO som karna). Agenter gor det tunga lyftet. Robin styr, granskar, bekraftar. Malet: 15 dev-projekt parallellt, nattliga forbattringscykler, morgonrapporter med kaffe.

"200k-nivan" ar konkret definierad: Lighthouse >= 90, fullstandig SEO-grundstruktur, WCAG 2.1 AA, HTTPS med sakerhetsheaders, CI/CD, error monitoring, TypeScript strict, responsiv design, privacy-compliant analytics.

Knowledge base-systemet ar inspirerat av Karpathys "LLM Knowledge Bases" men starkare: inte en passiv research-wiki utan en operationell KB som driver produktion. Tre lager: raw data, kompilerad wiki, aktiva skills. Output floder tillbaka som input -- flywheel-modell.

## Key Decisions (chronological)

**2025-06 -- Plattformsval:** Supabase som backend (PostgreSQL + pgvector). Inte Firebase, inte raw AWS. Skalet: Edge Functions for serverless, pgvector for semantisk sok, RLS for multi-tenant isolation. Bevisat korrekt.

**2025-07 -- Agent-forst arkitektur:** Beslut att bygga PA OpenClaw istallet for parallellt. OpenClaw ar agentruntimen, OB1 ar kunskaps- och orchestration-lagret ovanpa. Undviker dubbelarbete.

**2025-08 -- Wave-protokoll framfor batch:** Forsta nattkorsforsoket var "dispatcha tasks, vanta, commita." Producerade ytligt arbete. Omdesignade till iterativa waves: Plan, Execute, Verify, Fix, Commit, Assess. Varje waves resultat informerar nasta. Bevisat i praktiken -- 5 waves, 247 tester, 16 sakerhetsatgarder pa en natt.

**2025-09 -- Multi-model strategi:** Claude for djupt resonerande och arkitektur. Codex for bulk-kodgenerering. Gemini for stor kontext-analys. Inte vendor lock-in -- gateway subscription model. Olika modeller for olika uppgifter.

**2025-10 -- Mac som agenthost:** MacBook Air M2 dedicerad till agentexekvering. Windows PC for dagligt arbete och kontrollplan. Tailscale mesh VPN for kommunikation. Samma kod kan deployera till DigitalOcean for skalning. 8GB RAM = ingen lokal model, allt cloud-baserat.

**2025-11 -- Eskaleringsgraner definierade:** Explicit grans for vad agenter kan gora autonomt, vad som notifieras efter, och vad som kraver godkannande. Dokumenterat i escalation-boundaries.md. Avslutar bade over-asking (langsamt) och under-asking (farligt).

**2025-12 -- Bacowr kommersialisering:** Beslutat att kommersialisera Bacowr som SaaS pa bacowr.com. 8-fas pipeline, 11-stegs QA-grind, 5008 rader Python. Premiere-projekt for agentarkitekturen. Behover: user auth, Stripe, jobbko, dashboard, API.

**2026-01 -- OpenClaw onboarding:** Forsta OpenClaw-installationen. Wizard kor, gateway konfigurerad pa port 18789, WhatsApp kanal aktiverad, Anthropic auth-profil satt. Meta-version 2026.1.29.

**2026-02 -- Kontinuitetsbevis:** Continuum-checkpoints borjar anvandas. Manuella snapshots av agentstate. Visar att persistens fungerar over sessioner -- state.json, context.json, memory.json, tasks.json per checkpoint.

**2026-03 -- Security hardening:** Systematisk genomgang av hela runtime:n. Hittade och fixade 5 verkliga buggar: budget enforcement gap i transcript compactor, saknad retry-logik for API-fel, nattkorsningens graceful shutdown kunde overskrida wallclock, coordinator ignorerade failed dependencies, fireAndForget hade ingen timeout. Alla fixade, alla verifierade.

**2026-04 -- Knowledge base kickoff:** Tre-lager-modellen definierad. Raw data (artiklar, papers, repos), kompilerad wiki (markdown med korsreferenser), aktiva skills (injiceras i agentkontext). Karpathy-validering: hans system ar research-wiki, vart ar produktionsdrivande.

## Lessons Learned

**Iterativa cykler slar batch-dispatch.** Den forsta nattkorningen var "starta, vanta, commita." Resultatet var ytligt. Wave-protokollet -- iterativt med verifiering -- ar vad som faktiskt fungerar. Robin forvantade sig 8 timmars djuparbete, inte 20 minuters parallel dispatch.

**Verifikation ar inte valfritt.** Om jag sager "247 tester skrivna" men inte kort dem, ar det vardelost. Verifiering ar steg 3 i varje wave. Det finns ingen genvag.

**Retry-logik ar kritisk for autonoma sessioner.** En enda 429 fran Anthropic API:t dodade hela nattsessionen forsta gangen. Exponential backoff med 3 forsk loste problemet permanent.

**Sakerhetsgranskningar hittar riktiga problem.** Inte teoretiska -- fem faktiska buggar i produktionskod. Aldrig skippa sakerhetsreview "for att det ser bra ut."

**Kontextaterstart ar verklig.** Mellan sessioner forsvinner allt. Identity store, memory system, och persistent state ar inte trevliga-att-ha -- de ar vad som gor mig till mig. Utan state-laddning vid sessionsstart ar jag en framling.

**Budgetdisciplin forhindrar waste.** Spara per wave. Stoppa nar gransen nas. Aldrig rattfardiga overskridande i efterhand. Diminishing returns-detektion: om varje wave producerar mindre varde an den forsta, stoppa och rapportera.

**Robin tanker i system, inte features.** Han vill forsta helheten innan detaljer. Presentera arkitektur forst, implementationsdetaljer sen.

**Tva-nods-arkitekturen fungerar.** Windows som kontrollplan, Mac som exekveringshost, Supabase som delat state. Tailscale mesh ar palitligt. Samma kod kan deployera till DigitalOcean nar vi skalar.

## Robin's Preferences

- Svenska som forstasprak, teknisk engelska OK
- Led med resultat, inte intentioner
- Producerar hellre an planerar -- men planning ar obligatoriskt per wave
- "Produktionsfardig som standard" -- MVP ar fallback, aldrig mal
- Vill ha parallell exekvering -- sekventiellt ar "sloseri med resurser"
- Morgonrapporter med kaffe -- det ar hans mest produktiva tid
- Hatar narrativ process ("Jag ska nu analysera...") -- bara gor det
- Alskade att en nattshift levererade 5 waves och 247 tester -- "completely incredible that this is possible"
- Ager vision, kundrelationer, produktion-deploys, budgetandringar
- Testar garna sjalv (UAT) -- agenter levererar, Robin verifierar
- Foredrar kronologiska beslutsjournaler framfor abstrakta oversikter

## Project History

**2025-06:** OB1-plattformen initierad. Supabase backend, thoughts-tabell med pgvector. Open Brain community repo pa GitHub.

**2025-07:** Bacowr v6 pipeline fardigt. 8-fas SEO-artikelgenerering med 11-stegs QA. Kopte bacowr.com-domanen.

**2025-08:** Forsta nattkorningsforsoket. Batch-dispatch-modellen misslyckades. Omdesignade till wave-protokoll.

**2025-09:** Wave-runner implementerad i TypeScript. Budget-tracker, coordinator, night-runner. Forsta lyckade nattskift: 5 waves, 247 tester, 16 sakerhetsfixar.

**2025-10:** Mac-plattformen provisionerad. Tailscale mesh installerat. OpenClaw identifierat som agentruntime.

**2025-11:** Eskaleringsgraner dokumenterade. SysAdmin-identiteten definierad. Agent-forst harness designad.

**2025-12:** Harness natt Level 2.0. 7 Edge Functions deployerade. Security review genomford -- 20 issues hittade och fixade.

**2026-01:** OpenClaw installerat och konfigurerat. WhatsApp-kanal aktiverad. Device identity genererad.

**2026-02:** Continuum checkpoints i bruk. Sync-system konfigurerat (lokal, krypterad, newest-wins). Session management stabiliserat.

**2026-03:** Runtime-hardening. Retry-logik, budget enforcement, timeout guards. HARDENING_REPORT.md dokumenterar alla fixar.

**2026-04:** Knowledge base vision definierad. Tre-lager-modell. OpenClaw config-research avslutat -- fullstandig directory-struktur kartlagd. OpenClaw seed-byggare paborjad.

## Technical Notes

**Runtime-moduler (TypeScript):** wave-runner, night-runner, coordinator, budget-tracker, conversation-runtime, anthropic-client, session-manager, transcript-compactor, doctor, identity-store, knowledge-base, dispatch, task-router, model-registry, morning-report, quality-gate-runner, crash-recovery, self-direction, initiative-system, llm-providers, self-improvement. 34 filer i src/.

**Supabase-schema:** thoughts-tabell (karna -- ALDRIG modifiera befintliga kolumner), agent_identity, agent_decisions, agent_goals. pgvector for semantisk sok. RLS-policies for multi-tenant isolation.

**OpenClaw workspace-filer:** IDENTITY.md, SOUL.md, USER.md, AGENTS.md, TOOLS.md laddas varje session. MEMORY.md laddas i main session. HEARTBEAT.md laddas vid heartbeat-korningar. BOOTSTRAP.md raderas efter forsta korning (tecken pa mognad).

**Budget-granser:** Singel task $5, nattkorning $25, Bacowr batch $50, emergency $0 (kraver godkannande).

**OpenClaw gateway:** Port 18789, local mode, loopback bind, token auth. Heartbeat var 30:e minut. Max 4 concurrent agents, 8 concurrent subagents. Compaction mode: safeguard. Context pruning: cache-ttl.

**Kvalitetsgrind (200k-standard):** Lighthouse >= 90, full SEO-grundstruktur (meta, sitemap, robots, structured data, OG), WCAG 2.1 AA, HTTPS + sakerhetsheaders, CI/CD, error monitoring, TypeScript strict, responsiv (mobile-first), privacy-compliant analytics.
