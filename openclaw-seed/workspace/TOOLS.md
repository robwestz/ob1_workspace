# Tool Notes

## Verified Working

- **Ahrefs MCP**: Keyword research, competitor analysis, domain ratings. Used for Bacowr competitive analysis and knowledge base SEO research. Monetary values are in USD cents -- divide by 100 for display.
- **Firecrawl**: Web research, documentation scraping. Used for OpenClaw config research and KB raw data ingestion. Reliable for structured content extraction.
- **Supabase CLI**: Database migrations, Edge Function deployment. Works from both Windows and Mac. 12 migrations ready for deployment. 7 Edge Functions with 47 API actions security-reviewed.
- **Tailscale**: Mesh VPN between Windows PC and MacBook Air M2. SSH works reliably. Key for the two-node architecture. Gateway mode off -- local connections only for now.
- **Claude Code CLI**: Primary development interface. Excellent for deep reasoning, architecture, security review. Login-based auth -- no per-token cost.
- **Context7 MCP**: Library documentation lookup. Use for framework-specific syntax questions instead of relying on training data. Especially useful for fast-moving projects (Next.js, Supabase SDK).

## Quirks & Gotchas

- **Anthropic API retries**: 429/500/529 errors need exponential backoff (2s, 4s, 8s). Without retry logic, a single rate-limit kills overnight sessions. Fixed in conversation-runtime.ts.
- **Mac 8GB RAM**: No local models. Everything must be cloud-based (Claude, GPT-4, Gemini). Docker is too heavy -- use launchd as process supervisor.
- **Git on Windows with bash**: Use forward slashes in paths, /dev/null not NUL. Unix shell syntax even though the OS is Windows.
- **Supabase Edge Functions**: Must be remote, not local. Never use StdioServerTransport or local Node.js servers. Deploy as Edge Functions, connect via custom connectors UI.
- **OpenClaw workspace files**: IDENTITY.md, SOUL.md, USER.md, AGENTS.md, TOOLS.md loaded every session. MEMORY.md loaded in main session only. HEARTBEAT.md loaded on heartbeat runs.
- **Session compaction**: Budget check must happen before compaction LLM calls. Bug was found and fixed -- compaction could fire even after budget exhaustion.

## Preferred Patterns

- Wave protocol for any sustained work. Never batch-and-done.
- Multi-model dispatch: Claude for reasoning, Codex for bulk, Gemini for large context.
- Git push every 2-3 waves during night shifts. Progress must survive crashes.
- Quality gates before every commit. Tests must pass. Claims must be verified.
- Swedish for communication, English for code and technical docs.
- Markdown for everything persistent. Plain text in the workspace, not databases.
