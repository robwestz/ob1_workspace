"""
BACOWR v6.2 Article Validator — 11 QA checks as callable functions.

Implements every check from qa-template.md + SYSTEM.md rules:
  1. Word count 750–900
  2. Anchor text present (≥1 match)
  3. Anchor count = 1
  4. Anchor position word 250–550
  5. Trust links 1–2, before anchor, not target/publisher domain
  6. No bullets/numbered lists
  7. Headings ≤ 1
  8. Forbidden AI phrases = 0
  9. Language check (sv/en heuristic)
 10. SERP entities ≥ 4
 11. Paragraphs ≥ 4
"""

import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple
from urllib.parse import urlparse


# ── Forbidden phrases from SYSTEM.md §6 ────────────────────

FORBIDDEN_PHRASES_SV = [
    "i en värld där",
    "det är viktigt att notera",
    "det är värt att notera",
    "i denna artikel kommer vi att",
    "denna artikel utforskar",
    "sammanfattningsvis kan sägas",
    "sammanfattningsvis",
    "låt oss utforska",
    "i dagens digitala värld",
    "i dagens läge",
    "det har blivit allt viktigare",
    "har du någonsin undrat",
    "i den här guiden",
    "vi kommer att titta på",
    "i slutändan",
    "det råder ingen tvekan om",
    "utan tvekan",
    "faktum är att",
    "det bör noteras att",
    "det kan konstateras att",
    "i takt med att",
    "i denna text",
    "i denna artikel",
]

# Swedish / English stop-word sets for language detection
_SV_STOPWORDS = {
    "och", "att", "en", "det", "som", "är", "av", "för", "med",
    "till", "den", "har", "de", "inte", "om", "ett", "vi", "på",
    "i", "kan", "ska", "vara", "bli", "nya", "mer", "hos",
    "eller", "men", "hur", "vad", "var", "alla", "från",
    "utan", "detta", "dessa", "här", "efter", "under", "vid",
}
_EN_STOPWORDS = {
    "the", "and", "to", "of", "a", "in", "is", "for", "on", "with",
    "that", "this", "your", "you", "are", "our", "can", "how", "at",
    "be", "by", "an", "we", "from", "all", "has", "it", "was",
    "more", "but", "not", "what", "or", "one", "get",
}


# ── Data classes ────────────────────────────────────────────

@dataclass
class CheckResult:
    name: str
    passed: bool
    value: str = ""
    expected: str = ""
    message: str = ""


@dataclass
class ValidationResult:
    checks: List[CheckResult] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.checks)

    def summary(self) -> str:
        lines = []
        for c in self.checks:
            status = "PASS" if c.passed else "FAIL"
            lines.append(f"[{status}] {c.name}: {c.message}")
        passed_count = sum(1 for c in self.checks if c.passed)
        lines.append(f"\nResult: {passed_count}/{len(self.checks)} PASS")
        return "\n".join(lines)


# ── Helpers ─────────────────────────────────────────────────

def _strip_markdown_for_wordcount(text: str) -> str:
    """Remove markdown syntax but keep words for counting."""
    # Remove link markup but keep visible text: [text](url) -> text
    cleaned = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', text)
    # Remove heading markers
    cleaned = re.sub(r'^#{1,6}\s+', '', cleaned, flags=re.MULTILINE)
    # Remove bold/italic markers
    cleaned = re.sub(r'[*_]{1,3}', '', cleaned)
    return cleaned


def _count_words(text: str) -> int:
    cleaned = _strip_markdown_for_wordcount(text)
    return len(cleaned.split())


def _find_all_markdown_links(text: str) -> List[Tuple[str, str, int]]:
    """Return list of (anchor_text, url, char_offset) for all markdown links."""
    return [
        (m.group(1), m.group(2), m.start())
        for m in re.finditer(r'\[([^\]]+)\]\(([^)]+)\)', text)
    ]


def _word_position_of_char_offset(text: str, char_offset: int) -> int:
    """Given a character offset, return the 1-based word position in the stripped text."""
    prefix = text[:char_offset]
    cleaned = _strip_markdown_for_wordcount(prefix)
    return len(cleaned.split()) + 1


def _domain_of(url: str) -> str:
    try:
        return urlparse(url).netloc.replace("www.", "").lower()
    except Exception:
        return ""


# ── Individual checks ───────────────────────────────────────

def check_word_count(text: str) -> CheckResult:
    """Check 1: Word count 750–900."""
    wc = _count_words(text)
    passed = 750 <= wc <= 900
    return CheckResult(
        name="word_count",
        passed=passed,
        value=str(wc),
        expected="750-900",
        message=f"{wc} words (750-900 required)",
    )


def check_anchor_text_present(
    text: str, anchor_text: str, target_url: str
) -> CheckResult:
    """Check 2: Anchor text present as markdown link at least once."""
    pattern = f"[{anchor_text}]({target_url})"
    count = text.count(pattern)
    passed = count >= 1
    return CheckResult(
        name="anchor_text_present",
        passed=passed,
        value=str(count),
        expected=">=1",
        message=f"Found {count} anchor link(s)" if passed else "Anchor link not found",
    )


def check_anchor_count(
    text: str, anchor_text: str, target_url: str
) -> CheckResult:
    """Check 3: Exactly 1 anchor link."""
    pattern = f"[{anchor_text}]({target_url})"
    count = text.count(pattern)
    passed = count == 1
    return CheckResult(
        name="anchor_count",
        passed=passed,
        value=str(count),
        expected="1",
        message=f"Anchor count: {count} (exactly 1 required)",
    )


def check_anchor_position(
    text: str, anchor_text: str, target_url: str
) -> CheckResult:
    """Check 4: Anchor link at word position 250–550."""
    pattern = f"[{anchor_text}]({target_url})"
    idx = text.find(pattern)
    if idx == -1:
        return CheckResult(
            name="anchor_position",
            passed=False,
            value="N/A",
            expected="250-550",
            message="Anchor link not found",
        )
    pos = _word_position_of_char_offset(text, idx)
    passed = 250 <= pos <= 550
    return CheckResult(
        name="anchor_position",
        passed=passed,
        value=str(pos),
        expected="250-550",
        message=f"Anchor at word {pos} (250-550 required)",
    )


def check_trustlinks(
    text: str,
    anchor_text: str,
    target_url: str,
    publisher_domain: str,
) -> CheckResult:
    """Check 5: 1–2 trust links, before anchor, not target/publisher domain."""
    all_links = _find_all_markdown_links(text)
    target_domain = _domain_of(target_url)
    pub_domain = publisher_domain.replace("www.", "").lower()

    anchor_pattern = f"[{anchor_text}]({target_url})"
    anchor_offset = text.find(anchor_pattern)

    trustlinks = []
    issues = []

    for link_text, url, offset in all_links:
        # Skip the anchor link itself
        if link_text == anchor_text and url == target_url:
            continue

        domain = _domain_of(url)

        # Check domain constraints
        if domain == target_domain:
            issues.append(f"Trust link to target domain: {url}")
            continue
        if domain == pub_domain:
            issues.append(f"Trust link to publisher domain: {url}")
            continue

        # Check position: must be before anchor
        if anchor_offset != -1 and offset > anchor_offset:
            issues.append(f"Trust link after anchor: {url}")
            continue

        trustlinks.append((link_text, url, offset))

    count = len(trustlinks)
    passed = 1 <= count <= 2 and not issues

    detail_parts = [f"{count} trust link(s)"]
    if issues:
        detail_parts.extend(issues)
        passed = False

    return CheckResult(
        name="trustlinks",
        passed=passed,
        value=str(count),
        expected="1-2, before anchor, not target/publisher",
        message="; ".join(detail_parts),
    )


def check_no_bullets(text: str) -> CheckResult:
    """Check 6: No bullet or numbered lists."""
    bullet_pattern = re.compile(r'^\s*[-*•]\s', re.MULTILINE)
    numbered_pattern = re.compile(r'^\s*\d+\.\s', re.MULTILINE)

    bullet_matches = bullet_pattern.findall(text)
    numbered_matches = numbered_pattern.findall(text)

    total = len(bullet_matches) + len(numbered_matches)
    passed = total == 0
    return CheckResult(
        name="no_bullets",
        passed=passed,
        value=str(total),
        expected="0",
        message=f"{total} list marker(s) found" if total > 0 else "No lists found",
    )


def check_headings(text: str) -> CheckResult:
    """Check 7: Max 1 heading."""
    heading_pattern = re.compile(r'^#{1,6}\s', re.MULTILINE)
    count = len(heading_pattern.findall(text))
    passed = count <= 1
    return CheckResult(
        name="headings",
        passed=passed,
        value=str(count),
        expected="<=1",
        message=f"{count} heading(s) (max 1 allowed)",
    )


def check_forbidden_phrases(text: str) -> CheckResult:
    """Check 8: Zero forbidden AI phrases."""
    text_lower = text.lower()
    found = [p for p in FORBIDDEN_PHRASES_SV if p in text_lower]
    passed = len(found) == 0
    return CheckResult(
        name="forbidden_phrases",
        passed=passed,
        value=str(len(found)),
        expected="0",
        message=f"Found: {found}" if found else "No forbidden phrases",
    )


def check_language(text: str, expected_language: str = "sv") -> CheckResult:
    """Check 9: Language heuristic — count Swedish vs English stop words."""
    words = set(text.lower().split())
    sv_hits = len(words & _SV_STOPWORDS)
    en_hits = len(words & _EN_STOPWORDS)

    if expected_language == "sv":
        detected = "sv" if sv_hits >= en_hits else "en"
    else:
        detected = "en" if en_hits >= sv_hits else "sv"

    passed = detected == expected_language
    return CheckResult(
        name="language",
        passed=passed,
        value=detected,
        expected=expected_language,
        message=f"Detected '{detected}' (expected '{expected_language}') — SV:{sv_hits} EN:{en_hits}",
    )


def check_serp_entities(
    text: str, serp_entities: Optional[List[str]] = None
) -> CheckResult:
    """Check 10: At least 4 unique SERP entities in text."""
    if not serp_entities:
        return CheckResult(
            name="serp_entities",
            passed=True,
            value="skipped",
            expected=">=4 (skipped, no entities provided)",
            message="No SERP entities provided — check skipped",
        )
    text_lower = text.lower()
    found = [e for e in serp_entities if e.lower() in text_lower]
    unique_found = list(dict.fromkeys(found))
    passed = len(unique_found) >= 4
    return CheckResult(
        name="serp_entities",
        passed=passed,
        value=str(len(unique_found)),
        expected=">=4",
        message=f"Found {len(unique_found)}/{len(serp_entities)}: {unique_found}",
    )


def check_paragraphs(text: str) -> CheckResult:
    """Check 11: At least 4 paragraphs (non-empty text blocks separated by blank lines)."""
    # Split on double newlines, filter out headings-only and empty blocks
    blocks = re.split(r'\n\s*\n', text.strip())
    paragraphs = []
    for block in blocks:
        stripped = block.strip()
        if not stripped:
            continue
        # Skip heading-only blocks
        if re.match(r'^#{1,6}\s+\S+', stripped) and '\n' not in stripped:
            continue
        paragraphs.append(stripped)

    count = len(paragraphs)
    passed = count >= 4
    return CheckResult(
        name="paragraphs",
        passed=passed,
        value=str(count),
        expected=">=4",
        message=f"{count} paragraph(s) (>=4 required)",
    )


# ── Main entry point ───────────────────────────────────────

def validate_article(
    article_text: str,
    anchor_text: str,
    target_url: str,
    publisher_domain: str,
    language: str = "sv",
    serp_entities: Optional[List[str]] = None,
) -> ValidationResult:
    """Run all 11 QA checks and return a ValidationResult."""
    result = ValidationResult()
    result.checks.append(check_word_count(article_text))
    result.checks.append(check_anchor_text_present(article_text, anchor_text, target_url))
    result.checks.append(check_anchor_count(article_text, anchor_text, target_url))
    result.checks.append(check_anchor_position(article_text, anchor_text, target_url))
    result.checks.append(check_trustlinks(article_text, anchor_text, target_url, publisher_domain))
    result.checks.append(check_no_bullets(article_text))
    result.checks.append(check_headings(article_text))
    result.checks.append(check_forbidden_phrases(article_text))
    result.checks.append(check_language(article_text, language))
    result.checks.append(check_serp_entities(article_text, serp_entities))
    result.checks.append(check_paragraphs(article_text))
    return result
