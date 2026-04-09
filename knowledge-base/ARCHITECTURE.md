# Knowledge Base Architecture

> Three-layer knowledge system for autonomous, consistent, production-grade output.
>
> Status: ARCHITECTURE SKETCH
> Date: 2026-04-09
> Author: Robin Westerlund
> Depends on: OB1 Skills System, OpenClaw (persistence), Obsidian (frontend)

---

## Table of Contents

1. [Vision](#1-vision)
2. [Three-Layer Model](#2-three-layer-model)
3. [Directory Structure](#3-directory-structure)
4. [Article Formats](#4-article-formats)
5. [Metadata Schema](#5-metadata-schema)
6. [Naming Conventions](#6-naming-conventions)
7. [Layer Relationships](#7-layer-relationships)
8. [Compilation Pipeline](#8-compilation-pipeline)
9. [Agent Integration](#9-agent-integration)
10. [Skills That Enforce Structure](#10-skills-that-enforce-structure)
11. [Integration Points](#11-integration-points)
12. [Evolution Model](#12-evolution-model)

---

## 1. Vision

A living knowledge base — maintained by LLMs, consumed by LLMs, viewed by humans in Obsidian — that enables:

- **Consistent quality**: Every project meets a defined standard ("200k market value level") without per-project configuration
- **Agent autonomy**: Agents select work, execute methodology, and verify output without explicit user prompts
- **Compounding returns**: Every project, experiment, and research pass makes the system better
- **90-95% reuse**: Only 5-10% of any deliverable is truly custom

The knowledge base is **not documentation**. It is operational infrastructure. An agent without it is a junior improvising. An agent with it is a senior consulting from experience.

### Design Principles

1. **LLM-native**: Markdown with structured frontmatter. No proprietary formats.
2. **Scannable by humans**: Dense, visual, cheat-sheet-inspired layouts for human review in Obsidian.
3. **Retrievable by agents**: Consistent metadata, index files, and cross-references so agents find what they need without full-text search.
4. **Self-maintaining**: LLMs compile, lint, and evolve the KB. Humans review and confirm.
5. **Layered, not flat**: Domain knowledge informs methods, methods govern components, results flow back into all three.

---

## 2. Three-Layer Model

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   LAYER 3: COMPONENT KB  ─────────────────  "Build With"           │
│   Pre-built, tested building blocks. CMS models, modules, UI kits. │
│   90-95% of any project. Only 5-10% is client-specific.            │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   LAYER 2: METHOD KB  ─────────────────────  "How To Work"         │
│   Procedural frameworks: start → middle → finish.                  │
│   Research protocols, quality gates, autonomous work patterns.      │
│   Makes agents competent consultants, not just knowledgeable.       │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   LAYER 1: DOMAIN KB  ─────────────────────  "What We Know"        │
│   Categorized, cross-referenced, confirmed knowledge.              │
│   Sources of truth. Testable, developable, experimentable.          │
│   Gives agents starting points for autonomous work.                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Layer Interactions

```
Domain KB ──informs──▶ Method KB ──governs──▶ Component KB
    ▲                                              │
    └──────────── results flow back ───────────────┘
```

Every project, experiment, and research pass feeds back into all three layers. This is the flywheel.

---

## 3. Directory Structure

```
knowledge-base/
│
├── ARCHITECTURE.md              # This file — system blueprint
├── INDEX.md                     # Auto-maintained master index (by LLM)
│
├── domain/                      # LAYER 1: What We Know
│   ├── _index.md                # Auto-maintained domain index
│   │
│   ├── seo/
│   │   ├── _index.md            # Category index
│   │   ├── technical-seo.md     # Article: cheat sheet format
│   │   ├── content-strategy.md
│   │   ├── core-web-vitals.md
│   │   ├── link-building.md
│   │   ├── local-seo.md
│   │   ├── structured-data.md
│   │   └── assets/              # Images, diagrams per category
│   │
│   ├── web-development/
│   │   ├── _index.md
│   │   ├── frontend/
│   │   │   ├── react-patterns.md
│   │   │   ├── nextjs-architecture.md
│   │   │   ├── css-systems.md
│   │   │   └── performance-budgets.md
│   │   ├── backend/
│   │   │   ├── api-design.md
│   │   │   ├── auth-patterns.md
│   │   │   ├── database-patterns.md
│   │   │   └── edge-functions.md
│   │   ├── infrastructure/
│   │   │   ├── ci-cd-patterns.md
│   │   │   ├── hosting-comparison.md
│   │   │   └── monitoring.md
│   │   └── security/
│   │       ├── owasp-top-10.md
│   │       └── auth-flows.md
│   │
│   ├── digital-marketing/
│   │   ├── _index.md
│   │   ├── conversion-optimization.md
│   │   ├── analytics-setup.md
│   │   ├── email-marketing.md
│   │   └── paid-media.md
│   │
│   ├── design/
│   │   ├── _index.md
│   │   ├── design-systems.md
│   │   ├── typography.md
│   │   ├── color-theory.md
│   │   └── ux-patterns.md
│   │
│   ├── ai-and-agents/
│   │   ├── _index.md
│   │   ├── prompt-engineering.md
│   │   ├── agentic-architecture.md
│   │   ├── context-engineering.md
│   │   └── evaluation.md
│   │
│   └── business/
│       ├── _index.md
│       ├── pricing-models.md
│       ├── client-management.md
│       └── project-scoping.md
│
├── methods/                     # LAYER 2: How To Work
│   ├── _index.md                # Auto-maintained method index
│   │
│   ├── project-lifecycle/       # End-to-end project delivery
│   │   ├── 01-intake.md         # Client intake & scoping
│   │   ├── 02-architecture.md   # Tech stack & architecture selection
│   │   ├── 03-setup.md          # Project scaffolding & CI/CD
│   │   ├── 04-build.md          # Development methodology
│   │   ├── 05-qa.md             # Quality assurance & testing
│   │   ├── 06-deploy.md         # Deployment & go-live
│   │   └── 07-handoff.md        # Client handoff & documentation
│   │
│   ├── quality-gates/           # What "good enough" means
│   │   ├── 200k-standard.md     # The quality floor — concrete criteria
│   │   ├── seo-audit.md         # SEO quality gate checklist
│   │   ├── performance.md       # Performance budget enforcement
│   │   ├── accessibility.md     # WCAG compliance gate
│   │   ├── security.md          # Security review gate
│   │   └── code-quality.md      # Code standards gate
│   │
│   ├── research-protocols/      # How to investigate & learn
│   │   ├── technology-eval.md   # Evaluating a new tool/framework
│   │   ├── competitor-audit.md  # Analyzing competitor implementations
│   │   ├── literature-review.md # Synthesizing articles/papers
│   │   └── experiment-design.md # Hypothesis → test → measure → document
│   │
│   ├── autonomous-work/         # How agents work without prompts
│   │   ├── night-shift.md       # Night shift protocol
│   │   ├── area-selection.md    # How to pick what to work on
│   │   ├── self-improvement.md  # How the KB improves itself
│   │   └── exploration.md       # Exploring new domains/techniques
│   │
│   └── delivery-formats/        # How to present output
│       ├── client-report.md     # Reporting for clients
│       ├── internal-report.md   # Reporting for Robin
│       ├── technical-spec.md    # Writing specs
│       └── proposal.md          # Writing proposals/pitches
│
├── components/                  # LAYER 3: Build With
│   ├── _index.md                # Auto-maintained component index
│   ├── _compatibility.md        # What works with what
│   │
│   ├── cms-models/              # Complete starting points
│   │   ├── nextjs-headless/
│   │   │   ├── SPEC.md          # Architecture, decisions, trade-offs
│   │   │   ├── SETUP.md         # Step-by-step scaffolding
│   │   │   ├── config/          # Default configs
│   │   │   └── src/             # Starter source
│   │   ├── astro-static/
│   │   │   ├── SPEC.md
│   │   │   ├── SETUP.md
│   │   │   └── ...
│   │   └── wordpress-starter/
│   │       ├── SPEC.md
│   │       └── ...
│   │
│   ├── modules/                 # Reusable building blocks
│   │   ├── auth/
│   │   │   ├── SPEC.md          # What it does, API, integration
│   │   │   ├── variants/        # Per-CMS implementations
│   │   │   └── tests/           # Verified test cases
│   │   ├── seo-foundation/
│   │   │   ├── SPEC.md
│   │   │   ├── meta-tags.md
│   │   │   ├── sitemap.md
│   │   │   ├── robots.md
│   │   │   ├── structured-data.md
│   │   │   └── variants/
│   │   ├── analytics/
│   │   ├── checkout/
│   │   ├── contact-forms/
│   │   ├── image-optimization/
│   │   ├── i18n/
│   │   └── ci-cd/
│   │
│   ├── ui-kits/                 # Design system foundations
│   │   ├── tailwind-base/
│   │   │   ├── SPEC.md
│   │   │   ├── tokens.css
│   │   │   └── components/
│   │   └── shadcn-base/
│   │       ├── SPEC.md
│   │       └── components/
│   │
│   └── infrastructure/          # Deploy & hosting patterns
│       ├── vercel-setup/
│       ├── cloudflare-setup/
│       └── docker-compose/
│
├── _templates/                  # Format templates (used by skills)
│   ├── cheat-sheet.md           # Dense reference card format
│   ├── reference-article.md     # In-depth knowledge article
│   ├── comparison-table.md      # Cross-tool/cross-approach comparison
│   ├── method-guide.md          # Step-by-step procedural guide
│   ├── quality-gate.md          # Checklist-based gate
│   ├── component-spec.md        # Component specification
│   ├── report.md                # Multi-section analytical report
│   └── index.md                 # Auto-maintained index template
│
├── _system/                     # Meta & maintenance
│   ├── compilation-log.md       # What the LLM last compiled/changed
│   ├── health-report.md         # Latest linting results
│   ├── coverage-map.md          # Which areas are strong/thin/missing
│   ├── evolution-queue.md       # Prioritized list: what to develop next
│   ├── changelog.md             # Version history of the KB
│   └── stats.md                 # Article counts, coverage %, freshness
│
└── raw/                         # Unprocessed source material
    ├── articles/                # Web clips, saved articles
    ├── papers/                  # Research papers
    ├── repos/                   # Code examples, reference repos
    ├── screenshots/             # Visual references
    └── transcripts/             # Video/podcast transcripts
```

---

## 4. Article Formats

Every article in the KB uses one of these formats. The format is declared in frontmatter (`format:` field) and enforced by the corresponding template in `_templates/`.

### 4.1 Cheat Sheet (`cheat-sheet`)

Inspired by: CNN Cheat Sheet, Data Cleaning Cheat Sheet, Data Analysis Functions.

Dense, scannable, task-oriented. For knowledge that agents and humans need to reference quickly during work.

**When to use:** Domain knowledge that maps operations, patterns, or techniques in a scannable format.

```markdown
---
title: "Technical SEO"
format: cheat-sheet
layer: domain
category: seo
status: confirmed         # draft | review | confirmed | outdated
confidence: high          # low | medium | high
last_verified: 2026-04-09
tags: [seo, technical, crawling, indexing, performance]
cross_refs: [core-web-vitals, structured-data, nextjs-architecture]
---

# Technical SEO

> One-line: What this covers and when to reference it.

## Section 1: Crawling & Indexing

| Concept | What It Does | Implementation | Common Mistakes |
|---------|-------------|----------------|-----------------|
| robots.txt | Controls crawler access | See component: seo-foundation/robots | Blocking CSS/JS |
| XML Sitemap | Declares indexable URLs | See component: seo-foundation/sitemap | Including noindex pages |
| Canonical tags | Resolves duplicate content | `<link rel="canonical">` | Self-referencing errors |

## Section 2: Page Speed

| Metric | Target | How to Measure | How to Fix |
|--------|--------|---------------|------------|
| LCP | < 2.5s | Lighthouse, CrUX | Image optimization, preload |
| FID/INP | < 200ms | CrUX, Web Vitals JS | Code splitting, defer JS |
| CLS | < 0.1 | Lighthouse | Explicit dimensions, font-display |

## Quick Reference

`thing → result` one-liner patterns for rapid use.

## Related

- [[core-web-vitals]] — Deep dive on each metric
- [[nextjs-architecture]] — Framework-specific implementation
- Component: [[seo-foundation]] — Ready-to-use module
```

**Key traits:**
- Tables over prose
- `Concept | What | How | Pitfalls` columns
- Cross-references to other KB articles and components
- Status and confidence tracking
- Quick-reference section for the most common lookups

---

### 4.2 Reference Article (`reference-article`)

In-depth knowledge article for topics that need explanation, context, and nuance beyond what fits in a cheat sheet.

**When to use:** Domain knowledge that requires understanding, not just lookup.

```markdown
---
title: "Context Engineering for Agentic Systems"
format: reference-article
layer: domain
category: ai-and-agents
status: confirmed
confidence: high
last_verified: 2026-04-09
tags: [context, agents, architecture, prompting]
cross_refs: [agentic-architecture, prompt-engineering]
sources:
  - url: "https://example.com/article"
    title: "Source Title"
    date: 2026-03-15
    reliability: high
---

# Context Engineering for Agentic Systems

> One-line summary.

## Core Concept

2-3 paragraphs explaining the fundamental idea.

## Key Principles

1. **Principle name** — Explanation with concrete example.
2. **Principle name** — Explanation with concrete example.

## Patterns

### Pattern: [Name]

**When:** Conditions where this applies.
**How:** Implementation approach.
**Example:** Concrete code or configuration.
**Pitfalls:** What goes wrong.

## Decision Framework

When choosing between approaches:

| If you need... | Use... | Because... |
|---------------|--------|------------|
| Scenario A | Approach X | Reason |
| Scenario B | Approach Y | Reason |

## Open Questions

- Things we don't know yet or need to verify
- Areas where the knowledge is thin

## Sources & Evidence

- Source citations with reliability markers
```

---

### 4.3 Comparison Table (`comparison-table`)

Inspired by: Data Analysis Functions (Python vs Excel vs SQL vs Power BI).

Cross-referencing the same operation across multiple tools, frameworks, or approaches.

**When to use:** When the same task can be done multiple ways and the agent (or human) needs to pick the right one for context.

```markdown
---
title: "Authentication Patterns: Next.js vs Astro vs WordPress"
format: comparison-table
layer: domain
category: web-development/backend
status: confirmed
confidence: high
last_verified: 2026-04-09
tags: [auth, nextjs, astro, wordpress, comparison]
cross_refs: [auth-patterns, nextjs-architecture, astro-static]
---

# Authentication Patterns

> Same operation, different stacks. Pick the row you need, read across.

## Session Management

| Operation | Next.js (App Router) | Astro | WordPress |
|-----------|---------------------|-------|-----------|
| Session creation | `iron-session` or `next-auth` | `astro-auth` | Native `wp_set_auth_cookie()` |
| Session storage | Encrypted cookie | Cookie or DB | DB (`wp_sessions`) |
| Session validation | Middleware `middleware.ts` | `Astro.locals` | `wp_validate_auth_cookie()` |
| Logout | Delete cookie + redirect | Clear session + redirect | `wp_logout()` |

## OAuth Providers

| Provider | Next.js | Astro | WordPress |
|----------|---------|-------|-----------|
| Google | `next-auth/providers/google` | `auth-astro` | Plugin: Social Login |
| GitHub | `next-auth/providers/github` | `auth-astro` | Plugin: Social Login |

## When to Choose What

| If... | Choose... | Because... |
|-------|-----------|------------|
| SaaS with complex auth | Next.js + NextAuth | Most mature, most providers |
| Marketing site with gated content | Astro + simple auth | Lightweight, static-first |
| Client-managed content | WordPress | Clients know the admin |
```

---

### 4.4 Method Guide (`method-guide`)

Step-by-step procedural knowledge. This is Layer 2 content.

**When to use:** Defining how an agent (or human) should approach a category of work from start to finish.

```markdown
---
title: "Project Intake & Scoping"
format: method-guide
layer: methods
category: project-lifecycle
status: confirmed
confidence: high
last_verified: 2026-04-09
tags: [intake, scoping, client, project-start]
prerequisites: []
outputs: [project-brief, architecture-decision, timeline-estimate]
quality_gate: none  # or reference to a quality gate article
---

# Project Intake & Scoping

> Transforms a client request into a concrete project definition.

## Purpose

Why this method exists and what it prevents (scope creep, wrong tech choices, etc.)

## When to Use

- New client project
- Major feature addition to existing project
- Rebuild/migration

## Prerequisites

What must be true or available before starting.

## Process

### Step 1: Gather Requirements

**Action:** [What to do]
**Inputs:** [What you need]
**Outputs:** [What this step produces]
**Decision point:** [What determines the next step]

### Step 2: Classify Project Type

| Type | Characteristics | Default CMS Model | Default Timeline |
|------|----------------|-------------------|-----------------|
| Marketing site | Brochure, SEO-focused | Astro or Next.js | 2-4 weeks |
| E-commerce | Product catalog, checkout | Next.js + Shopify | 4-8 weeks |
| Web app | User accounts, dynamic data | Next.js | 6-12 weeks |
| Landing page | Single page, conversion | Astro | 1 week |

### Step 3: Define Scope Boundary

**The 90/95 split:**
- List what comes from Component KB (the 90-95%)
- List what is client-specific (the 5-10%)
- Flag anything that doesn't fit either category (risk area)

### Step 4: Produce Project Brief

Template: [link to delivery-formats/proposal.md]

## Quality Checks

- [ ] Client requirements documented
- [ ] CMS model selected with rationale
- [ ] 90/95 split explicitly defined
- [ ] Timeline estimated
- [ ] Risk areas flagged

## Common Failures

| Failure | Symptom | Prevention |
|---------|---------|-----------|
| Scope creep | Features appearing mid-build | Lock scope in Step 3 |
| Wrong CMS | Rebuilding at 60% | Use decision table in Step 2 |
```

---

### 4.5 Quality Gate (`quality-gate`)

Checklist-based verification. Used at decision points in methods.

**When to use:** Defining the concrete criteria for "done" or "good enough."

```markdown
---
title: "200k Standard — Quality Floor"
format: quality-gate
layer: methods
category: quality-gates
status: confirmed
confidence: high
last_verified: 2026-04-09
tags: [quality, standard, floor, verification]
applies_to: [all-projects]
---

# 200k Standard — Quality Floor

> A web platform at this level would cost ~200k SEK to commission from a
> competent agency. Every project must meet or exceed these criteria.

## Performance

- [ ] Lighthouse Performance score >= 90
- [ ] LCP < 2.5s on 4G connection
- [ ] Total bundle size < 200KB (gzipped, initial load)
- [ ] Images: WebP/AVIF with responsive srcset
- [ ] Fonts: subset, preloaded, font-display: swap

## SEO

- [ ] Unique meta title + description per page
- [ ] Canonical tags on all pages
- [ ] XML sitemap generated and submitted
- [ ] robots.txt configured correctly
- [ ] Structured data (JSON-LD) for primary content type
- [ ] OpenGraph + Twitter Card meta tags
- [ ] Clean URL structure (no query params for content pages)
- [ ] Internal linking structure (no orphan pages)
- [ ] Mobile-first responsive design

## Security

- [ ] HTTPS enforced (HSTS header)
- [ ] Auth tokens in httpOnly cookies (not localStorage)
- [ ] CSRF protection on all forms
- [ ] Input validation on all user inputs
- [ ] Content-Security-Policy header
- [ ] No secrets in client-side code

## Accessibility

- [ ] WCAG 2.1 AA compliance
- [ ] Keyboard navigation works
- [ ] Screen reader tested (VoiceOver or NVDA)
- [ ] Color contrast ratios pass
- [ ] Alt text on all meaningful images

## Code Quality

- [ ] TypeScript strict mode
- [ ] Linting passes (zero warnings)
- [ ] Error boundaries in React components
- [ ] Loading and error states for all async operations
- [ ] No console.log in production

## Infrastructure

- [ ] CI/CD pipeline with automated tests
- [ ] Preview deployments on PRs
- [ ] Environment variables for all config
- [ ] Error monitoring configured (Sentry or equivalent)
- [ ] Analytics configured (privacy-compliant)

## Verification Method

Run the automated quality gate script:
```bash
# Future: kb-lint will verify all gates
kb quality-check --gate 200k-standard --target ./project
```
```

---

### 4.6 Component Spec (`component-spec`)

Specification for a reusable building block. This is Layer 3 content.

**When to use:** Documenting a pre-built component, module, or CMS model.

```markdown
---
title: "SEO Foundation Module"
format: component-spec
layer: components
category: modules
status: production         # draft | tested | production | deprecated
version: 1.2.0
compatible_with: [nextjs-headless, astro-static]
incompatible_with: [wordpress-starter]  # WP has its own SEO via plugin
tags: [seo, meta-tags, sitemap, robots, structured-data]
quality_gate: seo-audit
---

# SEO Foundation Module

> Drop-in SEO infrastructure. Meta tags, sitemap, robots.txt, structured data.

## What It Provides

- [x] Dynamic meta tags (title, description, OG, Twitter Card)
- [x] XML sitemap generation
- [x] robots.txt configuration
- [x] JSON-LD structured data (Article, Product, FAQ, Organization)
- [x] Canonical URL management
- [ ] Hreflang for multi-language (planned v1.3)

## Installation

```bash
# How to add this module to a project using CMS model X
```

## Configuration

```typescript
// Configuration interface with defaults
```

## API

| Export | Type | Description |
|--------|------|-------------|
| `<SEOHead>` | Component | Drop into layout, reads page metadata |
| `generateSitemap()` | Function | Call from sitemap route |
| `generateRobots()` | Function | Call from robots.txt route |
| `structuredData()` | Function | Returns JSON-LD for page type |

## Variants

| CMS Model | Implementation | Notes |
|-----------|---------------|-------|
| Next.js (App Router) | `app/layout.tsx` + `metadata` API | Uses Next.js Metadata API |
| Astro | `<head>` partial + integration | Static generation compatible |

## Testing

```bash
# How to verify this module works correctly
```

## Changelog

- v1.2.0: Added FAQ structured data type
- v1.1.0: Added Twitter Card support
- v1.0.0: Initial release (meta tags, sitemap, robots)
```

---

### 4.7 Report (`report`)

Inspired by: DAIR Papers Observatory. Multi-section analytical output.

**When to use:** Presenting findings, analysis, audits, or research results. Both as deliverable to clients and as internal documentation.

```markdown
---
title: "SEO Audit: [Client/Project Name]"
format: report
layer: methods           # Reports follow a method, but are generated output
category: delivery-formats
status: final            # draft | review | final
date: 2026-04-09
author: agent            # agent | robin | both
tags: [audit, seo, report]
---

# SEO Audit: [Client/Project Name]

## Executive Summary

3-5 sentences. Overall score, critical findings, top recommendation.

## Scores at a Glance

| Area | Score | Status | Priority |
|------|-------|--------|----------|
| Technical SEO | 72/100 | Needs work | High |
| Content | 85/100 | Good | Medium |
| Performance | 45/100 | Critical | Urgent |
| Backlinks | 60/100 | Fair | Medium |

## Critical Findings

### Finding 1: [Title]

**Impact:** High / Medium / Low
**Current state:** What's wrong.
**Evidence:** Data or screenshots.
**Recommendation:** What to do.
**Component:** [[seo-foundation]] can fix this.

## Detailed Analysis

### Technical SEO
[Deep analysis per area]

### Content
[Deep analysis per area]

## Action Plan

| Priority | Action | Effort | Impact | Component |
|----------|--------|--------|--------|-----------|
| 1 | Fix Core Web Vitals | 2 days | High | [[image-optimization]] |
| 2 | Add structured data | 1 day | Medium | [[seo-foundation]] |

## Methodology

What methods and tools were used for this audit.
```

---

### 4.8 Index (`index`)

Inspired by: Career Pipeline TUI, DAIR Observatory overview.

Auto-maintained by LLM. Provides navigable overview of a category or the entire KB.

**When to use:** Auto-generated at every directory level. Never manually written.

```markdown
---
title: "Domain Knowledge Index"
format: index
auto_maintained: true
last_compiled: 2026-04-09T14:30:00Z
---

# Domain Knowledge

> 24 articles across 6 categories | 18 confirmed, 4 in review, 2 draft

## Coverage

| Category | Articles | Confirmed | Confidence | Last Updated |
|----------|----------|-----------|------------|-------------|
| SEO | 6 | 5/6 | High | 2026-04-08 |
| Web Development | 10 | 8/10 | High | 2026-04-07 |
| Digital Marketing | 4 | 3/4 | Medium | 2026-04-01 |
| Design | 2 | 1/2 | Medium | 2026-03-28 |
| AI & Agents | 3 | 2/3 | High | 2026-04-09 |
| Business | 2 | 1/2 | Low | 2026-03-15 |

## Recent Changes

- 2026-04-09: Updated [[context-engineering]] with new patterns
- 2026-04-08: Added [[local-seo]] (draft)
- 2026-04-07: [[react-patterns]] promoted to confirmed

## Thin Areas (needs development)

- Design: Only 2 articles, low coverage
- Business: Pricing models needs verification
- Digital Marketing: Missing social media strategy

## Cross-Layer References

Most-referenced by Method KB: [[technical-seo]], [[react-patterns]]
Most-referenced by Component KB: [[auth-patterns]], [[structured-data]]
```

---

## 5. Metadata Schema

Every article uses YAML frontmatter with these fields:

### Required Fields (all articles)

```yaml
title: string              # Human-readable title
format: enum               # cheat-sheet | reference-article | comparison-table |
                           # method-guide | quality-gate | component-spec |
                           # report | index
layer: enum                # domain | methods | components
category: string           # Directory path relative to layer (e.g., "seo", "project-lifecycle")
status: enum               # draft | review | confirmed | production | outdated | deprecated
tags: [string]             # Searchable tags
```

### Recommended Fields

```yaml
confidence: enum           # low | medium | high (how sure are we this is correct)
last_verified: date        # When this was last checked for accuracy
cross_refs: [string]       # Links to other KB articles (by slug)
```

### Format-Specific Fields

```yaml
# For reference-article
sources: [{url, title, date, reliability}]

# For method-guide
prerequisites: [string]
outputs: [string]
quality_gate: string       # Reference to quality gate article

# For component-spec
version: semver
compatible_with: [string]
incompatible_with: [string]

# For report
date: date
author: enum               # agent | robin | both

# For index
auto_maintained: boolean
last_compiled: datetime
```

---

## 6. Naming Conventions

### Files

- Lowercase, hyphenated: `technical-seo.md`, `core-web-vitals.md`
- Index files always: `_index.md` (underscore prefix = auto-maintained)
- Assets in `assets/` subdirectory per category
- Component source in `src/` subdirectory

### Directories

- Lowercase, hyphenated: `web-development/`, `project-lifecycle/`
- Method guides numbered when sequential: `01-intake.md`, `02-architecture.md`
- Component variants in `variants/` subdirectory

### Cross-References

- Use double-bracket wiki links: `[[article-slug]]`
- For cross-layer references: `[[layer:category/article]]`
- For component references: `Component: [[module-name]]`

### Slugs

- Derived from filename without extension: `technical-seo.md` → `technical-seo`
- Globally unique within a layer
- Used in frontmatter `cross_refs` and wiki links

---

## 7. Layer Relationships

### Domain → Methods

Domain knowledge informs method design:
- `domain/seo/technical-seo.md` is referenced by `methods/quality-gates/seo-audit.md`
- When domain knowledge changes, affected methods must be reviewed

### Methods → Components

Methods govern how components are selected and assembled:
- `methods/project-lifecycle/02-architecture.md` references `components/cms-models/*`
- Quality gates verify component output: `methods/quality-gates/200k-standard.md` checks against component specs

### Components → Domain (feedback loop)

Component usage generates new domain knowledge:
- Building with `components/modules/auth/` reveals patterns → new entry in `domain/web-development/auth-patterns.md`
- Production issues become documented pitfalls

### Cross-Reference Integrity

The `_system/health-report.md` tracks:
- Broken cross-references (article references non-existent article)
- Stale references (referenced article is `outdated` or `deprecated`)
- Orphan articles (no incoming references)
- Coverage gaps (categories with < 3 articles)

---

## 8. Compilation Pipeline

How raw material becomes structured KB articles.

```
raw/                    ──── Ingest ────▶  Triage
  articles/                                  │
  papers/                                    ▼
  repos/                              Classify & Route
  screenshots/                               │
  transcripts/                    ┌──────────┼──────────┐
                                  ▼          ▼          ▼
                              Domain     Methods    Components
                                  │          │          │
                                  ▼          ▼          ▼
                              Format     Format     Format
                            (template)  (template)  (template)
                                  │          │          │
                                  ▼          ▼          ▼
                              Review     Review     Review
                            (LLM lint)  (LLM lint)  (LLM lint)
                                  │          │          │
                                  ▼          ▼          ▼
                              Index      Index      Index
                            (auto)      (auto)     (auto)
```

### Ingest Methods

| Source | Tool | Output |
|--------|------|--------|
| Web article | Obsidian Web Clipper / deep-fetch | `raw/articles/*.md` |
| Video/podcast | deep-fetch (transcript) | `raw/transcripts/*.md` |
| Research paper | heavy-file-ingestion | `raw/papers/*.md` |
| Code repo | Firecrawl / manual | `raw/repos/*.md` |
| Screenshot | Deep-fetch / manual | `raw/screenshots/*.png` |

### Compilation Steps

1. **Triage:** LLM reads raw material, determines which layer and category it belongs to
2. **Extract:** Pull out the knowledge (facts, patterns, methods, code)
3. **Format:** Apply the correct template from `_templates/`
4. **Cross-reference:** Find and add links to related existing articles
5. **Index:** Update all affected `_index.md` files
6. **Log:** Record what was compiled in `_system/compilation-log.md`

---

## 9. Agent Integration

### How Agents Use the KB

```
Agent receives task
      │
      ▼
  Classify task type
      │
      ├── Build project ──▶ Read: methods/project-lifecycle/*
      │                      Read: components/_compatibility.md
      │                      Select: CMS model + modules
      │                      Verify: methods/quality-gates/200k-standard.md
      │
      ├── Research ──▶ Read: methods/research-protocols/*
      │                Read: domain/[relevant-category]/*
      │                Output → raw/ for compilation
      │
      ├── Audit ──▶ Read: methods/quality-gates/*
      │             Read: domain/[relevant-category]/*
      │             Output: report format
      │
      └── Night shift (no task) ──▶ Read: methods/autonomous-work/night-shift.md
                                     Read: _system/evolution-queue.md
                                     Read: _system/coverage-map.md
                                     Select area → work → output → compile
```

### Context Injection

When an agent starts a task, the KB injects relevant context:

1. **Always loaded:** `_system/coverage-map.md` (so agent knows KB state)
2. **Per task type:** Relevant method guide
3. **Per domain:** Relevant domain articles (cheat sheets first, reference articles if needed)
4. **Per build:** Compatible components + quality gate

This is **not** full-text RAG. It is structured retrieval based on task classification → layer → category → format priority.

---

## 10. Skills That Enforce Structure

Three skills maintain the KB:

### `kb-compiler`

Compiles raw material into structured KB articles.

**Trigger:** New file in `raw/`, or user says "compile this into the KB"
**Process:** Triage → Extract → Format → Cross-reference → Index
**Output:** New article in correct location with correct format

### `kb-linter`

Health checks and quality assurance for the KB itself.

**Trigger:** Scheduled (nightly), or user says "lint the KB" / "health check"
**Process:**
- Check cross-reference integrity
- Find inconsistent data across articles
- Detect outdated articles (last_verified > 30 days old)
- Identify coverage gaps
- Suggest new connections between articles
- Impute missing data via web search
**Output:** Updated `_system/health-report.md`

### `kb-gate`

Injects KB context into agent workflows and verifies output against quality gates.

**Trigger:** Agent starts a project or reaches a quality checkpoint
**Process:**
- Classify the task
- Retrieve relevant domain knowledge, methods, and components
- Inject as context
- At completion: verify against applicable quality gate
**Output:** Pass/fail with specific criteria results

---

## 11. Integration Points

### Obsidian

- KB root is an Obsidian vault
- Wiki links (`[[article]]`) work natively in Obsidian graph view
- `_index.md` files are Obsidian-native navigation
- Marp plugin for slide rendering
- Dataview plugin for dynamic queries across articles
- Canvas plugin for visual KB maps

### OpenClaw / Supabase

- Article metadata synced to `thoughts` table for cross-device retrieval
- pgvector embeddings for semantic search across articles
- `skill_registry` entries for kb-compiler, kb-linter, kb-gate

### OB1 Skills System

- KB skills (`kb-compiler`, `kb-linter`, `kb-gate`) follow OB1 skill format
- KB articles can reference OB1 skills and vice versa
- Component specs can bundle OB1 skills

### Agent Night Shifts

- `methods/autonomous-work/night-shift.md` defines the protocol
- `_system/evolution-queue.md` provides the work backlog
- `_system/coverage-map.md` shows where knowledge is thin
- Agent selects area, works, outputs to `raw/`, compiles into KB

---

## 12. Evolution Model

The KB is never "done." It evolves through four mechanisms:

### Compilation (adding knowledge)
- New raw material → compiled into articles
- Project outcomes → lessons learned → new domain/method entries

### Linting (maintaining quality)
- Nightly health checks find rot, gaps, contradictions
- Outdated articles flagged for review or retirement

### Verification (confirming truth)
- Articles start as `draft`, move through `review` to `confirmed`
- `confirmed` articles are re-verified periodically (freshness tracking)
- `outdated` articles are either updated or `deprecated`

### Expansion (growing coverage)
- Coverage map identifies thin areas
- Evolution queue prioritizes what to develop next
- Night shifts and research sessions fill gaps
- Each client project potentially adds new domain knowledge and component improvements

### Maturity Levels

| Level | State | Characteristics |
|-------|-------|----------------|
| 0 | Skeleton | Directory structure exists, templates defined, < 10 articles |
| 1 | Foundation | Core domain articles confirmed, primary methods written, 1 CMS model |
| 2 | Operational | Quality gates enforced, agents use KB for project delivery |
| 3 | Self-improving | KB-linter runs nightly, evolution queue drives development |
| 4 | Production factory | 90-95% reuse achieved, consistent "200k standard" output |

Current target: **Level 0 → Level 1** (foundation building).
