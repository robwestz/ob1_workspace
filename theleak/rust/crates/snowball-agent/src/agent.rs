//! SnowballAgent — the main orchestrator for knowledge extraction.
//!
//! Pipeline:
//! 1. **Extract**: Read source code, identify patterns
//! 2. **Categorize**: Score and categorize findings
//! 3. **Synthesize**: Cross-reference and detect higher-order patterns
//! 4. **Generate**: Produce skills, agents, and gamechangers
//!
//! Each iteration snowballs — new findings feed back into the knowledge base,
//! enabling deeper analysis on the next pass.

use crate::extractor::SourceExtractor;
use crate::knowledge::KnowledgeBase;
use crate::output::{ExtractionOutput, OutputGenerator};
use std::path::{Path, PathBuf};

// ── Snowball Agent ──────────────────────────────────────────────────────────

pub struct SnowballAgent {
    source_root: PathBuf,
    knowledge_base: KnowledgeBase,
    iteration: usize,
}

impl SnowballAgent {
    /// Create a new agent targeting a source directory.
    pub fn new(source_root: &Path) -> Self {
        Self {
            source_root: source_root.to_path_buf(),
            knowledge_base: KnowledgeBase::new(),
            iteration: 0,
        }
    }

    /// Load existing knowledge base from file.
    pub fn load_knowledge(&mut self, path: &Path) -> Result<(), Box<dyn std::error::Error>> {
        self.knowledge_base = KnowledgeBase::load_from_file(path)?;
        Ok(())
    }

    /// Run one extraction iteration (snowball step).
    ///
    /// Each iteration:
    /// 1. Extracts patterns from source code
    /// 2. Converts to knowledge facts
    /// 3. Merges with existing knowledge (snowball effect)
    /// 4. Returns the new facts added this iteration
    pub fn iterate(&mut self) -> IterationResult {
        self.iteration += 1;
        let previous_count = self.knowledge_base.len();

        // Phase 1: Extract
        let extractor = SourceExtractor::new(&self.source_root);
        let extraction = extractor.extract();

        // Phase 2: Convert to knowledge
        let new_kb = extractor.to_knowledge_base(&extraction);

        // Phase 3: Merge (snowball)
        self.knowledge_base.merge(&new_kb);

        let new_facts = self.knowledge_base.len() - previous_count;

        IterationResult {
            iteration: self.iteration,
            files_scanned: extraction.file_count,
            total_lines: extraction.total_lines,
            traits_found: extraction.traits.len(),
            structs_found: extraction.structs.len(),
            enums_found: extraction.enums.len(),
            patterns_detected: extraction.patterns.len(),
            new_facts_added: new_facts,
            total_facts: self.knowledge_base.len(),
        }
    }

    /// Generate all outputs from accumulated knowledge.
    pub fn generate(&self) -> ExtractionOutput {
        OutputGenerator::generate(&self.knowledge_base)
    }

    /// Write all outputs to a directory.
    pub fn write_output(&self, dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
        let output = self.generate();
        OutputGenerator::write_to_dir(&output, dir)
    }

    /// Get current knowledge base.
    pub fn knowledge_base(&self) -> &KnowledgeBase {
        &self.knowledge_base
    }

    /// Get current iteration count.
    pub fn iteration(&self) -> usize {
        self.iteration
    }
}

// ── Iteration result ────────────────────────────────────────────────────────

#[derive(Debug)]
pub struct IterationResult {
    pub iteration: usize,
    pub files_scanned: usize,
    pub total_lines: usize,
    pub traits_found: usize,
    pub structs_found: usize,
    pub enums_found: usize,
    pub patterns_detected: usize,
    pub new_facts_added: usize,
    pub total_facts: usize,
}

impl std::fmt::Display for IterationResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Iteration #{}: scanned {} files ({} lines) → {} traits, {} structs, {} enums, {} patterns → +{} facts (total: {})",
            self.iteration,
            self.files_scanned,
            self.total_lines,
            self.traits_found,
            self.structs_found,
            self.enums_found,
            self.patterns_detected,
            self.new_facts_added,
            self.total_facts,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_snowball_iteration() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("src");
        fs::create_dir_all(&src).unwrap();
        fs::write(
            src.join("main.rs"),
            r#"
pub trait Engine {
    fn run(&self) -> Result<(), Error>;
}

pub struct Runtime<E: Engine> {
    engine: E,
    config: Config,
}

pub enum Mode {
    Fast,
    Safe,
}
"#,
        )
        .unwrap();

        let mut agent = SnowballAgent::new(dir.path());
        let result = agent.iterate();

        assert_eq!(result.iteration, 1);
        assert!(result.files_scanned >= 1);
        assert!(result.traits_found >= 1);
        assert!(result.structs_found >= 1);
        assert!(result.enums_found >= 1);
        assert!(result.total_facts > 0);

        // Second iteration should add 0 new facts (same code)
        let result2 = agent.iterate();
        assert_eq!(result2.iteration, 2);
        assert_eq!(result2.new_facts_added, 0);
    }

    #[test]
    fn test_generate_output() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("src");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("lib.rs"), "pub trait Foo { fn bar(&self); }").unwrap();

        let mut agent = SnowballAgent::new(dir.path());
        agent.iterate();

        let output = agent.generate();
        assert!(!output.skills.is_empty());
        assert!(!output.agents.is_empty());
        assert!(!output.gamechangers.is_empty());
    }

    #[test]
    fn test_write_output() {
        let src_dir = tempdir().unwrap();
        let src = src_dir.path().join("src");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("lib.rs"), "pub struct Config { name: String }").unwrap();

        let mut agent = SnowballAgent::new(src_dir.path());
        agent.iterate();

        let out_dir = tempdir().unwrap();
        agent.write_output(out_dir.path()).unwrap();

        assert!(out_dir.path().join("SUMMARY.md").exists());
        assert!(out_dir.path().join("INDEX.md").exists());
        assert!(out_dir.path().join("knowledge_base.json").exists());
    }
}
