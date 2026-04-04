"""
BACOWR Worker — Supabase Client

Handles all Supabase interactions:
- Dequeuing jobs from the job queue
- Updating job status through pipeline phases
- Storing completed articles
- Logging usage and costs
"""

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from supabase import create_client, Client

logger = logging.getLogger("bacowr.worker.supabase")

# Job statuses
STATUS_QUEUED = "queued"
STATUS_PROCESSING = "processing"
STATUS_PREFLIGHT = "preflight"
STATUS_METADATA = "metadata"
STATUS_PROBES = "probes"
STATUS_SERP = "serp"
STATUS_BLUEPRINT = "blueprint"
STATUS_WRITING = "writing"
STATUS_QA = "qa"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"


class SupabaseClient:
    """Manages job queue and article storage in Supabase."""

    def __init__(
        self,
        url: Optional[str] = None,
        key: Optional[str] = None,
    ):
        self.url = url or os.environ["SUPABASE_URL"]
        self.key = key or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self.client: Client = create_client(self.url, self.key)

    # ------------------------------------------------------------------
    # Job queue
    # ------------------------------------------------------------------

    def dequeue_next_job(self) -> Optional[Dict[str, Any]]:
        """Atomically claim the next queued job.

        Uses an RPC call (``bacowr.dequeue_next_job``) that performs an
        UPDATE ... SET status='processing' ... LIMIT 1 RETURNING * inside
        a transaction, so two workers never grab the same job.

        Falls back to a simple select+update if the RPC is not available.
        """
        try:
            result = self.client.rpc("dequeue_next_job").execute()
            if result.data:
                job = result.data[0] if isinstance(result.data, list) else result.data
                logger.info("Dequeued job %s", job.get("id", "?"))
                return job
            return None
        except Exception as e:
            logger.warning("RPC dequeue_next_job failed (%s), using fallback", e)
            return self._dequeue_fallback()

    def _dequeue_fallback(self) -> Optional[Dict[str, Any]]:
        """Fallback: select oldest queued job and claim it."""
        try:
            result = (
                self.client.table("bacowr_jobs")
                .select("*")
                .eq("status", STATUS_QUEUED)
                .order("created_at", desc=False)
                .limit(1)
                .execute()
            )
            if not result.data:
                return None

            job = result.data[0]
            # Claim it
            self.client.table("bacowr_jobs").update(
                {
                    "status": STATUS_PROCESSING,
                    "started_at": _now_iso(),
                    "worker_id": _worker_id(),
                }
            ).eq("id", job["id"]).eq("status", STATUS_QUEUED).execute()

            return job
        except Exception as e:
            logger.error("Fallback dequeue failed: %s", e)
            return None

    def get_queued_count(self) -> int:
        """Return the number of jobs currently queued."""
        try:
            result = (
                self.client.table("bacowr_jobs")
                .select("id", count="exact")
                .eq("status", STATUS_QUEUED)
                .execute()
            )
            return result.count or 0
        except Exception:
            return 0

    def get_processing_count(self) -> int:
        """Return the number of jobs currently being processed."""
        try:
            result = (
                self.client.table("bacowr_jobs")
                .select("id", count="exact")
                .eq("status", STATUS_PROCESSING)
                .execute()
            )
            return result.count or 0
        except Exception:
            return 0

    def get_completed_today_count(self) -> int:
        """Return the number of jobs completed today (UTC)."""
        try:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            result = (
                self.client.table("bacowr_jobs")
                .select("id", count="exact")
                .eq("status", STATUS_COMPLETED)
                .gte("completed_at", f"{today}T00:00:00Z")
                .execute()
            )
            return result.count or 0
        except Exception:
            return 0

    # ------------------------------------------------------------------
    # Status updates
    # ------------------------------------------------------------------

    def update_job_status(
        self,
        job_id: str,
        status: str,
        phase: Optional[str] = None,
        error: Optional[str] = None,
    ) -> None:
        """Update a job's status and optionally the current phase."""
        update: Dict[str, Any] = {
            "status": status,
            "updated_at": _now_iso(),
        }
        if phase:
            update["current_phase"] = phase
        if error:
            update["error_message"] = error[:2000]  # Truncate long errors
        if status == STATUS_COMPLETED:
            update["completed_at"] = _now_iso()
        if status == STATUS_FAILED:
            update["failed_at"] = _now_iso()

        try:
            self.client.table("bacowr_jobs").update(update).eq("id", job_id).execute()
        except Exception as e:
            logger.error("Failed to update status for job %s: %s", job_id, e)

    # ------------------------------------------------------------------
    # Article storage
    # ------------------------------------------------------------------

    def store_article(
        self,
        job_id: str,
        result: Dict[str, Any],
    ) -> None:
        """Store the completed article and its metadata."""
        try:
            self.client.table("bacowr_articles").insert(
                {
                    "job_id": job_id,
                    "article_text": result.get("article", ""),
                    "word_count": result.get("word_count", 0),
                    "qa_passed": result.get("qa_passed", False),
                    "qa_result": result.get("qa_result", {}),
                    "preflight_data": result.get("preflight", {}),
                    "blueprint_data": result.get("blueprint", {}),
                    "serp_entities": result.get("serp_entities", []),
                    "trust_links": result.get("trust_links", []),
                    "tokens_used": result.get("tokens_used", 0),
                    "api_cost_usd": result.get("api_cost_usd", 0.0),
                    "elapsed_seconds": result.get("elapsed_seconds", 0.0),
                    "created_at": _now_iso(),
                }
            ).execute()
        except Exception as e:
            logger.error("Failed to store article for job %s: %s", job_id, e)

    # ------------------------------------------------------------------
    # Usage logging
    # ------------------------------------------------------------------

    def log_usage(
        self,
        job_id: str,
        tokens_used: int,
        api_cost_usd: float,
        model: str,
    ) -> None:
        """Log API usage for billing and monitoring."""
        try:
            self.client.table("bacowr_usage_log").insert(
                {
                    "job_id": job_id,
                    "tokens_used": tokens_used,
                    "api_cost_usd": api_cost_usd,
                    "model": model,
                    "worker_id": _worker_id(),
                    "logged_at": _now_iso(),
                }
            ).execute()
        except Exception as e:
            logger.error("Failed to log usage for job %s: %s", job_id, e)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _worker_id() -> str:
    """Return a stable identifier for this worker instance."""
    import socket

    hostname = socket.gethostname()
    pid = os.getpid()
    return f"{hostname}-{pid}"
