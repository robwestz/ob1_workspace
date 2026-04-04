//! Snowball Agent — Knowledge extraction system for Rust codebases.
//!
//! Reads source code, extracts architectural patterns, and generates:
//! - **Skills**: Buildr-compatible vault skills with steps and verification
//! - **Agents**: Agent blueprints with tools, permissions, and prompts
//! - **Gamechangers**: Transformative patterns that fundamentally change development
//!
//! # Pipeline
//!
//! ```text
//! Source Code → Extractor → KnowledgeBase → Generators → Output
//!                                ↑                |
//!                                └── Snowball ────┘
//!                               (each iteration feeds the next)
//! ```

pub mod agent;
pub mod agent_gen;
pub mod extractor;
pub mod gamechanger;
pub mod knowledge;
pub mod output;
pub mod skill_gen;

// Re-export core types for convenience
pub use agent::SnowballAgent;
pub use agent_gen::{AgentBlueprint, AgentGenerator};
pub use extractor::{ExtractionResult, SourceExtractor};
pub use gamechanger::{Gamechanger, GamechangerDetector};
pub use knowledge::{ImpactLevel, KnowledgeBase, KnowledgeFact, PatternCategory};
pub use output::OutputGenerator;
pub use skill_gen::{GeneratedSkill, SkillGenerator};
