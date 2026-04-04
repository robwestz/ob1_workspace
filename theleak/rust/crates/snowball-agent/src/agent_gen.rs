//! Agent blueprint generator — creates agent specifications from extracted knowledge.
//!
//! Each blueprint defines an agent with specific capabilities, tool access,
//! system prompts, and interaction patterns.

use crate::knowledge::KnowledgeBase;

// ── Agent blueprint ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct AgentBlueprint {
    pub id: String,
    pub name: String,
    pub role: String,
    pub description: String,
    pub capabilities: Vec<String>,
    pub tools: Vec<ToolAccess>,
    pub permission_mode: String,
    pub system_prompt_sections: Vec<String>,
    pub max_iterations: usize,
    pub when_to_spawn: String,
    pub output_format: String,
}

#[derive(Debug, Clone)]
pub struct ToolAccess {
    pub tool_name: String,
    pub permission: String,
    pub purpose: String,
}

impl AgentBlueprint {
    /// Render as a markdown specification.
    pub fn to_markdown(&self) -> String {
        let mut out = String::new();
        out.push_str(&format!("# Agent: {}\n\n", self.name));
        out.push_str(&format!("**Role:** {}\n\n", self.role));
        out.push_str(&format!("{}\n\n", self.description));

        out.push_str("## When to Spawn\n\n");
        out.push_str(&format!("{}\n\n", self.when_to_spawn));

        out.push_str("## Capabilities\n\n");
        for cap in &self.capabilities {
            out.push_str(&format!("- {}\n", cap));
        }
        out.push('\n');

        out.push_str("## Tool Access\n\n");
        out.push_str(&format!("**Permission Mode:** `{}`\n\n", self.permission_mode));
        out.push_str("| Tool | Permission | Purpose |\n");
        out.push_str("|------|-----------|----------|\n");
        for tool in &self.tools {
            out.push_str(&format!(
                "| `{}` | {} | {} |\n",
                tool.tool_name, tool.permission, tool.purpose
            ));
        }
        out.push('\n');

        out.push_str("## System Prompt\n\n");
        for section in &self.system_prompt_sections {
            out.push_str(&format!("{}\n\n", section));
        }

        out.push_str(&format!("## Constraints\n\n"));
        out.push_str(&format!("- **Max iterations:** {}\n", self.max_iterations));
        out.push_str(&format!("- **Output format:** {}\n\n", self.output_format));

        out
    }
}

// ── Generator ───────────────────────────────────────────────────────────────

pub struct AgentGenerator;

impl AgentGenerator {
    /// Generate agent blueprints from knowledge base.
    pub fn generate(_kb: &KnowledgeBase) -> Vec<AgentBlueprint> {
        Self::core_blueprints()
    }

    fn core_blueprints() -> Vec<AgentBlueprint> {
        vec![
            // 1. Deep Code Analyst
            AgentBlueprint {
                id: "agent_deep_analyst".into(),
                name: "Deep Code Analyst".into(),
                role: "Architectural analysis and pattern extraction".into(),
                description: "Performs thorough codebase exploration to identify architectural patterns, design decisions, trait hierarchies, and reusable abstractions. Produces structured knowledge facts.".into(),
                capabilities: vec![
                    "Read and analyze source code files".into(),
                    "Identify traits, structs, enums, and impl blocks".into(),
                    "Detect design patterns (builder, strategy, observer, etc.)".into(),
                    "Map dependency graphs between modules".into(),
                    "Score patterns by impact and reusability".into(),
                ],
                tools: vec![
                    ToolAccess { tool_name: "read_file".into(), permission: "ReadOnly".into(), purpose: "Read source files".into() },
                    ToolAccess { tool_name: "glob_search".into(), permission: "ReadOnly".into(), purpose: "Find files by pattern".into() },
                    ToolAccess { tool_name: "grep_search".into(), permission: "ReadOnly".into(), purpose: "Search code patterns".into() },
                    ToolAccess { tool_name: "WebFetch".into(), permission: "ReadOnly".into(), purpose: "Fetch documentation".into() },
                ],
                permission_mode: "ReadOnly".into(),
                system_prompt_sections: vec![
                    "You are a Deep Code Analyst. Your job is to explore codebases and extract structured knowledge.".into(),
                    "For each file you read, identify: public traits, key structs, design patterns, and architectural decisions.".into(),
                    "Score each finding by impact: Gamechanger (5), High (3), Medium (2), Low (1).".into(),
                    "Output structured facts as JSON with: category, title, description, source, impact, tags.".into(),
                ],
                max_iterations: 32,
                when_to_spawn: "When you need to deeply understand a codebase before building on it.".into(),
                output_format: "JSON array of KnowledgeFact objects".into(),
            },

            // 2. Skill Synthesizer
            AgentBlueprint {
                id: "agent_skill_synthesizer".into(),
                name: "Skill Synthesizer".into(),
                role: "Transform knowledge into actionable skills".into(),
                description: "Takes extracted knowledge facts and synthesizes them into Buildr-compatible vault skills with steps, verification, and code templates.".into(),
                capabilities: vec![
                    "Read knowledge base files".into(),
                    "Identify patterns suitable for skill extraction".into(),
                    "Generate step-by-step implementation guides".into(),
                    "Write vault-format skill files".into(),
                    "Create verification checklists".into(),
                ],
                tools: vec![
                    ToolAccess { tool_name: "read_file".into(), permission: "ReadOnly".into(), purpose: "Read knowledge base and source".into() },
                    ToolAccess { tool_name: "write_file".into(), permission: "WorkspaceWrite".into(), purpose: "Write skill files".into() },
                    ToolAccess { tool_name: "glob_search".into(), permission: "ReadOnly".into(), purpose: "Find existing skills".into() },
                    ToolAccess { tool_name: "grep_search".into(), permission: "ReadOnly".into(), purpose: "Search patterns".into() },
                ],
                permission_mode: "WorkspaceWrite".into(),
                system_prompt_sections: vec![
                    "You are a Skill Synthesizer. Transform knowledge facts into vault-compatible skills.".into(),
                    "Each skill must have: name, description, trigger, steps, verification, and optionally a code template.".into(),
                    "Skills must be AGNOSTIC — they work for any project type, not just the source project.".into(),
                    "Focus on the WHY and HOW, not project-specific details.".into(),
                ],
                max_iterations: 16,
                when_to_spawn: "After knowledge extraction, to generate reusable skills from findings.".into(),
                output_format: "Vault skill markdown files".into(),
            },

            // 3. Gamechanger Scout
            AgentBlueprint {
                id: "agent_gamechanger_scout".into(),
                name: "Gamechanger Scout".into(),
                role: "Identify transformative patterns that change everything".into(),
                description: "Analyzes codebases and knowledge bases to find the 10% of patterns that deliver 90% of the value. Produces deep analysis documents explaining why each pattern matters and how to apply it.".into(),
                capabilities: vec![
                    "Deep code analysis across multiple files".into(),
                    "Pattern impact assessment".into(),
                    "Cross-reference detection between components".into(),
                    "Web research for prior art and best practices".into(),
                    "Structured gamechanger documentation".into(),
                ],
                tools: vec![
                    ToolAccess { tool_name: "read_file".into(), permission: "ReadOnly".into(), purpose: "Read source and docs".into() },
                    ToolAccess { tool_name: "glob_search".into(), permission: "ReadOnly".into(), purpose: "Find files".into() },
                    ToolAccess { tool_name: "grep_search".into(), permission: "ReadOnly".into(), purpose: "Search patterns".into() },
                    ToolAccess { tool_name: "WebSearch".into(), permission: "ReadOnly".into(), purpose: "Research best practices".into() },
                    ToolAccess { tool_name: "WebFetch".into(), permission: "ReadOnly".into(), purpose: "Fetch documentation".into() },
                ],
                permission_mode: "ReadOnly".into(),
                system_prompt_sections: vec![
                    "You are a Gamechanger Scout. Find the patterns that FUNDAMENTALLY change how systems are built.".into(),
                    "A gamechanger is NOT just a good practice. It is a pattern that eliminates entire problem classes, enables new capabilities, or gives 10x leverage.".into(),
                    "For each gamechanger, document: what it is, why it matters, how to use it, and a code pattern.".into(),
                    "Classify leverage: Problem Eliminator, 10x Multiplier, New Capability, Universal Primitive.".into(),
                ],
                max_iterations: 32,
                when_to_spawn: "When you need to identify the most impactful patterns in a codebase or domain.".into(),
                output_format: "Gamechanger documents with code patterns".into(),
            },

            // 4. Snowball Orchestrator
            AgentBlueprint {
                id: "agent_snowball_orchestrator".into(),
                name: "Snowball Orchestrator".into(),
                role: "Coordinate knowledge extraction pipeline".into(),
                description: "Orchestrates the full extraction pipeline: spawn Deep Code Analyst → feed results to Skill Synthesizer → spawn Gamechanger Scout → compile final output. Each iteration builds on the previous.".into(),
                capabilities: vec![
                    "Spawn and coordinate sub-agents".into(),
                    "Manage knowledge base state".into(),
                    "Track extraction progress".into(),
                    "Merge and deduplicate findings".into(),
                    "Generate final reports".into(),
                ],
                tools: vec![
                    ToolAccess { tool_name: "read_file".into(), permission: "ReadOnly".into(), purpose: "Read state files".into() },
                    ToolAccess { tool_name: "write_file".into(), permission: "WorkspaceWrite".into(), purpose: "Write reports".into() },
                    ToolAccess { tool_name: "glob_search".into(), permission: "ReadOnly".into(), purpose: "Find files".into() },
                    ToolAccess { tool_name: "Agent".into(), permission: "DangerFullAccess".into(), purpose: "Spawn sub-agents".into() },
                    ToolAccess { tool_name: "TodoWrite".into(), permission: "WorkspaceWrite".into(), purpose: "Track progress".into() },
                ],
                permission_mode: "DangerFullAccess".into(),
                system_prompt_sections: vec![
                    "You are the Snowball Orchestrator. You coordinate knowledge extraction across multiple sub-agents.".into(),
                    "Pipeline: Extract → Categorize → Synthesize → Generate.".into(),
                    "Each iteration snowballs: use previous findings to ask deeper questions.".into(),
                    "Track state in knowledge base JSON. Generate final reports when complete.".into(),
                ],
                max_iterations: 64,
                when_to_spawn: "When performing a full knowledge extraction from a codebase.".into(),
                output_format: "Knowledge base JSON + skill files + gamechanger docs + summary report".into(),
            },

            // 5. Pattern Combinator
            AgentBlueprint {
                id: "agent_pattern_combinator".into(),
                name: "Pattern Combinator".into(),
                role: "Find novel combinations of existing patterns".into(),
                description: "Takes existing extracted patterns and finds novel compositions. For example: Generic Runtime + Hook System + Sub-Agent Spawning = Self-Evolving Agent Architecture.".into(),
                capabilities: vec![
                    "Read extracted knowledge and gamechangers".into(),
                    "Identify combinable patterns".into(),
                    "Generate combination hypotheses".into(),
                    "Validate combinations against codebase".into(),
                    "Document novel architectures".into(),
                ],
                tools: vec![
                    ToolAccess { tool_name: "read_file".into(), permission: "ReadOnly".into(), purpose: "Read knowledge base".into() },
                    ToolAccess { tool_name: "grep_search".into(), permission: "ReadOnly".into(), purpose: "Validate against code".into() },
                    ToolAccess { tool_name: "write_file".into(), permission: "WorkspaceWrite".into(), purpose: "Write combination docs".into() },
                ],
                permission_mode: "WorkspaceWrite".into(),
                system_prompt_sections: vec![
                    "You are a Pattern Combinator. Your job is to find NOVEL COMPOSITIONS of known patterns.".into(),
                    "Look for patterns that complement each other. Example: Permission Model + Hook System = auditable, policy-enforced agent.".into(),
                    "Each combination should unlock something none of the individual patterns can do alone.".into(),
                    "Rate each combination: additive (1+1=2), multiplicative (1+1=3), or emergent (1+1=10).".into(),
                ],
                max_iterations: 16,
                when_to_spawn: "After initial extraction, to discover higher-order architectural insights.".into(),
                output_format: "Combination documents with architecture diagrams".into(),
            },
        ]
    }

    /// Generate a combined report of all agent blueprints.
    pub fn report(blueprints: &[AgentBlueprint]) -> String {
        let mut out = String::new();
        out.push_str("# Agent Blueprints — Extracted from Claw Code\n\n");
        out.push_str(&format!(
            "> {} agent specifications generated from architectural analysis.\n\n",
            blueprints.len()
        ));

        out.push_str("## Overview\n\n");
        out.push_str("| Agent | Role | Permission | Max Iter |\n");
        out.push_str("|-------|------|-----------|----------|\n");
        for bp in blueprints {
            out.push_str(&format!(
                "| {} | {} | `{}` | {} |\n",
                bp.name, bp.role, bp.permission_mode, bp.max_iterations
            ));
        }
        out.push('\n');

        for bp in blueprints {
            out.push_str(&bp.to_markdown());
            out.push_str("---\n\n");
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_core_blueprints() {
        let blueprints = AgentGenerator::core_blueprints();
        assert!(blueprints.len() >= 5);
        assert!(blueprints.iter().any(|b| b.name.contains("Deep Code")));
        assert!(blueprints.iter().any(|b| b.name.contains("Snowball")));
    }

    #[test]
    fn test_blueprint_markdown() {
        let blueprints = AgentGenerator::core_blueprints();
        let md = blueprints[0].to_markdown();
        assert!(md.contains("# Agent:"));
        assert!(md.contains("## Tool Access"));
        assert!(md.contains("## Capabilities"));
    }
}
