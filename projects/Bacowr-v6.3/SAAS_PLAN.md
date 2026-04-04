# BACOWR SaaS Commercialization Plan

> Version 1.0 — 2026-04-04
> Target: bacowr.com — Bulk SEO backlink article generation as a service

---

## 1. Product Definition

### What Customers Get

Bacowr is a backlink content generation service. Customers upload a CSV of jobs (publisher domain, target URL, anchor text) and receive SERP-researched, QA-verified SEO articles with embedded anchor links and trust sources. Every article passes an automated 11-check quality gate before delivery.

The pipeline behind the product:
1. Publisher profiling (domain heuristics, topic detection)
2. Target page fingerprinting (title, meta, keywords)
3. Semantic bridge calculation (cosine similarity, bridging strategy)
4. 5-step SERP research (Google intent analysis, entity mapping)
5. Trust link discovery and ranking
6. Blueprint generation (topic, thesis, section plan, constraints)
7. AI article writing (750-900 words, strict editorial rules)
8. 11-check QA gate (word count, anchor position, trust links, AI-smell detection, language, SERP entity coverage, paragraph structure)

### What Makes This Different

| Competitor Approach | Bacowr Approach |
|---|---|
| Generic AI article, customer adds links | SERP-researched article built around the link strategy |
| No publisher awareness | Publisher profiling determines what can be written |
| Anchor dropped anywhere | Anchor placed at word 250-550, in SERP-entity-rich context |
| No trust links | 1-2 trust links that semantically bridge publisher to target |
| AI-smell phrases everywhere | 15+ forbidden AI patterns, editorial overlay enforces human tone |
| No quality gate | 11-check automated QA — fails get revised, not shipped |
| Same template for every link | Semantic distance analysis adapts strategy per publisher-target pair |

**One-liner:** "The only backlink content service that reverse-engineers Google's understanding of your target page before writing a single word."

### Pricing Model

Per-article pricing with volume tiers. Not subscription-based at launch — customers buy article packs.

| Tier | Price per Article | Included Articles | Monthly Cap | Notes |
|---|---|---|---|---|
| **Trial** | Free | 3 articles | 3 total (lifetime) | No credit card required. Full QA. Watermark on articles. |
| **Starter** | 99 SEK (~$9) | Pay-as-you-go | 50/month | Single CSV upload. Email delivery. |
| **Pro** | 79 SEK (~$7.50) | 100-article packs | 500/month | Priority queue. Dashboard access. Bulk CSV. API access. |
| **Agency** | 59 SEK (~$5.50) | 500-article packs | 2,000/month | Dedicated queue. White-label option. Webhook delivery. Custom trust-link rules. |

Why per-article and not subscription: Backlink content is project-based. Agencies buy 200 articles for a campaign, not X/month forever. Per-article pricing matches how they buy. Packs give volume discount without monthly commitment.

### Revenue Projections (Conservative)

| Month | Articles Sold | Revenue (SEK) | Revenue (USD) |
|---|---|---|---|
| 1-2 (launch) | 50 | 4,950 | ~$470 |
| 3-4 | 200 | 15,800 | ~$1,500 |
| 5-6 | 500 | 39,500 | ~$3,750 |
| 7-12 | 1,000/mo | 79,000/mo | ~$7,500/mo |

---

## 2. Technical Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  bacowr.com (Next.js on Vercel)                                  │
│  Landing page, Auth, Dashboard, Job submission, Article viewer   │
└────────────────────────────┬─────────────────────────────────────┘
                             │ Supabase JS client
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Supabase (shared with OB1)                                      │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  PostgreSQL      │  │  Auth         │  │  Edge Functions    │  │
│  │  - users/auth    │  │  - Email/pass │  │  - bacowr-jobs     │  │
│  │  - subscriptions │  │  - OAuth      │  │  - bacowr-webhook  │  │
│  │  - jobs          │  │  - RLS        │  │  - bacowr-stripe   │  │
│  │  - articles      │  │              │  │                    │  │
│  │  - usage         │  │              │  │                    │  │
│  └─────────────────┘  └──────────────┘  └────────────────────┘  │
└────────────────────────────┬─────────────────────────────────────┘
                             │ Job queue (Supabase Realtime)
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Worker Service (DigitalOcean Droplet — $6/mo)                   │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │  Bacowr API Wrapper (FastAPI)                                ││
│  │  - Polls Supabase for pending jobs                           ││
│  │  - Runs Bacowr v6.3 pipeline per job                         ││
│  │  - Calls Anthropic API for SERP search + article writing     ││
│  │  - Uploads completed articles to Supabase Storage            ││
│  │  - Updates job status via Supabase client                    ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Stripe                                                          │
│  - Article pack purchases (Checkout Sessions)                    │
│  - Webhook → Supabase Edge Function → credit user's account     │
└──────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

#### Frontend: Next.js on Vercel (free tier)

The existing OB1 dashboard (Next.js 14, Tailwind, Supabase JS, Recharts) provides the template. Bacowr gets its own Next.js app deployed to Vercel at bacowr.com.

Stack: Next.js 14, TypeScript, Tailwind CSS, @supabase/supabase-js, Stripe.js, Recharts (usage charts).

Vercel free tier: 100GB bandwidth, serverless functions, edge network. More than enough for launch.

#### Backend: Supabase (free tier, shared instance)

The existing OB1 Supabase instance has capacity. Bacowr tables live in a `bacowr` schema to keep them separated from OB1's `public` schema.

- **Auth**: Supabase Auth handles signup/login (email + Google OAuth). RLS policies restrict data to the owning user.
- **Database**: PostgreSQL tables for jobs, articles, subscriptions, usage.
- **Storage**: Supabase Storage buckets for generated articles (markdown + rendered HTML).
- **Realtime**: Supabase Realtime subscriptions let the dashboard show live job progress.
- **Edge Functions**: 3 new functions for job management, Stripe webhooks, and job status notifications.

Free tier limits: 500MB database, 1GB storage, 50K auth users, 500K Edge Function invocations/month. All well within launch requirements.

#### Worker: DigitalOcean Droplet ($6/mo, covered by $200 credit)

The Bacowr Python pipeline runs on a DigitalOcean droplet. This is the core compute engine.

- **OS**: Ubuntu 22.04, 1 vCPU, 1GB RAM ($6/mo)
- **Python 3.11**: Runs the Bacowr pipeline (pipeline.py, engine.py, models.py, article_validator.py)
- **FastAPI**: Thin wrapper exposing the pipeline as internal endpoints + job queue polling
- **Supervisor**: Process manager keeps the worker running, auto-restarts on crash
- **Concurrency**: 2-3 jobs in parallel (each job takes 60-90 seconds, limited by API calls)

$200 DigitalOcean credit = 33 months of runtime at $6/mo. No hosting cost for nearly 3 years.

#### Payments: Stripe (Student Pack — waived fees on first $1K)

Stripe Checkout Sessions for article pack purchases. No subscription billing at launch — simpler implementation, lower Stripe fees.

Flow:
1. User clicks "Buy 100 Articles" on pricing page
2. Next.js creates Stripe Checkout Session via API route
3. User completes payment on Stripe's hosted checkout
4. Stripe fires webhook to Supabase Edge Function
5. Edge Function credits user's account with purchased articles
6. Dashboard reflects new balance

### Wrapping the Python Engine as an API Service

The existing Bacowr pipeline is a pure Python library — no web server, no API. The SaaS wrapper needs to:

1. **Accept jobs from Supabase** (poll or Realtime subscription)
2. **Run the 8-phase pipeline** for each job
3. **Handle the agent-dependent phases** (3, 5, 7) programmatically instead of via an interactive Claude session

The key architectural decision: **Phases 3, 5, and 7 currently require an AI agent to execute web searches and write articles.** In the SaaS version, the worker replaces the interactive agent with direct Anthropic API calls.

```python
# Worker pseudo-architecture

class BacovrWorker:
    """Polls Supabase for pending jobs, runs pipeline, uploads results."""

    def __init__(self):
        self.pipe = Pipeline(PipelineConfig())
        self.anthropic = Anthropic()  # Claude API client
        self.supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    async def process_job(self, job_row: dict):
        """Run full 8-phase pipeline for a single job."""

        # Phase 1-2: Pipeline preflight
        job = JobSpec(
            job_number=job_row['job_number'],
            publisher_domain=job_row['publisher_domain'],
            target_url=job_row['target_url'],
            anchor_text=job_row['anchor_text'],
        )
        preflight = await self.pipe.run_preflight(job)
        self.update_status(job_row['id'], 'preflight_complete')

        # Phase 3: Metadata acquisition via Anthropic tool_use
        metadata = await self.fetch_target_metadata(job.target_url)
        preflight.target.title = metadata['title']
        preflight.target.meta_description = metadata['description']

        # Phase 4: SERP probe generation
        analyzer = TargetIntentAnalyzer()
        plan = analyzer.build_research_plan_from_metadata(
            url=preflight.target.url,
            title=preflight.target.title,
            description=preflight.target.meta_description,
        )

        # Phase 5: SERP execution (5 web searches via Anthropic tool_use)
        for i, probe in enumerate(plan.probes):
            results = await self.search(probe.query)
            plan = analyzer.analyze_probe_results(plan, i + 1, results)

        # Trust link discovery
        tl_queries = analyzer.build_trustlink_queries(
            preflight.bridge, plan, preflight.target.title
        )
        trustlink_candidates = []
        for q in tl_queries:
            trustlink_candidates.extend(await self.search(q))

        selected_trustlinks = analyzer.select_trustlinks(
            candidates=trustlink_candidates,
            trust_topics=preflight.bridge.trust_link_topics,
            avoid_domains=preflight.bridge.trust_link_avoid,
            target_domain=extract_domain(job.target_url),
            publisher_domain=job.publisher_domain,
        )
        self.update_status(job_row['id'], 'research_complete')

        # Phase 6: Blueprint generation
        bp = create_blueprint_from_pipeline(
            job_number=job.job_number,
            publisher_domain=job.publisher_domain,
            target_url=job.target_url,
            anchor_text=job.anchor_text,
            publisher_profile=preflight.publisher,
            target_fingerprint=preflight.target,
            semantic_bridge=preflight.bridge,
        )
        bp.target.intent_profile = plan
        prompt = bp.to_agent_prompt()

        # Phase 7: Article writing via Anthropic API
        article_text = await self.write_article(prompt, selected_trustlinks)

        # Phase 8: QA validation
        qa_result = validate_article(article_text, job.anchor_text, job.target_url)
        if not qa_result.all_passed:
            # Retry with QA feedback (max 2 retries)
            article_text = await self.revise_article(article_text, qa_result)

        # Upload and deliver
        await self.upload_article(job_row['id'], article_text, qa_result)
        self.update_status(job_row['id'], 'completed')

    async def fetch_target_metadata(self, url: str) -> dict:
        """Use Anthropic API with web_search tool to fetch target metadata."""
        response = self.anthropic.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=500,
            tools=[{"type": "web_search_20250305"}],
            messages=[{
                "role": "user",
                "content": f"Fetch the meta title and meta description for: {url}. "
                           f"Return JSON: {{\"title\": \"...\", \"description\": \"...\"}}"
            }],
        )
        return parse_metadata_response(response)

    async def search(self, query: str) -> list[dict]:
        """Run a web search via Anthropic tool_use and return results."""
        response = self.anthropic.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1000,
            tools=[{"type": "web_search_20250305"}],
            messages=[{
                "role": "user",
                "content": f"Search for: {query}. Return top 5 results as JSON array "
                           f"with keys: title, description, url."
            }],
        )
        return parse_search_results(response)

    async def write_article(self, prompt: str, trustlinks: list) -> str:
        """Write the article via Anthropic API."""
        system_rules = open('SYSTEM.md').read()
        response = self.anthropic.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4000,
            system=system_rules,
            messages=[{
                "role": "user",
                "content": prompt + f"\n\nTrust links to use:\n" +
                           "\n".join(f"- [{t['title']}]({t['url']})" for t in trustlinks[:2])
            }],
        )
        return response.content[0].text
```

**Why Claude Sonnet for the worker (not Opus):** Sonnet is 5x cheaper than Opus, and the article quality is governed by the pipeline's constraints, not the model's raw ability. The blueprint prompt is so detailed that Sonnet follows it reliably. If QA fail rates exceed 15%, switch specific phases to Opus.

### Search Implementation

The pipeline requires web search in multiple phases. Two options:

**Option A: Anthropic's built-in web_search tool (recommended)**
- Claude Sonnet supports `web_search_20250305` as a built-in tool
- No additional API key needed
- Cost included in the Anthropic API call
- Simple implementation: one API, one billing relationship

**Option B: SerpAPI / Google Custom Search (fallback)**
- SerpAPI: $50/mo for 5,000 searches, or Google Custom Search free tier (100/day)
- More control over search results format
- Independent of Anthropic's tool implementation
- Use if Anthropic's web_search has reliability issues at scale

Start with Option A. Switch to Option B only if search quality or rate limits become a problem.

---

## 3. Database Schema

All tables in the `bacowr` schema. RLS enabled on all tables.

### `bacowr.customers`

Extends Supabase Auth's `auth.users`. Stores Bacowr-specific customer data.

```sql
CREATE SCHEMA IF NOT EXISTS bacowr;

CREATE TABLE bacowr.customers (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    company_name TEXT,
    stripe_customer_id TEXT UNIQUE,
    article_balance INTEGER NOT NULL DEFAULT 0,  -- prepaid articles remaining
    total_articles_purchased INTEGER NOT NULL DEFAULT 0,
    total_articles_generated INTEGER NOT NULL DEFAULT 0,
    tier TEXT NOT NULL DEFAULT 'trial' CHECK (tier IN ('trial', 'starter', 'pro', 'agency')),
    trial_articles_used INTEGER NOT NULL DEFAULT 0,
    max_trial_articles INTEGER NOT NULL DEFAULT 3,
    api_key TEXT UNIQUE,  -- for API access (Pro+ tiers)
    webhook_url TEXT,  -- for Agency tier delivery webhooks
    custom_trust_link_rules JSONB,  -- Agency tier custom rules
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: users can only see/update their own row
ALTER TABLE bacowr.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own data" ON bacowr.customers
    FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own data" ON bacowr.customers
    FOR UPDATE USING (auth.uid() = id);
```

### `bacowr.purchases`

Records of article pack purchases via Stripe.

```sql
CREATE TABLE bacowr.purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES bacowr.customers(id),
    stripe_payment_intent_id TEXT UNIQUE NOT NULL,
    stripe_checkout_session_id TEXT UNIQUE,
    pack_type TEXT NOT NULL CHECK (pack_type IN ('starter_single', 'pro_100', 'agency_500')),
    articles_count INTEGER NOT NULL,
    amount_sek INTEGER NOT NULL,  -- amount in SEK ore (smallest unit)
    amount_usd_cents INTEGER,  -- amount in USD cents
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'refunded', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bacowr.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own purchases" ON bacowr.purchases
    FOR SELECT USING (auth.uid() = customer_id);
```

### `bacowr.job_batches`

A batch is one CSV upload or manual job submission. Groups individual jobs.

```sql
CREATE TABLE bacowr.job_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES bacowr.customers(id),
    name TEXT,  -- user-provided batch name
    source TEXT NOT NULL DEFAULT 'csv' CHECK (source IN ('csv', 'manual', 'api')),
    total_jobs INTEGER NOT NULL DEFAULT 0,
    completed_jobs INTEGER NOT NULL DEFAULT 0,
    failed_jobs INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'validating', 'queued', 'processing', 'completed', 'partial', 'failed'
    )),
    csv_filename TEXT,  -- original uploaded filename
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bacowr.job_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own batches" ON bacowr.job_batches
    FOR SELECT USING (auth.uid() = customer_id);
CREATE POLICY "Users can insert own batches" ON bacowr.job_batches
    FOR INSERT WITH CHECK (auth.uid() = customer_id);
```

### `bacowr.jobs`

Individual article generation jobs. One row per article.

```sql
CREATE TABLE bacowr.jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES bacowr.job_batches(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES bacowr.customers(id),
    job_number INTEGER NOT NULL,

    -- Input (from CSV or manual entry)
    publisher_domain TEXT NOT NULL,
    target_url TEXT NOT NULL,
    anchor_text TEXT NOT NULL,

    -- Pipeline state
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'queued', 'preflight', 'research', 'blueprint',
        'writing', 'qa', 'revision', 'completed', 'failed'
    )),
    phase INTEGER NOT NULL DEFAULT 0,  -- current pipeline phase (0-8)
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 2,

    -- Pipeline outputs (stored as JSONB for debugging)
    preflight_data JSONB,  -- serialized Preflight object
    serp_data JSONB,  -- serialized TargetIntentProfile
    blueprint_data JSONB,  -- serialized ArticleBlueprint (minus prompt)
    qa_results JSONB,  -- 11-check QA results array

    -- Metadata
    language TEXT CHECK (language IN ('sv', 'en')),
    semantic_distance FLOAT,
    risk_level TEXT,
    error_message TEXT,

    -- Timing
    queued_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Cost tracking
    api_input_tokens INTEGER DEFAULT 0,
    api_output_tokens INTEGER DEFAULT 0,
    api_cost_usd_cents INTEGER DEFAULT 0,
    search_count INTEGER DEFAULT 0,

    UNIQUE (batch_id, job_number)
);

CREATE INDEX idx_jobs_status ON bacowr.jobs(status);
CREATE INDEX idx_jobs_customer ON bacowr.jobs(customer_id);
CREATE INDEX idx_jobs_batch ON bacowr.jobs(batch_id);
CREATE INDEX idx_jobs_queue ON bacowr.jobs(status, queued_at) WHERE status IN ('pending', 'queued');

ALTER TABLE bacowr.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own jobs" ON bacowr.jobs
    FOR SELECT USING (auth.uid() = customer_id);
```

### `bacowr.articles`

Generated articles. One per completed job.

```sql
CREATE TABLE bacowr.articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES bacowr.jobs(id) ON DELETE CASCADE UNIQUE,
    customer_id UUID NOT NULL REFERENCES bacowr.customers(id),

    -- Content
    markdown_content TEXT NOT NULL,
    html_content TEXT,  -- pre-rendered HTML
    word_count INTEGER NOT NULL,
    storage_path TEXT,  -- Supabase Storage path for file download

    -- Article metadata
    title TEXT NOT NULL,
    language TEXT NOT NULL,
    publisher_domain TEXT NOT NULL,
    target_url TEXT NOT NULL,
    anchor_text TEXT NOT NULL,

    -- Quality data
    qa_passed BOOLEAN NOT NULL DEFAULT false,
    qa_score INTEGER,  -- out of 11
    qa_details JSONB,
    anchor_position INTEGER,  -- word position of anchor link

    -- Trust links used
    trust_links JSONB,  -- array of {url, text, domain}

    -- SERP data used
    serp_entities JSONB,  -- entities woven into article
    topic TEXT,
    thesis TEXT,

    -- Delivery
    downloaded BOOLEAN NOT NULL DEFAULT false,
    downloaded_at TIMESTAMPTZ,
    webhook_delivered BOOLEAN DEFAULT false,
    webhook_delivered_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_articles_customer ON bacowr.articles(customer_id);
CREATE INDEX idx_articles_qa ON bacowr.articles(qa_passed);

ALTER TABLE bacowr.articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own articles" ON bacowr.articles
    FOR SELECT USING (auth.uid() = customer_id);
```

### `bacowr.usage_log`

Per-event usage tracking for billing and analytics.

```sql
CREATE TABLE bacowr.usage_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES bacowr.customers(id),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'article_generated', 'article_failed', 'credit_purchased',
        'credit_used', 'trial_used', 'api_call'
    )),
    job_id UUID REFERENCES bacowr.jobs(id),
    credits_delta INTEGER NOT NULL DEFAULT 0,  -- positive = added, negative = consumed
    balance_after INTEGER NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_customer ON bacowr.usage_log(customer_id, created_at);

ALTER TABLE bacowr.usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own usage" ON bacowr.usage_log
    FOR SELECT USING (auth.uid() = customer_id);
```

### Helper Functions

```sql
-- Dequeue next pending job for processing (worker calls this)
CREATE OR REPLACE FUNCTION bacowr.dequeue_job()
RETURNS UUID AS $$
DECLARE
    job_id UUID;
BEGIN
    UPDATE bacowr.jobs
    SET status = 'queued', queued_at = now()
    WHERE id = (
        SELECT id FROM bacowr.jobs
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING id INTO job_id;

    RETURN job_id;
END;
$$ LANGUAGE plpgsql;

-- Consume one article credit from customer balance
CREATE OR REPLACE FUNCTION bacowr.consume_credit(p_customer_id UUID, p_job_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    current_balance INTEGER;
    is_trial BOOLEAN;
    trial_used INTEGER;
    trial_max INTEGER;
BEGIN
    SELECT article_balance, tier = 'trial', trial_articles_used, max_trial_articles
    INTO current_balance, is_trial, trial_used, trial_max
    FROM bacowr.customers
    WHERE id = p_customer_id
    FOR UPDATE;

    IF is_trial THEN
        IF trial_used >= trial_max THEN
            RETURN false;
        END IF;
        UPDATE bacowr.customers
        SET trial_articles_used = trial_articles_used + 1,
            total_articles_generated = total_articles_generated + 1,
            updated_at = now()
        WHERE id = p_customer_id;
    ELSE
        IF current_balance <= 0 THEN
            RETURN false;
        END IF;
        UPDATE bacowr.customers
        SET article_balance = article_balance - 1,
            total_articles_generated = total_articles_generated + 1,
            updated_at = now()
        WHERE id = p_customer_id;
    END IF;

    INSERT INTO bacowr.usage_log (customer_id, event_type, job_id, credits_delta, balance_after)
    VALUES (p_customer_id, 'credit_used', p_job_id, -1,
            (SELECT CASE WHEN tier = 'trial' THEN max_trial_articles - trial_articles_used
                         ELSE article_balance END
             FROM bacowr.customers WHERE id = p_customer_id));

    RETURN true;
END;
$$ LANGUAGE plpgsql;
```

---

## 4. Frontend Pages

### Page Map

```
bacowr.com/                     → Landing page (marketing)
bacowr.com/pricing              → Pricing tiers + purchase buttons
bacowr.com/login                → Login (Supabase Auth)
bacowr.com/signup               → Sign up (Supabase Auth)

bacowr.com/dashboard            → Overview: usage stats, recent batches, balance
bacowr.com/dashboard/new-job    → Submit new job (CSV upload or manual form)
bacowr.com/dashboard/batches    → List of all job batches
bacowr.com/dashboard/batches/[id] → Batch detail: jobs list with status
bacowr.com/dashboard/articles/[id] → Article preview, download, copy
bacowr.com/dashboard/settings   → Account, API key, billing, webhook URL
bacowr.com/dashboard/billing    → Purchase history, Stripe portal link
```

### Page Details

#### Landing Page (`/`)

Purpose: Convert visitors to signups.

Sections:
- Hero: "SEO articles that Google actually understands" + CTA "Try 3 Articles Free"
- Problem: "Generic AI content doesn't understand your link strategy"
- How it works: 3-step visual (Upload CSV, We research + write, Download QA-verified articles)
- Before/after: Side-by-side of generic AI article vs Bacowr article
- Social proof: QA pass rate, articles generated, sample QA report
- Pricing: Tier cards with CTA buttons
- FAQ

Tech: Static page, no auth required. SSG via Next.js for fast loading.

#### Dashboard (`/dashboard`)

Purpose: At-a-glance status for active customer.

Components:
- Article balance widget (credits remaining, tier badge)
- Active batches with progress bars (real-time via Supabase Realtime)
- Usage chart (articles generated per week, Recharts)
- Quick action buttons: "New Job", "Buy More Articles", "View Batches"
- Recent articles list with QA scores

#### New Job (`/dashboard/new-job`)

Purpose: Submit article generation jobs.

Two input modes:
1. **CSV Upload**: Drag-and-drop CSV file. Client-side validation (correct columns, URL format, non-empty fields). Preview table before submission.
2. **Manual Entry**: Form with fields for publisher domain, target URL, anchor text. Add multiple rows. Useful for small batches (1-5 articles).

Pre-submission checks:
- Sufficient article balance for the batch size
- No duplicate jobs (same publisher + target + anchor)
- URL format validation
- CSV column detection (handles the flexible header names Bacowr supports)

Submit flow:
1. Create `job_batches` row
2. Create `jobs` rows (one per CSV row)
3. Consume credits via `bacowr.consume_credit()`
4. Redirect to batch detail page
5. Worker picks up jobs from queue

#### Batch Detail (`/dashboard/batches/[id]`)

Purpose: Track progress of a submitted batch.

Components:
- Batch header: name, status, submitted date, progress (X/Y completed)
- Job table: job number, publisher, target, anchor text, status badge, QA score
- Real-time status updates via Supabase Realtime subscription
- Status badges: pending (gray), research (blue), writing (yellow), QA (orange), completed (green), failed (red)
- Click any completed job to view article

#### Article View (`/dashboard/articles/[id]`)

Purpose: Preview and download a generated article.

Components:
- Rendered article in prose view (markdown → HTML via @tailwindcss/typography)
- Metadata sidebar: word count, anchor position, language, QA score, publisher, target
- QA report: 11 checks with PASS/FAIL badges
- Trust links used (with URLs)
- SERP entities woven in (tag list)
- Actions: Download as .md, Download as .html, Copy to clipboard
- If QA failed: show which checks failed and the revision status

#### Settings (`/dashboard/settings`)

Purpose: Account management.

Sections:
- Profile: display name, company name, email
- API Key: generate/regenerate (Pro+ tiers only), show usage instructions
- Webhook: configure delivery URL (Agency tier), test webhook button
- Trust link rules: custom avoid-domains list (Agency tier)
- Billing: link to Stripe Customer Portal (manage payment methods, invoices)
- Danger zone: delete account, export data

---

## 5. API Endpoints

Public API for Pro and Agency tier customers. Authenticated via API key in `Authorization: Bearer <api_key>` header.

### Submit Job Batch

```
POST /api/v1/jobs
Content-Type: application/json
Authorization: Bearer <api_key>

{
  "batch_name": "Campaign Q2 2026",
  "jobs": [
    {
      "publisher_domain": "teknikbloggen.se",
      "target_url": "https://www.example.se/tjanster/",
      "anchor_text": "exempeltjänster"
    },
    ...
  ]
}

Response 201:
{
  "batch_id": "uuid",
  "total_jobs": 5,
  "credits_consumed": 5,
  "credits_remaining": 95,
  "status": "queued",
  "estimated_completion": "2026-04-04T15:30:00Z"
}
```

### Get Batch Status

```
GET /api/v1/batches/:batch_id
Authorization: Bearer <api_key>

Response 200:
{
  "batch_id": "uuid",
  "name": "Campaign Q2 2026",
  "status": "processing",
  "total_jobs": 5,
  "completed_jobs": 3,
  "failed_jobs": 0,
  "jobs": [
    {
      "id": "uuid",
      "job_number": 1,
      "publisher_domain": "teknikbloggen.se",
      "status": "completed",
      "qa_score": 11,
      "article_id": "uuid"
    },
    ...
  ]
}
```

### Get Article

```
GET /api/v1/articles/:article_id
Authorization: Bearer <api_key>

Response 200:
{
  "id": "uuid",
  "job_id": "uuid",
  "markdown": "# Article Title\n\n...",
  "html": "<h1>Article Title</h1>...",
  "word_count": 823,
  "language": "sv",
  "qa_passed": true,
  "qa_score": 11,
  "anchor_position": 342,
  "trust_links": [
    {"url": "https://source.se/article", "text": "source reference"}
  ],
  "serp_entities": ["entity1", "entity2", "entity3", "entity4"],
  "topic": "...",
  "thesis": "...",
  "created_at": "2026-04-04T14:22:00Z"
}
```

### Get Usage

```
GET /api/v1/usage?period=30d
Authorization: Bearer <api_key>

Response 200:
{
  "period": "30d",
  "articles_generated": 47,
  "articles_failed": 2,
  "credits_purchased": 100,
  "credits_remaining": 51,
  "qa_pass_rate": 0.96,
  "avg_word_count": 812,
  "avg_qa_score": 10.8
}
```

### Download Batch Articles (ZIP)

```
GET /api/v1/batches/:batch_id/download?format=md
Authorization: Bearer <api_key>

Response 200: application/zip
(ZIP file containing all completed articles as .md files)
```

### Implementation

API routes implemented as Next.js API routes (`/app/api/v1/...`) with API key validation middleware. Each route queries Supabase with the service role key, filtered to the customer associated with the API key.

```typescript
// app/api/v1/jobs/route.ts (simplified)
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  const apiKey = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!apiKey) return Response.json({ error: 'Missing API key' }, { status: 401 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Look up customer by API key
  const { data: customer } = await supabase
    .from('bacowr.customers')
    .select('*')
    .eq('api_key', apiKey)
    .single();

  if (!customer) return Response.json({ error: 'Invalid API key' }, { status: 401 });
  if (customer.tier === 'trial' || customer.tier === 'starter') {
    return Response.json({ error: 'API access requires Pro or Agency tier' }, { status: 403 });
  }

  const body = await req.json();
  // ... validate, create batch, create jobs, consume credits
}
```

---

## 6. Cost Model

### Anthropic API Cost Per Article

The Bacowr pipeline makes multiple Anthropic API calls per article. Here is the token budget breakdown:

| Phase | API Calls | Est. Input Tokens | Est. Output Tokens | Purpose |
|---|---|---|---|---|
| 3 (Metadata) | 1 call with web_search | 500 | 300 | Fetch target page title + meta description |
| 5 (SERP) | 5 probe searches | 5 x 800 = 4,000 | 5 x 600 = 3,000 | 5 SERP research queries + result analysis |
| 5 (Trust links) | 2-3 searches | 2 x 800 = 1,600 | 2 x 500 = 1,000 | Trust link discovery |
| 7 (Writing) | 1 call | 4,000 | 2,000 | Article writing (prompt = ~3K tokens, SYSTEM.md = ~1K) |
| 7 (Revision) | 0.3 calls avg | 1,200 | 800 | QA-failure revision (~30% of articles need 1 revision) |
| **TOTAL** | **~10 calls** | **~11,300** | **~7,100** | |

Using Claude Sonnet 4 pricing (estimated):
- Input: $3.00 / 1M tokens
- Output: $15.00 / 1M tokens

**Cost per article:**
- Input: 11,300 tokens x $3.00/1M = $0.034
- Output: 7,100 tokens x $15.00/1M = $0.107
- Web search: ~8 searches x ~$0.01 per search context = $0.08 (estimated)
- **Total API cost per article: ~$0.22**

Note: Web search pricing with Anthropic's built-in tool is not yet finalized at scale. If using SerpAPI instead: $50/mo for 5,000 searches = $0.01/search, 8 searches/article = $0.08/article. Total stays similar.

### Infrastructure Cost

| Service | Monthly Cost | Notes |
|---|---|---|
| DigitalOcean droplet | $6 | Covered by $200 credit for 33 months |
| Supabase | $0 | Free tier (upgrade to $25/mo Pro at ~1,000 articles/mo) |
| Vercel | $0 | Free tier (upgrade to $20/mo Pro at high traffic) |
| Stripe | 2.9% + $0.30/tx | Waived on first $1K (Student Pack) |
| Domain (bacowr.com) | $0 | Already purchased via Namecheap (Student Pack) |
| **Total infrastructure** | **$6/mo** | **$0 for first 33 months with DO credit** |

### Margin Analysis

| Tier | Price/Article (USD) | API Cost | Infra Cost (amortized) | Gross Margin | Margin % |
|---|---|---|---|---|---|
| Starter ($9) | $9.00 | $0.22 | $0.01 | $8.77 | 97.4% |
| Pro ($7.50) | $7.50 | $0.22 | $0.01 | $7.27 | 96.9% |
| Agency ($5.50) | $5.50 | $0.22 | $0.01 | $5.27 | 95.8% |

**Even at the Agency tier, gross margin is ~96%.** The product is almost pure margin because the cost per article is dominated by API fees ($0.22) while the value delivered (SERP-researched, QA-verified article) commands $5.50-$9.00.

### Breakeven

Fixed costs: ~$6/mo infrastructure (while DO credit lasts: $0/mo).
Variable costs: $0.22/article.
At the Pro tier ($7.50/article), breakeven is 1 article per month.

### Scale Considerations

At 1,000 articles/month:
- API cost: 1,000 x $0.22 = $220/mo
- Revenue at Pro tier: 1,000 x $7.50 = $7,500/mo
- Supabase Pro upgrade: $25/mo
- Potentially need 2nd DO droplet: $12/mo
- **Net profit: ~$7,240/mo**

At 5,000 articles/month:
- API cost: $1,100/mo
- Revenue (mixed tiers): ~$32,500/mo
- Infrastructure upgrades: ~$100/mo
- **Net profit: ~$31,300/mo**

---

## 7. Launch Roadmap

### Phase 0: Foundation (Week 1-2)

Goal: Infrastructure setup, no customer-facing features yet.

- [ ] Set up Supabase `bacowr` schema (all tables from Section 3)
- [ ] Deploy Bacowr Python engine to DigitalOcean droplet
- [ ] Create FastAPI wrapper around the pipeline
- [ ] Test end-to-end: Supabase row → worker picks up → pipeline runs → article stored
- [ ] Set up Stripe account, create product + price objects for each tier
- [ ] Configure Stripe webhook endpoint (Supabase Edge Function)
- [ ] Point bacowr.com DNS to Vercel

### Phase 1: MVP (Week 3-4)

Goal: First paying customer can submit a CSV and get articles back.

**Must have:**
- [ ] Landing page with pricing
- [ ] Supabase Auth (email/password signup + login)
- [ ] Dashboard with article balance display
- [ ] CSV upload → job creation → queue
- [ ] Worker processes jobs and stores articles
- [ ] Article view with markdown rendering
- [ ] Stripe Checkout for Starter tier (single article purchase)
- [ ] Basic download (individual article as .md)

**Not included in MVP:**
- API access
- Batch download (ZIP)
- Real-time status updates
- Agency tier features (webhooks, custom rules)
- Manual entry form (CSV only)

**MVP launch criteria:**
1. Upload a 5-job CSV → all 5 articles generated within 10 minutes
2. All articles pass 11/11 QA
3. Stripe payment → credits appear in account within 30 seconds
4. Articles downloadable as .md files

### Phase 2: Self-Service v1 (Week 5-8)

Goal: Polished product for general availability.

- [ ] Real-time job status updates (Supabase Realtime)
- [ ] Manual entry form (in addition to CSV)
- [ ] Batch download as ZIP
- [ ] QA report view per article
- [ ] Usage statistics page with charts
- [ ] Pro tier with 100-article packs
- [ ] Stripe Customer Portal for billing management
- [ ] Email notifications (batch complete, article failed)
- [ ] Retry failed jobs from dashboard
- [ ] Polish landing page with sample articles and QA reports

### Phase 3: API + Scale (Week 9-12)

Goal: Programmatic access for power users. Scale infrastructure.

- [ ] REST API (all endpoints from Section 5)
- [ ] API key generation in dashboard settings
- [ ] API documentation page
- [ ] Agency tier with 500-article packs
- [ ] Webhook delivery for completed articles
- [ ] Custom trust-link avoid-domains (Agency tier)
- [ ] Worker auto-scaling (2nd droplet when queue depth > 50)
- [ ] Rate limiting and abuse prevention
- [ ] Job priority queue (Pro/Agency get priority over Starter)

### Phase 4: Growth (Month 4+)

Goal: Differentiation and retention features.

- [ ] White-label output (Agency tier): remove all Bacowr branding from articles
- [ ] Bulk re-processing: re-run jobs with updated trust links or anchor text
- [ ] Publisher profile library: save and reuse publisher profiles
- [ ] QA analytics: aggregate QA trends, common failure patterns
- [ ] Article revision request: customer can request targeted revisions
- [ ] Multi-language expansion: add more languages beyond sv/en
- [ ] Referral program: give 5 free articles for each referred customer
- [ ] Chrome extension: submit jobs from any webpage

---

## 8. Integration with OB1

### Night Runner as Job Queue Processor

The OB1 Night Runner (`theleak/implementation/runtime/src/night-runner.ts`) already implements autonomous overnight task execution with budget tracking, crash recovery, and status reporting. It can be extended to process Bacowr job queues.

**Integration approach:** Add a `bacowr_batch` task type to Night Runner.

```typescript
// Night Runner task for Bacowr batch processing
const bacowr_task: NightTask = {
  id: 'bacowr-queue-drain',
  title: 'Process pending Bacowr jobs',
  description: 'Poll bacowr.jobs for pending status, process via worker API',
  priority: 2,
  agent_type: 'bacowr_worker',
  max_turns: 100,  // enough for ~50 articles
  max_usd: 15.00,  // budget cap for overnight run
};
```

Night Runner benefits for Bacowr:
- **Budget tracking**: Shared USD budget pool prevents runaway API costs
- **Crash recovery**: Requeues orphaned "running" jobs on restart
- **Graceful shutdown**: Finishes current article before stopping
- **Morning report**: Robin gets a summary of overnight article generation with coffee

### Agent Coordinator for Parallel Processing

The OB1 Agent Coordinator (`theleak/implementation/runtime/src/coordinator.ts`) supports multi-agent wave execution. For Bacowr, this means processing multiple articles in parallel.

**Parallelism model:**
- Phases 1-2 (preflight): Already supports batch via `pipe.run_batch_preflight(jobs)` — all preflights run in parallel
- Phase 3 (metadata): Can run in parallel (independent web searches per job)
- Phases 4-6 (probes + blueprint): Can run in parallel (no shared state between jobs)
- Phase 7 (writing): Can run 2-3 articles simultaneously (limited by API rate limits)
- Phase 8 (QA): Fully parallel (local validation, no API calls)

**Throughput estimate:**
- Sequential: 1 article per 60-90 seconds = ~50 articles/hour
- 3x parallel: ~150 articles/hour
- With Night Runner (8-hour overnight run): ~1,200 articles/night

### Memory System for QA Learning

The OB1 memory system (Supabase `thoughts` table with pgvector) can store QA patterns for continuous improvement.

**What to store:**
- Articles that failed specific QA checks → pattern: "anchor position too early when publisher is betting site"
- Revision strategies that fixed failures → pattern: "expanding ESTABLISH section by 50 words reliably fixes word count failures"
- Trust link discovery strategies per vertical → pattern: "for casino/betting targets, Boverket and SCB are reliable trust link sources"
- Publisher-specific editorial notes → pattern: "fragbite.se articles should reference esport tournaments, not general gaming"

**Implementation:**

```sql
-- Store QA learning as OB1 thoughts
INSERT INTO thoughts (
    content,
    category,
    metadata,
    embedding  -- pgvector embedding for similarity search
) VALUES (
    'Bacowr QA pattern: Articles for betting publishers with casino targets frequently fail anchor position check. Root cause: the HOOK section runs long (200+ words) when the publisher has strong topical overlap. Fix: instruct blueprint to cap HOOK at 150 words for identical-category jobs.',
    'bacowr_qa_learning',
    '{"qa_check": "anchor_position", "publisher_category": "betting", "target_category": "casino", "fix_type": "section_cap"}',
    embedding('text-embedding-3-small', content)
);
```

Before generating each article, the worker queries the memory system for relevant QA learnings:

```sql
-- Find relevant QA patterns for this publisher-target combination
SELECT content, metadata
FROM thoughts
WHERE category = 'bacowr_qa_learning'
ORDER BY embedding <=> embedding('text-embedding-3-small', $publisher_domain || ' ' || $target_url)
LIMIT 5;
```

Matching patterns get injected into the blueprint prompt as additional constraints, reducing QA failure rates over time.

### Supabase Edge Functions for Bacowr

Three new Edge Functions deployed alongside the existing 7 OB1 functions:

| Function | Endpoint | Purpose |
|---|---|---|
| `bacowr-jobs` | `POST /bacowr-jobs` | Accept job submissions from frontend, validate CSV, create database rows, consume credits |
| `bacowr-stripe` | `POST /bacowr-stripe` | Handle Stripe webhook events (payment completed → credit account) |
| `bacowr-status` | `GET /bacowr-status` | Return job/batch status for real-time dashboard updates |

These follow the existing OB1 Edge Function pattern: Deno runtime, Supabase client, CORS headers, JWT validation via Supabase Auth.

---

## 9. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Anthropic API price increase | Medium | High | Track cost per article, adjust pricing with 30-day notice. Keep margins >90% to absorb increases. |
| Web search reliability (rate limits, blocks) | Medium | Medium | Fallback to SerpAPI. Cache SERP results for repeated queries. Queue retry with exponential backoff. |
| QA failure rate above 20% | Low | High | Automatic revision loop (max 2 retries). Monitor failure patterns via OB1 memory. Escalate persistent failures to manual review. |
| Competitor launches similar product | Medium | Medium | Speed to market is the moat. Bacowr's 11-check QA + semantic bridge analysis is hard to replicate. Focus on quality, not price. |
| Supabase free tier limits hit | Low (at launch) | Low | Upgrade to Supabase Pro ($25/mo) when approaching limits. The margin supports it easily. |
| Customer submits malicious CSV | Medium | Low | Server-side validation: max 500 jobs/batch, URL format checks, domain blocklist, rate limiting per customer. |
| Single droplet can't keep up | Low (at launch) | Medium | Auto-scale to 2nd droplet. Worker is stateless — just add another instance polling the same queue. |

---

## 10. Day 1 Checklist

The absolute minimum to get from "plan" to "first article sold":

1. Run the Supabase migration (create `bacowr` schema + tables)
2. Deploy Bacowr engine to DigitalOcean droplet with FastAPI wrapper
3. Create one Stripe product ("Starter — 1 Article") with Checkout Session
4. Deploy Next.js app to Vercel with: landing page, auth, dashboard, CSV upload, article view
5. Wire Stripe webhook to credit customer account
6. Test: sign up, buy 1 article, upload 1-job CSV, receive article, download it
7. Go live

Estimated time to MVP: 2 weeks of focused work.

---

*BACOWR SaaS Plan v1.0 — 2026-04-04*
*Author: Robin Westerlund + Claude Opus 4.6*
*License: Proprietary — bacowr.com*
