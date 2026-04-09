---
title: "Feature Integration Method"
format: method-guide
layer: methods
category: "process/integration"
status: confirmed
confidence: high
last_verified: 2026-04-05
tags: [integration, process, openclaw, platform, feature-onboarding]
prerequisites: [research-synthesis, claudeception]
outputs: [kb-article, method-guide, seed-config, skill, test-results]
quality_gate: "feature-integration-checklist"
---

# Feature Integration Method

> Take a platform capability from "discovered" to "production-grade, fully
> configured, documented, and self-maintaining."

## Purpose

Platform features ship faster than anyone can absorb them. The default path is:
discover a feature, skim the docs, enable it with defaults, move on. Six months
later you realize the feature has 40 config keys you never touched, three of
which would have saved you hours every week.

This method exists because we kept finding features the hard way --- after a
night shift failed, after a config collision, after we realized we'd built
something the platform already did better. The cost of not integrating properly
is not just wasted time, it's compounding ignorance: every feature you
half-configure makes the next one harder to reason about.

The method ensures that when a feature is "done," it is truly done: researched
at source-code depth, configured with the confidence of someone who's used it
for months, documented so agents can use it without rediscovering, and tested
on a live instance.

## When to Use

- A new platform feature is discovered that could change how agents work
- A feature exists but is running on defaults nobody examined
- A capability needs to go from "I know it exists" to "it runs automatically
  every night without supervision"
- Post-upgrade: a new version shipped features you haven't evaluated
- You realize you built something the platform already does (replacement audit)

## When NOT to Use

- Minor config tweaks to features already integrated -> just update the config
- Pure research with no integration intent -> use [[research-synthesis]] instead
- Building new functionality that doesn't map to a platform feature -> use
  standard development methods

## Prerequisites

- Access to the platform's source code or comprehensive docs
- A working instance to test against (droplet, local, staging)
- research-synthesis skill available for Step 1
- claudeception skill available for Step 6
- Write access to knowledge-base/ and openclaw-seed/ (or equivalent config repo)

## Process

### Step 1: Deep Research

**Action:** Use the research-synthesis skill to produce a source-grade research
document on the feature. This is not a blog-post skim. Read the source code if
the docs are thin. Read the changelog to understand how the feature evolved.

**Inputs:**
- Feature name and version
- Official docs URL
- Source repository (if open source)
- Any community examples, forum posts, or GitHub issues

**Outputs:** Research synthesis document saved to `knowledge-base/raw/`

**What to extract:**
- Every configuration surface (config keys, CLI flags, env vars, API params)
- Default values and what they actually do (not what the docs say they do)
- Edge cases found in GitHub issues and bug reports
- Performance implications (memory, CPU, network, storage)
- Interaction with other features (what breaks, what's enhanced)
- Version history: when was this added, what changed, what was deprecated

**Decision point:** If the research reveals the feature is not worth integrating
(too immature, wrong fit, already covered), document the finding and stop. A
"not worth it" conclusion is a valid and valuable output.

### Step 2: Architecture Impact Analysis

**Action:** Map how this feature interacts with the existing stack. This is where
you catch the landmines before they explode at 3 AM during a night shift.

**Inputs:** Research document from Step 1, current architecture docs, seed config.

**Outputs:** Impact analysis section added to the domain KB article draft.

**Questions to answer:**
- Does this feature replace something we built ourselves?
  - If yes: migration path, deprecation plan, what to remove
  - If partial: what parts overlap, what's still needed from our implementation
- Does it enable something previously impossible?
  - If yes: what new capabilities unlock, what workflows change
- What existing configs does it interact with?
  - Direct interactions (same config namespace, shared resources)
  - Indirect interactions (competing for the same system resources)
- What breaks if this feature is enabled with defaults?
- What breaks if this feature is disabled?
- Does it affect the night shift workflow? The morning report? Agent autonomy?

**Red flag:** If the impact analysis reveals interactions with more than 3 other
features, slow down. Complex interactions are where production incidents live.

### Step 3: Configuration Design

**Action:** Design the IDEAL configuration. Not the default. Not the minimal
"just get it working" config. The config you'd write if you'd been running this
feature for 10 months and had learned every lesson the hard way.

**Inputs:** Research document, impact analysis, existing seed config.

**Outputs:** Config files in `openclaw-seed/` (or equivalent) with inline comments
explaining every non-default value.

**Process:**
1. List every config key from the research document
2. For each key, determine:
   - What the default is and why it was chosen as default
   - What the optimal value is for our use case and why
   - What the dangerous values are (values that cause silent failures)
3. Group configs logically (not alphabetically)
4. Write inline comments that explain the WHY, not the WHAT
5. Test each non-default value individually --- understand the effect in isolation
   before combining

**Quality check:** Can someone reading only the config file (no docs) understand
what each setting does and why it's set this way? If not, the comments are too
thin.

**Common failure:** Copying config blocks from blog posts or community examples
without understanding each key. This creates config debt --- settings you can't
explain, can't debug, and can't confidently change.

### Step 4: Knowledge Base Entry

**Action:** Create a domain KB article (Layer 1) using the reference-article
template. This is the permanent record of confirmed knowledge about this feature.

**Inputs:** Research document, impact analysis, verified config.

**Outputs:** `knowledge-base/domain/<category>/<feature-name>.md`

**Requirements:**
- Use the reference-article template from `knowledge-base/_templates/`
- Include the "200k standard" implications (how does this feature affect the
  quality bar for production sites?)
- Cross-reference with existing KB articles
- Mark confidence levels honestly:
  - `high` = tested on our instance, observed behavior matches docs
  - `medium` = docs say X, we haven't tested edge cases
  - `low` = community reports say X, we haven't verified
- Include an Open Questions section for things you couldn't verify

### Step 5: Method Documentation

**Action:** If this feature requires a non-obvious workflow to use correctly,
write a method guide (Layer 2) using the method-guide template.

**Inputs:** All previous outputs, actual usage experience from testing.

**Outputs:** `knowledge-base/methods/<category>/<method-name>.md`

**Decision point:** Not every feature needs its own method guide. Ask:
- Is the correct usage non-obvious?
- Are there multiple valid approaches that agents need to choose between?
- Did you make mistakes during testing that a method would prevent?

If the answer to all three is "no," skip this step. Reference the feature in an
existing method guide instead.

### Step 6: Skill Creation

**Action:** Evaluate whether this feature warrants a standalone skill. If yes,
use the claudeception pattern to create it.

**Inputs:** All previous outputs, verified config, usage patterns.

**Outputs:** `skills/<skill-name>/SKILL.md` + `metadata.json` + `README.md`

**Decision point:** A feature becomes a skill when:
- Using it correctly requires following a specific sequence of steps
- Agents keep making the same mistakes without guidance
- The feature has trigger conditions that map well to user requests
- The skill would save significant time on repeated use

**If creating a skill:**
- Follow the claudeception extraction process (Step 4 in that skill)
- Include concrete trigger conditions (exact phrases, error messages, scenarios)
- Include verification steps (how does the agent confirm it worked?)
- Cross-reference the KB article for deep knowledge

### Step 7: Verification & Integration Test

**Action:** Test everything on a live instance. Not "it should work." Actually
test it. Break it. Fix it. Document what you found.

**Inputs:** Configured instance, all documentation produced above.

**Outputs:** Test results appended to the KB article, corrections applied to all
deliverables.

**Test checklist:**
1. Enable the feature with the designed config on a clean instance
2. Verify the happy path works as documented
3. Test each edge case identified in the research
4. Deliberately misconfigure one setting and observe the failure mode
5. Run through the night shift workflow with the feature active
6. Check resource usage (does it spike memory? saturate disk?)
7. Disable the feature and verify nothing else breaks

**After testing, update everything:**
- Fix any config values that didn't work as expected
- Update the KB article with observed behavior
- Update the method guide with lessons from testing
- Update the skill with any new edge cases

## Quality Checks

Before a feature is considered "done":

- [ ] Research document exists in `knowledge-base/raw/` with source-grade depth
- [ ] Architecture impact analysis is written and reviewed
- [ ] Config designed with inline comments explaining every non-default value
- [ ] Domain KB article written, cross-referenced, confidence levels marked
- [ ] Method guide written (if applicable) or explicitly skipped with rationale
- [ ] Skill created (if applicable) or explicitly skipped with rationale
- [ ] Seed config updated with verified settings
- [ ] Tested on actual instance --- not "should work," actually tested
- [ ] Morning report template updated (if feature affects reporting)
- [ ] All deliverables updated with findings from testing

## Common Failures

| Failure | Symptom | Prevention |
|---------|---------|-----------|
| Config copy-paste from blog posts | Settings you can't explain when asked | Test each key individually, write comments explaining WHY |
| Skipping impact analysis | Feature breaks existing workflow at 3 AM | Always map interactions before enabling |
| Research from docs only | Missing edge cases, wrong mental model | Read source code and GitHub issues, not just docs |
| "Works on first try" overconfidence | Skipping verification, undiscovered edge cases | Run the full test checklist even when it seems obvious |
| Building what the platform already does | Wasted effort, maintenance burden | Always check for platform-native alternatives first |
| Integrating without testing night shift | Feature works interactively but fails autonomously | Test under autonomous conditions specifically |
| Thin KB article | Future agents rediscover the same knowledge | Write for the agent who will read this at 2 AM with no context |

## Example

**Feature: Task Conductor (hypothetical)**

1. **Research:** Discovered Conductor has 23 config keys. Docs cover 8. Source
   code reveals 3 undocumented keys that control retry behavior. GitHub issues
   show a memory leak in versions before 2.3 with >50 concurrent tasks.
2. **Impact:** Conductor replaces our custom task-router. Migration path: run
   both in parallel for one week, compare routing decisions, then cut over.
   Affects night shift: Conductor has its own scheduling that conflicts with
   our cron approach.
3. **Config:** Set `max_concurrent: 20` (not the default 100 --- our droplet
   has 2GB RAM). Set `retry_strategy: exponential` (default is `none`).
   Disabled `auto_discover: true` (it scans all files on startup, 40s delay).
4. **KB article:** Written with all 23 keys documented, confidence high on the
   15 we tested, medium on 8 we verified from source but didn't stress-test.
5. **Method:** Wrote a "Task Orchestration" method since choosing between
   Conductor, manual routing, and cron-based scheduling is non-obvious.
6. **Skill:** Created `conductor-config` skill with triggers for "set up task
   routing" and "why are tasks failing."
7. **Verification:** Conductor ran for 3 night shifts. Found that
   `health_check_interval` default of 5s caused 200 log entries per minute.
   Changed to 60s. Updated all docs.

## The Snowball Effect

Each completed feature integration:

1. **Adds to the knowledge base** --- agents get smarter about the platform
2. **Creates or improves skills** --- future integrations are faster
3. **Updates the seed config** --- new installs start with months of experience
   baked in
4. **Feeds back via claudeception** --- the method itself improves
5. **Reduces night shift failures** --- fewer surprises at 3 AM
6. **Compounds** --- feature N+1 is faster than feature N because the KB, skills,
   and configs from features 1 through N provide context

After 10 features, a new agent on a fresh install starts with the equivalent of
months of production experience. After 20, the platform practically configures
itself. That's the snowball.

## Related

- Skill: [[research-synthesis]] --- used in Step 1
- Skill: [[claudeception]] --- used in Step 6
- Skill: [[panning-for-gold]] --- useful when raw research material needs thread extraction
- Quality standard: [[200k-standard]] --- the bar all integrations must meet
- Template: [[method-guide]] --- template for Step 5 output
- Template: [[reference-article]] --- template for Step 4 output
