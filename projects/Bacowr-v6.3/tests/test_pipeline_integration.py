"""Tests for pipeline.py integration — SemanticEngine.analyze(),
Pipeline.run_preflight() graceful degradation, PromptGenerator.generate().

These tests verify pipeline methods that were previously 0% tested.
run_preflight is tested via asyncio without live HTTP (graceful degradation).
"""

import asyncio
import sys
import tempfile
from pathlib import Path
from datetime import datetime

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import (
    Pipeline,
    PipelineConfig,
    SemanticEngine,
    PromptGenerator,
)
from models import (
    JobSpec,
    Preflight,
    PublisherProfile,
    TargetFingerprint,
    SemanticBridge,
    BridgeSuggestion,
    SemanticDistance,
    BridgeConfidence,
    RiskLevel,
    SourceVerificationResult,
    VerifiedSource,
)


# ═════════════════════════════════════════════════════════════
# Fixtures
# ═════════════════════════════════════════════════════════════

@pytest.fixture
def config(tmp_path):
    return PipelineConfig(
        csv_path=str(tmp_path / "jobs.csv"),
        output_dir=str(tmp_path),
        cache_dir=".cache",
    )


@pytest.fixture
def publisher():
    return PublisherProfile(
        domain="teknikbloggen.se",
        timestamp=datetime(2026, 2, 14),
        site_name="Teknikbloggen",
        site_description="Teknik och IT-nyheter",
        primary_language="sv",
        primary_topics=["teknik", "it"],
        secondary_topics=["digitalisering"],
        confidence=0.7,
    )


@pytest.fixture
def target():
    return TargetFingerprint(
        url="https://www.indoorprofessional.se/tjanster/lokalvard/",
        timestamp=datetime(2026, 2, 14),
        title="Lokalvård Stockholm | Indoor Professional",
        meta_description="Professionell lokalvård i Stockholm.",
        h1="Lokalvård Stockholm",
        language="sv",
        main_keywords=["lokalvård", "stockholm", "professionell", "städning"],
        topic_cluster=["kontor", "fastighet", "underhåll"],
    )


@pytest.fixture
def sample_job():
    return JobSpec(
        job_number=1,
        publisher_domain="teknikbloggen.se",
        target_url="https://www.indoorprofessional.se/tjanster/lokalvard/",
        anchor_text="lokalvård",
    )


@pytest.fixture
def bridge(target):
    suggestion = BridgeSuggestion(
        concept="teknik och lokalvård",
        rationale="Gemensam koppling via digitalisering",
        confidence=BridgeConfidence.MEDIUM,
        confidence_score=0.6,
        publisher_relevance=0.7,
        target_relevance=0.7,
        suggested_angle="Perspektiv kring teknik",
    )
    return SemanticBridge(
        publisher_domain="teknikbloggen.se",
        target_url=target.url,
        anchor_text="lokalvård",
        timestamp=datetime(2026, 2, 14),
        raw_distance=0.5,
        distance_category=SemanticDistance.MODERATE,
        suggestions=[suggestion],
        recommended_angle="Perspektiv kring teknik",
        required_entities=["teknik", "lokalvård"],
        forbidden_entities=[],
        trust_link_topics=["teknik", "it", "statistik", "forskning"],
        trust_link_avoid=["indoorprofessional.se"],
    )


@pytest.fixture
def preflight(sample_job, publisher, target, bridge):
    return Preflight(
        job=sample_job,
        publisher=publisher,
        target=target,
        bridge=bridge,
        risk_level=RiskLevel.LOW,
        language="sv",
        generated_at=datetime(2026, 2, 14),
    )


@pytest.fixture
def preflight_with_sources(preflight):
    source = VerifiedSource(
        url="https://scb.se/rapport/teknik-2026",
        domain="scb.se",
        fetched_at=datetime(2026, 2, 14),
        http_status=200,
        extracted_facts=["15% tillväxt", "500 företag"],
        relevance_to_article="Stödjer branschtillväxt",
        is_deep_link=True,
        is_verified=True,
    )
    preflight.sources = SourceVerificationResult(
        job_number=1,
        verified_sources=[source],
        verification_complete=True,
    )
    return preflight


# ═════════════════════════════════════════════════════════════
# SemanticEngine.analyze()
# ═════════════════════════════════════════════════════════════

class TestSemanticEngineAnalyze:
    @pytest.fixture
    def engine(self, config):
        return SemanticEngine(config)

    def test_returns_semantic_bridge(self, engine, publisher, target):
        bridge = engine.analyze(publisher, target, "lokalvård")
        assert isinstance(bridge, SemanticBridge)
        assert bridge.publisher_domain == publisher.domain
        assert bridge.target_url == target.url
        assert bridge.anchor_text == "lokalvård"

    def test_fallback_distance_without_embeddings(self, engine, publisher, target):
        """Without sentence-transformers, cosine_similarity falls back to 0.5."""
        bridge = engine.analyze(publisher, target, "lokalvård")
        # raw_distance is either computed or fallback 0.5
        assert 0.0 <= bridge.raw_distance <= 1.0

    def test_produces_suggestions(self, engine, publisher, target):
        bridge = engine.analyze(publisher, target, "lokalvård")
        assert len(bridge.suggestions) >= 1
        assert all(isinstance(s, BridgeSuggestion) for s in bridge.suggestions)

    def test_trust_link_topics_from_publisher(self, engine, publisher, target):
        bridge = engine.analyze(publisher, target, "lokalvård")
        assert len(bridge.trust_link_topics) >= 1
        # Should include publisher primary topics
        assert any(t in bridge.trust_link_topics for t in publisher.primary_topics)


# ═════════════════════════════════════════════════════════════
# Pipeline.run_preflight() — graceful degradation
# ═════════════════════════════════════════════════════════════

class TestPipelineRunPreflight:
    @pytest.fixture
    def pipeline(self, config):
        return Pipeline(config)

    def test_returns_preflight_with_publisher(self, pipeline, sample_job):
        """run_preflight should return a Preflight with publisher populated."""
        result = asyncio.run(pipeline.run_preflight(sample_job))
        assert isinstance(result, Preflight)
        assert result.publisher is not None
        assert result.publisher.domain != ""

    def test_bridge_has_valid_distance_category(self, pipeline, sample_job):
        result = asyncio.run(pipeline.run_preflight(sample_job))
        assert result.bridge is not None
        assert isinstance(result.bridge.distance_category, SemanticDistance)

    def test_se_domain_language_sv(self, pipeline):
        """A .se publisher domain should result in language='sv'."""
        job = JobSpec(
            job_number=99,
            publisher_domain="nyheter.se",
            target_url="https://example.se/page",
            anchor_text="test",
        )
        result = asyncio.run(pipeline.run_preflight(job))
        assert result.language == "sv"


# ═════════════════════════════════════════════════════════════
# PromptGenerator.generate()
# ═════════════════════════════════════════════════════════════

class TestPromptGeneratorGenerate:
    @pytest.fixture
    def generator(self):
        return PromptGenerator()

    def test_returns_non_empty_string(self, generator, preflight):
        result = generator.generate(preflight)
        assert isinstance(result, str)
        assert len(result) > 50

    def test_contains_job_info(self, generator, preflight):
        result = generator.generate(preflight)
        assert preflight.job.publisher_domain in result
        assert preflight.job.anchor_text in result
        assert preflight.job.target_url in result

    def test_contains_word_count_rules(self, generator, preflight):
        result = generator.generate(preflight)
        assert "750" in result
        assert "900" in result
        assert "250" in result  # anchor placement zone
        assert "550" in result
