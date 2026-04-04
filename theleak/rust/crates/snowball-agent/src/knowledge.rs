//! Knowledge base with categorized, scored, cross-referenced facts.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;

// ── Pattern categories from Claw Code analysis ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum PatternCategory {
    AgenticLoop,
    ToolSystem,
    McpProtocol,
    PermissionModel,
    SessionManagement,
    ConfigHierarchy,
    HookSystem,
    SubAgent,
    Streaming,
    ErrorHandling,
    CostTracking,
    TraitSystem,
    DesignPattern,
    Other,
}

impl PatternCategory {
    pub fn display_name(&self) -> &str {
        match self {
            Self::AgenticLoop => "Agentic Loop",
            Self::ToolSystem => "Tool System",
            Self::McpProtocol => "MCP Protocol",
            Self::PermissionModel => "Permission Model",
            Self::SessionManagement => "Session Management",
            Self::ConfigHierarchy => "Configuration Hierarchy",
            Self::HookSystem => "Hook System",
            Self::SubAgent => "Sub-Agent Architecture",
            Self::Streaming => "Streaming & SSE",
            Self::ErrorHandling => "Error Handling",
            Self::CostTracking => "Cost & Usage Tracking",
            Self::TraitSystem => "Trait-Based Extensibility",
            Self::DesignPattern => "Design Pattern",
            Self::Other => "Other",
        }
    }

    pub fn all() -> Vec<PatternCategory> {
        vec![
            Self::AgenticLoop,
            Self::ToolSystem,
            Self::McpProtocol,
            Self::PermissionModel,
            Self::SessionManagement,
            Self::ConfigHierarchy,
            Self::HookSystem,
            Self::SubAgent,
            Self::Streaming,
            Self::ErrorHandling,
            Self::CostTracking,
            Self::TraitSystem,
            Self::DesignPattern,
        ]
    }
}

// ── Impact levels ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum ImpactLevel {
    Low,
    Medium,
    High,
    Gamechanger,
}

impl ImpactLevel {
    pub fn score(&self) -> u32 {
        match self {
            Self::Low => 1,
            Self::Medium => 2,
            Self::High => 3,
            Self::Gamechanger => 5,
        }
    }
}

// ── Knowledge fact ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeFact {
    pub category: PatternCategory,
    pub title: String,
    pub description: String,
    pub source: String,
    pub impact: ImpactLevel,
    pub related_ids: Vec<String>,
    pub tags: Vec<String>,
}

// ── Knowledge base ──────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct KnowledgeBase {
    facts: HashMap<String, KnowledgeFact>,
}

impl KnowledgeBase {
    pub fn new() -> Self {
        Self {
            facts: HashMap::new(),
        }
    }

    pub fn add_fact(&mut self, id: String, fact: KnowledgeFact) {
        self.facts.insert(id, fact);
    }

    /// Add a bidirectional relation between two facts.
    pub fn add_relation(&mut self, id_a: &str, id_b: &str) {
        if let Some(fact) = self.facts.get_mut(id_a) {
            if !fact.related_ids.contains(&id_b.to_string()) {
                fact.related_ids.push(id_b.to_string());
            }
        }
        if let Some(fact) = self.facts.get_mut(id_b) {
            if !fact.related_ids.contains(&id_a.to_string()) {
                fact.related_ids.push(id_a.to_string());
            }
        }
    }

    pub fn get_fact(&self, id: &str) -> Option<&KnowledgeFact> {
        self.facts.get(id)
    }

    pub fn facts(&self) -> &HashMap<String, KnowledgeFact> {
        &self.facts
    }

    pub fn len(&self) -> usize {
        self.facts.len()
    }

    pub fn is_empty(&self) -> bool {
        self.facts.is_empty()
    }

    /// Get all facts in a specific category.
    pub fn by_category(&self, category: &PatternCategory) -> Vec<(&String, &KnowledgeFact)> {
        self.facts
            .iter()
            .filter(|(_, f)| &f.category == category)
            .collect()
    }

    /// Get all facts at or above a specific impact level.
    pub fn by_min_impact(&self, min_impact: &ImpactLevel) -> Vec<(&String, &KnowledgeFact)> {
        self.facts
            .iter()
            .filter(|(_, f)| &f.impact >= min_impact)
            .collect()
    }

    /// Get all gamechangers.
    pub fn gamechangers(&self) -> Vec<(&String, &KnowledgeFact)> {
        self.by_min_impact(&ImpactLevel::Gamechanger)
    }

    /// Get summary statistics.
    pub fn stats(&self) -> KnowledgeStats {
        let mut by_category: HashMap<PatternCategory, usize> = HashMap::new();
        let mut by_impact: HashMap<String, usize> = HashMap::new();
        let mut total_score = 0u32;

        for fact in self.facts.values() {
            *by_category.entry(fact.category.clone()).or_insert(0) += 1;
            *by_impact
                .entry(format!("{:?}", fact.impact))
                .or_insert(0) += 1;
            total_score += fact.impact.score();
        }

        KnowledgeStats {
            total_facts: self.facts.len(),
            by_category,
            by_impact,
            total_score,
            gamechanger_count: self
                .facts
                .values()
                .filter(|f| f.impact == ImpactLevel::Gamechanger)
                .count(),
        }
    }

    /// Merge another knowledge base into this one.
    pub fn merge(&mut self, other: &KnowledgeBase) {
        for (id, fact) in &other.facts {
            if !self.facts.contains_key(id) {
                self.facts.insert(id.clone(), fact.clone());
            }
        }
    }

    pub fn load_from_file(path: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        let mut file = File::open(path)?;
        let mut contents = String::new();
        file.read_to_string(&mut contents)?;
        let facts: HashMap<String, KnowledgeFact> = serde_json::from_str(&contents)?;
        Ok(KnowledgeBase { facts })
    }

    pub fn save_to_file(&self, path: &Path) -> Result<(), Box<dyn std::error::Error>> {
        let json = serde_json::to_string_pretty(&self.facts)?;
        let mut file = File::create(path)?;
        file.write_all(json.as_bytes())?;
        Ok(())
    }
}

// ── Stats ───────────────────────────────────────────────────────────────────

#[derive(Debug)]
pub struct KnowledgeStats {
    pub total_facts: usize,
    pub by_category: HashMap<PatternCategory, usize>,
    pub by_impact: HashMap<String, usize>,
    pub total_score: u32,
    pub gamechanger_count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_knowledge_base_operations() {
        let mut kb = KnowledgeBase::new();
        kb.add_fact(
            "trait_apiclient".into(),
            KnowledgeFact {
                category: PatternCategory::TraitSystem,
                title: "Trait: ApiClient".into(),
                description: "Core API abstraction".into(),
                source: "conversation.rs:10".into(),
                impact: ImpactLevel::Gamechanger,
                related_ids: vec![],
                tags: vec!["trait".into()],
            },
        );
        kb.add_fact(
            "struct_runtime".into(),
            KnowledgeFact {
                category: PatternCategory::AgenticLoop,
                title: "Struct: ConversationRuntime".into(),
                description: "Main agentic loop".into(),
                source: "conversation.rs:50".into(),
                impact: ImpactLevel::Gamechanger,
                related_ids: vec![],
                tags: vec!["struct".into()],
            },
        );

        // Test relation
        kb.add_relation("trait_apiclient", "struct_runtime");
        assert!(kb.get_fact("trait_apiclient").unwrap().related_ids.contains(&"struct_runtime".to_string()));
        assert!(kb.get_fact("struct_runtime").unwrap().related_ids.contains(&"trait_apiclient".to_string()));

        // Test queries
        assert_eq!(kb.gamechangers().len(), 2);
        assert_eq!(kb.by_category(&PatternCategory::TraitSystem).len(), 1);

        let stats = kb.stats();
        assert_eq!(stats.total_facts, 2);
        assert_eq!(stats.gamechanger_count, 2);
    }
}
