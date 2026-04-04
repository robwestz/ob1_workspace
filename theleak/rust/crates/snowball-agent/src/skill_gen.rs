//! Skill generator — transforms extracted knowledge into Buildr-compatible skills.
//!
//! Each generated skill follows the vault/skills/ format with frontmatter,
//! body, and verification steps.

use crate::knowledge::{ImpactLevel, KnowledgeBase, PatternCategory};

// ── Generated skill ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct GeneratedSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: PatternCategory,
    pub trigger: String,
    pub steps: Vec<String>,
    pub verification: Vec<String>,
    pub code_template: String,
    pub source_facts: Vec<String>,
}

impl GeneratedSkill {
    /// Render as a Buildr vault skill markdown file.
    pub fn to_vault_markdown(&self) -> String {
        let mut out = String::new();
        out.push_str("---\n");
        out.push_str(&format!("name: {}\n", self.name));
        out.push_str(&format!("description: {}\n", self.description));
        out.push_str(&format!("category: {}\n", self.category.display_name()));
        out.push_str(&format!("trigger: {}\n", self.trigger));
        out.push_str("type: skill\n");
        out.push_str("agnostic: true\n");
        out.push_str("---\n\n");
        out.push_str(&format!("# {}\n\n", self.name));
        out.push_str(&format!("{}\n\n", self.description));

        out.push_str("## When to Use\n\n");
        out.push_str(&format!("{}\n\n", self.trigger));

        out.push_str("## Steps\n\n");
        for (i, step) in self.steps.iter().enumerate() {
            out.push_str(&format!("{}. {}\n", i + 1, step));
        }
        out.push('\n');

        if !self.code_template.is_empty() {
            out.push_str("## Code Template\n\n");
            out.push_str(&format!("```rust\n{}\n```\n\n", self.code_template));
        }

        out.push_str("## Verification\n\n");
        for v in &self.verification {
            out.push_str(&format!("- [ ] {}\n", v));
        }
        out.push('\n');

        out
    }
}

// ── Skill generator ─────────────────────────────────────────────────────────

pub struct SkillGenerator;

impl SkillGenerator {
    /// Generate skills from a knowledge base.
    pub fn generate(kb: &KnowledgeBase) -> Vec<GeneratedSkill> {
        let mut skills = Vec::new();

        // Always generate the core skills derived from deep analysis
        skills.extend(Self::core_skills());

        // Generate additional skills from high-impact facts
        skills.extend(Self::skills_from_patterns(kb));

        skills
    }

    /// Core skills extracted from Claw Code architecture.
    fn core_skills() -> Vec<GeneratedSkill> {
        vec![
            GeneratedSkill {
                id: "skill_build_agentic_loop".into(),
                name: "Build Agentic Loop".into(),
                description: "Construct a trait-generic agentic loop that handles multi-turn conversation with tool execution, permission checking, and automatic compaction.".into(),
                category: PatternCategory::AgenticLoop,
                trigger: "When building an AI agent that needs to execute tools across multiple turns.".into(),
                steps: vec![
                    "Define ApiClient trait with stream() method returning typed events.".into(),
                    "Define ToolExecutor trait with execute(name, input) → Result<String>.".into(),
                    "Create ConversationRuntime<C: ApiClient, T: ToolExecutor> struct.".into(),
                    "Implement run_turn(): loop { call API → parse events → execute tools → check compaction }.".into(),
                    "Add iteration limit safety (max_iterations field).".into(),
                    "Add hook runner for pre/post tool lifecycle.".into(),
                    "Add auto-compaction when input_tokens > threshold.".into(),
                    "Return TurnSummary with usage, iterations, and messages.".into(),
                ],
                verification: vec![
                    "Runtime compiles with mock ApiClient and ToolExecutor.".into(),
                    "Tool execution loop terminates when no tool_use blocks returned.".into(),
                    "Permission denial produces error result without executing tool.".into(),
                    "Auto-compaction triggers at threshold and preserves recent messages.".into(),
                ],
                code_template: r#"pub struct ConversationRuntime<C: ApiClient, T: ToolExecutor> {
    session: Session,
    api_client: C,
    tool_executor: T,
    permission_policy: PermissionPolicy,
    system_prompt: Vec<String>,
    max_iterations: usize,
    usage_tracker: UsageTracker,
    hook_runner: HookRunner,
    auto_compaction_threshold: u32,
}

impl<C: ApiClient, T: ToolExecutor> ConversationRuntime<C, T> {
    pub fn run_turn(&mut self, input: String) -> Result<TurnSummary, RuntimeError> {
        self.session.add_user_message(input);
        for _ in 0..self.max_iterations {
            let events = self.api_client.stream(self.build_request())?;
            let msg = self.aggregate_events(events);
            self.session.add(msg.clone());
            let tool_uses = msg.tool_use_blocks();
            if tool_uses.is_empty() { break; }
            for tool_use in tool_uses {
                self.execute_with_hooks(&tool_use)?;
            }
        }
        self.maybe_compact();
        Ok(self.build_summary())
    }
}"#.into(),
                source_facts: vec!["struct_conversationruntime".into(), "trait_apiclient".into()],
            },

            GeneratedSkill {
                id: "skill_tool_permission_system".into(),
                name: "Implement Tool Permission System".into(),
                description: "Build a graduated permission model where each tool declares its minimum required access level and a policy enforces authorization before execution.".into(),
                category: PatternCategory::PermissionModel,
                trigger: "When building an agent that needs to restrict tool access based on context (sub-agents, read-only mode, etc.).".into(),
                steps: vec![
                    "Define PermissionMode as an ordered enum (ReadOnly < WorkspaceWrite < DangerFullAccess).".into(),
                    "Attach required_permission to each ToolSpec.".into(),
                    "Create PermissionPolicy with active_mode + per-tool requirements map.".into(),
                    "Implement authorize(): check active_mode >= required, or escalate via prompter.".into(),
                    "Integrate into agentic loop: check BEFORE hook execution and tool execution.".into(),
                    "For sub-agents: create restricted policies with appropriate mode.".into(),
                ],
                verification: vec![
                    "ReadOnly mode blocks bash and write operations.".into(),
                    "WorkspaceWrite allows file edits but blocks bash.".into(),
                    "Per-tool override works (e.g., allow specific bash for sub-agent).".into(),
                    "Denial produces clean error message in tool result.".into(),
                ],
                code_template: r#"#[derive(PartialEq, Eq, PartialOrd, Ord)]
pub enum PermissionMode { ReadOnly, WorkspaceWrite, DangerFullAccess }

pub struct ToolSpec {
    pub name: &'static str,
    pub required_permission: PermissionMode,
    pub input_schema: Value,
}

pub struct PermissionPolicy {
    active_mode: PermissionMode,
    tool_requirements: BTreeMap<String, PermissionMode>,
}

impl PermissionPolicy {
    pub fn authorize(&self, tool: &str) -> PermissionOutcome {
        let required = self.tool_requirements.get(tool)
            .unwrap_or(&PermissionMode::ReadOnly);
        if self.active_mode >= *required { Allow } else { Deny }
    }
}"#.into(),
                source_facts: vec!["enum_permissionmode".into(), "struct_permissionpolicy".into()],
            },

            GeneratedSkill {
                id: "skill_mcp_client".into(),
                name: "Build MCP Client".into(),
                description: "Implement a Model Context Protocol client that discovers and executes tools from external servers via multiple transports.".into(),
                category: PatternCategory::McpProtocol,
                trigger: "When your agent needs to connect to external tool servers (local CLI, remote API, WebSocket).".into(),
                steps: vec![
                    "Define McpClientTransport enum with variants for each transport type.".into(),
                    "Implement JSON-RPC 2.0 request/response protocol.".into(),
                    "Create McpServerManager that bootstraps servers from config.".into(),
                    "Send initialize request → get server info + protocol version.".into(),
                    "Call tools/list with pagination to discover available tools.".into(),
                    "Normalize tool names: mcp__<server>__<tool>.".into(),
                    "Implement call_tool() that routes to the correct server.".into(),
                    "Handle server lifecycle (start, health check, restart, stop).".into(),
                ],
                verification: vec![
                    "Stdio transport spawns child process and communicates via stdin/stdout.".into(),
                    "Tool discovery returns normalized tool names with schemas.".into(),
                    "Tool execution returns results or errors.".into(),
                    "Server restart works after crash.".into(),
                ],
                code_template: String::new(),
                source_facts: vec!["struct_mcpservermanager".into(), "enum_mcpclienttransport".into()],
            },

            GeneratedSkill {
                id: "skill_session_management".into(),
                name: "Build Session Persistence".into(),
                description: "Implement session serialization with embedded usage tracking, supporting save/load/resume with full conversation history and cost reconstruction.".into(),
                category: PatternCategory::SessionManagement,
                trigger: "When your agent needs to persist conversations across restarts or enable resume functionality.".into(),
                steps: vec![
                    "Define Session struct with version + messages array.".into(),
                    "Embed TokenUsage in each ConversationMessage.".into(),
                    "Implement save_to_path() with JSON serialization.".into(),
                    "Implement load_from_path() with deserialization.".into(),
                    "Add UsageTracker::from_session() to reconstruct cost data.".into(),
                    "Add version field for future schema migration.".into(),
                    "Support auto-compaction with summary preservation.".into(),
                ],
                verification: vec![
                    "Save → Load round-trip preserves all messages.".into(),
                    "Usage tracker accurately reconstructed from loaded session.".into(),
                    "Version field present for migration support.".into(),
                ],
                code_template: String::new(),
                source_facts: vec!["struct_session".into(), "struct_usagetracker".into()],
            },

            GeneratedSkill {
                id: "skill_hook_system".into(),
                name: "Implement Hook System".into(),
                description: "Build a pre/post tool hook system using shell commands. Hooks receive JSON payloads and control flow via exit codes.".into(),
                category: PatternCategory::HookSystem,
                trigger: "When agents need extensible behavior policies without code changes (audit, guardrails, transformation).".into(),
                steps: vec![
                    "Define HookConfig with pre_tool_use[] and post_tool_use[] shell commands.".into(),
                    "Create JSON payload: hook_event_name, tool_name, tool_input, tool_output.".into(),
                    "Spawn shell command, pipe JSON to stdin, set env vars.".into(),
                    "Interpret exit codes: 0=allow, 1=warn, 2=deny.".into(),
                    "Collect stdout as feedback, merge into tool result.".into(),
                    "Run pre-hooks after permission check but before execution.".into(),
                    "Run post-hooks after execution, can mark result as error.".into(),
                ],
                verification: vec![
                    "Pre-hook with exit 2 prevents tool execution.".into(),
                    "Post-hook feedback appears in tool result.".into(),
                    "Hooks receive correct JSON payload on stdin.".into(),
                    "Hook timeout doesn't hang the agent.".into(),
                ],
                code_template: String::new(),
                source_facts: vec!["struct_hookrunner".into()],
            },

            GeneratedSkill {
                id: "skill_sub_agent_spawning".into(),
                name: "Spawn Permission-Scoped Sub-Agents".into(),
                description: "Spawn background sub-agents with restricted tool access, manifest tracking, and isolated conversation contexts.".into(),
                category: PatternCategory::SubAgent,
                trigger: "When a task can be parallelized or delegated to a specialized agent with limited permissions.".into(),
                steps: vec![
                    "Define agent types with tool allowlists (Explore, Plan, Verification, etc.).".into(),
                    "Create SubagentToolExecutor that filters by allowed set.".into(),
                    "Build AgentOutput manifest: id, name, status, timestamps, output file.".into(),
                    "Spawn agent in thread with its own ConversationRuntime.".into(),
                    "Track lifecycle: running → completed/failed.".into(),
                    "Persist manifest as JSON + output as markdown.".into(),
                    "Set max_iterations on sub-agent runtime for safety.".into(),
                ],
                verification: vec![
                    "Sub-agent cannot execute tools outside its allowlist.".into(),
                    "Manifest correctly tracks lifecycle transitions.".into(),
                    "Sub-agent panic is caught and recorded as failure.".into(),
                    "Max iterations prevent infinite loops.".into(),
                ],
                code_template: String::new(),
                source_facts: vec!["struct_agentoutput".into()],
            },

            GeneratedSkill {
                id: "skill_streaming_renderer".into(),
                name: "Build Streaming Markdown Renderer".into(),
                description: "Render streaming LLM output as formatted markdown in the terminal, with fence-aware buffering to prevent broken code blocks.".into(),
                category: PatternCategory::Streaming,
                trigger: "When building a CLI that streams LLM output and needs clean terminal rendering.".into(),
                steps: vec![
                    "Implement SSE parser with incremental buffering (push/finish lifecycle).".into(),
                    "Create MarkdownStreamState with pending buffer.".into(),
                    "Track code fence depth to detect inside/outside code blocks.".into(),
                    "Only flush at safe boundaries (paragraph breaks outside fences).".into(),
                    "Use pulldown-cmark for markdown parsing, syntect for syntax highlighting.".into(),
                    "Render with ANSI escape codes for colors, bold, italic, underline.".into(),
                    "Add spinner animation for tool execution feedback.".into(),
                ],
                verification: vec![
                    "Code blocks never rendered incomplete.".into(),
                    "Syntax highlighting works for common languages.".into(),
                    "Spinner doesn't leave artifacts in terminal.".into(),
                    "Streaming output progressive (not batched to end).".into(),
                ],
                code_template: String::new(),
                source_facts: vec!["struct_markdownstreamstate".into(), "struct_sseparser".into()],
            },

            GeneratedSkill {
                id: "skill_config_hierarchy".into(),
                name: "Build Scoped Configuration System".into(),
                description: "Implement a multi-tier configuration system with deep merge, scope tracking, and MCP server deduplication.".into(),
                category: PatternCategory::ConfigHierarchy,
                trigger: "When your tool/agent needs layered config (user defaults, project settings, local overrides).".into(),
                steps: vec![
                    "Define ConfigScope enum (User, Project, Local).".into(),
                    "Define discovery paths per scope.".into(),
                    "Load JSON files in order, tracking source scope.".into(),
                    "Deep merge objects: later scopes override earlier.".into(),
                    "Special handling for MCP servers: deduplicate by name, last scope wins.".into(),
                    "Parse feature subconfigs from merged object.".into(),
                    "Provide debugging info: which scope provided which setting.".into(),
                ],
                verification: vec![
                    "Later scope overrides earlier for same key.".into(),
                    "MCP servers deduplicated correctly.".into(),
                    "Missing config files don't cause errors.".into(),
                    "Scope tracking works for debugging.".into(),
                ],
                code_template: String::new(),
                source_facts: vec!["struct_runtimeconfig".into()],
            },
        ]
    }

    /// Generate skills from detected patterns in the knowledge base.
    fn skills_from_patterns(kb: &KnowledgeBase) -> Vec<GeneratedSkill> {
        let mut skills = Vec::new();
        let core_ids: Vec<String> = Self::core_skills()
            .iter()
            .flat_map(|s| s.source_facts.clone())
            .collect();

        // Find high-impact patterns not already covered
        let high_impact = kb.by_min_impact(&ImpactLevel::High);
        for (id, fact) in high_impact {
            if core_ids.contains(id) {
                continue;
            }
            if fact.category == PatternCategory::DesignPattern {
                skills.push(GeneratedSkill {
                    id: format!("skill_detected_{}", id),
                    name: format!("Apply {}", fact.title),
                    description: fact.description.clone(),
                    category: fact.category.clone(),
                    trigger: format!("When building systems that need: {}", fact.title.to_lowercase()),
                    steps: vec![
                        "Study the pattern in the source code.".into(),
                        "Identify how it maps to your project.".into(),
                        "Implement the core abstraction.".into(),
                        "Add tests for the pattern.".into(),
                    ],
                    verification: vec!["Pattern implemented and tested.".into()],
                    code_template: String::new(),
                    source_facts: vec![id.clone()],
                });
            }
        }

        skills
    }

    /// Generate a combined report of all skills.
    pub fn report(skills: &[GeneratedSkill]) -> String {
        let mut out = String::new();
        out.push_str("# Generated Skills — Extracted from Claw Code\n\n");
        out.push_str(&format!("> {} skills generated from architectural analysis.\n\n", skills.len()));

        // Group by category
        let mut by_category: std::collections::HashMap<String, Vec<&GeneratedSkill>> =
            std::collections::HashMap::new();
        for skill in skills {
            by_category
                .entry(skill.category.display_name().to_string())
                .or_default()
                .push(skill);
        }

        for (category, cat_skills) in &by_category {
            out.push_str(&format!("## {}\n\n", category));
            for skill in cat_skills {
                out.push_str(&format!("### {}\n\n", skill.name));
                out.push_str(&format!("{}\n\n", skill.description));
                out.push_str(&format!("**Trigger:** {}\n\n", skill.trigger));
            }
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_core_skills() {
        let skills = SkillGenerator::core_skills();
        assert!(skills.len() >= 8);
        assert!(skills.iter().any(|s| s.name.contains("Agentic Loop")));
        assert!(skills.iter().any(|s| s.name.contains("Permission")));
    }

    #[test]
    fn test_vault_markdown() {
        let skills = SkillGenerator::core_skills();
        let md = skills[0].to_vault_markdown();
        assert!(md.contains("---"));
        assert!(md.contains("name:"));
        assert!(md.contains("## Steps"));
        assert!(md.contains("## Verification"));
    }
}
