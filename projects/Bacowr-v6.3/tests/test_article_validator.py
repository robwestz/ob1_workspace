"""Tests for article_validator.py — verify each of the 11 QA checks."""

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from article_validator import (
    check_word_count,
    check_anchor_text_present,
    check_anchor_count,
    check_anchor_position,
    check_trustlinks,
    check_no_bullets,
    check_headings,
    check_forbidden_phrases,
    check_language,
    check_serp_entities,
    check_paragraphs,
    validate_article,
    _count_words,
)

# ── Helpers ──────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TEXT_OUTPUT = PROJECT_ROOT / "text-output"

FILLER_SV = (
    "Det svenska näringslivet genomgår en omvandling driven av digitalisering "
    "och nya konsumentvanor som påverkar hela branscher från detaljhandel "
    "till tjänstesektor och tillverkningsindustri i grunden. "
)


def _make_article(
    word_target: int = 800,
    anchor_text: str = "online casino",
    target_url: str = "https://verajohn.se/casino",
    anchor_at_word: int = 300,
    trustlinks: int = 1,
    trustlink_urls: list | None = None,
    heading: bool = True,
    bullets: bool = False,
    forbidden: str = "",
    extra_text: str = "",
) -> str:
    """Build a synthetic article with controllable parameters."""
    parts = []

    if heading:
        parts.append("# Rubrik för testartikeln\n")

    # Trust links early in text
    tl_urls = trustlink_urls or [
        "https://boverket.se/sv/samhallsplanering/rapport",
        "https://scb.se/statistik/undersokning",
    ]
    tl_block = ""
    for i in range(min(trustlinks, len(tl_urls))):
        tl_block += f" Se även [källa {i+1}]({tl_urls[i]}) för mer information."

    # Build paragraphs of filler to reach target word count
    # First ~200 words
    p1_words = 200
    p1 = " ".join(FILLER_SV.split()[:7]) + " "
    while _count_words(p1) < p1_words:
        p1 += FILLER_SV
    p1_tokens = p1.split()[:p1_words]
    p1 = " ".join(p1_tokens)
    if trustlinks > 0:
        p1 += tl_block
    parts.append(p1 + "\n")

    # Paragraph before anchor (reach anchor_at_word)
    current = _count_words("\n\n".join(parts))
    words_before_anchor = max(anchor_at_word - current - 10, 50)
    p2 = ""
    while _count_words(p2) < words_before_anchor:
        p2 += FILLER_SV
    p2_tokens = p2.split()[:words_before_anchor]
    p2 = " ".join(p2_tokens)
    parts.append(p2 + "\n")

    # Anchor paragraph
    anchor_link = f"[{anchor_text}]({target_url})"
    p3 = f"I det sammanhanget framträder {anchor_link} som en relevant aktör. "
    while _count_words(p3) < 150:
        p3 += FILLER_SV
    p3_tokens = p3.split()[:150]
    p3 = " ".join(p3_tokens)
    parts.append(p3 + "\n")

    # Fill remaining words
    current = _count_words("\n\n".join(parts))
    remaining = max(word_target - current, 50)
    p4 = ""
    while _count_words(p4) < remaining:
        p4 += FILLER_SV
    p4_tokens = p4.split()[:remaining]
    p4 = " ".join(p4_tokens)
    parts.append(p4)

    if forbidden:
        parts.append(f"\n\n{forbidden}")

    if bullets:
        parts.append("\n\n- Punkt ett\n- Punkt två\n- Punkt tre")

    if extra_text:
        parts.append(f"\n\n{extra_text}")

    return "\n\n".join(parts)


# ── 1. Word count ────────────────────────────────────────────

class TestWordCount:
    def test_749_fails(self):
        text = _make_article(word_target=749)
        result = check_word_count(text)
        assert not result.passed

    def test_750_passes(self):
        text = _make_article(word_target=750)
        result = check_word_count(text)
        assert result.passed

    def test_900_passes(self):
        text = _make_article(word_target=900)
        result = check_word_count(text)
        assert result.passed

    def test_901_fails(self):
        text = _make_article(word_target=901)
        result = check_word_count(text)
        assert not result.passed


# ── 2 & 3. Anchor presence + count ──────────────────────────

class TestAnchorPresence:
    def test_missing_anchor_fails(self):
        text = "En text utan någon länk alls. " * 80
        result = check_anchor_text_present(text, "casino", "https://x.se")
        assert not result.passed

    def test_present_anchor_passes(self):
        text = _make_article()
        result = check_anchor_text_present(
            text, "online casino", "https://verajohn.se/casino"
        )
        assert result.passed

    def test_duplicate_anchor_fails_count(self):
        base = _make_article()
        extra_anchor = "[online casino](https://verajohn.se/casino)"
        text = base + f"\n\nLäs mer om {extra_anchor} nu."
        result = check_anchor_count(
            text, "online casino", "https://verajohn.se/casino"
        )
        assert not result.passed

    def test_exact_one_anchor_passes_count(self):
        text = _make_article()
        result = check_anchor_count(
            text, "online casino", "https://verajohn.se/casino"
        )
        assert result.passed


# ── 4. Anchor position ──────────────────────────────────────

class TestAnchorPosition:
    def test_too_early_fails(self):
        # Manually place anchor at ~word 100 (before the 250 minimum)
        words_before = " ".join(["ord"] * 100)
        anchor = "[online casino](https://verajohn.se/casino)"
        words_after = " ".join(["ord"] * 700)
        text = f"{words_before} {anchor} {words_after}"
        result = check_anchor_position(
            text, "online casino", "https://verajohn.se/casino"
        )
        assert not result.passed

    def test_good_position_passes(self):
        text = _make_article(anchor_at_word=300)
        result = check_anchor_position(
            text, "online casino", "https://verajohn.se/casino"
        )
        assert result.passed

    def test_too_late_fails(self):
        text = _make_article(word_target=900, anchor_at_word=560)
        result = check_anchor_position(
            text, "online casino", "https://verajohn.se/casino"
        )
        assert not result.passed

    def test_missing_anchor_fails(self):
        text = "Bara text utan länk. " * 80
        result = check_anchor_position(text, "casino", "https://x.se")
        assert not result.passed


# ── 5. Trust links ───────────────────────────────────────────

class TestTrustLinks:
    def test_zero_trustlinks_fails(self):
        text = _make_article(trustlinks=0)
        result = check_trustlinks(
            text, "online casino", "https://verajohn.se/casino", "fragbite.se"
        )
        assert not result.passed

    def test_one_trustlink_passes(self):
        text = _make_article(trustlinks=1)
        result = check_trustlinks(
            text, "online casino", "https://verajohn.se/casino", "fragbite.se"
        )
        assert result.passed

    def test_two_trustlinks_passes(self):
        text = _make_article(trustlinks=2)
        result = check_trustlinks(
            text, "online casino", "https://verajohn.se/casino", "fragbite.se"
        )
        assert result.passed

    def test_three_trustlinks_fails(self):
        text = _make_article(
            trustlinks=3,
            trustlink_urls=[
                "https://a.se/p1",
                "https://b.se/p2",
                "https://c.se/p3",
            ],
        )
        result = check_trustlinks(
            text, "online casino", "https://verajohn.se/casino", "fragbite.se"
        )
        assert not result.passed

    def test_trustlink_to_target_domain_fails(self):
        text = _make_article(
            trustlinks=1,
            trustlink_urls=["https://verajohn.se/other-page"],
        )
        result = check_trustlinks(
            text, "online casino", "https://verajohn.se/casino", "fragbite.se"
        )
        assert not result.passed

    def test_trustlink_after_anchor_fails(self):
        """Trust link placed after the anchor should fail."""
        base = _make_article(trustlinks=0, anchor_at_word=300)
        # Add a trust link after the anchor
        text = base + "\n\nSlutligen, se [rapport](https://extern.se/rapport) för detaljer."
        result = check_trustlinks(
            text, "online casino", "https://verajohn.se/casino", "fragbite.se"
        )
        assert not result.passed


# ── 6. No bullets ────────────────────────────────────────────

class TestNoBullets:
    def test_bullets_fail(self):
        text = _make_article(bullets=True)
        result = check_no_bullets(text)
        assert not result.passed

    def test_clean_prose_passes(self):
        text = _make_article(bullets=False)
        result = check_no_bullets(text)
        assert result.passed

    def test_numbered_list_fails(self):
        text = "Normal text.\n\n1. First item\n2. Second item\n3. Third item"
        result = check_no_bullets(text)
        assert not result.passed


# ── 7. Headings ──────────────────────────────────────────────

class TestHeadings:
    def test_zero_headings_passes(self):
        text = _make_article(heading=False)
        result = check_headings(text)
        assert result.passed

    def test_one_heading_passes(self):
        text = _make_article(heading=True)
        result = check_headings(text)
        assert result.passed

    def test_two_headings_fails(self):
        text = _make_article(heading=True, extra_text="## Extra rubrik\n\nMer text här.")
        result = check_headings(text)
        assert not result.passed


# ── 8. Forbidden phrases ────────────────────────────────────

class TestForbiddenPhrases:
    def test_clean_text_passes(self):
        text = _make_article()
        result = check_forbidden_phrases(text)
        assert result.passed

    def test_i_en_varld_dar_fails(self):
        text = _make_article(forbidden="I en värld där allt förändras snabbt.")
        result = check_forbidden_phrases(text)
        assert not result.passed

    def test_sammanfattningsvis_fails(self):
        text = _make_article(forbidden="Sammanfattningsvis kan sägas att detta är viktigt.")
        result = check_forbidden_phrases(text)
        assert not result.passed

    def test_i_slutandan_fails(self):
        text = _make_article(forbidden="I slutändan handlar det om kvalitet.")
        result = check_forbidden_phrases(text)
        assert not result.passed


# ── 9. Language ──────────────────────────────────────────────

class TestLanguage:
    def test_swedish_text_detected(self):
        text = "Det svenska näringslivet och den digitala utvecklingen har förändrat " * 20
        result = check_language(text, "sv")
        assert result.passed

    def test_english_text_detected(self):
        text = "The global market and the digital transformation have changed " * 20
        result = check_language(text, "en")
        assert result.passed

    def test_swedish_text_expected_english_fails(self):
        text = "Det svenska näringslivet och den digitala utvecklingen " * 20
        result = check_language(text, "en")
        assert not result.passed


# ── 10. SERP entities ───────────────────────────────────────

class TestSerpEntities:
    def test_skipped_when_none(self):
        result = check_serp_entities("Some text", None)
        assert result.passed

    def test_four_entities_passes(self):
        text = "casino bonus spel odds och mer text här"
        entities = ["casino", "bonus", "spel", "odds"]
        result = check_serp_entities(text, entities)
        assert result.passed

    def test_three_entities_fails(self):
        text = "casino bonus spel och mer text här"
        entities = ["casino", "bonus", "spel", "odds"]
        result = check_serp_entities(text, entities)
        assert not result.passed


# ── 11. Paragraphs ──────────────────────────────────────────

class TestParagraphs:
    def test_three_paragraphs_fails(self):
        text = "Stycke ett.\n\nStycke två.\n\nStycke tre."
        result = check_paragraphs(text)
        assert not result.passed

    def test_four_paragraphs_passes(self):
        text = "Stycke ett.\n\nStycke två.\n\nStycke tre.\n\nStycke fyra."
        result = check_paragraphs(text)
        assert result.passed

    def test_heading_only_block_not_counted(self):
        text = "# Rubrik\n\nStycke ett.\n\nStycke två.\n\nStycke tre."
        result = check_paragraphs(text)
        assert not result.passed  # only 3 real paragraphs


# ── Full article: 11/11 PASS ────────────────────────────────

class TestFullValidation:
    def test_perfect_article_passes_all(self):
        text = _make_article(
            word_target=800,
            anchor_text="online casino",
            target_url="https://verajohn.se/casino",
            anchor_at_word=300,
            trustlinks=1,
        )
        result = validate_article(
            article_text=text,
            anchor_text="online casino",
            target_url="https://verajohn.se/casino",
            publisher_domain="fragbite.se",
            language="sv",
        )
        # At minimum, the structural checks should all pass
        failed = [c for c in result.checks if not c.passed]
        assert result.passed, (
            f"Expected 11/11 PASS but got failures:\n"
            + "\n".join(f"  {c.name}: {c.message}" for c in failed)
        )

    def test_summary_format(self):
        text = _make_article()
        result = validate_article(
            article_text=text,
            anchor_text="online casino",
            target_url="https://verajohn.se/casino",
            publisher_domain="fragbite.se",
        )
        summary = result.summary()
        assert "PASS" in summary or "FAIL" in summary
        assert "Result:" in summary


# ── Gibberish articles from text-output/ ────────────────────

class TestGibberishArticles:
    """All existing articles in text-output/ should FAIL validation."""

    @pytest.fixture
    def article_files(self):
        if not TEXT_OUTPUT.exists():
            pytest.skip("text-output/ directory not found")
        files = sorted(TEXT_OUTPUT.glob("*_article.md"))
        if not files:
            pytest.skip("No article files found in text-output/")
        return files

    def test_gibberish_articles_fail(self, article_files):
        """Every gibberish article should fail at least one QA check.

        SERP entities are provided to catch structurally-valid gibberish:
        real articles would contain these domain-specific terms but
        word-salad gibberish won't have all 4.
        """
        serp_entities = [
            "spelautomater", "insättningsgräns",
            "omsättningskrav", "välkomstbonus",
            "spelansvar", "utbetalningsgrad",
        ]
        for path in article_files:
            text = path.read_text(encoding="utf-8")
            result = validate_article(
                article_text=text,
                anchor_text="online casino",
                target_url="https://verajohn.se/casino",
                publisher_domain="fragbite.se",
                language="sv",
                serp_entities=serp_entities,
            )
            failed = [c for c in result.checks if not c.passed]
            assert not result.passed, (
                f"{path.name} unexpectedly passed all checks! "
                f"This gibberish article should have failed."
            )

    def test_at_least_5_gibberish_articles_exist(self, article_files):
        """Sanity: we expect multiple gibberish articles for coverage."""
        assert len(article_files) >= 5, (
            f"Expected >=5 articles in text-output/ but found {len(article_files)}"
        )
