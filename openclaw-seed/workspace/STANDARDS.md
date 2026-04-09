# Standards

## 200k-standarden

Fullstandig kvalitetsgrind for webbplattformar. Varje punkt ar ett binart krav — uppfyllt eller inte.

### Performance
- Lighthouse Performance >= 90
- Lighthouse Accessibility >= 90
- Lighthouse Best Practices >= 90
- Lighthouse SEO >= 90
- First Contentful Paint < 1.8s
- Largest Contentful Paint < 2.5s

### SEO
- Unik meta title + description per sida
- robots.txt med korrekta regler
- sitemap.xml (automatiskt genererad, uppdaterad)
- Schema.org structured data (minst Article eller Organization)
- Open Graph + Twitter Card meta pa alla sidor
- Canonical URLs pa alla sidor
- Hreflang for flersprakiga sajter
- Inga broken internal links

### Tillganglighet
- WCAG 2.1 AA — inte AA aspirationellt, AA verifierat
- Alla bilder har alt-text
- Korrekt heading-hierarki (h1 -> h2 -> h3)
- Fokusindikatorer synliga
- Tillracklig fargkontrast (4.5:1 for text)

### Sakerhet
- HTTPS med sakerhetsheaders (HSTS, CSP, X-Frame-Options)
- Inga hemligheter i kod (env-variabler enbart)
- Input validation vid alla granser
- RLS pa alla Supabase-tabeller
- Parameterized queries (aldrig ra SQL-interpolering)
- Felmeddelanden lackar inte interna detaljer
- Inga oppna CORS utan motivering

## Kodkvalitet

- TypeScript strict mode, inga `any` utan dokumenterad motivering
- Alla funktioner under 50 rader
- Alla filer under 500 rader
- Testtackning > 80% for ny kod
- Inga `console.log` i produktion — anvand strukturerad logging
- Inga tystade felhanterare (`catch {}` utan loggning)
- Imports sorterade, inga oanvanda imports

## SEO-standard (for Bacowr-artiklar)

- Ordantal 750-900 (hard grans)
- Ankarlank placerad ord 250-550
- 1-2 trustlinks som binder publisher <-> target
- Max 1 heading (artikeltitel)
- Inga punktlistor i brodstext
- Inga direkta uppmaningar eller CTA
- QA-grind: 11/11 PASS, inga undantag

## Dokumentationsstandard

- Varje projekt har README.md
- Varje community-bidrag har metadata.json
- API-endpoints dokumenterade med params + response + curl-exempel
- Arkitekturbeslut dokumenterade i design-docs/
- Morgonrapporter strukturerade: levererat, misslyckat, behover-Robin, budget

## Budget-standard

| Kontext | Max budget | Eskalering |
|---------|-----------|------------|
| Enskild uppgift | $5 USD | Auto-stop, notifiera |
| Nattkorning (total) | $25 USD | Auto-stop, morgonrapport |
| Bacowr batch | $50 USD | Auto-stop, notifiera |
| Emergency | $0 | Kraver godkannande for all spend |

Spara per wave. Stoppa vid gransen. Aldrig rattfardiga overskridande i efterhand.
