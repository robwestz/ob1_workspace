"""Tests for models.py — serialization and field integrity."""

import json
from datetime import datetime

from models import (
    JobSpec, Preflight, VerifiedSource, SourceVerificationResult,
    PublisherProfile, TargetFingerprint, SemanticBridge, BridgeSuggestion,
    SemanticDistance, BridgeConfidence, RiskLevel,
)
from engine import TargetIntentProfile, SerpProbe, SerpSnapshot


# ── JobSpec ──────────────────────────────────────────────────

class TestJobSpec:
    def test_construction(self):
        job = JobSpec(
            job_number=42,
            publisher_domain="example.se",
            target_url="https://target.se/page",
            anchor_text="klicka här",
        )
        assert job.job_number == 42
        assert job.publisher_domain == "example.se"
        assert job.target_url == "https://target.se/page"
        assert job.anchor_text == "klicka här"

    def test_field_types(self, sample_job):
        assert isinstance(sample_job.job_number, int)
        assert isinstance(sample_job.publisher_domain, str)
        assert isinstance(sample_job.target_url, str)
        assert isinstance(sample_job.anchor_text, str)


# ── VerifiedSource ───────────────────────────────────────────

class TestVerifiedSource:
    def test_to_dict_keys(self, sample_verified_source):
        d = sample_verified_source.to_dict()
        expected_keys = {"url", "domain", "http_status", "extracted_facts",
                         "relevance", "is_deep_link", "verified"}
        assert set(d.keys()) == expected_keys

    def test_to_dict_values(self, sample_verified_source):
        d = sample_verified_source.to_dict()
        assert d["url"] == "https://example.com/rapport/2026"
        assert d["domain"] == "example.com"
        assert d["http_status"] == 200
        assert d["verified"] is True
        assert d["is_deep_link"] is True
        assert isinstance(d["extracted_facts"], list)
        assert len(d["extracted_facts"]) == 2

    def test_to_dict_relevance_mapping(self):
        """relevance_to_article maps to 'relevance' key in dict."""
        vs = VerifiedSource(
            url="https://x.se/a",
            domain="x.se",
            fetched_at=datetime.now(),
            http_status=200,
            extracted_facts=[],
            relevance_to_article="Support claim",
            is_deep_link=False,
            is_verified=False,
        )
        assert vs.to_dict()["relevance"] == "Support claim"


# ── Preflight.to_json ────────────────────────────────────────

class TestPreflightJson:
    def test_round_trip_keys(self, sample_preflight):
        raw = sample_preflight.to_json()
        data = json.loads(raw)
        expected_keys = {
            "job_number", "publisher_domain", "target_url", "anchor_text",
            "language", "risk_level", "semantic_analysis", "verified_sources",
            "constraints", "warnings", "generated_at",
        }
        assert expected_keys == set(data.keys())

    def test_job_fields(self, sample_preflight):
        data = json.loads(sample_preflight.to_json())
        assert data["job_number"] == 1
        assert data["publisher_domain"] == "teknikbloggen.se"
        assert data["anchor_text"] == "lokalvård"

    def test_semantic_analysis_present(self, sample_preflight):
        data = json.loads(sample_preflight.to_json())
        sa = data["semantic_analysis"]
        assert sa is not None
        assert sa["distance_category"] == "moderate"
        assert 0.0 <= sa["raw_distance"] <= 1.0
        assert "trust_link_topics" in sa
        assert "forbidden_entities" in sa

    def test_no_bridge_yields_null_semantic(self, sample_job):
        pf = Preflight(job=sample_job)
        data = json.loads(pf.to_json())
        assert data["semantic_analysis"] is None

    def test_verified_sources_with_data(self, sample_preflight, sample_verified_source):
        sample_preflight.sources = SourceVerificationResult(
            job_number=1,
            verified_sources=[sample_verified_source],
            verification_complete=True,
        )
        data = json.loads(sample_preflight.to_json())
        assert data["verified_sources"] is not None
        assert len(data["verified_sources"]) == 1
        assert data["verified_sources"][0]["domain"] == "example.com"


# ── TargetIntentProfile ──────────────────────────────────────

class TestTargetIntentProfile:
    def test_has_serp_data_true(self, sample_intent_profile):
        sample_intent_profile.probes_completed = 3
        assert sample_intent_profile.has_serp_data is True

    def test_has_serp_data_false(self, sample_intent_profile):
        sample_intent_profile.probes_completed = 2
        assert sample_intent_profile.has_serp_data is False

    def test_get_all_serp_entities_collects_from_probes(self):
        probe1 = SerpProbe(step=1, step_name="head_entity", query="q1", purpose="p1")
        probe1.entity_overlap_with_target = ["entity_a", "entity_b"]
        probe1.new_entities_discovered = ["entity_c"]

        probe2 = SerpProbe(step=2, step_name="cluster_search", query="q2", purpose="p2")
        probe2.entity_overlap_with_target = ["entity_b"]
        probe2.new_entities_discovered = ["entity_d"]

        profile = TargetIntentProfile(
            target_url="https://example.se",
            core_entities=["entity_e"],
            cluster_entities=["entity_a"],
            probes=[probe1, probe2],
        )
        entities = profile.get_all_serp_entities()
        assert "entity_a" in entities
        assert "entity_b" in entities
        assert "entity_c" in entities
        assert "entity_d" in entities
        assert "entity_e" in entities
        # sorted and deduplicated
        assert entities == sorted(set(entities))
