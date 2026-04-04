//! Snowball Agent CLI — run knowledge extraction on a Rust codebase.

use snowball_agent::SnowballAgent;
use std::path::PathBuf;

fn main() {
    let source_root = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            // Default: analyze the sibling crates in this workspace
            let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            manifest.parent().unwrap().to_path_buf()
        });

    let output_dir = std::env::args()
        .nth(2)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            manifest
                .parent()
                .unwrap()
                .parent()
                .unwrap()
                .join("extraction")
        });

    println!("Snowball Agent v0.2.0");
    println!("Source:  {}", source_root.display());
    println!("Output:  {}", output_dir.display());
    println!();

    let mut agent = SnowballAgent::new(&source_root);

    // Run extraction iterations
    for i in 0..3 {
        let result = agent.iterate();
        println!("  {}", result);
        if i > 0 && result.new_facts_added == 0 {
            println!("  (no new facts — converged)");
            break;
        }
    }

    println!();

    // Generate output
    let output = agent.generate();
    let stats = agent.knowledge_base().stats();

    println!("Results:");
    println!("  Facts:         {}", stats.total_facts);
    println!("  Gamechangers:  {}", output.gamechangers.len());
    println!("  Skills:        {}", output.skills.len());
    println!("  Agents:        {}", output.agents.len());
    println!("  Score:         {}", stats.total_score);
    println!();

    // Write to disk
    match agent.write_output(&output_dir) {
        Ok(()) => println!("Written to {}", output_dir.display()),
        Err(e) => eprintln!("Error writing output: {}", e),
    }
}
