"""
BACOWR Worker — ArticleGenerator

Replaces the interactive human-in-the-loop agent with direct Anthropic API calls.
Runs the full 8-phase pipeline for a single job and returns the article + QA results.

Imports and uses the existing pipeline.py, engine.py, and article_validator.py
directly — this module wraps them, it does not rewrite them.
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import anthropic

# Import the existing BACOWR pipeline and engine.
# At runtime these are available either from the parent directory (local dev)
# or from the bacowr package directory (Docker).
import sys
import os

_parent = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _parent not in sys.path:
    sys.path.insert(0, _parent)

from pipeline import Pipeline, PipelineConfig
from engine import (
    TargetIntentAnalyzer,
    create_blueprint_from_pipeline,
)
from article_validator import validate_article
from models import JobSpec, Preflight

logger = logging.getLogger("bacowr.worker.generator")


# ---------------------------------------------------------------------------
# Token / cost tracking
# ---------------------------------------------------------------------------

# Approximate pricing per 1M tokens (USD) — updated for claude-sonnet-4-20250514
_MODEL_PRICING: Dict[str, Dict[str, float]] = {
    "claude-sonnet-4-20250514": {"input": 3.0, "output": 15.0},
    "claude-opus-4-20250514": {"input": 15.0, "output": 75.0},
}


def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Return estimated cost in USD."""
    pricing = _MODEL_PRICING.get(model, {"input": 3.0, "output": 15.0})
    return (
        input_tokens * pricing["input"] / 1_000_000
        + output_tokens * pricing["output"] / 1_000_000
    )


# ---------------------------------------------------------------------------
# Web-search helpers (via Anthropic tool use)
# ---------------------------------------------------------------------------


def _extract_search_results(response) -> List[Dict[str, str]]:
    """Extract structured search results from an Anthropic response that used web_search.

    Parses the content blocks returned by the API.  The web_search tool produces
    ``tool_result`` blocks containing search results.  We extract title, url,
    and description (snippet) from each.
    """
    results: List[Dict[str, str]] = []
    for block in response.content:
        if getattr(block, "type", None) == "web_search_tool_result":
            for sr in getattr(block, "search_results", []):
                results.append(
                    {
                        "title": getattr(sr, "title", ""),
                        "url": getattr(sr, "url", ""),
                        "description": getattr(sr, "snippet", getattr(sr, "description", "")),
                    }
                )
    return results


def _extract_text(response) -> str:
    """Extract plain text from an Anthropic response."""
    parts: List[str] = []
    for block in response.content:
        if getattr(block, "type", None) == "text":
            parts.append(block.text)
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Read SYSTEM.md once at import time for the article-writing system prompt
# ---------------------------------------------------------------------------

# SYSTEM.md can be in the parent directory (local dev) or alongside
# the pipeline modules (Docker, where it's copied to /app/bacowr/).
_SYSTEM_MD: str = ""
for _candidate in [
    os.path.join(_parent, "SYSTEM.md"),
    os.path.join(os.path.dirname(__file__), "SYSTEM.md"),
]:
    if os.path.isfile(_candidate):
        with open(_candidate, "r", encoding="utf-8") as _f:
            _SYSTEM_MD = _f.read()
        break


# ---------------------------------------------------------------------------
# ArticleGenerator
# ---------------------------------------------------------------------------


class ArticleGenerator:
    """Orchestrates the full BACOWR 8-phase pipeline using the Anthropic API.

    Phases 2, 4, 6, 8 use pipeline.py / engine.py directly.
    Phases 3, 5, 7 replace the human agent with Anthropic API calls.
    """

    def __init__(
        self,
        anthropic_api_key: str,
        model: str = "claude-sonnet-4-20250514",
        max_retries: int = 2,
    ):
        self.client = anthropic.Anthropic(api_key=anthropic_api_key)
        self.model = model
        self.max_retries = max_retries

        # Reusable pipeline (loads embedding model once)
        self._pipe = Pipeline(PipelineConfig())
        self._pipe.warmup()

        # Running totals for the current generate_article call
        self._input_tokens = 0
        self._output_tokens = 0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def generate_article(self, job: dict) -> dict:
        """Run the full 8-phase pipeline for a single job.

        Args:
            job: Dict with keys job_number, publisher_domain, target_url, anchor_text.

        Returns:
            {
                "article": str,
                "word_count": int,
                "qa_result": dict,
                "qa_passed": bool,
                "preflight": dict,
                "blueprint": dict,
                "api_cost_usd": float,
                "tokens_used": int,
                "serp_entities": list,
                "trust_links": list,
            }
        """
        t0 = time.monotonic()
        self._input_tokens = 0
        self._output_tokens = 0

        job_spec = JobSpec(
            job_number=int(job["job_number"]),
            publisher_domain=job["publisher_domain"],
            target_url=job["target_url"],
            anchor_text=job["anchor_text"],
        )

        target_domain = urlparse(job_spec.target_url).netloc.replace("www.", "")

        # ── Phase 2: Preflight ──────────────────────────────────
        logger.info("Phase 2: Running preflight for job %d", job_spec.job_number)
        preflight: Preflight = await self._pipe.run_preflight(job_spec)

        # ── Phase 3: Metadata acquisition via web search ────────
        logger.info("Phase 3: Fetching target metadata via web search")
        preflight = await self._phase3_metadata(preflight)

        # ── Phase 4: Probe generation ───────────────────────────
        logger.info("Phase 4: Building research plan")
        analyzer = TargetIntentAnalyzer()
        plan = analyzer.build_research_plan_from_metadata(
            url=preflight.target.url,
            title=preflight.target.title,
            description=preflight.target.meta_description,
        )

        # ── Phase 5: SERP execution + trust link discovery ──────
        logger.info("Phase 5: Running %d SERP probes", len(plan.probes))
        plan, trust_links = await self._phase5_serp(
            analyzer, plan, preflight, job_spec, target_domain
        )
        serp_entities = list(
            dict.fromkeys(
                getattr(plan, "entities_to_weave", [])
                or getattr(plan, "core_entities", [])
            )
        )

        # ── Phase 6: Blueprint generation ───────────────────────
        logger.info("Phase 6: Creating blueprint")
        bp = create_blueprint_from_pipeline(
            job_number=job_spec.job_number,
            publisher_domain=job_spec.publisher_domain,
            target_url=job_spec.target_url,
            anchor_text=job_spec.anchor_text,
            publisher_profile=preflight.publisher,
            target_fingerprint=preflight.target,
            semantic_bridge=preflight.bridge,
        )
        bp.target.intent_profile = plan

        prompt = bp.to_agent_prompt()

        # ── Phase 7: Article writing ────────────────────────────
        logger.info("Phase 7: Writing article")
        article = await self._phase7_write(
            prompt, trust_links, serp_entities, preflight
        )

        # ── Phase 8: QA validation (with retry loop) ────────────
        logger.info("Phase 8: Running QA validation")
        qa_result, article = await self._phase8_qa(
            article, job_spec, preflight, serp_entities, prompt, trust_links
        )

        elapsed = time.monotonic() - t0
        total_tokens = self._input_tokens + self._output_tokens
        cost = _estimate_cost(self.model, self._input_tokens, self._output_tokens)

        logger.info(
            "Job %d complete — %d words, QA %s, %.2fs, $%.4f",
            job_spec.job_number,
            len(article.split()),
            "PASSED" if qa_result["passed"] else "FAILED",
            elapsed,
            cost,
        )

        # Serialize preflight for the response (skip non-serializable fields)
        preflight_data = {}
        try:
            preflight_data = json.loads(preflight.to_json())
        except Exception:
            preflight_data = {
                "job_number": job_spec.job_number,
                "language": preflight.language,
                "risk_level": preflight.risk_level.value,
            }

        blueprint_data = {}
        try:
            blueprint_data = {
                "topic": getattr(bp.chosen_topic, "name", "") if bp.chosen_topic else "",
                "thesis": getattr(bp.thesis, "statement", "") if bp.thesis else "",
                "sections": len(bp.sections),
                "bridges": len(bp.bridges),
                "risk": bp.overall_risk.value,
            }
        except Exception:
            pass

        return {
            "article": article,
            "word_count": len(article.split()),
            "qa_result": qa_result,
            "qa_passed": qa_result["passed"],
            "preflight": preflight_data,
            "blueprint": blueprint_data,
            "api_cost_usd": round(cost, 6),
            "tokens_used": total_tokens,
            "serp_entities": serp_entities,
            "trust_links": trust_links,
            "elapsed_seconds": round(elapsed, 2),
        }

    # ------------------------------------------------------------------
    # Phase 3: Metadata acquisition
    # ------------------------------------------------------------------

    async def _phase3_metadata(self, preflight: Preflight) -> Preflight:
        """Fetch the real target page title and meta description via web search."""
        target_url = preflight.target.url
        anchor = preflight.job.anchor_text
        domain = urlparse(target_url).netloc.replace("www.", "")

        query = f"{domain} {anchor}"
        response = self._call_anthropic_with_search(
            f"Find the web page at {target_url}. "
            f"Search for: {query}\n\n"
            f"Return ONLY a JSON object with keys: title, meta_description. "
            f"Extract the real page title and meta description from the search results for this specific URL.",
        )

        # Try to extract structured data from the response
        text = _extract_text(response)
        search_results = _extract_search_results(response)

        # First, try to find the target URL in search results directly
        title = ""
        description = ""
        for sr in search_results:
            sr_domain = urlparse(sr.get("url", "")).netloc.replace("www.", "")
            if sr_domain == domain:
                title = sr.get("title", "")
                description = sr.get("description", "")
                break

        # Fallback: try to parse JSON from the LLM text response
        if not title and text:
            try:
                # Find JSON in the response
                json_match = None
                for line in text.split("\n"):
                    line = line.strip()
                    if line.startswith("{"):
                        json_match = line
                        break
                if not json_match:
                    # Try extracting JSON block
                    import re
                    m = re.search(r"\{[^}]+\}", text, re.DOTALL)
                    if m:
                        json_match = m.group()
                if json_match:
                    data = json.loads(json_match)
                    title = data.get("title", title)
                    description = data.get("meta_description", data.get("description", description))
            except (json.JSONDecodeError, AttributeError):
                pass

        # Fallback: use first search result if we got anything
        if not title and search_results:
            title = search_results[0].get("title", "")
            description = search_results[0].get("description", "")

        if title:
            preflight.target.title = title
        if description:
            preflight.target.meta_description = description

        if not preflight.target.title:
            logger.warning(
                "Phase 3: Could not fetch metadata for %s — probes will be thin",
                target_url,
            )

        return preflight

    # ------------------------------------------------------------------
    # Phase 5: SERP execution + trust link discovery
    # ------------------------------------------------------------------

    async def _phase5_serp(
        self,
        analyzer: TargetIntentAnalyzer,
        plan,
        preflight: Preflight,
        job_spec: JobSpec,
        target_domain: str,
    ) -> Tuple[Any, List[Dict[str, str]]]:
        """Run all 5 SERP probes and discover trust links."""

        # Sub-protocol A: 5 SERP probes
        for i, probe in enumerate(plan.probes):
            logger.info("  Probe %d/5: %s", i + 1, probe.query[:80])
            response = self._call_anthropic_with_search(
                f"Search for: {probe.query}"
            )
            search_results = _extract_search_results(response)
            plan = analyzer.analyze_probe_results(plan, i + 1, search_results)

        # Sub-protocol B: Trust link discovery
        tl_queries = analyzer.build_trustlink_queries(
            preflight.bridge, plan, preflight.target.title
        )
        trustlink_candidates: List[Dict[str, str]] = []
        for q in tl_queries:
            logger.info("  Trust link search: %s", q[:80])
            response = self._call_anthropic_with_search(f"Search for: {q}")
            trustlink_candidates.extend(_extract_search_results(response))

        # Filter and rank
        trust_links = analyzer.select_trustlinks(
            candidates=trustlink_candidates,
            trust_topics=getattr(preflight.bridge, "trust_link_topics", []),
            avoid_domains=getattr(preflight.bridge, "trust_link_avoid", []),
            target_domain=target_domain,
            publisher_domain=job_spec.publisher_domain,
        )

        return plan, trust_links[:3]  # Keep top 3 candidates

    # ------------------------------------------------------------------
    # Phase 7: Article writing
    # ------------------------------------------------------------------

    async def _phase7_write(
        self,
        blueprint_prompt: str,
        trust_links: List[Dict[str, str]],
        serp_entities: List[str],
        preflight: Preflight,
    ) -> str:
        """Write the article using the Anthropic API with the blueprint prompt."""

        # Build trust link instructions
        tl_section = ""
        if trust_links:
            tl_items = []
            for tl in trust_links[:2]:
                tl_items.append(f"- [{tl.get('title', 'Source')}]({tl['url']})")
            tl_section = (
                "\n\nTRUST LINKS (place 1-2 of these BEFORE the anchor link, "
                "never in the same paragraph as anchor):\n"
                + "\n".join(tl_items)
            )

        # Build SERP entities instruction
        entity_section = ""
        if serp_entities:
            entity_section = (
                f"\n\nSERP ENTITIES (weave at least 4 of these naturally into the text):\n"
                f"{', '.join(serp_entities[:10])}"
            )

        system_prompt = _SYSTEM_MD if _SYSTEM_MD else (
            "You are an expert SEO article writer. Follow the blueprint exactly. "
            "Write 750-900 words, flowing prose, no bullets, max 1 heading. "
            "Place the anchor link at word position 250-550."
        )

        user_prompt = (
            f"{blueprint_prompt}"
            f"{tl_section}"
            f"{entity_section}"
            "\n\nWrite the complete article now. Output ONLY the article text in markdown. "
            "No commentary, no explanations, no code blocks wrapping the article."
        )

        response = self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        self._track_usage(response)

        article = _extract_text(response)

        # Strip any markdown code fences the model might wrap around the article
        if article.startswith("```"):
            lines = article.split("\n")
            # Remove first and last code fence lines
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            article = "\n".join(lines)

        return article.strip()

    # ------------------------------------------------------------------
    # Phase 8: QA validation with retry
    # ------------------------------------------------------------------

    async def _phase8_qa(
        self,
        article: str,
        job_spec: JobSpec,
        preflight: Preflight,
        serp_entities: List[str],
        blueprint_prompt: str,
        trust_links: List[Dict[str, str]],
    ) -> Tuple[dict, str]:
        """Run QA validation. If it fails, attempt revision up to max_retries times."""

        for attempt in range(1 + self.max_retries):
            result = validate_article(
                article_text=article,
                anchor_text=job_spec.anchor_text,
                target_url=job_spec.target_url,
                publisher_domain=job_spec.publisher_domain,
                language=preflight.language,
                serp_entities=serp_entities,
            )

            qa_dict = {
                "passed": result.passed,
                "checks": [
                    {
                        "name": c.name,
                        "passed": c.passed,
                        "value": c.value,
                        "expected": c.expected,
                        "message": c.message,
                    }
                    for c in result.checks
                ],
                "summary": result.summary(),
            }

            if result.passed:
                logger.info("QA passed on attempt %d", attempt + 1)
                return qa_dict, article

            if attempt < self.max_retries:
                logger.warning(
                    "QA failed on attempt %d, revising...", attempt + 1
                )
                # Build a focused revision prompt from failed checks
                failures = [c for c in result.checks if not c.passed]
                failure_descriptions = "\n".join(
                    f"- {c.name}: {c.message} (expected: {c.expected}, got: {c.value})"
                    for c in failures
                )

                revision_prompt = (
                    f"The article below failed QA. Fix ONLY the failing checks, "
                    f"keep everything else intact.\n\n"
                    f"FAILED CHECKS:\n{failure_descriptions}\n\n"
                    f"ORIGINAL BLUEPRINT:\n{blueprint_prompt[:2000]}\n\n"
                    f"ARTICLE TO REVISE:\n{article}\n\n"
                    f"Output ONLY the revised article text. No commentary."
                )

                system_prompt = _SYSTEM_MD if _SYSTEM_MD else (
                    "You are revising a SEO article to pass QA checks. "
                    "Fix only the failing checks."
                )

                response = self.client.messages.create(
                    model=self.model,
                    max_tokens=4096,
                    system=system_prompt,
                    messages=[{"role": "user", "content": revision_prompt}],
                )
                self._track_usage(response)
                article = _extract_text(response).strip()

                # Strip code fences
                if article.startswith("```"):
                    lines = article.split("\n")
                    if lines[0].startswith("```"):
                        lines = lines[1:]
                    if lines and lines[-1].strip() == "```":
                        lines = lines[:-1]
                    article = "\n".join(lines)

        logger.error("QA failed after %d attempts", 1 + self.max_retries)
        return qa_dict, article

    # ------------------------------------------------------------------
    # Anthropic API helpers
    # ------------------------------------------------------------------

    def _call_anthropic_with_search(self, user_message: str):
        """Call Anthropic API with web_search tool enabled."""
        response = self.client.messages.create(
            model=self.model,
            max_tokens=2048,
            tools=[{"type": "web_search_20250305"}],
            messages=[{"role": "user", "content": user_message}],
        )
        self._track_usage(response)
        return response

    def _track_usage(self, response):
        """Accumulate token usage from an API response."""
        usage = getattr(response, "usage", None)
        if usage:
            self._input_tokens += getattr(usage, "input_tokens", 0)
            self._output_tokens += getattr(usage, "output_tokens", 0)
