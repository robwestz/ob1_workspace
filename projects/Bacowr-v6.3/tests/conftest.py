"""Shared pytest fixtures for BACOWR v6.2 tests."""

import sys
from pathlib import Path
from datetime import datetime

import pytest

# Ensure project root is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import (
    JobSpec, Preflight, PublisherProfile, TargetFingerprint,
    SemanticBridge, BridgeSuggestion, VerifiedSource,
    SourceVerificationResult, SemanticDistance, BridgeConfidence, RiskLevel,
)
from engine import (
    TargetIntentProfile, SerpProbe, SerpSnapshot, TargetUniverse,
    PublisherUniverse, BridgeGravity, ContextBridge, GapAnalysis,
    SemanticDistance as EngineSemanticDistance,
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
def sample_publisher():
    return PublisherProfile(
        domain="teknikbloggen.se",
        timestamp=datetime(2026, 2, 14),
        site_name="Teknikbloggen",
        site_description="Senaste nytt inom teknik och IT",
        primary_language="sv",
        primary_topics=["teknik", "it"],
        secondary_topics=["digitalisering"],
        confidence=0.7,
    )


@pytest.fixture
def sample_target():
    return TargetFingerprint(
        url="https://www.indoorprofessional.se/tjanster/lokalvard/",
        timestamp=datetime(2026, 2, 14),
        title="Lokalvård Stockholm | Indoor Professional",
        meta_description="Professionell lokalvård i Stockholm. Kontakta oss för offert.",
        h1="Lokalvård Stockholm",
        language="sv",
        main_keywords=["lokalvård", "stockholm", "professionell", "städning"],
        topic_cluster=["kontor", "fastighet", "underhåll"],
    )


@pytest.fixture
def sample_bridge(sample_target):
    suggestion = BridgeSuggestion(
        concept="teknik och lokalvård",
        rationale="Publisher (teknik) och target (lokalvård) kopplas via digitalisering",
        confidence=BridgeConfidence.MEDIUM,
        confidence_score=0.6,
        publisher_relevance=0.7,
        target_relevance=0.7,
        suggested_angle="Perspektiv kring teknik",
    )
    return SemanticBridge(
        publisher_domain="teknikbloggen.se",
        target_url=sample_target.url,
        anchor_text="lokalvård",
        timestamp=datetime(2026, 2, 14),
        raw_distance=0.45,
        distance_category=SemanticDistance.MODERATE,
        suggestions=[suggestion],
        recommended_angle="Perspektiv kring teknik",
        required_entities=["teknik", "lokalvård"],
        forbidden_entities=[],
        trust_link_topics=["teknik", "it", "statistik", "forskning"],
        trust_link_avoid=["indoorprofessional.se"],
    )


@pytest.fixture
def sample_preflight(sample_job, sample_publisher, sample_target, sample_bridge):
    return Preflight(
        job=sample_job,
        publisher=sample_publisher,
        target=sample_target,
        bridge=sample_bridge,
        risk_level=RiskLevel.LOW,
        language="sv",
        generated_at=datetime(2026, 2, 14),
    )


@pytest.fixture
def sample_verified_source():
    return VerifiedSource(
        url="https://example.com/rapport/2026",
        domain="example.com",
        fetched_at=datetime(2026, 2, 14),
        http_status=200,
        extracted_facts=["Marknad växte 15%", "500 företag analyserade"],
        relevance_to_article="Stödjer påstående om branschtillväxt",
        is_deep_link=True,
        is_verified=True,
    )


@pytest.fixture
def sample_intent_profile():
    probes = [
        SerpProbe(step=i, step_name=name, query=f"query {i}", purpose=f"purpose {i}")
        for i, name in enumerate(
            ["head_entity", "cluster_search", "literal_title",
             "desc_predicate", "literal_description"],
            start=1,
        )
    ]
    return TargetIntentProfile(
        target_url="https://example.se/test",
        meta_title="Test Produkt | Brand",
        meta_description="Köp test produkt online. Bästa pris.",
        head_entity="test produkt",
        probes=probes,
    )


@pytest.fixture
def sample_engine_publisher():
    return PublisherUniverse(
        domain="sportbloggen.se",
        site_name="Sportbloggen",
        primary_topics=["sport", "idrott"],
        secondary_topics=["träning"],
        language="sv",
        confidence=0.7,
    )


@pytest.fixture
def sample_engine_target():
    return TargetUniverse(
        url="https://www.example.se/produkter/mattor",
        title="Mattor Online | Rusta",
        h1="Mattor",
        meta_description="Köp mattor online hos Rusta. Stort sortiment till bra pris.",
        language="sv",
        main_keywords=["mattor", "inredning", "pris", "sortiment"],
        topic_cluster=["hem", "golv", "design"],
    )
