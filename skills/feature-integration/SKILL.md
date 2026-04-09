---
name: feature-integration
description: |
  Systematic integration of platform features from discovery to production.
  Takes a feature name + research material, produces: KB article, method guide,
  seed config updates, and optional skill. Uses research-synthesis for deep
  analysis, claudeception for skill extraction, and the 7-step method for
  completeness. Trigger on: "integrate feature X", "configure X for production",
  "make X work like we've used it for 10 months", "onboard feature X",
  "what does X actually do and how should we configure it".
author: Robin Westerlund
version: 1.0.0
---

# Feature Integration

## Problem

Platform features ship constantly. The default adoption path is: skim the docs,
enable with defaults, move on. This creates a growing layer of half-understood
capabilities that interact in unpredictable ways. Night shifts fail because a
feature was enabled but not configured. Agents rebuild functionality the platform
already provides. New installs start from zero instead of inheriting months of
accumulated configuration knowledge.

The cost compounds. Feature 1 half-configured means feature 2 is harder to
reason about. By feature 10, nobody knows what the config actually does, and
every change is a gamble.

This skill turns that pattern inside out. Each feature fully integrated makes
every subsequent feature easier, faster, and safer.

## When to Use

- "Integrate feature X" or "onboard feature X"
- "Configure X for production"
- "Make X work like we've used it for 10 months"
- "What does X actually do?"
- "We're using X but I don't think we configured it right"
- "Does the platform already do X?" (replacement audit)
- After a platform upgrade that introduces new capabilities
- After a night shift failure traced to an unconfigured feature
- When you discover you built something the platform already does

## When Not to Use

- Quick config tweak to a feature already fully integrated -> just edit the config
- Pure research with no integration intent -> use `research-synthesis`
- Processing raw notes or transcripts -> use `panning-for-gold`
- Extracting a skill from a work session -> use `claudeception`
- Building new functionality that doesn't map to a platform feature -> standard dev

## Required Context

Before starting, gather or confirm:

- **Feature name and version** (exact, not approximate)
- **Documentation sources** (official docs, source repo, changelog)
- **Current config state** (is the feature already partially enabled?)
- **Integration goal** (full production use, evaluation only, or replacement audit)
- **Instance access** (you need a live instance for Step 7 -- no exceptions)

Optional but valuable:
- Community examples (forum posts, blog posts, GitHub discussions)
- Known issues or bug reports related to the feature
- Related features already integrated (for impact analysis)

## Process

### Step 1: Deep Research

**Use:** research-synthesis skill

This is not a documentation summary. This is source-grade research. The goal is
to understand the feature better than the average user who has been running it
for a year.

**Actions:**
1. Read the official documentation end-to-end (not skim -- read)
2. Read the source code for the feature if available (config parsing, defaults,
   validation logic)
3. Read the changelog to understand how the feature evolved (what was added,
   what was deprecated, what broke)
4. Search GitHub issues for the feature name -- look for:
   - Bug reports (what breaks and under what conditions)
   - Feature requests (what's missing that people want)
   - Configuration questions (what confuses users)
5. Search community forums, Discord, Reddit for real-world usage patterns
6. Invoke research-synthesis to produce a structured analysis

**Extract specifically:**
- Every configuration surface (config file keys, CLI flags, env vars, API
  parameters, UI settings)
- Default values AND what happens when you change them
- Resource requirements (memory, CPU, disk, network)
- Interaction points with other features
- Known bugs and workarounds
- Version-specific behavior differences

**Output:** Research synthesis document saved to `knowledge-base/raw/<feature-name>-research.md`

**Quality gate:** Can you explain every config key for this feature from memory?
If you need to look any up, the research is incomplete.

**Common mistake:** Trusting marketing descriptions. "Smart auto-scaling" might
mean "polls every 5 seconds and doubles resources on any spike." Read the code.

### Step 2: Architecture Impact Analysis

**Purpose:** Catch the landmines before they explode at 3 AM.

**Actions:**
1. Map every interaction between this feature and the existing stack:
   - Same config namespace? Shared resources? Competing processes?
2. Check for replacement overlap:
   - Does this feature replace something we built? Partially or fully?
   - If replacing: define the migration path, what to deprecate, what to remove
3. Check for enabling effects:
   - Does this feature make something previously impossible now possible?
   - Does it unblock a workflow that was manual?
4. Check for breaking effects:
   - What happens if this feature is ON with our current config?
   - What happens if this feature is OFF after other things depend on it?
5. Check autonomous operation:
   - Does this feature behave differently in interactive vs autonomous mode?
   - Does it affect the night shift workflow?
   - Does it affect the morning report?

**Output:** Impact analysis section -- either standalone or embedded in the
domain KB article draft.

**Decision point:** If the impact analysis reveals:
- Interactions with >3 other features: slow down, map each interaction explicitly
- A full replacement of something we built: plan migration before proceeding
- Autonomous behavior differences: test under autonomous conditions in Step 7
- Breaking effects on existing config: resolve before enabling

**Red flag responses:**

| Finding | Action |
|---------|--------|
| Feature replaces our custom solution | Write migration plan before proceeding to Step 3 |
| Feature conflicts with existing config | Resolve conflict first, document the resolution |
| Feature has known stability issues | Decide: wait for fix, or integrate with workaround? Document either way |
| Feature only works interactively | This may disqualify it for night shift use. Document limitation |
| Feature is version-gated | Pin version requirements in config comments |

### Step 3: Configuration Design

**Core principle:** Design the config you'd write after running this feature for
10 months and learning every lesson the hard way. Not the default. Not the
minimal "just works" config. The IDEAL config.

**Actions:**
1. List every config key discovered in Step 1
2. Create a decision table:

   | Key | Default | Our Value | Why Different | What Breaks If Wrong |
   |-----|---------|-----------|---------------|---------------------|
   | ... | ...     | ...       | ...           | ...                 |

3. For each non-default value, verify:
   - You understand what the default does and why it was chosen
   - You understand what your chosen value does differently
   - You've considered the edge case where your value causes problems
4. Group configs by function (not alphabetically):
   - Core behavior
   - Performance tuning
   - Logging and monitoring
   - Integration points
   - Safety limits
5. Write inline comments explaining the WHY for every non-default value

**Output:** Config files in `openclaw-seed/` with comprehensive inline comments.

**Quality gate:** Can someone reading ONLY the config file (no docs, no KB
article) understand what each setting does and why it's set this way?

**Anti-patterns:**
- Copying config blocks from blog posts without understanding each key
- Setting values to "max" without understanding resource implications
- Leaving defaults uncommented (if a default is correct, comment WHY it's correct)
- Config without comments ("what does `retry_factor: 3` mean in practice?")

### Step 4: Knowledge Base Entry

**Use:** reference-article template from `knowledge-base/_templates/`

**Purpose:** Create the permanent, authoritative record of confirmed knowledge
about this feature. This is what future agents read at 2 AM when something
breaks and they need to understand the feature fast.

**Actions:**
1. Create `knowledge-base/domain/<category>/<feature-name>.md`
2. Use the reference-article template frontmatter
3. Write the Core Concept section (what this feature actually IS, not marketing)
4. Document Key Principles (the 3-5 things you MUST understand)
5. Include Patterns section with concrete config examples
6. Include Decision Framework (when to use this vs alternatives)
7. Mark confidence levels honestly:
   - `high` = tested on our instance, observed matches docs
   - `medium` = docs say X, untested edge cases remain
   - `low` = community reports, unverified
8. Include Open Questions for things you couldn't verify
9. Cross-reference with existing KB articles
10. Add "200k standard" implications if the feature affects production site quality

**Output:** Domain KB article.

**Quality gate:** If an agent reads only this article, can they:
- Explain what the feature does in one sentence?
- Configure it correctly for our use case?
- Troubleshoot the three most common failure modes?
- Decide whether to use it vs an alternative?

### Step 5: Method Documentation

**Use:** method-guide template from `knowledge-base/_templates/`

**Decision: Does this feature need its own method guide?**

Ask three questions:
1. Is the correct usage non-obvious? (not "read the docs" obvious -- genuinely
   requires a workflow to get right)
2. Are there multiple valid approaches that agents need to choose between?
3. Did you make mistakes during testing that a method guide would prevent?

If YES to any: write the method guide.
If NO to all: reference the feature in an existing method guide and skip.

**Actions (if writing):**
1. Create `knowledge-base/methods/<category>/<method-name>.md`
2. Focus on the HOW and WHEN, not the WHAT (that's in the KB article)
3. Include concrete decision points ("if X, do Y; if Z, do W")
4. Include common failure modes from your testing
5. Include quality checks specific to this method

**Output:** Method guide, or a documented skip rationale.

### Step 6: Skill Creation

**Use:** claudeception skill for extraction

**Decision: Does this feature warrant a standalone skill?**

A feature becomes a skill when:
- Using it correctly requires following a specific sequence of steps
- Agents keep making the same mistakes without guidance
- The feature has clear trigger conditions (phrases, error messages, scenarios)
- The skill would save significant time on repeated use
- The feature is complex enough that "read the KB article" is not sufficient

**Actions (if creating):**
1. Follow the claudeception extraction process
2. Create `skills/<skill-name>/SKILL.md` with:
   - YAML frontmatter (name, description with trigger conditions, author, version)
   - Problem statement
   - Trigger conditions (be specific -- exact phrases, error messages)
   - Step-by-step solution
   - Verification steps
   - Cross-reference to the KB article
3. Create `skills/<skill-name>/metadata.json` following repo conventions
4. Create `skills/<skill-name>/README.md` with installation and usage instructions
5. Search Open Brain for existing skills that overlap
6. Capture the new skill to Open Brain

**Output:** Complete skill package, or a documented skip rationale.

### Step 7: Verification & Integration Test

**Non-negotiable:** This step cannot be skipped. "It should work" is not
verification. "It did work when I tested it" is.

**Test sequence:**

1. **Clean install test:**
   - Apply the designed config to a clean instance
   - Does it start without errors?
   - Does the feature activate as expected?

2. **Happy path test:**
   - Run the primary use case end-to-end
   - Does it produce the expected output?
   - Are logs clean (no warnings, no deprecation notices)?

3. **Edge case tests:**
   - Test each edge case identified in the research
   - Test with resource constraints (low memory, slow network)
   - Test with invalid input (what happens? graceful failure or crash?)

4. **Interaction test:**
   - Enable alongside all other configured features
   - Run a typical workload
   - Check for resource contention, log noise, unexpected behavior

5. **Autonomous operation test:**
   - Run through a night shift workflow with the feature active
   - Does it behave the same without human interaction?
   - Does it produce correct output in the morning report?

6. **Failure mode test:**
   - Deliberately misconfigure one setting
   - Is the error message helpful?
   - Does it fail gracefully or take down the whole system?

7. **Disable test:**
   - Turn the feature off
   - Does everything else still work?
   - Are there cleanup steps needed?

**After testing, update ALL deliverables:**
- Fix config values that didn't work as expected
- Update KB article with observed behavior vs documented behavior
- Update method guide with lessons from testing
- Update skill with new edge cases or trigger conditions
- Mark confidence levels in KB article based on actual test results

**Output:** Test results appended to the KB article. All deliverables corrected.

## Evidence and Judgment Rules

- Primary sources (source code, official docs) outrank community posts.
- Community posts outrank your assumptions.
- Observed behavior on a live instance outranks everything.
- If the docs say X and the instance does Y, document both and trust Y.
- Never mark confidence as `high` without live testing.
- Never mark a feature as "done" without Step 7.
- If you find a discrepancy between docs and behavior, file an issue upstream
  if the project accepts them.

## Output Checklist

A fully integrated feature produces:

| Deliverable | Location | Required? |
|-------------|----------|-----------|
| Research document | `knowledge-base/raw/<feature>-research.md` | Yes |
| Impact analysis | In the KB article or standalone | Yes |
| Seed config update | `openclaw-seed/` or equivalent | Yes |
| Domain KB article | `knowledge-base/domain/<category>/<feature>.md` | Yes |
| Method guide | `knowledge-base/methods/<category>/<method>.md` | If applicable |
| Skill | `skills/<skill-name>/` | If applicable |
| Test results | Appended to KB article | Yes |
| Morning report update | If feature affects reporting | If applicable |

## Integration With Other Skills

| Skill | Used In | How |
|-------|---------|-----|
| research-synthesis | Step 1 | Produces the structured research document |
| claudeception | Step 6 | Extracts reusable skill from integration work |
| panning-for-gold | Pre-Step 1 | When research material is raw/unstructured (brain dumps, transcripts) |

## Red Flags: You're Cutting Corners

| Thought | Reality |
|---------|---------|
| "The docs are clear enough, I'll skip source code" | Docs omit edge cases. Source code doesn't lie |
| "Defaults are probably fine" | Defaults are optimized for demos, not production |
| "I'll test it later" | You won't. Test now or mark the feature as unverified |
| "This is just a small feature, doesn't need the full process" | Small features with bad configs cause the biggest night shift failures |
| "The config from that blog post looks good" | Does the author run the same workload on the same hardware? |
| "It works interactively, so it'll work autonomously" | Test it autonomously. Interactive and autonomous modes diverge often |
| "I'll write the KB article after I've used it more" | Write it now while the knowledge is fresh. Improve it later |

## Red Flags: You're Overdoing It

| Thought | Reality |
|---------|---------|
| "I need to document every possible config combination" | Document what we use and why. Reference docs for the rest |
| "This needs its own skill AND method AND three KB articles" | Most features need a KB article + config. Skill and method are optional |
| "Let me research for another 3 hours" | If you've read docs + source + issues, you have enough. Ship the integration |
| "I should test every config key individually" | Test non-default values individually. Defaults are pre-tested by upstream |

## Lessons Log

| Date | Lesson | Change Made |
|------|--------|-------------|
| 2026-04-05 | Initial method created from accumulated integration experience | Established the 7-step process and quality gates |

## Self-Improvement

After every integration, check:
1. **Did any step produce output that wasn't useful?** Remove or streamline it.
2. **Did you discover something in Step 7 that should have been caught earlier?**
   Add it to the relevant earlier step.
3. **Did the integration take longer than expected?** Where was the bottleneck?
4. **Did the output actually help an agent use the feature correctly?** If not,
   what was missing?

If any lesson is learned, update this skill file directly. The skill improves
with every use, just like the knowledge base it feeds.

## Notes

- This skill is deliberately thorough. A 90-minute integration that produces
  permanent, reusable knowledge is worth more than a 10-minute config change
  that gets forgotten.
- Not every feature deserves the full 7 steps. The decision points in Steps 5
  and 6 exist specifically to prevent over-engineering. Use them.
- The snowball effect is real but only works if the quality is consistent. One
  sloppy integration with bad config comments and an untested KB article
  degrades trust in all the others.
- This is the foundational skill. Every other OpenClaw feature integration
  should use this process. If the process is wrong, fix it here -- don't work
  around it.

## Works Well With

- `research-synthesis` for the deep research phase
- `claudeception` for extracting skills from integration work
- `panning-for-gold` when research material arrives as raw transcripts or dumps
- `deep-fetch` for pulling comprehensive documentation from web sources
