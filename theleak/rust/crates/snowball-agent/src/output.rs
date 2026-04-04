//! Output formatters — renders extraction results as markdown, JSON, and vault items.

use crate::agent_gen::{AgentBlueprint, AgentGenerator};
use crate::gamechanger::{Gamechanger, GamechangerDetector};
use crate::knowledge::{KnowledgeBase, PatternCategory};
use crate::skill_gen::{GeneratedSkill, SkillGenerator};
use std::fs;
use std::path::Path;

// ── Full extraction output ──────────────────────────────────────────────────

pub struct ExtractionOutput {
    pub skills: Vec<GeneratedSkill>,
    pub agents: Vec<AgentBlueprint>,
    pub gamechangers: Vec<Gamechanger>,
    pub knowledge_base: KnowledgeBase,
}

// ── Output generator ────────────────────────────────────────────────────────

pub struct OutputGenerator;

impl OutputGenerator {
    /// Generate all outputs from a knowledge base.
    pub fn generate(kb: &KnowledgeBase) -> ExtractionOutput {
        ExtractionOutput {
            skills: SkillGenerator::generate(kb),
            agents: AgentGenerator::generate(kb),
            gamechangers: GamechangerDetector::detect(kb),
            knowledge_base: kb.clone(),
        }
    }

    /// Write all outputs to a directory.
    pub fn write_to_dir(output: &ExtractionOutput, dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
        // Create directories
        let skills_dir = dir.join("skills");
        let agents_dir = dir.join("agents");
        let gamechangers_dir = dir.join("gamechangers");
        fs::create_dir_all(&skills_dir)?;
        fs::create_dir_all(&agents_dir)?;
        fs::create_dir_all(&gamechangers_dir)?;

        // Write skills
        for skill in &output.skills {
            let filename = format!("{}.md", skill.id);
            fs::write(skills_dir.join(&filename), skill.to_vault_markdown())?;
        }

        // Write agent blueprints
        for agent in &output.agents {
            let filename = format!("{}.md", agent.id);
            fs::write(agents_dir.join(&filename), agent.to_markdown())?;
        }

        // Write gamechangers
        let gc_report = GamechangerDetector::report(&output.gamechangers);
        fs::write(gamechangers_dir.join("GAMECHANGERS.md"), &gc_report)?;

        // Write individual gamechanger files
        for gc in &output.gamechangers {
            let filename = format!("{}.md", gc.id);
            let content = format!(
                "# {}\n\n**{}**\n\n**Leverage:** {}\n\n## What\n\n{}\n\n## Why It Matters\n\n{}\n\n## How To Use\n\n{}\n\n## Code Pattern\n\n```rust\n{}\n```\n",
                gc.name, gc.tagline, gc.leverage.label(),
                gc.description, gc.why_it_matters, gc.how_to_use, gc.code_pattern
            );
            fs::write(gamechangers_dir.join(&filename), content)?;
        }

        // Write knowledge base
        output.knowledge_base.save_to_file(&dir.join("knowledge_base.json"))?;

        // Write skills report
        let skills_report = SkillGenerator::report(&output.skills);
        fs::write(dir.join("SKILLS.md"), &skills_report)?;

        // Write agents report
        let agents_report = AgentGenerator::report(&output.agents);
        fs::write(dir.join("AGENTS.md"), &agents_report)?;

        // Write summary
        let summary = Self::generate_summary(output);
        fs::write(dir.join("SUMMARY.md"), &summary)?;

        // Write INDEX.md
        let index = Self::generate_index(output);
        fs::write(dir.join("INDEX.md"), &index)?;

        Ok(())
    }

    fn generate_summary(output: &ExtractionOutput) -> String {
        let stats = output.knowledge_base.stats();
        let mut out = String::new();

        out.push_str("# Snowball Extraction Summary\n\n");
        out.push_str("## Statistics\n\n");
        out.push_str(&format!("- **Total facts extracted:** {}\n", stats.total_facts));
        out.push_str(&format!("- **Gamechanger patterns:** {}\n", output.gamechangers.len()));
        out.push_str(&format!("- **Skills generated:** {}\n", output.skills.len()));
        out.push_str(&format!("- **Agent blueprints:** {}\n", output.agents.len()));
        out.push_str(&format!("- **Knowledge score:** {}\n\n", stats.total_score));

        out.push_str("## Facts by Category\n\n");
        out.push_str("| Category | Count |\n");
        out.push_str("|----------|-------|\n");
        for category in PatternCategory::all() {
            let count = stats.by_category.get(&category).unwrap_or(&0);
            if *count > 0 {
                out.push_str(&format!("| {} | {} |\n", category.display_name(), count));
            }
        }
        out.push('\n');

        out.push_str("## Top Gamechangers\n\n");
        for (i, gc) in output.gamechangers.iter().enumerate().take(5) {
            out.push_str(&format!(
                "{}. **{}** — {} ({})\n",
                i + 1,
                gc.name,
                gc.tagline,
                gc.leverage.label()
            ));
        }
        out.push('\n');

        out.push_str("## Generated Skills\n\n");
        for skill in &output.skills {
            out.push_str(&format!("- **{}** ({})\n", skill.name, skill.category.display_name()));
        }
        out.push('\n');

        out.push_str("## Agent Blueprints\n\n");
        for agent in &output.agents {
            out.push_str(&format!("- **{}** — {} (`{}`)\n", agent.name, agent.role, agent.permission_mode));
        }
        out.push('\n');

        out
    }

    fn generate_index(output: &ExtractionOutput) -> String {
        let mut out = String::new();
        out.push_str("# Extraction Index\n\n");

        out.push_str("## Skills\n\n");
        for skill in &output.skills {
            out.push_str(&format!(
                "- [{}](skills/{}.md) — {}\n",
                skill.name, skill.id, skill.description.chars().take(80).collect::<String>()
            ));
        }
        out.push('\n');

        out.push_str("## Agent Blueprints\n\n");
        for agent in &output.agents {
            out.push_str(&format!(
                "- [{}](agents/{}.md) — {}\n",
                agent.name, agent.id, agent.role
            ));
        }
        out.push('\n');

        out.push_str("## Gamechangers\n\n");
        out.push_str("- [Full Report](gamechangers/GAMECHANGERS.md)\n");
        for gc in &output.gamechangers {
            out.push_str(&format!(
                "- [{}](gamechangers/{}.md) — {}\n",
                gc.name, gc.id, gc.tagline
            ));
        }
        out.push('\n');

        out.push_str("## Data\n\n");
        out.push_str("- [Knowledge Base](knowledge_base.json)\n");
        out.push_str("- [Skills Report](SKILLS.md)\n");
        out.push_str("- [Agents Report](AGENTS.md)\n");
        out.push_str("- [Summary](SUMMARY.md)\n");

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_output() {
        let kb = KnowledgeBase::new();
        let output = OutputGenerator::generate(&kb);
        assert!(!output.skills.is_empty());
        assert!(!output.agents.is_empty());
        assert!(!output.gamechangers.is_empty());
    }

    #[test]
    fn test_write_to_dir() {
        let kb = KnowledgeBase::new();
        let output = OutputGenerator::generate(&kb);
        let dir = tempfile::tempdir().unwrap();
        OutputGenerator::write_to_dir(&output, dir.path()).unwrap();

        assert!(dir.path().join("SUMMARY.md").exists());
        assert!(dir.path().join("INDEX.md").exists());
        assert!(dir.path().join("knowledge_base.json").exists());
        assert!(dir.path().join("skills").exists());
        assert!(dir.path().join("agents").exists());
        assert!(dir.path().join("gamechangers/GAMECHANGERS.md").exists());
    }
}
