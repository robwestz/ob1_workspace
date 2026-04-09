# Portfolio

## Aktiva projekt

### OB1 Control Platform
- **Status**: Alla 10 faser avklarade. Produktionsklar runtime.
- **Stack**: TypeScript, Node.js, Supabase, Next.js
- **Vad det ar**: Autonom IT-avdelningsplattform med SysAdmin-identitet. Wave-runner, night-runner, budget-tracker, coordinator, identity-store, crash-recovery, quality gates.
- **Nyckelsiffror**: 15 700+ rader i 35 runtime-moduler. 205+ tester. 7 Edge Functions med 47 API actions. 2 sakerhetsgranskningar (20 issues hittade och fixade).
- **Kvalitet**: Agentic runtime B over hela linjen. API dokumenterad med curl-exempel. TSC clean.
- **Lardomar**: Batch-dispatch misslyckas — iterativa waves med verifiering ar vad som fungerar. Retry-logik ar obligatorisk for autonoma sessioner. Sakerhetsgranskningar hittar verkliga buggar, inte teoretiska.

### Bacowr SaaS
- **Status**: Pipeline funktionell, SaaS-kommersialisering paborjad
- **Stack**: Python pipeline + TypeScript Edge Functions + FastAPI worker
- **Vad det ar**: AI-driven backlink-artikelgenerering. 8-fas pipeline: job spec -> preflight -> metadata -> SERP-probes -> research -> blueprint -> artikel -> QA.
- **Nyckelsiffror**: 5 000+ rader Python. 11-stegs QA-grind. ~$0.22/artikel kostnad. Konkurrensposition: 50-300x billigare an FatJoe ($50-200/artikel), Adsy, Collaborator.
- **Marknad**: Svenskt lankbygge ~200-400 sok/manad, nara noll konkurrens. US sweet spot: "seo article writing service" (600/mo, difficulty 9).
- **Kvar att bygga**: User auth, Stripe-betalning, jobb-ko, dashboard, offentligt API.
- **Lardomar**: QA-grinden ar vad som gor AI-genererat innehall anvandbart. Semantic bridge-konceptet (publisher-doman <-> target-sida) ar karninsikten.

### Knowledge Base
- **Status**: Arkitektur komplett, Level 0 (skelett)
- **Vad det ar**: Tre-lager KB (domain/methods/components) som driver agentproduktion. Inspirerad av Karpathys system men operationell istallet for passiv.
- **Nuvarande innehall**: Indexfiler och kategoristruktur pa plats. 9 domaner, 8 metoder, 9 komponentkategorier. Inget kompilerat innehall annu.
- **Lardomar**: Strukturen maste vara pa plats fore innehallet. Att fylla en ostrukturerad KB ar sloseri.

## Infrastruktur

### OpenClaw Gateway
- Port 18789, lokal mode, loopback bind, token auth
- Heartbeat var 30:e minut
- Max 4 concurrent agents, 8 concurrent subagents
- Compaction mode: safeguard, context pruning: cache-ttl

### Tvanodsarkitektur
- **Windows 11 PC (D:\OB1)**: Robins dagliga maskin. CLI-kontrollplan, utveckling, Claude Code.
- **MacBook Air M2**: Dedikerad agenthost. Runtime, dashboard, OpenClaw gateway. 8GB RAM = inga lokala modeller, allt cloud.
- **Tailscale mesh VPN**: Binder ihop noderna. Palitligt, krypterat, zero-config.
- **DigitalOcean**: Redo for skalning nar vi behover det.

### Supabase Backend
- PostgreSQL + pgvector for semantisk sok
- 7 Edge Functions deployerade
- RLS for multi-tenant isolation
- Delat state mellan alla noder

## Bevisad formaga

Det har portfolion visar att vi kan:
- **Bygga och halla ihop stora system** — OB1:s 15 700 rader ar inte en prototyp
- **Leverera autonom nattproduktion** — 5 waves, 247 tester, 16 sakerhetsatgarder pa en natt
- **Hitta och fixa riktiga buggar** — inte teoretiska, fem faktiska buggar i produktion
- **Halla budgetdisciplin** — tracking per wave, auto-stop vid gransen
- **Bygga konkurrenskraftiga produkter** — Bacowr ar 50-300x billigare an marknaden
- **Dokumentera allt** — varje beslut, varje misstag, varje lardom
