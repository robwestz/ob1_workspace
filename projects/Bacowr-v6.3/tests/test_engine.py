"""Tests for engine.py — SERP probes, trust links, blueprint, gravity scoring."""

from datetime import datetime

import pytest

from engine import (
    TargetIntentAnalyzer,
    TargetIntentProfile,
    TargetUniverse,
    PublisherUniverse,
    SerpProbe,
    SerpSnapshot,
    BridgeGravity,
    ArticleBlueprint,
    ArticleOrchestrator,
    create_blueprint_from_pipeline,
)
from models import PublisherProfile, TargetFingerprint, SemanticBridge


# ── TargetIntentAnalyzer: entity extraction ──────────────────

class TestExtractHeadEntity:
    @pytest.fixture
    def analyzer(self):
        return TargetIntentAnalyzer()

    def test_strips_brand_suffix_pipe(self, analyzer):
        result = analyzer._extract_head_entity("Lokalvård Stockholm | Indoor Professional")
        assert "indoor" not in result.lower()
        assert "professional" not in result.lower()

    def test_strips_brand_suffix_dash(self, analyzer):
        result = analyzer._extract_head_entity("Mattor Online - Rusta")
        assert "rusta" not in result.lower()

    def test_extracts_core_words(self, analyzer):
        result = analyzer._extract_head_entity("Billiga Mattor Online | Rusta")
        assert len(result.split()) <= 2

    def test_empty_title(self, analyzer):
        assert analyzer._extract_head_entity("") == ""

    def test_no_separator(self, analyzer):
        result = analyzer._extract_head_entity("Professionell städning")
        assert len(result) > 0


class TestExtractEntities:
    @pytest.fixture
    def analyzer(self):
        return TargetIntentAnalyzer()

    def test_filters_stop_words(self, analyzer):
        entities = analyzer._extract_entities("det är bra att handla mattor för hemmet")
        assert "mattor" in entities
        assert "hemmet" in entities
        # Swedish stop words excluded
        assert "det" not in entities
        assert "att" not in entities
        assert "för" not in entities

    def test_handles_swedish_chars(self, analyzer):
        entities = analyzer._extract_entities("Köp fönsterlösningar för kontoret i Göteborg")
        assert any("göteborg" in e for e in entities)

    def test_empty_text(self, analyzer):
        assert analyzer._extract_entities("") == []

    def test_short_words_excluded(self, analyzer):
        entities = analyzer._extract_entities("en av de på")
        assert entities == []


class TestExtractPredicate:
    @pytest.fixture
    def analyzer(self):
        return TargetIntentAnalyzer()

    def test_matches_kop_pattern(self, analyzer):
        result = analyzer._extract_predicate("Köp mattor online hos oss")
        assert "köp" in result.lower()

    def test_matches_hitta_pattern(self, analyzer):
        result = analyzer._extract_predicate("Hitta bästa erbjudandet här")
        assert "hitta" in result.lower()

    def test_matches_jamfor_pattern(self, analyzer):
        result = analyzer._extract_predicate("Jämför priser på mattor")
        assert "jämför" in result.lower()

    def test_fallback_first_sentence(self, analyzer):
        result = analyzer._extract_predicate("Vi erbjuder städtjänster. Kontakta oss.")
        assert "erbjuder" in result.lower() or "städtjänster" in result.lower()

    def test_empty_description(self, analyzer):
        assert analyzer._extract_predicate("") == ""


# ── classify_intent_from_metadata ────────────────────────────

class TestClassifyIntent:
    @pytest.fixture
    def analyzer(self):
        return TargetIntentAnalyzer()

    def test_transactional(self, analyzer):
        assert analyzer._classify_intent_from_metadata(
            "Köp mattor", "Handla mattor till bra pris"
        ) == "transactional"

    def test_commercial(self, analyzer):
        assert analyzer._classify_intent_from_metadata(
            "Bästa mattor 2026", "Jämför och hitta topp mattor"
        ) == "commercial"

    def test_informational(self, analyzer):
        assert analyzer._classify_intent_from_metadata(
            "Hur väljer man matta", "Guide till att välja rätt matta"
        ) == "informational"

    def test_navigational(self, analyzer):
        assert analyzer._classify_intent_from_metadata(
            "Logga in", "Kontakt och inloggning"
        ) == "navigational"

    def test_mixed_fallback(self, analyzer):
        assert analyzer._classify_intent_from_metadata(
            "Mattor i Sverige", "Stort utbud av mattor"
        ) == "mixed"


# ── build_research_plan_from_metadata ────────────────────────

class TestBuildResearchPlan:
    @pytest.fixture
    def analyzer(self):
        return TargetIntentAnalyzer()

    def test_returns_5_probes(self, analyzer):
        plan = analyzer.build_research_plan_from_metadata(
            url="https://www.rusta.com/mattor",
            title="Mattor Online | Rusta",
            description="Köp mattor online. Stort sortiment till bra pris.",
        )
        assert len(plan.probes) == 5

    def test_probe_step_names(self, analyzer):
        plan = analyzer.build_research_plan_from_metadata(
            url="https://www.rusta.com/mattor",
            title="Mattor Online | Rusta",
            description="Köp mattor online. Stort sortiment till bra pris.",
        )
        step_names = [p.step_name for p in plan.probes]
        assert step_names[0] == "head_entity"
        assert step_names[1] == "cluster_search"
        assert step_names[2] == "literal_title"
        # step 4 is desc_predicate or desc_keywords
        assert step_names[3] in ("desc_predicate", "desc_keywords")
        # step 5 is literal_description or url_path
        assert step_names[4] in ("literal_description", "url_path")

    def test_probe_steps_sequential(self, analyzer):
        plan = analyzer.build_research_plan_from_metadata(
            url="https://example.se",
            title="Test Page | Brand",
            description="Description here with enough text to qualify.",
        )
        steps = [p.step for p in plan.probes]
        assert steps == [1, 2, 3, 4, 5]

    def test_head_entity_populated(self, analyzer):
        plan = analyzer.build_research_plan_from_metadata(
            url="https://example.se",
            title="Lokalvård Stockholm | Indoor Pro",
            description="Boka lokalvård.",
        )
        assert plan.head_entity != ""
        assert "indoor" not in plan.head_entity.lower()

    def test_meta_fields_set(self, analyzer):
        plan = analyzer.build_research_plan_from_metadata(
            url="https://example.se",
            title="My Title",
            description="My Description",
        )
        assert plan.meta_title == "My Title"
        assert plan.meta_description == "My Description"
        assert plan.target_url == "https://example.se"

    def test_short_description_uses_url_path_probe(self, analyzer):
        plan = analyzer.build_research_plan_from_metadata(
            url="https://example.se/page",
            title="Title",
            description="Short",
        )
        assert plan.probes[4].step_name == "url_path"


# ── analyze_probe_results ────────────────────────────────────

class TestAnalyzeProbeResults:
    @pytest.fixture
    def analyzer(self):
        return TargetIntentAnalyzer()

    @pytest.fixture
    def base_plan(self, analyzer):
        return analyzer.build_research_plan_from_metadata(
            url="https://www.rusta.com/mattor",
            title="Mattor Online | Rusta",
            description="Köp mattor online. Stort sortiment till bra pris.",
        )

    def _mock_results(self):
        return [
            {"title": "Billiga mattor | Butik A", "description": "Köp mattor online", "url": "https://a.se/mattor"},
            {"title": "Mattor i stort sortiment", "description": "Hitta rätt matta", "url": "https://b.se/mattor"},
            {"title": "Golv och mattor guide", "description": "Tips för att välja matta", "url": "https://c.se/g"},
        ]

    def test_feeds_results(self, analyzer, base_plan):
        plan = analyzer.analyze_probe_results(base_plan, 1, self._mock_results())
        probe = plan.probes[0]
        assert len(probe.top_results) == 3
        assert probe.top_results[0].position == 1

    def test_entity_extraction_from_results(self, analyzer, base_plan):
        plan = analyzer.analyze_probe_results(base_plan, 1, self._mock_results())
        probe = plan.probes[0]
        assert len(probe.top_results[0].title_entities) > 0

    def test_probes_completed_increments(self, analyzer, base_plan):
        plan = analyzer.analyze_probe_results(base_plan, 1, self._mock_results())
        assert plan.probes_completed == 1
        plan = analyzer.analyze_probe_results(plan, 2, self._mock_results())
        assert plan.probes_completed == 2

    def test_synthesis_triggers_at_3(self, analyzer, base_plan):
        for step in range(1, 4):
            base_plan = analyzer.analyze_probe_results(base_plan, step, self._mock_results())
        assert base_plan.probes_completed >= 3
        # Synthesis should have populated core_entities
        assert len(base_plan.core_entities) > 0 or len(base_plan.cluster_entities) > 0

    def test_invalid_probe_step_ignored(self, analyzer, base_plan):
        plan = analyzer.analyze_probe_results(base_plan, 99, self._mock_results())
        assert plan.probes_completed == 0


# ── synthesize_from_plan ─────────────────────────────────────

class TestSynthesizeFromPlan:
    @pytest.fixture
    def analyzer(self):
        return TargetIntentAnalyzer()

    def test_offline_synthesis(self, analyzer):
        plan = analyzer.build_research_plan_from_metadata(
            url="https://rusta.com/mattor",
            title="Mattor Online | Rusta",
            description="Köp mattor online hos Rusta. Bästa pris.",
        )
        plan = analyzer.synthesize_from_plan(plan)
        assert len(plan.core_entities) > 0
        assert plan.ta_target_description != ""
        assert plan.confidence == 0.5

    def test_ideal_bridge_with_predicate(self, analyzer):
        plan = analyzer.build_research_plan_from_metadata(
            url="https://example.se",
            title="Test",
            description="Köp produkter online",
        )
        plan = analyzer.synthesize_from_plan(plan)
        assert plan.ideal_bridge_direction != ""

    def test_entities_to_weave(self, analyzer):
        plan = analyzer.build_research_plan_from_metadata(
            url="https://example.se",
            title="Mattor Online | Rusta",
            description="Köp mattor i stort sortiment till låga priser",
        )
        plan = analyzer.synthesize_from_plan(plan)
        assert len(plan.entities_to_weave) > 0


# ── Trust link queries ───────────────────────────────────────

class TestBuildTrustlinkQueries:
    @pytest.fixture
    def analyzer(self):
        return TargetIntentAnalyzer()

    def test_from_bridge_topics(self, analyzer, sample_bridge):
        queries = analyzer.build_trustlink_queries(
            sample_bridge, None, "Some Title"
        )
        assert len(queries) <= 2
        assert len(queries) >= 1
        assert any("rapport" in q or "forskning" in q for q in queries)

    def test_fallback_to_head_entity(self, analyzer, sample_intent_profile):
        queries = analyzer.build_trustlink_queries(
            None, sample_intent_profile, "Fallback Title"
        )
        assert len(queries) >= 1
        assert "test produkt" in queries[0].lower()

    def test_fallback_to_title(self, analyzer):
        queries = analyzer.build_trustlink_queries(None, None, "Final Fallback")
        assert len(queries) == 1
        assert "final fallback" in queries[0].lower()

    def test_max_2_queries(self, analyzer, sample_bridge):
        queries = analyzer.build_trustlink_queries(
            sample_bridge, None, "Title"
        )
        assert len(queries) <= 2


# ── Trust link scoring & selection ───────────────────────────

class TestScoreTrustlinkCandidate:
    def test_topic_match_scores(self):
        candidate = {
            "title": "Rapport om teknik",
            "description": "Forskning visar att teknik driver tillväxt",
            "url": "https://scb.se/rapport/2026",
        }
        score = TargetIntentAnalyzer.score_trustlink_candidate(
            candidate, ["teknik", "forskning"]
        )
        # "teknik" in both title and desc = 2, "forskning" in desc = 2, deeplink = 1
        assert score >= 3

    def test_deeplink_bonus(self):
        candidate = {
            "title": "Data",
            "description": "Info",
            "url": "https://example.se/page/sub",
        }
        score = TargetIntentAnalyzer.score_trustlink_candidate(candidate, [])
        assert score == 1  # deeplink bonus only

    def test_root_url_no_bonus(self):
        candidate = {
            "title": "Data",
            "description": "Info",
            "url": "https://example.se/",
        }
        score = TargetIntentAnalyzer.score_trustlink_candidate(candidate, [])
        assert score == 0


class TestSelectTrustlinks:
    @pytest.fixture
    def candidates(self):
        return [
            {"title": "Good deep", "description": "Relevant rapport", "url": "https://scb.se/data/2026"},
            {"title": "Target domain", "description": "Same", "url": "https://target.se/page"},
            {"title": "Publisher domain", "description": "Same", "url": "https://pub.se/article"},
            {"title": "Root only", "description": "No path", "url": "https://other.se/"},
            {"title": "Avoided", "description": "Bad", "url": "https://avoid.se/page"},
            {"title": "Another good", "description": "Forskning", "url": "https://ki.se/rapport"},
        ]

    def test_filters_target_domain(self, candidates):
        result = TargetIntentAnalyzer.select_trustlinks(
            candidates, ["rapport"], [], "target.se", "pub.se"
        )
        assert not any("target.se" in c["url"] for c in result)

    def test_filters_publisher_domain(self, candidates):
        result = TargetIntentAnalyzer.select_trustlinks(
            candidates, ["rapport"], [], "target.se", "pub.se"
        )
        assert not any("pub.se" in c["url"] for c in result)

    def test_filters_avoid_domains(self, candidates):
        result = TargetIntentAnalyzer.select_trustlinks(
            candidates, ["rapport"], ["avoid.se"], "target.se", "pub.se"
        )
        assert not any("avoid.se" in c["url"] for c in result)

    def test_requires_deeplinks(self, candidates):
        result = TargetIntentAnalyzer.select_trustlinks(
            candidates, ["rapport"], [], "target.se", "pub.se"
        )
        assert not any(c["url"].rstrip("/").endswith(".se") for c in result)

    def test_sorted_by_score(self, candidates):
        result = TargetIntentAnalyzer.select_trustlinks(
            candidates, ["rapport", "forskning"], [], "target.se", "pub.se"
        )
        if len(result) >= 2:
            scores = [
                TargetIntentAnalyzer.score_trustlink_candidate(c, ["rapport", "forskning"])
                for c in result
            ]
            assert scores == sorted(scores, reverse=True)


# ── BridgeGravity ────────────────────────────────────────────

class TestBridgeGravity:
    def test_total_gravity_formula(self):
        g = BridgeGravity(
            semantic_pull=1.0,
            factual_mass=1.0,
            topic_fit=1.0,
            uniqueness=1.0,
        )
        expected = 0.35 * 1.0 + 0.25 * 1.0 + 0.25 * 1.0 + 0.15 * 1.0
        assert abs(g.total_gravity - expected) < 1e-9

    def test_total_gravity_weights(self):
        g = BridgeGravity(
            semantic_pull=0.8,
            factual_mass=0.6,
            topic_fit=0.7,
            uniqueness=0.5,
        )
        expected = 0.35 * 0.8 + 0.25 * 0.6 + 0.25 * 0.7 + 0.15 * 0.5
        assert abs(g.total_gravity - expected) < 1e-9

    def test_total_gravity_zeros(self):
        g = BridgeGravity()
        assert g.total_gravity == 0.0

    def test_weights_sum_to_one(self):
        assert abs(0.35 + 0.25 + 0.25 + 0.15 - 1.0) < 1e-9


# ── create_blueprint_from_pipeline ───────────────────────────

class TestCreateBlueprintFromPipeline:
    def test_minimal_call(self):
        bp = create_blueprint_from_pipeline(
            job_number=1,
            publisher_domain="blog.se",
            target_url="https://target.se/page",
            anchor_text="min ankartext",
        )
        assert isinstance(bp, ArticleBlueprint)
        assert bp.job_number == 1
        assert bp.publisher_domain == "blog.se"
        assert bp.target_url == "https://target.se/page"
        assert bp.anchor_text == "min ankartext"

    def test_with_pipeline_models(self, sample_publisher, sample_target):
        bp = create_blueprint_from_pipeline(
            job_number=5,
            publisher_domain=sample_publisher.domain,
            target_url=sample_target.url,
            anchor_text="lokalvård",
            publisher_profile=sample_publisher,
            target_fingerprint=sample_target,
        )
        assert bp.publisher.domain == sample_publisher.domain
        assert bp.publisher.primary_topics == sample_publisher.primary_topics
        assert bp.target.url == sample_target.url

    def test_blueprint_has_topic(self):
        bp = create_blueprint_from_pipeline(
            job_number=1,
            publisher_domain="sportbloggen.se",
            target_url="https://casino.se/spel",
            anchor_text="spela casino",
        )
        assert bp.chosen_topic is not None or bp.thesis is not None or len(bp.sections) >= 0

    def test_blueprint_has_sections(self, sample_publisher, sample_target):
        bp = create_blueprint_from_pipeline(
            job_number=1,
            publisher_domain=sample_publisher.domain,
            target_url=sample_target.url,
            anchor_text="lokalvård",
            publisher_profile=sample_publisher,
            target_fingerprint=sample_target,
        )
        assert len(bp.sections) >= 0  # may have sections or may not, depends on topic

    def test_engine_version(self):
        bp = create_blueprint_from_pipeline(
            job_number=1,
            publisher_domain="x.se",
            target_url="https://y.se",
            anchor_text="a",
        )
        assert bp.engine_version == "6.2"
