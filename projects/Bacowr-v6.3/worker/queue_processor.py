"""
BACOWR Worker — Queue Processor

Background loop that:
- Polls Supabase for queued jobs (configurable interval, default 5s)
- Processes up to N concurrent jobs (configurable, default 3)
- Updates status in Supabase after each phase
- Handles errors gracefully (marks job as failed, continues with next)
"""

import asyncio
import logging
import os
import signal
import traceback
from typing import Optional

from article_generator import ArticleGenerator
from supabase_client import (
    SupabaseClient,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_PREFLIGHT,
    STATUS_METADATA,
    STATUS_PROBES,
    STATUS_SERP,
    STATUS_BLUEPRINT,
    STATUS_WRITING,
    STATUS_QA,
)

logger = logging.getLogger("bacowr.worker.queue")


class QueueProcessor:
    """Continuously processes jobs from the Supabase queue."""

    def __init__(
        self,
        generator: ArticleGenerator,
        supabase: SupabaseClient,
        concurrency: int = 3,
        poll_interval: float = 5.0,
    ):
        self.generator = generator
        self.supabase = supabase
        self.concurrency = concurrency
        self.poll_interval = poll_interval

        # Concurrency control
        self._semaphore = asyncio.Semaphore(concurrency)
        self._active_jobs: int = 0
        self._completed_today: int = 0
        self._running = False
        self._tasks: set = set()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def active_jobs(self) -> int:
        return self._active_jobs

    @property
    def completed_today(self) -> int:
        return self._completed_today

    async def start(self) -> None:
        """Start the polling loop. Call this from the FastAPI lifespan."""
        self._running = True
        logger.info(
            "Queue processor started — concurrency=%d, poll_interval=%.1fs",
            self.concurrency,
            self.poll_interval,
        )
        while self._running:
            try:
                await self._poll_once()
            except Exception as e:
                logger.error("Poll cycle error: %s", e)
            await asyncio.sleep(self.poll_interval)

    async def stop(self) -> None:
        """Gracefully stop the processor. Waits for active jobs to finish."""
        self._running = False
        logger.info("Stopping queue processor, waiting for %d active jobs...", self._active_jobs)
        # Wait for all in-flight tasks
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        logger.info("Queue processor stopped")

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _poll_once(self) -> None:
        """Try to dequeue and process one job if capacity is available."""
        if self._active_jobs >= self.concurrency:
            return

        job = self.supabase.dequeue_next_job()
        if job is None:
            return

        # Launch processing in background
        task = asyncio.create_task(self._process_job(job))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _process_job(self, job: dict) -> None:
        """Process a single job end-to-end with status updates and error handling."""
        job_id = job.get("id", "unknown")
        self._active_jobs += 1

        try:
            async with self._semaphore:
                logger.info("Processing job %s", job_id)

                # Extract the JobSpec fields from the queued job record
                job_spec = {
                    "job_number": job.get("job_number", 0),
                    "publisher_domain": job.get("publisher_domain", ""),
                    "target_url": job.get("target_url", ""),
                    "anchor_text": job.get("anchor_text", ""),
                }

                # Validate required fields
                if not all([
                    job_spec["publisher_domain"],
                    job_spec["target_url"],
                    job_spec["anchor_text"],
                ]):
                    raise ValueError(
                        f"Job {job_id} missing required fields: "
                        f"publisher_domain={job_spec['publisher_domain']!r}, "
                        f"target_url={job_spec['target_url']!r}, "
                        f"anchor_text={job_spec['anchor_text']!r}"
                    )

                # Run the full pipeline
                result = await self.generator.generate_article(job_spec)

                # Store results
                self.supabase.update_job_status(job_id, STATUS_COMPLETED)
                self.supabase.store_article(job_id, result)
                self.supabase.log_usage(
                    job_id=job_id,
                    tokens_used=result.get("tokens_used", 0),
                    api_cost_usd=result.get("api_cost_usd", 0.0),
                    model=self.generator.model,
                )
                self._completed_today += 1
                logger.info(
                    "Job %s completed — QA %s, $%.4f",
                    job_id,
                    "PASSED" if result.get("qa_passed") else "FAILED",
                    result.get("api_cost_usd", 0),
                )

        except Exception as e:
            error_msg = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
            logger.error("Job %s failed: %s", job_id, error_msg[:500])
            self.supabase.update_job_status(
                job_id, STATUS_FAILED, error=error_msg[:2000]
            )
        finally:
            self._active_jobs -= 1
