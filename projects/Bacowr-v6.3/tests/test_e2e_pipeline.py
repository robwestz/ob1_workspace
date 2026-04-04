"""End-to-end pipeline tests: CSV → Preflight → Blueprint.

Verifies the full chain produces valid output for jobs 1–5
from textjobs_list.csv.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import Pipeline, PipelineConfig, _normalize_job
from models import JobSpec
from engine import (
    ArticleBlueprint,
    ArticleOrchestrator,
    TargetIntentAnalyzer,
    TargetIntentProfile,
    create_blueprint_from_pipeline,
)


PROJECT_ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = PROJECT_ROOT / "textjobs_list.csv"


@pytest.fixture(scope="module")
def pipeline():
    config = PipelineConfig(csv_path=str(CSV_PATH))
    return Pipeline(config)


@pytest.fixture(scope="module")
def all_jobs(pipeline):
    return pipeline.load_jobs(str(CSV_PATH))


@pytest.fixture(scope="module")
def first_five(all_jobs):
    return all_jobs[:5]


# ── Pipeline CSV loading ─────────────────────────────────────

class TestCSVLoading:
    def test_loads_20_jobs(self, all_jobs):
        assert len(all_jobs) == 20

    def test_first_five_correct_fields(self, first_five):
        expected = [
            (1, "fragbite.se", "https://verajohn.se/casino", "online casino"),
            (2, "bulletin.nu", "https://luckycasino.com/sv/", "Lucky Casino"),
            (3, "bettingsyndikatet.se", "https://luckycasino.com/sv/", "casino online"),
            (4, "fragbite.se", "https://www.bethard.com/sv/sports/esports", "betting på esport"),
            (5, "spelapoker.se", "https://spelklubben.se/sv", "spelklubben"),
        ]
        for job, (num, pub, target, anchor) in zip(first_five, expected):
            assert job.job_number == num
            assert job.publisher_domain == pub, f"Job {num}: publisher"
            assert job.target_url == target, f"Job {num}: target_url"
            assert job.anchor_text == anchor, f"Job {num}: anchor_text"

    def test_all_jobs_have_required_fields(self, all_jobs):
        for job in all_jobs:
            assert job.job_number > 0
            assert len(job.publisher_domain) > 0
            assert job.target_url.startswith("http")
            assert len(job.anchor_text) > 0


class TestURLNormalization:
    def test_fixes_missing_slash_in_https(self):
        row = {
            "job_id": "5",
            "publication_domain": "spelapoker.se",
            "target_url": "https:/spelklubben.se/sv",
            "anchor_text": "spelklubben",
        }
        norm = _normalize_job(row)
        assert norm["target_url"] == "https://spelklubben.se/sv"

    def test_fixes_missing_slash_in_http(self):
        row = {
            "job_id": "99",
            "publication_domain": "test.se",
            "target_url": "http:/example.se/page",
            "anchor_text": "test",
        }
        norm = _normalize_job(row)
        assert norm["target_url"] == "http://example.se/page"

    def test_normal_url_unchanged(self):
        row = {
            "job_id": "1",
            "publication_domain": "fragbite.se",
            "target_url": "https://verajohn.se/casino",
            "anchor_text": "casino",
        }
        norm = _normalize_job(row)
        assert norm["target_url"] == "https://verajohn.se/casino"

    def test_job5_from_csv_is_normalized(self, first_five):
        """Job 5 in real CSV has 'https:/spelklubben.se/sv' — should be fixed."""
        job5 = first_five[4]
        assert job5.target_url == "https://spelklubben.se/sv"
        assert "https://" in job5.target_url


# ── Blueprint completeness ───────────────────────────────────

class TestBlueprintCompleteness:
    """create_blueprint_from_pipeline should produce complete blueprints."""

    @pytest.fixture(scope="class")
    def blueprints(self, first_five):
        bps = []
        for job in first_five:
            bp = create_blueprint_from_pipeline(
                job_number=job.job_number,
                publisher_domain=job.publisher_domain,
                target_url=job.target_url,
                anchor_text=job.anchor_text,
            )
            bps.append(bp)
        return bps

    def test_returns_article_blueprint(self, blueprints):
        for bp in blueprints:
            assert isinstance(bp, ArticleBlueprint)

    def test_chosen_topic_not_none(self, blueprints):
        for bp in blueprints:
            assert bp.chosen_topic is not None, (
                f"Job {bp.job_number}: chosen_topic is None"
            )

    def test_thesis_not_none(self, blueprints):
        for bp in blueprints:
            assert bp.thesis is not None, (
                f"Job {bp.job_number}: thesis is None"
            )

    def test_sections_at_least_4(self, blueprints):
        for bp in blueprints:
            assert len(bp.sections) >= 4, (
                f"Job {bp.job_number}: only {len(bp.sections)} sections"
            )

    def test_one_section_contains_anchor(self, blueprints):
        for bp in blueprints:
            anchor_sections = [s for s in bp.sections if s.contains_anchor]
            assert len(anchor_sections) >= 1, (
                f"Job {bp.job_number}: no section has contains_anchor=True"
            )

    def test_engine_version(self, blueprints):
        for bp in blueprints:
            assert bp.engine_version == "6.2"

    def test_language_detection(self, blueprints, first_five):
        """Jobs 1-5 are all .se/.nu domains → expect 'sv'."""
        for bp, job in zip(blueprints, first_five):
            assert bp.language == "sv", (
                f"Job {bp.job_number} ({job.publisher_domain}): "
                f"expected 'sv' but got '{bp.language}'"
            )

    def test_anchor_text_preserved(self, blueprints, first_five):
        for bp, job in zip(blueprints, first_five):
            assert bp.anchor_text == job.anchor_text

    def test_target_url_preserved(self, blueprints, first_five):
        for bp, job in zip(blueprints, first_five):
            assert bp.target_url == job.target_url


# ── English language detection ───────────────────────────────

class TestEnglishBlueprints:
    @pytest.fixture
    def english_job(self):
        return JobSpec(
            job_number=19,
            publisher_domain="bettingkingdom.co.uk",
            target_url="https://www.mrvegas.com/",
            anchor_text="MrVegas",
        )

    def test_co_uk_domain_gets_english(self, english_job):
        bp = create_blueprint_from_pipeline(
            job_number=english_job.job_number,
            publisher_domain=english_job.publisher_domain,
            target_url=english_job.target_url,
            anchor_text=english_job.anchor_text,
        )
        assert bp.language == "en"


# ── SERP research plan ──────────────────────────────────────

class TestSERPPlan:
    @pytest.fixture
    def analyzer(self):
        return TargetIntentAnalyzer()

    @pytest.mark.parametrize("title,desc", [
        ("Verajohn Casino Online", "Spela online casino hos Vera&John"),
        ("Lucky Casino - Spela Slots & Live Casino", "Ditt bästa online casino"),
        ("Bethard Esports Betting", "Bästa esport odds online"),
        ("Spelklubben Casino", "Spela casino online hos Spelklubben"),
        ("Lokalvård Stockholm | Indoor Professional", "Professionell lokalvård i Stockholm"),
    ])
    def test_five_probes_generated(self, analyzer, title, desc):
        plan = analyzer.build_research_plan_from_metadata(
            url="https://example.se/page",
            title=title,
            description=desc,
        )
        assert len(plan.probes) == 5, f"Expected 5 probes for '{title}'"

    def test_head_entity_extracted(self, analyzer):
        plan = analyzer.build_research_plan_from_metadata(
            url="https://verajohn.se/casino",
            title="Verajohn Casino Online",
            description="Spela casino hos Vera&John.",
        )
        assert plan.head_entity, "head_entity should not be empty"
        assert len(plan.head_entity.split()) <= 3


# ── Trust link queries ───────────────────────────────────────

class TestTrustLinkQueries:
    @pytest.fixture
    def analyzer(self):
        return TargetIntentAnalyzer()

    def test_produces_queries_from_bridge(self, analyzer, sample_bridge):
        plan = analyzer.build_research_plan_from_metadata(
            url="https://example.se/page",
            title="Test Titel",
            description="Test beskrivning",
        )
        queries = analyzer.build_trustlink_queries(
            sample_bridge, plan, "Test Titel"
        )
        assert 1 <= len(queries) <= 2

    def test_queries_dont_contain_target_domain(self, analyzer, sample_bridge):
        plan = analyzer.build_research_plan_from_metadata(
            url="https://example.se/page",
            title="Test Titel",
            description="Test beskrivning",
        )
        queries = analyzer.build_trustlink_queries(
            sample_bridge, plan, "Test Titel"
        )
        for q in queries:
            assert "indoorprofessional.se" not in q.lower()

    def test_fallback_to_head_entity(self, analyzer):
        plan = analyzer.build_research_plan_from_metadata(
            url="https://verajohn.se/casino",
            title="Casino Online",
            description="Spela casino.",
        )
        queries = analyzer.build_trustlink_queries(None, plan, "Casino Online")
        assert len(queries) >= 1
        # Should use head entity or title as fallback
        assert any(
            plan.head_entity.lower() in q.lower() or "casino" in q.lower()
            for q in queries
        )

    def test_fallback_to_title(self, analyzer):
        queries = analyzer.build_trustlink_queries(None, None, "Mattor Online")
        assert len(queries) >= 1
        assert "mattor" in queries[0].lower()
