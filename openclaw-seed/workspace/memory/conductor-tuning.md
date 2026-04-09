# Conductor Model Routing -- Tuning Notes

> First configured: 2025-07-18
> Last tuned: 2026-04-03
> Status: Production, stable for 3 months

---

## Current Configuration

### Routing Rules (Priority Order)

1. **Security modules -> Opus** (priority 30). Everything touching auth, crypto, payment, or access control goes to Opus unconditionally. This was the first rule we added after Sonnet missed an auth bypass in the payment module (2025-08-22 incident).

2. **SEO content modules -> Codex** (priority 30). Bacowr's content generation pipeline generates hundreds of meta descriptions and title variations. Codex handles the volume and the code-adjacent template generation better than Claude models.

3. **Architecture modules -> Opus** (priority 25). Any module with "architecture", "orchestration", "pipeline", or "engine" in the name. These are the modules where getting the interfaces wrong costs 3x in downstream rework.

4. **Test modules -> Sonnet** (priority 25). Test writing is a sweet spot for Sonnet. Good enough quality, fast enough throughput, understands patterns from the codebase.

5. **Documentation -> Haiku** (priority 25). README generation, API docs, changelog compilation. Haiku is fast and the quality is sufficient for docs that follow existing templates.

6. **Default complexity-based rules** (priority 10). High -> Opus, Medium -> Sonnet, Low -> Haiku. These catch everything not matched by domain-specific rules.

### Explicit Module Overrides

```
payment-processor -> Opus (always)
session-manager -> Opus (always, handles auth state)
seo-bulk-writer -> Codex (volume work)
email-template-gen -> Haiku (pure template application)
config-validator -> Haiku (schema-based, no reasoning needed)
```

### Default Provider

Sonnet 4.6. Most work falls into the medium complexity band, and Sonnet handles it well. We switched from Opus-as-default to Sonnet-as-default on 2025-09-15 when the monthly bill hit $1,100 for what was mostly adapter code.

---

## What We Learned

### Model Selection

- **Opus for architecture decisions -- worth the cost, saves rework.** We tracked this over 4 months. Modules designed by Opus had 40% fewer interface change requests from downstream modules. At $3-5 per architecture decision vs $15-30 in rework time, Opus pays for itself.

- **Haiku for documentation -- fast enough, quality sufficient.** We initially used Sonnet for all docs. Switching to Haiku cut doc generation costs by 80% with no measurable quality difference. The templates do the heavy lifting; the model just fills them in.

- **Codex for bulk code generation -- better throughput than Claude.** For Bacowr's SEO content pipeline, we generate 200-500 content variations per batch. Codex completes these 2x faster than Sonnet with equivalent quality.

- **Sonnet is the right default.** We experimented with Haiku-as-default (too many quality issues on medium-complexity tasks) and Opus-as-default (3x the cost with marginal quality improvement on routine work). Sonnet hits the sweet spot.

- **Gemini for large-context analysis.** When we need to analyze the entire Bacowr codebase (400K+ tokens), Gemini's 1M context window is the only practical option. Quality is good enough for analysis; we don't use it for code generation.

### Complexity Scoring

- **The 0.6/0.3 thresholds are about right.** We tried lowering the high threshold to 0.5 (too many modules hitting Opus unnecessarily) and raising it to 0.7 (missed genuinely complex modules). 0.6 catches the right modules.

- **Domain tags matter more than criteria count.** A module named "Validator" with 8 acceptance criteria still gets Haiku because the domain tag scores low. This is correct behavior -- validators are well-defined regardless of criteria count.

- **Contract density is a good complexity signal.** Modules with 4+ contract dependencies genuinely need better reasoning. The 0.25 weight for contract-dependencies is well-calibrated.

### Cost Analysis

**Monthly breakdown (March 2026, typical month):**

| Model | % of Calls | % of Cost | Avg Cost/Call |
|-------|-----------|-----------|---------------|
| Opus 4.6 | 12% | 58% | $4.20 |
| Sonnet 4.6 | 55% | 32% | $0.50 |
| Haiku 4.5 | 25% | 4% | $0.14 |
| Codex 5.3 | 8% | 6% | $0.65 |

**Total: ~$380/month** (down from ~$1,100 when we used Opus-as-default)

**Cost optimization wins:**
- Switching docs to Haiku: saved ~$120/month
- Switching default to Sonnet: saved ~$500/month  
- Adding Codex for SEO bulk: saved ~$80/month (faster + cheaper than Sonnet for this workload)
- Adding budget caps: prevented 3 runaway sessions that would have cost $50+ each

### Handoff Quality

- **Critical handoff items actually get used.** We tracked downstream module quality with and without upstream handoffs. Modules that received CRITICAL handoffs had 25% fewer integration failures.

- **Discovery logs are hit-or-miss.** About 60% of discovery entries are useful to downstream modules. The relevance scoring helps, but we still get noise. Keeping maxEntries at 100 prevents context bloat.

- **Swedish section headers confused sub-agents initially.** The uppdragspaket uses Swedish (Din roll, Domankusnkap, etc.). Sub-agents running on non-Claude models sometimes treated these as content rather than structure. We added explicit instructions to the persona section clarifying the format.

### Provider Reliability

- **Anthropic is the most reliable.** Over 10 months, fewer than 0.1% of Opus/Sonnet/Haiku calls failed due to provider issues (excluding rate limits).

- **OpenAI Codex has occasional latency spikes.** 2-3 times per month, Codex responses take 30+ seconds instead of the usual 5-10. We added a 60-second timeout and fall back to Sonnet when Codex is slow.

- **Gemini auth rotation is finicky.** Google's auth profile system requires periodic token refresh. Set up a cron job to refresh Gemini auth every 6 hours.

---

## Tuning History

| Date | Change | Reason |
|------|--------|--------|
| 2025-07-18 | Initial setup: Opus default | Starting configuration |
| 2025-08-22 | Added security domain -> Opus rule | Sonnet missed auth bypass |
| 2025-09-15 | Switched default to Sonnet | Cost reduction ($1,100 -> $400) |
| 2025-10-03 | Added Haiku for docs | Tested quality parity, confirmed |
| 2025-11-12 | Added Codex for SEO bulk | Throughput improvement for Bacowr pipeline |
| 2025-12-01 | Added budget caps ($50/session) | Prevented runaway sessions |
| 2026-01-15 | Tuned complexity thresholds | Tested 0.5 and 0.7, settled on 0.6 |
| 2026-02-20 | Added Gemini for codebase analysis | Needed >200K context for Bacowr refactor |
| 2026-03-10 | Added Codex timeout + fallback | Latency spikes causing pipeline stalls |
| 2026-04-03 | Current config: stable | No changes needed |

---

## Known Issues

1. **No budget awareness in Conductor.** Conductor assigns models without knowing cumulative cost. We work around this by running our Dispatcher's budget check as a secondary gate, but this means we sometimes re-route after Conductor has already generated the uppdragspaket.

2. **Complexity scoring is blind to code volume.** A module that creates 2 files of 50 lines scores the same as one that creates 2 files of 2000 lines. The scope factor (weight 0.20) only counts file count, not estimated size.

3. **No learning from outcomes.** Conductor routes the same manifest to the same model every time. It does not learn that "this type of module fails more with Sonnet and succeeds with Opus." We manually update overrides when we spot patterns.

4. **Handoff parsing is fragile.** The `@TARGET: description` format must be exact. Agents sometimes write free-form handoff notes that don't match the regex, losing the handoff information.
