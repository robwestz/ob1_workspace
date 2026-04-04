"""Tests for engine.py internal components — TopicDiscovery, BridgeGravity,
ThesisForge, SectionPlanner, RedThreadValidator, ConstraintEnforcer,
AgentPromptRenderer.

These components are pure logic (no I/O) and run under create_blueprint.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import (
    TopicDiscoveryEngine,
    BridgeGravityEngine,
    ThesisForge,
    SectionPlanner,
    RedThreadValidator,
    ConstraintEnforcer,
    AgentPromptRenderer,
    ArticleBlueprint,
    ArticleThesis,
    ArticleOrchestrator,
    PublisherUniverse,
    TargetUniverse,
    TargetIntentProfile,
    GapAnalysis,
    ContextBridge,
    BridgeGravity,
    TopicCandidate,
    SectionPlan,
    RedThread,
    ConstraintResult,
    SerpProbe,
    TopicViability,
    BridgeStrength,
    BridgeRole,
    SectionRole,
    AnchorNaturalness,
    ConstraintType,
    SemanticDistance,
    RiskLevel,
)


# ═════════════════════════════════════════════════════════════
# Shared fixtures — built inline from dataclasses, no I/O
# ═════════════════════════════════════════════════════════════

@pytest.fixture
def sport_publisher():
    return PublisherUniverse(
        domain="sportbloggen.se",
        site_name="Sportbloggen",
        primary_topics=["sport", "idrott"],
        secondary_topics=["träning"],
        language="sv",
        confidence=0.7,
    )


@pytest.fixture
def casino_target():
    return TargetUniverse(
        url="https://casino.se/spela",
        title="Spela Casino Online | CasinoSajt",
        h1="Spela Casino",
        meta_description="Spela casino online hos oss. Bästa bonusar.",
        language="sv",
        main_keywords=["casino", "spel", "bonus", "online"],
        topic_cluster=["casino", "underhållning", "spel"],
    )


@pytest.fixture
def moderate_gap():
    return GapAnalysis(
        raw_distance=0.55,
        distance_category=SemanticDistance.MODERATE,
        overlap_entities=["underhållning"],
        gap_entities=["casino", "spel", "bonus"],
        bridge_requirement=1,
        risk_level=RiskLevel.MEDIUM,
        reasoning="Moderate overlap via entertainment angle.",
    )


@pytest.fixture
def unrelated_gap():
    return GapAnalysis(
        raw_distance=0.15,
        distance_category=SemanticDistance.UNRELATED,
        overlap_entities=[],
        gap_entities=["casino", "spel", "bonus"],
        bridge_requirement=2,
        risk_level=RiskLevel.HIGH,
        reasoning="No overlap.",
    )


@pytest.fixture
def sample_bridge():
    return ContextBridge(
        id="bridge_001",
        concept="sportstatistik och realtidsdata",
        search_query="sportstatistik realtidsdata analys",
        reasoning="Known bridge: sport <-> casino",
    )


@pytest.fixture
def sample_bridge_secondary():
    return ContextBridge(
        id="bridge_002",
        concept="fansengagemang digital",
        search_query="digital sport fan engagement",
        reasoning="Supporting bridge.",
    )


@pytest.fixture
def sample_topic(sample_bridge):
    return TopicCandidate(
        id="topic_001",
        topic="Hur realtidsstatistik formade sportvärlden",
        viability=TopicViability.GOOD,
        viability_score=0.6,
        publisher_fit=0.7,
        target_proximity=0.4,
        bridges_available=[sample_bridge],
        thesis_seed="Sportstatistikens intåg har förändrat hur vi konsumerar idrott.",
        reasoning="Bridge pattern match: (sport, casino)",
    )


@pytest.fixture
def sample_thesis():
    return ArticleThesis(
        statement="Sportstatistikens intåg har förändrat hur vi konsumerar idrott och underhållning.",
        drives_sections=["establish", "deepen", "bridge", "anchor"],
        anchor_integration="Ankarlänken placeras i kontexten av digital underhållning",
        naturalness=AnchorNaturalness.NATURAL,
        confidence=0.7,
    )


@pytest.fixture
def well_formed_sections():
    """6 sections with proper connections, matching SectionPlanner output."""
    return [
        SectionPlan(order=1, role=SectionRole.HOOK,
                    working_title="Hook",
                    purpose="Öppning",
                    connects_to_previous="(Öppning)",
                    connects_to_next="Pekar mot fördjupning",
                    target_words=150),
        SectionPlan(order=2, role=SectionRole.ESTABLISH,
                    working_title="Establish",
                    purpose="Bakgrund",
                    connects_to_previous="Bygger på hooken",
                    connects_to_next="Leder till insikt",
                    target_words=140, contains_bridge="bridge_001"),
        SectionPlan(order=3, role=SectionRole.DEEPEN,
                    working_title="Deepen",
                    purpose="Fördjupning",
                    connects_to_previous="Tar insikten vidare",
                    connects_to_next="Öppnar för praktisk dimension",
                    target_words=140),
        SectionPlan(order=4, role=SectionRole.ANCHOR,
                    working_title="Anchor",
                    purpose="Ankarlänk",
                    connects_to_previous="Konkret dimension",
                    connects_to_next="Pekar framåt",
                    target_words=140, contains_anchor=True),
        SectionPlan(order=5, role=SectionRole.PIVOT,
                    working_title="Pivot",
                    purpose="Ny vinkel",
                    connects_to_previous="Bygger på ankar-sektionen",
                    connects_to_next="Leder till avslut",
                    target_words=140),
        SectionPlan(order=6, role=SectionRole.RESOLVE,
                    working_title="Resolve",
                    purpose="Avslut",
                    connects_to_previous="Samlar trådarna",
                    connects_to_next="(Sista sektionen)",
                    target_words=100),
    ]


@pytest.fixture
def complete_blueprint(sport_publisher, casino_target, moderate_gap,
                       sample_topic, sample_bridge, sample_thesis,
                       well_formed_sections):
    rt = RedThread(is_coherent=True, thesis_coverage=0.83,
                   reasoning="All checks passed")
    bp = ArticleBlueprint(
        job_number=1,
        publisher_domain="sportbloggen.se",
        target_url="https://casino.se/spela",
        anchor_text="spela casino",
        language="sv",
        publisher=sport_publisher,
        target=casino_target,
        gap=moderate_gap,
        chosen_topic=sample_topic,
        bridges=[sample_bridge],
        thesis=sample_thesis,
        sections=well_formed_sections,
        red_thread=rt,
    )
    return bp


# ═════════════════════════════════════════════════════════════
# TopicDiscoveryEngine.discover()
# ═════════════════════════════════════════════════════════════

class TestTopicDiscoveryDiscover:
    @pytest.fixture
    def engine(self):
        return TopicDiscoveryEngine()

    def test_returns_at_least_one_candidate(self, engine, sport_publisher,
                                            casino_target, moderate_gap):
        candidates = engine.discover(
            sport_publisher, casino_target, moderate_gap, "spela casino"
        )
        assert len(candidates) >= 1
        assert all(isinstance(c, TopicCandidate) for c in candidates)

    def test_sorted_by_composite_score(self, engine, sport_publisher,
                                       casino_target, moderate_gap):
        candidates = engine.discover(
            sport_publisher, casino_target, moderate_gap, "spela casino"
        )
        scores = [c.composite_score for c in candidates]
        assert scores == sorted(scores, reverse=True)

    def test_each_candidate_has_valid_viability(self, engine, sport_publisher,
                                                 casino_target, moderate_gap):
        candidates = engine.discover(
            sport_publisher, casino_target, moderate_gap, "spela casino"
        )
        for c in candidates:
            assert isinstance(c.viability, TopicViability)

    def test_overlap_entities_generate_candidates(self, engine, sport_publisher,
                                                   casino_target, moderate_gap):
        """Gap with overlap_entities should produce overlap-based candidates."""
        gap_with_overlap = GapAnalysis(
            raw_distance=0.65,
            distance_category=SemanticDistance.MODERATE,
            overlap_entities=["underhållning", "statistik"],
            gap_entities=["casino"],
            bridge_requirement=1,
            risk_level=RiskLevel.MEDIUM,
            reasoning="Overlap via underhållning.",
        )
        candidates = engine.discover(
            sport_publisher, casino_target, gap_with_overlap, "spela casino"
        )
        # Should have some candidates with overlap-derived reasoning
        assert len(candidates) >= 1

    def test_bridge_patterns_match_sport_casino(self, engine, sport_publisher,
                                                 casino_target, moderate_gap):
        """Known BRIDGE_PATTERNS for (sport, casino) should produce candidates."""
        candidates = engine.discover(
            sport_publisher, casino_target, moderate_gap, "spela casino"
        )
        # At least one candidate should come from bridge pattern matching
        pattern_candidates = [
            c for c in candidates
            if "Bridge pattern" in c.reasoning or "SERP" in c.reasoning
               or "Publisher-first" in c.reasoning
        ]
        assert len(pattern_candidates) >= 1


# ═════════════════════════════════════════════════════════════
# BridgeGravityEngine.score_bridges()
# ═════════════════════════════════════════════════════════════

class TestBridgeGravityScoreBridges:
    @pytest.fixture
    def engine(self):
        return BridgeGravityEngine()

    def test_populates_gravity_components(self, engine, sport_publisher,
                                          casino_target, moderate_gap,
                                          sample_bridge):
        scored = engine.score_bridges(
            [sample_bridge], sport_publisher, casino_target, moderate_gap
        )
        b = scored[0]
        # All four components should be populated (>= 0)
        assert b.gravity.semantic_pull >= 0
        assert b.gravity.factual_mass >= 0
        assert b.gravity.topic_fit >= 0
        assert b.gravity.uniqueness >= 0

    def test_classifies_strength(self, engine, sport_publisher,
                                  casino_target, moderate_gap, sample_bridge):
        scored = engine.score_bridges(
            [sample_bridge], sport_publisher, casino_target, moderate_gap
        )
        assert isinstance(scored[0].strength, BridgeStrength)

    def test_assigns_roles(self, engine, sport_publisher, casino_target,
                            moderate_gap, sample_bridge, sample_bridge_secondary):
        scored = engine.score_bridges(
            [sample_bridge, sample_bridge_secondary],
            sport_publisher, casino_target, moderate_gap,
        )
        roles = [b.role for b in scored]
        assert BridgeRole.PRIMARY in roles

    def test_sorts_by_total_gravity(self, engine, sport_publisher,
                                     casino_target, moderate_gap,
                                     sample_bridge, sample_bridge_secondary):
        scored = engine.score_bridges(
            [sample_bridge, sample_bridge_secondary],
            sport_publisher, casino_target, moderate_gap,
        )
        scores = [b.score for b in scored]
        assert scores == sorted(scores, reverse=True)

    def test_unverified_bridge_default_factual_mass(self, engine, sport_publisher,
                                                     casino_target, moderate_gap):
        bridge = ContextBridge(
            id="unverified", concept="test brygga",
            search_query="test", is_verified=False,
        )
        scored = engine.score_bridges(
            [bridge], sport_publisher, casino_target, moderate_gap
        )
        assert scored[0].gravity.factual_mass == 0.3


# ═════════════════════════════════════════════════════════════
# ThesisForge.forge()
# ═════════════════════════════════════════════════════════════

class TestThesisForgeForge:
    @pytest.fixture
    def forge(self):
        return ThesisForge()

    def test_returns_at_least_one_thesis(self, forge, sample_topic,
                                          sport_publisher, casino_target,
                                          sample_bridge):
        theses = forge.forge(
            sample_topic, sport_publisher, casino_target,
            [sample_bridge], "spela casino",
        )
        assert len(theses) >= 1
        assert all(isinstance(t, ArticleThesis) for t in theses)

    def test_sorted_by_confidence(self, forge, sample_topic,
                                   sport_publisher, casino_target,
                                   sample_bridge):
        theses = forge.forge(
            sample_topic, sport_publisher, casino_target,
            [sample_bridge], "spela casino",
        )
        confidences = [t.confidence for t in theses]
        assert confidences == sorted(confidences, reverse=True)

    def test_each_thesis_has_naturalness(self, forge, sample_topic,
                                          sport_publisher, casino_target,
                                          sample_bridge):
        theses = forge.forge(
            sample_topic, sport_publisher, casino_target,
            [sample_bridge], "spela casino",
        )
        for t in theses:
            assert isinstance(t.naturalness, AnchorNaturalness)

    def test_max_three_theses(self, forge, sample_topic, sport_publisher,
                               casino_target, sample_bridge):
        theses = forge.forge(
            sample_topic, sport_publisher, casino_target,
            [sample_bridge], "spela casino",
        )
        assert len(theses) <= 3


# ═════════════════════════════════════════════════════════════
# SectionPlanner.plan()
# ═════════════════════════════════════════════════════════════

class TestSectionPlannerPlan:
    @pytest.fixture
    def planner(self):
        return SectionPlanner()

    def test_returns_six_sections(self, planner, sample_thesis, sample_topic,
                                   sample_bridge):
        sections = planner.plan(
            sample_thesis, sample_topic, [sample_bridge], "spela casino"
        )
        assert len(sections) == 6

    def test_roles_in_order(self, planner, sample_thesis, sample_topic,
                             sample_bridge):
        sections = planner.plan(
            sample_thesis, sample_topic, [sample_bridge], "spela casino"
        )
        expected_roles = [
            SectionRole.HOOK,
            SectionRole.ESTABLISH,
            SectionRole.DEEPEN,
            SectionRole.ANCHOR,
            SectionRole.PIVOT,
            SectionRole.RESOLVE,
        ]
        actual_roles = [s.role for s in sections]
        assert actual_roles == expected_roles

    def test_section_4_contains_anchor(self, planner, sample_thesis,
                                        sample_topic, sample_bridge):
        sections = planner.plan(
            sample_thesis, sample_topic, [sample_bridge], "spela casino"
        )
        assert sections[3].contains_anchor is True

    def test_first_and_last_no_anchor(self, planner, sample_thesis,
                                       sample_topic, sample_bridge):
        sections = planner.plan(
            sample_thesis, sample_topic, [sample_bridge], "spela casino"
        )
        assert sections[0].contains_anchor is False
        assert sections[-1].contains_anchor is False


# ═════════════════════════════════════════════════════════════
# RedThreadValidator.validate()
# ═════════════════════════════════════════════════════════════

class TestRedThreadValidatorValidate:
    @pytest.fixture
    def validator(self):
        return RedThreadValidator()

    def test_well_formed_sections_coherent(self, validator, sample_thesis,
                                            well_formed_sections):
        result = validator.validate(well_formed_sections, sample_thesis)
        assert result.is_coherent is True
        assert len(result.dead_ends) == 0
        assert len(result.orphan_sections) == 0

    def test_too_few_sections_not_coherent(self, validator, sample_thesis):
        short = [
            SectionPlan(order=1, role=SectionRole.HOOK,
                        working_title="H", purpose="P",
                        connects_to_previous="X", connects_to_next="Y",
                        target_words=200),
            SectionPlan(order=2, role=SectionRole.RESOLVE,
                        working_title="R", purpose="P",
                        connects_to_previous="X", connects_to_next="",
                        target_words=200),
        ]
        result = validator.validate(short, sample_thesis)
        assert "Too few sections" in result.reasoning

    def test_dead_end_detected(self, validator, sample_thesis):
        """Section with empty connects_to_next (not last) → dead end."""
        sections = [
            SectionPlan(order=1, role=SectionRole.HOOK,
                        working_title="H", purpose="P",
                        connects_to_previous="(Öppning)",
                        connects_to_next="",  # dead end!
                        target_words=150),
            SectionPlan(order=2, role=SectionRole.ESTABLISH,
                        working_title="E", purpose="P",
                        connects_to_previous="From hook",
                        connects_to_next="Next",
                        target_words=150),
            SectionPlan(order=3, role=SectionRole.DEEPEN,
                        working_title="D", purpose="P",
                        connects_to_previous="From est",
                        connects_to_next="Next",
                        target_words=150),
            SectionPlan(order=4, role=SectionRole.RESOLVE,
                        working_title="R", purpose="P",
                        connects_to_previous="From deep",
                        connects_to_next="(Sista)",
                        target_words=100),
        ]
        result = validator.validate(sections, sample_thesis)
        assert 0 in result.dead_ends

    def test_orphan_detected(self, validator, sample_thesis):
        """Section with empty connects_to_previous (not first) → orphan."""
        sections = [
            SectionPlan(order=1, role=SectionRole.HOOK,
                        working_title="H", purpose="P",
                        connects_to_previous="(Öppning)",
                        connects_to_next="Pekar framåt",
                        target_words=150),
            SectionPlan(order=2, role=SectionRole.ESTABLISH,
                        working_title="E", purpose="P",
                        connects_to_previous="",  # orphan!
                        connects_to_next="Next",
                        target_words=150),
            SectionPlan(order=3, role=SectionRole.DEEPEN,
                        working_title="D", purpose="P",
                        connects_to_previous="From est",
                        connects_to_next="Next",
                        target_words=150),
            SectionPlan(order=4, role=SectionRole.RESOLVE,
                        working_title="R", purpose="P",
                        connects_to_previous="From deep",
                        connects_to_next="(Sista)",
                        target_words=100),
        ]
        result = validator.validate(sections, sample_thesis)
        assert 1 in result.orphan_sections


# ═════════════════════════════════════════════════════════════
# ConstraintEnforcer.check_blueprint()
# ═════════════════════════════════════════════════════════════

class TestConstraintEnforcerCheckBlueprint:
    @pytest.fixture
    def enforcer(self):
        return ConstraintEnforcer()

    def test_complete_blueprint_all_hard_pass(self, enforcer, complete_blueprint):
        results = enforcer.check_blueprint(complete_blueprint)
        hard_results = [r for r in results if r.constraint_type == ConstraintType.HARD]
        for r in hard_results:
            assert r.passed, f"HARD constraint '{r.name}' failed: {r.message}"

    def test_no_thesis_fails(self, enforcer, complete_blueprint):
        complete_blueprint.thesis = None
        results = enforcer.check_blueprint(complete_blueprint)
        thesis_check = next(r for r in results if r.name == "thesis_exists")
        assert thesis_check.passed is False

    def test_anchor_in_intro_fails(self, enforcer, complete_blueprint):
        """Anchor in section 1 should fail anchor_not_in_intro."""
        complete_blueprint.sections[0].contains_anchor = True
        complete_blueprint.sections[3].contains_anchor = False
        results = enforcer.check_blueprint(complete_blueprint)
        intro_check = next(r for r in results if r.name == "anchor_not_in_intro")
        assert intro_check.passed is False

    def test_no_bridges_fails(self, enforcer, complete_blueprint):
        complete_blueprint.bridges = []
        results = enforcer.check_blueprint(complete_blueprint)
        bridge_check = next(r for r in results if r.name == "context_bridges_planned")
        assert bridge_check.passed is False


# ═════════════════════════════════════════════════════════════
# AgentPromptRenderer.render()
# ═════════════════════════════════════════════════════════════

class TestAgentPromptRendererRender:
    def test_returns_non_empty(self, complete_blueprint):
        result = AgentPromptRenderer.render(complete_blueprint)
        assert isinstance(result, str)
        assert len(result) > 100

    def test_contains_key_info(self, complete_blueprint):
        result = AgentPromptRenderer.render(complete_blueprint)
        assert complete_blueprint.anchor_text in result
        assert complete_blueprint.target_url in result
        # Should contain rule references
        assert "750" in result
        assert "900" in result

    def test_matches_to_agent_prompt(self, complete_blueprint):
        rendered = AgentPromptRenderer.render(complete_blueprint)
        via_method = complete_blueprint.to_agent_prompt()
        assert rendered == via_method
