"""
BACOWR Worker — FastAPI Application

HTTP API that wraps the BACOWR article generation pipeline.
Provides endpoints for processing individual jobs, batches,
health checks, and status monitoring.

Runs a background queue processor that continuously polls
Supabase for new jobs.

Usage:
    uvicorn main:app --host 0.0.0.0 --port 8080

Environment variables (see .env.example):
    ANTHROPIC_API_KEY       — Required
    SUPABASE_URL            — Required for queue processing
    SUPABASE_SERVICE_ROLE_KEY — Required for queue processing
    WORKER_CONCURRENCY      — Max concurrent jobs (default 3)
    WORKER_MODEL            — Anthropic model ID (default claude-sonnet-4-20250514)
    PORT                    — Server port (default 8080)
"""

import asyncio
import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field

# Load .env before anything else
load_dotenv()

# Ensure parent directory is importable (for pipeline.py, engine.py, models.py)
_parent = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _parent not in sys.path:
    sys.path.insert(0, _parent)

from article_generator import ArticleGenerator
from supabase_client import SupabaseClient
from queue_processor import QueueProcessor

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("bacowr.worker")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
WORKER_CONCURRENCY = int(os.environ.get("WORKER_CONCURRENCY", "3"))
WORKER_MODEL = os.environ.get("WORKER_MODEL", "claude-sonnet-4-20250514")

# ---------------------------------------------------------------------------
# Pydantic models for request/response
# ---------------------------------------------------------------------------


class JobInput(BaseModel):
    """A single job to process."""
    job_number: int = Field(..., description="Job identifier")
    publisher_domain: str = Field(..., description="Publisher site domain")
    target_url: str = Field(..., description="Target URL to link to")
    anchor_text: str = Field(..., description="Anchor text for the link")


class JobResult(BaseModel):
    """Result of processing a single job."""
    article: str
    word_count: int
    qa_passed: bool
    qa_result: dict
    preflight: dict
    blueprint: dict
    api_cost_usd: float
    tokens_used: int
    serp_entities: list
    trust_links: list
    elapsed_seconds: float = 0.0


class BatchInput(BaseModel):
    """A batch of jobs to process."""
    jobs: List[JobInput]
    parallel: bool = Field(
        default=False,
        description="If true, process jobs in parallel (up to concurrency limit). "
                    "If false, process sequentially.",
    )


class BatchResult(BaseModel):
    """Result of processing a batch."""
    results: List[dict]
    total_jobs: int
    succeeded: int
    failed: int
    total_cost_usd: float
    total_tokens: int
    elapsed_seconds: float


class StatusResponse(BaseModel):
    """Worker status."""
    active_jobs: int
    completed_today: int
    queue_depth: int
    worker_model: str
    worker_concurrency: int


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    version: str


# ---------------------------------------------------------------------------
# Application state
# ---------------------------------------------------------------------------

_generator: Optional[ArticleGenerator] = None
_supabase: Optional[SupabaseClient] = None
_queue_processor: Optional[QueueProcessor] = None
_queue_task: Optional[asyncio.Task] = None
_startup_time: float = 0.0

# Counters for direct API calls (not via queue)
_direct_completed: int = 0


def _get_generator() -> ArticleGenerator:
    global _generator
    if _generator is None:
        if not ANTHROPIC_API_KEY:
            raise HTTPException(
                status_code=503,
                detail="ANTHROPIC_API_KEY not configured",
            )
        _generator = ArticleGenerator(
            anthropic_api_key=ANTHROPIC_API_KEY,
            model=WORKER_MODEL,
        )
    return _generator


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle for the worker."""
    global _supabase, _queue_processor, _queue_task, _startup_time

    _startup_time = time.monotonic()
    logger.info("BACOWR Worker starting — model=%s, concurrency=%d", WORKER_MODEL, WORKER_CONCURRENCY)

    # Start background queue processor if Supabase is configured
    if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
        try:
            _supabase = SupabaseClient(url=SUPABASE_URL, key=SUPABASE_SERVICE_ROLE_KEY)
            _queue_processor = QueueProcessor(
                generator=_get_generator(),
                supabase=_supabase,
                concurrency=WORKER_CONCURRENCY,
            )
            _queue_task = asyncio.create_task(_queue_processor.start())
            logger.info("Queue processor started")
        except Exception as e:
            logger.warning("Could not start queue processor: %s", e)
            logger.info("Worker will still accept direct API calls")
    else:
        logger.info("Supabase not configured — queue processing disabled, direct API only")

    yield

    # Shutdown
    if _queue_processor:
        await _queue_processor.stop()
    if _queue_task:
        _queue_task.cancel()
        try:
            await _queue_task
        except asyncio.CancelledError:
            pass
    logger.info("BACOWR Worker shut down")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="BACOWR Article Worker",
    description=(
        "Production API for the BACOWR article generation pipeline. "
        "Accepts job specifications and produces SEO articles with "
        "SERP-backed entities, trust links, and 11-check QA validation."
    ),
    version="6.3",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check — confirms the worker is running."""
    return HealthResponse(status="ok", version="6.3")


@app.get("/status", response_model=StatusResponse)
async def status():
    """Worker status — active jobs, completions, queue depth."""
    active = 0
    completed = _direct_completed
    queue_depth = 0

    if _queue_processor:
        active = _queue_processor.active_jobs
        completed += _queue_processor.completed_today
    if _supabase:
        queue_depth = _supabase.get_queued_count()

    return StatusResponse(
        active_jobs=active,
        completed_today=completed,
        queue_depth=queue_depth,
        worker_model=WORKER_MODEL,
        worker_concurrency=WORKER_CONCURRENCY,
    )


@app.post("/process-job", response_model=JobResult)
async def process_job(job: JobInput):
    """Process a single job through the full 8-phase pipeline.

    This endpoint runs the job directly (not via the queue). Use it
    for on-demand article generation or testing.
    """
    global _direct_completed

    generator = _get_generator()

    try:
        result = await generator.generate_article(job.model_dump())
    except Exception as e:
        logger.error("process-job failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Article generation failed: {type(e).__name__}: {e}",
        )

    _direct_completed += 1

    return JobResult(
        article=result["article"],
        word_count=result["word_count"],
        qa_passed=result["qa_passed"],
        qa_result=result["qa_result"],
        preflight=result["preflight"],
        blueprint=result["blueprint"],
        api_cost_usd=result["api_cost_usd"],
        tokens_used=result["tokens_used"],
        serp_entities=result["serp_entities"],
        trust_links=result["trust_links"],
        elapsed_seconds=result.get("elapsed_seconds", 0.0),
    )


@app.post("/process-batch", response_model=BatchResult)
async def process_batch(batch: BatchInput):
    """Process a batch of jobs.

    By default, jobs run sequentially. Set ``parallel=true`` to process
    up to ``WORKER_CONCURRENCY`` jobs simultaneously.
    """
    global _direct_completed

    generator = _get_generator()
    t0 = time.monotonic()
    results: List[dict] = []
    succeeded = 0
    failed = 0
    total_cost = 0.0
    total_tokens = 0

    if batch.parallel:
        # Parallel execution with semaphore
        sem = asyncio.Semaphore(WORKER_CONCURRENCY)

        async def _run(j: JobInput) -> dict:
            async with sem:
                try:
                    r = await generator.generate_article(j.model_dump())
                    return {"job_number": j.job_number, "success": True, **r}
                except Exception as e:
                    return {
                        "job_number": j.job_number,
                        "success": False,
                        "error": f"{type(e).__name__}: {e}",
                    }

        batch_results = await asyncio.gather(
            *[_run(j) for j in batch.jobs],
            return_exceptions=False,
        )
        for r in batch_results:
            results.append(r)
            if r.get("success"):
                succeeded += 1
                total_cost += r.get("api_cost_usd", 0)
                total_tokens += r.get("tokens_used", 0)
            else:
                failed += 1
    else:
        # Sequential execution
        for job in batch.jobs:
            try:
                r = await generator.generate_article(job.model_dump())
                results.append({"job_number": job.job_number, "success": True, **r})
                succeeded += 1
                total_cost += r.get("api_cost_usd", 0)
                total_tokens += r.get("tokens_used", 0)
            except Exception as e:
                results.append({
                    "job_number": job.job_number,
                    "success": False,
                    "error": f"{type(e).__name__}: {e}",
                })
                failed += 1

    _direct_completed += succeeded
    elapsed = time.monotonic() - t0

    return BatchResult(
        results=results,
        total_jobs=len(batch.jobs),
        succeeded=succeeded,
        failed=failed,
        total_cost_usd=round(total_cost, 6),
        total_tokens=total_tokens,
        elapsed_seconds=round(elapsed, 2),
    )


# ---------------------------------------------------------------------------
# Run with uvicorn if executed directly
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8080"))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        log_level="info",
    )
