"""
BACOWR ARTICLE INTELLIGENCE ENGINE v6.2
=========================================
"From Three Variables to a Complete Article Blueprint"

ARCHITECTURE (adapted from Entity & Cluster Intelligence Engine v3.0):
- TargetIntentAnalyzer     (5-step SERP research for confirmed TA intent)
- TopicDiscoveryEngine     (find unique, viable article topics)
- BridgeGravityEngine      (score context bridges with 4-component gravity)
- ThesisForge              (generate and validate article thesis)
- ConstraintEnforcer       (strict rules without killing creativity)
- RedThreadValidator       (ensure narrative coherence across sections)
- ArticleOrchestrator      (full pipeline: JobSpec -> ArticleBlueprint)

PIPELINE:
1. INPUT PARSE         (publisher_domain, target_url, anchor_text)
2. PUBLISHER PROFILE   (domain -> topic universe)
3. TARGET FINGERPRINT  (url -> entity/keyword map)
4. SERP INTELLIGENCE   (5-step SERP research -> confirmed TA intent)
5. GAP ANALYSIS        (semantic distance, bridge requirements)
6. TOPIC DISCOVERY     (find unique article topic that bridges the gap)
7. BRIDGE SCORING      (gravity-weighted bridge ranking)
8. THESIS FORGE        (one sentence that drives the entire article)
9. SECTION PLANNING    (outline with red thread validation)
10. CONSTRAINT CHECK   (hard rules, soft rules, forbidden patterns)
11. BLUEPRINT OUTPUT   (complete agent instructions for article generation)

DESIGN PRINCIPLES:
- The agent receives ONLY publisher, target, anchor. NO topic suggestions.
- The engine DISCOVERS topics, it does not dictate them.
- Strict constraints + creative freedom = quality articles.
- Every decision is traceable (reason chains, confidence scores).
- Agnostic: works with any publisher-target combination.
"""

import re
import math
import json
import hashlib
import logging
from typing import List, Dict, Optional, Tuple, Set, Any
from dataclasses import dataclass, field, asdict
from enum import Enum
from collections import defaultdict
from datetime import datetime


# =============================================================================
# ENUMS
# =============================================================================

class ArticlePhase(str, Enum):
    """Pipeline phases for tracking progress."""
    INPUT_PARSED = "input_parsed"
    PUBLISHER_PROFILED = "publisher_profiled"
    TARGET_FINGERPRINTED = "target_fingerprinted"
    SERP_INTELLIGENCE_BUILT = "serp_intelligence_built"
    GAP_ANALYZED = "gap_analyzed"
    TOPIC_DISCOVERED = "topic_discovered"
    BRIDGES_SCORED = "bridges_scored"
    THESIS_FORGED = "thesis_forged"
    SECTIONS_PLANNED = "sections_planned"
    CONSTRAINTS_CHECKED = "constraints_checked"
    BLUEPRINT_READY = "blueprint_ready"


class SemanticDistance(str, Enum):
    """How far apart publisher and target are semantically."""
    IDENTICAL = "identical"      # >= 0.90 – same topic universe
    CLOSE = "close"              # >= 0.70 – neighboring topics
    MODERATE = "moderate"        # >= 0.50 – visible overlap
    DISTANT = "distant"          # >= 0.30 – weak overlap, needs strong bridge
    UNRELATED = "unrelated"      # <  0.30 – danger zone


class TopicViability(str, Enum):
    """How viable a discovered topic is for this specific job."""
    EXCELLENT = "excellent"      # Natural fit, strong bridge potential
    GOOD = "good"                # Solid fit, clear path to anchor
    ACCEPTABLE = "acceptable"    # Workable but requires careful bridging
    RISKY = "risky"              # Possible but high chance of feeling forced
    REJECTED = "rejected"        # Cannot produce natural article


class BridgeStrength(str, Enum):
    """How strong a context bridge is at connecting publisher<->target."""
    STEEL = "steel"              # Direct, verifiable, strong semantic overlap
    IRON = "iron"                # Clear connection, some inference needed
    WOOD = "wood"                # Plausible connection, requires skillful writing
    PAPER = "paper"              # Weak, risks feeling artificial


class BridgeRole(str, Enum):
    """What role a bridge plays in the article (mapped from ClusterRole)."""
    PRIMARY = "primary"          # Main bridge – carries the article's thesis
    SUPPORTING = "supporting"    # Reinforces the primary bridge
    CONTEXTUAL = "contextual"    # Adds depth but not critical path


class AnchorNaturalness(str, Enum):
    """How naturally the anchor text fits in the planned context."""
    SEAMLESS = "seamless"        # Reader wouldn't notice it's a link
    NATURAL = "natural"          # Fits well, minor friction at most
    ADEQUATE = "adequate"        # Works but a careful reader might notice
    FORCED = "forced"            # Feels inserted – needs rework


class RiskLevel(str, Enum):
    """Overall risk assessment for the article job."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class SectionRole(str, Enum):
    """What each section does in the article's narrative."""
    HOOK = "hook"                # Opening – establishes concrete topic
    ESTABLISH = "establish"      # Background – but woven into narrative, not freestanding
    DEEPEN = "deepen"            # Deepens the thesis with evidence
    BRIDGE = "bridge"            # The section where context links live
    ANCHOR = "anchor"            # The section where the anchor link lives
    PIVOT = "pivot"              # New angle that advances the thesis
    RESOLVE = "resolve"          # Closing – ties threads, no repetition


class ConstraintType(str, Enum):
    """Types of constraints the engine enforces."""
    HARD = "hard"                # Violation = article fails (word count, anchor placement)
    SOFT = "soft"                # Violation = warning, should fix (style, tone)
    FORBIDDEN = "forbidden"      # AI markers, banned phrases


# =============================================================================
# CORE DATA MODELS
# =============================================================================

@dataclass
class PublisherUniverse:
    """The publisher's topic universe – what this domain 'is about'."""
    domain: str
    site_name: str = ""
    primary_topics: List[str] = field(default_factory=list)
    secondary_topics: List[str] = field(default_factory=list)
    language: str = "sv"
    category_structure: List[str] = field(default_factory=list)
    editorial_tone: str = ""     # Detected or inferred tone
    confidence: float = 0.0

    @property
    def topic_text(self) -> str:
        """Flat text representation for embedding."""
        return " ".join(self.primary_topics + self.secondary_topics)


@dataclass
class TargetEntity:
    """An entity extracted from the target page."""
    name: str
    entity_type: str             # product, brand, category, concept
    salience: float = 0.0        # How central this entity is to the target


@dataclass
class SerpSnapshot:
    """Metadata extracted from one SERP result (position 1-3)."""
    position: int
    title: str
    meta_description: str
    url: str
    domain: str = ""
    # Derived
    title_entities: List[str] = field(default_factory=list)
    desc_entities: List[str] = field(default_factory=list)
    intent_signal: str = ""      # informational / transactional / commercial / navigational


@dataclass
class SerpProbe:
    """Result of one WebSearch probe in the 5-step SERP research."""
    step: int                    # 1-5
    step_name: str               # e.g. "head_entity", "cluster_search", etc.
    query: str                   # Exact search query used
    purpose: str                 # Why this search was done
    top_results: List[SerpSnapshot] = field(default_factory=list)
    # Analysis
    dominant_intent: str = ""    # What Google thinks this query means
    entity_overlap_with_target: List[str] = field(default_factory=list)  # Entities shared with target
    new_entities_discovered: List[str] = field(default_factory=list)     # Entities NOT on target
    intent_alignment: float = 0.0  # How well target's intent aligns with SERP (0-1)
    insight: str = ""            # Human-readable insight from this probe


@dataclass
class TargetIntentProfile:
    """
    Complete SERP-derived understanding of the target page's intent landscape.
    Built from 5 WebSearch probes that reverse-engineer Google's view.

    This is the single most important data structure for bridge selection:
    it tells us EXACTLY what TA the article should strengthen.
    """
    target_url: str

    # From target page metadata
    meta_title: str = ""
    meta_description: str = ""
    head_entity: str = ""                # 1-2 word core entity from meta title
    cluster_query: str = ""              # Cluster search derived from meta title
    meta_desc_predicate: str = ""        # Action/predicate from meta description

    # SERP probes (the 5 WebSearches)
    probes: List[SerpProbe] = field(default_factory=list)

    # Synthesized intelligence
    confirmed_intent: str = ""           # Target's search intent verified against Google
    intent_matches_serp: bool = False    # Does target's intent match what Google shows?
    intent_gap: str = ""                 # If mismatch: what Google expects vs what target offers

    # Entity & cluster map
    core_entities: List[str] = field(default_factory=list)      # Entities that DEFINE target's TA
    cluster_entities: List[str] = field(default_factory=list)    # Cluster/related entities for TA
    lsi_terms: List[str] = field(default_factory=list)           # LSI terms from SERP analysis
    competitor_entities: List[str] = field(default_factory=list) # Entities competitors use but target doesn't

    # TA guidance for article
    ta_target_description: str = ""      # What TA the article should strengthen
    entities_to_weave: List[str] = field(default_factory=list)  # Entities to include in article
    entities_to_avoid: List[str] = field(default_factory=list)  # Entities that dilute TA
    ideal_bridge_direction: str = ""     # What the context link should conceptually achieve

    # Confidence
    confidence: float = 0.0
    probes_completed: int = 0

    @property
    def has_serp_data(self) -> bool:
        return self.probes_completed >= 3

    def get_all_serp_entities(self) -> List[str]:
        """All unique entities discovered across all probes."""
        all_entities = set()
        for probe in self.probes:
            all_entities.update(probe.entity_overlap_with_target)
            all_entities.update(probe.new_entities_discovered)
        all_entities.update(self.core_entities)
        all_entities.update(self.cluster_entities)
        return sorted(all_entities)


@dataclass
class TargetUniverse:
    """The target page's entity and keyword universe."""
    url: str
    title: str = ""
    h1: str = ""
    meta_description: str = ""
    language: str = "sv"
    main_keywords: List[str] = field(default_factory=list)
    topic_cluster: List[str] = field(default_factory=list)
    entities: List[TargetEntity] = field(default_factory=list)
    search_intent: str = ""      # What the user searching for this would want
    competitor_domains: List[str] = field(default_factory=list)

    # SERP intelligence (NEW – the deep understanding)
    intent_profile: Optional[TargetIntentProfile] = None

    @property
    def keyword_text(self) -> str:
        return " ".join(self.main_keywords + self.topic_cluster)

    @property
    def has_serp_intelligence(self) -> bool:
        return self.intent_profile is not None and self.intent_profile.has_serp_data


@dataclass
class GapAnalysis:
    """The semantic gap between publisher and target."""
    raw_distance: float
    distance_category: SemanticDistance
    overlap_entities: List[str]  # Entities shared between publisher and target
    gap_entities: List[str]      # Entities on target side not covered by publisher
    bridge_requirement: int      # 0, 1, or 2 context bridges needed
    risk_level: RiskLevel
    reasoning: str               # Why this gap assessment was made


@dataclass
class BridgeGravity:
    """Gravity components for a context bridge (adapted from EntityGravity).

    Formula:
    bridge_gravity =
        0.35 * semantic_pull     (how strongly it connects publisher<->target)
      + 0.25 * factual_mass      (verifiable facts, data points available)
      + 0.25 * topic_fit         (how naturally it fits the publisher's domain)
      + 0.15 * uniqueness        (how fresh/non-obvious the angle is)
    """
    semantic_pull: float = 0.0   # Embedding overlap with both publisher AND target
    factual_mass: float = 0.0    # Density of extractable facts from source
    topic_fit: float = 0.0       # How well it fits publisher's topic universe
    uniqueness: float = 0.0      # Inverse of how commonly this bridge is used

    @property
    def total_gravity(self) -> float:
        return (
            0.35 * self.semantic_pull +
            0.25 * self.factual_mass +
            0.25 * self.topic_fit +
            0.15 * self.uniqueness
        )


@dataclass
class ContextBridge:
    """A potential context bridge (trust link) between publisher and target."""
    id: str
    concept: str                           # The bridging concept/topic
    search_query: str                      # What to search for to find a source
    source_url: Optional[str] = None       # Verified URL (filled after WebFetch)
    source_domain: Optional[str] = None
    extracted_facts: List[str] = field(default_factory=list)
    gravity: BridgeGravity = field(default_factory=BridgeGravity)
    strength: BridgeStrength = BridgeStrength.WOOD
    role: BridgeRole = BridgeRole.PRIMARY
    reasoning: str = ""                    # Why this bridge was chosen
    is_verified: bool = False              # Has the URL been fetched and confirmed?

    @property
    def score(self) -> float:
        return self.gravity.total_gravity


@dataclass
class TopicCandidate:
    """A discovered article topic candidate."""
    id: str
    topic: str                             # The article topic/angle
    viability: TopicViability = TopicViability.ACCEPTABLE
    viability_score: float = 0.0           # 0.0-1.0
    publisher_fit: float = 0.0             # How well it fits publisher's domain
    target_proximity: float = 0.0          # How close it gets to target's intent
    bridges_available: List[ContextBridge] = field(default_factory=list)
    thesis_seed: str = ""                  # Embryonic thesis idea
    reasoning: str = ""                    # Why this topic was selected
    rejection_reason: str = ""             # If rejected, why

    @property
    def composite_score(self) -> float:
        """Weighted score: fit + proximity + bridge quality."""
        bridge_score = max((b.score for b in self.bridges_available), default=0)
        return (
            0.30 * self.publisher_fit +
            0.30 * self.target_proximity +
            0.25 * bridge_score +
            0.15 * self.viability_score
        )


@dataclass
class ArticleThesis:
    """The thesis – one sentence that drives the entire article."""
    statement: str               # The thesis sentence
    drives_sections: List[str]   # Which sections this thesis naturally supports
    anchor_integration: str      # How the anchor naturally fits within thesis context
    naturalness: AnchorNaturalness = AnchorNaturalness.NATURAL
    confidence: float = 0.0


@dataclass
class SectionPlan:
    """Plan for one article section."""
    order: int
    role: SectionRole
    working_title: str           # H2 heading idea
    purpose: str                 # What this section does for the thesis
    connects_to_previous: str    # How it picks up from previous section
    connects_to_next: str        # How it hands off to next section
    target_words: int = 175      # Target word count
    contains_anchor: bool = False
    contains_bridge: Optional[str] = None  # Bridge ID if section contains a trust link
    entities_to_cover: List[str] = field(default_factory=list)


@dataclass
class RedThread:
    """Validation of the article's narrative coherence."""
    is_coherent: bool = False
    sections_can_swap: List[Tuple[int, int]] = field(default_factory=list)  # Pairs that COULD swap (bad)
    dead_ends: List[int] = field(default_factory=list)  # Sections that don't connect forward
    orphan_sections: List[int] = field(default_factory=list)  # Sections that don't connect backward
    weak_connections: List[Tuple[int, int]] = field(default_factory=list)  # Adjacent sections with no shared concepts
    thesis_coverage: float = 0.0  # What % of sections serve the thesis
    reasoning: str = ""


@dataclass
class ConstraintResult:
    """Result of checking one constraint."""
    name: str
    constraint_type: ConstraintType
    passed: bool
    value: Any = None            # The actual value found
    expected: Any = None         # What was expected
    message: str = ""


@dataclass
class ArticleBlueprint:
    """Complete output: everything the agent needs to write the article."""
    job_number: int
    publisher_domain: str
    target_url: str
    anchor_text: str
    language: str

    # Analysis
    publisher: PublisherUniverse = field(default_factory=lambda: PublisherUniverse(domain=""))
    target: TargetUniverse = field(default_factory=lambda: TargetUniverse(url=""))
    gap: Optional[GapAnalysis] = None

    # Discovery
    chosen_topic: Optional[TopicCandidate] = None
    rejected_topics: List[TopicCandidate] = field(default_factory=list)
    bridges: List[ContextBridge] = field(default_factory=list)

    # Thesis & Structure
    thesis: Optional[ArticleThesis] = None
    sections: List[SectionPlan] = field(default_factory=list)
    red_thread: Optional[RedThread] = None

    # Validation
    constraints: List[ConstraintResult] = field(default_factory=list)
    overall_risk: RiskLevel = RiskLevel.LOW
    phase: ArticlePhase = ArticlePhase.INPUT_PARSED

    # Metadata
    created_at: str = ""
    engine_version: str = "6.2"

    @property
    def is_approved(self) -> bool:
        """Blueprint passes all HARD constraints."""
        return all(c.passed for c in self.constraints if c.constraint_type == ConstraintType.HARD)

    def to_json(self, indent: int = 2) -> str:
        """Serialize to JSON."""
        return json.dumps(asdict(self), indent=indent, ensure_ascii=False, default=str)

    def to_agent_prompt(self) -> str:
        """Generate the prompt the agent uses to write the article."""
        return AgentPromptRenderer.render(self)


# =============================================================================
# TARGET INTENT ANALYZER – 5-STEP SERP RESEARCH
# =============================================================================

class TargetIntentAnalyzer:
    """
    5-step SERP research that reverse-engineers Google's understanding of
    the target page's intent, entities, and cluster landscape.

    This is the intelligence layer that was missing. Without it, the engine
    guesses what TA to strengthen. With it, the engine KNOWS.

    The 5 probes (designed from 15 years of SEO pattern recognition):

    PROBE 1: HEAD ENTITY SEARCH
      Extract 1-2 core words from target's meta title → WebSearch
      Read pos 1-3 metadata → establish Google's head intent for this entity

    PROBE 2: CLUSTER SEARCH
      Derive cluster query from meta title (long-tail variant) → WebSearch
      Read pos 1-3 metadata → map cluster/related entities Google associates

    PROBE 3: LITERAL TITLE SEARCH
      Search the target's exact meta title → WebSearch
      Compare target's position/presence with probe 1 & 2 top results
      → verify target's intent alignment with Google's expectation

    PROBE 4: META DESCRIPTION PREDICATE SEARCH
      Extract the action/predicate from meta description → WebSearch
      Compare top 3 with target's metadata → more entity/cluster signals
      → understand the transactional/commercial intent layer

    PROBE 5: LITERAL META DESCRIPTION SEARCH
      Search the full meta description → WebSearch
      Compare with all previous probes → final intent verification
      → complete entity/cluster map

    Output: TargetIntentProfile with:
    - Confirmed intent (verified against Google, not assumed)
    - Core entities (what defines this TA)
    - Cluster entities (what supports this TA)
    - LSI terms (what Google expects to see)
    - TA guidance (what the article should strengthen)
    - Ideal bridge direction (what concept the context link should embody)
    """

    # Stop words for entity extraction from SERP titles/descriptions
    STOP_WORDS_SV = {
        "och", "att", "en", "det", "som", "är", "av", "för", "med",
        "till", "den", "har", "de", "inte", "om", "ett", "vi", "på",
        "i", "kan", "ska", "vara", "bli", "bra", "nya", "mer", "hos",
        "din", "ditt", "dina", "här", "alla", "från", "se", "vår",
        "utan", "eller", "men", "hur", "vad", "var", "när", "allt",
    }
    STOP_WORDS_EN = {
        "the", "and", "to", "of", "a", "in", "is", "for", "on", "with",
        "that", "this", "your", "you", "are", "our", "can", "how", "at",
        "be", "by", "an", "we", "from", "all", "has", "it", "was",
        "more", "but", "not", "what", "or", "one", "get", "best",
    }

    def __init__(self):
        self.logger = logging.getLogger("TargetIntentAnalyzer")

    def build_research_plan_from_metadata(
        self,
        url: str,
        title: str,
        description: str = "",
        h1: str = ""
    ) -> TargetIntentProfile:
        """
        Convenience wrapper: build research plan from raw strings.
        
        This is what the agent calls after web_fetch:
            analyzer = TargetIntentAnalyzer()
            plan = analyzer.build_research_plan_from_metadata(
                url="https://target.se/page",
                title="Page Title",
                description="Meta description text"
            )
        
        Returns TargetIntentProfile with 5 probes ready for WebSearch.
        """
        target = TargetUniverse(
            url=url,
            title=title,
            h1=h1 or title,
            meta_description=description,
        )
        return self.build_research_plan(target)

    def build_research_plan(self, target: TargetUniverse) -> TargetIntentProfile:
        """
        Build the 5-probe research plan from target page metadata.

        This method does NOT execute WebSearches – it creates the
        TargetIntentProfile with all probe definitions ready for the
        agent to execute. The agent calls WebSearch, we analyze results.

        This design is critical: the engine plans, the agent executes.
        The engine can't call WebSearch itself, but it can tell the
        agent EXACTLY what to search and what to extract from results.
        """
        profile = TargetIntentProfile(target_url=target.url)

        # Extract signals from target metadata
        profile.meta_title = target.title
        profile.meta_description = target.meta_description
        profile.head_entity = self._extract_head_entity(target.title)
        profile.cluster_query = self._derive_cluster_query(target.title, target.meta_description)
        profile.meta_desc_predicate = self._extract_predicate(target.meta_description)

        # Build the 5 probes
        profile.probes = self._build_probes(profile, target)

        return profile

    def analyze_probe_results(
        self,
        profile: TargetIntentProfile,
        probe_step: int,
        results: List[Dict[str, str]]
    ) -> TargetIntentProfile:
        """
        Analyze results from a completed WebSearch probe.
        Called by the agent after each WebSearch.

        Args:
            profile: The profile being built
            probe_step: Which probe (1-5) results are for
            results: List of {title, description, url} from SERP top 3
        """
        if probe_step < 1 or probe_step > len(profile.probes):
            return profile

        probe = profile.probes[probe_step - 1]

        # Parse results into snapshots
        for i, r in enumerate(results[:3], 1):
            snapshot = SerpSnapshot(
                position=i,
                title=r.get("title", ""),
                meta_description=r.get("description", ""),
                url=r.get("url", ""),
                domain=self._extract_domain(r.get("url", "")),
            )
            snapshot.title_entities = self._extract_entities(snapshot.title)
            snapshot.desc_entities = self._extract_entities(snapshot.meta_description)
            snapshot.intent_signal = self._classify_intent_from_metadata(
                snapshot.title, snapshot.meta_description
            )
            probe.top_results.append(snapshot)

        # Analyze this probe
        probe = self._analyze_probe(probe, profile)
        profile.probes[probe_step - 1] = probe
        profile.probes_completed = sum(1 for p in profile.probes if p.top_results)

        # After enough probes, synthesize
        if profile.probes_completed >= 3:
            profile = self._synthesize(profile)

        return profile

    def synthesize_from_plan(self, profile: TargetIntentProfile) -> TargetIntentProfile:
        """
        Generate the synthesis section even without live SERP data.
        Uses the probe PLAN (search queries, purposes) to create guidance
        that the agent uses when doing its own WebSearch research.

        This is the "offline" mode – the engine can't search, but it gives
        the agent a structured research plan that's far better than ad-hoc searching.
        """
        if not profile.head_entity:
            return profile

        # Build entity guidance from what we know
        title_entities = self._extract_entities(profile.meta_title)
        desc_entities = self._extract_entities(profile.meta_description)
        all_entities = list(dict.fromkeys(title_entities + desc_entities))

        profile.core_entities = all_entities[:5]
        profile.cluster_entities = all_entities[5:10]
        profile.lsi_terms = self._derive_lsi_terms(profile.meta_title, profile.meta_description)

        # TA target description
        profile.ta_target_description = (
            f"Stärk målsidans topical authority för '{profile.head_entity}'. "
            f"Artikeln ska väva in entiteter som Google associerar med denna sökintention: "
            f"{', '.join(all_entities[:6])}. "
            f"Kontextlänken ska hitta en källa som överlappar med BÅDE publisherns ämne "
            f"och dessa entiteter."
        )

        # Entities to weave in
        profile.entities_to_weave = all_entities[:8]

        # Ideal bridge direction
        if profile.meta_desc_predicate:
            profile.ideal_bridge_direction = (
                f"Bryggan bör koppla publisherns ämne till '{profile.meta_desc_predicate}' "
                f"– den handling/funktion som målsidans metabeskrivning lyfter fram. "
                f"Det är i den kontexten som ankarlänken sitter naturligast."
            )
        else:
            profile.ideal_bridge_direction = (
                f"Bryggan bör koppla publisherns ämne till '{profile.head_entity}' "
                f"via en vinkel som naturligt leder till kundens erbjudande."
            )

        profile.confidence = 0.5  # Moderate – plan without live data
        return profile

    def _build_probes(self, profile: TargetIntentProfile, target: TargetUniverse) -> List[SerpProbe]:
        """Build the 5 probe definitions."""
        probes = []

        # PROBE 1: Head entity search
        probes.append(SerpProbe(
            step=1,
            step_name="head_entity",
            query=profile.head_entity,
            purpose=(
                f"Sök huvudentiteten '{profile.head_entity}' (extraherad från målsidans metatitel). "
                f"Läs metatitel + metabeskrivning för position 1-3. "
                f"SYFTE: Etablera Googles sökintention för denna huvudentitet. "
                f"Vilka entiteter dominerar? Vilken intention visar topp-3?"
            )
        ))

        # PROBE 2: Cluster search
        probes.append(SerpProbe(
            step=2,
            step_name="cluster_search",
            query=profile.cluster_query,
            purpose=(
                f"Klustersökning '{profile.cluster_query}' (härledd från metatitel). "
                f"Läs metatitel + metabeskrivning för position 1-3. "
                f"SYFTE: Kartlägg vilka klustersökord och relaterade entiteter Google associerar "
                f"med målsidans huvudentitet. Dessa entiteter är vad vi vill stärka TA för."
            )
        ))

        # PROBE 3: Literal title search
        probes.append(SerpProbe(
            step=3,
            step_name="literal_title",
            query=profile.meta_title,
            purpose=(
                f"Sök kundens BOKSTAVLIGA metatitel: '{profile.meta_title}'. "
                f"SYFTE: Verifiera kundens sökintention. Jämför med topp-3 från probe 1 & 2. "
                f"Skiljer sig kundens intention från Googles bedömning? "
                f"Om ja: vi måste anpassa bryggan. Om nej: vi kan optimera fullt ut."
            )
        ))

        # PROBE 4: Meta description predicate search
        if profile.meta_desc_predicate:
            probes.append(SerpProbe(
                step=4,
                step_name="desc_predicate",
                query=profile.meta_desc_predicate,
                purpose=(
                    f"Sök predikatet från metabeskrivningen: '{profile.meta_desc_predicate}'. "
                    f"SYFTE: Jämför topp-3 metadata med kundens metadata. "
                    f"Ger ytterligare entiteter/kluster relaterade till målsidan. "
                    f"Stärkt bild av vad som ingår i den kommersiella/transaktionella intentionen."
                )
            ))
        else:
            # Fallback: search meta description keywords
            desc_words = self._extract_entities(target.meta_description)[:3]
            fallback_query = " ".join(desc_words) if desc_words else target.title
            probes.append(SerpProbe(
                step=4,
                step_name="desc_keywords",
                query=fallback_query,
                purpose=(
                    f"Sök nyckelord från metabeskrivningen: '{fallback_query}'. "
                    f"SYFTE: Komplettera entitetskartan med termer från målsidans "
                    f"beskrivning av sitt eget erbjudande."
                )
            ))

        # PROBE 5: Literal meta description search
        if target.meta_description and len(target.meta_description) > 20:
            probes.append(SerpProbe(
                step=5,
                step_name="literal_description",
                query=target.meta_description[:150],  # Truncate for search
                purpose=(
                    f"Sök kundens BOKSTAVLIGA metabeskrivning (trunkerad). "
                    f"SYFTE: Bokstavlig sökintention + stärkt bild av ord som ingår i "
                    f"entiteter och kluster. Jämför med toppresultat i alla övriga sökningar. "
                    f"Fullständig bild av målsidans sökintention vs Googles bedömning."
                )
            ))
        else:
            # Fallback: search URL path segments
            probes.append(SerpProbe(
                step=5,
                step_name="url_path",
                query=target.url,
                purpose=(
                    f"Sök målsidans URL för att se hur Google indexerar den. "
                    f"SYFTE: Kontrollera om sidan indexeras och vilka "
                    f"entiteter Google associerar med den."
                )
            ))

        return probes

    def _analyze_probe(self, probe: SerpProbe, profile: TargetIntentProfile) -> SerpProbe:
        """Analyze a completed probe's results."""
        if not probe.top_results:
            return probe

        # Collect all entities from results
        all_title_entities = []
        all_desc_entities = []
        intents = []
        for r in probe.top_results:
            all_title_entities.extend(r.title_entities)
            all_desc_entities.extend(r.desc_entities)
            if r.intent_signal:
                intents.append(r.intent_signal)

        # Find overlap with target
        target_entities = set(e.lower() for e in self._extract_entities(profile.meta_title) +
                              self._extract_entities(profile.meta_description))
        serp_entities = set(e.lower() for e in all_title_entities + all_desc_entities)

        probe.entity_overlap_with_target = sorted(target_entities & serp_entities)
        probe.new_entities_discovered = sorted(serp_entities - target_entities)[:10]

        # Dominant intent
        if intents:
            intent_counts = defaultdict(int)
            for i in intents:
                intent_counts[i] += 1
            probe.dominant_intent = max(intent_counts, key=intent_counts.get)

        # Intent alignment
        if target_entities and serp_entities:
            probe.intent_alignment = len(target_entities & serp_entities) / max(len(target_entities), 1)
        else:
            probe.intent_alignment = 0.0

        # Generate insight
        probe.insight = self._generate_probe_insight(probe, profile)

        return probe

    def _synthesize(self, profile: TargetIntentProfile) -> TargetIntentProfile:
        """Synthesize all probe results into final intelligence."""
        # Collect all entities across probes
        all_overlap = []
        all_new = []
        all_intents = []

        for probe in profile.probes:
            all_overlap.extend(probe.entity_overlap_with_target)
            all_new.extend(probe.new_entities_discovered)
            if probe.dominant_intent:
                all_intents.append(probe.dominant_intent)

        # Count entity frequency across probes (more frequent = more important)
        entity_freq = defaultdict(int)
        for e in all_overlap + all_new:
            entity_freq[e] += 1

        # Core entities: frequent in overlap
        overlap_freq = defaultdict(int)
        for e in all_overlap:
            overlap_freq[e] += 1
        profile.core_entities = sorted(overlap_freq, key=overlap_freq.get, reverse=True)[:8]

        # Cluster entities: frequent in new discoveries
        new_freq = defaultdict(int)
        for e in all_new:
            new_freq[e] += 1
        profile.cluster_entities = sorted(new_freq, key=new_freq.get, reverse=True)[:8]

        # LSI terms: all entities with frequency >= 2
        profile.lsi_terms = sorted(
            [e for e, count in entity_freq.items() if count >= 2],
            key=lambda e: entity_freq[e], reverse=True
        )[:15]

        # Confirmed intent
        if all_intents:
            intent_counts = defaultdict(int)
            for i in all_intents:
                intent_counts[i] += 1
            profile.confirmed_intent = max(intent_counts, key=intent_counts.get)

        # Intent alignment check (probe 3 is the key one)
        probe3 = next((p for p in profile.probes if p.step == 3 and p.top_results), None)
        if probe3:
            profile.intent_matches_serp = probe3.intent_alignment >= 0.3
            if not profile.intent_matches_serp:
                profile.intent_gap = (
                    f"Kundens metatitel visar intention '{profile.confirmed_intent}' "
                    f"men Googles topp-3 för bokstavlig sökning visar "
                    f"'{probe3.dominant_intent}'. Bryggan måste ta hänsyn till detta gap."
                )

        # Competitor entities (what SERP shows but target doesn't have)
        target_entities = set(e.lower() for e in profile.core_entities)
        all_serp_entities = set()
        for probe in profile.probes:
            for r in probe.top_results:
                all_serp_entities.update(e.lower() for e in r.title_entities + r.desc_entities)
        profile.competitor_entities = sorted(all_serp_entities - target_entities)[:10]

        # TA guidance
        profile.ta_target_description = (
            f"Stärk målsidans topical authority för '{profile.head_entity}'. "
            f"Google associerar denna sökintention med entiteterna: "
            f"{', '.join(profile.core_entities[:6])}. "
            f"Klusterentiteter att inkludera: {', '.join(profile.cluster_entities[:4])}. "
            f"LSI-termer: {', '.join(profile.lsi_terms[:6])}."
        )

        profile.entities_to_weave = list(dict.fromkeys(
            profile.core_entities[:4] + profile.cluster_entities[:3] + profile.lsi_terms[:3]
        ))

        # Entities to avoid: competitor entities that are NOT core/cluster
        # (these are terms competitors use but that would dilute target's TA focus)
        core_cluster = set(e.lower() for e in profile.core_entities + profile.cluster_entities)
        profile.entities_to_avoid = [
            e for e in profile.competitor_entities
            if e.lower() not in core_cluster
        ][:5]

        # Ideal bridge direction
        if profile.meta_desc_predicate:
            profile.ideal_bridge_direction = (
                f"Kontextlänken ska leda artikelns ämne mot '{profile.meta_desc_predicate}' "
                f"(predikatet från kundens metabeskrivning). Detta är handlingen/funktionen "
                f"som kunden vill ranka för. Bryggan ska göra att ankarlänken sitter i en "
                f"kontext som EXAKT matchar denna intention."
            )
        else:
            profile.ideal_bridge_direction = (
                f"Kontextlänken ska bygga bryggan till '{profile.head_entity}' "
                f"med fokus på entiteterna {', '.join(profile.core_entities[:3])}."
            )

        profile.confidence = min(1.0, 0.3 + profile.probes_completed * 0.14)
        return profile

    def _extract_head_entity(self, title: str) -> str:
        """Extract 1-2 core words from meta title (the head entity)."""
        if not title:
            return ""
        # Remove brand suffixes like "| Brand" or "- Brand"
        title = re.split(r'\s*[\|—–-]\s*', title)[0].strip()
        # Extract meaningful words
        words = self._extract_entities(title)
        # Head entity is the first 1-2 meaningful words
        return " ".join(words[:2]) if words else title[:30]

    def _derive_cluster_query(self, title: str, description: str) -> str:
        """Derive a cluster/long-tail search from title."""
        head = self._extract_head_entity(title)
        if not head:
            return ""

        # Try to add qualifier from description for long-tail
        desc_words = self._extract_entities(description)
        qualifiers = [w for w in desc_words if w.lower() not in head.lower()]

        if qualifiers:
            return f"{head} {qualifiers[0]}"
        return f"bästa {head}" if head else ""

    def _extract_predicate(self, description: str) -> str:
        """Extract the action/predicate phrase from meta description."""
        if not description:
            return ""
        # Look for action patterns: "Köp X", "Hitta X", "Jämför X", "Boka X"
        action_patterns = [
            r'(köp\s+\w+(?:\s+\w+){0,3})',
            r'(hitta\s+\w+(?:\s+\w+){0,3})',
            r'(jämför\s+\w+(?:\s+\w+){0,3})',
            r'(boka\s+\w+(?:\s+\w+){0,3})',
            r'(spela\s+\w+(?:\s+\w+){0,3})',
            r'(handla\s+\w+(?:\s+\w+){0,3})',
            r'(upptäck\s+\w+(?:\s+\w+){0,3})',
            r'(utforska\s+\w+(?:\s+\w+){0,3})',
            r'(buy\s+\w+(?:\s+\w+){0,3})',
            r'(find\s+\w+(?:\s+\w+){0,3})',
            r'(compare\s+\w+(?:\s+\w+){0,3})',
            r'(play\s+\w+(?:\s+\w+){0,3})',
        ]
        desc_lower = description.lower()
        for pattern in action_patterns:
            match = re.search(pattern, desc_lower)
            if match:
                return match.group(1)

        # Fallback: first meaningful phrase
        sentences = re.split(r'[.!?]', description)
        if sentences:
            return sentences[0].strip()[:60]
        return ""

    def _extract_entities(self, text: str) -> List[str]:
        """Extract meaningful entity-like terms from text."""
        if not text:
            return []
        words = re.findall(r'\b[\w\u00e5\u00e4\u00f6\u00c5\u00c4\u00d6]+\b', text.lower())
        stop = self.STOP_WORDS_SV | self.STOP_WORDS_EN
        return [w for w in words if len(w) > 2 and w not in stop]

    def _extract_domain(self, url: str) -> str:
        """Extract domain from URL."""
        try:
            from urllib.parse import urlparse
            return urlparse(url).netloc.replace("www.", "")
        except Exception:
            return ""

    def _classify_intent_from_metadata(self, title: str, description: str) -> str:
        """Classify search intent from SERP result metadata."""
        text = f"{title} {description}".lower()

        if any(w in text for w in ["köp", "pris", "billig", "beställ", "handla", "buy", "price", "shop"]):
            return "transactional"
        if any(w in text for w in ["bäst", "topp", "jämför", "test", "recension", "best", "top", "compare", "review"]):
            return "commercial"
        if any(w in text for w in ["hur", "vad är", "guide", "tips", "how", "what is"]):
            return "informational"
        if any(w in text for w in ["logga in", "kontakt", "login", "contact", "my account"]):
            return "navigational"
        return "mixed"

    def _derive_lsi_terms(self, title: str, description: str) -> List[str]:
        """Derive LSI terms from title and description."""
        all_words = self._extract_entities(f"{title} {description}")
        # Count frequency
        freq = defaultdict(int)
        for w in all_words:
            freq[w] += 1
        # Return words sorted by frequency, then alphabetically
        return sorted(freq.keys(), key=lambda w: (-freq[w], w))[:10]

    def _generate_probe_insight(self, probe: SerpProbe, profile: TargetIntentProfile) -> str:
        """Generate human-readable insight from a probe."""
        if not probe.top_results:
            return "Inga resultat att analysera."

        overlap_count = len(probe.entity_overlap_with_target)
        new_count = len(probe.new_entities_discovered)

        insights = []
        if overlap_count > 0:
            insights.append(f"{overlap_count} entiteter matchar kundens metadata")
        if new_count > 0:
            top_new = ", ".join(probe.new_entities_discovered[:3])
            insights.append(f"{new_count} nya entiteter upptäckta ({top_new})")
        if probe.dominant_intent:
            insights.append(f"Dominant intention: {probe.dominant_intent}")
        if probe.intent_alignment > 0.5:
            insights.append("Stark intentionsöverensstämmelse")
        elif probe.intent_alignment < 0.2:
            insights.append("Svag intentionsöverensstämmelse – brygga behöver kompensera")

        return "; ".join(insights) if insights else "Grundläggande data insamlad."

    # -----------------------------------------------------------------
    # Trust link discovery (extracted from runner.py)
    # -----------------------------------------------------------------

    def build_trustlink_queries(
        self,
        preflight_bridge,
        plan: Optional[TargetIntentProfile],
        target_title: str
    ) -> List[str]:
        """Generate 2-3 search queries for finding trust link candidates via web_search.

        Strategy: combine pipeline's trust_link_topics (bridge-aware) with SERP
        intelligence to produce queries that find sources bridging publisher→target.
        No hardcoded suffixes — topics from pipeline are already specific enough.

        Args:
            preflight_bridge: SemanticBridge from pipeline preflight (has .trust_link_topics)
            plan: TargetIntentProfile from SERP research (has .head_entity, .core_entities)
            target_title: The target page's title as fallback
        """
        queries: List[str] = []

        # Primary: pipeline's bridge-aware trust link topics
        if preflight_bridge and getattr(preflight_bridge, "trust_link_topics", None):
            t_words_seen = set()
            for t in preflight_bridge.trust_link_topics[:3]:
                if not t:
                    continue
                t_lower = t.lower()
                # Skip if this topic is a subset of one already added
                if any(t_lower in seen or seen in t_lower for seen in t_words_seen):
                    continue
                t_words_seen.add(t_lower)

                # If topic is already multi-word and specific, use as-is
                if len(t.split()) >= 3:
                    queries.append(t)
                else:
                    # Add contextual suffix from SERP core entities (not hardcoded)
                    if plan and plan.core_entities:
                        # Find a core entity that isn't already part of the topic
                        core = next(
                            (e for e in plan.core_entities
                             if e.lower() not in t_lower and t_lower not in e.lower()),
                            None
                        )
                        if core:
                            queries.append(f"{t} {core} guide")
                        else:
                            queries.append(f"{t} guide")
                    else:
                        queries.append(f"{t} guide")

        # Secondary: SERP-driven query combining head entity with cluster context
        if plan and plan.head_entity and len(queries) < 2:
            if plan.cluster_entities:
                # Combine head entity with a cluster entity for a bridging query
                cluster = next((c for c in plan.cluster_entities
                                if c.lower() not in plan.head_entity.lower()), None)
                if cluster:
                    queries.append(f"{plan.head_entity} {cluster} studie")
                else:
                    queries.append(f"{plan.head_entity} guide")
            else:
                queries.append(f"{plan.head_entity} guide")

        # Fallback: target title
        if not queries and target_title:
            queries.append(f"{target_title} guide")

        # Dedupe preserving order, limit to 3
        return list(dict.fromkeys(queries))[:3]

    @staticmethod
    def score_trustlink_candidate(candidate: Dict[str, str], trust_topics: List[str]) -> int:
        """Score a trust link candidate by topic relevance + deeplink status."""
        title = (candidate.get("title") or "").lower()
        desc = (candidate.get("description") or "").lower()
        score = 0
        for topic in trust_topics:
            t = topic.lower()
            if t in title or t in desc:
                score += 2
        url = candidate.get("url", "")
        try:
            from urllib.parse import urlparse
            path = urlparse(url).path or ""
            if path.strip("/") != "":
                score += 1  # deeplink bonus
        except Exception:
            pass
        return score

    @staticmethod
    def select_trustlinks(
        candidates: List[Dict[str, str]],
        trust_topics: List[str],
        avoid_domains: List[str],
        target_domain: str,
        publisher_domain: str,
    ) -> List[Dict[str, str]]:
        """Filter and rank trust link candidates.

        Removes: target domain, publisher domain, competitors, non-deeplinks.
        Returns sorted list (best first).
        """
        from urllib.parse import urlparse

        avoid = set(d.lower() for d in avoid_domains)
        filtered: List[Dict[str, str]] = []
        for c in candidates:
            url = c.get("url", "")
            if not url:
                continue
            try:
                dom = urlparse(url).netloc.replace("www.", "")
            except Exception:
                continue
            if dom in {target_domain, publisher_domain}:
                continue
            if dom in avoid:
                continue
            # must be deeplink
            try:
                path = urlparse(url).path or ""
                if path.strip("/") == "":
                    continue
            except Exception:
                continue
            filtered.append(c)

        return sorted(
            filtered,
            key=lambda c: TargetIntentAnalyzer.score_trustlink_candidate(c, trust_topics),
            reverse=True,
        )


# =============================================================================
# TOPIC DISCOVERY ENGINE
# =============================================================================

class TopicDiscoveryEngine:
    """
    Discovers unique, viable article topics from the gap between publisher
    and target. The agent gets NO topic suggestion from the user – this engine
    is what enables it to find one.

    Strategy:
    1. Map the overlap zone between publisher topics and target keywords
    2. Identify "bridge concepts" – ideas that live in BOTH worlds
    3. Generate topic candidates from bridge concepts
    4. Score each candidate on viability, fit, proximity
    5. Reject topics that can't naturally accommodate the anchor
    """

    # Common bridge patterns by vertical pair (imported from shared models)
    from models import BRIDGE_PATTERNS
    BRIDGE_PATTERNS = BRIDGE_PATTERNS

    def __init__(self):
        self.logger = logging.getLogger("TopicDiscovery")

    def discover(
        self,
        publisher: PublisherUniverse,
        target: TargetUniverse,
        gap: GapAnalysis,
        anchor_text: str,
        max_candidates: int = 5
    ) -> List[TopicCandidate]:
        """
        Discover article topic candidates.

        The discovery strategy depends on the gap:
        - IDENTICAL/CLOSE: Topic can be directly about the target's area
        - MODERATE: Need a bridging concept that touches both worlds
        - DISTANT: Need a strong bridge, topic must start in publisher's world
        - UNRELATED: Very creative bridging required, or flag as risky

        When SERP intelligence is available (target.intent_profile), topic
        discovery is dramatically better – it knows WHAT TA to strengthen
        and WHICH entities to weave in.
        """
        candidates = []

        # Strategy 0 (NEW): SERP-intelligence-driven topics
        if target.has_serp_intelligence:
            serp_candidates = self._from_serp_intelligence(
                publisher, target, gap, anchor_text
            )
            candidates.extend(serp_candidates)

        # Strategy 1: Known bridge patterns
        pattern_candidates = self._from_bridge_patterns(publisher, target, anchor_text)
        candidates.extend(pattern_candidates)

        # Strategy 2: Overlap-zone topics (when gap is small)
        if gap.overlap_entities:
            overlap_candidates = self._from_overlap(
                publisher, target, gap, anchor_text
            )
            candidates.extend(overlap_candidates)

        # Strategy 3: Publisher-first topics with bridge path
        publisher_candidates = self._from_publisher_angle(
            publisher, target, gap, anchor_text
        )
        candidates.extend(publisher_candidates)

        # Strategy 4: Anchor-text derived topics
        anchor_candidates = self._from_anchor_semantics(
            publisher, target, anchor_text
        )
        candidates.extend(anchor_candidates)

        # Score all candidates
        for candidate in candidates:
            self._score_candidate(candidate, publisher, target, gap, anchor_text)

        # Remove duplicates (by topic similarity)
        candidates = self._deduplicate(candidates)

        # Sort by composite score
        candidates.sort(key=lambda c: c.composite_score, reverse=True)

        # Classify viability
        for candidate in candidates:
            candidate.viability = self._classify_viability(candidate)

        return candidates[:max_candidates]

    def _from_serp_intelligence(
        self, pub: PublisherUniverse, target: TargetUniverse,
        gap: GapAnalysis, anchor: str
    ) -> List[TopicCandidate]:
        """Generate candidates using SERP intelligence about the target's TA.

        This is the highest-quality discovery path. When we know what entities
        Google associates with the target's intent, we can find topics that
        weave those entities naturally while starting from the publisher's domain.
        """
        candidates = []
        ip = target.intent_profile
        if not ip:
            return candidates

        pub_primary = pub.primary_topics[0] if pub.primary_topics else ""

        # Strategy A: Publisher topic + target core entities
        # Find the core entity that's closest to publisher's world
        for entity in ip.core_entities[:3]:
            if not pub_primary:
                continue

            # Build a bridge concept that uses SERP-confirmed entities
            lsi_terms = ip.lsi_terms[:3]
            search_terms = " ".join([pub_primary, entity] + lsi_terms[:1])

            bridge = ContextBridge(
                id=_hash_id(f"serp_core_{entity}_{pub_primary}"),
                concept=f"{pub_primary} och {entity}",
                search_query=f"{search_terms} analys forskning",
                reasoning=(
                    f"SERP-bekräftad koppling: Google associerar '{entity}' med "
                    f"målsidans huvudentitet '{ip.head_entity}'. "
                    f"Publisher '{pub_primary}' möter detta via bryggan."
                )
            )
            candidates.append(TopicCandidate(
                id=_hash_id(f"serp_{pub_primary}_{entity}"),
                topic=(
                    f"Hur {pub_primary} möter {entity} "
                    f"– {ip.head_entity} i nytt perspektiv"
                ),
                bridges_available=[bridge],
                thesis_seed=(
                    f"Sambandet mellan {pub_primary} och {entity} avslöjar en "
                    f"dimension av {ip.head_entity} som sällan diskuteras."
                ),
                reasoning=(
                    f"SERP-driven: core entity '{entity}' from target TA + "
                    f"publisher primary '{pub_primary}'. "
                    f"Entities to weave: {', '.join(ip.entities_to_weave[:4])}"
                )
            ))

        # Strategy B: Use ideal bridge direction from SERP analysis
        if ip.ideal_bridge_direction and pub_primary:
            predicate = ip.meta_desc_predicate or ip.head_entity
            bridge = ContextBridge(
                id=_hash_id(f"serp_predicate_{predicate}_{pub_primary}"),
                concept=f"{pub_primary} och {predicate}",
                search_query=f"{pub_primary} {predicate} trend data",
                reasoning=(
                    f"SERP-predikat: målsidans metabeskrivning lyfter '{predicate}'. "
                    f"Bryggan kopplar publishern till denna handling/funktion."
                )
            )
            candidates.append(TopicCandidate(
                id=_hash_id(f"serp_pred_{pub_primary}_{predicate}"),
                topic=f"{pub_primary.title()} och {predicate} – en koppling värd att utforska",
                bridges_available=[bridge],
                thesis_seed=(
                    f"I korsningen av {pub_primary} och {predicate} finns en "
                    f"insikt om hur {ip.head_entity} förändras."
                ),
                reasoning=(
                    f"SERP-predicate-driven: '{predicate}' from meta description + "
                    f"publisher '{pub_primary}'. Bridge direction: {ip.ideal_bridge_direction[:80]}"
                )
            ))

        # Strategy C: Cluster entities as bridge topics
        for cluster_entity in ip.cluster_entities[:2]:
            if not pub_primary or cluster_entity in [e.lower() for e in ip.core_entities]:
                continue

            bridge = ContextBridge(
                id=_hash_id(f"serp_cluster_{cluster_entity}_{pub_primary}"),
                concept=f"{cluster_entity} i {pub_primary}-kontext",
                search_query=f"{pub_primary} {cluster_entity} perspektiv",
                reasoning=(
                    f"SERP-kluster: '{cluster_entity}' ingår i klustret kring "
                    f"'{ip.head_entity}'. Ger bredare TA-täckning."
                )
            )
            candidates.append(TopicCandidate(
                id=_hash_id(f"serp_clust_{pub_primary}_{cluster_entity}"),
                topic=f"Fenomenet {cluster_entity} – sett genom {pub_primary}",
                bridges_available=[bridge],
                thesis_seed=(
                    f"{cluster_entity.capitalize()} har blivit en nyckelfråga "
                    f"inom {ip.head_entity}, och {pub_primary} kastar nytt ljus på varför."
                ),
                reasoning=(
                    f"SERP-cluster entity '{cluster_entity}' for wider TA coverage. "
                    f"TA target: {ip.ta_target_description[:60]}"
                )
            ))

        return candidates

    def _from_bridge_patterns(
        self, pub: PublisherUniverse, target: TargetUniverse, anchor: str
    ) -> List[TopicCandidate]:
        """Generate candidates from known bridge patterns."""
        candidates = []
        for pub_topic in pub.primary_topics:
            for tgt_word in target.main_keywords[:5] + target.topic_cluster[:3]:
                key = (pub_topic.lower(), tgt_word.lower())
                if key in self.BRIDGE_PATTERNS:
                    for pattern in self.BRIDGE_PATTERNS[key]:
                        cid = _hash_id(pattern["concept"])
                        bridge = ContextBridge(
                            id=_hash_id(pattern["search"]),
                            concept=pattern["concept"],
                            search_query=pattern["search"],
                            reasoning=f"Known bridge pattern: {pub_topic} <-> {tgt_word}"
                        )
                        candidates.append(TopicCandidate(
                            id=cid,
                            topic=pattern["angle"],
                            bridges_available=[bridge],
                            reasoning=f"Bridge pattern match: ({pub_topic}, {tgt_word})"
                        ))
        return candidates

    def _from_overlap(
        self, pub: PublisherUniverse, target: TargetUniverse,
        gap: GapAnalysis, anchor: str
    ) -> List[TopicCandidate]:
        """Generate candidates from overlapping entities."""
        candidates = []
        for entity in gap.overlap_entities[:3]:
            cid = _hash_id(f"overlap_{entity}")
            candidates.append(TopicCandidate(
                id=cid,
                topic=f"Perspektiv kring {entity} – {pub.primary_topics[0] if pub.primary_topics else 'ämnet'} möter {target.topic_cluster[0] if target.topic_cluster else 'ny terräng'}",
                thesis_seed=f"Inom {entity} pågår en förändring som berör både {pub.primary_topics[0] if pub.primary_topics else 'branschen'} och konsumenten.",
                reasoning=f"Overlap entity '{entity}' gives natural topic territory"
            ))
        return candidates

    def _from_publisher_angle(
        self, pub: PublisherUniverse, target: TargetUniverse,
        gap: GapAnalysis, anchor: str
    ) -> List[TopicCandidate]:
        """Generate candidates starting from publisher's strongest topic."""
        candidates = []
        if not pub.primary_topics:
            return candidates

        primary = pub.primary_topics[0]

        # Build bridge concept that moves primary topic toward target
        target_keywords = target.main_keywords[:3]
        if target_keywords:
            bridge_concept = f"{primary} och {target_keywords[0]}"
            search_query = f"{primary} {' '.join(target_keywords[:2])} trend analys"
            bridge = ContextBridge(
                id=_hash_id(search_query),
                concept=bridge_concept,
                search_query=search_query,
                reasoning=f"Publisher-first angle: {primary} -> {target_keywords[0]}"
            )
            candidates.append(TopicCandidate(
                id=_hash_id(f"pub_{primary}_{target_keywords[0]}"),
                topic=f"Hur {primary} påverkar {target_keywords[0]} – en analys",
                bridges_available=[bridge],
                thesis_seed=f"Utvecklingen inom {primary} har direkta konsekvenser för {target_keywords[0]}.",
                reasoning=f"Publisher-first: start with {primary}, bridge to {target_keywords[0]}"
            ))

        return candidates

    def _from_anchor_semantics(
        self, pub: PublisherUniverse, target: TargetUniverse, anchor: str
    ) -> List[TopicCandidate]:
        """Generate candidates from the anchor text's semantic field."""
        candidates = []
        anchor_lower = anchor.lower()
        anchor_words = [w for w in anchor_lower.split() if len(w) > 2]

        if not anchor_words:
            return candidates

        # The anchor text itself hints at the target's core offering
        if pub.primary_topics:
            primary = pub.primary_topics[0]
            candidates.append(TopicCandidate(
                id=_hash_id(f"anchor_{anchor_lower}_{primary}"),
                topic=f"{primary.title()} i förändring – och vad det betyder för {anchor}",
                thesis_seed=f"Bakom {anchor} finns en branschutveckling som {primary} speglar.",
                reasoning=f"Anchor semantics: '{anchor}' as target, '{primary}' as starting point"
            ))

        return candidates

    def _score_candidate(
        self, candidate: TopicCandidate,
        pub: PublisherUniverse, target: TargetUniverse,
        gap: GapAnalysis, anchor: str
    ):
        """Score a candidate on publisher fit, target proximity, viability.

        When SERP intelligence is available, scoring uses SERP-confirmed
        entities rather than just keyword overlap. This is dramatically
        more accurate because we're scoring against what Google ACTUALLY
        associates with the target's intent, not what we guess.
        """
        topic_words = set(w.lower() for w in candidate.topic.split() if len(w) > 3)

        # Publisher fit: does the topic belong on this publisher's site?
        pub_words = set(w.lower() for w in pub.primary_topics + pub.secondary_topics)
        if pub_words and topic_words:
            candidate.publisher_fit = len(pub_words & topic_words) / max(len(topic_words), 1)
        else:
            candidate.publisher_fit = 0.3  # Default moderate fit

        # Target proximity – SERP-enhanced when available
        if target.has_serp_intelligence:
            ip = target.intent_profile
            # Use SERP-confirmed entities for proximity scoring
            serp_entities = set(e.lower() for e in
                ip.core_entities + ip.cluster_entities + ip.lsi_terms)
            if serp_entities and topic_words:
                serp_overlap = len(serp_entities & topic_words)
                candidate.target_proximity = serp_overlap / max(len(topic_words), 1)
                # Bonus for hitting core entities specifically
                core_set = set(e.lower() for e in ip.core_entities)
                core_hits = len(core_set & topic_words)
                if core_hits > 0:
                    candidate.target_proximity = min(1.0, candidate.target_proximity + 0.15 * core_hits)
            else:
                candidate.target_proximity = 0.2
        else:
            # Fallback: keyword-based proximity
            tgt_words = set(w.lower() for w in target.main_keywords + target.topic_cluster)
            if tgt_words and topic_words:
                candidate.target_proximity = len(tgt_words & topic_words) / max(len(topic_words), 1)
            else:
                candidate.target_proximity = 0.2

        # Viability based on gap
        distance_bonus = {
            SemanticDistance.IDENTICAL: 0.9,
            SemanticDistance.CLOSE: 0.7,
            SemanticDistance.MODERATE: 0.5,
            SemanticDistance.DISTANT: 0.3,
            SemanticDistance.UNRELATED: 0.1,
        }
        candidate.viability_score = distance_bonus.get(gap.distance_category, 0.5)

        # Boost if has bridges
        if candidate.bridges_available:
            candidate.viability_score = min(1.0, candidate.viability_score + 0.15)

        # SERP intelligence bonus: candidates from SERP-driven strategies
        # get a viability boost because they're based on confirmed data
        if target.has_serp_intelligence and "SERP" in candidate.reasoning:
            candidate.viability_score = min(1.0, candidate.viability_score + 0.10)

    def _classify_viability(self, candidate: TopicCandidate) -> TopicViability:
        """Classify viability based on composite score."""
        score = candidate.composite_score
        if score >= 0.7:
            return TopicViability.EXCELLENT
        elif score >= 0.5:
            return TopicViability.GOOD
        elif score >= 0.3:
            return TopicViability.ACCEPTABLE
        elif score >= 0.15:
            return TopicViability.RISKY
        else:
            return TopicViability.REJECTED

    def _deduplicate(self, candidates: List[TopicCandidate]) -> List[TopicCandidate]:
        """Remove near-duplicate topics."""
        seen_tokens: List[Set[str]] = []
        unique = []
        for c in candidates:
            tokens = set(c.topic.lower().split())
            is_dup = False
            for seen in seen_tokens:
                overlap = len(tokens & seen) / max(len(tokens | seen), 1)
                if overlap > 0.6:
                    is_dup = True
                    break
            if not is_dup:
                seen_tokens.append(tokens)
                unique.append(c)
        return unique


# =============================================================================
# BRIDGE GRAVITY ENGINE
# =============================================================================

class BridgeGravityEngine:
    """
    Scores context bridges using a 4-component gravity model.
    Adapted from EntityGravityEngine – but tuned for article context bridges.

    Components:
    1. semantic_pull  (0.35) – how strongly bridge connects pub<->target
    2. factual_mass   (0.25) – verifiable facts/data available
    3. topic_fit      (0.25) – how naturally bridge fits publisher domain
    4. uniqueness     (0.15) – how non-obvious/fresh the bridge is

    The total gravity determines bridge quality and ranking.
    """

    # Common bridge concepts that are overused (reduce uniqueness score)
    OVERUSED_BRIDGES = {
        "digital transformation", "digitalisering", "hållbarhet",
        "i en allt mer digital värld", "trender", "framtiden",
        "innovation", "teknisk utveckling", "ai och framtiden"
    }

    def score_bridges(
        self,
        bridges: List[ContextBridge],
        publisher: PublisherUniverse,
        target: TargetUniverse,
        gap: GapAnalysis
    ) -> List[ContextBridge]:
        """Score all bridges and classify strength + role."""

        for bridge in bridges:
            # 1. Semantic Pull
            bridge.gravity.semantic_pull = self._calc_semantic_pull(
                bridge, publisher, target
            )

            # 2. Factual Mass
            bridge.gravity.factual_mass = self._calc_factual_mass(bridge)

            # 3. Topic Fit
            bridge.gravity.topic_fit = self._calc_topic_fit(bridge, publisher)

            # 4. Uniqueness
            bridge.gravity.uniqueness = self._calc_uniqueness(bridge)

        # Classify strength
        for bridge in bridges:
            bridge.strength = self._classify_strength(bridge)

        # Assign roles (primary, supporting, contextual)
        bridges = self._assign_roles(bridges)

        # Sort by gravity
        bridges.sort(key=lambda b: b.score, reverse=True)

        return bridges

    def _calc_semantic_pull(
        self, bridge: ContextBridge,
        pub: PublisherUniverse, target: TargetUniverse
    ) -> float:
        """How strongly this bridge connects publisher and target."""
        concept_words = set(bridge.concept.lower().split())
        pub_words = set(pub.topic_text.lower().split())
        tgt_words = set(target.keyword_text.lower().split())

        # Bridge should overlap with BOTH sides
        pub_overlap = len(concept_words & pub_words) / max(len(concept_words), 1)
        tgt_overlap = len(concept_words & tgt_words) / max(len(concept_words), 1)

        # Geometric mean rewards bridges that touch BOTH sides
        if pub_overlap > 0 and tgt_overlap > 0:
            return math.sqrt(pub_overlap * tgt_overlap)
        return (pub_overlap + tgt_overlap) / 4  # Penalize one-sided bridges

    def _calc_factual_mass(self, bridge: ContextBridge) -> float:
        """How many verifiable facts are available from this bridge."""
        if not bridge.is_verified:
            return 0.3  # Default before verification

        fact_count = len(bridge.extracted_facts)
        if fact_count >= 5:
            return 1.0
        elif fact_count >= 3:
            return 0.8
        elif fact_count >= 1:
            return 0.5
        return 0.1

    def _calc_topic_fit(self, bridge: ContextBridge, pub: PublisherUniverse) -> float:
        """How naturally this bridge fits the publisher's domain."""
        concept_lower = bridge.concept.lower()
        fit = 0.3  # Base

        for topic in pub.primary_topics:
            if topic.lower() in concept_lower:
                fit += 0.3
                break

        for topic in pub.secondary_topics:
            if topic.lower() in concept_lower:
                fit += 0.15
                break

        return min(1.0, fit)

    def _calc_uniqueness(self, bridge: ContextBridge) -> float:
        """Penalize overused bridge concepts."""
        concept_lower = bridge.concept.lower()
        for overused in self.OVERUSED_BRIDGES:
            if overused in concept_lower:
                return 0.2
        return 0.7  # Default: reasonably unique

    def _classify_strength(self, bridge: ContextBridge) -> BridgeStrength:
        """Classify bridge strength from gravity score."""
        score = bridge.score
        if score >= 0.7:
            return BridgeStrength.STEEL
        elif score >= 0.5:
            return BridgeStrength.IRON
        elif score >= 0.3:
            return BridgeStrength.WOOD
        return BridgeStrength.PAPER

    def _assign_roles(self, bridges: List[ContextBridge]) -> List[ContextBridge]:
        """Assign roles based on relative scoring."""
        if not bridges:
            return bridges

        bridges.sort(key=lambda b: b.score, reverse=True)
        bridges[0].role = BridgeRole.PRIMARY
        for b in bridges[1:2]:
            b.role = BridgeRole.SUPPORTING
        for b in bridges[2:]:
            b.role = BridgeRole.CONTEXTUAL

        return bridges


# =============================================================================
# THESIS FORGE
# =============================================================================

class ThesisForge:
    """
    Generates article thesis candidates.

    A thesis is ONE sentence that the entire article drives. It is NOT the
    headline – it's the underlying argument. Every section must serve the thesis.

    Good thesis: "Morsdagsbuketten överlever alla trender för att den är
                  inbäddad i själva högtiden – från datumvalet till dagens
                  blombudslogistik."

    Bad thesis: "Blommor är populära presenter." (obvious, no argument)
    """

    # Thesis templates – skeleton structures that get filled with specifics
    TEMPLATES_SV = [
        "{subject} {verb} inte bara en fråga om {obvious} – det handlar om {deeper_insight} som {consequence}.",
        "Bakom {phenomenon} finns en {mechanism} som förklarar varför {specific_outcome}.",
        "Medan {surface_trend} får uppmärksamheten är det {underlying_force} som egentligen {drives_what}.",
        "Det som gör {subject} relevant i {pub_context} är {connecting_insight} – och det förändrar {outcome}.",
        "{observation} visar att {pub_topic} och {target_topic} delar mer gemensam mark än man tror: {explanation}.",
    ]

    TEMPLATES_EN = [
        "{subject} isn't just about {obvious} – it's driven by {deeper_insight} that {consequence}.",
        "Behind {phenomenon} lies a {mechanism} that explains why {specific_outcome}.",
        "While {surface_trend} gets the attention, it's {underlying_force} that actually {drives_what}.",
        "What makes {subject} relevant in {pub_context} is {connecting_insight} – and that changes {outcome}.",
    ]

    def forge(
        self,
        topic: TopicCandidate,
        publisher: PublisherUniverse,
        target: TargetUniverse,
        bridges: List[ContextBridge],
        anchor_text: str,
        language: str = "sv"
    ) -> List[ArticleThesis]:
        """Generate thesis candidates for the chosen topic."""
        theses = []

        # Use topic's thesis seed if available
        if topic.thesis_seed:
            theses.append(ArticleThesis(
                statement=topic.thesis_seed,
                drives_sections=["establish", "deepen", "bridge"],
                anchor_integration=self._plan_anchor_integration(
                    topic.thesis_seed, anchor_text, publisher
                ),
                confidence=0.6
            ))

        # Generate from templates
        template_theses = self._from_templates(
            topic, publisher, target, bridges, language
        )
        theses.extend(template_theses)

        # Generate from bridge concepts
        if bridges:
            bridge_theses = self._from_bridges(
                topic, bridges, publisher, target, anchor_text
            )
            theses.extend(bridge_theses)

        # Score naturalness
        for thesis in theses:
            thesis.naturalness = self._assess_anchor_naturalness(
                thesis, anchor_text, target
            )

        # Sort by confidence
        theses.sort(key=lambda t: t.confidence, reverse=True)
        return theses[:3]

    def _from_templates(
        self, topic: TopicCandidate, pub: PublisherUniverse,
        target: TargetUniverse, bridges: List[ContextBridge],
        language: str
    ) -> List[ArticleThesis]:
        """Generate thesis from templates."""
        theses = []
        templates = self.TEMPLATES_SV if language == "sv" else self.TEMPLATES_EN

        primary_bridge = bridges[0] if bridges else None
        pub_topic = pub.primary_topics[0] if pub.primary_topics else "ämnet"
        tgt_topic = target.topic_cluster[0] if target.topic_cluster else "marknaden"

        # Fill first template as example
        if templates and primary_bridge:
            try:
                statement = templates[0].format(
                    subject=topic.topic.split("–")[0].strip() if "–" in topic.topic else topic.topic,
                    verb="är",
                    obvious=pub_topic,
                    deeper_insight=primary_bridge.concept,
                    consequence=f"förändrar {tgt_topic}"
                )
                theses.append(ArticleThesis(
                    statement=statement,
                    drives_sections=["hook", "establish", "deepen", "anchor"],
                    anchor_integration=f"Ankartexten '{primary_bridge.concept}' integreras där {tgt_topic} diskuteras",
                    confidence=0.7
                ))
            except (KeyError, IndexError):
                pass

        return theses

    def _from_bridges(
        self, topic: TopicCandidate, bridges: List[ContextBridge],
        pub: PublisherUniverse, target: TargetUniverse, anchor: str
    ) -> List[ArticleThesis]:
        """Generate thesis from bridge concept."""
        theses = []
        for bridge in bridges[:2]:
            if bridge.role == BridgeRole.PRIMARY:
                statement = (
                    f"{bridge.concept.capitalize()} är nyckeln till att förstå "
                    f"hur {pub.primary_topics[0] if pub.primary_topics else 'branschen'} "
                    f"och {target.topic_cluster[0] if target.topic_cluster else 'marknaden'} "
                    f"hänger samman."
                )
                theses.append(ArticleThesis(
                    statement=statement,
                    drives_sections=["establish", "deepen", "bridge", "anchor"],
                    anchor_integration=f"Ankarlänken placeras där {bridge.concept} kopplas till konkret nytta",
                    confidence=0.65
                ))
        return theses

    def _plan_anchor_integration(
        self, thesis: str, anchor: str, pub: PublisherUniverse
    ) -> str:
        """Plan how anchor naturally integrates with thesis."""
        return (
            f"I kontexten av tesen kan ankartexten '{anchor}' placeras där "
            f"artikeln diskuterar praktiska konsekvenser eller konkreta exempel."
        )

    def _assess_anchor_naturalness(
        self, thesis: ArticleThesis, anchor: str, target: TargetUniverse
    ) -> AnchorNaturalness:
        """Assess how naturally the anchor would fit in this thesis context."""
        # Simple heuristic: if anchor words appear in thesis context, it's more natural
        anchor_words = set(anchor.lower().split())
        thesis_words = set(thesis.statement.lower().split())
        context_words = set(" ".join(thesis.drives_sections).lower().split())

        overlap = len(anchor_words & (thesis_words | context_words))
        ratio = overlap / max(len(anchor_words), 1)

        if ratio >= 0.5:
            return AnchorNaturalness.SEAMLESS
        elif ratio >= 0.25:
            return AnchorNaturalness.NATURAL
        elif ratio > 0:
            return AnchorNaturalness.ADEQUATE
        return AnchorNaturalness.ADEQUATE  # Default – agent's skill determines final quality


# =============================================================================
# SECTION PLANNER
# =============================================================================

class SectionPlanner:
    """
    Plans article sections with red thread validation.

    Principles:
    - Sections build on each other (not interchangeable)
    - Each section serves the thesis
    - Anchor link in middle section (word ~250-550)
    - Trust links NOT in same section as anchor
    - Structure by RELEVANCE, not chronology
    - No freestanding background blocks
    """

    def plan(
        self,
        thesis: ArticleThesis,
        topic: TopicCandidate,
        bridges: List[ContextBridge],
        anchor_text: str,
        target_words: int = 825,
        core_entities: Optional[List[str]] = None,
        cluster_entities: Optional[List[str]] = None,
        entities_to_weave: Optional[List[str]] = None
    ) -> List[SectionPlan]:
        """Generate section plan with entity distribution across sections."""
        sections = []
        words_per_section = target_words // 6  # ~137 words avg for 825 total

        # Distribute entities by section role
        core = core_entities or []
        cluster = cluster_entities or []
        weave = entities_to_weave or []

        # HOOK: 2 attention-grabbing core entities
        hook_entities = core[:2]
        # ESTABLISH: 2-3 core entities (grounding the topic)
        establish_entities = core[1:4]
        # DEEPEN: 2-3 cluster entities (nuance and depth)
        deepen_entities = cluster[:3]
        # ANCHOR: entities closest to anchor_text + 1 core
        anchor_words = set(anchor_text.lower().split())
        anchor_entities = [e for e in weave if e.lower() in anchor_words][:1] + core[:1]
        # PIVOT: 2 cluster entities (broader perspective)
        pivot_entities = cluster[2:4] if len(cluster) > 2 else cluster[:2]
        # RESOLVE: 1 core entity (tying it together)
        resolve_entities = core[:1]

        # Merge with any extracted facts from bridges
        bridge_facts = (topic.bridges_available[0].extracted_facts[:2]
                       if topic.bridges_available and topic.bridges_available[0].extracted_facts
                       else [])

        # Section 1: Hook
        sections.append(SectionPlan(
            order=1,
            role=SectionRole.HOOK,
            working_title="[Agent bestämmer – faktahook, inte clickbait]",
            purpose="Etablerar artikelns ämne med en konkret observation, datapunkt eller fenomen. Antyder artikelns riktning utan att avslöja allt.",
            connects_to_previous="(Öppning – ingen föregående sektion)",
            connects_to_next="Sista meningen pekar mot det ämnesområde som nästa sektion fördjupar.",
            target_words=150,
            entities_to_cover=list(dict.fromkeys(bridge_facts + hook_entities))[:3]
        ))

        # Section 2: Establish (with first trust link)
        primary_bridge = next((b for b in bridges if b.role == BridgeRole.PRIMARY), bridges[0] if bridges else None)
        sections.append(SectionPlan(
            order=2,
            role=SectionRole.ESTABLISH,
            working_title="[Agent bestämmer – fördjupar kontexten]",
            purpose="Fördjupar det fenomen som presenterades i hooken. Här bygger agenten den semantiska bryggan genom att introducera kontextlänken som källa.",
            connects_to_previous="Bygger vidare på hookens observation – varför/hur det fenomenet existerar.",
            connects_to_next="Sista meningen leder naturligt till en ny insikt som nästa sektion utforskar.",
            target_words=words_per_section,
            contains_bridge=primary_bridge.id if primary_bridge else None,
            entities_to_cover=establish_entities[:3]
        ))

        # Section 3: Deepen
        sections.append(SectionPlan(
            order=3,
            role=SectionRole.DEEPEN,
            working_title="[Agent bestämmer – ny insikt som bygger på sektion 2]",
            purpose="Fördjupar med specifik data, exempel eller analys. Stärker tesen genom nyansering eller komplikation.",
            connects_to_previous="Tar den insikt som sektion 2 etablerade och vänder på den eller zoomar in.",
            connects_to_next="Öppnar för den praktiska/konkreta dimensionen där ankarlänken sitter naturligt.",
            target_words=words_per_section,
            entities_to_cover=deepen_entities[:3]
        ))

        # Section 4: Anchor (anchor link lives here)
        sections.append(SectionPlan(
            order=4,
            role=SectionRole.ANCHOR,
            working_title="[Agent bestämmer – koppling till praktisk/konkret dimension]",
            purpose=f"Här sitter ankarlänken [{anchor_text}] naturligt. Sektionen handlar om den praktiska/konkreta sidan av artikelns ämne.",
            connects_to_previous="Sektion 3:s insikt leder till en konkret dimension – det är HÄR det spelar roll.",
            connects_to_next="Konklusionens fråga eller implikation pekar framåt mot sista sektionen.",
            target_words=words_per_section,
            contains_anchor=True,
            entities_to_cover=list(dict.fromkeys(anchor_entities))[:2]
        ))

        # Section 5: Pivot (second trust link if available)
        supporting_bridge = next((b for b in bridges if b.role == BridgeRole.SUPPORTING), None)
        sections.append(SectionPlan(
            order=5,
            role=SectionRole.PIVOT,
            working_title="[Agent bestämmer – ny vinkel eller perspektiv]",
            purpose="Breddar perspektivet: framtid, alternativ vinkel, eller en konsekvens som inte var uppenbar.",
            connects_to_previous="Plockar upp en tråd från sektion 4 och vänder den – 'men det finns mer att se'.",
            connects_to_next="Leder mot artikelns resolution utan att upprepa det som sagts.",
            target_words=words_per_section,
            contains_bridge=supporting_bridge.id if supporting_bridge else None,
            entities_to_cover=pivot_entities[:2]
        ))

        # Section 6: Resolve
        sections.append(SectionPlan(
            order=6,
            role=SectionRole.RESOLVE,
            working_title="[Agent bestämmer – knyter ihop, INTE upprepar]",
            purpose="Knyter ihop röda tråden. Tillför EN ny insikt eller perspektiv – upprepar ALDRIG vad som redan sagts. Om det inte finns något nytt att tillföra, avsluta artikeln med sektion 5 istället.",
            connects_to_previous="Samlar trådarna från hela artikeln – men med en ny synvinkel.",
            connects_to_next="(Sista sektionen – ingen nästa)",
            target_words=100,
            entities_to_cover=resolve_entities[:1]
        ))

        return sections


# =============================================================================
# RED THREAD VALIDATOR
# =============================================================================

class RedThreadValidator:
    """
    Validates that the article plan has narrative coherence.

    Checks:
    1. Each section connects to previous and next
    2. No section can be swapped without breaking flow
    3. No orphan sections (disconnected from narrative)
    4. Thesis is served by all sections
    5. No freestanding background blocks
    """

    def validate(
        self,
        sections: List[SectionPlan],
        thesis: ArticleThesis
    ) -> RedThread:
        """Validate red thread with semantic checks.

        Checks:
        1. Connection chain (fields populated)
        2. Connection coherence (adjacent sections share substantive words)
        3. Role progression (expected order)
        4. Thesis alignment (section purposes reference thesis keywords)
        5. Swappability (same-role consecutive sections)
        """
        result = RedThread()

        if len(sections) < 3:
            result.reasoning = "Too few sections for meaningful red thread validation"
            return result

        # Check 1: Connection chain (fields populated)
        dead_ends = []
        orphans = []
        for i, section in enumerate(sections):
            if i > 0 and not section.connects_to_previous:
                orphans.append(i)
            if i < len(sections) - 1 and not section.connects_to_next:
                dead_ends.append(i)

        result.dead_ends = dead_ends
        result.orphan_sections = orphans

        # Check 2: Connection coherence (adjacent sections share substantive words)
        _stop = {"och", "i", "en", "ett", "den", "det", "som", "är", "med",
                 "för", "av", "till", "på", "att", "har", "inte", "om", "kan",
                 "var", "alla", "mot", "from", "the", "a", "an", "–", "—", ""}
        weak_connections = []
        for i in range(len(sections) - 1):
            next_text = sections[i].connects_to_next or ""
            prev_text = sections[i + 1].connects_to_previous or ""
            next_words = set(next_text.lower().split()) - _stop
            prev_words = set(prev_text.lower().split()) - _stop
            overlap = next_words & prev_words
            if len(overlap) == 0 and next_words and prev_words:
                weak_connections.append((i + 1, i + 2))
        result.weak_connections = weak_connections

        # Check 3: Role progression (expected order)
        expected_order = [SectionRole.HOOK, SectionRole.ESTABLISH, SectionRole.DEEPEN,
                         SectionRole.ANCHOR, SectionRole.PIVOT, SectionRole.RESOLVE]
        actual_roles = [s.role for s in sections]
        role_mismatches = []
        for i, (actual, expected) in enumerate(zip(actual_roles, expected_order)):
            if actual != expected:
                role_mismatches.append(f"section {i+1}: got {actual.value}, expected {expected.value}")

        # Check 4: Thesis alignment (section purposes reference thesis keywords)
        thesis_words = set(thesis.statement.lower().split()) - _stop
        unaligned_sections = []
        for s in sections:
            purpose_words = set(s.purpose.lower().split()) - _stop
            if thesis_words and not (thesis_words & purpose_words):
                unaligned_sections.append(s.order)

        # Check 5: Swappability (simplified – checks role ordering)
        swappable = []
        for i in range(len(sections) - 1):
            s1, s2 = sections[i], sections[i + 1]
            if s1.role == s2.role and s1.role not in (SectionRole.HOOK, SectionRole.RESOLVE):
                swappable.append((i, i + 1))
        result.sections_can_swap = swappable

        # Check 6: Thesis coverage
        thesis_sections = sum(1 for s in sections if s.role != SectionRole.RESOLVE)
        result.thesis_coverage = thesis_sections / max(len(sections), 1)

        # Overall coherence (stricter than before)
        result.is_coherent = (
            len(dead_ends) == 0 and
            len(orphans) == 0 and
            len(swappable) == 0 and
            len(weak_connections) <= 1 and  # Allow max 1 weak connection
            result.thesis_coverage >= 0.7
        )

        reasons = []
        if dead_ends:
            reasons.append(f"Dead ends at sections: {dead_ends}")
        if orphans:
            reasons.append(f"Orphan sections: {orphans}")
        if swappable:
            reasons.append(f"Swappable pairs: {swappable}")
        if weak_connections:
            reasons.append(f"Weak connections between sections: {weak_connections}")
        if role_mismatches:
            reasons.append(f"Role progression issues: {'; '.join(role_mismatches)}")
        if unaligned_sections:
            reasons.append(f"Sections not aligned with thesis: {unaligned_sections}")
        if result.thesis_coverage < 0.7:
            reasons.append(f"Thesis coverage only {result.thesis_coverage:.0%}")
        if not reasons:
            reasons.append("All checks passed – strong red thread")
        result.reasoning = "; ".join(reasons)

        return result


# =============================================================================
# CONSTRAINT ENFORCER
# =============================================================================

class ConstraintEnforcer:
    """
    Checks all constraints BEFORE the article is written.
    Validates the blueprint, not the article text.

    Constraint types:
    - HARD: Must pass or article cannot proceed
    - SOFT: Should pass, warning if not
    - FORBIDDEN: AI markers and banned patterns
    """

    # Forbidden AI phrases (Swedish)
    FORBIDDEN_PHRASES_SV = [
        "det är viktigt att notera",
        "i denna artikel kommer vi att",
        "sammanfattningsvis kan sägas",
        "låt oss utforska",
        "i dagens digitala värld",
        "det har blivit allt viktigare",
        "har du någonsin undrat",
        "i den här guiden",
        "vi kommer att titta på",
        "i slutändan",
        "i dagens läge",
        "det råder ingen tvekan om",
        "faktum är att",
    ]

    FORBIDDEN_PHRASES_EN = [
        "it is important to note",
        "in this article we will",
        "in conclusion it can be said",
        "let us explore",
        "in today's digital world",
        "it has become increasingly important",
        "have you ever wondered",
        "in this guide",
    ]

    def check_blueprint(
        self,
        blueprint: ArticleBlueprint
    ) -> List[ConstraintResult]:
        """Run all constraint checks on the blueprint."""
        results = []

        # === HARD CONSTRAINTS ===

        # H1: Target word count achievable
        total_target = sum(s.target_words for s in blueprint.sections)
        results.append(ConstraintResult(
            name="target_word_count",
            constraint_type=ConstraintType.HARD,
            passed=total_target >= 750,
            value=total_target,
            expected="750-900",
            message=f"Planned total: {total_target} words (target: 750-900)"
        ))

        # H2: Anchor link planned in correct zone
        anchor_section = next((s for s in blueprint.sections if s.contains_anchor), None)
        if anchor_section:
            words_before_anchor = sum(
                s.target_words for s in blueprint.sections if s.order < anchor_section.order
            )
            anchor_pos_ok = 250 <= words_before_anchor <= 550
            results.append(ConstraintResult(
                name="anchor_position",
                constraint_type=ConstraintType.HARD,
                passed=anchor_pos_ok,
                value=f"~word {words_before_anchor}",
                expected="word 250-550",
                message=f"Anchor planned at ~word {words_before_anchor}"
            ))
        else:
            results.append(ConstraintResult(
                name="anchor_position",
                constraint_type=ConstraintType.HARD,
                passed=False,
                message="No section planned for anchor link"
            ))

        # H3: Anchor NOT in intro (first 150 words)
        first_section_anchor = any(
            s.contains_anchor and s.order == 1 for s in blueprint.sections
        )
        results.append(ConstraintResult(
            name="anchor_not_in_intro",
            constraint_type=ConstraintType.HARD,
            passed=not first_section_anchor,
            message="Anchor NOT in intro" if not first_section_anchor else "VIOLATION: anchor in intro"
        ))

        # H4: Anchor NOT in outro (last section)
        last_order = max(s.order for s in blueprint.sections) if blueprint.sections else 0
        last_section_anchor = any(
            s.contains_anchor and s.order == last_order for s in blueprint.sections
        )
        results.append(ConstraintResult(
            name="anchor_not_in_outro",
            constraint_type=ConstraintType.HARD,
            passed=not last_section_anchor,
            message="Anchor NOT in outro" if not last_section_anchor else "VIOLATION: anchor in outro"
        ))

        # H5: Trust links NOT in anchor section
        anchor_section_order = anchor_section.order if anchor_section else -1
        trust_in_anchor = any(
            s.contains_bridge and s.order == anchor_section_order
            for s in blueprint.sections
        )
        results.append(ConstraintResult(
            name="trust_not_in_anchor_section",
            constraint_type=ConstraintType.HARD,
            passed=not trust_in_anchor,
            message="Trust links separate from anchor" if not trust_in_anchor else "VIOLATION: trust link in anchor section"
        ))

        # H6: At least 1 context bridge planned
        has_bridges = len(blueprint.bridges) >= 1
        results.append(ConstraintResult(
            name="context_bridges_planned",
            constraint_type=ConstraintType.HARD,
            passed=has_bridges,
            value=len(blueprint.bridges),
            expected=">=1",
            message=f"{len(blueprint.bridges)} bridge(s) planned"
        ))

        # H7: Thesis exists
        has_thesis = blueprint.thesis is not None and len(blueprint.thesis.statement) > 20
        results.append(ConstraintResult(
            name="thesis_exists",
            constraint_type=ConstraintType.HARD,
            passed=has_thesis,
            message="Thesis defined" if has_thesis else "VIOLATION: no thesis formulated"
        ))

        # === SOFT CONSTRAINTS ===

        # S1: Red thread coherent
        if blueprint.red_thread:
            results.append(ConstraintResult(
                name="red_thread",
                constraint_type=ConstraintType.SOFT,
                passed=blueprint.red_thread.is_coherent,
                message=blueprint.red_thread.reasoning
            ))

        # S2: Bridge verified (will be checked after WebFetch)
        unverified = [b for b in blueprint.bridges if not b.is_verified]
        results.append(ConstraintResult(
            name="bridges_verified",
            constraint_type=ConstraintType.SOFT,
            passed=len(unverified) == 0,
            value=f"{len(unverified)} unverified",
            message="All bridges verified" if not unverified else f"{len(unverified)} bridge(s) need WebFetch verification"
        ))

        # S3: Topic viability
        if blueprint.chosen_topic:
            results.append(ConstraintResult(
                name="topic_viability",
                constraint_type=ConstraintType.SOFT,
                passed=blueprint.chosen_topic.viability in (TopicViability.EXCELLENT, TopicViability.GOOD),
                value=blueprint.chosen_topic.viability.value,
                message=f"Topic viability: {blueprint.chosen_topic.viability.value}"
            ))

        # S4: Anchor naturalness
        if blueprint.thesis:
            results.append(ConstraintResult(
                name="anchor_naturalness",
                constraint_type=ConstraintType.SOFT,
                passed=blueprint.thesis.naturalness in (AnchorNaturalness.SEAMLESS, AnchorNaturalness.NATURAL),
                value=blueprint.thesis.naturalness.value,
                message=f"Anchor naturalness: {blueprint.thesis.naturalness.value}"
            ))

        # === FORBIDDEN PATTERNS ===
        forbidden = self.FORBIDDEN_PHRASES_SV if blueprint.language == "sv" else self.FORBIDDEN_PHRASES_EN
        results.append(ConstraintResult(
            name="forbidden_phrases",
            constraint_type=ConstraintType.FORBIDDEN,
            passed=True,
            value=len(forbidden),
            message=f"{len(forbidden)} forbidden phrases registered – agent must avoid these"
        ))

        return results


# =============================================================================
# AGENT PROMPT RENDERER
# =============================================================================

class AgentPromptRenderer:
    """Renders the ArticleBlueprint into a complete agent prompt."""

    @staticmethod
    def render(blueprint: ArticleBlueprint) -> str:
        """Generate the prompt the agent uses to write the article."""

        # Forbidden phrases list
        forbidden = ConstraintEnforcer.FORBIDDEN_PHRASES_SV if blueprint.language == "sv" else ConstraintEnforcer.FORBIDDEN_PHRASES_EN
        forbidden_str = ", ".join(f'"{p}"' for p in forbidden[:8])

        # Bridge info
        bridge_section = ""
        if blueprint.bridges:
            bridge_section = "\n### KONTEXTBRYGGOR (context boosters)\n"
            for b in blueprint.bridges:
                verified_tag = " [VERIFIERAD]" if b.is_verified else " [BEHÖVER VERIFIERAS MED WebFetch]"
                facts = "; ".join(b.extracted_facts[:3]) if b.extracted_facts else "Extrahera fakta vid verifiering"
                bridge_section += f"""
**{b.role.value.upper()}** – {b.concept}{verified_tag}
- Sökfråga: `{b.search_query}`
- URL: {b.source_url or '[Agent söker och verifierar]'}
- Fakta: {facts}
- Styrka: {b.strength.value} (gravity: {b.score:.2f})
- Roll: {b.reasoning}
"""

        # Gap info
        gap_section = ""
        if blueprint.gap:
            g = blueprint.gap
            gap_section = f"""
### SEMANTISK ANALYS
- **Distans**: {g.distance_category.value} ({g.raw_distance:.2f})
- **Bryggor behövs**: {g.bridge_requirement}
- **Överlappande entiteter**: {', '.join(g.overlap_entities) if g.overlap_entities else 'Inga – brygga krävs'}
- **Gap-entiteter**: {', '.join(g.gap_entities[:5]) if g.gap_entities else 'N/A'}
- **Risk**: {g.risk_level.value}
- **Bedömning**: {g.reasoning}
"""
            # Append pipeline bridge data if available
            if hasattr(blueprint, 'semantic_bridge') and blueprint.semantic_bridge:
                sb = blueprint.semantic_bridge
                if getattr(sb, 'recommended_angle', None):
                    gap_section += f"- **Pipeline-brygga (rekommenderad vinkel)**: {sb.recommended_angle}\n"
                if getattr(sb, 'required_entities', None):
                    gap_section += f"- **Nödvändiga entiteter (embedding-baserat)**: {', '.join(sb.required_entities)}\n"
                if getattr(sb, 'forbidden_entities', None):
                    gap_section += f"- **Undvik entiteter**: {', '.join(sb.forbidden_entities)}\n"
                if getattr(sb, 'trust_link_topics', None):
                    gap_section += f"- **Trustlink-ämnen (pipeline)**: {', '.join(sb.trust_link_topics)}\n"
                if getattr(sb, 'trust_link_avoid', None):
                    gap_section += f"- **Trustlink-undvik domäner**: {', '.join(sb.trust_link_avoid)}\n"
                if getattr(sb, 'suggestions', None):
                    for sug in sb.suggestions[:2]:
                        gap_section += f"- **Bryggförslag**: {sug.concept} (konfidens: {sug.confidence.value}, vinkel: {sug.suggested_angle})\n"

        # SERP Intelligence (NEW)
        serp_section = ""
        if blueprint.target.intent_profile:
            ip = blueprint.target.intent_profile
            serp_section = f"""
### SERP INTELLIGENCE – Målsidans sökintention (5-stegs analys)

**Huvudentitet**: {ip.head_entity}
**Klustersökning**: {ip.cluster_query}
**Metabeskrivnings-predikat**: {ip.meta_desc_predicate or '(ej extraherat)'}

**TA-mål**: {ip.ta_target_description}

**Entiteter att väva in i artikeln**: {', '.join(ip.entities_to_weave[:8]) if ip.entities_to_weave else 'Ej analyserat'}
**LSI-termer**: {', '.join(ip.lsi_terms[:8]) if ip.lsi_terms else 'Ej analyserat'}
**Kärnentiteter (SERP-bekräftade)**: {', '.join(ip.core_entities[:6]) if ip.core_entities else 'Ej analyserat'}
**Klusterentiteter**: {', '.join(ip.cluster_entities[:6]) if ip.cluster_entities else 'Ej analyserat'}
"""
            if ip.competitor_entities:
                serp_section += f"""**TA-GAP entiteter** (konkurrenter rankar med dessa men target saknar dem — väv in för att stärka TA): {', '.join(ip.competitor_entities[:8])}
"""
            if ip.entities_to_avoid:
                serp_section += f"""**Undvik dessa entiteter** (kan missleda eller späda ut TA): {', '.join(ip.entities_to_avoid)}
"""
            serp_section += f"""
**Brygg-riktning**: {ip.ideal_bridge_direction}

"""
            # Intent gap warning (Punkt 4 fix)
            if ip.intent_gap:
                serp_section += f"""**⚠ INTENT GAP DETEKTERAT**
{ip.intent_gap}
**INSTRUKTION**: Artikeln MÅSTE ta hänsyn till detta gap. Skriv mot den intention Google faktiskt visar i SERP, inte den intention kundens metatitel antyder. Bryggan och trustlinks ska hjälpa till att överbrygga gapet.

"""
            if ip.probes:
                serp_section += "**SERP-RESEARCH-PLAN (kör dessa WebSearches före artikelskrivande):**\n\n"
                for probe in ip.probes:
                    serp_section += f"""**Steg {probe.step}: {probe.step_name}**
- Sök: `{probe.query}`
- Syfte: {probe.purpose}
"""
                serp_section += """
**INSTRUKTION**: Kör dessa 5 WebSearches. För varje, läs metatitel + metabeskrivning
för position 1-3. Notera vilka entiteter som dyker upp och jämför med listan ovan.
Använd insikterna för att:
1. Bekräfta/justera ämnesvalet
2. Hitta kontextlänkar som binder publisher→target via SERP-bekräftade entiteter
3. Väva in LSI-termer naturligt i texten
4. Säkerställa att ankarlänken sitter i en kontext som stärker rätt TA
"""

        # Trust link search plan
        trustlink_section = ""
        if blueprint.target and blueprint.target.intent_profile:
            analyzer = TargetIntentAnalyzer()
            tl_queries = analyzer.build_trustlink_queries(
                preflight_bridge=None,  # not available at render time
                plan=blueprint.target.intent_profile,
                target_title=blueprint.target.title,
            )
            if tl_queries:
                trustlink_section = "\n### TRUSTLINK-SÖKPLAN\nAgent kör dessa web_search-frågor för att hitta trust/kontextlänkar:\n"
                for i, q in enumerate(tl_queries, 1):
                    purpose = "hitta auktoritativa källor inom artikelns ämne" if i == 1 else "hitta djuplänkar till rapporter/forskning"
                    trustlink_section += f"{i}. \"{q}\" — {purpose}\n"
                trustlink_section += f"""
INSTRUKTION: Välj 1-2 (max 3) resultat som:
- Är djuplänkar (inte rotdomäner)
- INTE är target-domänen ({blueprint.target_url}) eller publisher-domänen ({blueprint.publisher_domain})
- INTE är konkurrenter eller affiliatesajter
- Har relevant innehåll som stödjer artikelns tes
"""

        # Topic info
        topic_section = ""
        if blueprint.chosen_topic:
            t = blueprint.chosen_topic
            topic_section = f"""
### UPPTÄCKT ÄMNE
- **Ämne**: {t.topic}
- **Viabilitet**: {t.viability.value} (score: {t.composite_score:.2f})
- **Publisher-fit**: {t.publisher_fit:.2f}
- **Target-proximity**: {t.target_proximity:.2f}
- **Resonemang**: {t.reasoning}
"""

        # Thesis
        thesis_section = ""
        if blueprint.thesis:
            th = blueprint.thesis
            thesis_section = f"""
### TES (artikelns drivande påstående)
> {th.statement}

- **Ankarlänk-integration**: {th.anchor_integration}
- **Naturlighet**: {th.naturalness.value}
"""

        # Section plan
        section_section = "### SEKTIONSPLAN\n\n"
        section_section += "Agenten bestämmer ALLA rubriker och innehåll. Denna plan anger ROLLEN varje sektion spelar:\n\n"
        for s in blueprint.sections:
            anchor_tag = " **[ANKARLÄNK HÄR]**" if s.contains_anchor else ""
            bridge_tag = " [trustlänk här]" if s.contains_bridge else ""
            entity_tag = f"\n- Entiteter att väva in: {', '.join(s.entities_to_cover)}" if s.entities_to_cover else ""
            section_section += f"""**Sektion {s.order} ({s.role.value})**{anchor_tag}{bridge_tag}
- Syfte: {s.purpose}
- Koppling bakåt: {s.connects_to_previous}
- Koppling framåt: {s.connects_to_next}
- Mål: ~{s.target_words} ord{entity_tag}
"""

        # Red thread validation
        red_thread_section = ""
        if blueprint.red_thread:
            rt = blueprint.red_thread
            status = "GODKÄND" if rt.is_coherent else "VARNING"
            red_thread_section = f"""
### RÖD TRÅD-VALIDERING: {status}
{rt.reasoning}
"""

        # Constraint summary
        constraint_section = "### CONSTRAINT-KONTROLL\n\n"
        hard_pass = sum(1 for c in blueprint.constraints if c.constraint_type == ConstraintType.HARD and c.passed)
        hard_total = sum(1 for c in blueprint.constraints if c.constraint_type == ConstraintType.HARD)
        constraint_section += f"**Hårda krav**: {hard_pass}/{hard_total} godkända\n"
        for c in blueprint.constraints:
            if not c.passed:
                constraint_section += f"- {'FAIL' if c.constraint_type == ConstraintType.HARD else 'WARN'}: {c.name} – {c.message}\n"

        # Assemble full prompt
        prompt = f"""# ARTIKELUPPDRAG – Jobb {blueprint.job_number}
# Genererat av BACOWR Engine v{blueprint.engine_version}

## INPUT
- **Publisher**: {blueprint.publisher_domain}
- **Target URL**: {blueprint.target_url}
- **Ankartext**: {blueprint.anchor_text}
- **Språk**: {blueprint.language}

## PUBLISHER
- **Sajt**: {blueprint.publisher.site_name} ({blueprint.publisher.domain})
- **Ämnen**: {', '.join(blueprint.publisher.primary_topics)}
{gap_section}{serp_section}{trustlink_section}{topic_section}{bridge_section}{thesis_section}
## ARTIKELPLAN
{section_section}{red_thread_section}
## REGLER

### Ordantal
750–900 ord (hårda gränser). Stycken 100–200 ord, fullt utvecklade tankar.

### Struktur
- EN rubrik (titel) – max 1 heading
- Resten är flytande prosa i paragrafer, INGA H2/H3-underrubriker
- INGA punktlistor, INGA numrerade listor i artikeln

### Ankarlänk
- Exakt 1 st: `[{blueprint.anchor_text}]({blueprint.target_url})`
- Placera mellan ord 250–550. VARIERA placeringen per artikel.
- ALDRIG i intro (första 250 ord) eller outro (sista 100 ord)
- Ska sitta NATURLIGT – läsaren ska inte reagera

### Trustlänkar (kontextbryggor)
- 1-2 verifierade källhänvisningar (max 3 om semantisk triangulering kräver det)
- Placeras FÖRE ankarlänken i artikelflödet
- ALDRIG till konkurrenter eller affiliatesajter
- Varje trustlänk ska vara en DJUPLÄNK (ej rotdomän)
- Kontextlänkarna bygger BRYGGAN – utan dem sitter ankarlänken inte naturligt

### Röd tråd
- Varje sektion bygger på föregående – sista meningen pekar framåt
- Första meningen i nästa sektion plockar upp tråden
- Sektionerna ska INTE kunna byta plats utan att det märks
- Strukturera efter RELEVANS, inte kronologi
- Väv in bakgrund som stöd i sektioner – aldrig som fristående block

### Tesformulering
INNAN du skriver: formulera EN mening som hela artikeln driver. Varje sektion tjänar tesen.

### Förbjudna fraser
{forbidden_str}

{constraint_section}
## KVALITETSKONTROLL

Kör QA-scriptet från qa-template.md efter artikeln är skriven till disk.
11 binära checks – alla måste passera. Se qa-template.md för detaljer.
"""

        return prompt.strip()


# =============================================================================
# ARTICLE ORCHESTRATOR – FULL PIPELINE
# =============================================================================

class ArticleOrchestrator:
    """
    Full pipeline: JobSpec -> ArticleBlueprint.

    This is the engine's main entry point. It coordinates all sub-engines
    to produce a complete, validated blueprint that the writing agent uses.

    The orchestrator does NOT write the article – it creates the optimal
    conditions for the agent to write a great one.
    """

    def __init__(self):
        self.target_intent_analyzer = TargetIntentAnalyzer()
        self.topic_engine = TopicDiscoveryEngine()
        self.bridge_engine = BridgeGravityEngine()
        self.thesis_forge = ThesisForge()
        self.section_planner = SectionPlanner()
        self.red_thread_validator = RedThreadValidator()
        self.constraint_enforcer = ConstraintEnforcer()
        self.logger = logging.getLogger("Orchestrator")

    def create_blueprint(
        self,
        job_number: int,
        publisher_domain: str,
        target_url: str,
        anchor_text: str,
        publisher: Optional[PublisherUniverse] = None,
        target: Optional[TargetUniverse] = None,
        language: Optional[str] = None,
        semantic_bridge=None
    ) -> ArticleBlueprint:
        """
        Create a complete article blueprint from the three input variables.

        This method can be called with just the three variables (minimal mode)
        or with pre-analyzed publisher/target data (full mode).
        """
        # Initialize blueprint
        bp = ArticleBlueprint(
            job_number=job_number,
            publisher_domain=publisher_domain,
            target_url=target_url,
            anchor_text=anchor_text,
            language=language or _detect_language(publisher_domain),
            created_at=datetime.now().isoformat()
        )

        # Step 1: Publisher universe
        if publisher:
            bp.publisher = publisher
        else:
            bp.publisher = self._minimal_publisher(publisher_domain)
        bp.phase = ArticlePhase.PUBLISHER_PROFILED
        self.logger.info(f"Publisher: {bp.publisher.domain} -> {bp.publisher.primary_topics}")

        # Step 2: Target universe
        if target:
            bp.target = target
        else:
            bp.target = self._minimal_target(target_url)
        bp.phase = ArticlePhase.TARGET_FINGERPRINTED
        self.logger.info(f"Target: {bp.target.url} -> {bp.target.main_keywords[:5]}")

        # Step 2.5: SERP Intelligence (5-step research plan)
        # Build the research plan + offline synthesis
        if bp.target.intent_profile is None:
            intent_profile = self.target_intent_analyzer.build_research_plan(bp.target)
            intent_profile = self.target_intent_analyzer.synthesize_from_plan(intent_profile)
            bp.target.intent_profile = intent_profile
            self.logger.info(
                f"SERP Intelligence: head_entity='{intent_profile.head_entity}', "
                f"core_entities={intent_profile.core_entities[:4]}, "
                f"confidence={intent_profile.confidence:.2f}"
            )

        # Step 3: Gap analysis
        bp.gap = self._analyze_gap(bp.publisher, bp.target)
        bp.phase = ArticlePhase.GAP_ANALYZED
        self.logger.info(f"Gap: {bp.gap.distance_category.value} ({bp.gap.raw_distance:.2f})")

        # Step 3.5: Enrich from pipeline's semantic bridge (if available)
        bp.semantic_bridge = semantic_bridge
        if semantic_bridge:
            # Enrich gap with pipeline's embedding-based analysis
            if hasattr(semantic_bridge, 'required_entities') and semantic_bridge.required_entities:
                bp.gap.bridge_required_entities = semantic_bridge.required_entities
            if hasattr(semantic_bridge, 'forbidden_entities') and semantic_bridge.forbidden_entities:
                bp.gap.bridge_forbidden_entities = semantic_bridge.forbidden_entities
            if hasattr(semantic_bridge, 'recommended_angle') and semantic_bridge.recommended_angle:
                bp.gap.bridge_recommended_angle = semantic_bridge.recommended_angle
            if hasattr(semantic_bridge, 'suggestions') and semantic_bridge.suggestions:
                bp.gap.bridge_suggestions = semantic_bridge.suggestions
            self.logger.info(
                f"SemanticBridge: angle='{getattr(semantic_bridge, 'recommended_angle', 'N/A')}', "
                f"required={len(getattr(semantic_bridge, 'required_entities', []))} entities"
            )

        # Step 4: Topic discovery
        candidates = self.topic_engine.discover(
            bp.publisher, bp.target, bp.gap, anchor_text
        )
        if candidates:
            bp.chosen_topic = candidates[0]
            bp.rejected_topics = [c for c in candidates[1:] if c.viability == TopicViability.REJECTED]
        bp.phase = ArticlePhase.TOPIC_DISCOVERED
        self.logger.info(f"Topic: {bp.chosen_topic.topic if bp.chosen_topic else 'NONE'}")

        # Step 5: Bridge scoring
        all_bridges = []
        if bp.chosen_topic and bp.chosen_topic.bridges_available:
            all_bridges = bp.chosen_topic.bridges_available
        # Add fallback bridges from gap analysis
        if not all_bridges:
            all_bridges = self._generate_fallback_bridges(bp.publisher, bp.target, anchor_text)

        bp.bridges = self.bridge_engine.score_bridges(
            all_bridges, bp.publisher, bp.target, bp.gap
        )
        bp.phase = ArticlePhase.BRIDGES_SCORED
        self.logger.info(f"Bridges: {len(bp.bridges)} scored")

        # Step 6: Thesis
        if bp.chosen_topic:
            theses = self.thesis_forge.forge(
                bp.chosen_topic, bp.publisher, bp.target,
                bp.bridges, anchor_text, bp.language
            )
            if theses:
                bp.thesis = theses[0]
        bp.phase = ArticlePhase.THESIS_FORGED
        self.logger.info(f"Thesis: {bp.thesis.statement[:80] if bp.thesis else 'NONE'}...")

        # Step 7: Section planning (with entity distribution from SERP intelligence)
        if bp.thesis:
            ip = bp.target.intent_profile if bp.target else None
            bp.sections = self.section_planner.plan(
                bp.thesis, bp.chosen_topic, bp.bridges, anchor_text,
                core_entities=ip.core_entities if ip else None,
                cluster_entities=ip.cluster_entities if ip else None,
                entities_to_weave=ip.entities_to_weave if ip else None,
            )
        bp.phase = ArticlePhase.SECTIONS_PLANNED
        self.logger.info(f"Sections: {len(bp.sections)} planned")

        # Step 8: Red thread validation
        if bp.thesis and bp.sections:
            bp.red_thread = self.red_thread_validator.validate(bp.sections, bp.thesis)
        bp.phase = ArticlePhase.CONSTRAINTS_CHECKED

        # Step 9: Constraint check
        bp.constraints = self.constraint_enforcer.check_blueprint(bp)
        bp.overall_risk = self._determine_overall_risk(bp)
        bp.phase = ArticlePhase.BLUEPRINT_READY

        self.logger.info(f"Blueprint ready. Risk: {bp.overall_risk.value}. Approved: {bp.is_approved}")
        return bp

    def _minimal_publisher(self, domain: str) -> PublisherUniverse:
        """Create minimal publisher profile from domain name alone."""
        name = domain.replace("www.", "").split(".")[0].lower()
        topics = []

        # Use same DOMAIN_MAP logic as pipeline.py PublisherProfiler
        domain_hints = {
            "fotboll": ["fotboll", "allsvenskan"], "sport": ["sport", "idrott"],
            "hockey": ["hockey", "shl"], "golf": ["golf", "golfnyheter"],
            "motor": ["motorsport", "bilar"], "nyheter": ["nyheter"],
            "ekonomi": ["ekonomi", "finans"], "teknik": ["teknik", "it"],
            "musik": ["musik"], "mat": ["mat", "recept"],
            "resor": ["resor", "turism"], "mode": ["mode", "kläder"],
            "hälsa": ["hälsa", "träning"], "bygg": ["byggande", "renovering"],
            "villa": ["villa", "bostad", "hem"], "casino": ["casino", "spel"],
            "betting": ["betting", "odds"], "present": ["present", "gåva"],
            "event": ["event", "evenemang"],
        }
        for pattern, pattern_topics in domain_hints.items():
            if pattern in name:
                topics.extend(pattern_topics)

        if not topics:
            topics = [name]

        return PublisherUniverse(
            domain=domain,
            site_name=name.title(),
            primary_topics=topics[:5],
            language=_detect_language(domain),
            confidence=0.5  # Low confidence without actual HTTP fetch
        )

    def _minimal_target(self, url: str) -> TargetUniverse:
        """Create minimal target from URL alone."""
        from urllib.parse import urlparse
        parsed = urlparse(url)
        path_words = [w for w in parsed.path.strip("/").split("/") if len(w) > 2]
        domain = parsed.netloc.replace("www.", "")

        return TargetUniverse(
            url=url,
            title=domain,
            main_keywords=path_words[:5],
            topic_cluster=path_words[:3],
        )

    def _analyze_gap(self, pub: PublisherUniverse, target: TargetUniverse) -> GapAnalysis:
        """Analyze semantic gap. Uses SERP intelligence when available."""
        pub_words = set(w.lower() for w in pub.primary_topics + pub.secondary_topics)

        # When SERP intelligence is available, use SERP-confirmed entities
        # This is far more accurate than just comparing page keywords
        if target.has_serp_intelligence:
            ip = target.intent_profile
            tgt_words = set(
                e.lower() for e in
                ip.core_entities + ip.cluster_entities + ip.lsi_terms
            )
        else:
            tgt_words = set(w.lower() for w in target.main_keywords + target.topic_cluster)

        overlap = pub_words & tgt_words
        gap_entities = list(tgt_words - pub_words)

        # Heuristic distance based on overlap ratio
        if pub_words and tgt_words:
            overlap_ratio = len(overlap) / max(len(pub_words | tgt_words), 1)
        else:
            overlap_ratio = 0.0

        # Map to distance
        if overlap_ratio >= 0.4:
            raw_distance = 0.85
            category = SemanticDistance.CLOSE
        elif overlap_ratio >= 0.2:
            raw_distance = 0.6
            category = SemanticDistance.MODERATE
        elif overlap_ratio > 0:
            raw_distance = 0.4
            category = SemanticDistance.DISTANT
        else:
            raw_distance = 0.2
            category = SemanticDistance.UNRELATED

        # Bridge requirement
        bridges_needed = {
            SemanticDistance.IDENTICAL: 0,
            SemanticDistance.CLOSE: 1,
            SemanticDistance.MODERATE: 1,
            SemanticDistance.DISTANT: 2,
            SemanticDistance.UNRELATED: 2,
        }

        # Risk
        risk = {
            SemanticDistance.IDENTICAL: RiskLevel.LOW,
            SemanticDistance.CLOSE: RiskLevel.LOW,
            SemanticDistance.MODERATE: RiskLevel.MEDIUM,
            SemanticDistance.DISTANT: RiskLevel.MEDIUM,
            SemanticDistance.UNRELATED: RiskLevel.HIGH,
        }

        return GapAnalysis(
            raw_distance=raw_distance,
            distance_category=category,
            overlap_entities=list(overlap),
            gap_entities=gap_entities,
            bridge_requirement=bridges_needed.get(category, 1),
            risk_level=risk.get(category, RiskLevel.MEDIUM),
            reasoning=f"Overlap: {len(overlap)} entities ({overlap_ratio:.0%}). Gap: {len(gap_entities)} entities need bridging."
        )

    def _generate_fallback_bridges(
        self, pub: PublisherUniverse, target: TargetUniverse, anchor: str
    ) -> List[ContextBridge]:
        """Generate bridges when topic discovery didn't provide any."""
        bridges = []
        pub_topic = pub.primary_topics[0] if pub.primary_topics else "ämnet"
        tgt_keyword = target.main_keywords[0] if target.main_keywords else "marknaden"

        bridges.append(ContextBridge(
            id=_hash_id(f"fallback_{pub_topic}_{tgt_keyword}"),
            concept=f"{pub_topic} och {tgt_keyword}",
            search_query=f"{pub_topic} {tgt_keyword} analys",
            reasoning=f"Fallback bridge: publisher primary '{pub_topic}' + target keyword '{tgt_keyword}'"
        ))

        if len(target.main_keywords) > 1:
            tgt2 = target.main_keywords[1]
            bridges.append(ContextBridge(
                id=_hash_id(f"fallback_{pub_topic}_{tgt2}"),
                concept=f"{pub_topic} och {tgt2}",
                search_query=f"{pub_topic} {tgt2} trend forskning",
                reasoning=f"Fallback bridge 2: '{pub_topic}' + '{tgt2}'"
            ))

        return bridges

    def _determine_overall_risk(self, bp: ArticleBlueprint) -> RiskLevel:
        """Determine overall risk from all signals."""
        risks = []

        # Gap risk
        if bp.gap:
            risks.append(bp.gap.risk_level)

        # Constraint violations
        hard_failures = sum(1 for c in bp.constraints if c.constraint_type == ConstraintType.HARD and not c.passed)
        if hard_failures > 0:
            risks.append(RiskLevel.HIGH)

        # Topic viability
        if bp.chosen_topic and bp.chosen_topic.viability == TopicViability.RISKY:
            risks.append(RiskLevel.MEDIUM)
        elif bp.chosen_topic and bp.chosen_topic.viability == TopicViability.REJECTED:
            risks.append(RiskLevel.HIGH)

        # Anchor naturalness
        if bp.thesis and bp.thesis.naturalness == AnchorNaturalness.FORCED:
            risks.append(RiskLevel.HIGH)

        # Worst-case wins
        risk_order = [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL]
        if risks:
            return max(risks, key=lambda r: risk_order.index(r))
        return RiskLevel.LOW


# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def _hash_id(text: str) -> str:
    """Generate a short hash ID."""
    return hashlib.md5(text.encode()).hexdigest()[:12]


def _detect_language(domain: str) -> str:
    """Detect language from domain."""
    domain = domain.lower()
    if domain.endswith((".co.uk", ".uk")):
        return "en"
    if domain.endswith(".com"):
        name = domain.split(".")[0]
        english_signals = ["weekly", "town", "kingdom", "blog", "news",
                           "world", "daily", "times", "online", "hub"]
        if any(sig in name for sig in english_signals):
            return "en"
    return "sv"


# =============================================================================
# PIPELINE INTEGRATION – BRIDGE TO EXISTING pipeline.py
# =============================================================================

def create_blueprint_from_pipeline(
    job_number: int,
    publisher_domain: str,
    target_url: str,
    anchor_text: str,
    publisher_profile=None,
    target_fingerprint=None,
    semantic_bridge=None
) -> ArticleBlueprint:
    """
    Bridge function: takes existing pipeline.py outputs and creates a blueprint.

    Usage:
        from engine import create_blueprint_from_pipeline
        from pipeline import Pipeline, PipelineConfig

        # Run existing pipeline
        pipeline = Pipeline(PipelineConfig())
        preflight = await pipeline.run_preflight(job)

        # Create enhanced blueprint
        blueprint = create_blueprint_from_pipeline(
            job.job_number, job.publisher_domain, job.target_url, job.anchor_text,
            preflight.publisher, preflight.target, preflight.bridge
        )
    """
    # Convert pipeline.py models to engine models
    pub = None
    if publisher_profile:
        pub = PublisherUniverse(
            domain=publisher_profile.domain,
            site_name=publisher_profile.site_name or publisher_profile.domain,
            primary_topics=publisher_profile.primary_topics,
            secondary_topics=publisher_profile.secondary_topics,
            language=publisher_profile.primary_language,
            category_structure=publisher_profile.category_structure,
            confidence=publisher_profile.confidence
        )

    tgt = None
    if target_fingerprint:
        tgt = TargetUniverse(
            url=target_fingerprint.url,
            title=target_fingerprint.title,
            h1=target_fingerprint.h1,
            meta_description=target_fingerprint.meta_description,
            language=target_fingerprint.language,
            main_keywords=target_fingerprint.main_keywords,
            topic_cluster=target_fingerprint.topic_cluster,
        )

    orchestrator = ArticleOrchestrator()
    return orchestrator.create_blueprint(
        job_number=job_number,
        publisher_domain=publisher_domain,
        target_url=target_url,
        anchor_text=anchor_text,
        publisher=pub,
        target=tgt,
        semantic_bridge=semantic_bridge,
    )


# =============================================================================
# CLI
# =============================================================================

def main():
    """CLI entry point."""
    import argparse
    import sys

    logging.basicConfig(level=logging.INFO, format="%(name)s | %(message)s")

    parser = argparse.ArgumentParser(description="BACOWR Article Intelligence Engine v6.2")
    sub = parser.add_subparsers(dest="command", help="Command to run")

    # Blueprint command
    bp_p = sub.add_parser("blueprint", help="Create article blueprint")
    bp_p.add_argument("--publisher", required=True, help="Publisher domain")
    bp_p.add_argument("--target", required=True, help="Target URL")
    bp_p.add_argument("--anchor", required=True, help="Anchor text")
    bp_p.add_argument("--job", type=int, default=1, help="Job number")
    bp_p.add_argument("--output", help="Output file (default: stdout)")

    # Discover command
    disc_p = sub.add_parser("discover", help="Discover topic candidates")
    disc_p.add_argument("--publisher", required=True)
    disc_p.add_argument("--target", required=True)
    disc_p.add_argument("--anchor", required=True)

    # Score bridges command
    score_p = sub.add_parser("score-bridges", help="Score bridge candidates")
    score_p.add_argument("--publisher", required=True)
    score_p.add_argument("--target", required=True)
    score_p.add_argument("--anchor", required=True)

    args = parser.parse_args()

    if args.command == "blueprint":
        orchestrator = ArticleOrchestrator()
        bp = orchestrator.create_blueprint(
            job_number=args.job,
            publisher_domain=args.publisher,
            target_url=args.target,
            anchor_text=args.anchor,
        )

        if args.output:
            from pathlib import Path
            Path(args.output).write_text(bp.to_json(), encoding="utf-8")
            print(f"Blueprint saved: {args.output}")
        else:
            print(bp.to_agent_prompt())

    elif args.command == "discover":
        orchestrator = ArticleOrchestrator()
        pub = orchestrator._minimal_publisher(args.publisher)
        tgt = orchestrator._minimal_target(args.target)
        gap = orchestrator._analyze_gap(pub, tgt)

        engine = TopicDiscoveryEngine()
        candidates = engine.discover(pub, tgt, gap, args.anchor)

        print(f"\n{'='*60}")
        print(f"TOPIC CANDIDATES: {args.publisher} -> {args.anchor}")
        print(f"{'='*60}")
        for i, c in enumerate(candidates, 1):
            print(f"\n  [{i}] {c.topic}")
            print(f"      Viability: {c.viability.value} (score: {c.composite_score:.2f})")
            print(f"      Pub-fit: {c.publisher_fit:.2f} | Target-prox: {c.target_proximity:.2f}")
            if c.thesis_seed:
                print(f"      Thesis: {c.thesis_seed}")
            if c.bridges_available:
                print(f"      Bridges: {len(c.bridges_available)}")

    elif args.command == "score-bridges":
        orchestrator = ArticleOrchestrator()
        pub = orchestrator._minimal_publisher(args.publisher)
        tgt = orchestrator._minimal_target(args.target)
        gap = orchestrator._analyze_gap(pub, tgt)

        # Discover topics to get bridges
        engine = TopicDiscoveryEngine()
        candidates = engine.discover(pub, tgt, gap, args.anchor)

        all_bridges = []
        for c in candidates:
            all_bridges.extend(c.bridges_available)

        if not all_bridges:
            all_bridges = orchestrator._generate_fallback_bridges(pub, tgt, args.anchor)

        scored = BridgeGravityEngine().score_bridges(all_bridges, pub, tgt, gap)

        print(f"\n{'='*60}")
        print(f"BRIDGE SCORES: {args.publisher} -> {args.anchor}")
        print(f"{'='*60}")
        for b in scored:
            print(f"\n  [{b.role.value.upper()}] {b.concept}")
            print(f"  Gravity: {b.score:.3f} ({b.strength.value})")
            print(f"    Semantic pull: {b.gravity.semantic_pull:.2f}")
            print(f"    Factual mass:  {b.gravity.factual_mass:.2f}")
            print(f"    Topic fit:     {b.gravity.topic_fit:.2f}")
            print(f"    Uniqueness:    {b.gravity.uniqueness:.2f}")
            print(f"  Search: {b.search_query}")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
