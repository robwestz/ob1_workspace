"""
BACOWR v5 Pipeline — Consolidated article generation pipeline.

Combines functionality from:
- v4_siex_batch/batch_runner.py (batch orchestration)
- v3-round2/serp_lens/core.py (orchestrator)
- v3-round2/serp_lens/semantic_engine.py (distance calculation)
- v3-round2/serp_lens/publisher_sampler_light.py (fast publisher profiling)
- v3-round2/serp_lens/target_parser.py (target fingerprinting)
- v3-round2/serp_lens/config.py (configuration)
- v3-round2/bacowr_generator.py (prompt generation)

Usage:
    python pipeline.py                       # All jobs
    python pipeline.py --job 14              # Single job
    python pipeline.py --start 1 --end 10    # Range
    python pipeline.py --csv path/to/jobs.csv  # Custom CSV
    python pipeline.py --preflight-only      # Only generate preflights
"""

import asyncio
import argparse
import csv
import hashlib
import json
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple
from urllib.parse import urlparse, quote_plus

try:
    import aiohttp
    from bs4 import BeautifulSoup
    HTTP_AVAILABLE = True
except ImportError:
    HTTP_AVAILABLE = False
    print("WARNING: aiohttp/beautifulsoup4 not installed. Publisher/target analysis disabled.")

try:
    import numpy as np
    from sentence_transformers import SentenceTransformer
    EMBEDDINGS_AVAILABLE = True
except ImportError:
    EMBEDDINGS_AVAILABLE = False
    print("WARNING: sentence-transformers not installed. Semantic distance disabled.")

from models import (
    JobSpec, Preflight, PublisherProfile, TargetFingerprint,
    SemanticBridge, BridgeSuggestion, SourceVerificationResult,
    VerifiedSource, SemanticDistance, BridgeConfidence, RiskLevel,
    GoogleIntelligence, IntentType
)


# ============================================================
# CONFIGURATION
# ============================================================

@dataclass
class PipelineConfig:
    """Centralized configuration for the entire pipeline."""
    # Paths
    csv_path: str = str(Path(__file__).parent / "textjobs_list.csv")
    output_dir: str = str(Path(__file__).parent)
    cache_dir: str = ".cache"

    # Embedding model
    embedding_model: str = "paraphrase-multilingual-MiniLM-L12-v2"

    # Semantic thresholds
    identical_threshold: float = 0.90
    close_threshold: float = 0.70
    moderate_threshold: float = 0.50
    distant_threshold: float = 0.30

    # HTTP
    http_timeout: int = 10
    user_agent: str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

    # Concurrency
    max_concurrent_preflights: int = 10

    # Cache TTL
    publisher_cache_hours: int = 72
    target_cache_hours: int = 24


# ============================================================
# PUBLISHER PROFILER (from publisher_sampler_light.py)
# ============================================================

class PublisherProfiler:
    """Fast publisher profiling — domain name + homepage meta."""

    # Swedish domain topic hints
    DOMAIN_MAP = {
        "fotboll": ["fotboll", "allsvenskan"],
        "sport": ["sport", "idrott"],
        "hockey": ["hockey", "shl"],
        "golf": ["golf", "golfnyheter"],
        "motor": ["motorsport", "bilar"],
        "nyheter": ["nyheter"],
        "ekonomi": ["ekonomi", "finans"],
        "teknik": ["teknik", "it"],
        "tech": ["teknik", "tech"],
        "musik": ["musik"],
        "mat": ["mat", "recept"],
        "resor": ["resor", "turism"],
        "mode": ["mode", "kläder"],
        "hälsa": ["hälsa", "träning"],
        "bygg": ["byggande", "renovering"],
        "villa": ["villa", "bostad", "hem"],
        "affär": ["affärer", "företag"],
        "västerås": ["västerås", "lokalnyheter"],
        "göteborg": ["göteborg", "lokalnyheter"],
        "dopest": ["hiphop", "musik", "kultur"],
        "sales": ["försäljning", "affärer"],
        "executive": ["ledarskap", "företag"],
        "event": ["event", "evenemang"],
        "nordisk": ["nordiskt", "skandinavien"],
        "projekt": ["projekt", "bygge"],
        "casino": ["casino", "spel"],
        "betting": ["betting", "odds"],
        "spela": ["casino", "spel"],
        "odds": ["odds", "betting", "sportspel"],
        "halland": ["halland", "lokalnyheter"],
        "present": ["present", "gåva"],
        "morsdag": ["morsdag", "present", "gåva"],
        "gutt": ["livsstil", "mode"],
    }

    STOP_WORDS = {
        "och", "att", "en", "det", "som", "är", "av", "för", "med",
        "till", "den", "har", "de", "inte", "om", "ett", "vi", "på",
        "the", "and", "to", "of", "a", "in", "is", "for", "on", "with",
        "hem", "start", "nyheter", "senaste", "alla"
    }

    def __init__(self, config: PipelineConfig):
        self.config = config
        self._cache_dir = Path(config.output_dir) / config.cache_dir / "publisher"
        self._cache_dir.mkdir(parents=True, exist_ok=True)

    async def analyze(self, domain: str) -> PublisherProfile:
        domain = domain.replace("www.", "").lower()
        if domain.startswith("http"):
            domain = urlparse(domain).netloc.replace("www.", "")

        cached = self._get_cached(domain)
        if cached:
            return cached

        topics = self._topics_from_domain(domain)
        homepage = await self._quick_homepage(f"https://{domain}") if HTTP_AVAILABLE else {}

        all_topics = list(dict.fromkeys(topics + homepage.get("topics", [])))[:10]
        if not all_topics:
            all_topics = ["allmänt"]

        profile = PublisherProfile(
            domain=domain,
            timestamp=datetime.now(),
            site_name=homepage.get("site_name") or domain,
            site_description=homepage.get("description"),
            primary_language=homepage.get("language", "sv"),
            primary_topics=all_topics,
            category_structure=homepage.get("categories", []),
            confidence=0.7 if topics else 0.5
        )

        self._cache(domain, profile)
        return profile

    def _topics_from_domain(self, domain: str) -> List[str]:
        name = domain.split(".")[0].lower()
        topics = []
        for pattern, pattern_topics in self.DOMAIN_MAP.items():
            if pattern in name:
                topics.extend(pattern_topics)
        if not topics:
            words = re.findall(r'[a-zåäö]{4,}', name)
            topics = [w for w in words if w not in {"nytt", "tidning", "bladet"}]
        return list(dict.fromkeys(topics))[:5]

    async def _quick_homepage(self, url: str) -> Dict[str, Any]:
        result = {"site_name": None, "description": None, "language": "sv", "topics": [], "categories": []}
        try:
            timeout = aiohttp.ClientTimeout(total=5)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url, headers={"User-Agent": self.config.user_agent}, allow_redirects=True) as resp:
                    if resp.status != 200:
                        return result
                    html = await resp.text()

            soup = BeautifulSoup(html, "html.parser")
            title_tag = soup.find("title")
            if title_tag:
                title = title_tag.text.strip()
                result["site_name"] = title.split("|")[0].split("-")[0].strip()
                result["topics"].extend(self._extract_topics(title))

            meta = soup.find("meta", attrs={"name": "description"})
            if meta:
                desc = meta.get("content", "")
                result["description"] = desc
                result["topics"].extend(self._extract_topics(desc))

            html_tag = soup.find("html")
            if html_tag and html_tag.get("lang"):
                result["language"] = html_tag["lang"].split("-")[0]

            nav = soup.find("nav") or soup.find("header")
            if nav:
                for link in nav.find_all("a", limit=10):
                    text = link.get_text(strip=True)
                    if text and 2 < len(text) < 25:
                        result["categories"].append(text)

            result["topics"] = list(dict.fromkeys(result["topics"]))[:10]
        except Exception:
            pass
        return result

    def _extract_topics(self, text: str) -> List[str]:
        words = re.findall(r'\b[a-zåäö]{4,}\b', text.lower())
        return [w for w in words if w not in self.STOP_WORDS][:5]

    def _get_cached(self, domain: str) -> Optional[PublisherProfile]:
        f = self._cache_dir / f"{hashlib.md5(domain.encode()).hexdigest()}.json"
        if not f.exists():
            return None
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            ts = datetime.fromisoformat(data["timestamp"])
            if datetime.now() - ts > timedelta(hours=self.config.publisher_cache_hours):
                return None
            return PublisherProfile(
                domain=data["domain"], timestamp=ts,
                site_name=data.get("site_name"), site_description=data.get("site_description"),
                primary_language=data.get("primary_language", "sv"),
                primary_topics=data.get("primary_topics", []),
                category_structure=data.get("category_structure", []),
                confidence=data.get("confidence", 0.5)
            )
        except Exception:
            return None

    def _cache(self, domain: str, p: PublisherProfile):
        f = self._cache_dir / f"{hashlib.md5(domain.encode()).hexdigest()}.json"
        try:
            f.write_text(json.dumps({
                "domain": p.domain, "timestamp": p.timestamp.isoformat(),
                "site_name": p.site_name, "site_description": p.site_description,
                "primary_language": p.primary_language, "primary_topics": p.primary_topics,
                "category_structure": p.category_structure, "confidence": p.confidence
            }, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass


# ============================================================
# TARGET ANALYZER (from target_parser.py — lightweight)
# ============================================================

class TargetAnalyzer:
    """Lightweight target page analysis using HTTP + BeautifulSoup."""

    def __init__(self, config: PipelineConfig):
        self.config = config
        self._cache_dir = Path(config.output_dir) / config.cache_dir / "target"
        self._cache_dir.mkdir(parents=True, exist_ok=True)

    async def analyze(self, url: str) -> TargetFingerprint:
        cached = self._get_cached(url)
        if cached:
            return cached

        result = TargetFingerprint(url=url, timestamp=datetime.now())

        if HTTP_AVAILABLE:
            try:
                timeout = aiohttp.ClientTimeout(total=self.config.http_timeout)
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.get(url, headers={"User-Agent": self.config.user_agent}) as resp:
                        if resp.status == 200:
                            html = await resp.text()
                            result = self._parse_html(url, html)
            except Exception:
                pass

        self._cache(url, result)
        return result

    def _parse_html(self, url: str, html: str) -> TargetFingerprint:
        soup = BeautifulSoup(html, "html.parser")

        title = ""
        t = soup.find("title")
        if t:
            title = t.get_text(strip=True)

        meta_desc = ""
        m = soup.find("meta", {"name": "description"})
        if m:
            meta_desc = m.get("content", "")

        h1 = ""
        h = soup.find("h1")
        if h:
            h1 = h.get_text(strip=True)

        lang = "sv"
        html_tag = soup.find("html")
        if html_tag and html_tag.get("lang"):
            lang = html_tag["lang"].split("-")[0]

        keywords = self._extract_keywords(soup)
        topic_cluster = self._meaningful_words(f"{title} {meta_desc} {h1}")

        return TargetFingerprint(
            url=url, timestamp=datetime.now(),
            title=title, meta_description=meta_desc, h1=h1,
            language=lang, main_keywords=keywords,
            topic_cluster=topic_cluster
        )

    def _extract_keywords(self, soup) -> List[str]:
        texts = []
        for tag in soup.find_all(["h1", "h2", "h3", "strong", "b"]):
            texts.append(tag.get_text(strip=True))
        return self._meaningful_words(" ".join(texts))[:20]

    def _meaningful_words(self, text: str) -> List[str]:
        stop = {"och", "att", "en", "det", "som", "är", "av", "för", "med",
                "till", "den", "har", "de", "inte", "om", "ett", "vi", "på",
                "the", "and", "to", "of", "a", "in", "is", "for", "on", "with"}
        words = re.findall(r'\b\w{3,}\b', text.lower())
        freq = {}
        for w in words:
            if w not in stop:
                freq[w] = freq.get(w, 0) + 1
        return sorted(freq, key=lambda x: freq[x], reverse=True)[:15]

    def _get_cached(self, url: str) -> Optional[TargetFingerprint]:
        key = hashlib.md5(url.encode()).hexdigest()
        f = self._cache_dir / f"{key}.json"
        if not f.exists():
            return None
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            ts = datetime.fromisoformat(data["timestamp"])
            if datetime.now() - ts > timedelta(hours=self.config.target_cache_hours):
                return None
            return TargetFingerprint(
                url=data["url"], timestamp=ts,
                title=data.get("title", ""), meta_description=data.get("meta_description", ""),
                h1=data.get("h1", ""), language=data.get("language", "sv"),
                main_keywords=data.get("main_keywords", []),
                topic_cluster=data.get("topic_cluster", [])
            )
        except Exception:
            return None

    def _cache(self, url: str, t: TargetFingerprint):
        key = hashlib.md5(url.encode()).hexdigest()
        f = self._cache_dir / f"{key}.json"
        try:
            f.write_text(json.dumps({
                "url": t.url, "timestamp": t.timestamp.isoformat(),
                "title": t.title, "meta_description": t.meta_description,
                "h1": t.h1, "language": t.language,
                "main_keywords": t.main_keywords, "topic_cluster": t.topic_cluster
            }, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass


# ============================================================
# SEMANTIC ENGINE (from semantic_engine.py)
# ============================================================

class SemanticEngine:
    """Calculates semantic distance and generates bridge suggestions."""

    # Pre-defined bridges for common verticals (imported from shared models)
    from models import BRIDGE_CONCEPTS
    VERTICAL_BRIDGES = BRIDGE_CONCEPTS

    def __init__(self, config: PipelineConfig):
        self.config = config
        self._model = None

    def _get_model(self):
        if self._model is None and EMBEDDINGS_AVAILABLE:
            import os, logging
            # Suppress transformers/tokenizers progress bars and stderr spam
            os.environ["TRANSFORMERS_NO_ADVISORY_WARNINGS"] = "1"
            os.environ["TOKENIZERS_PARALLELISM"] = "false"
            os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
            logging.getLogger("sentence_transformers").setLevel(logging.WARNING)
            logging.getLogger("transformers").setLevel(logging.WARNING)
            logging.getLogger("huggingface_hub").setLevel(logging.WARNING)
            print(f"Loading embedding model: {self.config.embedding_model}")
            self._model = SentenceTransformer(self.config.embedding_model)
        return self._model

    def analyze(
        self,
        publisher: PublisherProfile,
        target: TargetFingerprint,
        anchor_text: str
    ) -> SemanticBridge:
        """Calculate semantic distance and generate bridge suggestions."""

        pub_text = " ".join(publisher.primary_topics)
        target_text = " ".join(target.main_keywords[:10] + target.topic_cluster[:5])
        if not target_text:
            target_text = target.title + " " + target.h1

        # Calculate distance
        raw_distance = self._cosine_similarity(pub_text, target_text)
        category = self._categorize(raw_distance)

        # Generate bridges
        suggestions = self._generate_bridges(publisher, target, anchor_text, category)

        # Determine entities
        required = list(set(publisher.primary_topics[:3] + target.main_keywords[:3]))
        forbidden = self._forbidden_entities(target)

        # Trust link guidance (uses bridge concept for semantic relevance)
        bridge_concept = suggestions[0].concept if suggestions else ""
        trust_topics = self._trust_link_topics(publisher, target, anchor_text, bridge_concept)
        trust_avoid = self._trust_link_avoid(target)

        # Recommended angle
        angle = None
        if suggestions:
            angle = suggestions[0].suggested_angle or suggestions[0].concept

        return SemanticBridge(
            publisher_domain=publisher.domain,
            target_url=target.url,
            anchor_text=anchor_text,
            timestamp=datetime.now(),
            raw_distance=raw_distance,
            distance_category=category,
            suggestions=suggestions,
            recommended_angle=angle,
            required_entities=required,
            forbidden_entities=forbidden,
            trust_link_topics=trust_topics,
            trust_link_avoid=trust_avoid
        )

    def _cosine_similarity(self, text_a: str, text_b: str) -> float:
        model = self._get_model()
        if model is None:
            return 0.5  # Fallback

        embeddings = model.encode([text_a, text_b])
        a, b = embeddings[0], embeddings[1]
        cos = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))
        return max(0.0, min(1.0, cos))

    def _categorize(self, score: float) -> SemanticDistance:
        if score >= self.config.identical_threshold:
            return SemanticDistance.IDENTICAL
        elif score >= self.config.close_threshold:
            return SemanticDistance.CLOSE
        elif score >= self.config.moderate_threshold:
            return SemanticDistance.MODERATE
        elif score >= self.config.distant_threshold:
            return SemanticDistance.DISTANT
        else:
            return SemanticDistance.UNRELATED

    def _generate_bridges(
        self, publisher: PublisherProfile, target: TargetFingerprint,
        anchor_text: str, distance: SemanticDistance
    ) -> List[BridgeSuggestion]:
        suggestions = []

        # Try pre-defined bridges
        for pub_topic in publisher.primary_topics:
            for tgt_word in target.topic_cluster[:5] + target.main_keywords[:5]:
                key = (pub_topic, tgt_word)
                if key in self.VERTICAL_BRIDGES:
                    concepts = self.VERTICAL_BRIDGES[key]
                    suggestions.append(BridgeSuggestion(
                        concept=" → ".join(concepts),
                        rationale=f"Publisher ({pub_topic}) och target ({tgt_word}) kopplas via {concepts[1]}",
                        confidence=BridgeConfidence.HIGH,
                        confidence_score=0.85,
                        publisher_relevance=0.9,
                        target_relevance=0.8,
                        suggested_angle=f"Hur {concepts[1]} formar {pub_topic}",
                        entities_to_include=concepts
                    ))

        # Fallback: intersect-based bridge
        if not suggestions:
            pub_set = set(w.lower() for w in publisher.primary_topics)
            tgt_set = set(w.lower() for w in target.main_keywords + target.topic_cluster)
            common = pub_set & tgt_set

            if common:
                concept = ", ".join(list(common)[:3])
                suggestions.append(BridgeSuggestion(
                    concept=concept,
                    rationale=f"Gemensamma teman: {concept}",
                    confidence=BridgeConfidence.MEDIUM,
                    confidence_score=0.6,
                    publisher_relevance=0.7,
                    target_relevance=0.7,
                    suggested_angle=f"Perspektiv kring {list(common)[0]}"
                ))

        # Ultra-fallback: anchor-derived
        if not suggestions:
            suggestions.append(BridgeSuggestion(
                concept=anchor_text,
                rationale="Ankartextens semantik som brygga",
                confidence=BridgeConfidence.LOW,
                confidence_score=0.4,
                publisher_relevance=0.5,
                target_relevance=0.8,
                suggested_angle=f"Tema härledd från: {anchor_text}"
            ))

        return suggestions[:3]

    def _forbidden_entities(self, target: TargetFingerprint) -> List[str]:
        """Entities to avoid based on target vertical."""
        url_lower = target.url.lower()
        forbidden = []
        if any(w in url_lower for w in ["casino", "betting", "spel", "odds"]):
            forbidden.extend(["spelinspektionen", "spelpaus", "spelansvar",
                            "spelmissbruk", "spelberoende", "stödlinjen"])
        return forbidden

    def _trust_link_topics(
        self,
        pub: PublisherProfile,
        target: TargetFingerprint,
        anchor_text: str = "",
        bridge_concept: str = ""
    ) -> List[str]:
        """Generate trust link topics that bridge publisher and target domains.

        Strategy: find the semantic intersection between publisher's expertise
        and target's domain, using bridge concept and anchor as guides.
        """
        topics: List[str] = []

        # Primary: bridge concept (the semantic link between publisher and target)
        if bridge_concept and bridge_concept not in topics:
            topics.append(bridge_concept)

        # Secondary: intersection of publisher topics and target keywords
        pub_set = set(w.lower() for w in pub.primary_topics)
        tgt_set = set(w.lower() for w in target.main_keywords[:10] + target.topic_cluster[:5])
        overlap = pub_set & tgt_set
        topics.extend(sorted(overlap)[:2])

        # Tertiary: anchor text in context (guide/studie suffix for searchability)
        if anchor_text and len(anchor_text.split()) <= 3:
            anchor_topic = f"{anchor_text} guide"
            if anchor_topic not in topics:
                topics.append(anchor_topic)

        # Quaternary: publisher + target combined concept
        if len(topics) < 2 and pub.primary_topics and target.main_keywords:
            combo = f"{pub.primary_topics[0]} {target.main_keywords[0]}"
            if combo not in topics:
                topics.append(combo)

        # Fallback: publisher topics (better than "statistik forskning")
        if not topics:
            topics = pub.primary_topics[:2]

        return topics[:4]

    def _trust_link_avoid(self, target: TargetFingerprint) -> List[str]:
        """Domains to never use as trust links."""
        avoid = []
        target_domain = urlparse(target.url).netloc.replace("www.", "")
        avoid.append(target_domain)

        url_lower = target.url.lower()
        if any(w in url_lower for w in ["casino", "betting", "spel"]):
            avoid.extend(["bettingstugan.se", "casinon.com", "casinostugan.se",
                         "spelbolagen.se", "casinoutansvensklicens.com"])
        return avoid


# ============================================================
# LANGUAGE DETECTOR
# ============================================================

def detect_language(domain: str) -> str:
    """Detect article language from publisher domain.
    Heuristic: .co.uk/.uk/.com with English-pattern words → en, else sv.
    Override per-job by adding a 'language' column to the CSV.
    """
    domain = domain.lower()
    if domain.endswith((".co.uk", ".uk")):
        return "en"
    # Common English-only TLDs with English domain words
    if domain.endswith(".com"):
        name = domain.split(".")[0]
        english_signals = ["weekly", "town", "kingdom", "blog", "news",
                           "world", "daily", "times", "online", "hub"]
        if any(sig in name for sig in english_signals):
            return "en"
    return "sv"


# ============================================================
# RISK ASSESSOR
# ============================================================

def assess_risk(bridge: SemanticBridge, target: TargetFingerprint) -> RiskLevel:
    """Determine risk level based on semantic distance and target type."""
    if bridge.distance_category == SemanticDistance.UNRELATED:
        return RiskLevel.HIGH
    if bridge.distance_category == SemanticDistance.DISTANT:
        return RiskLevel.MEDIUM

    # YMYL check
    url_lower = target.url.lower()
    ymyl_patterns = ["hälsa", "health", "medicin", "medicine", "juridik", "legal"]
    if any(p in url_lower for p in ymyl_patterns):
        return RiskLevel.HIGH

    return RiskLevel.LOW


# ============================================================
# PROMPT GENERATOR (from bacowr_generator.py)
# ============================================================

class PromptGenerator:
    """Generates article generation prompts from preflight data."""

    def generate(self, preflight: Preflight) -> str:
        """Create a complete article generation prompt."""
        job = preflight.job
        lang = preflight.language

        # Build source info if available
        sources_section = ""
        if preflight.sources and preflight.sources.verified_sources:
            sources_section = "\n\n### VERIFIERADE KÄLLOR (använd dessa som trustlänkar)\n"
            for s in preflight.sources.verified_sources:
                facts = "; ".join(s.extracted_facts[:3])
                sources_section += f"- **{s.domain}**: [{facts}]({s.url})\n"

        # Build semantic context
        semantic_section = ""
        if preflight.bridge:
            b = preflight.bridge
            semantic_section = f"""
### SEMANTISK ANALYS
- **Distans**: {b.distance_category.value} ({b.raw_distance:.2f})
- **Rekommenderad vinkel**: {b.recommended_angle}
- **Entiteter att väva in**: {', '.join(b.required_entities)}
- **Undvik**: {', '.join(b.forbidden_entities)}
"""

        # Publisher context
        pub_section = ""
        if preflight.publisher:
            p = preflight.publisher
            pub_section = f"""
### PUBLISHER
- **Sajt**: {p.site_name} ({p.domain})
- **Ämnen**: {', '.join(p.primary_topics)}
- **Språk**: {p.primary_language}
"""

        prompt = f"""# ARTIKELUPPDRAG — Jobb {job.job_number}

## INPUT
- **Publisher**: {job.publisher_domain}
- **Target URL**: {job.target_url}
- **Ankartext**: {job.anchor_text}
- **Språk**: {lang}
{pub_section}{semantic_section}{sources_section}
## REGLER

### Ordantal
750-900 ord (hårda gränser). Stycken 100-200 ord, fullt utvecklade tankar.

### Ankarlänk
- Exakt 1 st: `[{job.anchor_text}]({job.target_url})`
- Placera mellan ord 250-550. VARIERA placeringen per artikel.
- ALDRIG i intro (första 250 ord) eller outro (sista 100 ord)

### Trustlänkar
- 1-2 verifierade källhänvisningar
- Placeras FÖRE ankarlänken i artikelflödet
- ALDRIG i samma stycke som ankarlänken
- ALDRIG till konkurrenter eller affiliatesajter
- Varje trustlänk ska vara en DJUPLÄNK (ej rotdomän)
{"- Använd de verifierade källorna ovan" if sources_section else "- Verifiera med WebFetch innan du länkar"}

### Förbjudna fraser
"Det är viktigt att notera", "I denna artikel", "Sammanfattningsvis kan sägas",
"Låt oss utforska", "I dagens digitala värld", "Det har blivit allt viktigare"

### Struktur
- EN rubrik (titel) - max 1 heading
- Resten är flytande prosa i paragrafer, INGA H2/H3-underrubriker
- INGA punktlistor, INGA numrerade listor i artikeln
- Minst 4 substantiella paragrafer (100–200 ord vardera)

### Kvalitetskontroll (kör efter artikeln)
Kör QA-scriptet från qa-template.md efter artikeln är skriven till disk.
11 binära checks – alla måste passera.
"""
        return prompt.strip()


# ============================================================
# FLEXIBLE CSV PARSING (extracted from runner.py)
# ============================================================

def _parse_textjobs(path: Path) -> List[Dict[str, str]]:
    """Parse CSV with flexible delimiter detection (comma or pipe)."""
    raw = path.read_text(encoding="utf-8").splitlines()
    lines = [l.strip() for l in raw if l.strip()]
    if not lines:
        return []
    header = lines[0]
    delimiter = "|" if "|" in header else ","
    headers = [h.strip() for h in header.split(delimiter)]

    rows = []
    for line in lines[1:]:
        parts = [p.strip() for p in line.split(delimiter)]
        if len(parts) < len(headers):
            continue
        row = {headers[i]: parts[i] for i in range(len(headers))}
        rows.append(row)
    return rows


def _normalize_job(row: Dict[str, str]) -> Dict[str, str]:
    """Normalize varying column names and fix malformed values."""

    def pick(*keys):
        for k in keys:
            if k in row and row[k]:
                return row[k].strip()
        return ""

    def normalize_url(url: str) -> str:
        u = url.strip()
        if u.startswith("http:/") and not u.startswith("http://"):
            u = u.replace("http:/", "http://", 1)
        if u.startswith("https:/") and not u.startswith("https://"):
            u = u.replace("https:/", "https://", 1)
        return u

    def normalize_domain(value: str) -> str:
        v = value.strip()
        if not v:
            return ""
        if "://" in v:
            dom = urlparse(v).netloc
        else:
            dom = v.split("/")[0]
        return dom.replace("www.", "")

    job_id = pick("job_id", "job_Id", "job_number", "job", "job_nummer")
    pub = pick("publication_domain", "publisher_domain", "publisher", "publication_url")
    target = pick("link_target_page", "target_page", "target_url", "target")
    anchor = pick("anchor_text", "anchor")

    return {
        "job_id": job_id,
        "publisher_domain": normalize_domain(pub),
        "target_url": normalize_url(target),
        "anchor_text": anchor,
    }


# ============================================================
# PIPELINE ORCHESTRATOR
# ============================================================

class Pipeline:
    """Main pipeline: CSV → Preflight → Article Prompt."""

    def __init__(self, config: PipelineConfig):
        self.config = config
        self.publisher_profiler = PublisherProfiler(config)
        self.target_analyzer = TargetAnalyzer(config)
        self.semantic_engine = SemanticEngine(config)
        self.prompt_generator = PromptGenerator()

    def load_jobs(self, csv_path: Optional[str] = None) -> List[JobSpec]:
        """Load job list from CSV.

        Handles varying column names and delimiters gracefully:
        - job_id / job_Id / job_number / job / job_nummer
        - publication_domain / publisher_domain / publisher / publication_url
        - link_target_page / target_page / target_url / target
        - anchor_text / anchor
        Also handles '|' delimiters and malformed URLs.
        """
        path = Path(csv_path or self.config.csv_path)
        if not path.exists():
            print(f"ERROR: CSV not found: {path}")
            sys.exit(1)

        raw_rows = _parse_textjobs(path)
        jobs = []
        skipped = 0
        for row in raw_rows:
            norm = _normalize_job(row)
            job_id = norm["job_id"]
            pub = norm["publisher_domain"]
            target = norm["target_url"]
            anchor = norm["anchor_text"]

            if not job_id or not pub or not target or not anchor:
                skipped += 1
                continue

            try:
                jn = int(job_id)
            except ValueError:
                skipped += 1
                continue

            jobs.append(JobSpec(
                job_number=jn,
                publisher_domain=pub,
                target_url=target,
                anchor_text=anchor,
            ))

        if skipped:
            print(f"WARNING: Skipped {skipped} malformed rows")
        print(f"Loaded {len(jobs)} jobs from {path.name}")
        return jobs

    async def run_preflight(self, job: JobSpec) -> Preflight:
        """Run preflight analysis for a single job."""
        print(f"\n{'='*60}")
        print(f"JOB {job.job_number}: {job.publisher_domain} → {job.anchor_text}")
        print(f"{'='*60}")

        # Publisher analysis
        print(f"  [1/3] Publisher: {job.publisher_domain}")
        publisher = await self.publisher_profiler.analyze(job.publisher_domain)
        print(f"        Topics: {publisher.primary_topics}")

        # Target analysis
        print(f"  [2/3] Target: {job.target_url[:60]}...")
        target = await self.target_analyzer.analyze(job.target_url)
        print(f"        Keywords: {target.main_keywords[:5]}")

        # Semantic bridge
        print(f"  [3/3] Semantic analysis...")
        bridge = self.semantic_engine.analyze(publisher, target, job.anchor_text)
        print(f"        Distance: {bridge.distance_category.value} ({bridge.raw_distance:.3f})")
        print(f"        Angle: {bridge.recommended_angle}")

        # Language & Risk
        language = detect_language(job.publisher_domain)
        risk = assess_risk(bridge, target)

        preflight = Preflight(
            job=job,
            publisher=publisher,
            target=target,
            bridge=bridge,
            risk_level=risk,
            language=language,
            generated_at=datetime.now()
        )

        return preflight

    def warmup(self):
        """Pre-load the embedding model so batch preflight doesn't stall."""
        self.semantic_engine._get_model()

    async def run_batch_preflight(
        self,
        jobs: List[JobSpec],
        max_concurrent: Optional[int] = None,
    ) -> List[Preflight]:
        """Run preflight for multiple jobs concurrently.

        Uses asyncio.gather with a semaphore to limit parallelism.
        The embedding model is loaded once before the batch starts.
        """
        concurrency = max_concurrent or self.config.max_concurrent_preflights

        # Pre-warm model so it loads once, not per-task
        self.warmup()

        sem = asyncio.Semaphore(concurrency)

        async def _limited(job: JobSpec) -> Preflight:
            async with sem:
                return await self.run_preflight(job)

        print(f"\nRunning {len(jobs)} preflights (max {concurrency} concurrent)...")
        t0 = time.time()
        results = await asyncio.gather(*[_limited(j) for j in jobs])
        elapsed = time.time() - t0
        print(f"Batch preflight done: {len(results)} jobs in {elapsed:.1f}s")
        return list(results)

    def save_preflight(self, preflight: Preflight):
        """Save preflight JSON to disk."""
        preflight_dir = Path(self.config.output_dir) / "preflight"
        preflight_dir.mkdir(parents=True, exist_ok=True)

        path = preflight_dir / f"preflight_{preflight.job.job_number:03d}.json"
        path.write_text(preflight.to_json(), encoding="utf-8")
        print(f"  Saved: {path.name}")

    def save_prompt(self, preflight: Preflight):
        """Save article generation prompt to disk."""
        prompts_dir = Path(self.config.output_dir) / "prompts"
        prompts_dir.mkdir(parents=True, exist_ok=True)

        prompt = self.prompt_generator.generate(preflight)
        path = prompts_dir / f"prompt_{preflight.job.job_number:03d}.md"
        path.write_text(prompt, encoding="utf-8")
        print(f"  Saved: {path.name}")

    async def run(
        self,
        jobs: Optional[List[JobSpec]] = None,
        csv_path: Optional[str] = None,
        job_number: Optional[int] = None,
        start: Optional[int] = None,
        end: Optional[int] = None,
        preflight_only: bool = False
    ):
        """Run the full pipeline."""
        if jobs is None:
            jobs = self.load_jobs(csv_path)

        # Filter
        if job_number is not None:
            jobs = [j for j in jobs if j.job_number == job_number]
        elif start is not None or end is not None:
            s = start or 1
            e = end or 999
            jobs = [j for j in jobs if s <= j.job_number <= e]

        if not jobs:
            print("No jobs to process.")
            return

        print(f"\nProcessing {len(jobs)} job(s)...")
        t0 = time.time()

        # Batch preflight — parallel execution
        all_preflights = await self.run_batch_preflight(jobs)
        for preflight in all_preflights:
            self.save_preflight(preflight)
            self.save_prompt(preflight)

        # Save combined preflights
        combined_path = Path(self.config.output_dir) / "all_preflights.json"
        combined = [json.loads(p.to_json()) for p in all_preflights]
        combined_path.write_text(
            json.dumps(combined, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )

        elapsed = time.time() - t0
        print(f"\n{'='*60}")
        print(f"DONE: {len(all_preflights)} preflights + prompts in {elapsed:.1f}s")
        print(f"Output: {self.config.output_dir}")
        print(f"{'='*60}")


# ============================================================
# STANDALONE TOOLS (agentanropbara, agnostiska)
# ============================================================
# Agenten kan köra dessa individuellt med valfria parametrar.
# Varje tool tar input, gör EN sak, returnerar JSON.

async def tool_profile_publisher(domain: str, config: PipelineConfig = None) -> str:
    """Profile a publisher domain. Returns JSON."""
    config = config or PipelineConfig()
    profiler = PublisherProfiler(config)
    result = await profiler.analyze(domain)
    return json.dumps({
        "domain": result.domain,
        "site_name": result.site_name,
        "topics": result.primary_topics,
        "language": result.primary_language,
        "categories": result.category_structure,
        "confidence": result.confidence
    }, ensure_ascii=False, indent=2)


async def tool_analyze_target(url: str, config: PipelineConfig = None) -> str:
    """Analyze a target URL. Returns JSON."""
    config = config or PipelineConfig()
    analyzer = TargetAnalyzer(config)
    result = await analyzer.analyze(url)
    return json.dumps({
        "url": result.url,
        "title": result.title,
        "h1": result.h1,
        "description": result.meta_description[:200],
        "language": result.language,
        "keywords": result.main_keywords[:15],
        "topic_cluster": result.topic_cluster[:10]
    }, ensure_ascii=False, indent=2)


def tool_semantic_distance(
    publisher_topics: List[str],
    target_keywords: List[str],
    anchor_text: str,
    config: PipelineConfig = None
) -> str:
    """Calculate semantic distance between publisher and target. Returns JSON."""
    config = config or PipelineConfig()
    engine = SemanticEngine(config)

    pub = PublisherProfile(
        domain="input", timestamp=datetime.now(),
        primary_topics=publisher_topics
    )
    tgt = TargetFingerprint(
        url="input", timestamp=datetime.now(),
        main_keywords=target_keywords
    )
    bridge = engine.analyze(pub, tgt, anchor_text)
    return json.dumps({
        "distance": round(bridge.raw_distance, 3),
        "category": bridge.distance_category.value,
        "recommended_angle": bridge.recommended_angle,
        "bridges": [
            {"concept": s.concept, "rationale": s.rationale, "confidence": s.confidence.value}
            for s in bridge.suggestions
        ],
        "required_entities": bridge.required_entities,
        "forbidden_entities": bridge.forbidden_entities,
        "trust_link_topics": bridge.trust_link_topics
    }, ensure_ascii=False, indent=2)


# ============================================================
# CLI
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="BACOWR v5.1 Pipeline & Tools")
    sub = parser.add_subparsers(dest="command", help="Command to run")

    # Full pipeline
    run_p = sub.add_parser("run", help="Run full pipeline")
    run_p.add_argument("--csv", help="Path to job list CSV")
    run_p.add_argument("--job", type=int, help="Run single job number")
    run_p.add_argument("--start", type=int, help="Start job number")
    run_p.add_argument("--end", type=int, help="End job number")
    run_p.add_argument("--preflight-only", action="store_true")
    run_p.add_argument("--output", default=str(Path(__file__).parent))

    # Individual tools
    pub_p = sub.add_parser("publisher", help="Profile a publisher domain")
    pub_p.add_argument("domain", help="Publisher domain (e.g. sportligan.se)")

    tgt_p = sub.add_parser("target", help="Analyze a target URL")
    tgt_p.add_argument("url", help="Target URL")

    dist_p = sub.add_parser("distance", help="Calculate semantic distance")
    dist_p.add_argument("--pub-topics", nargs="+", required=True, help="Publisher topics")
    dist_p.add_argument("--tgt-keywords", nargs="+", required=True, help="Target keywords")
    dist_p.add_argument("--anchor", required=True, help="Anchor text")

    args = parser.parse_args()

    if args.command == "run" or args.command is None:
        config = PipelineConfig(output_dir=getattr(args, "output", str(Path(__file__).parent)))
        csv_path = getattr(args, "csv", None)
        if csv_path:
            config.csv_path = csv_path
        pipeline = Pipeline(config)
        asyncio.run(pipeline.run(
            csv_path=csv_path,
            job_number=getattr(args, "job", None),
            start=getattr(args, "start", None),
            end=getattr(args, "end", None),
            preflight_only=getattr(args, "preflight_only", False)
        ))

    elif args.command == "publisher":
        result = asyncio.run(tool_profile_publisher(args.domain))
        print(result)

    elif args.command == "target":
        result = asyncio.run(tool_analyze_target(args.url))
        print(result)

    elif args.command == "distance":
        result = tool_semantic_distance(
            args.pub_topics, args.tgt_keywords, args.anchor
        )
        print(result)


if __name__ == "__main__":
    main()
