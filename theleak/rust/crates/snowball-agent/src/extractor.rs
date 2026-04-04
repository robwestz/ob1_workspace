//! Source code pattern extractor for Rust codebases.
//!
//! Reads .rs files and identifies architectural patterns, traits, structs,
//! design decisions, and reusable building blocks.

use std::fs;
use std::path::{Path, PathBuf};

use crate::knowledge::{KnowledgeBase, KnowledgeFact, PatternCategory, ImpactLevel};

// ── Extracted code element types ────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct TraitDef {
    pub name: String,
    pub methods: Vec<String>,
    pub doc: String,
    pub file: PathBuf,
    pub line: usize,
    pub is_async: bool,
}

#[derive(Debug, Clone)]
pub struct StructDef {
    pub name: String,
    pub fields: Vec<String>,
    pub generics: Option<String>,
    pub doc: String,
    pub file: PathBuf,
    pub line: usize,
}

#[derive(Debug, Clone)]
pub struct EnumDef {
    pub name: String,
    pub variants: Vec<String>,
    pub doc: String,
    pub file: PathBuf,
    pub line: usize,
}

#[derive(Debug, Clone)]
pub struct ImplBlock {
    pub trait_name: Option<String>,
    pub target_type: String,
    pub methods: Vec<String>,
    pub file: PathBuf,
    pub line: usize,
}

#[derive(Debug, Clone)]
pub struct AsyncFlow {
    pub function_name: String,
    pub awaits: Vec<String>,
    pub file: PathBuf,
    pub line: usize,
}

#[derive(Debug, Clone)]
pub struct DesignPattern {
    pub name: String,
    pub description: String,
    pub evidence: Vec<String>,
    pub files: Vec<PathBuf>,
}

// ── Extraction result ───────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct ExtractionResult {
    pub traits: Vec<TraitDef>,
    pub structs: Vec<StructDef>,
    pub enums: Vec<EnumDef>,
    pub impls: Vec<ImplBlock>,
    pub async_flows: Vec<AsyncFlow>,
    pub patterns: Vec<DesignPattern>,
    pub file_count: usize,
    pub total_lines: usize,
}

impl ExtractionResult {
    pub fn new() -> Self {
        Self {
            traits: Vec::new(),
            structs: Vec::new(),
            enums: Vec::new(),
            impls: Vec::new(),
            async_flows: Vec::new(),
            patterns: Vec::new(),
            file_count: 0,
            total_lines: 0,
        }
    }
}

// ── Main extractor ──────────────────────────────────────────────────────────

pub struct SourceExtractor {
    root: PathBuf,
}

impl SourceExtractor {
    pub fn new(root: &Path) -> Self {
        Self {
            root: root.to_path_buf(),
        }
    }

    /// Walk the source tree and extract all patterns.
    pub fn extract(&self) -> ExtractionResult {
        let mut result = ExtractionResult::new();
        let rs_files = self.find_rs_files();
        result.file_count = rs_files.len();

        for file_path in &rs_files {
            if let Ok(content) = fs::read_to_string(file_path) {
                let lines: Vec<&str> = content.lines().collect();
                result.total_lines += lines.len();

                self.extract_traits(&lines, file_path, &mut result);
                self.extract_structs(&lines, file_path, &mut result);
                self.extract_enums(&lines, file_path, &mut result);
                self.extract_impls(&lines, file_path, &mut result);
                self.extract_async_flows(&lines, file_path, &mut result);
            }
        }

        // Detect higher-level design patterns from collected elements
        self.detect_patterns(&mut result);
        result
    }

    /// Convert extraction results into KnowledgeBase facts.
    pub fn to_knowledge_base(&self, result: &ExtractionResult) -> KnowledgeBase {
        let mut kb = KnowledgeBase::new();

        // Add trait-based extensibility patterns
        for trait_def in &result.traits {
            let impact = if trait_def.name.contains("Client")
                || trait_def.name.contains("Executor")
                || trait_def.name.contains("Prompter")
            {
                ImpactLevel::Gamechanger
            } else {
                ImpactLevel::High
            };

            kb.add_fact(
                format!("trait_{}", trait_def.name.to_lowercase()),
                KnowledgeFact {
                    category: PatternCategory::TraitSystem,
                    title: format!("Trait: {}", trait_def.name),
                    description: format!(
                        "Public trait `{}` with methods: [{}]. {}",
                        trait_def.name,
                        trait_def.methods.join(", "),
                        trait_def.doc
                    ),
                    source: format!("{}:{}", trait_def.file.display(), trait_def.line),
                    impact,
                    related_ids: Vec::new(),
                    tags: vec!["trait".into(), "extensibility".into()],
                },
            );
        }

        // Add struct patterns
        for struct_def in &result.structs {
            let impact = self.assess_struct_impact(&struct_def.name);
            let category = self.categorize_struct(&struct_def.name);

            kb.add_fact(
                format!("struct_{}", struct_def.name.to_lowercase()),
                KnowledgeFact {
                    category,
                    title: format!("Struct: {}", struct_def.name),
                    description: format!(
                        "{}{}. Fields: [{}]. {}",
                        struct_def.name,
                        struct_def.generics.as_deref().unwrap_or(""),
                        struct_def.fields.join(", "),
                        struct_def.doc
                    ),
                    source: format!("{}:{}", struct_def.file.display(), struct_def.line),
                    impact,
                    related_ids: Vec::new(),
                    tags: vec!["struct".into()],
                },
            );
        }

        // Add enum patterns
        for enum_def in &result.enums {
            let category = self.categorize_enum(&enum_def.name);
            kb.add_fact(
                format!("enum_{}", enum_def.name.to_lowercase()),
                KnowledgeFact {
                    category,
                    title: format!("Enum: {}", enum_def.name),
                    description: format!(
                        "Enum `{}` with variants: [{}]. {}",
                        enum_def.name,
                        enum_def.variants.join(", "),
                        enum_def.doc
                    ),
                    source: format!("{}:{}", enum_def.file.display(), enum_def.line),
                    impact: ImpactLevel::Medium,
                    related_ids: Vec::new(),
                    tags: vec!["enum".into()],
                },
            );
        }

        // Add detected design patterns as high-impact facts
        for pattern in &result.patterns {
            kb.add_fact(
                format!("pattern_{}", pattern.name.to_lowercase().replace(' ', "_")),
                KnowledgeFact {
                    category: PatternCategory::DesignPattern,
                    title: format!("Pattern: {}", pattern.name),
                    description: format!(
                        "{}. Evidence: [{}]",
                        pattern.description,
                        pattern.evidence.join("; ")
                    ),
                    source: pattern
                        .files
                        .iter()
                        .map(|f| f.display().to_string())
                        .collect::<Vec<_>>()
                        .join(", "),
                    impact: ImpactLevel::Gamechanger,
                    related_ids: Vec::new(),
                    tags: vec!["pattern".into(), "architecture".into()],
                },
            );
        }

        // Cross-reference: link traits to their implementations
        for impl_block in &result.impls {
            if let Some(trait_name) = &impl_block.trait_name {
                let trait_id = format!("trait_{}", trait_name.to_lowercase());
                let struct_id = format!("struct_{}", impl_block.target_type.to_lowercase());
                kb.add_relation(&trait_id, &struct_id);
            }
        }

        kb
    }

    // ── Private helpers ─────────────────────────────────────────────────────

    fn find_rs_files(&self) -> Vec<PathBuf> {
        let mut files = Vec::new();
        self.walk_dir(&self.root, &mut files);
        files.sort();
        files
    }

    fn walk_dir(&self, dir: &Path, files: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Skip target/, .git/, .tmp/
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                if name != "target" && !name.starts_with('.') {
                    self.walk_dir(&path, files);
                }
            } else if path.extension().and_then(|s| s.to_str()) == Some("rs") {
                files.push(path);
            }
        }
    }

    fn extract_traits(&self, lines: &[&str], file: &Path, result: &mut ExtractionResult) {
        let mut i = 0;
        while i < lines.len() {
            let trimmed = lines[i].trim();
            if trimmed.starts_with("pub trait ") || trimmed.starts_with("pub(crate) trait ") {
                let doc = self.collect_doc_comments(lines, i);
                let name = self.extract_name_after(trimmed, "trait ");
                let is_async = trimmed.contains("async");
                let methods = self.collect_trait_methods(lines, i);

                result.traits.push(TraitDef {
                    name,
                    methods,
                    doc,
                    file: file.to_path_buf(),
                    line: i + 1,
                    is_async,
                });
            }
            i += 1;
        }
    }

    fn extract_structs(&self, lines: &[&str], file: &Path, result: &mut ExtractionResult) {
        let mut i = 0;
        while i < lines.len() {
            let trimmed = lines[i].trim();
            if (trimmed.starts_with("pub struct ") || trimmed.starts_with("pub(crate) struct "))
                && !trimmed.contains(";") // skip unit structs
            {
                let doc = self.collect_doc_comments(lines, i);
                let (name, generics) = self.extract_struct_name_and_generics(trimmed);
                let fields = self.collect_struct_fields(lines, i);

                result.structs.push(StructDef {
                    name,
                    fields,
                    generics,
                    doc,
                    file: file.to_path_buf(),
                    line: i + 1,
                });
            }
            i += 1;
        }
    }

    fn extract_enums(&self, lines: &[&str], file: &Path, result: &mut ExtractionResult) {
        let mut i = 0;
        while i < lines.len() {
            let trimmed = lines[i].trim();
            if trimmed.starts_with("pub enum ") || trimmed.starts_with("pub(crate) enum ") {
                let doc = self.collect_doc_comments(lines, i);
                let name = self.extract_name_after(trimmed, "enum ");
                let variants = self.collect_enum_variants(lines, i);

                result.enums.push(EnumDef {
                    name,
                    variants,
                    doc,
                    file: file.to_path_buf(),
                    line: i + 1,
                });
            }
            i += 1;
        }
    }

    fn extract_impls(&self, lines: &[&str], file: &Path, result: &mut ExtractionResult) {
        let mut i = 0;
        while i < lines.len() {
            let trimmed = lines[i].trim();
            if trimmed.starts_with("impl ") || trimmed.starts_with("impl<") {
                let (trait_name, target_type) = self.parse_impl_header(trimmed);
                let methods = self.collect_impl_methods(lines, i);

                result.impls.push(ImplBlock {
                    trait_name,
                    target_type,
                    methods,
                    file: file.to_path_buf(),
                    line: i + 1,
                });
            }
            i += 1;
        }
    }

    fn extract_async_flows(&self, lines: &[&str], file: &Path, result: &mut ExtractionResult) {
        let mut i = 0;
        while i < lines.len() {
            let trimmed = lines[i].trim();
            if trimmed.contains("async fn ") && (trimmed.starts_with("pub") || trimmed.starts_with("async")) {
                let name = self.extract_name_after(trimmed, "fn ");
                let awaits = self.collect_awaits(lines, i);
                if !awaits.is_empty() {
                    result.async_flows.push(AsyncFlow {
                        function_name: name,
                        awaits,
                        file: file.to_path_buf(),
                        line: i + 1,
                    });
                }
            }
            i += 1;
        }
    }

    fn detect_patterns(&self, result: &mut ExtractionResult) {
        // Pattern: Generic trait-based composition
        let generic_structs: Vec<_> = result
            .structs
            .iter()
            .filter(|s| s.generics.is_some())
            .collect();
        if !generic_structs.is_empty() {
            let trait_names: Vec<_> = result.traits.iter().map(|t| t.name.clone()).collect();
            let evidence: Vec<_> = generic_structs
                .iter()
                .filter(|s| {
                    let g = s.generics.as_deref().unwrap_or("");
                    trait_names.iter().any(|t| g.contains(t.as_str()))
                })
                .map(|s| {
                    format!(
                        "{}{} in {}",
                        s.name,
                        s.generics.as_deref().unwrap_or(""),
                        s.file.display()
                    )
                })
                .collect();
            if !evidence.is_empty() {
                result.patterns.push(DesignPattern {
                    name: "Generic Trait-Based Composition".into(),
                    description: "Structs parameterized by trait bounds enable pluggable implementations. Decouples core logic from specific providers.".into(),
                    evidence,
                    files: generic_structs.iter().map(|s| s.file.clone()).collect(),
                });
            }
        }

        // Pattern: Builder pattern
        let builder_evidence: Vec<_> = result
            .impls
            .iter()
            .filter(|i| {
                i.methods
                    .iter()
                    .any(|m| m.starts_with("with_") || m == "build" || m == "new")
            })
            .map(|i| {
                format!(
                    "{} has builder methods: [{}]",
                    i.target_type,
                    i.methods
                        .iter()
                        .filter(|m| m.starts_with("with_") || m.as_str() == "build")
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            })
            .filter(|e| e.contains("with_"))
            .collect();
        if !builder_evidence.is_empty() {
            result.patterns.push(DesignPattern {
                name: "Builder Pattern".into(),
                description: "Fluent builder APIs via with_*() methods for complex struct configuration.".into(),
                evidence: builder_evidence,
                files: Vec::new(),
            });
        }

        // Pattern: Permission escalation hierarchy
        let has_permission_enum = result
            .enums
            .iter()
            .any(|e| e.name.contains("Permission") || e.name.contains("Access"));
        let has_policy_struct = result
            .structs
            .iter()
            .any(|s| s.name.contains("Policy") || s.name.contains("Permission"));
        if has_permission_enum && has_policy_struct {
            result.patterns.push(DesignPattern {
                name: "Permission Escalation Hierarchy".into(),
                description: "Ordered permission modes with per-tool requirements and escalation prompts. Clean separation of authorization from execution.".into(),
                evidence: vec![
                    "PermissionMode enum with ordered variants".into(),
                    "PermissionPolicy struct with tool_requirements map".into(),
                ],
                files: Vec::new(),
            });
        }

        // Pattern: Event-driven streaming
        let has_sse = result.structs.iter().any(|s| s.name.contains("Sse") || s.name.contains("Stream"));
        let has_events = result.enums.iter().any(|e| e.name.contains("Event") || e.name.contains("Stream"));
        if has_sse && has_events {
            result.patterns.push(DesignPattern {
                name: "Event-Driven Streaming".into(),
                description: "SSE parser with incremental buffering and typed event dispatch. Handles chunked data arrival and multi-frame batching.".into(),
                evidence: vec![
                    "SseParser with push/finish lifecycle".into(),
                    "StreamEvent enum with typed variants".into(),
                ],
                files: Vec::new(),
            });
        }

        // Pattern: Hook lifecycle
        let has_hooks = result.structs.iter().any(|s| s.name.contains("Hook"));
        if has_hooks {
            result.patterns.push(DesignPattern {
                name: "Shell-Based Hook Lifecycle".into(),
                description: "Pre/post tool hooks as shell commands. JSON payload on stdin, exit codes control flow (0=allow, 2=deny). Universal extension point.".into(),
                evidence: vec![
                    "HookRunner struct with pre/post tool execution".into(),
                    "Exit code semantics: 0=allow, 1=warn, 2=deny".into(),
                ],
                files: Vec::new(),
            });
        }

        // Pattern: Session snapshot with embedded usage
        let has_session = result.structs.iter().any(|s| s.name == "Session");
        let has_usage = result.structs.iter().any(|s| s.name.contains("Usage"));
        if has_session && has_usage {
            result.patterns.push(DesignPattern {
                name: "Session Snapshot with Embedded Usage".into(),
                description: "Complete conversation state in one file, including token usage per message. Enables resume, debugging, cost analysis, and audit trails.".into(),
                evidence: vec![
                    "Session struct with messages + version".into(),
                    "UsageTracker reconstructed from embedded usage fields".into(),
                ],
                files: Vec::new(),
            });
        }

        // Pattern: Scoped configuration merging
        let has_config = result.structs.iter().any(|s| s.name.contains("Config") && s.fields.len() > 3);
        let has_scope_enum = result.enums.iter().any(|e| e.name.contains("Scope") || e.variants.iter().any(|v| v.contains("User") && e.variants.iter().any(|v2| v2.contains("Project"))));
        if has_config && has_scope_enum {
            result.patterns.push(DesignPattern {
                name: "Scoped Configuration Merging".into(),
                description: "Multi-tier config hierarchy (User → Project → Local) with deep merge, deduplication, and scope tracking for debugging.".into(),
                evidence: vec![
                    "ConfigLoader with hierarchical discovery".into(),
                    "Scope enum tracking config origin".into(),
                ],
                files: Vec::new(),
            });
        }

        // Pattern: Sub-agent spawning with tool restriction
        let has_agent_output = result.structs.iter().any(|s| s.name.contains("Agent") && s.fields.iter().any(|f| f.contains("status")));
        if has_agent_output {
            result.patterns.push(DesignPattern {
                name: "Sub-Agent Spawning with Tool Restriction".into(),
                description: "Thread-spawned sub-agents with per-type tool allowlists, manifest tracking, and isolated permission policies. Enables safe parallel work.".into(),
                evidence: vec![
                    "AgentOutput manifest with lifecycle tracking".into(),
                    "allowed_tools_for_subagent() per agent type".into(),
                    "SubagentToolExecutor with filtered access".into(),
                ],
                files: Vec::new(),
            });
        }

        // Pattern: Auto-compaction
        let compaction_methods: Vec<_> = result
            .impls
            .iter()
            .filter(|i| {
                i.methods
                    .iter()
                    .any(|m| m.contains("compact") || m.contains("summarize"))
            })
            .collect();
        if !compaction_methods.is_empty() {
            result.patterns.push(DesignPattern {
                name: "Auto-Compaction with Context Preservation".into(),
                description: "Automatically detects token overflow, summarizes old messages, preserves recent context. Enables infinite conversation length.".into(),
                evidence: vec![
                    "Token threshold trigger for compaction".into(),
                    "Summary generation preserving key context".into(),
                    "Recent message preservation (last 4)".into(),
                ],
                files: Vec::new(),
            });
        }
    }

    // ── Parsing helpers ─────────────────────────────────────────────────────

    fn collect_doc_comments(&self, lines: &[&str], def_line: usize) -> String {
        let mut docs = Vec::new();
        let mut i = def_line.saturating_sub(1);
        loop {
            let trimmed = lines[i].trim();
            if trimmed.starts_with("///") || trimmed.starts_with("//!") {
                docs.push(trimmed.trim_start_matches("///").trim_start_matches("//!").trim());
            } else if !trimmed.starts_with("#[") {
                break;
            }
            if i == 0 {
                break;
            }
            i -= 1;
        }
        docs.reverse();
        docs.join(" ")
    }

    fn extract_name_after(&self, line: &str, keyword: &str) -> String {
        let after = line.split(keyword).nth(1).unwrap_or("");
        after
            .split(|c: char| !c.is_alphanumeric() && c != '_')
            .next()
            .unwrap_or("")
            .to_string()
    }

    fn extract_struct_name_and_generics(&self, line: &str) -> (String, Option<String>) {
        let after = line.split("struct ").nth(1).unwrap_or("");
        let name: String = after
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        let rest = &after[name.len()..];
        let generics = if rest.starts_with('<') {
            let mut depth = 0;
            let gen: String = rest
                .chars()
                .take_while(|c| {
                    if *c == '<' { depth += 1; }
                    if *c == '>' { depth -= 1; }
                    depth > 0 || *c == '>'
                })
                .collect();
            if gen.is_empty() { None } else { Some(gen) }
        } else {
            None
        };
        (name, generics)
    }

    fn collect_trait_methods(&self, lines: &[&str], start: usize) -> Vec<String> {
        let mut methods = Vec::new();
        let mut depth = 0;
        for line in &lines[start..] {
            depth += line.matches('{').count() as i32;
            depth -= line.matches('}').count() as i32;
            let trimmed = line.trim();
            if trimmed.contains("fn ") && (trimmed.starts_with("fn ") || trimmed.starts_with("async fn ")) {
                methods.push(self.extract_name_after(trimmed, "fn "));
            }
            if depth <= 0 && methods.len() > 0 {
                break;
            }
        }
        methods
    }

    fn collect_struct_fields(&self, lines: &[&str], start: usize) -> Vec<String> {
        let mut fields = Vec::new();
        let mut depth = 0;
        for line in &lines[start..] {
            depth += line.matches('{').count() as i32;
            depth -= line.matches('}').count() as i32;
            let trimmed = line.trim();
            if depth == 1 && trimmed.contains(':') && !trimmed.starts_with("//") {
                let field_name: String = trimmed
                    .trim_start_matches("pub ")
                    .trim_start_matches("pub(crate) ")
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                if !field_name.is_empty() {
                    fields.push(field_name);
                }
            }
            if depth <= 0 && !fields.is_empty() {
                break;
            }
        }
        fields
    }

    fn collect_enum_variants(&self, lines: &[&str], start: usize) -> Vec<String> {
        let mut variants = Vec::new();
        let mut depth = 0;
        for line in &lines[start..] {
            depth += line.matches('{').count() as i32;
            depth -= line.matches('}').count() as i32;
            let trimmed = line.trim();
            if depth == 1
                && !trimmed.is_empty()
                && !trimmed.starts_with("//")
                && !trimmed.starts_with('#')
                && !trimmed.starts_with('{')
            {
                let variant: String = trimmed
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                if !variant.is_empty() {
                    variants.push(variant);
                }
            }
            if depth <= 0 && !variants.is_empty() {
                break;
            }
        }
        variants
    }

    fn collect_impl_methods(&self, lines: &[&str], start: usize) -> Vec<String> {
        let mut methods = Vec::new();
        let mut depth = 0;
        for line in &lines[start..] {
            depth += line.matches('{').count() as i32;
            depth -= line.matches('}').count() as i32;
            let trimmed = line.trim();
            if depth >= 1 && trimmed.contains("fn ") {
                methods.push(self.extract_name_after(trimmed, "fn "));
            }
            if depth <= 0 && !methods.is_empty() {
                break;
            }
        }
        methods
    }

    fn collect_awaits(&self, lines: &[&str], start: usize) -> Vec<String> {
        let mut awaits = Vec::new();
        let mut depth = 0;
        for line in &lines[start..] {
            depth += line.matches('{').count() as i32;
            depth -= line.matches('}').count() as i32;
            if line.contains(".await") {
                let trimmed = line.trim();
                awaits.push(trimmed.to_string());
            }
            if depth <= 0 && depth != 0 {
                break;
            }
            // Stop at next function definition
            if depth <= 0 && !awaits.is_empty() {
                break;
            }
        }
        awaits
    }

    fn parse_impl_header(&self, line: &str) -> (Option<String>, String) {
        // impl Trait for Type
        if line.contains(" for ") {
            let parts: Vec<&str> = line.split(" for ").collect();
            let trait_part = parts[0].trim().trim_start_matches("impl").trim_start_matches('<').split('>').last().unwrap_or("").trim();
            let trait_name = trait_part
                .split(|c: char| !c.is_alphanumeric() && c != '_')
                .next()
                .unwrap_or("")
                .to_string();
            let type_part = parts.get(1).unwrap_or(&"");
            let type_name = type_part
                .split(|c: char| !c.is_alphanumeric() && c != '_')
                .next()
                .unwrap_or("")
                .to_string();
            (Some(trait_name), type_name)
        } else {
            // impl Type
            let after = line.trim().trim_start_matches("impl").trim();
            // Skip generics
            let after = if after.starts_with('<') {
                let mut depth = 0;
                let rest: String = after
                    .chars()
                    .skip_while(|c| {
                        if *c == '<' { depth += 1; }
                        if *c == '>' { depth -= 1; }
                        depth > 0
                    })
                    .collect();
                rest.trim_start_matches('>').trim().to_string()
            } else {
                after.to_string()
            };
            let type_name = after
                .split(|c: char| !c.is_alphanumeric() && c != '_')
                .next()
                .unwrap_or("")
                .to_string();
            (None, type_name)
        }
    }

    fn assess_struct_impact(&self, name: &str) -> ImpactLevel {
        match name {
            n if n.contains("Runtime") => ImpactLevel::Gamechanger,
            n if n.contains("Session") => ImpactLevel::High,
            n if n.contains("Config") => ImpactLevel::High,
            n if n.contains("Permission") || n.contains("Policy") => ImpactLevel::High,
            n if n.contains("Mcp") || n.contains("MCP") => ImpactLevel::High,
            n if n.contains("Hook") => ImpactLevel::High,
            n if n.contains("Tool") => ImpactLevel::High,
            n if n.contains("Agent") => ImpactLevel::Gamechanger,
            _ => ImpactLevel::Medium,
        }
    }

    fn categorize_struct(&self, name: &str) -> PatternCategory {
        match name {
            n if n.contains("Runtime") || n.contains("Conversation") => PatternCategory::AgenticLoop,
            n if n.contains("Tool") || n.contains("Spec") => PatternCategory::ToolSystem,
            n if n.contains("Mcp") || n.contains("MCP") => PatternCategory::McpProtocol,
            n if n.contains("Permission") || n.contains("Policy") => PatternCategory::PermissionModel,
            n if n.contains("Session") || n.contains("Compact") => PatternCategory::SessionManagement,
            n if n.contains("Config") => PatternCategory::ConfigHierarchy,
            n if n.contains("Hook") => PatternCategory::HookSystem,
            n if n.contains("Agent") => PatternCategory::SubAgent,
            n if n.contains("Sse") || n.contains("Stream") => PatternCategory::Streaming,
            n if n.contains("Error") || n.contains("Retry") => PatternCategory::ErrorHandling,
            n if n.contains("Usage") || n.contains("Cost") => PatternCategory::CostTracking,
            _ => PatternCategory::Other,
        }
    }

    fn categorize_enum(&self, name: &str) -> PatternCategory {
        self.categorize_struct(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_extract_from_sample() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("sample.rs");
        fs::write(
            &file,
            r#"
/// A client trait for API calls.
pub trait ApiClient {
    fn stream(&mut self) -> Result<Vec<Event>, Error>;
}

pub struct ConversationRuntime<C: ApiClient, T: ToolExecutor> {
    session: Session,
    api_client: C,
    tool_executor: T,
}

pub enum PermissionMode {
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}
"#,
        )
        .unwrap();

        let extractor = SourceExtractor::new(dir.path());
        let result = extractor.extract();

        assert_eq!(result.traits.len(), 1);
        assert_eq!(result.traits[0].name, "ApiClient");
        assert_eq!(result.structs.len(), 1);
        assert_eq!(result.structs[0].name, "ConversationRuntime");
        assert!(result.structs[0].generics.is_some());
        assert_eq!(result.enums.len(), 1);
        assert_eq!(result.enums[0].name, "PermissionMode");
        assert!(result.enums[0].variants.len() >= 3);
    }
}
