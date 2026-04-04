# Bacowr SaaS API Reference

Bacowr is an SEO article generation engine. The API is a single Supabase Edge Function with action-based routing.

**Endpoint:**

```
POST <SUPABASE_URL>/functions/v1/bacowr-api
```

**Authentication (dual mode):**

| Method | Header | Who can use |
|--------|--------|-------------|
| API Key | `x-api-key: <api_key>` | Pro and Agency tier customers only |
| JWT | `Authorization: Bearer <supabase_jwt>` | All authenticated customers (dashboard access) |

API keys are prefixed with `bac_` and are 52 characters long. Only Pro and Agency tier customers can use API key authentication; other tiers will receive a 403 error.

**Request body format (JSON):**

```json
{ "action": "<action-name>", ...params }
```

**Database schema:** All tables live in the `bacowr` schema (not `public`).

---

## Table of Contents

- [submit_batch](#submit_batch) -- Submit a job batch for article generation
- [get_batch](#get_batch) -- Get batch status with job details
- [list_batches](#list_batches) -- List customer batches (paginated)
- [get_job](#get_job) -- Get individual job detail
- [get_article](#get_article) -- Get generated article content
- [get_usage](#get_usage) -- Get usage statistics
- [get_profile](#get_profile) -- Get customer profile
- [regenerate_api_key](#regenerate_api_key) -- Generate a new API key

---

## submit_batch

Submit a batch of article generation jobs. Accepts either a structured JSON array or raw CSV. Validates credit balance and monthly caps before creating jobs. Deducts credits on submission.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | no | Batch display name. Default: `Untitled batch` |
| jobs | array | conditional | Array of job objects (required if `csv` not provided) |
| csv | string | conditional | Raw CSV string (required if `jobs` not provided) |

Each job object (in the `jobs` array):

| Name | Type | Required | Description |
|------|------|----------|-------------|
| publisher_domain | string | yes | Domain of the publishing site |
| target_url | string | yes | Target page URL to link to |
| anchor_text | string | yes | Anchor text for the link |

**CSV format:**

The CSV must contain a header row and at least one data row. Supports both comma (`,`) and pipe (`|`) delimiters. Column names are flexible:

| Canonical name | Also accepted |
|---------------|---------------|
| publisher_domain | publication_domain, domain, publisher |
| target_url | target_page, url, target |
| anchor_text | anchor, text, anchor_link |

Malformed URLs (e.g., `https:/example.com`) are automatically corrected.

**Limits:**

- Maximum 500 jobs per batch
- Must have sufficient credit balance
- Monthly caps by tier: trial=3, starter=50, pro=500, agency=2000

**Response (201):**

```json
{
  "batch_id": "uuid-here",
  "total_jobs": 10,
  "credits_consumed": 10,
  "credits_remaining": 40,
  "status": "queued",
  "estimated_completion": "2026-04-04T12:15:00.000Z"
}
```

Estimated completion is calculated at ~90 seconds per article with 3 concurrent workers.

**Error (402):** Insufficient credits.
**Error (429):** Monthly cap exceeded.

**Example (JSON jobs):**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/bacowr-api" \
  -H "x-api-key: bac_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "submit_batch",
    "name": "April SEO batch",
    "jobs": [
      {
        "publisher_domain": "teknikbloggen.se",
        "target_url": "https://www.example.com/services/cleaning/",
        "anchor_text": "cleaning services"
      },
      {
        "publisher_domain": "villanytt.se",
        "target_url": "https://www.example.com/products/rugs",
        "anchor_text": "rugs"
      }
    ]
  }'
```

**Example (CSV):**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/bacowr-api" \
  -H "x-api-key: bac_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "submit_batch",
    "name": "CSV batch",
    "csv": "publisher_domain,target_url,anchor_text\nteknikbloggen.se,https://www.example.com/services/cleaning/,cleaning services\nvillanytt.se,https://www.example.com/products/rugs,rugs"
  }'
```

---

## get_batch

Get batch status with all job summaries. Only returns batches owned by the authenticated customer.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| batch_id | string | yes | Batch UUID |

**Response:**

```json
{
  "batch_id": "uuid-here",
  "name": "April SEO batch",
  "status": "processing",
  "source": "api",
  "total_jobs": 10,
  "completed_jobs": 7,
  "failed_jobs": 1,
  "created_at": "2026-04-04T12:00:00.000Z",
  "started_at": "2026-04-04T12:00:05.000Z",
  "completed_at": null,
  "jobs": [
    {
      "id": "job-uuid",
      "job_number": 1,
      "publisher_domain": "teknikbloggen.se",
      "status": "completed",
      "qa_score": 10,
      "article_id": "article-uuid"
    },
    {
      "id": "job-uuid-2",
      "job_number": 2,
      "publisher_domain": "villanytt.se",
      "status": "processing",
      "qa_score": null,
      "article_id": null
    }
  ]
}
```

The `qa_score` in the job summary is the count of passed QA checks. The `article_id` is present only for completed jobs.

The `source` field indicates how the batch was submitted: `api` (via API key) or `manual` (via JWT/dashboard).

**Error (404):** Batch not found or not owned by this customer.

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/bacowr-api" \
  -H "x-api-key: bac_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_batch", "batch_id": "uuid-here"}'
```

---

## list_batches

List the authenticated customer's batches with pagination.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| status | string | no | Filter by batch status |
| limit | number | no | Max results (1-100). Default: `20` |
| offset | number | no | Pagination offset (min 0). Default: `0` |

**Response:**

```json
{
  "batches": [
    {
      "id": "uuid-here",
      "name": "April SEO batch",
      "source": "api",
      "status": "completed",
      "total_jobs": 10,
      "completed_jobs": 10,
      "failed_jobs": 0,
      "created_at": "2026-04-04T12:00:00.000Z",
      "started_at": "2026-04-04T12:00:05.000Z",
      "completed_at": "2026-04-04T12:15:00.000Z"
    }
  ],
  "total": 25,
  "limit": 20,
  "offset": 0
}
```

The `total` field reflects the total number of matching batches (for pagination).

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/bacowr-api" \
  -H "x-api-key: bac_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"action": "list_batches", "status": "completed", "limit": 10}'
```

---

## get_job

Get detailed information about an individual job. Only returns jobs owned by the authenticated customer.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| job_id | string | yes | Job UUID |

**Response:**

```json
{
  "id": "job-uuid",
  "batch_id": "batch-uuid",
  "job_number": 1,
  "publisher_domain": "teknikbloggen.se",
  "target_url": "https://www.example.com/services/cleaning/",
  "anchor_text": "cleaning services",
  "status": "completed",
  "phase": 8,
  "language": "sv",
  "semantic_distance": 0.35,
  "risk_level": "low",
  "error_message": null,
  "retry_count": 0,
  "preflight_data": { ... },
  "serp_data": { ... },
  "blueprint_data": { ... },
  "qa_results": [
    { "name": "word_count", "passed": true, "message": "850 words" },
    { "name": "anchor_position", "passed": true, "message": "Position: word 320" }
  ],
  "api_cost_usd_cents": 12,
  "created_at": "2026-04-04T12:00:00.000Z",
  "queued_at": "2026-04-04T12:00:05.000Z",
  "started_at": "2026-04-04T12:00:10.000Z",
  "completed_at": "2026-04-04T12:01:30.000Z"
}
```

**Error (404):** Job not found or not owned by this customer.

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/bacowr-api" \
  -H "x-api-key: bac_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_job", "job_id": "job-uuid-here"}'
```

---

## get_article

Get the generated article content. Supports lookup by either `article_id` or `job_id`. Only returns articles owned by the authenticated customer.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| article_id | string | conditional | Article UUID (required if `job_id` not provided) |
| job_id | string | conditional | Job UUID (required if `article_id` not provided) |

**Response:**

```json
{
  "id": "article-uuid",
  "job_id": "job-uuid",
  "title": "The Complete Guide to Professional Cleaning Services",
  "markdown": "# The Complete Guide to...\n\n...",
  "html": "<h1>The Complete Guide to...</h1><p>...</p>",
  "word_count": 850,
  "language": "sv",
  "publisher_domain": "teknikbloggen.se",
  "target_url": "https://www.example.com/services/cleaning/",
  "anchor_text": "cleaning services",
  "qa_passed": true,
  "qa_score": 11,
  "qa_details": { ... },
  "anchor_position": 320,
  "trust_links": [
    { "url": "https://trusted-source.com/article", "anchor": "research shows" }
  ],
  "serp_entities": ["professional cleaning", "indoor air quality"],
  "topic": "Professional cleaning industry trends",
  "thesis": "Professional cleaning services have evolved beyond basic maintenance...",
  "created_at": "2026-04-04T12:01:30.000Z"
}
```

**Error (404):** Article not found or not owned by this customer.

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/bacowr-api" \
  -H "x-api-key: bac_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_article", "job_id": "job-uuid-here"}'
```

---

## get_usage

Get usage statistics for the authenticated customer.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| period | string | no | Time period: `current` (current calendar month) or `all` (all time). Default: `current` |

**Response:**

```json
{
  "period": "current",
  "articles_generated": 45,
  "articles_failed": 2,
  "credits_purchased": 50,
  "credits_remaining": 3,
  "qa_pass_rate": 0.956,
  "avg_word_count": 825,
  "avg_qa_score": 10.2,
  "api_cost_usd_cents": 540
}
```

Field details:
- `articles_generated`: Count of jobs with status `completed` in the period
- `articles_failed`: Count of jobs with status `failed` in the period
- `credits_purchased`: Sum of `articles_count` from completed purchases in the period
- `credits_remaining`: Current balance (trial: max_trial_articles - trial_articles_used; paid: article_balance)
- `qa_pass_rate`: Fraction of articles that passed QA (null if no articles)
- `avg_word_count`: Average word count of generated articles (null if no articles)
- `avg_qa_score`: Average QA score across articles (null if no articles)
- `api_cost_usd_cents`: Total API cost in USD cents for jobs in the period

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/bacowr-api" \
  -H "x-api-key: bac_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_usage", "period": "all"}'
```

---

## get_profile

Get the authenticated customer's profile and account details.

**Parameters:** None.

**Response:**

```json
{
  "id": "customer-uuid",
  "display_name": "Robin Westerlund",
  "company_name": "Acme SEO AB",
  "tier": "pro",
  "credits_remaining": 42,
  "total_articles_purchased": 200,
  "total_articles_generated": 158,
  "has_api_key": true,
  "webhook_url": "https://hooks.example.com/bacowr",
  "custom_trust_link_rules": { ... },
  "created_at": "2026-01-15T10:00:00.000Z",
  "updated_at": "2026-04-04T12:00:00.000Z"
}
```

Field details:
- `tier`: Customer tier -- `trial`, `starter`, `pro`, or `agency`
- `credits_remaining`: Computed from balance (trial: max_trial_articles - trial_articles_used; paid: article_balance)
- `has_api_key`: Boolean indicating whether an API key has been generated (the key itself is not returned)

**Error (404):** Customer not found.

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/bacowr-api" \
  -H "x-api-key: bac_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"action": "get_profile"}'
```

---

## regenerate_api_key

Generate a new API key, invalidating the previous one. Only available for Pro and Agency tier customers. The new key is returned exactly once -- it cannot be retrieved later.

**Parameters:** None.

**Response:**

```json
{
  "api_key": "bac_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuv",
  "message": "New API key generated. The previous key has been invalidated. Store this key securely — it will not be shown again."
}
```

**Error (403):** API keys are only available for Pro and Agency tiers.
**Error (404):** Customer not found.

**Example:**

```bash
curl -X POST "$SUPABASE_URL/functions/v1/bacowr-api" \
  -H "Authorization: Bearer $SUPABASE_JWT" \
  -H "Content-Type: application/json" \
  -d '{"action": "regenerate_api_key"}'
```

---

## Error Responses

All errors follow the same format:

```json
{
  "error": "Human-readable error message"
}
```

Common HTTP status codes:

| Status | Meaning |
|--------|---------|
| 400 | Bad request -- missing or invalid parameters |
| 401 | Unauthorized -- missing or invalid authentication |
| 402 | Payment required -- insufficient credits |
| 403 | Forbidden -- tier does not permit this action |
| 404 | Not found -- resource does not exist or is not owned by the customer |
| 405 | Method not allowed -- use POST |
| 429 | Too many requests -- monthly cap exceeded |
| 500 | Internal server error |
