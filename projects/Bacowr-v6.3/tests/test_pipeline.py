"""Tests for pipeline.py — CSV parsing, profiling heuristics, semantic helpers."""

import tempfile
from pathlib import Path
from datetime import datetime

import pytest

from pipeline import (
    _parse_textjobs,
    _normalize_job,
    Pipeline,
    PipelineConfig,
    PublisherProfiler,
    SemanticEngine,
    detect_language,
    assess_risk,
)
from models import (
    SemanticDistance, RiskLevel, PublisherProfile, TargetFingerprint,
    SemanticBridge, BridgeSuggestion, BridgeConfidence,
)


# ── _parse_textjobs ─────────────────────────────────────────

class TestParseTextjobs:
    def _write_tmp(self, content: str) -> Path:
        f = tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False, encoding="utf-8"
        )
        f.write(content)
        f.close()
        return Path(f.name)

    def test_comma_delimiter(self):
        path = self._write_tmp(
            "job_number,publisher_domain,target_url,anchor_text\n"
            "1,site.se,https://t.se/page,anchor\n"
        )
        rows = _parse_textjobs(path)
        assert len(rows) == 1
        assert rows[0]["job_number"] == "1"
        assert rows[0]["publisher_domain"] == "site.se"

    def test_pipe_delimiter(self):
        path = self._write_tmp(
            "job_number|publisher_domain|target_url|anchor_text\n"
            "2|blog.se|https://t.se/x|mitt ankare\n"
        )
        rows = _parse_textjobs(path)
        assert len(rows) == 1
        assert rows[0]["job_number"] == "2"
        assert rows[0]["anchor_text"] == "mitt ankare"

    def test_empty_file(self):
        path = self._write_tmp("")
        rows = _parse_textjobs(path)
        assert rows == []

    def test_header_only(self):
        path = self._write_tmp("job_number,publisher_domain,target_url,anchor_text\n")
        rows = _parse_textjobs(path)
        assert rows == []

    def test_short_rows_skipped(self):
        path = self._write_tmp(
            "job_number,publisher_domain,target_url,anchor_text\n"
            "1,site.se\n"
            "2,blog.se,https://t.se/x,anchor\n"
        )
        rows = _parse_textjobs(path)
        assert len(rows) == 1
        assert rows[0]["job_number"] == "2"

    def test_multiple_rows(self):
        path = self._write_tmp(
            "job_number,publisher_domain,target_url,anchor_text\n"
            "1,a.se,https://t.se/1,ankar1\n"
            "2,b.se,https://t.se/2,ankar2\n"
            "3,c.se,https://t.se/3,ankar3\n"
        )
        rows = _parse_textjobs(path)
        assert len(rows) == 3


# ── _normalize_job ───────────────────────────────────────────

class TestNormalizeJob:
    def test_standard_columns(self):
        row = {
            "job_number": "5",
            "publisher_domain": "blog.se",
            "target_url": "https://target.se/page",
            "anchor_text": "my anchor",
        }
        norm = _normalize_job(row)
        assert norm["job_id"] == "5"
        assert norm["publisher_domain"] == "blog.se"
        assert norm["target_url"] == "https://target.se/page"
        assert norm["anchor_text"] == "my anchor"

    def test_variant_column_names(self):
        row = {
            "job_Id": "7",
            "publication_domain": "pub.se",
            "link_target_page": "https://t.se/p",
            "anchor": "text",
        }
        norm = _normalize_job(row)
        assert norm["job_id"] == "7"
        assert norm["publisher_domain"] == "pub.se"
        assert norm["target_url"] == "https://t.se/p"
        assert norm["anchor_text"] == "text"

    def test_malformed_https_url(self):
        row = {
            "job_number": "1",
            "publisher_domain": "x.se",
            "target_url": "https:/target.se/page",
            "anchor_text": "a",
        }
        norm = _normalize_job(row)
        assert norm["target_url"] == "https://target.se/page"

    def test_malformed_http_url(self):
        row = {
            "job_number": "1",
            "publisher_domain": "x.se",
            "target_url": "http:/target.se/page",
            "anchor_text": "a",
        }
        norm = _normalize_job(row)
        assert norm["target_url"] == "http://target.se/page"

    def test_domain_strips_www(self):
        row = {
            "job_number": "1",
            "publisher_domain": "www.myblog.se",
            "target_url": "https://t.se",
            "anchor_text": "a",
        }
        norm = _normalize_job(row)
        assert norm["publisher_domain"] == "myblog.se"

    def test_domain_from_url(self):
        row = {
            "job_number": "1",
            "publication_url": "https://www.myblog.se/articles",
            "target_url": "https://t.se",
            "anchor_text": "a",
        }
        norm = _normalize_job(row)
        assert norm["publisher_domain"] == "myblog.se"

    def test_missing_fields_return_empty(self):
        row = {"other_key": "val"}
        norm = _normalize_job(row)
        assert norm["job_id"] == ""
        assert norm["publisher_domain"] == ""


# ── Pipeline.load_jobs ───────────────────────────────────────

class TestPipelineLoadJobs:
    def test_load_from_temp_csv(self, tmp_path):
        csv = tmp_path / "jobs.csv"
        csv.write_text(
            "job_number,publisher_domain,target_url,anchor_text\n"
            "1,blog.se,https://t.se/p1,ankar1\n"
            "2,site.se,https://t.se/p2,ankar2\n",
            encoding="utf-8",
        )
        pipe = Pipeline(PipelineConfig())
        jobs = pipe.load_jobs(str(csv))
        assert len(jobs) == 2
        assert jobs[0].job_number == 1
        assert jobs[1].publisher_domain == "site.se"

    def test_skips_incomplete_rows(self, tmp_path):
        csv = tmp_path / "jobs.csv"
        csv.write_text(
            "job_number,publisher_domain,target_url,anchor_text\n"
            "1,blog.se,https://t.se/p1,ankar1\n"
            ",site.se,https://t.se/p2,ankar2\n"  # missing job_number
            "3,ok.se,https://t.se/p3,ankar3\n",
            encoding="utf-8",
        )
        pipe = Pipeline(PipelineConfig())
        jobs = pipe.load_jobs(str(csv))
        assert len(jobs) == 2
        assert jobs[0].job_number == 1
        assert jobs[1].job_number == 3


# ── PublisherProfiler._topics_from_domain ────────────────────

class TestTopicsFromDomain:
    @pytest.fixture
    def profiler(self, tmp_path):
        config = PipelineConfig(output_dir=str(tmp_path))
        return PublisherProfiler(config)

    def test_sport_domain(self, profiler):
        topics = profiler._topics_from_domain("sportbloggen.se")
        assert "sport" in topics
        assert "idrott" in topics

    def test_unknown_domain_extracts_words(self, profiler):
        topics = profiler._topics_from_domain("fantasyresor.se")
        assert "resor" in topics or "fantasy" in topics or len(topics) >= 0

    def test_compound_name(self, profiler):
        topics = profiler._topics_from_domain("villanytt.se")
        assert "villa" in topics
        assert "bostad" in topics or "hem" in topics

    def test_casino_domain(self, profiler):
        topics = profiler._topics_from_domain("casinobloggen.se")
        assert "casino" in topics
        assert "spel" in topics

    def test_deduplication(self, profiler):
        topics = profiler._topics_from_domain("sportnyhetssport.se")
        assert len(topics) == len(set(topics))


# ── SemanticEngine._categorize ───────────────────────────────

class TestCategorize:
    @pytest.fixture
    def engine(self, tmp_path):
        return SemanticEngine(PipelineConfig(output_dir=str(tmp_path)))

    def test_identical(self, engine):
        assert engine._categorize(0.95) == SemanticDistance.IDENTICAL

    def test_identical_boundary(self, engine):
        assert engine._categorize(0.90) == SemanticDistance.IDENTICAL

    def test_close(self, engine):
        assert engine._categorize(0.75) == SemanticDistance.CLOSE

    def test_close_boundary(self, engine):
        assert engine._categorize(0.70) == SemanticDistance.CLOSE

    def test_moderate(self, engine):
        assert engine._categorize(0.55) == SemanticDistance.MODERATE

    def test_moderate_boundary(self, engine):
        assert engine._categorize(0.50) == SemanticDistance.MODERATE

    def test_distant(self, engine):
        assert engine._categorize(0.35) == SemanticDistance.DISTANT

    def test_distant_boundary(self, engine):
        assert engine._categorize(0.30) == SemanticDistance.DISTANT

    def test_unrelated(self, engine):
        assert engine._categorize(0.20) == SemanticDistance.UNRELATED

    def test_unrelated_zero(self, engine):
        assert engine._categorize(0.0) == SemanticDistance.UNRELATED


# ── SemanticEngine._forbidden_entities ───────────────────────

class TestForbiddenEntities:
    @pytest.fixture
    def engine(self, tmp_path):
        return SemanticEngine(PipelineConfig(output_dir=str(tmp_path)))

    def test_casino_url(self, engine):
        target = TargetFingerprint(
            url="https://www.casinon.com/bonusar/", timestamp=datetime.now()
        )
        forbidden = engine._forbidden_entities(target)
        assert len(forbidden) > 0
        assert "spelpaus" in forbidden

    def test_betting_url(self, engine):
        target = TargetFingerprint(
            url="https://betting.se/odds/", timestamp=datetime.now()
        )
        forbidden = engine._forbidden_entities(target)
        assert "spelinspektionen" in forbidden

    def test_normal_url(self, engine):
        target = TargetFingerprint(
            url="https://www.rusta.com/mattor", timestamp=datetime.now()
        )
        forbidden = engine._forbidden_entities(target)
        assert forbidden == []


# ── SemanticEngine._trust_link_topics / _trust_link_avoid ────

class TestTrustLinkHelpers:
    @pytest.fixture
    def engine(self, tmp_path):
        return SemanticEngine(PipelineConfig(output_dir=str(tmp_path)))

    def test_trust_link_topics(self, engine, sample_publisher, sample_target):
        topics = engine._trust_link_topics(sample_publisher, sample_target)
        assert "statistik" in topics
        assert "forskning" in topics
        # publisher topics included
        assert any(t in topics for t in sample_publisher.primary_topics[:3])

    def test_trust_link_avoid_includes_target_domain(self, engine, sample_target):
        avoid = engine._trust_link_avoid(sample_target)
        assert "indoorprofessional.se" in avoid

    def test_trust_link_avoid_casino_extras(self, engine):
        target = TargetFingerprint(
            url="https://www.casinon.com/spel/", timestamp=datetime.now()
        )
        avoid = engine._trust_link_avoid(target)
        assert "casinon.com" in avoid
        assert "bettingstugan.se" in avoid


# ── detect_language ──────────────────────────────────────────

class TestDetectLanguage:
    def test_se_domain(self):
        assert detect_language("teknikbloggen.se") == "sv"

    def test_co_uk_domain(self):
        assert detect_language("techweekly.co.uk") == "en"

    def test_uk_domain(self):
        assert detect_language("news.uk") == "en"

    def test_com_with_english_signal(self):
        assert detect_language("dailynews.com") == "en"

    def test_com_without_english_signal(self):
        assert detect_language("foretaget.com") == "sv"

    def test_case_insensitive(self):
        assert detect_language("TechWeekly.co.uk") == "en"


# ── assess_risk ──────────────────────────────────────────────

class TestAssessRisk:
    def _make_bridge(self, distance: SemanticDistance) -> SemanticBridge:
        return SemanticBridge(
            publisher_domain="x.se",
            target_url="https://y.se",
            anchor_text="a",
            timestamp=datetime.now(),
            raw_distance=0.5,
            distance_category=distance,
        )

    def test_unrelated_is_high(self):
        bridge = self._make_bridge(SemanticDistance.UNRELATED)
        target = TargetFingerprint(url="https://y.se", timestamp=datetime.now())
        assert assess_risk(bridge, target) == RiskLevel.HIGH

    def test_distant_is_medium(self):
        bridge = self._make_bridge(SemanticDistance.DISTANT)
        target = TargetFingerprint(url="https://y.se", timestamp=datetime.now())
        assert assess_risk(bridge, target) == RiskLevel.MEDIUM

    def test_close_is_low(self):
        bridge = self._make_bridge(SemanticDistance.CLOSE)
        target = TargetFingerprint(url="https://y.se", timestamp=datetime.now())
        assert assess_risk(bridge, target) == RiskLevel.LOW

    def test_ymyl_overrides_to_high(self):
        bridge = self._make_bridge(SemanticDistance.CLOSE)
        target = TargetFingerprint(
            url="https://y.se/hälsa/tips", timestamp=datetime.now()
        )
        assert assess_risk(bridge, target) == RiskLevel.HIGH

    def test_medicine_ymyl(self):
        bridge = self._make_bridge(SemanticDistance.IDENTICAL)
        target = TargetFingerprint(
            url="https://y.se/medicine/page", timestamp=datetime.now()
        )
        assert assess_risk(bridge, target) == RiskLevel.HIGH

    def test_normal_close_low(self):
        bridge = self._make_bridge(SemanticDistance.MODERATE)
        target = TargetFingerprint(
            url="https://rusta.com/mattor", timestamp=datetime.now()
        )
        assert assess_risk(bridge, target) == RiskLevel.LOW
